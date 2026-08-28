import { shell } from 'electron';
import { unzipSync } from 'fflate';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { z } from 'zod';
import { pluginSchema, type PluginRecord } from '../shared/contracts';
import { AtomicStore } from './atomic-store';

const pluginListSchema = z.array(pluginSchema);
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024;
const MAX_FILES = 5000;

type PluginManifest = {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  manifest_version?: unknown;
};

export class PluginService {
  private readonly rootDir: string;
  private readonly store: AtomicStore<PluginRecord[]>;
  private readonly listeners = new Set<() => void>();

  constructor(configDir: string) {
    this.rootDir = join(configDir, 'plugins');
    this.store = new AtomicStore(join(configDir, 'plugins.json'), pluginListSchema, []);
    mkdirSync(this.rootDir, { recursive: true });
  }

  list(): PluginRecord[] {
    return this.store.read().filter((plugin) => existsSync(join(plugin.path, 'manifest.json')));
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enabledPaths(): Array<{ id: string; path: string }> {
    return this.list().filter((plugin) => plugin.enabled).map((plugin) => ({ id: plugin.id, path: plugin.path }));
  }

  importDirectory(sourceDirectory: string): PluginRecord {
    const sourceRoot = resolveManifestRoot(sourceDirectory);
    const manifest = readManifest(sourceRoot);
    const id = randomUUID().replaceAll('-', '');
    const destination = join(this.rootDir, id);
    try {
      copyDirectory(sourceRoot, destination);
      const record = makeRecord(id, manifest, destination, 'directory');
      this.save([...this.list(), record]);
      return record;
    } catch (error) {
      rmSync(destination, { recursive: true, force: true });
      throw error;
    }
  }

  importPackage(packagePath: string): PluginRecord {
    const absolute = resolve(packagePath);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error('插件包不存在');
    const size = statSync(absolute).size;
    if (size <= 0 || size > MAX_PACKAGE_BYTES) throw new Error('插件包大小超出限制');
    const extension = extname(absolute).toLowerCase();
    if (!['.zip', '.crx'].includes(extension)) throw new Error('仅支持 ZIP 或 CRX 插件包');
    const bytes = new Uint8Array(readFileSync(absolute));
    const archive = extension === '.crx' ? extractCrxZip(bytes) : bytes;
    const files = unzipSync(archive);
    const entries = Object.entries(files);
    if (!entries.length || entries.length > MAX_FILES) throw new Error('插件包文件数量无效');
    const id = randomUUID().replaceAll('-', '');
    const destination = join(this.rootDir, id);
    mkdirSync(destination, { recursive: true });
    let unpackedBytes = 0;
    let flattenedPath: string | undefined;
    try {
      for (const [archiveName, content] of entries) {
        const safeName = safeArchivePath(archiveName);
        if (!safeName || safeName.endsWith('/')) continue;
        unpackedBytes += content.byteLength;
        if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error('解压后的插件超过大小限制');
        const output = join(destination, safeName);
        mkdirSync(join(output, '..'), { recursive: true });
        writeFileSync(output, Buffer.from(content));
      }
      const sourceRoot = resolveManifestRoot(destination);
      const manifest = readManifest(sourceRoot);
      if (sourceRoot !== destination) {
        flattenedPath = join(this.rootDir, `${id}-flat`);
        copyDirectory(sourceRoot, flattenedPath);
        rmSync(destination, { recursive: true, force: true });
        const record = makeRecord(id, manifest, flattenedPath, extension === '.crx' ? 'crx' : 'zip');
        this.save([...this.list(), record]);
        return record;
      }
      const record = makeRecord(id, manifest, destination, extension === '.crx' ? 'crx' : 'zip');
      this.save([...this.list(), record]);
      return record;
    } catch (error) {
      rmSync(destination, { recursive: true, force: true });
      if (flattenedPath) rmSync(flattenedPath, { recursive: true, force: true });
      throw error;
    }
  }

  setEnabled(id: string, enabled: boolean): PluginRecord[] {
    const plugins = this.store.read();
    if (!plugins.some((plugin) => plugin.id === id)) throw new Error('插件不存在');
    this.save(plugins.map((plugin) => plugin.id === id ? { ...plugin, enabled } : plugin));
    return this.list();
  }

  remove(id: string): void {
    const plugins = this.store.read();
    const target = plugins.find((plugin) => plugin.id === id);
    if (!target) throw new Error('插件不存在');
    if (!isPathInside(this.rootDir, target.path)) throw new Error('拒绝删除插件目录外的路径');
    rmSync(target.path, { recursive: true, force: true });
    this.save(plugins.filter((plugin) => plugin.id !== id));
  }

  async openFolder(): Promise<void> {
    const error = await shell.openPath(this.rootDir);
    if (error) throw new Error(error);
  }

  private save(value: PluginRecord[]): void {
    this.store.write(value);
    for (const listener of this.listeners) listener();
  }
}

function makeRecord(id: string, manifest: PluginManifest, path: string, source: PluginRecord['source']): PluginRecord {
  const manifestVersion = Number(manifest.manifest_version);
  if (![2, 3].includes(manifestVersion)) throw new Error('仅支持 Manifest V2/V3 插件');
  const name = String(manifest.name ?? '').trim();
  if (!name) throw new Error('插件 manifest 缺少 name');
  return pluginSchema.parse({
    id,
    name,
    version: String(manifest.version ?? '').trim(),
    description: String(manifest.description ?? '').trim(),
    manifestVersion,
    path: resolve(path),
    enabled: true,
    installedAt: new Date().toISOString(),
    source
  });
}

function readManifest(root: string): PluginManifest {
  const path = join(root, 'manifest.json');
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error('插件目录中未找到 manifest.json');
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); } catch { throw new Error('插件 manifest.json 不是有效 JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件 manifest.json 格式无效');
  return value as PluginManifest;
}

