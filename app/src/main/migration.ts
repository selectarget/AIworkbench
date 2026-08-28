import { dialog, type BrowserWindow } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { accountInputSchema, dolaAspectRatioSchema, fingerprintSchema, proxyNodeSchema, proxySchema, type AccountInput, type AppSettings, type FingerprintProfile, type LegacyImportPreview, type LegacyImportReport, type LegacyImportSettings, type PlatformId, type ProxyConfig, type StorageImportBundle, type SubscriptionProfile } from '../shared/contracts';
import type { AccountService } from './accounts';
import { createFingerprintProfile } from './fingerprint';
import { MAX_STORAGE_IMPORT_FILE_BYTES, normalizeIndexedDbBundle } from './storage-import';
import type { SettingsService } from './settings';

type JsonObject = Record<string, unknown>;
type LegacyConfig = JsonObject & { Instances?: unknown[]; instances?: unknown[] };
type StorageImporter = (accountId: string, bundle: StorageImportBundle) => Promise<{ cookies: number; localStorage: number; sessionStorage: number; indexedDb: number; errors: string[] }>;

function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function value(raw: unknown, ...keys: string[]): unknown {
  const source = object(raw);
  for (const key of keys) {
    if (key in source) return source[key];
    const match = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (match) return source[match];
  }
  return undefined;
}
function text(raw: unknown, ...keys: string[]): string { const found = value(raw, ...keys); return found == null ? '' : String(found).trim(); }
function bool(raw: unknown, ...keys: string[]): boolean { const found = value(raw, ...keys); return found === true || found === 1 || ['true', '1', 'yes', 'enabled'].includes(String(found ?? '').trim().toLowerCase()); }
function number(raw: unknown, fallback = 0, ...keys: string[]): number { const found = Number(value(raw, ...keys)); return Number.isFinite(found) ? found : fallback; }
function expiration(raw: unknown, ...keys: string[]): number | undefined {
  const found = value(raw, ...keys); if (found == null || String(found).trim() === '') return undefined;
  const numeric = Number(found); if (Number.isFinite(numeric) && numeric > 0) return numeric > 100_000_000_000 ? numeric / 1000 : numeric;
  const parsed = Date.parse(String(found)); return Number.isFinite(parsed) && parsed > 0 ? parsed / 1000 : undefined;
}
function array(raw: unknown, ...keys: string[]): unknown[] { const found = value(raw, ...keys); return Array.isArray(found) ? found : []; }
function stripQuotes(raw: string): string { return raw.trim().replace(/^['"]|['"]$/g, ''); }

function httpUrl(raw: string): string {
  try { const parsed = new URL(raw.trim()); return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : ''; } catch { return ''; }
}

function optionalBool(raw: unknown, fallback: boolean, ...keys: string[]): boolean {
  return value(raw, ...keys) === undefined ? fallback : bool(raw, ...keys);
}

export function mapLegacyPlatform(kind: string): PlatformId {
  const normalized = kind.trim().toLowerCase();
  const numericKinds: Record<string, PlatformId> = { '1': 'doubao', '2': 'dola', '3': 'qianwen', '4': 'yunque', '5': 'custom', '6': 'higgsfield' };
  if (numericKinds[normalized]) return numericKinds[normalized];
  if (normalized.includes('dola')) return 'dola';
  if (normalized.includes('千问') || normalized.includes('qianwen') || normalized.includes('qwen')) return 'qianwen';
  if (normalized.includes('云雀') || normalized.includes('yunque')) return 'yunque';
  if (normalized.includes('higgsfield')) return 'higgsfield';
  if (normalized.includes('kimi') || normalized.includes('moonshot')) return 'kimi';
  if (normalized.includes('oiioii')) return 'oiioii';
  if (normalized.includes('nano') || normalized.includes('xcgai')) return 'nano';
  if (normalized.includes('lovart')) return 'lovart';
  if (normalized.includes('即梦') || normalized.includes('jimeng')) return 'jimeng';
  if (normalized.includes('自定义') || normalized.includes('custom')) return 'custom';
  return 'doubao';
}

function parseHostPort(raw: string): { host: string; port?: number } {
  const input = raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const match = input.match(/^\[([^\]]+)\](?::(\d+))?$/) ?? input.match(/^([^:]+)(?::(\d+))?$/);
  if (!match) return { host: '' };
  const host = match[1] ?? ''; const port = match[2] ? Number(match[2]) : undefined;
  return { host, port: port && port >= 1 && port <= 65535 ? port : undefined };
}

function normalizeNode(raw: unknown): ReturnType<typeof proxyNodeSchema.parse> | null {
  const source = object(raw); const address = parseHostPort(text(source, 'Host', 'Server', 'Address', 'ProxyServer'));
  const port = number(source, address.port ?? 0, 'Port', 'ServerPort');
  if (!address.host || !port) return null;
  const candidate = proxyNodeSchema.safeParse({
    name: text(source, 'Name', 'name', 'Remark', 'remark') || address.host,
    scheme: text(source, 'Scheme', 'scheme', 'Type', 'type') || 'socks5', host: address.host, port,
    username: text(source, 'Username', 'username', 'User'), password: text(source, 'Password', 'password'),
    tag: text(source, 'Tag', 'tag') || text(source, 'Name', 'name'), configJson: text(source, 'ConfigJson', 'configJson'),
    latencyMs: number(source, 0, 'LatencyMs', 'latencyMs'), realIp: text(source, 'RealIp', 'realIp')
  });
  return candidate.success ? candidate.data : null;
}

export function proxyFromLegacy(raw: unknown): ProxyConfig {
  const source = object(raw); const mode = text(source, 'Mode', 'mode').toLowerCase() === 'subscription' ? 'subscription' : 'direct';
  const nodes = array(source, 'SubscriptionNodes', 'subscriptionNodes').map(normalizeNode).filter((node): node is NonNullable<typeof node> => Boolean(node));
  const directAddress = text(source, 'DirectAddressText', 'directAddressText', 'Address', 'ProxyAddress');
  const parsedAddress = parseHostPort(directAddress);
  const host = (text(source, 'Host', 'host') || parsedAddress.host).slice(0, 255);
  const port = number(source, parsedAddress.port ?? 0, 'Port', 'port');
  const requestedScheme = (text(source, 'DirectScheme', 'directScheme', 'Scheme', 'scheme') || 'http').toLowerCase();
  const directScheme = (['http', 'https', 'socks5'] as const).includes(requestedScheme as 'http' | 'https' | 'socks5') ? requestedScheme : 'http';
  const subscriptionUrlRaw = text(source, 'SubscriptionUrl', 'subscriptionUrl');
  const subscriptionUrl = (() => { try { const parsed = new URL(subscriptionUrlRaw); return /^https?:$/i.test(parsed.protocol) ? parsed.href : ''; } catch { return ''; } })();
  const enabledRequested = bool(source, 'Enabled', 'enabled');
  const usable = mode === 'subscription' ? Boolean(subscriptionUrl || text(source, 'SubscriptionConfigJson', 'subscriptionConfigJson') || nodes.length) : Boolean(host && port);
  const lastRuntimeError = enabledRequested && !usable ? (mode === 'subscription' ? '旧版订阅配置缺少有效地址、正文或节点，已停用，导入后可重新配置' : '旧版直连代理缺少有效主机或端口，已停用，导入后可重新配置') : '';
  return proxySchema.parse({
    enabled: enabledRequested && usable, mode, type: mode === 'subscription' ? 'socks5' : directScheme, host, port: port || undefined,
    username: text(source, 'Username', 'username').slice(0, 255), password: text(source, 'Password', 'password').slice(0, 1024),
    directScheme, directAddressText: directAddress, directAuthText: text(source, 'DirectAuthText', 'directAuthText'),
    subscriptionUrl, subscriptionUserAgent: text(source, 'SubscriptionUserAgent', 'subscriptionUserAgent').slice(0, 255) || 'sing-box',
    selectedNodeName: text(source, 'SelectedNodeName', 'selectedNodeName'), selectedNodeTag: text(source, 'SelectedNodeTag', 'selectedNodeTag'),
    subscriptionConfigJson: text(source, 'SubscriptionConfigJson', 'subscriptionConfigJson'), subscriptionNodes: nodes, lastRuntimeError
  });
}

function brands(valueToParse: unknown): string {
  if (Array.isArray(valueToParse)) return valueToParse.map((item) => { const source = object(item); return `"${text(source, 'brand', 'Brand')}";v="${text(source, 'version', 'Version')}"`; }).filter((item) => !item.includes('""')).join(', ');
  return String(valueToParse ?? '').trim();
}

function fingerprintFromLegacy(raw: unknown, platform: PlatformId, fallback: FingerprintProfile): FingerprintProfile {
  const source = object(raw); const ua = object(value(source, 'ua')); const js = object(value(source, 'javascriptFingerprint')); const uaData = object(value(js, 'navigatorUserAgentData')); const screen = object(value(source, 'screen')); const network = object(value(source, 'network'));
  const languagesRaw = value(js, 'languages'); const languages = Array.isArray(languagesRaw) ? languagesRaw.map(String).filter(Boolean) : String(languagesRaw ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return fingerprintSchema.parse({
    ...fallback, enabled: bool(source, 'enabled'), userAgent: text(ua, 'userAgent') || text(js, 'navigatorUserAgent') || fallback.userAgent,
    platform: text(js, 'platform') || fallback.platform, vendor: text(js, 'vendor') || fallback.vendor, languages: languages.length ? languages : fallback.languages,
    hardwareConcurrency: number(js, fallback.hardwareConcurrency, 'hardwareConcurrency'), deviceMemory: number(js, fallback.deviceMemory, 'deviceMemory'), maxTouchPoints: number(js, fallback.maxTouchPoints, 'maxTouchPoints'),
    webGlVendor: text(js, 'webglVendor') || fallback.webGlVendor, webGlRenderer: text(js, 'webglRenderer') || fallback.webGlRenderer,
    userAgentDataBrands: brands(value(ua, 'secChUa', 'secChUaFullVersionList') || value(uaData, 'brands')) || fallback.userAgentDataBrands,
    userAgentDataFullVersionList: brands(value(ua, 'secChUaFullVersionList') || value(uaData, 'fullVersionList')) || fallback.userAgentDataFullVersionList,
    userAgentDataMobile: bool(uaData, 'mobile'), userAgentDataPlatform: stripQuotes(text(uaData, 'platform') || text(ua, 'secChUaPlatform')) || fallback.userAgentDataPlatform,
    userAgentDataArchitecture: stripQuotes(text(uaData, 'architecture') || text(ua, 'secChUaArch')) || fallback.userAgentDataArchitecture,
    userAgentDataBitness: stripQuotes(text(uaData, 'bitness') || text(ua, 'secChUaBitness')) || fallback.userAgentDataBitness,
    userAgentDataPlatformVersion: stripQuotes(text(uaData, 'platformVersion') || text(ua, 'secChUaPlatformVersion')) || fallback.userAgentDataPlatformVersion,
    screenWidth: number(screen, fallback.screenWidth, 'width'), screenHeight: number(screen, fallback.screenHeight, 'height'), deviceScaleFactor: number(screen, fallback.deviceScaleFactor, 'deviceScaleFactor'),
    timezone: text(source, 'timezone') || fallback.timezone, webRtcPolicy: text(network, 'webRtcPolicy') === 'disable_non_proxied_udp' ? 'disable_non_proxied_udp' : fallback.webRtcPolicy,
    canvasNoise: bool(value(source, 'canvas'), 'noise'), audioNoise: bool(value(source, 'audio'), 'noise')
  });
}

function findFiles(root: string, name: string, depth = 3): string[] {
  if (depth < 0 || !existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) result.push(path);
    else if (entry.isDirectory() && !['cache', 'code cache', 'gpu cache', 'service worker', 'sessions'].includes(entry.name.toLowerCase())) result.push(...findFiles(path, name, depth - 1));
  }
  return result;
}

function isLegacyInstanceFolder(folder: string): boolean {
  return existsSync(join(folder, 'account_config.json')) || existsSync(join(folder, 'fingerprint_config.json')) || existsSync(join(folder, 'EBWebView'));
}

function collectLegacyInstanceFolders(root: string, depth = 3): string[] {
  if (depth < 0 || !existsSync(root)) return [];
  if (isLegacyInstanceFolder(root)) return [root];
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || ['cache', 'code cache', 'gpu cache', 'service worker', 'sessions', 'ebwebview'].includes(entry.name.toLowerCase())) continue;
    result.push(...collectLegacyInstanceFolders(join(root, entry.name), depth - 1));
  }
  return result;
}

