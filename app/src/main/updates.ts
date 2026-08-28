import { app, net, shell } from 'electron';
import { createHash, verify } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { UpdateInfo } from '../shared/contracts';
import { isCompatibleUpdateAsset, resolveUpdateTarget, selectUpdateManifestAsset, validateReleaseUrl, type ReleaseManifestAsset, type UpdateTarget } from './update-target';

type Release = { tag_name: string; html_url: string; assets: ReleaseManifestAsset[] };
type SignedUpdateManifest = {
  version?: unknown;
  target?: unknown;
  platform?: unknown;
  arch?: unknown;
  asset?: unknown;
  sha256?: unknown;
  signature?: unknown;
  assets?: Record<string, unknown>;
};

function versionParts(value: string): number[] { return value.replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0); }
function newer(a: string, b: string): boolean { const left = versionParts(a), right = versionParts(b); for (let i = 0; i < 4; i++) { if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) > (right[i] ?? 0); } return false; }

export class UpdateService {
  private release: Release | null = null;
  constructor(private readonly updateDir: string, private readonly target: UpdateTarget | null = resolveUpdateTarget(process.platform, process.arch)) {}
  async check(): Promise<UpdateInfo> {
    const repo = process.env.GITHUB_RELEASE_REPO?.trim(); const currentVersion = app.getVersion();
    if (!this.target) return { enabled: false, hasUpdate: false, currentVersion, reason: '当前平台没有可用的更新包' };
    if (!repo) return { enabled: false, hasUpdate: false, currentVersion, target: this.target };
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_RELEASE_REPO 格式必须为 owner/repo');
    const response = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AI-Creation-Workbench' } });
    if (!response.ok) throw new Error(`GitHub Releases 请求失败：HTTP ${response.status}`);
    this.release = await response.json() as Release;
    const latestVersion = this.release.tag_name.replace(/^v/i, '');
    return { enabled: true, hasUpdate: newer(latestVersion, currentVersion), currentVersion, latestVersion, releaseUrl: this.release.html_url, target: this.target };
  }
  async download(): Promise<string> {
    if (!this.target) throw new Error('当前平台没有可用的更新包');
    if (!this.release) await this.check(); if (!this.release) throw new Error('没有可用更新');
    const manifestAsset = selectUpdateManifestAsset(this.release.assets, this.target);
    if (!manifestAsset) throw new Error(`Release 缺少当前平台更新清单：update-manifest-${this.target}.json`);
    const manifestResponse = await net.fetch(manifestAsset.browser_download_url); if (!manifestResponse.ok) throw new Error('更新清单下载失败');
    const manifest = await manifestResponse.json() as SignedUpdateManifest;
    const selected = selectManifestEntry(manifest, this.target);
    if (!selected) throw new Error('更新清单缺少当前平台的 asset、SHA-256 或签名');
    const manifestTarget = selected.target || manifestTargetFromManifest(manifest);
    if (manifestTarget && manifestTarget !== this.target) throw new Error(`更新清单目标平台不匹配：${manifestTarget}`);
    const explicitTarget = Boolean(manifestTarget) || manifestAsset.name.toLowerCase() !== 'update-manifest.json';
    if ((explicitTarget || this.target !== 'win32-x64') && !isCompatibleUpdateAsset(selected.asset, this.target)) throw new Error(`更新包不是 ${this.target} 架构：${selected.asset}`);
    if (basename(selected.asset) !== selected.asset || selected.asset === '.' || selected.asset === '..') throw new Error('更新清单中的文件名无效');
    const zip = this.release.assets.find((asset) => asset.name === selected.asset); if (!zip) throw new Error('Release 缺少清单指定的更新包');
    const publicKey = process.env.UPDATE_PUBLIC_KEY?.replaceAll('\\n', '\n'); if (!publicKey) throw new Error('当前构建未配置更新公钥');
    const signed = Buffer.from(manifestTarget ? `${selected.version}\n${manifestTarget}\n${selected.asset}\n${selected.sha256}` : `${selected.version}\n${selected.asset}\n${selected.sha256}`);
    if (!verify(null, signed, publicKey, Buffer.from(selected.signature, 'base64'))) throw new Error('更新清单签名无效');
    const response = await net.fetch(zip.browser_download_url); if (!response.ok) throw new Error('更新包下载失败');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== selected.sha256.toLowerCase()) throw new Error('更新包校验失败');
    mkdirSync(this.updateDir, { recursive: true }); const path = join(this.updateDir, selected.asset); writeFileSync(path, bytes); return path;
  }
  async openRelease(): Promise<void> {
    if (!this.release) await this.check();
    if (!this.release?.html_url) throw new Error('没有可打开的发布页');
    await shell.openExternal(validateReleaseUrl(this.release.html_url));
  }
  openFolder(): void { void shell.openPath(this.updateDir); }
}

function manifestTargetFromManifest(manifest: SignedUpdateManifest): string {
  const direct = String(manifest.target ?? '').trim(); if (direct) return direct;
  const platform = String(manifest.platform ?? '').trim(); const arch = String(manifest.arch ?? '').trim();
  return platform && arch ? `${platform}-${arch}` : '';
}

function selectManifestEntry(manifest: SignedUpdateManifest, target: UpdateTarget): { version: string; asset: string; sha256: string; signature: string; target?: string } | null {
  const candidate = manifest.assets?.[target] ?? manifest.assets?.[target.replace('win32-', 'win-')];
  const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? { ...manifest, ...(candidate as Record<string, unknown>) } : manifest;
  const version = String(source.version ?? '').trim(); const asset = String(source.asset ?? '').trim(); const sha256 = String(source.sha256 ?? '').trim().toLowerCase(); const signature = String(source.signature ?? '').trim();
  if (!version || !asset || !/^[a-f0-9]{64}$/i.test(sha256) || !signature) return null;
  const targetValue = String(source.target ?? manifestTargetFromManifest(manifest)).trim() || undefined;
  return { version, asset, sha256, signature, target: targetValue };
}
