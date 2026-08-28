import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SUPPORTED_ARCHES = new Set(['x64', 'arm64']);
const MACH_CPU_TYPES = new Map([
  [0x01000007, 'x64'],
  [0x0100000c, 'arm64'],
  [0x00000007, 'ia32'],
  [0x0000000c, 'arm']
]);

/**
 * Return the CPU architectures present in a thin or fat Mach-O binary.
 * This is deliberately independent of the host `file`/`lipo` commands so
 * the same validation logic can also be exercised from unit tests.
 */
export function machOArchitectures(bytes) {
  if (bytes.length < 8) return [];

  const magicBigEndian = bytes.readUInt32BE(0);
  const fatLittleEndian = magicBigEndian === 0xbebafeca || magicBigEndian === 0xbfbafeca;
  const fatBigEndian = magicBigEndian === 0xcafebabe || magicBigEndian === 0xcafebabf;
  if (fatLittleEndian || fatBigEndian) {
    const read = fatLittleEndian ? (offset) => bytes.readUInt32LE(offset) : (offset) => bytes.readUInt32BE(offset);
    const isFat64 = magicBigEndian === 0xbfbafeca || magicBigEndian === 0xcafebabf;
    const entrySize = isFat64 ? 32 : 20;
    const count = read(4);
    if (count > Math.floor((bytes.length - 8) / entrySize)) return [];
    const architectures = [];
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * entrySize;
      if (offset + 4 > bytes.length) return [];
      const cpu = read(offset);
      architectures.push(MACH_CPU_TYPES.get(cpu) ?? `cpu-0x${cpu.toString(16)}`);
    }
    return [...new Set(architectures)];
  }

  const magicLittleEndian = bytes.readUInt32LE(0);
  const magic = magicLittleEndian === 0xfeedfacf || magicLittleEndian === 0xfeedface
    ? 'little'
    : magicBigEndian === 0xfeedfacf || magicBigEndian === 0xfeedface
      ? 'big'
      : null;
  if (!magic) return [];
  const cpu = magic === 'little' ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4);
  return [MACH_CPU_TYPES.get(cpu) ?? `cpu-0x${cpu.toString(16)}`];
}

export function machOArchitectureError(path, targetArch) {
  const architectures = machOArchitectures(readFileSync(path));
  if (architectures.length === 0) return '不是可识别的 Mach-O 文件';
  if (!architectures.includes(targetArch)) {
    return `Mach-O 架构不匹配（实际=${architectures.join(',')}，目标=${targetArch}）`;
  }
  return null;
}

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`${label}缺失：${path}`);
}

function assertFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label}缺失：${path}`);
}

function assertExecutable(path, label) {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new Error(`${label}缺少 macOS 执行权限：${path}`);
  }
}

function readInfoPlist(path) {
  let json;
  try {
    json = execFileSync('plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`Info.plist 无法由 plutil 读取：${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new Error(`Info.plist JSON 无效：${error instanceof Error ? error.message : String(error)}`);
  }
}

function findApp(root) {
  if (basename(root).toLowerCase().endsWith('.app')) return root;
  const candidates = [];
  const visit = (directory, depth) => {
    if (depth > 3) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      if (entry.isDirectory() && entry.name.toLowerCase().endsWith('.app')) {
        candidates.push(child);
      } else if (entry.isDirectory()) {
        visit(child, depth + 1);
      }
    }
  };
  visit(root, 0);
  if (candidates.length !== 1) {
    throw new Error(`无法从目录中唯一定位 macOS .app（找到 ${candidates.length} 个）：${root}`);
  }
  return candidates[0];
}

