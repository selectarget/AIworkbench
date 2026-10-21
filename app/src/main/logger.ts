import { appendFile, appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

function redact(value: string): string {
  return value.replace(/(password|token|cookie|authorization)(["'\s:=]+)[^\s,;"']+/gi, '$1$2[REDACTED]');
}

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const FLUSH_DELAY_MS = 500;

// Lines are buffered and appended asynchronously so logging never blocks the
// main process event loop. `flushSync` writes whatever is still pending when
// the process is about to exit.
export class Logger {
  private readonly file: string;
  private pending: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private writing = false;
  private size: number | null = null;
  constructor(directory: string) { this.file = join(directory, 'workbench.log'); }
  info(message: string): void { this.write('INFO', message); }
  warn(message: string): void { this.write('WARN', message); }
  error(message: string): void { this.write('ERROR', message); }
  flushSync(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const chunk = this.take();
    if (!chunk) return;
    try { this.rotate(); appendFileSync(this.file, chunk, 'utf8'); this.size = (this.size ?? 0) + Buffer.byteLength(chunk); } catch { /* Logging never blocks shutdown. */ }
  }
  private write(level: string, message: string): void {
    this.pending.push(`${new Date().toISOString()} ${level} ${redact(message)}\n`);
    this.schedule();
  }
  private schedule(): void {
    if (this.timer || this.writing) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, FLUSH_DELAY_MS);
    this.timer.unref?.();
  }
  private flush(): void {
    const chunk = this.take();
    if (!chunk) return;
    try { this.rotate(); } catch { /* keep appending to the current file */ }
    this.writing = true;
    appendFile(this.file, chunk, 'utf8', (error) => {
      this.writing = false;
      if (!error) this.size = (this.size ?? 0) + Buffer.byteLength(chunk);
      if (this.pending.length) this.schedule();
    });
  }
  private take(): string {
    if (!this.pending.length) return '';
    const chunk = this.pending.join('');
    this.pending = [];
    return chunk;
  }
  private rotate(): void {
    if (this.size === null) this.size = existsSync(this.file) ? statSync(this.file).size : 0;
    if (this.size < MAX_LOG_BYTES) return;
    for (let index = 3; index >= 1; index--) {
      const source = `${this.file}.${index}`; const target = `${this.file}.${index + 1}`;
      if (existsSync(source)) renameSync(source, target);
    }
    if (existsSync(this.file)) renameSync(this.file, `${this.file}.1`);
    this.size = 0;
  }
}