function resolveManifestRoot(input: string): string {
  const root = resolve(input);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('插件目录不存在');
  if (existsSync(join(root, 'manifest.json'))) return root;
  const children = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const candidates = children.map((entry) => join(root, entry.name)).filter((path) => existsSync(join(path, 'manifest.json')));
  if (candidates.length === 1) return candidates[0]!;
  throw new Error('插件目录中未找到唯一的 manifest.json');
}

function copyDirectory(source: string, destination: string): void {
  const sourcePath = resolve(source); const destinationPath = resolve(destination);
  if (sourcePath === destinationPath || isPathInside(sourcePath, destinationPath)) throw new Error('插件复制目标无效');
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error('插件目录不能包含符号链接');
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

function safeArchivePath(name: string): string {
  const normalized = name.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\u0000')) throw new Error('插件包包含非法路径');
  const directory = normalized.endsWith('/');
  const pathName = normalized.replace(/\/+$/, '');
  if (!pathName) throw new Error('插件包包含非法路径');
  const parts = pathName.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('插件包包含路径穿越');
  const output = normalize(parts.join('/'));
  if (isAbsolute(output) || output.startsWith('..')) throw new Error('插件包包含路径穿越');
  return `${output.replaceAll('\\', '/')}${directory ? '/' : ''}`;
}

function extractCrxZip(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < 12 || String.fromCharCode(...bytes.slice(0, 4)) !== 'Cr24') throw new Error('CRX 文件头无效');
  const version = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  let offset: number;
  if (version === 2) {
    if (bytes.byteLength < 16) throw new Error('CRX2 文件头不完整');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    offset = 16 + view.getUint32(8, true) + view.getUint32(12, true);
  } else if (version === 3) {
    const headerSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
    offset = 12 + headerSize;
  } else throw new Error('不支持的 CRX 版本');
  if (offset >= bytes.byteLength || bytes[offset] !== 0x50 || bytes[offset + 1] !== 0x4b) throw new Error('CRX 中未找到 ZIP 数据');
  return bytes.slice(offset);
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}
