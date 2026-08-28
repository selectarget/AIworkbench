import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ZodType } from 'zod';

export class AtomicStore<T> {
  constructor(private readonly file: string, private readonly schema: ZodType<T>, private readonly defaults: T, private readonly migrate?: (value: unknown) => unknown) {}

  read(): T {
    if (!existsSync(this.file)) return structuredClone(this.defaults);
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return this.schema.parse(this.migrate ? this.migrate(raw) : raw);
    } catch {
      return structuredClone(this.defaults);
    }
  }

  write(value: T): void {
    const parsed = this.schema.parse(value);
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
    renameSync(temporary, this.file);
  }
}
