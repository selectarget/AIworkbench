import { chmodSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd(), 'sing-box');
const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) throw new Error('用法：node scripts/prepare-native-resources.mjs <platform> <arch> [<platform> <arch> ...]');

for (let index = 0; index < args.length; index += 2) {
  const platform = args[index];
  const arch = args[index + 1];
  const file = join(root, `${platform}-${arch}`, platform === 'win32' ? 'sing-box.exe' : 'sing-box');
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`缺少原生资源：${file}`);
  if (platform !== 'win32' && process.platform !== 'win32') chmodSync(file, 0o755);
}

console.log(`native proxy permissions prepared: ${args.filter((_, index) => index % 2 === 0).join(', ')}`);
