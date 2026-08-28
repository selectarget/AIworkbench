import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) {
  throw new Error('用法：node scripts/prepare-media-resources.mjs <platform> <arch> [<platform> <arch> ...]');
}

const resources = {
  'win32-x64': {
    binary: 'media-tools/win32-x64/ffmpeg.exe',
    minimumBytes: 90 * 1024 * 1024,
    sha256: '228d7a8556258de907fdb55f36850078ebc7680b84ec30d84ea02e99bec1d1eb',
    executable: 'ffmpeg.exe'
  },
  'darwin-x64': {
    binary: 'media-tools/darwin-x64/ffmpeg',
    minimumBytes: 70 * 1024 * 1024,
    sha256: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
    executable: 'ffmpeg',
    download: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-x64.gz'
  },
  'darwin-arm64': {
    binary: 'media-tools/darwin-arm64/ffmpeg',
    minimumBytes: 40 * 1024 * 1024,
    sha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
    executable: 'ffmpeg',
    download: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz'
  }
};

const root = resolve(process.cwd());
const requested = [];
for (let index = 0; index < args.length; index += 2) {
  const key = `${args[index]}-${args[index + 1]}`;
  if (!resources[key]) throw new Error(`不支持的媒体工具目标：${key}`);
  requested.push(key);
}

for (const key of requested) await ensureResource(key);
console.log(`native media resources ok: ${requested.join(', ')}`);

async function ensureResource(key) {
  const item = resources[key];
  const destination = join(root, item.binary);
  if (isValid(destination, item)) return;
  if (!item.download) {
    throw new Error(`缺少可发布的 FFmpeg：${destination}；请放入匹配平台的静态可执行文件`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  const response = await fetch(item.download, { signal: AbortSignal.timeout(10 * 60 * 1000), redirect: 'follow' });
  if (!response.ok) throw new Error(`FFmpeg 下载失败：HTTP ${response.status} ${item.download}`);
  const compressed = Buffer.from(await response.arrayBuffer());
  const temporary = `${destination}.download-${process.pid}`;
  try {
    writeFileSync(temporary, gunzipSync(compressed), { mode: 0o755 });
    chmodSync(temporary, 0o755);
    if (!isValid(temporary, item)) throw new Error(`下载的 FFmpeg 校验失败：${key}`);
    rmSync(destination, { force: true });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function isValid(path, item) {
  if (!existsSync(path)) return false;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size < item.minimumBytes) return false;
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (hash !== item.sha256) return false;
  return architectureMatches(path, item.executable);
}

function architectureMatches(path, executable) {
  const bytes = readFileSync(path);
  if (executable === 'ffmpeg.exe') {
    if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return false;
    const peOffset = bytes.readUInt32LE(0x3c);
    return peOffset + 6 <= bytes.length && bytes.toString('ascii', peOffset, peOffset + 4) === 'PE\0\0' && bytes.readUInt16LE(peOffset + 4) === 0x8664;
  }
  if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf) return false;
  return bytes.readUInt32LE(4) === (path.includes('darwin-arm64') ? 0x0100000c : 0x01000007);
}
