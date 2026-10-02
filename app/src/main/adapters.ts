import type { AdapterCapabilities, AdapterTaskDuration, PlatformDefinition, PlatformId } from '../shared/contracts';
import { platforms } from '../shared/platforms';
import type { CapturedCandidate } from './media-parser';
import { parseDolaPayload, parseDoubaoPayload, parseMediaPayload, parseQianwenPayload, parseYunquePayload } from './media-parser';

export interface PlatformAdapter {
  definition: PlatformDefinition;
  matches(url: string): boolean;
  extensions: string[];
  scripts: string[];
  capabilities: AdapterCapabilities;
  fetchPatterns: Array<{ urlPattern: string; requestStage: 'Request' | 'Response' }>;
  patchResponse?(url: string, body: string): { changed: boolean; body: string };
  parseResponse?(url: string, body: string): CapturedCandidate[];
}

const createCapabilities = (overrides: Partial<AdapterCapabilities> = {}): AdapterCapabilities => {
  const { taskDurations, ...rest } = overrides;
  return {
    // The generic page bridge and the Main/CDP network observer provide the
    // baseline capture path for every registered platform. Site-specific
    // adapters add the stronger request/response or task guarantees below.
    domCapture: true,
    fetchCapture: true,
    xhrCapture: true,
    sseCapture: true,
    cdpNetworkCapture: true,
    requestModification: false,
    responseModification: false,
    imageParser: true,
    videoParser: true,
    dedicatedDownloader: false,
    loginAssist: false,
    taskDurations: [...(taskDurations ?? [])] as AdapterTaskDuration[],
    ...rest
  };
};

export function responsePatchHeaders(headers: Array<{ name: string; value: string }>, body: string): Array<{ name: string; value: string }> {
  const clean = headers.filter((header) => !/^(content-length|content-encoding|etag|content-md5)$/i.test(header.name));
  if (!clean.some((header) => /^content-type$/i.test(header.name))) clean.push({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
  clean.push({ name: 'Content-Length', value: String(Buffer.byteLength(body)) }); return clean;
}

function optionText(value: unknown): string {
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    return ['value', 'option_key', 'duration', 'seconds', 'label', 'text', 'name', 'show_name', 'display_text'].map((key) => String(node[key] ?? '')).join(' ');
  }
  return String(value ?? '');
}

function hasDurationOption(items: unknown[], seconds: number): boolean {
  return items.some((item) => new RegExp(`(^|\\D)${seconds}(?:s|秒)?(\\D|$)`, 'i').test(optionText(item)));
}

function cloneDurationOption(items: unknown[], seconds: number): unknown {
  const template = [...items].reverse().find((item) => item && typeof item === 'object');
  if (!template) return items.some((item) => typeof item === 'string') ? `${seconds}s` : seconds;
  const clone = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
  const numericIds = items
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => Number(item.id))
    .filter((id) => Number.isFinite(id));
  if ('id' in clone && numericIds.length) clone.id = Math.max(...numericIds) + 1;
  for (const field of ['value', 'option_key', 'duration', 'seconds']) {
    if (field in clone) clone[field] = typeof clone[field] === 'string' ? String(seconds) : seconds;
  }
  for (const field of ['label', 'text', 'name', 'show_name', 'display_text', 'selected_display_text', 'message_text']) {
    if (field in clone) clone[field] = String(clone[field]).replace(/(^|[^0-9])(?:5|10|15|30)(\s*(?:s|秒))(?=$|[^0-9])/gi, (_match, prefix: string, suffix: string) => `${prefix}${seconds}${suffix}`);
  }
  return clone;
}

function appendDurationOption(items: unknown[], seconds: number): boolean {
  if (!items.length || hasDurationOption(items, seconds)) return false;
  const option = cloneDurationOption(items, seconds);
  const tenIndex = items.findIndex((item) => /(^|\D)10(?:s|秒)?(\D|$)/i.test(optionText(item)));
  const insertionIndex = seconds > 15 ? items.length : (tenIndex >= 0 ? tenIndex + 1 : items.length);
  items.splice(insertionIndex, 0, option);
  return true;
}

