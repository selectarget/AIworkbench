import { app, session } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = mkdtempSync(join(tmpdir(), 'workbench-media-proxy-'));
app.setPath('userData', join(root, 'session'));
let server;
async function main() {
try {
  await app.whenReady();
  const bundle = join(root, 'transport.mjs');
  await build({ stdin: { contents: "export { fetchAccountMedia, setMediaRequestProxyAuth } from './src/main/media-request.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', external: ['electron'], outfile: bundle });
  const { fetchAccountMedia, setMediaRequestProxyAuth } = await import(pathToFileURL(bundle).href);
  const observations = { challenges: 0, accountA: false, accountB: false };
  server = createServer((request, response) => {
    const expected = request.url.endsWith('/a') ? 'a:local-test-a' : 'b:local-test-b';
    if (request.headers['proxy-authorization'] !== `Basic ${Buffer.from(expected).toString('base64')}`) {
      observations.challenges++;
      response.writeHead(407, { 'proxy-authenticate': 'Basic realm="workbench-local"', 'content-length': '0', connection: 'close' }); response.end(); return;
    }
    response.writeHead(200, { 'content-type': 'video/mp4' }); response.end(request.url.endsWith('/a') ? 'account-a' : 'account-b');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  for (const owner of ['a', 'b']) {
    const target = session.fromPartition(`local-media-proxy-${owner}`);
    await target.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    setMediaRequestProxyAuth(target, (host, challengePort) => host === '127.0.0.1' && challengePort === port ? { username: owner, password: `local-test-${owner}` } : null);
    const response = await fetchAccountMedia(target, `http://workbench-media-test.invalid/${owner}`, { signal: AbortSignal.timeout(10_000) });
    if (response.status !== 200 || await response.text() !== `account-${owner}`) throw new Error(`Proxy account ${owner} was not isolated`);
    observations[owner === 'a' ? 'accountA' : 'accountB'] = true;
  }
  if (observations.challenges < 2) throw new Error('Proxy challenges were not exercised');
  console.log('PASS real media proxy isolation', JSON.stringify(observations));
} catch (error) { console.error(String(error).replace(/https?:\/\/\S+/g, '[URL]')); process.exitCode = 1; }
finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  const temporaryRoot = resolve(root);
  if (dirname(temporaryRoot) === resolve(tmpdir()) && basename(temporaryRoot).startsWith('workbench-media-proxy-')) {
    try { rmSync(temporaryRoot, { recursive: true, force: true }); } catch { /* Chromium may still hold profile files until exit. */ }
  }
  app.exit(process.exitCode || 0);
}
}
void main().catch((error) => { console.error(String(error)); app.exit(1); });
