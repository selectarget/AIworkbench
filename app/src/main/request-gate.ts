export class RequestGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        const index = this.waiting.indexOf(start);
        if (index >= 0) this.waiting.splice(index, 1);
        signal?.removeEventListener('abort', abort);
        reject(signal?.reason);
      };
      const start = (): void => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) { reject(signal.reason); return; }
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true; this.active--;
          this.waiting.shift()?.();
        });
      };
      if (signal?.aborted) { reject(signal.reason); return; }
      if (this.active < this.limit) start();
      else { this.waiting.push(start); signal?.addEventListener('abort', abort, { once: true }); }
    });
  }
}
