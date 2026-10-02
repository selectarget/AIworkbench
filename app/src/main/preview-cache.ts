import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';

export class PreviewCache {
  constructor(readonly root: string, private readonly limitBytes = 512 * 1024 * 1024) {}

  path(accountId: string, identity: string, extension: string): string {
    mkdirSync(this.root, { recursive: true });
    const key = createHash('sha256').update(`${accountId}:${identity}`).digest('hex');
    return join(this.root, `${key}${extension}`);
  }

  async write(response: Response, target: string, maximumBytes = this.limitBytes): Promise<string> {
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const mime = response.headers.get('content-type') || '';
    if (/text\/|json|xml/i.test(mime)) throw new Error('服务器返回登录页或错误页面，请重新解析地址');
    if (Number(response.headers.get('content-length')) > maximumBytes) throw new Error('预览文件过大，请下载后播放');
    const partial = `${target}.${process.pid}.part`;
    const writer = createWriteStream(partial);
    writer.on('error', () => undefined);
    const reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!size && /^\s*(?:<!doctype|<html|\{"(?:error|code)")/i.test(Buffer.from(value.subarray(0, 128)).toString())) throw new Error('服务器返回错误页面');
        size += value.byteLength;
        if (size > maximumBytes) throw new Error('预览文件过大，请下载后播放');
        if (!writer.write(Buffer.from(value))) await once(writer, 'drain');
      }
      if (!size) throw new Error('预览数据为空');
      writer.end(); await once(writer, 'finish');
      renameSync(partial, target);
      this.trim(target);
      return target;
    } catch (error) {
      try { await reader.cancel(); } catch { /* Already closed. */ }
      writer.destroy();
      await new Promise<void>((resolve) => { if (writer.closed) resolve(); else writer.once('close', resolve); });
      rmSync(partial, { force: true });
      throw error;
    }
  }

  trim(keep?: string): void {
    if (!existsSync(this.root)) return;
    const files = readdirSync(this.root, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.name.endsWith('.part')).map((entry) => {
      const path = join(this.root, entry.name); const stat = statSync(path);
      return { path, size: stat.size, time: stat.mtimeMs };
    }).sort((a, b) => a.time - b.time);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (total <= this.limitBytes) break;
      if (file.path === keep) continue;
      try { rmSync(file.path); total -= file.size; } catch { /* A preview can still be in use. */ }
    }
  }
}
