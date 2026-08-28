import { Buffer } from 'node:buffer';
import { parse as parseYaml } from 'yaml';
import { proxyNodeSchema, type ProxyNode, type SubscriptionProfile } from '../shared/contracts';

type JsonObject = Record<string, unknown>;

const MAX_SUBSCRIPTION_BYTES = 10 * 1024 * 1024;
const RESERVED_TAGS = new Set(['fangyue-node-selector', 'fangyue-local-dns', 'fangyue-local-socks', 'fangyue-local-mixed']);

function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function stringValue(value: unknown, fallback = ''): string { return value == null ? fallback : String(value).trim(); }
function numberValue(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function tagOf(value: unknown, fallback: string): string { return stringValue(value, fallback).replace(/[^\w\-. 一-龥]/g, '_').slice(0, 180) || fallback; }
function truthy(value: unknown): boolean { const normalized = stringValue(value).toLowerCase(); return value === true || ['1', 'true', 'yes', 'on', 'tls'].includes(normalized); }
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => stringValue(item)).filter(Boolean);
  return stringValue(value).split(',').map((item) => item.trim()).filter(Boolean);
}
function firstHost(value: unknown): string { return stringList(value)[0] ?? ''; }
function bandwidth(...values: unknown[]): number {
  for (const value of values) {
    const match = String(value ?? '').trim().match(/^\d+(?:\.\d+)?/);
    if (!match) continue;
    const parsed = Number(match[0]);
    if (Number.isFinite(parsed) && parsed > 0) return Math.max(1, Math.round(parsed));
  }
  return 0;
}
function uniqueTag(value: unknown, type: string, index: number, used: Set<string>): string {
  const base = tagOf(value, `${type || 'node'}-${index + 1}`);
  let tag = base;
  let suffix = 2;
  while (RESERVED_TAGS.has(tag) || used.has(tag)) tag = `${base} (${suffix++})`;
  used.add(tag);
  return tag;
}
function stringRecord(value: unknown): JsonObject {
  const source = object(value);
  return Object.fromEntries(Object.entries(source).filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item)).map(([key, item]) => [key, String(item)]));
}

function tlsOutbound(raw: JsonObject, fallbackServerName: string, enabled = truthy(raw.tls)): JsonObject | undefined {
  if (!enabled) return undefined;
  const tls: JsonObject = { enabled: true };
  const serverName = firstHost(raw.servername || raw.sni || fallbackServerName);
  if (serverName) tls.server_name = serverName;
  if (truthy(raw['skip-cert-verify']) || truthy(raw.skipCertVerify) || truthy(raw.allowInsecure) || truthy(raw.insecure) || raw.verify_cert === false) tls.insecure = true;
  const alpn = stringList(raw.alpn);
  if (alpn.length) tls.alpn = alpn;
  const fingerprint = stringValue(raw['client-fingerprint'] || raw.fingerprint || raw.fp);
  if (fingerprint) tls.utls = { enabled: true, fingerprint };
  return tls;
}

function vmessTransport(raw: JsonObject, network: string, path = '', host = '', serviceName = ''): JsonObject | undefined {
  const normalized = network.toLowerCase();
  const wsOpts = object(raw['ws-opts']);
  const grpcOpts = object(raw['grpc-opts']);
  const httpOpts = object(raw['http-opts'] || raw['h2-opts']);
  const effectivePath = stringValue(path || wsOpts.path || httpOpts.path || raw['ws-path'] || raw.path, normalized === 'ws' || normalized === 'websocket' ? '/' : '');
  const effectiveHost = stringValue(host || raw.host || wsOpts.headers && firstHost(object(wsOpts.headers).Host) || raw['ws-host']);
  if (normalized === 'ws' || normalized === 'websocket') {
    const headers = stringRecord(wsOpts.headers || raw['ws-headers']);
    if (effectiveHost && !headers.Host) headers.Host = firstHost(effectiveHost);
    const transport: JsonObject = { type: 'ws' };
    if (effectivePath) transport.path = effectivePath;
    if (Object.keys(headers).length) transport.headers = headers;
    return transport;
  }
  if (normalized === 'grpc') {
    const transport: JsonObject = { type: 'grpc' };
    const name = stringValue(serviceName || grpcOpts['grpc-service-name'] || grpcOpts['service-name'] || raw.serviceName);
    if (name) transport.service_name = name;
    return transport;
  }
  if (normalized === 'http' || normalized === 'h2') {
    const transport: JsonObject = { type: 'http' };
    if (effectivePath) transport.path = effectivePath;
    const hosts = stringList(effectiveHost || httpOpts.host || httpOpts.headers && firstHost(object(httpOpts.headers).Host));
    if (hosts.length) transport.host = hosts;
    return transport;
  }
  return undefined;
}

