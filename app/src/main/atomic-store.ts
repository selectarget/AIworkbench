import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ZodType } from 'zod';

export class AtomicStore<T> {
  // Accounts and settings are read on many hot paths. Reuse the parsed value
  // while the file's size and modification time are unchanged; a file
  // replaced by another writer (restore, migration) is parsed again.
  private cache: { mtimeMs: number; size: number; value: T } | null = null;
  constructor(private readonly file: string, private readonly schema: ZodType<T>, private readonly defaults: T, private readonly migrate?: (value: unknown) => unknown) {}

  read(): T {
    let stat: { mtimeMs: number; size: number };
    try { stat = statSync(this.file); } catch { this.cache = null; return structuredClone(this.defaults); }
    if (this.cache && this.cache.mtimeMs === stat.mtimeMs && this.cache.size === stat.size) return structuredClone(this.cache.value);
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      const value = this.schema.parse(this.migrate ? this.migrate(raw) : raw);
      this.cache = { mtimeMs: stat.mtimeMs, size: stat.size, value };
      return structuredClone(value);
    } catch {
      this.cache = null;
      return structuredClone(this.defaults);
    }
  }

  write(value: T): void {
    const parsed = this.schema.parse(value);
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    this.cache = null;
    writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
    renameSync(temporary, this.file);
  }
}