function readLegacyAccountConfig(folder: string): JsonObject {
  const path = join(folder, 'account_config.json');
  if (!existsSync(path)) return {};
  try { return object(readJson(path)); } catch { return {}; }
}

/**
 * Recover account rows when the user selects only the old ProfileRoot and the
 * AppConfig file is unavailable. Folder discovery is deliberately shallow and
 * stops at a detected account folder so Chromium internals are never treated
 * as separate accounts.
 */
export function discoverLegacyInstanceRows(root: string): JsonObject[] {
  const folders = collectLegacyInstanceFolders(root, 3).sort((left, right) => normalizedPath(left).localeCompare(normalizedPath(right)));
  return folders.map((folder, index) => {
    const config = readLegacyAccountConfig(folder);
    const kind = text(config, 'type', 'Type', 'kind', 'Kind');
    const name = text(config, 'name', 'Name') || basename(folder);
    const homeUrl = httpUrl(text(config, 'homeUrl', 'HomeUrl'));
    return {
      Id: number(config, index + 1, 'id', 'Id'),
      Name: name,
      Kind: kind || '1',
      UserDataFolder: folder,
      ...(homeUrl ? { HomeUrl: homeUrl } : {})
    };
  });
}

function readJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }

function configFromSource(path: string): { root: string; configPath: string; config: LegacyConfig } {
  const stat = statSync(path); const root = stat.isDirectory() ? path : dirname(path);
  const candidates = stat.isFile() ? [path] : [...new Set(['config.json', 'appconfig.json', 'app-config.json', 'DolaMultiBrowser.json'].flatMap((name) => findFiles(root, name, 2)))];
  for (const candidate of candidates) {
    try {
      const parsed = readJson(candidate); const source = Array.isArray(parsed) ? { instances: parsed } : object(parsed);
      if (Array.isArray(value(source, 'Instances', 'instances')) || value(source, 'ProfileRoot', 'profileRoot') || stat.isFile()) return { root, configPath: candidate, config: source as LegacyConfig };
    } catch { /* Try the next candidate. */ }
  }
  if (stat.isDirectory()) {
    const instances = discoverLegacyInstanceRows(root);
    if (instances.length) return { root, configPath: root, config: { ProfileRoot: root, Instances: instances } };
  }
  throw new Error('未找到包含 Instances/ProfileRoot 的 V4.4 配置 JSON');
}

