import { performance } from 'node:perf_hooks';

const sites = [
  ['doubao', 'https://www.doubao.com/chat'],
  ['qianwen', 'https://www.qianwen.com/'],
  ['dola', 'https://www.dola.com/'],
  ['yunque', 'https://xyq.jianying.com/'],
  ['higgsfield', 'https://higgsfield.ai/academy/courses/cinema-studio-pro/set-up-your-project'],
  ['kimi', 'https://kimi.moonshot.cn/'],
  ['oiioii', 'https://www.oiioii.ai/home'],
  ['nano', 'https://xcgai.cn/'],
  ['lovart', 'https://www.lovart.ai/zh/home'],
  ['jimeng', 'https://jimeng.jianying.com/ai-tool/asset']
];

const timeoutMs = Number(process.env.PUBLIC_SITE_TIMEOUT_MS || 15_000);
const strict = process.argv.includes('--strict');

async function probe([name, url]) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'AI-Creation-Workbench-public-smoke/1.0' }
    });
    return { name, url, ok: true, status: response.status, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { name, url, ok: false, error: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(sites.map(probe));
for (const result of results) {
  const status = result.ok ? `HTTP ${result.status}` : `失败：${result.error}`;
  console.log(`public site ${result.name}: ${status} · ${result.ms} ms · ${result.url}`);
}

const reachable = results.filter((result) => result.ok).length;
console.log(`public site smoke summary: ${reachable}/${results.length} endpoints reachable; this checks network entry points only, not login, capture, download, or task permissions.`);
if (strict && reachable !== results.length) process.exitCode = 1;
