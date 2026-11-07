import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const releaseDir = 'release';
const expected = `AI创作工作台-${version}-win-x64-portable.exe`;
const available = readdirSync(releaseDir).filter((name) => name.endsWith('-win-x64-portable.exe'));
const artifact = available.includes(expected) ? expected : available[0];

if (!artifact) {
  console.error(`未找到 Windows portable 产物，请先执行 npm run dist:win（目录：${join(process.cwd(), releaseDir)}）`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['scripts/smoke-packaged.mjs', join(releaseDir, artifact), 'win32', 'x64', '6'],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