function instanceRows(config: LegacyConfig): JsonObject[] {
  const rows = array(config, 'Instances', 'instances');
  return rows.map(object).filter((row) => Boolean(text(row, 'Name', 'name') || text(row, 'Kind', 'kind')));
}

function normalizedPath(raw: string): string {
  return stripQuotes(raw).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^[A-Z]:/i, (drive) => drive.toLowerCase()).toLowerCase();
}

function pathSegments(raw: string): string[] {
  return normalizedPath(raw).split('/').map((segment) => segment.trim()).filter(Boolean);
}

function identityTokens(raw: string): string[] {
  return normalizedPath(raw).split(/[^a-z0-9\u0080-\uffff]+/i).map((token) => token.trim()).filter(Boolean);
}

function legacyFingerprintIdentityValues(instance: JsonObject): string[] {
  return [
    text(instance, 'Id', 'id'),
    text(instance, 'Name', 'name'),
    text(instance, 'UserDataFolder', 'userDataFolder'),
    text(instance, 'ProfilePath', 'profilePath'),
    text(instance, 'DataFolderPath', 'dataFolderPath'),
    text(instance, 'Folder', 'folder'),
    text(instance, 'Directory', 'directory'),
    text(instance, 'Path', 'path')
  ].filter(Boolean);
}

