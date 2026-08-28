import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const root = process.argv[2] || 'release/win-unpacked';
const auditPlatform = process.argv[3] || process.platform;
const auditArch = process.argv[4] || process.arch;
// Windows directory packages expose resources directly below the package
// root, while a macOS .app keeps the same files below Contents/Resources.
// Keep one audit path so the same checks can run on both package layouts.
const packageResources = existsSync(join(root, 'Contents', 'Resources'))
  ? join(root, 'Contents', 'Resources')
  : join(root, 'resources');
const archive = join(packageResources, 'app.asar');
const files = asar.listPackage(archive);
const forbiddenPath = /(electron-user-data|indexeddb|local storage|session storage|network[\\/]cookies|src[\\/]data|paojiao)/i;
const badPaths = files.filter((file) => forbiddenPath.test(file));
const bytes = readFileSync(archive);
const forbiddenStrings = ['api.paojiaoyun.com', 'license-activate', 'OFFICIAL_LICENSE_API_BASE_URL', 'AIAccountManager/license.json'];
const badStrings = forbiddenStrings.filter((value) => bytes.includes(Buffer.from(value)));
const preloadEntries = files.filter((file) => /[\\/]out[\\/]preload[\\/]/i.test(file));
const badPreloadChunks = preloadEntries.filter((file) => /[\\/]chunks[\\/]/i.test(file));
const preloadSources = [join('out', 'preload', 'index.js'), join('out', 'preload', 'remote.js')].map((file) => asar.extractFile(archive, file).toString('utf8'));
const splitPreloadRequires = preloadSources.filter((source) => /require\(["']\.\/[^"]+["']\)/.test(source));
const assets = join(packageResources, 'site-assets');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const assetFiles = existsSync(assets) ? walk(assets) : [];
const badAssets = assetFiles.filter((file) => /[\\/]tests?[\\/]/i.test(file));
const mediaRoot = join(packageResources, 'media-tools');
const faceGridRoot = join(packageResources, 'face-grid-assets');
const resourceErrors = [];
if (!existsSync(assets)) resourceErrors.push('resources/site-assets 缺失');
const requiredFaceAssets = [
  ['deploy.prototxt', 20_000],
  ['res10_300x300_ssd_iter_140000.caffemodel', 10_000_000],
  ['licenses/opencv-js-Apache-2.0.txt', 1_000]
];
for (const [relativePath, minimumSize] of requiredFaceAssets) {
  const file = join(faceGridRoot, relativePath);
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size < minimumSize) resourceErrors.push(`resources/face-grid-assets/${relativePath} 缺失或文件过小`);
}
const packagedFfmpeg = join(mediaRoot, auditPlatform === 'win32' ? `${auditPlatform}-${auditArch}/ffmpeg.exe` : `${auditPlatform}-${auditArch}/ffmpeg`);
const minimumFfmpegBytes = auditPlatform === 'win32' ? 90_000_000 : 40_000_000;
if (!existsSync(packagedFfmpeg) || statSync(packagedFfmpeg).size < minimumFfmpegBytes) resourceErrors.push(`resources/media-tools/${auditPlatform}-${auditArch}/ffmpeg${auditPlatform === 'win32' ? '.exe' : ''} 缺失或文件过小`);
else {
  const architectureError = checkArchitecture(packagedFfmpeg, auditPlatform, auditArch);
  if (architectureError) resourceErrors.push(`resources/media-tools/${auditPlatform}-${auditArch}/ffmpeg（${architectureError}）`);
}
if (!existsSync(join(mediaRoot, 'README.md'))) resourceErrors.push('resources/media-tools/README.md 缺失');
const nativeRoot = join(packageResources, 'sing-box');
const nativeErrors = [];
const nativeManifestPath = join(nativeRoot, 'native-resources.json');
if (!existsSync(nativeManifestPath)) nativeErrors.push('resources/sing-box/native-resources.json 缺失');
else {
  try {
    const manifest = JSON.parse(readFileSync(nativeManifestPath, 'utf8'));
    for (const [key, entry] of Object.entries(manifest.assets ?? {})) {
      const nativePath = join(nativeRoot, ...String(entry.binary).split(/[\\/]+/));
      if (!existsSync(nativePath) || !statSync(nativePath).isFile()) { nativeErrors.push(`${key} 原生核心缺失`); continue; }
      const hash = createHash('sha256').update(readFileSync(nativePath)).digest('hex');
      if (hash !== String(entry.binarySha256).toLowerCase()) nativeErrors.push(`${key} 原生核心 SHA-256 不一致`);
      const [platform, arch] = String(key).split('-');
      const architectureError = checkArchitecture(nativePath, platform, arch);
      if (architectureError) nativeErrors.push(`${key} 原生核心（${architectureError}）`);
    }
  } catch (error) { nativeErrors.push(`原生资源清单无效：${error instanceof Error ? error.message : String(error)}`); }
}
if (badPaths.length || badStrings.length || badAssets.length || badPreloadChunks.length || splitPreloadRequires.length || nativeErrors.length || resourceErrors.length) {
  console.error(JSON.stringify({ badPaths, badStrings, badAssets, badPreloadChunks, splitPreloadRequires: splitPreloadRequires.length, nativeErrors, resourceErrors }, null, 2)); process.exit(1);
}
console.log(`package audit passed: ${files.length} asar entries, ${assetFiles.length} site assets, ${Object.keys(JSON.parse(readFileSync(nativeManifestPath, 'utf8')).assets ?? {}).length} native cores`);

function checkArchitecture(path, platform, arch) {
  const bytes = readFileSync(path);
  if (platform === 'win32') {
    if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return '不是 PE 文件';
    const peOffset = bytes.readUInt32LE(0x3c);
    if (peOffset + 6 > bytes.length || bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') return 'PE 头无效';
    const machine = bytes.readUInt16LE(peOffset + 4);
    const expected = { x64: 0x8664, arm64: 0xaa64, ia32: 0x014c }[arch];
    if (expected === undefined || machine !== expected) return `PE 架构不匹配（machine=0x${machine.toString(16)}，目标=${arch}）`;
    return null;
  }
  if (platform === 'darwin') {
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf) return '不是 64 位 little-endian Mach-O 文件';
    const cpuType = bytes.readUInt32LE(4);
    const expected = { x64: 0x01000007, arm64: 0x0100000c }[arch];
    if (expected === undefined || cpuType !== expected) return `Mach-O 架构不匹配（cputype=0x${cpuType.toString(16)}，目标=${arch}）`;
  }
  return null;
}