function vmessOutbound(raw: JsonObject, tag: string, network = '', path = '', host = '', serviceName = ''): JsonObject {
  const normalizedNetwork = stringValue(network || raw.net, 'tcp').toLowerCase();
  const outbound: JsonObject = {
    type: 'vmess',
    tag,
    server: stringValue(raw.add || raw.server),
    server_port: numberValue(raw.port || raw.server_port),
    uuid: stringValue(raw.id || raw.uuid),
    security: stringValue(raw.scy || raw.security || raw.cipher, 'auto'),
    alter_id: numberValue(raw.aid || raw.alter_id || raw.alterId || raw['alter-id'])
  };
  const transport = vmessTransport(raw, normalizedNetwork, path, host, serviceName);
  if (transport) outbound.transport = transport;
  const tls = tlsOutbound(raw, firstHost(host || raw.add || raw.server), truthy(raw.tls));
  if (tls) outbound.tls = tls;
  return outbound;
}

function nodeFromSingBox(raw: unknown, index: number): ProxyNode | null {
  const source = object(raw); const type = stringValue(source.type).toLowerCase(); const tag = tagOf(source.tag, `node-${index + 1}`);
  if (!type || ['direct', 'block', 'dns', 'selector', 'urltest', 'fallback', 'static', 'loopback', 'tor', 'shadowtls'].includes(type)) return null;
  const host = stringValue(source.server); const port = numberValue(source.server_port);
  if (!host || port < 1 || port > 65535) return null;
  return proxyNodeSchema.parse({ name: tag, tag, scheme: type, host, port, method: stringValue(source.method || source.security), username: stringValue(source.username || source.uuid), password: stringValue(source.password), configJson: JSON.stringify(source) });
}

function singBoxProfile(source: JsonObject): SubscriptionProfile {
  const seenTags = new Set<string>();
  const nodes = Array.isArray(source.outbounds) ? source.outbounds.map((item, index) => nodeFromSingBox(item, index)).filter((item): item is ProxyNode => {
    if (!item || seenTags.has(item.tag)) return false;
    seenTags.add(item.tag);
    return true;
  }) : [];
  const skippedNodeCount = Math.max(0, (Array.isArray(source.outbounds) ? source.outbounds.length : 0) - nodes.length);
  return { format: 'sing-box-json', configJson: JSON.stringify(source), nodes, skippedNodeCount };
}