function scoreLegacyFingerprintPath(root: string, instance: JsonObject, candidate: string): number {
  const candidateDirectory = dirname(candidate);
  const relativeCandidate = normalizedPath(relative(root, candidateDirectory));
  const candidateSegments = pathSegments(relativeCandidate);
  const candidateTokens = candidateSegments.flatMap(identityTokens);
  const configured = text(instance, 'UserDataFolder', 'userDataFolder');
  if (configured) {
    const configuredDirectory = isAbsolute(configured) ? resolve(configured) : resolve(root, configured);
    if (normalizedPath(configuredDirectory) === normalizedPath(candidateDirectory)) return 1000;
  }

  const values = legacyFingerprintIdentityValues(instance);
  let score = 0;
  for (const [index, valueToMatch] of values.entries()) {
    const normalizedValue = normalizedPath(valueToMatch);
    if (!normalizedValue) continue;
    const valueSegments = pathSegments(normalizedValue);
    if (valueSegments.length > 1 && valueSegments.every((segment) => candidateSegments.includes(segment))) {
      score = Math.max(score, index === 0 ? 220 : 180);
      continue;
    }
    const tokens = identityTokens(valueToMatch);
    if (!tokens.length) continue;
    const exactTokenCount = tokens.filter((token) => candidateTokens.includes(token)).length;
    if (exactTokenCount === tokens.length) score = Math.max(score, index === 0 ? 160 : 120);
    else if (exactTokenCount > 0) score = Math.max(score, index === 0 ? 80 : 60);
    const compactValue = tokens.join('');
    if (compactValue && candidateSegments.some((segment) => segment.replace(/[^a-z0-9\u0080-\uffff]/gi, '') === compactValue)) {
      score = Math.max(score, index === 0 ? 190 : 150);
    }
  }
  return score;
}

/**
 * Locate the V4.4 fingerprint file without guessing when several accounts
 * exist. The old app normally persisted UserDataFolder, but hand-copied
 * configs and folder-only restores may omit it; identity matching is then
 * intentionally conservative and returns null for a tie.
 */
