import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { accountInputSchema, accountSchema, batchCreateAccountsSchema, platformIds, type Account, type AccountInput, type BatchCreateAccountsInput, type GroupSummary } from '../shared/contracts';
import { AtomicStore } from './atomic-store';
import { adaptFingerprintProfile, createFingerprintProfile } from './fingerprint';

const accountListSchema = z.array(accountSchema);

function legacyPlatform(value: unknown): Account['platform'] {
  const normalized = String(value ?? '').trim().toLowerCase();
  const numericKinds: Record<string, Account['platform']> = { '1': 'doubao', '2': 'dola', '3': 'qianwen', '4': 'yunque', '5': 'custom', '6': 'higgsfield' };
  if (numericKinds[normalized]) return numericKinds[normalized];
  if (normalized.includes('dola')) return 'dola'; if (normalized.includes('千问') || normalized.includes('qianwen') || normalized.includes('qwen')) return 'qianwen';
  if (normalized.includes('云雀') || normalized.includes('yunque')) return 'yunque'; if (normalized.includes('higgsfield')) return 'higgsfield';
  if (normalized.includes('kimi') || normalized.includes('moonshot')) return 'kimi'; if (normalized.includes('oiioii')) return 'oiioii';
  if (normalized.includes('nano') || normalized.includes('xcgai')) return 'nano'; if (normalized.includes('lovart')) return 'lovart';
  if (normalized.includes('即梦') || normalized.includes('jimeng')) return 'jimeng'; if (normalized.includes('自定义') || normalized.includes('custom')) return 'custom';
  return platformIds.includes(normalized as Account['platform']) ? normalized as Account['platform'] : 'doubao';
}

function migrateAccounts(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const used = new Set<string>();
  return value.map((item, index) => {
    const source = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const rawId = String(source.id ?? source.Id ?? '').trim(); let id = /^[a-zA-Z0-9_-]{6,80}$/.test(rawId) && !used.has(rawId) ? rawId : `legacy_${index + 1}`;
    while (used.has(id)) id = `legacy_${index + 1}_${used.size}`; used.add(id);
    const name = String(source.name ?? source.Name ?? `账号 ${index + 1}`).trim() || `账号 ${index + 1}`;
    const platform = legacyPlatform(source.platform ?? source.Platform ?? source.kind ?? source.Kind);
    const createdAtRaw = String(source.createdAt ?? source.CreatedAt ?? '').trim(); const createdAt = !Number.isNaN(new Date(createdAtRaw).valueOf()) ? new Date(createdAtRaw).toISOString() : new Date().toISOString();
    const proxy = source.proxy && typeof source.proxy === 'object' ? source.proxy : undefined;
    const browser = source.browser && typeof source.browser === 'object' ? source.browser : { homeUrl: String(source.homeUrl ?? source.HomeUrl ?? (platform === 'custom' ? source.url ?? '' : '')), lastUrl: '', zoomFactor: 1, restoreOnStart: true };
    const fingerprint = source.fingerprint && typeof source.fingerprint === 'object' ? source.fingerprint : undefined;
    return { ...source, schemaVersion: 2, id, name, platform, group: String(source.group ?? source.Group ?? ''), remark: String(source.remark ?? source.Remark ?? ''), customUrl: platform === 'custom' ? String(source.customUrl ?? source.CustomUrl ?? source.url ?? '') : String(source.customUrl ?? ''), proxy, browser, fingerprint, createdAt, order: Number.isInteger(source.order) && Number(source.order) >= 0 ? Number(source.order) : index };
  });
}

function protectPassword(password: string): string {
  if (!password) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存代理密码');
  return `enc:${safeStorage.encryptString(password).toString('base64')}`;
}

function revealPassword(password: string): string {
  if (!password.startsWith('enc:') || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(password.slice(4), 'base64')); } catch { return ''; }
}

export class AccountService {
  restoreConfiguration(raw: Account[]): number {
    const incoming = accountListSchema.parse(raw);
    const merged = new Map(this.persisted().map((account) => [account.id, account]));
    for (const account of incoming) merged.set(account.id, account);
    this.store.write([...merged.values()].map((account, order) => ({ ...account, order })));
    return incoming.length;
  }
  private readonly store: AtomicStore<Account[]>;
  constructor(file: string) { this.store = new AtomicStore(file, accountListSchema, [], migrateAccounts); }

