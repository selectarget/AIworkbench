import { createHash, sign } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
const assetPath = process.argv[2];
if (!assetPath) throw new Error('用法: node scripts/generate-update-manifest.mjs <发布包>');
const privateKey = process.env.UPDATE_PRIVATE_KEY?.replaceAll('\\n', '\n');
if (!privateKey) throw new Error('缺少 UPDATE_PRIVATE_KEY');
const bytes = readFileSync(assetPath); const sha256 = createHash('sha256').update(bytes).digest('hex');
const version = process.env.npm_package_version || JSON.parse(readFileSync('package.json', 'utf8')).version;
const asset = basename(assetPath);
const target = process.env.UPDATE_TARGET?.trim() || inferTarget(asset);
if (target && !/^(?:win32-x64|darwin-x64|darwin-arm64)$/.test(target)) throw new Error('UPDATE_TARGET 必须是 win32-x64、darwin-x64 或 darwin-arm64');
const payload = target ? `${version}\n${target}\n${asset}\n${sha256}` : `${version}\n${asset}\n${sha256}`;
const manifest = target ? { version, target, asset, sha256, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') } : { version, asset, sha256, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') };
const output = join(dirname(assetPath), target ? `update-manifest-${target}.json` : 'update-manifest.json'); writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`); console.log(output);

function inferTarget(name) {
  const value = name.toLowerCase();
  if (/(?:^|[-_.])(?:win|windows|win32)(?:[-_.]|$)/.test(value) && /(?:^|[-_.])(?:x64|amd64|win64)(?:[-_.]|$)/.test(value)) return 'win32-x64';
  if (/(?:^|[-_.])(?:mac|macos|darwin|osx)(?:[-_.]|$)/.test(value) && /(?:^|[-_.])(?:x64|amd64|intel)(?:[-_.]|$)/.test(value)) return 'darwin-x64';
  if (/(?:^|[-_.])(?:mac|macos|darwin|osx)(?:[-_.]|$)/.test(value) && /(?:^|[-_.])(?:arm64|aarch64)(?:[-_.]|$)/.test(value)) return 'darwin-arm64';
  return '';
}
