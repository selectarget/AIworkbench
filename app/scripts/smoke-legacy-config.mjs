import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { app } from 'electron';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
  console.error(`legacy config smoke failed: ${message}`);
  process.exit(1);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const source = option('--source') || process.env.AIAM_LEGACY_CONFIG_PATH;
if (!source) fail('请通过 --source <V4.4 config.json> 或 AIAM_LEGACY_CONFIG_PATH 指定只读配置');

const sourcePath = resolve(source);
if (!existsSync(sourcePath)) fail(`配置不存在: ${sourcePath}`);
const sourceHashBefore = sha256(sourcePath);

const { LegacyMigrationService } = await import('../out/main/migration.js');
const fallbackSettings = {
  bossKey: { key: 'H', ctrl: true, alt: true, shift: false, meta: false, enabled: false },
  dolaAspectRatio: '16:9'
};
const fakeAccounts = { list: () => [] };
const service = new LegacyMigrationService(null, fakeAccounts, resolve('legacy-smoke-accounts.json'), undefined, { get: () => fallbackSettings });
const preview = service.previewSource(sourcePath);

const platformCounts = new Map();
for (const account of preview.accounts) platformCounts.set(account.platform, (platformCounts.get(account.platform) || 0) + 1);
const expectedPlatforms = { doubao: 4, dola: 2 };
for (const [platform, count] of Object.entries(expectedPlatforms)) {
  if (platformCounts.get(platform) !== count) fail(`平台映射 ${platform}=${platformCounts.get(platform) || 0}，期望 ${count}`);
}
if (preview.accountCount !== 6) fail(`账号数量 ${preview.accountCount}，期望 6`);
if (preview.fingerprintCount !== 6) fail(`指纹匹配数量 ${preview.fingerprintCount}，期望 6`);
if (preview.proxyProfileCount !== 2) fail(`区域代理配置数量 ${preview.proxyProfileCount}，期望 2`);
if (!preview.settings.hasProfileRoot) fail('未识别 ProfileRoot');
if (!preview.settings.hasDownloadDir) fail('未识别 VideoDownloadRoot');
if (!preview.settings.hasBossKey) fail('未识别 BossKey');

let sandboxImport;
if (process.argv.includes('--sandbox-import')) {
  const sandboxRoot = mkdtempSync(join(tmpdir(), 'aiam-legacy-import-'));
  try {
    const importedAccounts = [];
    let settingsPatch = null;
    const importService = new LegacyMigrationService(
      null,
      { list: () => [], create: (account) => { importedAccounts.push(account); } },
      join(sandboxRoot, 'accounts.json'),
      undefined,
      { get: () => fallbackSettings, update: (patch) => { settingsPatch = patch; } }
    );
    importService.sourcePath = sourcePath;
    const report = await importService.import();
    if (!report || report.imported !== 6 || report.skipped !== 0) fail(`沙盒导入结果 imported=${report?.imported ?? 'null'} skipped=${report?.skipped ?? 'null'}`);
    if (importedAccounts.length !== 6) fail(`沙盒账号创建数量 ${importedAccounts.length}，期望 6`);
    if (!settingsPatch?.migrationCompleted) fail('沙盒导入没有写入 migrationCompleted');
    if (!report.backupPath || !existsSync(report.backupPath)) fail('沙盒导入没有生成备份文件');
    if (sha256(sourcePath) !== sourceHashBefore) fail('沙盒导入改写了原始 V4.4 配置');
    sandboxImport = { imported: report.imported, skipped: report.skipped, backupCreated: true, settingsUpdated: true };
  } finally {
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  source: 'V4.4 config.json',
  accountCount: preview.accountCount,
  platformCounts: Object.fromEntries(platformCounts),
  fingerprintCount: preview.fingerprintCount,
  proxyProfileCount: preview.proxyProfileCount,
  storageFiles: preview.storageFiles.length,
  settings: {
    hasProfileRoot: preview.settings.hasProfileRoot,
    hasDownloadDir: preview.settings.hasDownloadDir,
    hasBossKey: preview.settings.hasBossKey,
    dolaAspectRatio: preview.settings.hasDolaAspectRatio ? preview.settings.dolaAspectRatio : null,
    homeUrlCount: preview.settings.homeUrlCount
  },
  ...(sandboxImport ? { sandboxImport } : {}),
  warningCount: preview.warnings.length,
  sourceUnchanged: sha256(sourcePath) === sourceHashBefore,
  note: sandboxImport ? '真实 V4.4 配置 + 临时沙盒导入；未写入原配置/账号目录，未复制 WebView2 数据库，未读取或输出凭据' : '只读预览；未导入账号、未复制 WebView2 数据库、未读取或输出凭据'
}, null, 2));
app.exit(0);
