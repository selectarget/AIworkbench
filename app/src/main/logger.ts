import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

function redact(value: string): string {
  return value.replace(/(password|token|cookie|authorization)(["'\s:=]+)[^\s,;"']+/gi, '$1$2[REDACTED]');
}

export class Logger {
  private readonly file: string;
  constructor(directory: string) { this.file = join(directory, 'workbench.log'); }
  info(message: string): void { this.write('INFO', message); }
  warn(message: string): void { this.write('WARN', message); }
  error(message: string): void { this.write('ERROR', message); }
  private write(level: string, message: string): void {
    try { this.rotate(); appendFileSync(this.file, `${new Date().toISOString()} ${level} ${redact(message)}\n`, 'utf8'); } catch { /* Logging never blocks startup. */ }
  }
  private rotate(): void {
    if (!existsSync(this.file) || statSync(this.file).size < 2 * 1024 * 1024) return;
    for (let index = 3; index >= 1; index--) {
      const source = `${this.file}.${index}`; const target = `${this.file}.${index + 1}`;
      if (existsSync(source)) renameSync(source, target);
    }
    renameSync(this.file, `${this.file}.1`);
  }
}