export function findLegacyFingerprintPath(root: string, instance: JsonObject): string | null {
  const configured = text(instance, 'UserDataFolder', 'userDataFolder');
  if (configured) {
    const configuredCandidates = [
      isAbsolute(configured) ? join(configured, 'fingerprint_config.json') : join(root, configured, 'fingerprint_config.json'),
      join(configured, 'fingerprint_config.json')
    ];
    const exact = configuredCandidates.find((candidate) => existsSync(candidate));
    if (exact) return exact;
  }

  const files = findFiles(root, 'fingerprint_config.json', 3);
  if (files.length === 1) return files[0]!;
  if (!files.length) return null;
  const ranked = files.map((path) => ({ path, score: scoreLegacyFingerprintPath(root, instance, path) })).sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score <= 0 || best.score === ranked[1]?.score) return null;
  return best.path;
}

function profileFor(root: string, instance: JsonObject, platform: PlatformId, fallback: FingerprintProfile): FingerprintProfile {
  const path = findLegacyFingerprintPath(root, instance); if (!path) return fallback;
  try { return fingerprintFromLegacy(readJson(path), platform, fallback); } catch { return fallback; }
}

function regionProxy(config: LegacyConfig, platform: PlatformId): ProxyConfig {
  const overseas = platform === 'dola' || platform === 'higgsfield';
  return proxyFromLegacy(value(config, overseas ? 'OverseasProxy' : 'DomesticProxy', overseas ? 'overseasProxy' : 'domesticProxy') ?? value(config, 'Proxy', 'proxy') ?? {});
}

function normalizeLegacyFolder(root: string, raw: string): string {
  const input = stripQuotes(raw);
  if (!input) return '';
  try { return isAbsolute(input) ? input : resolve(root, input); } catch { return ''; }
}

function legacyBossKey(raw: unknown, fallback: AppSettings['bossKey']): { value: AppSettings['bossKey']; present: boolean } {
  const source = object(raw);
  if (!Object.keys(source).length) return { value: fallback, present: false };
  const defaultKey = { key: 'H', ctrl: true, alt: true, shift: false, meta: false, enabled: true } satisfies AppSettings['bossKey'];
  const rawKey = text(source, 'Key', 'key').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    present: true,
    value: {
      key: /^[A-Z0-9]$/.test(rawKey) ? rawKey : defaultKey.key,
      ctrl: optionalBool(source, defaultKey.ctrl, 'Ctrl', 'ctrl'),
      alt: optionalBool(source, defaultKey.alt, 'Alt', 'alt'),
      shift: optionalBool(source, defaultKey.shift, 'Shift', 'shift'),
      meta: optionalBool(source, defaultKey.meta, 'Win', 'win', 'Meta', 'meta'),
      enabled: true
    }
  };
}

function legacyDolaAspectRatio(root: string, fallback: AppSettings['dolaAspectRatio']): { value: AppSettings['dolaAspectRatio']; present: boolean } {
  try {
    const raw = readFileSync(join(root, 'dola-video-ratio.txt'), 'utf8').trim();
    const parsed = dolaAspectRatioSchema.safeParse(raw);
    if (parsed.success) return { value: parsed.data, present: true };
  } catch { /* The optional V4.4 preference file may not exist. */ }
  return { value: fallback, present: false };
}

export function legacySettingsFromConfig(root: string, config: LegacyConfig, fallback: AppSettings): LegacyImportSettings {
  const rawDownloadDir = text(config, 'VideoDownloadRoot', 'videoDownloadRoot');
  const downloadDir = normalizeLegacyFolder(root, rawDownloadDir);
  const rawProfileRoot = text(config, 'ProfileRoot', 'profileRoot');
  const profileRoot = normalizeLegacyFolder(root, rawProfileRoot);
  const boss = legacyBossKey(value(config, 'BossKey', 'bossKey'), fallback.bossKey);
  const aspectRatio = legacyDolaAspectRatio(root, fallback.dolaAspectRatio);
  const homeUrlCount = instanceRows(config).filter((row) => Boolean(httpUrl(text(row, 'HomeUrl', 'homeUrl')))).length;
  return {
    downloadDir,
    hasDownloadDir: Boolean(rawDownloadDir && downloadDir),
    videoDownloadDir: downloadDir,
    hasVideoDownloadDir: Boolean(rawDownloadDir && downloadDir),
    legacyV44MediaFolders: Boolean(rawDownloadDir && downloadDir),
    hasLegacyV44MediaFolders: Boolean(rawDownloadDir && downloadDir),
    profileRoot,
    hasProfileRoot: Boolean(rawProfileRoot && profileRoot),
    bossKey: boss.value,
    hasBossKey: boss.present,
    dolaAspectRatio: aspectRatio.value,
    hasDolaAspectRatio: aspectRatio.present,
    homeUrlCount
  };
}

