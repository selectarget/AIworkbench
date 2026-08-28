import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCli = process.platform === 'win32'
  ? [
      process.env.npm_execpath,
      join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    ].find((candidate) => Boolean(candidate) && existsSync(candidate))
  : undefined;
const checks = [
  ['typecheck', ['run', 'typecheck']],
  ['legacy API surface', ['run', 'audit:legacy-surface']],
  ['unit tests', ['test', '--', '--run']],
  ['account isolation', ['run', 'smoke:isolation']],
  ['session restart persistence', ['run', 'smoke:session-restart']],
  ['document script timing', ['run', 'smoke:document-scripts']],
  ['fingerprint runtime', ['run', 'smoke:fingerprint']],
  ['platform page adapters', ['run', 'smoke:platform-pages']],
  ['site adapter runtime fixtures', ['run', 'smoke:site-adapters']],
  ['task workflow runtime fixtures', ['run', 'smoke:task-workflows']],
  ['storage import', ['run', 'smoke:storage-import']],
  ['batch workspace', ['run', 'smoke:batch-workspace']],
  ['video notice', ['run', 'smoke:video-notice']],
  ['proxy runtime', ['run', 'smoke:proxy-runtime']],
  ['face grid', ['run', 'smoke:face-grid']],
  ['GUI renderer preview', ['run', 'smoke:gui']],
  ['public site entrypoints', ['run', 'smoke:public-sites']]
];

for (const [label, args] of checks) {
  process.stdout.write(`\n=== ${label} ===\n`);
  // When this script is launched by npm, invoke npm's JS CLI through the
  // current Node executable. This avoids the npm.cmd shell shim and keeps
  // arguments unambiguous on Windows as well as POSIX.
  const command = npmCli ? process.execPath : npm;
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  // `npm.cmd` is a shell shim on Windows. Node's direct spawn path can
  // otherwise return EINVAL when this script is launched as
  // `node scripts/smoke-all.mjs` instead of through `npm run`. The normal
  // Windows installation has a local npm CLI next to node; use the shell only
  // when that CLI cannot be located.
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: process.env,
    shell: !npmCli && process.platform === 'win32'
  });
  if (result.error) {
    console.error(`${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nAll local checks passed.');
