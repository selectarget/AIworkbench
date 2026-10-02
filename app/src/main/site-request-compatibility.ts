import type { Session } from 'electron';

// These exact hosts were verified in the user's existing Clash REJECT list.
// This opt-in policy reproduces that refusal before DNS/TLS; it never supplies
// a fake success response or expands the list to business/CDN hostnames.
export const blockedSiteHosts = [
  'mssdk.bytedance.com', 'mon.zijieapi.com', 'vcs.zijieapi.com',
  'opt.doubao.com', 'mon-sg.byteintlapi.com'
] as const;
const hosts = new Set<string>(blockedSiteHosts);
const backgroundTypes = new Set(['xhr', 'ping', 'other']);
type Sink = (level: 'info' | 'warn', message: string) => void;
type State = { enabled: () => boolean; sink?: Sink; reported: Set<string>; cancelled: Set<number> };
const states = new WeakMap<Session, State>();

export function shouldCancelBlockedSiteRequest(url: string, resourceType: string, enabled: boolean): boolean {
  if (!enabled || !backgroundTypes.has(resourceType)) return false;
  try { const target = new URL(url); return /^https?:$/.test(target.protocol) && hosts.has(target.hostname); }
  catch { return false; }
}

export function installSiteRequestCompatibility(ses: Session, enabled: () => boolean, sink?: Sink): void {
  const existing = states.get(ses);
  if (existing) { existing.enabled = enabled; existing.sink = sink; return; }
  const state: State = { enabled, sink, reported: new Set(), cancelled: new Set() };
  states.set(ses, state);
  ses.webRequest.onBeforeRequest({ urls: blockedSiteHosts.map((host) => `*://${host}/*`) }, (details, callback) => {
    const active = state.enabled();
    if (!active) state.reported.clear();
    const cancel = shouldCancelBlockedSiteRequest(details.url, details.resourceType, active);
    if (cancel) {
      if (state.cancelled.size >= 256) state.cancelled.delete(state.cancelled.values().next().value!);
      state.cancelled.add(details.id);
      const host = new URL(details.url).hostname;
      if (!state.reported.has(host)) {
        state.reported.add(host);
        state.sink?.('info', `[network-policy] host=${host} action=cancel-before-connect reason=blocked-domain-compatibility`);
      }
    }
    callback({ cancel });
  });
}

export function consumeCompatibilityCancellation(ses: Session, requestId: number): boolean {
  return states.get(ses)?.cancelled.delete(requestId) ?? false;
}