export class LegacyMigrationService {
  private sourcePath: string | null = null;
  constructor(private readonly window: BrowserWindow, private readonly accounts: AccountService, private readonly accountsFile: string, private readonly storageImporter?: StorageImporter, private readonly settings?: SettingsService) {}

  async preview(): Promise<LegacyImportPreview | null> {
    const source = await this.chooseSource(); if (!source) return null;
    return this.previewSource(source);
  }

  private previewSource(source: string): LegacyImportPreview {
    this.sourcePath = source;
    const parsed = configFromSource(source); const rows = instanceRows(parsed.config); const storageFiles = findFiles(parsed.root, 'cookie.json', 3).concat(findFiles(parsed.root, 'cookies.json', 3)).map((item) => relative(parsed.root, item));
    const settings = legacySettingsFromConfig(parsed.root, parsed.config, this.settings?.get() ?? { bossKey: { key: 'H', ctrl: true, alt: true, shift: false, meta: false, enabled: false }, dolaAspectRatio: '16:9' } as AppSettings);
    const occupiedNames = new Set(this.accounts.list().map((account) => account.name.trim().toLowerCase()));
    const accounts = rows.map((row, index) => {
      const platform = mapLegacyPlatform(text(row, 'Kind', 'kind')); const fp = findLegacyFingerprintPath(parsed.root, row); const proxy = regionProxy(parsed.config, platform);
      const name = text(row, 'Name', 'name') || `导入账号 ${index + 1}`; const conflict = occupiedNames.has(name.toLowerCase()) ? 'name' as const : undefined; occupiedNames.add(name.toLowerCase());
      return { legacyId: number(row, index + 1, 'Id', 'id'), name, platform, hasFingerprint: Boolean(fp), proxyMode: proxy.mode, ...(conflict ? { conflict } : {}) };
    });
    const warnings = ['WebView2 Cookie/缓存数据库不会直接复制，建议使用登录辅助或 Cookie/Storage 导入恢复登录态。'];
    if (rows.some((row) => !findLegacyFingerprintPath(parsed.root, row))) warnings.push('部分账号未找到可唯一对应的 fingerprint_config.json，将使用新的平台原生指纹模板。');
    if (settings.hasVideoDownloadDir) warnings.push(`将迁移旧版视频下载目录：${settings.videoDownloadDir}`);
    else if (text(parsed.config, 'VideoDownloadRoot', 'videoDownloadRoot')) warnings.push('旧版 VideoDownloadRoot 无法解析为有效路径，普通和视频下载目录保持当前设置。');
    if (settings.hasLegacyV44MediaFolders) warnings.push('将保留 V4.4 素材目录兼容：根目录/Videos 与根目录/Images；视频继续使用 1.mp4、2.mp4… 编号。');
    if (settings.hasProfileRoot) warnings.push(`发现旧版浏览器数据目录：${settings.profileRoot}；不会直接复制 WebView2 Cookie/缓存数据库。请在设置中选择新的 Electron 浏览器数据目录，登录态使用 Cookie/Storage 导入或重新登录恢复。`);
    else if (text(parsed.config, 'ProfileRoot', 'profileRoot')) warnings.push('旧版 ProfileRoot 无法解析为有效路径；Electron 浏览器数据目录保持当前设置。');
    if (settings.hasBossKey) warnings.push(`将迁移旧版 Boss Key：${settings.bossKey.ctrl ? 'Ctrl+' : ''}${settings.bossKey.alt ? 'Alt+' : ''}${settings.bossKey.shift ? 'Shift+' : ''}${settings.bossKey.meta ? `${process.platform === 'darwin' ? 'Command' : 'Super'}+` : ''}${settings.bossKey.key}`);
    if (settings.hasDolaAspectRatio) warnings.push(`发现旧版 Dola 画幅偏好：${settings.dolaAspectRatio}，导入后写入统一设置。`);
    if (settings.homeUrlCount) warnings.push(`发现 ${settings.homeUrlCount} 个可恢复的旧版主页地址，将写入账号浏览器配置。`);
    return { sourcePath: parsed.configPath, accountCount: rows.length, fingerprintCount: accounts.filter((item) => item.hasFingerprint).length, proxyProfileCount: [value(parsed.config, 'DomesticProxy', 'domesticProxy'), value(parsed.config, 'OverseasProxy', 'overseasProxy')].filter(Boolean).length, storageFiles, warnings, settings, accounts };
  }

