import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd(), 'sing-box');
const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) throw new Error('用法：node scripts/validate-native-resources.mjs <platform> <arch> [<platform> <arch> ...]');
const manifestPath = join(root, 'native-resources.json');
let manifest = null;
if (existsSync(manifestPath)) {
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (error) { throw new Error(`原生资源清单无效：${error instanceof Error ? error.message : String(error)}`); }
}

const missing = [];
const invalid = [];
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
for (let index = 0; index < args.length; index += 2) {
  const platform = args[index];
  const arch = args[index + 1];
  const filename = platform === 'win32' ? 'sing-box.exe' : 'sing-box';
  const path = join(root, `${platform}-${arch}`, filename);
  if (!existsSync(path)) {
    missing.push(path);
    continue;
  }
  const stat = statSync(path);
  if (!stat.isFile() || stat.size < 1024 * 1024) invalid.push(`${path}（不是有效的 sing-box 可执行文件或文件过小）`);
  // Windows checkout/builds cannot preserve the POSIX executable bit. The
  // definitive permission check runs on the macOS build host after
  // prepare-native-resources.mjs has applied chmod 755.
  if (platform !== 'win32' && process.platform !== 'win32' && (stat.mode & 0o111) === 0) invalid.push(`${path}（缺少可执行权限）`);
  const key = `${platform}-${arch}`;
  const expected = manifest?.assets?.[key]?.binarySha256;
  if (expected && sha256(path) !== String(expected).toLowerCase()) invalid.push(`${path}（SHA-256 与 native-resources.json 不一致）`);
  const architectureError = checkArchitecture(path, platform, arch);
  if (architectureError) invalid.push(`${path}（${architectureError}）`);
}

if (missing.length || invalid.length) {
  console.error('缺少可发布的 sing-box 原生资源。请从官方 release 获取并校验对应架构后放入：');
  for (const path of missing) console.error(`  缺失：${path}`);
  for (const message of invalid) console.error(`  无效：${message}`);
  process.exit(1);
}
console.log(`native proxy resources ok: ${args.filter((_, index) => index % 2 === 0).join(', ')}`);

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
