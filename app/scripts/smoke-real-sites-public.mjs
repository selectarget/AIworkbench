import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const platforms = ['doubao', 'qianwen', 'dola', 'yunque', 'higgsfield', 'kimi', 'oiioii', 'nano', 'lovart', 'jimeng'];
const waitMsValue = Number(process.env.AIAM_REAL_E2E_WAIT_MS || 2500);
const waitMs = Number.isFinite(waitMsValue) ? Math.max(500, Math.min(30_000, Math.floor(waitMsValue))) : 2500;
const electronCli = resolve('node_modules/electron/cli.js');
const smokeScript = resolve('scripts/smoke-real-sites.mjs');

if (!existsSync(electronCli) || !existsSync(smokeScript)) throw new Error('缺少 Electron 或 smoke-real-sites.mjs，请先安装依赖');

function run(command, args, label) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    console.error(`${label} failed to start: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function runNpm(args, label) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmCli = process.env.npm_execpath;
  return npmCli
    ? run(process.execPath, [npmCli, ...args], label)
    : run(npmCommand, args, label);
}

if (runNpm(['run', 'build'], 'real-site public build') !== 0) process.exit(1);

const results = [];
for (const platform of platforms) {
  const startedAt = Date.now();
  console.log(`\n=== real-site public: ${platform} ===`);
  const status = run(process.execPath, [electronCli, smokeScript, '--', '--platform', platform, '--wait-ms', String(waitMs)], `real-site ${platform}`);
  results.push({ platform, status, seconds: ((Date.now() - startedAt) / 1000).toFixed(1) });
}

console.table(results);
const failed = results.filter((result) => result.status !== 0);
if (failed.length) {
  console.error(`real-site public smoke failed: ${failed.length}/${results.length}`);
  process.exitCode = 1;
} else {
  console.log(`real-site public smoke passed: ${results.length}/${results.length}; public-page checks only, no login/task/download permission is asserted.`);
}
