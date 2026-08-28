import type { ProxyConfig } from '../shared/contracts';

export function buildProxyRules(proxy: ProxyConfig): string {
  if (!proxy.enabled || !proxy.host || !proxy.port) throw new Error('代理地址或端口不正确');
  const host = proxy.host.includes(':') && !proxy.host.startsWith('[') ? `[${proxy.host}]` : proxy.host;
  const scheme = proxy.mode === 'direct' && proxy.directScheme ? proxy.directScheme : proxy.type;
  return `${scheme}://${host}:${proxy.port}`;
}