function clashOutbound(raw: JsonObject, index: number, usedTags: Set<string>): JsonObject | null {
  const type = stringValue(raw.type).toLowerCase(); const host = stringValue(raw.server); const port = numberValue(raw.port);
  if (!type || !host || port < 1 || port > 65535) return null;
  const tag = uniqueTag(raw.name, type, index, usedTags);
  if (type === 'vmess') return vmessOutbound({ ...raw, server: host, server_port: port, uuid: raw.uuid, cipher: raw.cipher }, tag, stringValue(raw.network, 'tcp'));
  if (type === 'hysteria2' || type === 'hysteria' || type === 'hy2') {
    const outbound: JsonObject = { type: 'hysteria2', tag, server: host, server_port: port, password: stringValue(raw.password || raw.auth), tls: { enabled: true, server_name: stringValue(raw.sni || raw.servername || host), insecure: truthy(raw['skip-cert-verify']) || truthy(raw.skip_cert_verify) } };
    const up = bandwidth(raw.up, raw['up-mbps'], raw.upMbps); const down = bandwidth(raw.down, raw['down-mbps'], raw.downMbps);
    if (up) outbound.up_mbps = up;
    if (down) outbound.down_mbps = down;
    const obfsType = stringValue(raw.obfs);
    if (obfsType) outbound.obfs = { type: obfsType, password: stringValue(raw['obfs-password'] || raw.obfs_password) };
    return outbound;
  }
  if (type === 'trojan') {
    const outbound: JsonObject = { type: 'trojan', tag, server: host, server_port: port, password: stringValue(raw.password), tls: tlsOutbound(raw, host, true) };
    const transport = vmessTransport(raw, stringValue(raw.network), stringValue(raw.path), stringValue(raw.host), stringValue(raw.serviceName));
    if (transport) outbound.transport = transport;
    return outbound;
  }
  if (type === 'vless') {
    const outbound: JsonObject = { type: 'vless', tag, server: host, server_port: port, uuid: stringValue(raw.uuid), flow: stringValue(raw.flow) };
    const tls = tlsOutbound(raw, host, truthy(raw.tls)); if (tls) outbound.tls = tls;
    const transport = vmessTransport(raw, stringValue(raw.network), stringValue(raw.path), stringValue(raw.host), stringValue(raw.serviceName)); if (transport) outbound.transport = transport;
    return outbound;
  }
  if (type === 'ss' || type === 'shadowsocks') return { type: 'shadowsocks', tag, server: host, server_port: port, method: stringValue(raw.cipher, 'aes-128-gcm'), password: stringValue(raw.password) };
  if (type === 'socks5' || type === 'socks') return { type: 'socks', tag, server: host, server_port: port, username: stringValue(raw.username), password: stringValue(raw.password) };
  if (type === 'http' || type === 'https') return { type: 'http', tag, server: host, server_port: port, username: stringValue(raw.username), password: stringValue(raw.password), tls: type === 'https' ? { enabled: true, server_name: host } : undefined };
  return null;
}

function clashProfile(source: JsonObject): SubscriptionProfile {
  const rawNodes = Array.isArray(source.proxies) ? source.proxies : []; const usedTags = new Set<string>(); const outbounds = rawNodes.map((item, index) => clashOutbound(object(item), index, usedTags)).filter((item): item is JsonObject => Boolean(item));
  const nodes = outbounds.map((item, index) => nodeFromSingBox(item, index)).filter((item): item is ProxyNode => Boolean(item));
  return { format: 'clash-yaml', configJson: JSON.stringify({ outbounds }), nodes, skippedNodeCount: rawNodes.length - outbounds.length };
}

function decodeBase64(value: string): string {
  const compact = value.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return '';
  const normalized = compact.padEnd(compact.length + ((4 - compact.length % 4) % 4), '=');
  try {
    const bytes = Buffer.from(normalized, 'base64');
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded.replace(/^\uFEFF/, '');
  } catch { return ''; }
}

