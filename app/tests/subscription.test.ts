import { describe, expect, it } from 'vitest';
import { parseSubscription } from '../src/main/subscription';

describe('subscription parser', () => {
  it('parses sing-box outbounds and skips routing-only outbounds', () => {
    const result = parseSubscription(JSON.stringify({ outbounds: [{ type: 'selector', tag: 'proxy', outbounds: ['node-a'] }, { type: 'socks', tag: 'node-a', server: '127.0.0.1', server_port: 1080, username: 'u', password: 'p' }] }));
    expect(result.format).toBe('sing-box-json'); expect(result.nodes).toHaveLength(1); expect(result.nodes[0]).toMatchObject({ tag: 'node-a', host: '127.0.0.1', port: 1080, scheme: 'socks' });
  });
  it('converts Clash YAML nodes to sing-box-compatible node configs', () => {
    const result = parseSubscription('proxies:\n  - name: hk\n    type: socks5\n    server: proxy.example\n    port: 443\n    username: user\n    password: pass\n');
    expect(result.format).toBe('clash-yaml'); expect(result.nodes[0]).toMatchObject({ name: 'hk', host: 'proxy.example', port: 443 }); expect(JSON.parse(result.nodes[0]!.configJson)).toMatchObject({ type: 'socks', server: 'proxy.example' });
  });
  it('parses a base64-encoded VLESS URI list', () => {
    const encoded = Buffer.from('vless://uuid@example.com:443?security=tls&sni=example.com#edge\n').toString('base64');
    const result = parseSubscription(encoded);
    expect(result.format).toBe('v2ray-base64'); expect(result.nodes[0]).toMatchObject({ host: 'example.com', port: 443, scheme: 'vless' });
  });
  it('accepts a base64-encoded sing-box JSON document', () => {
    const encoded = Buffer.from(JSON.stringify({ outbounds: [{ type: 'trojan', tag: 'secure', server: 'edge.example', server_port: 443, password: 'secret' }] })).toString('base64');
    const result = parseSubscription(encoded);
    expect(result.format).toBe('sing-box-json'); expect(result.nodes[0]).toMatchObject({ tag: 'secure', scheme: 'trojan' });
  });
  it('recognizes plain URI lists as URI rather than Base64', () => {
    const result = parseSubscription('vless://uuid@example.com:443?security=tls#edge\n');
    expect(result.format).toBe('v2ray-uri');
  });
  it('parses the common Shadowsocks URI with base64 userinfo', () => {
    const auth = Buffer.from('aes-128-gcm:secret').toString('base64');
    const result = parseSubscription(`ss://${auth}@ss.example.com:8388#hk`);
    expect(result.nodes[0]).toMatchObject({ scheme: 'shadowsocks', host: 'ss.example.com', port: 8388, method: 'aes-128-gcm', password: 'secret' });
  });
  it('parses the legacy Shadowsocks URI with the whole authority base64 encoded', () => {
    const authority = Buffer.from('chacha20-ietf-poly1305:secret@[2001:db8::1]:443').toString('base64');
    const result = parseSubscription(`ss://${authority}#ipv6`);
    expect(result.nodes[0]).toMatchObject({ scheme: 'shadowsocks', host: '2001:db8::1', port: 443, method: 'chacha20-ietf-poly1305', password: 'secret' });
  });
  it('keeps plain Shadowsocks method and password URI syntax', () => {
    const result = parseSubscription('ss://aes-128-gcm:secret@ss.example.com:8388#plain');
    expect(result.nodes[0]).toMatchObject({ scheme: 'shadowsocks', host: 'ss.example.com', port: 8388, method: 'aes-128-gcm', password: 'secret' });
  });
  it('preserves legacy Clash VMess WebSocket and TLS options', () => {
    const result = parseSubscription(`proxies:
  - name: edge
    type: vmess
    server: edge.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    cipher: auto
    alter-id: 2
    network: ws
    tls: true
    servername: tls.example.com
    skip-cert-verify: true
    alpn: h2,http/1.1
    client-fingerprint: chrome
    ws-opts:
      path: /stream
      headers:
        Host: cdn.example.com
`);
    const outbound = JSON.parse(result.nodes[0]!.configJson) as Record<string, any>;
    expect(outbound).toMatchObject({ type: 'vmess', server: 'edge.example.com', server_port: 443, uuid: '11111111-1111-1111-1111-111111111111', alter_id: 2 });
    expect(outbound.transport).toEqual({ type: 'ws', path: '/stream', headers: { Host: 'cdn.example.com' } });
    expect(outbound.tls).toMatchObject({ enabled: true, server_name: 'tls.example.com', insecure: true, alpn: ['h2', 'http/1.1'], utls: { enabled: true, fingerprint: 'chrome' } });
  });
  it('preserves legacy Clash gRPC/H2 and hysteria2 options', () => {
    const result = parseSubscription(`proxies:
  - name: grpc
    type: vmess
    server: grpc.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    network: grpc
    tls: true
    grpc-opts:
      grpc-service-name: ai
  - name: grpc
    type: vmess
    server: h2.example.com
    port: 443
    uuid: 22222222-2222-2222-2222-222222222222
    network: h2
    h2-opts:
      path: /h2
      host:
        - cdn.example.com
  - name: fast
    type: hysteria2
    server: hy.example.com
    port: 8443
    password: secret
    sni: hy.example.com
    skip-cert-verify: true
    up: 20 Mbps
    down-mbps: 30
    obfs: salamander
    obfs-password: obfs-secret
`);
    const outbounds = result.nodes.map((node) => JSON.parse(node.configJson) as Record<string, any>);
    expect(outbounds[0]!.transport).toEqual({ type: 'grpc', service_name: 'ai' });
    expect(outbounds[1]!.transport).toMatchObject({ type: 'http', path: '/h2', host: ['cdn.example.com'] });
    expect(outbounds[2]).toMatchObject({ type: 'hysteria2', up_mbps: 20, down_mbps: 30, obfs: { type: 'salamander', password: 'obfs-secret' } });
    expect(new Set(result.nodes.map((node) => node.tag)).size).toBe(3);
  });
  it('preserves V2Ray VMess TLS transport options and hysteria2 defaults', () => {
    const vmess = Buffer.from(JSON.stringify({ ps: 'grpc-edge', add: 'edge.example.com', port: 443, id: '11111111-1111-1111-1111-111111111111', net: 'grpc', serviceName: 'ai', tls: 'tls', sni: 'tls.example.com', alpn: 'h2,http/1.1', fp: 'chrome', allowInsecure: true })).toString('base64');
    const result = parseSubscription(`vmess://${vmess}\nhysteria2://secret@hy.example.com?up=10&downmbps=20&obfs=salamander&obfs-password=pass#hy`);
    const vmessOutbound = JSON.parse(result.nodes[0]!.configJson) as Record<string, any>;
    const hysteriaOutbound = JSON.parse(result.nodes[1]!.configJson) as Record<string, any>;
    expect(vmessOutbound.transport).toEqual({ type: 'grpc', service_name: 'ai' });
    expect(vmessOutbound.tls).toMatchObject({ server_name: 'tls.example.com', insecure: true, alpn: ['h2', 'http/1.1'], utls: { fingerprint: 'chrome' } });
    expect(hysteriaOutbound).toMatchObject({ server: 'hy.example.com', server_port: 443, up_mbps: 10, down_mbps: 20, obfs: { type: 'salamander', password: 'pass' } });
  });
  it('rejects oversized subscription text before parsing', () => {
    expect(() => parseSubscription('x'.repeat(10 * 1024 * 1024 + 1))).toThrow('超过 10 MB');
  });
});