  private persisted(): Account[] {
    const accounts = this.store.read().sort((a, b) => a.order - b.order);
    const normalized = accounts.map((account) => {
      const fingerprint = account.fingerprint.seed ? account.fingerprint : { ...createFingerprintProfile(account.platform), enabled: account.fingerprint.enabled };
      return { ...account, fingerprint: adaptFingerprintProfile(account.platform, fingerprint) };
    });
    if (normalized.some((account, index) => JSON.stringify(account.fingerprint) !== JSON.stringify(accounts[index]?.fingerprint))) this.store.write(normalized);
    return normalized;
  }
  private publicAccount(account: Account): Account {
    return { ...account, proxy: { ...account.proxy, password: revealPassword(account.proxy.password) }, browser: { ...account.browser }, fingerprint: { ...account.fingerprint, languages: [...account.fingerprint.languages] } };
  }
  list(): Account[] { return this.persisted().map((account) => this.publicAccount(account)); }
  get(id: string): Account | undefined { const account = this.persisted().find((item) => item.id === id); return account ? this.publicAccount(account) : undefined; }

  create(raw: AccountInput): Account {
    const input = accountInputSchema.parse(raw);
    const accounts = this.persisted();
    const generated = createFingerprintProfile(input.platform);
    const fingerprint = input.fingerprint.seed ? input.fingerprint : { ...generated, enabled: input.fingerprint.enabled };
    const account: Account = accountSchema.parse({
      ...input, id: randomUUID().replaceAll('-', ''), createdAt: new Date().toISOString(), order: accounts.length,
      fingerprint,
      proxy: { ...input.proxy, password: protectPassword(input.proxy.password) }
    });
    this.store.write([...accounts, account]);
    return this.publicAccount(account);
  }

  batchCreate(raw: BatchCreateAccountsInput): Account[] {
    const input = batchCreateAccountsSchema.parse(raw);
    const accounts = this.persisted();
    const prefix = input.namePrefix?.trim() || "账号";
    const startNum = input.startNumber ?? 1;
    const createdAccounts: Account[] = [];
    for (let i = 0; i < input.count; i++) {
      const num = startNum + i;
      const padNum = num < 10 ? `0${num}` : `${num}`;
      const name = `${prefix} ${padNum}`;
      const fingerprint = createFingerprintProfile(input.platform);
      const rawProxy = input.proxy ?? { enabled: false, mode: "direct", type: "http", host: "", username: "", password: "", directScheme: "http", directAddressText: "", directAuthText: "", subscriptionUrl: "", subscriptionUserAgent: "sing-box", selectedNodeName: "", selectedNodeTag: "", subscriptionConfigJson: "", subscriptionNodes: [], lastRuntimeError: "" };
      const proxy = { ...rawProxy, password: protectPassword(rawProxy.password ?? "") };
      const browser = { homeUrl: input.platform === "custom" ? (input.customUrl ?? "") : "", lastUrl: "", zoomFactor: 1, restoreOnStart: true };
      const account: Account = accountSchema.parse({
        schemaVersion: 2,
        id: randomUUID().replaceAll("-", ""),
        name,
        platform: input.platform,
        group: input.group ?? "",
        remark: "",
        customUrl: input.platform === "custom" ? (input.customUrl ?? "") : "",
        order: accounts.length + i,
        createdAt: new Date().toISOString(),
        proxy,
        browser,
        fingerprint
      });
      createdAccounts.push(account);
    }
    this.store.write([...accounts, ...createdAccounts]);
    return createdAccounts.map((account) => this.publicAccount(account));
  }

  update(id: string, raw: Partial<AccountInput>): Account {
    const accounts = this.persisted();
    const index = accounts.findIndex((account) => account.id === id);
    if (index < 0) throw new Error('账号不存在');
    const current = this.publicAccount(accounts[index]!);
    const merged = accountInputSchema.parse({ ...current, ...raw, proxy: { ...current.proxy, ...(raw.proxy ?? {}) } });
    const fingerprint = raw.platform && raw.platform !== current.platform && !raw.fingerprint ? createFingerprintProfile(merged.platform) : merged.fingerprint.seed ? merged.fingerprint : createFingerprintProfile(merged.platform);
    const updated = accountSchema.parse({ ...accounts[index], ...merged, fingerprint, proxy: { ...merged.proxy, password: protectPassword(merged.proxy.password) } });
    accounts[index] = updated;
    this.store.write(accounts);
    return this.publicAccount(updated);
  }

  remove(id: string): void {
    const accounts = this.persisted();
    if (!accounts.some((account) => account.id === id)) throw new Error('账号不存在');
    this.store.write(accounts.filter((account) => account.id !== id).map((account, order) => ({ ...account, order })));
  }