  async import(): Promise<LegacyImportReport | null> {
    const source = this.sourcePath ?? await this.chooseSource(); if (!source) return null;
    const preview = this.previewSource(source); if (!this.sourcePath) return null;
    const parsed = configFromSource(this.sourcePath); const backupDir = join(dirname(this.accountsFile), 'backups'); mkdirSync(backupDir, { recursive: true }); const backupPath = join(backupDir, `accounts-before-legacy-${Date.now()}.json`); if (existsSync(this.accountsFile)) copyFileSync(this.accountsFile, backupPath); else writeFileSync(backupPath, '[]\n');
    const existingNames = new Set(this.accounts.list().map((account) => account.name.toLowerCase())); const errors: string[] = []; let imported = 0; let skipped = 0;
    for (const [index, row] of instanceRows(parsed.config).entries()) {
      const platform = mapLegacyPlatform(text(row, 'Kind', 'kind')); let name = text(row, 'Name', 'name') || `V4.4 账号 ${index + 1}`; if (existingNames.has(name.toLowerCase())) name = `${name}（V4.4）`; while (existingNames.has(name.toLowerCase())) name = `${name}（副本）`;
      const homeUrl = httpUrl(text(row, 'HomeUrl', 'homeUrl')); const fallback = createFingerprintProfile(platform); const fingerprint = profileFor(parsed.root, row, platform, fallback);
      const proxy = regionProxy(parsed.config, platform); const candidate: AccountInput = accountInputSchema.parse({ name, platform, customUrl: platform === 'custom' ? homeUrl : '', group: 'V4.4 导入', remark: `来源：${basename(preview.sourcePath)}`, browser: { homeUrl, lastUrl: '', zoomFactor: 1, restoreOnStart: true }, fingerprint, proxy });
      try { this.accounts.create(candidate); existingNames.add(name.toLowerCase()); imported++; } catch (error) { skipped++; errors.push(`${name}：${error instanceof Error ? error.message : String(error)}`); }
    }
    if (this.settings) {
      try {
        const patch: Partial<AppSettings> = { migrationCompleted: true };
        if (preview.settings.hasDownloadDir) patch.downloadDir = preview.settings.downloadDir;
        if (preview.settings.hasVideoDownloadDir) patch.videoDownloadDir = preview.settings.videoDownloadDir;
        if (preview.settings.hasLegacyV44MediaFolders) patch.legacyV44MediaFolders = true;
        if (preview.settings.hasBossKey) patch.bossKey = preview.settings.bossKey;
        if (preview.settings.hasDolaAspectRatio) patch.dolaAspectRatio = preview.settings.dolaAspectRatio;
        this.settings.update(patch);
      } catch (error) { errors.push(`应用迁移设置失败：${error instanceof Error ? error.message : String(error)}`); }
    }
    return { ...preview, imported, skipped, backupPath, errors };
  }

  async importStorage(accountId: string): Promise<{ cookies: number; localStorage: number; sessionStorage: number; indexedDb: number; errors: string[] }> {
    if (!this.storageImporter) throw new Error('Storage 导入服务未初始化');
    const result = await dialog.showOpenDialog(this.window, { title: '导入 Cookie / Storage', properties: ['openFile'], filters: [{ name: 'JSON / CSV', extensions: ['json', 'csv'] }] });
    if (result.canceled || !result.filePaths[0]) throw new Error('已取消导入');
    const path = result.filePaths[0];
    if (statSync(path).size > MAX_STORAGE_IMPORT_FILE_BYTES) throw new Error(`导入文件过大，不能超过 ${Math.round(MAX_STORAGE_IMPORT_FILE_BYTES / 1024 / 1024)} MB`);
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, ''); const bundle = parseStorageBundle(raw, path.toLowerCase().endsWith('.csv')); return this.storageImporter(accountId, bundle);
  }

  private async chooseSource(): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.window, { title: '选择 V4.4 配置文件或数据目录', properties: ['openFile', 'openDirectory'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  }
}