function verifyMacApp(appPath, targetArch, { requireSigned = false } = {}) {
  const appRoot = resolve(appPath);
  assertDirectory(appRoot, 'macOS 应用包');
  assertDirectory(join(appRoot, 'Contents'), 'Contents');
  assertDirectory(join(appRoot, 'Contents', 'MacOS'), 'Contents/MacOS');
  assertDirectory(join(appRoot, 'Contents', 'Resources'), 'Contents/Resources');
  assertDirectory(join(appRoot, 'Contents', 'Frameworks'), 'Contents/Frameworks');

  const infoPlistPath = join(appRoot, 'Contents', 'Info.plist');
  assertFile(infoPlistPath, 'Info.plist');
  const info = readInfoPlist(infoPlistPath);
  const executableName = typeof info.CFBundleExecutable === 'string' ? info.CFBundleExecutable : '';
  if (!executableName || /[\\/]/.test(executableName)) throw new Error('Info.plist 的 CFBundleExecutable 无效');
  if (info.CFBundlePackageType !== 'APPL') throw new Error(`Info.plist 的 CFBundlePackageType 不是 APPL：${String(info.CFBundlePackageType)}`);
  if (info.CFBundleIdentifier !== 'com.aicreation.workbench') throw new Error(`Bundle identifier 不匹配：${String(info.CFBundleIdentifier)}`);

  const executable = join(appRoot, 'Contents', 'MacOS', executableName);
  assertFile(executable, '应用主可执行文件');
  assertExecutable(executable, '应用主可执行文件');
  const executableArchitectureError = machOArchitectureError(executable, targetArch);
  if (executableArchitectureError) throw new Error(`应用主可执行文件校验失败：${executableArchitectureError}`);

  const iconName = typeof info.CFBundleIconFile === 'string' && info.CFBundleIconFile ? info.CFBundleIconFile : 'app.icns';
  const iconPath = join(appRoot, 'Contents', 'Resources', iconName.endsWith('.icns') ? iconName : `${iconName}.icns`);
  assertFile(iconPath, 'macOS 图标');

  const resources = join(appRoot, 'Contents', 'Resources');
  const asarPath = join(resources, 'app.asar');
  assertFile(asarPath, 'app.asar');
  for (const name of ['site-assets', 'sing-box', 'media-tools', 'face-grid-assets']) {
    assertDirectory(join(resources, name), `Resources/${name}`);
  }
  assertFile(join(resources, 'media-tools', 'README.md'), '媒体工具说明');

  const nativeRoot = join(resources, 'sing-box');
  const nativeManifestPath = join(nativeRoot, 'native-resources.json');
  assertFile(nativeManifestPath, 'sing-box 原生资源清单');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(nativeManifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`sing-box 原生资源清单无效：${error instanceof Error ? error.message : String(error)}`);
  }
  const nativeKey = `darwin-${targetArch}`;
  const nativeEntry = manifest?.assets?.[nativeKey];
  if (!nativeEntry || typeof nativeEntry.binary !== 'string' || typeof nativeEntry.binarySha256 !== 'string') {
    throw new Error(`原生资源清单缺少 ${nativeKey}`);
  }
  const nativePath = join(nativeRoot, ...nativeEntry.binary.split(/[\\/]+/));
  assertFile(nativePath, `${nativeKey} sing-box`);
  if (statSync(nativePath).size < 1024 * 1024) throw new Error(`${nativeKey} sing-box 文件过小：${nativePath}`);
  assertExecutable(nativePath, `${nativeKey} sing-box`);
  if (sha256(nativePath) !== nativeEntry.binarySha256.toLowerCase()) throw new Error(`${nativeKey} sing-box SHA-256 不一致`);
  const nativeArchitectureError = machOArchitectureError(nativePath, targetArch);
  if (nativeArchitectureError) throw new Error(`${nativeKey} sing-box 校验失败：${nativeArchitectureError}`);

  const ffmpegPath = join(resources, 'media-tools', nativeKey, 'ffmpeg');
  assertFile(ffmpegPath, `${nativeKey} FFmpeg`);
  const minimumFfmpegBytes = targetArch === 'x64' ? 70 * 1024 * 1024 : 40 * 1024 * 1024;
  if (statSync(ffmpegPath).size < minimumFfmpegBytes) throw new Error(`${nativeKey} FFmpeg 文件过小：${ffmpegPath}`);
  assertExecutable(ffmpegPath, `${nativeKey} FFmpeg`);
  const ffmpegArchitectureError = machOArchitectureError(ffmpegPath, targetArch);
  if (ffmpegArchitectureError) throw new Error(`${nativeKey} FFmpeg 校验失败：${ffmpegArchitectureError}`);

  if (requireSigned) {
    try {
      execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appRoot], { stdio: 'pipe' });
      execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=4', appRoot], { stdio: 'pipe' });
    } catch (error) {
      throw new Error(`macOS 签名或 Gatekeeper 校验失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    appPath: appRoot,
    executable: executableName,
    bundleIdentifier: info.CFBundleIdentifier,
    version: info.CFBundleShortVersionString ?? info.CFBundleVersion ?? 'unknown',
    arch: targetArch,
    signed: requireSigned
  };
}

function withMountedDmg(dmgPath, callback) {
  if (process.platform !== 'darwin') throw new Error('DMG 验证必须在 macOS 主机执行');
  const mountPoint = mkdtempSync(join(tmpdir(), 'ai-workbench-dmg-'));
  try {
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, resolve(dmgPath)], { stdio: 'pipe' });
    return callback(findApp(mountPoint));
  } finally {
    try { execFileSync('hdiutil', ['detach', mountPoint, '-quiet'], { stdio: 'ignore' }); } catch { /* cleanup is best effort */ }
    rmSync(mountPoint, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const input = args[0];
  const targetArch = args[1] || process.arch;
  let dmgPath = '';
  let requireSigned = false;
  for (let index = 2; index < args.length; index += 1) {
    if (args[index] === '--dmg') {
      dmgPath = args[index + 1] || '';
      index += 1;
    } else if (args[index] === '--signed') {
      requireSigned = true;
    } else {
      throw new Error(`未知参数：${args[index]}`);
    }
  }
  if (!input) throw new Error('用法：node scripts/verify-macos-release.mjs <.app 或发布目录> [x64|arm64] [--dmg <文件>] [--signed]');
  if (!SUPPORTED_ARCHES.has(targetArch)) throw new Error(`不支持的 macOS 架构：${targetArch}`);
  return { input: resolve(input), targetArch, dmgPath: dmgPath ? resolve(dmgPath) : '', requireSigned };
}

export function runVerification({ input, targetArch, dmgPath = '', requireSigned = false }) {
  if (process.platform !== 'darwin') throw new Error('macOS 产物验证必须在 macOS 主机执行；Windows 只能做静态资源/架构审计');
  if (!existsSync(input)) throw new Error(`验证目标不存在：${input}`);
  const appReport = extname(input).toLowerCase() === '.dmg'
    ? withMountedDmg(input, (mountPoint) => verifyMacApp(findApp(mountPoint), targetArch, { requireSigned }))
    : verifyMacApp(findApp(input), targetArch, { requireSigned });
  let dmgReport;
  if (dmgPath) {
    assertFile(dmgPath, 'DMG');
    dmgReport = withMountedDmg(dmgPath, (mountPoint) => verifyMacApp(findApp(mountPoint), targetArch, { requireSigned }));
  }
  return { app: appReport, dmg: dmgReport };
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = runVerification(options);
    const dmgSuffix = report.dmg ? `, DMG ${basename(options.dmgPath)}` : '';
    console.log(`macOS release verification passed: ${basename(report.app.appPath)} darwin-${options.targetArch}${dmgSuffix}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