function decodeComponent(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function shadowsocksOutbound(value: string, index: number, usedTags = new Set<string>()): JsonObject | null {
  const withoutScheme = value.trim().replace(/^ss:\/\//i, '');
  const hashIndex = withoutScheme.indexOf('#');
  const authority = hashIndex >= 0 ? withoutScheme.slice(0, hashIndex) : withoutScheme;
  const tag = uniqueTag(hashIndex >= 0 ? decodeComponent(withoutScheme.slice(hashIndex + 1)) : '', 'ss', index, usedTags);

  // Older clients encode the complete method:password@host:port authority.
  // URL() cannot parse that form because it has no literal hostname until
  // after decoding, so decode it before falling back to the normal URI form.
  if (!authority.includes('@')) {
    const decoded = decodeBase64(authority);
    const full = decoded.match(/^([^:]+):([^@]+)@((?:\[[^\]]+\])|[^:]+):(\d+)$/);
    if (full) {
      const port = Number(full[4]);
      if (port >= 1 && port <= 65535) return { type: 'shadowsocks', tag, server: full[3]!.replace(/^\[|\]$/g, ''), server_port: port, method: full[1], password: full[2] };
    }
  }

  try {
    const parsed = new URL(value);
    const server = parsed.hostname;
    const port = Number(parsed.port);
    if (!server || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    const encodedUser = decodeComponent(parsed.username);
    const decodedAuth = decodeBase64(encodedUser);
    const auth = decodedAuth.includes(':') ? decodedAuth : `${encodedUser}${parsed.password ? `:${decodeComponent(parsed.password)}` : ''}`;
    const separator = auth.indexOf(':');
    if (separator < 1) return null;
    return { type: 'shadowsocks', tag, server, server_port: port, method: auth.slice(0, separator), password: auth.slice(separator + 1) };
  } catch { return null; }
}

function uriOutbound(uri: string, index: number, usedTags = new Set<string>()): JsonObject | null {
  const value = uri.trim(); if (!value) return null;
  if (value.toLowerCase().startsWith('vmess://')) {
    try {
      const source = object(JSON.parse(decodeBase64(value.slice(8)))); const tag = uniqueTag(source.ps || source.remark, 'vmess', index, usedTags);
      return vmessOutbound(source, tag, stringValue(source.net, 'tcp'), stringValue(source.path), stringValue(source.host), stringValue(source.serviceName));
    } catch { return null; }
  }
  if (value.toLowerCase().startsWith('ss://')) return shadowsocksOutbound(value, index, usedTags);
  try {
    const parsed = new URL(value); const scheme = parsed.protocol.replace(':', '').toLowerCase(); const tag = uniqueTag(decodeURIComponent(parsed.hash.replace(/^#/, '')), scheme, index, usedTags); const server = parsed.hostname; const port = Number(parsed.port) || (scheme === 'hysteria2' || scheme === 'hysteria' || scheme === 'hy2' ? 443 : 0);
    if (!server || !port || port < 1 || port > 65535) return null;
    const query = parsed.searchParams;
    if (scheme === 'hysteria2' || scheme === 'hysteria' || scheme === 'hy2') {
      const outbound: JsonObject = { type: 'hysteria2', tag, server, server_port: port, password: decodeURIComponent(parsed.username || parsed.pathname.replace(/^\//, '')), tls: { enabled: true, server_name: query.get('sni') || server, insecure: query.get('insecure') === '1' || query.get('allowInsecure') === '1' } };
      const up = bandwidth(query.get('upmbps'), query.get('up')); const down = bandwidth(query.get('downmbps'), query.get('down'));
      if (up) outbound.up_mbps = up;
      if (down) outbound.down_mbps = down;
      const obfsType = query.get('obfs') || ''; if (obfsType) outbound.obfs = { type: obfsType, password: query.get('obfs-password') || query.get('obfs_password') || '' };
      return outbound;
    }
    if (scheme === 'vless') {
      const raw: JsonObject = { uuid: decodeURIComponent(parsed.username), tls: ['tls', 'reality'].includes((query.get('security') || '').toLowerCase()), sni: query.get('sni') || server, allowInsecure: query.get('allowInsecure') === '1', fp: query.get('fp') || query.get('fingerprint') || '', network: query.get('type') || '', path: query.get('path') || '', host: query.get('host') || '', serviceName: query.get('serviceName') || query.get('service_name') || '', flow: query.get('flow') || '' };
      const outbound: JsonObject = { type: 'vless', tag, server, server_port: port, uuid: stringValue(raw.uuid), flow: stringValue(raw.flow) };
      const tls = tlsOutbound(raw, server, Boolean(raw.tls)); if (tls) outbound.tls = tls;
      const transport = vmessTransport(raw, stringValue(raw.network), stringValue(raw.path), stringValue(raw.host), stringValue(raw.serviceName)); if (transport) outbound.transport = transport;
      return outbound;
    }
    if (scheme === 'trojan') {
      const raw: JsonObject = { sni: query.get('sni') || server, allowInsecure: query.get('allowInsecure') === '1', network: query.get('type') || '', path: query.get('path') || '', host: query.get('host') || '', serviceName: query.get('serviceName') || '' };
      const outbound: JsonObject = { type: 'trojan', tag, server, server_port: port, password: decodeURIComponent(parsed.username), tls: tlsOutbound(raw, server, true) };
      const transport = vmessTransport(raw, stringValue(raw.network), stringValue(raw.path), stringValue(raw.host), stringValue(raw.serviceName)); if (transport) outbound.transport = transport;
      return outbound;
    }
    if (scheme === 'socks' || scheme === 'socks5') return { type: 'socks', tag, server, server_port: port, username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) };
    if (scheme === 'http' || scheme === 'https') return { type: 'http', tag, server, server_port: port, username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password), tls: scheme === 'https' ? { enabled: true } : undefined };
  } catch { return null; }
  return null;
}

function uriProfile(text: string, format?: 'v2ray-base64' | 'v2ray-uri'): SubscriptionProfile {
  const usedTags = new Set<string>();
  const outbounds = text.split(/\r?\n/).map((line, index) => uriOutbound(line, index, usedTags)).filter((item): item is JsonObject => Boolean(item));
  const nodes = outbounds.map((item, index) => nodeFromSingBox(item, index)).filter((item): item is ProxyNode => Boolean(item));
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const isUri = lines.some((line) => /^(?:vmess|vless|trojan|hysteria2?|hy2|ss|socks5?):\/\//i.test(line));
  return { format: format ?? (isUri ? 'v2ray-uri' : 'v2ray-base64'), configJson: JSON.stringify({ outbounds }), nodes, skippedNodeCount: Math.max(0, lines.length - outbounds.length) };
}

export function parseSubscription(input: string, sourceUrl?: string): SubscriptionProfile {
  const text = input.trim().replace(/^\uFEFF/, ''); if (!text) throw new Error('订阅内容为空');
  if (Buffer.byteLength(text, 'utf8') > MAX_SUBSCRIPTION_BYTES) throw new Error('订阅内容超过 10 MB，已停止解析');
  let result: SubscriptionProfile;
  if (text.startsWith('{') || text.startsWith('[')) {
    const parsed = JSON.parse(text) as unknown; result = Array.isArray(parsed) ? singBoxProfile({ outbounds: parsed }) : singBoxProfile(object(parsed));
  } else {
    let yamlResult: unknown;
    try { yamlResult = parseYaml(text); } catch { yamlResult = undefined; }
    if (yamlResult && typeof yamlResult === 'object' && (Array.isArray((yamlResult as JsonObject).proxies) || Array.isArray((yamlResult as JsonObject).outbounds))) result = Array.isArray((yamlResult as JsonObject).outbounds) ? singBoxProfile(object(yamlResult)) : clashProfile(object(yamlResult));
    else {
      const decoded = decodeBase64(text);
      if (decoded && (decoded.trim().startsWith('{') || decoded.trim().startsWith('['))) {
        try { result = parseSubscription(decoded, sourceUrl); } catch { result = uriProfile(text); }
      } else result = decoded && /(?:vmess|vless|trojan|hysteria2?|hy2|ss|socks5?):\/\//i.test(decoded) ? uriProfile(decoded, 'v2ray-base64') : uriProfile(text);
    }
  }
  if (!result.nodes.length) throw new Error('订阅中没有可用节点');
  return { ...result, sourceUrl };
}