export function parseStorageBundle(raw: string, csv: boolean): StorageImportBundle {
  if (!csv) {
    const parsed = JSON.parse(raw) as unknown; const source = Array.isArray(parsed) ? { cookies: parsed } : object(parsed);
    const cookieSource = value(source, 'cookies', 'Cookies');
    const result: StorageImportBundle = { cookies: Array.isArray(cookieSource) ? cookieSource.map(object).map((item) => {
      const rawDomain = text(item, 'domain', 'Domain', 'host', 'Host', 'hostname', 'Hostname');
      let domain = rawDomain.replace(/^#HttpOnly_/i, '');
      if (!domain) { try { domain = new URL(text(item, 'url', 'Url')).hostname; } catch { /* The row will be filtered below. */ } }
      const sameSite = text(item, 'sameSite', 'SameSite') || undefined;
      return { name: text(item, 'name', 'Name'), value: text(item, 'value', 'Value'), domain, path: text(item, 'path', 'Path') || '/', expires: expiration(item, 'expirationDate', 'expires', 'expiry', 'Expires', 'ExpiresUtc', 'expiresUtc'), secure: bool(item, 'secure', 'Secure') || /^__Secure-/i.test(text(item, 'name', 'Name')) || String(sameSite).toLowerCase() === 'none', httpOnly: bool(item, 'httpOnly', 'HttpOnly') || /^#HttpOnly_/i.test(rawDomain), sameSite };
    }).filter((item) => item.name && item.domain) : [] };
    const localStorage = storageSection(source, 'localStorage', 'local_storage', 'local-storage', 'local', 'localStorageData', 'local_storage_data');
    const sessionStorage = storageSection(source, 'sessionStorage', 'session_storage', 'session-storage', 'session', 'sessionStorageData', 'session_storage_data');
    if (localStorage.found) result.localStorage = storageRecord(localStorage.value);
    if (sessionStorage.found) result.sessionStorage = storageRecord(sessionStorage.value);
    const indexedDb = value(source, 'indexedDb', 'IndexedDb', 'indexedDB');
    if (indexedDb !== undefined) {
      const normalized = normalizeIndexedDbBundle(indexedDb);
      if (normalized.bundle) result.indexedDb = normalized.bundle;
      if (normalized.warnings.length) result.warnings = normalized.warnings;
    }
    const hasStructuredSection = cookieSource !== undefined || localStorage.found || sessionStorage.found || indexedDb !== undefined;
    if (!hasStructuredSection) {
      const genericStorage = storageSection(source, 'storage', 'Storage', 'items', 'Items', 'entries', 'Entries', 'records', 'Records');
      result.localStorage = storageRecord(genericStorage.found ? genericStorage.value : source);
      result.warnings = [...(result.warnings ?? []), '未识别的 JSON 对象按 LocalStorage 导入；如内容不是网页存储，请取消本次导入。'];
    }
    return result;
  }
  const rows = parseCsvRows(raw); if (!rows.length) return { cookies: [] }; const headers = rows.shift()!.map((item) => item.trim()); const cookies = rows.map((cells) => { const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])); const rawDomain = text(row, 'domain', 'Domain', 'host', 'Host', 'hostname', 'Hostname'); const domain = rawDomain.replace(/^#HttpOnly_/i, ''); const sameSite = text(row, 'sameSite', 'SameSite') || undefined; return { name: text(row, 'name', 'Name'), value: text(row, 'value', 'Value'), domain, path: text(row, 'path', 'Path') || '/', expires: expiration(row, 'expirationDate', 'expires', 'expiry', 'Expires', 'ExpiresUtc', 'expiresUtc'), secure: bool(row, 'secure', 'Secure') || /^__Secure-/i.test(text(row, 'name', 'Name')) || String(sameSite).toLowerCase() === 'none', httpOnly: bool(row, 'httpOnly', 'HttpOnly') || /^#HttpOnly_/i.test(rawDomain), sameSite }; }).filter((item) => item.name && item.domain); return { cookies };
}

function normalizeStorageKey(key: string): string { return key.replace(/[\s_-]/g, '').toLowerCase(); }

function storageSection(raw: unknown, ...keys: string[]): { found: boolean; value: unknown } {
  const source = object(raw); const accepted = new Set(keys.map(normalizeStorageKey));
  const match = Object.keys(source).find((candidate) => accepted.has(normalizeStorageKey(candidate)));
  return match ? { found: true, value: source[match] } : { found: false, value: undefined };
}

function storageRecord(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    const entries: Record<string, unknown> = {};
    for (const item of raw) {
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0] ?? '').trim(); if (key) entries[key] = item[1];
        continue;
      }
      const source = object(item); const key = text(source, 'key', 'Key', 'name', 'Name');
      if (!key || storageSection(source, 'domain', 'host', 'hostname', 'url', 'path', 'secure', 'httpOnly', 'sameSite', 'expires', 'expirationDate').found) continue;
      const itemValue = storageSection(source, 'value', 'Value', 'data', 'Data');
      if (itemValue.found) entries[key] = itemValue.value;
    }
    return entries;
  }
  const source = object(raw); const wrapped = storageSection(source, 'items', 'Items', 'entries', 'Entries', 'records', 'Records');
  return wrapped.found && Array.isArray(wrapped.value) ? storageRecord(wrapped.value) : source;
}

function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]; const next = raw[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((value) => value.some((item) => item.trim()));
}

export function subscriptionFromLegacy(config: ProxyConfig): SubscriptionProfile {
  return { format: 'sing-box-json', configJson: config.subscriptionConfigJson, nodes: config.subscriptionNodes, skippedNodeCount: 0, sourceUrl: config.subscriptionUrl || undefined };
}