  reorder(ids: string[]): Account[] {
    const accounts = this.persisted();
    if (new Set(ids).size !== accounts.length || accounts.some((account) => !ids.includes(account.id))) throw new Error('账号排序数据不完整');
    const byId = new Map(accounts.map((account) => [account.id, account]));
    this.store.write(ids.map((id, order) => ({ ...byId.get(id)!, order })));
    return this.list();
  }

  groups(): GroupSummary[] {
    const counts = new Map<string, number>();
    for (const account of this.persisted()) if (account.group) counts.set(account.group, (counts.get(account.group) ?? 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  renameGroup(from: string, to: string): Account[] {
    const source = from.trim(); const target = to.trim();
    if (!source) throw new Error('原分组不能为空');
    if (target.length > 80) throw new Error('分组名称过长');
    const accounts = this.persisted();
    if (!accounts.some((account) => account.group === source)) throw new Error('分组不存在');
    this.store.write(accounts.map((account) => account.group === source ? { ...account, group: target } : account));
    return this.list();
  }

  removeGroup(name: string): Account[] { return this.renameGroup(name, ''); }

  bulkUpdate(ids: string[], raw: Partial<AccountInput>): Account[] {
    const unique = [...new Set(ids)];
    if (!unique.length) throw new Error('请选择账号');
    const accounts = this.persisted();
    if (unique.some((id) => !accounts.some((account) => account.id === id))) throw new Error('包含不存在的账号');
    for (let index = 0; index < accounts.length; index++) {
      const stored = accounts[index]!; if (!unique.includes(stored.id)) continue;
      const current = this.publicAccount(stored);
      const merged = accountInputSchema.parse({ ...current, ...raw, proxy: { ...current.proxy, ...(raw.proxy ?? {}) } });
      accounts[index] = accountSchema.parse({ ...stored, ...merged, proxy: { ...merged.proxy, password: protectPassword(merged.proxy.password) } });
    }
    this.store.write(accounts); return this.list();
  }

  importMetadata(rows: unknown[]): number {
    const existing = this.persisted();
    let imported = 0;
    for (const [index, raw] of rows.entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const platform = legacyPlatform(row.platform ?? row.Platform ?? row.kind ?? row.Kind);
      const proxySource = row.proxy && typeof row.proxy === 'object' && !Array.isArray(row.proxy) ? row.proxy as Record<string, unknown> : {};
      // Exported metadata deliberately clears the proxy password.  If a user
      // imports an older encrypted value, do not persist that ciphertext as a
      // usable password; it belongs to the source profile/keychain.
      const proxyPassword = String(proxySource.password ?? proxySource.Password ?? '');
      const browserSource = row.browser && typeof row.browser === 'object' && !Array.isArray(row.browser) ? row.browser : undefined;
      const fingerprintSource = row.fingerprint && typeof row.fingerprint === 'object' && !Array.isArray(row.fingerprint) ? row.fingerprint : undefined;
      const candidate = accountInputSchema.safeParse({
        name: String(row.name ?? row.Name ?? `导入账号 ${index + 1}`), platform,
        group: String(row.group ?? row.Group ?? ''), remark: String(row.remark ?? row.Remark ?? ''),
        customUrl: platform === 'custom' ? String(row.customUrl ?? row.CustomUrl ?? row.url ?? row.Url ?? '') : String(row.customUrl ?? row.CustomUrl ?? ''),
        browser: browserSource ?? {
          homeUrl: String(row.homeUrl ?? row.HomeUrl ?? ''),
          lastUrl: String(row.lastUrl ?? row.LastUrl ?? ''),
          zoomFactor: Number(row.zoomFactor ?? 1),
          restoreOnStart: row.restoreOnStart !== false
        },
        fingerprint: fingerprintSource ?? undefined,
        proxy: { ...proxySource, password: proxyPassword.startsWith('enc:') ? '' : proxyPassword }
      });
      if (!candidate.success) continue;
      const fingerprint = candidate.data.fingerprint.seed ? candidate.data.fingerprint : { ...createFingerprintProfile(platform), enabled: candidate.data.fingerprint.enabled };
      existing.push(accountSchema.parse({ ...candidate.data, fingerprint, id: randomUUID().replaceAll('-', ''), createdAt: new Date().toISOString(), order: existing.length }));
      imported++;
    }
    this.store.write(existing);
    return imported;
  }
}
