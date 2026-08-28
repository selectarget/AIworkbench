import { app } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export type DataPaths = {
  root: string; config: string; sessions: string; logs: string; downloads: string; updates: string;
};

export type DataPathOptions = {
  packaged: boolean;
  platform: NodeJS.Platform;
  cwd: string;
  executableDirectory: string;
  appDataDirectory: string;
  portableDirectory?: string;
};

export type ProfileLocationInfo = {
  /** The configured Session root. It becomes active after the next restart. */
  path: string;
  /** The Session root used by the current process. */
  activePath: string;
  defaultPath: string;
  custom: boolean;
  restartRequired: boolean;
};

type ResolvedProfileLocation = Omit<ProfileLocationInfo, 'activePath' | 'restartRequired'> & { pointerFile: string };

export function resolveRuntimeDataOptions(): DataPathOptions {
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
  return {
    packaged: app.isPackaged,
    platform: process.platform,
    cwd: process.cwd(),
    executableDirectory: dirname(process.execPath),
    appDataDirectory: app.getPath('appData'),
    portableDirectory: process.platform === 'win32' ? portableDirectory : undefined
  };
}

export function resolveDataBase(options: DataPathOptions): string {
  if (!options.packaged) return options.cwd;
  if (options.platform === 'win32') {
    // A portable build exposes PORTABLE_EXECUTABLE_DIR and can safely keep
    // data beside the executable. An installed build may live under
    // Program Files, so never make the executable directory the implicit
    // writable data root.
    return options.portableDirectory?.trim() || join(options.appDataDirectory, 'AI创作工作台');
  }
  // A macOS app bundle is normally installed under /Applications and is not
  // writable by the application. Keep user data outside the bundle so updates
  // do not erase profiles and the app works without elevated permissions.
  return join(options.appDataDirectory, 'AI创作工作台');
}

function defaultDataRoot(options: DataPathOptions): string {
  return resolve(join(resolveDataBase(options), options.packaged ? 'data' : 'data-dev'));
}

function profileLocationPointer(options: DataPathOptions): string {
  return join(defaultDataRoot(options), 'config', 'profile-location.json');
}

export function normalizeProfileLocation(value: string, platform: NodeJS.Platform): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('浏览器数据目录不能为空');
  const normalized = resolve(trimmed);
  // A signed/notarized macOS app bundle is read-only in normal installs. More
  // importantly, placing Chromium data inside the bundle would be lost on an
  // update and can make Gatekeeper reject the modified bundle.
  if (platform === 'darwin' && /(?:^|[\\/])[^\\/]+\.app(?:[\\/]|$)/i.test(normalized)) {
    throw new Error('浏览器数据目录不能位于 macOS 应用包内');
  }
  return normalized;
}

function readConfiguredProfileLocation(pointerFile: string, platform: NodeJS.Platform): string | undefined {
  if (!existsSync(pointerFile)) return undefined;
  try {
    const value = JSON.parse(readFileSync(pointerFile, 'utf8')) as { path?: unknown };
    if (typeof value.path !== 'string' || !value.path.trim()) return undefined;
    return normalizeProfileLocation(value.path, platform);
  } catch {
    return undefined;
  }
}

export function resolveProfileLocation(options: DataPathOptions): ResolvedProfileLocation {
  const defaultPath = join(defaultDataRoot(options), 'sessions');
  const pointerFile = profileLocationPointer(options);
  const configured = readConfiguredProfileLocation(pointerFile, options.platform);
  const path = configured ?? defaultPath;
  return { path, defaultPath, custom: path !== defaultPath, pointerFile };
}

export function resolveDataPaths(options = resolveRuntimeDataOptions(), profileRoot?: string): DataPaths {
  const root = defaultDataRoot(options);
  const sessions = profileRoot?.trim() ? resolve(profileRoot) : resolveProfileLocation(options).path;
  return {
    root,
    config: join(root, 'config'),
    sessions,
    logs: join(root, 'logs'),
    downloads: join(root, 'downloads'),
    updates: join(root, 'updates')
  };
}

function writeProfileLocation(pointerFile: string, path: string): void {
  mkdirSync(dirname(pointerFile), { recursive: true });
  const temporary = `${pointerFile}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, path }, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
    renameSync(temporary, pointerFile);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function removeProfileLocation(pointerFile: string): void {
  if (existsSync(pointerFile)) unlinkSync(pointerFile);
}

export function assertWritableDirectory(directory: string, label = '目录'): void {
  mkdirSync(directory, { recursive: true });
  const probe = join(directory, `.write-probe-${process.pid}-${Date.now()}`);
  let created = false;
  try {
    const fd = openSync(probe, 'wx');
    created = true;
    closeSync(fd);
  } catch (error) {
    throw new Error(`${label}不可写：${directory}\n${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (created && existsSync(probe)) unlinkSync(probe);
  }
}

export class ProfileLocationService {
  private readonly defaultPath: string;
  private readonly pointerFile: string;
  private readonly activePath: string;
  private pendingPath: string | null = null;

  constructor(private readonly options: DataPathOptions) {
    const resolved = resolveProfileLocation(options);
    this.defaultPath = resolved.defaultPath;
    this.pointerFile = resolved.pointerFile;
    this.activePath = resolved.path;
    assertWritableDirectory(this.activePath, '浏览器数据目录');
  }

  get(): ProfileLocationInfo {
    const path = this.pendingPath ?? this.activePath;
    return {
      path,
      activePath: this.activePath,
      defaultPath: this.defaultPath,
      custom: path !== this.defaultPath,
      restartRequired: path !== this.activePath
    };
  }

  select(value: string): ProfileLocationInfo {
    const path = normalizeProfileLocation(value, this.options.platform);
    assertWritableDirectory(path, '浏览器数据目录');
    if (path === this.defaultPath) removeProfileLocation(this.pointerFile);
    else writeProfileLocation(this.pointerFile, path);
    this.pendingPath = path === this.activePath ? null : path;
    return this.get();
  }

  reset(): ProfileLocationInfo {
    removeProfileLocation(this.pointerFile);
    this.pendingPath = this.defaultPath === this.activePath ? null : this.defaultPath;
    assertWritableDirectory(this.defaultPath, '默认浏览器数据目录');
    return this.get();
  }
}

export function prepareDataPaths(paths: DataPaths): void {
  try {
    for (const path of Object.values(paths)) mkdirSync(path, { recursive: true });
    assertWritableDirectory(paths.root, '便携数据目录');
  } catch (error) {
    throw new Error(`便携数据目录不可写：${paths.root}\n${error instanceof Error ? error.message : String(error)}`);
  }
}
