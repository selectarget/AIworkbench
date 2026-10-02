import { app, session } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = mkdtempSync(join(tmpdir(), 'workbench-request-policy-'));
app.setPath('userData', join(root, 'session'));
// Every request below stays on the local fixture, including HTTPS failures.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP mssdk.bytedance.com 127.0.0.1');
let server;
async function main() {
  try {
    await app.whenReady();
    const bundle = join(root, 'policy.mjs');
    await build({ stdin: { contents: "export * from './src/main/site-request-compatibility.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: bundle });
    const { installSiteRequestCompatibility, consumeCompatibilityCancellation } = await import(pathToFileURL(bundle).href);
    let connections = 0; let cancelled = 0; let enabled = true;
    server = createServer((_request, response) => { response.writeHead(200); response.end('local-ok'); });
    server.on('connection', () => { connections++; });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const port = server.address().port;
    const target = session.fromPartition('request-policy-fixture');
    await target.setProxy({ mode: 'direct' });
    installSiteRequestCompatibility(target, () => enabled);
    target.webRequest.onErrorOccurred((details) => {
      if (consumeCompatibilityCancellation(target, details.id)) cancelled++;
    });
    for (let i = 0; i < 3; i++) {
      try { await target.fetch(`https://mssdk.bytedance.com:${port}/report`, { signal: AbortSignal.timeout(5000) }); throw new Error('Expected cancellation'); }
      catch (error) { if (!String(error).includes('ERR_BLOCKED_BY_CLIENT')) throw error; }
    }
    if (connections !== 0 || cancelled !== 3) throw new Error('A refused request reached TCP/TLS or lost cancellation ownership');
    const ordinary = await target.fetch(`http://127.0.0.1:${port}/media.mp4`);
    if (await ordinary.text() !== 'local-ok') throw new Error('Ordinary media host was blocked');
    enabled = false;
    const restored = await target.fetch(`http://mssdk.bytedance.com:${port}/report`, { signal: AbortSignal.timeout(5000) });
    if (await restored.text() !== 'local-ok') throw new Error('Live disable did not restore requests');
    console.log('PASS native request compatibility', JSON.stringify({ cancelled, blockedConnections: 0, ordinaryRequestsPass: true, liveDisable: true }));
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
  finally {
    if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    const temporaryRoot = resolve(root);
    if (dirname(temporaryRoot) === resolve(tmpdir()) && basename(temporaryRoot).startsWith('workbench-request-policy-')) {
      try { rmSync(temporaryRoot, { recursive: true, force: true }); } catch { /* Temporary Chromium files may still be locked. */ }
    }
    app.exit(process.exitCode || 0);
  }
}
void main().catch((error) => { console.error(String(error)); app.exit(1); });