function matchesHostname(url: string, hostPattern: RegExp): boolean {
  try {
    return hostPattern.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function patchDurationNode(value: unknown, seen = new Set<object>(), seconds = 15): boolean {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return false;
  seen.add(value as object); let changed = false;
  if (Array.isArray(value)) { for (const item of value) changed = patchDurationNode(item, seen, seconds) || changed; return changed; }
  const node = value as Record<string, unknown>;
  for (const key of ['duration_options', 'durationOptions', 'video_duration_options', 'duration_list', 'durationList', 'supported_durations']) {
    if (Array.isArray(node[key])) {
      const items = node[key] as unknown[];
      changed = key === 'supported_durations'
        ? (!hasDurationOption(items, seconds) && (items.push(String(seconds)), true)) || changed
        : appendDurationOption(items, seconds) || changed;
    }
  }
  if (Array.isArray(node.option_list)) {
    const hint = `${String(node.key ?? '')} ${String(node.value ?? '')} ${String(node.name ?? '')} ${String(node.title ?? '')} ${JSON.stringify(node.option_list)}`;
    if (/duration|时长|5s|10s|5 秒|10 秒/i.test(hint)) changed = appendDurationOption(node.option_list as unknown[], seconds) || changed;
  }
  if (Array.isArray(node.options)) {
    const hint = `${String(node.key ?? '')} ${String(node.value ?? '')} ${String(node.name ?? '')} ${String(node.title ?? '')} ${JSON.stringify(node.options)}`;
    if (/duration|时长|5s|10s|5 秒|10 秒/i.test(hint)) changed = appendDurationOption(node.options as unknown[], seconds) || changed;
  }
  for (const [key, child] of Object.entries(node)) {
    if (typeof child === 'string') {
      const text = child.trim();
      if ((text.startsWith('{') || text.startsWith('[')) && /duration|时长|10s|5s/i.test(text)) {
        try { const parsed = JSON.parse(text); if (patchDurationNode(parsed, new Set<object>(), seconds)) { node[key] = JSON.stringify(parsed); changed = true; } } catch { /* pass through */ }
      }
    } else changed = patchDurationNode(child, seen, seconds) || changed;
  }
  return changed;
}

const generic = (id: PlatformId, hostPattern: RegExp): PlatformAdapter => ({
  definition: platforms[id],
  matches: (url) => matchesHostname(url, hostPattern),
  extensions: [],
  scripts: ['browser-compat.js', 'generic-video-capture.js'],
  capabilities: createCapabilities(),
  fetchPatterns: [],
  // Some platforms publish generated media only in JSON/SSE responses and
  // never attach the final URL to a DOM media element. Keep the generic
  // parser conservative; MediaService applies the platform-specific size and
  // asset filters before anything reaches the UI or download queue.
  parseResponse: (_url, body) => parseMediaPayload(body, `cdp:${id}`)
});

const doubao: PlatformAdapter = {
  definition: platforms.doubao,
  extensions: ['maowang-doubao', 'doubao-download', 'doubao-video-15s'], scripts: ['browser-compat.js', 'generic-video-capture.js', 'dola-duration-bridge.js', 'doubao-creation-download.js'],
  capabilities: createCapabilities({ requestModification: true, responseModification: true, dedicatedDownloader: true, taskDurations: [15, 30] }),
  matches: (url) => matchesHostname(url, /(^|\.)doubao\.com$/i),
  parseResponse: (_url, body) => parseDoubaoPayload(body),
  fetchPatterns: [
    { urlPattern: '*://*.doubao.com/samantha/skill/pack*', requestStage: 'Response' },
    { urlPattern: '*://*.doubao.com/*/samantha/skill/pack*', requestStage: 'Response' },
    { urlPattern: '*://*.doubao.com/alice/slot/action_bar_v3/get_item_conf*', requestStage: 'Response' },
    { urlPattern: '*://*.doubao.com/*/alice/slot/action_bar_v3/get_item_conf*', requestStage: 'Response' },
    { urlPattern: '*://*.byteintlapi.com/*/alice/slot/action_bar_v3/get_item_conf*', requestStage: 'Response' }
  ],
  patchResponse: (_url, body) => { try { const value = JSON.parse(body); const changed = patchDurationNode(value); return { changed, body: changed ? JSON.stringify(value) : body }; } catch { return { changed: false, body }; } }
};

const dola: PlatformAdapter = {
  definition: platforms.dola,
  extensions: ['doubao-video-15s'], scripts: ['browser-compat.js', 'generic-video-capture.js', 'dola-duration-bridge.js', 'dola-resource-bridge.js'],
  capabilities: createCapabilities({ requestModification: true, responseModification: true, dedicatedDownloader: true, loginAssist: true, taskDurations: [15, 30] }),
  // Dola's normal web entry is dola.com, while login and some current
  // application shells can land on ciciai.com. They still belong to the
  // same account-scoped adapter/session and must not lose the page bridge.
  matches: (url) => matchesHostname(url, /(^|\.)dola\.com$/i) || matchesHostname(url, /(^|\.)ciciai\.com$/i),
  fetchPatterns: [
    { urlPattern: '*://*.dola.com/samantha/skill/pack*', requestStage: 'Response' },
    { urlPattern: '*://*.dola.com/*/samantha/skill/pack*', requestStage: 'Response' },
    { urlPattern: '*://*.dola.com/im/chain/single*', requestStage: 'Response' },
    { urlPattern: '*://*.dola.com/*/im/chain/single*', requestStage: 'Response' },
    { urlPattern: '*://*.dola.com/alice/slot/action_bar_v3/get_item_conf*', requestStage: 'Response' },
    { urlPattern: '*://*.dola.com/*/alice/slot/action_bar_v3/get_item_conf*', requestStage: 'Response' },
    { urlPattern: '*://*.ciciai.com/samantha/skill/pack*', requestStage: 'Response' },
    { urlPattern: '*://*.ciciai.com/*/samantha/skill/pack*', requestStage: 'Response' },
    { urlPattern: '*://*.ciciai.com/im/chain/single*', requestStage: 'Response' },
    { urlPattern: '*://*.ciciai.com/*/im/chain/single*', requestStage: 'Response' },
    { urlPattern: '*://*.ciciai.com/alice/slot/action_bar_v3/get_item_conf*', requestStage: 'Response' },
    { urlPattern: '*://*.ciciai.com/*/alice/slot/action_bar_v3/get_item_conf*', requestStage: 'Response' }
  ],
  patchResponse: (_url, body) => { try { const value = JSON.parse(body); const patched15 = patchDurationNode(value); const patched30 = patchDurationNode(value, new Set<object>(), 30); const changed = patched15 || patched30; return { changed, body: changed ? JSON.stringify(value) : body }; } catch { return { changed: false, body }; } },
  parseResponse: (url, body) => parseDolaPayload(body, url)
};

const yunque: PlatformAdapter = {
  ...generic('yunque', /(^|\.)xyq\.jianying\.com$/i),
  capabilities: createCapabilities({ dedicatedDownloader: true }),
  fetchPatterns: [
    { urlPattern: '*://xyq.jianying.com/*list_thread_file*', requestStage: 'Response' },
    { urlPattern: '*://xyq.jianying.com/api/biz/v1/editor/get_package_info*', requestStage: 'Response' }
  ],
  parseResponse: (url, body) => parseYunquePayload(body, url)
};

export const adapters: Record<PlatformId, PlatformAdapter> = {
  doubao, dola,
  qianwen: { ...generic('qianwen', /(^|\.)(qianwen\.com|tongyi\.aliyun\.com|qwen\.ai)$/i), extensions: ['maowang-doubao'], capabilities: createCapabilities({ dedicatedDownloader: true }), parseResponse: (url, body) => parseQianwenPayload(body, url) },
  yunque,
  higgsfield: { ...generic('higgsfield', /(^|\.)higgsfield\.ai$/i), scripts: ['browser-compat.js', 'generic-video-capture.js', 'higgsfield-course.js'], capabilities: createCapabilities({ loginAssist: true }) },
  // Keep the legacy moonshot.cn host and the newer kimi.com shell in the
  // same account/session adapter. The page bridge remains generic and does
  // not claim a site-specific download or task protocol.
  kimi: generic('kimi', /(^|\.)(moonshot\.cn|kimi\.com)$/i),
  oiioii: generic('oiioii', /(^|\.)oiioii\.ai$/i),
  nano: generic('nano', /(^|\.)xcgai\.cn$/i),
  lovart: generic('lovart', /(^|\.)lovart\.ai$/i),
  jimeng: { ...generic('jimeng', /(^|\.)(jimeng\.jianying\.com|jimeng\.com)$/i), scripts: ['browser-compat.js', 'generic-video-capture.js', 'jimeng-image-download.js'], capabilities: createCapabilities({ dedicatedDownloader: true }) },
  custom: generic('custom', /.*/)
};
