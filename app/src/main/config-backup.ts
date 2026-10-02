import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { accountSchema, settingsSchema } from '../shared/contracts';

export const configBackupSchema = z.object({
  format: z.literal('ai-workbench-config'), version: z.literal(1), createdAt: z.string().datetime(),
  settings: settingsSchema,
  accounts: z.array(accountSchema).max(10_000)
}).superRefine((backup, ctx) => {
  if (new Set(backup.accounts.map((account) => account.id)).size !== backup.accounts.length) ctx.addIssue({ code: 'custom', message: '备份包含重复账号 ID', path: ['accounts'] });
});
export type ConfigBackup = z.infer<typeof configBackupSchema>;

export class ConfigBackupService {
  constructor(private readonly configRoot: string) {}
  get folder(): string { return join(this.configRoot, 'backups'); }

  read(path: string): ConfigBackup {
    const content = readFileSync(path, 'utf8');
    if (Buffer.byteLength(content) > 20 * 1024 * 1024) throw new Error('配置备份文件过大');
    return configBackupSchema.parse(JSON.parse(content));
  }

  snapshot(): ConfigBackup {
    const read = (name: string, fallback: unknown): unknown => { const path = join(this.configRoot, name); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback; };
    return configBackupSchema.parse({ format: 'ai-workbench-config', version: 1, createdAt: new Date().toISOString(), settings: read('settings.json', {}), accounts: read('accounts.json', []) });
  }

  save(path: string): void {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.snapshot(), null, 2), 'utf8');
    renameSync(temporary, path);
  }

  automatic(reason: 'daily' | 'before-restore' = 'daily'): string {
    mkdirSync(this.folder, { recursive: true });
    const now = new Date();
    const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const stamp = reason === 'daily' ? localDay : now.toISOString().replace(/[:.]/g, '-');
    const path = join(this.folder, `workbench-${reason}-${stamp}.json`);
    if (!existsSync(path)) this.save(path);
    const files = readdirSync(this.folder).filter((name) => /^workbench-(?:daily|before-restore)-[\dTZ.:-]+\.json$/.test(name)).sort().reverse();
    for (const name of files.slice(30)) rmSync(join(this.folder, name), { force: true });
    return path;
  }
}
