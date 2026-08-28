import { describe, expect, it } from 'vitest';
import { adapters, responsePatchHeaders } from '../src/main/adapters';
import { platforms } from '../src/shared/platforms';

describe('duration response adapter', () => {
  it('adds a 15 second primitive option', () => {
    const result = adapters.doubao.patchResponse!('https://www.doubao.com/samantha/skill/pack', JSON.stringify({ duration_options: [5, 10] }));
    expect(result.changed).toBe(true); expect(JSON.parse(result.body).duration_options).toEqual([5, 10, 15]);
  });
  it('patches nested JSON strings', () => {
    const result = adapters.dola.patchResponse!('https://www.dola.com/samantha/skill/pack', JSON.stringify({ config: JSON.stringify({ durationOptions: ['5s', '10s'] }) }));
    expect(result.changed).toBe(true); expect(JSON.parse(JSON.parse(result.body).config).durationOptions).toContain('15s');
  });
  it('passes malformed responses through', () => {
    const result = adapters.doubao.patchResponse!('', '<html>oops</html>'); expect(result).toEqual({ changed: false, body: '<html>oops</html>' });
  });
  it('clones object-shaped duration options', () => {
    const result = adapters.doubao.patchResponse!('', JSON.stringify({ duration_list: [{ label: '5 秒', value: 5 }, { label: '10 秒', value: 10 }] }));
    const values = JSON.parse(result.body).duration_list; expect(values).toContainEqual({ label: '15 秒', value: 15 });
  });
  it('restores legacy supported_durations and action-bar option_list shapes', () => {
    const result = adapters.dola.patchResponse!('https://www.dola.com/im/chain/single', JSON.stringify({ supported_durations: ['5', '10'], option_list: [{ option_key: '10', display_text: '10s' }], key: 'duration' }));
    const value = JSON.parse(result.body);
    expect(value.supported_durations).toContain('15');
    expect(value.option_list).toContainEqual(expect.objectContaining({ option_key: '15', display_text: '15s' }));
  });
  it('assigns unique action-bar ids and updates selectable message text', () => {
    const body = JSON.stringify({ key: 'duration', option_list: [
      { id: 4, option_key: '5', display_text: '5s', message_text: '5s' },
      { id: 9, option_key: '10', display_text: '10s', message_text: '10s' }
    ] });
    const result = adapters.doubao.patchResponse!('https://www.doubao.com/alice/slot/action_bar_v3/get_item_conf', body);
    const options = JSON.parse(result.body).option_list;
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 10, option_key: '15', display_text: '15s', message_text: '15s' })
    ]));
  });
  it('patches the nested escaped duration template used by the V4.4 action-bar response', () => {
    const durationTemplate = { id: 2, label: '时长', option_list: [
      { id: 1, display_text: '5s', option_key: '5' },
      { id: 2, display_text: '10s', option_key: '10' },
      { id: 3, display_text: '15s', option_key: '15' }
    ] };
    const selectorTemplate = { selector_list: [{ item_type: 3, id: 2, template: JSON.stringify(durationTemplate) }] };
    const body = JSON.stringify({ data: { item_list: { video: { instruction_conf: { instruction_item_list: [{ template: JSON.stringify(selectorTemplate) }] } } } } });
    const result = adapters.dola.patchResponse!('https://www.dola.com/alice/slot/action_bar_v3/get_item_conf', body);
    const value = JSON.parse(result.body);
    const selector = JSON.parse(value.data.item_list.video.instruction_conf.instruction_item_list[0].template);
    const patched = JSON.parse(selector.selector_list[0].template);
    expect(patched.option_list).toEqual(expect.arrayContaining([
      expect.objectContaining({ option_key: '15', display_text: '15s' }),
      expect.objectContaining({ option_key: '30', display_text: '30s' })
    ]));
  });
  it('adds the Dola 30 second option alongside the legacy 15 second option', () => {
    const result = adapters.dola.patchResponse!('https://www.dola.com/samantha/skill/pack', JSON.stringify({ duration_options: [5, 10] }));
    expect(JSON.parse(result.body).duration_options).toEqual([5, 10, 15, 30]);
  });
  it('matches supported hostnames without matching lookalikes', () => {
    expect(adapters.qianwen.matches('https://chat.qwen.ai/c/123')).toBe(true);
    expect(adapters.qianwen.matches('https://qwen.ai.evil.example/c/123')).toBe(false);
    expect(adapters.kimi.matches('https://www.kimi.com/')).toBe(true);
    expect(adapters.kimi.matches('https://kimi.com.evil.example/')).toBe(false);
    expect(adapters.jimeng.matches('https://www.jimeng.com/ai-tool')).toBe(true);
    expect(adapters.dola.matches('https://app.ciciai.com/')).toBe(true);
    expect(adapters.dola.matches('https://ciciai.com.evil.example/')).toBe(false);
  });
  it('keeps every registered platform bound to a safe host fixture', () => {
    const fixtures = [
      ['doubao', 'https://www.doubao.com/chat', 'https://doubao.com.evil.example/chat'],
      ['dola', 'https://www.dola.com/', 'https://dola.com.evil.example/'],
      ['qianwen', 'https://chat.qwen.ai/c/123', 'https://qwen.ai.evil.example/c/123'],
      ['yunque', 'https://xyq.jianying.com/editor', 'https://jianying.com.evil.example/editor'],
      ['higgsfield', 'https://app.higgsfield.ai/', 'https://higgsfield.ai.evil.example/'],
      ['kimi', 'https://kimi.moonshot.cn/', 'https://moonshot.cn.evil.example/'],
      ['oiioii', 'https://www.oiioii.ai/home', 'https://oiioii.ai.evil.example/home'],
      ['nano', 'https://xcgai.cn/', 'https://xcgai.cn.evil.example/'],
      ['lovart', 'https://www.lovart.ai/zh/home', 'https://lovart.ai.evil.example/zh/home'],
      ['jimeng', 'https://jimeng.jianying.com/ai-tool/asset', 'https://jimeng.com.evil.example/ai-tool'],
      ['custom', 'https://example.test/custom', 'not-a-url']
    ] as const;
    for (const [id, accepted, rejected] of fixtures) {
      expect(adapters[id].matches(accepted), `${id} should accept its fixture`).toBe(true);
      expect(adapters[id].matches(rejected), `${id} should reject its lookalike`).toBe(false);
      expect(adapters[id].definition).toEqual(platforms[id]);
      expect(adapters[id].scripts).toContain('generic-video-capture.js');
    }
  });
  it('exposes an explicit capability contract without overclaiming generic platforms', () => {
    for (const adapter of Object.values(adapters)) {
      expect(adapter.capabilities).toMatchObject({
        domCapture: true,
        fetchCapture: true,
        xhrCapture: true,
        sseCapture: true,
        cdpNetworkCapture: true,
        imageParser: true,
        videoParser: true
      });
      expect(Array.isArray(adapter.capabilities.taskDurations)).toBe(true);
    }
    expect(adapters.dola.capabilities).toMatchObject({ dedicatedDownloader: true, loginAssist: true, taskDurations: [15, 30] });
    expect(adapters.doubao.capabilities).toMatchObject({ dedicatedDownloader: true, taskDurations: [15, 30] });
    expect(adapters.qianwen.capabilities.dedicatedDownloader).toBe(true);
    expect(adapters.yunque.capabilities.dedicatedDownloader).toBe(true);
    expect(adapters.jimeng.capabilities.dedicatedDownloader).toBe(true);
    expect(adapters.kimi.capabilities).toMatchObject({ dedicatedDownloader: false, loginAssist: false, taskDurations: [] });
  });
  it('retains the old response interception entry points for specialized platforms', () => {
    expect(adapters.doubao.fetchPatterns.map((item) => item.urlPattern)).toEqual(expect.arrayContaining([
      '*://*.doubao.com/samantha/skill/pack*',
      '*://*.doubao.com/alice/slot/action_bar_v3/get_item_conf*',
      '*://*.doubao.com/*/alice/slot/action_bar_v3/get_item_conf*',
      '*://*.byteintlapi.com/*/alice/slot/action_bar_v3/get_item_conf*'
    ]));
    expect(adapters.dola.fetchPatterns.map((item) => item.urlPattern)).toEqual(expect.arrayContaining([
      '*://*.dola.com/im/chain/single*',
      '*://*.dola.com/samantha/skill/pack*',
      '*://*.dola.com/*/alice/slot/action_bar_v3/get_item_conf*',
      '*://*.ciciai.com/im/chain/single*',
      '*://*.ciciai.com/samantha/skill/pack*'
    ]));
    expect(adapters.yunque.fetchPatterns.map((item) => item.urlPattern)).toEqual(expect.arrayContaining([
      '*://xyq.jianying.com/*list_thread_file*',
      '*://xyq.jianying.com/api/biz/v1/editor/get_package_info*'
    ]));
  });
  it('parses generated media from generic JSON and SSE responses', () => {
    const json = adapters.kimi.parseResponse!('https://api.moonshot.cn/generate', JSON.stringify({ result: { image_url: 'https://cdn.example.com/generated/image.png', width: 1024, height: 1024 } }));
    const sse = adapters.lovart.parseResponse!('https://api.lovart.ai/events', `data: ${JSON.stringify({ video_url: 'https://cdn.example.com/generated/video.mp4', duration: 5 })}\n\n`);
    expect(json).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image', url: 'https://cdn.example.com/generated/image.png', source: 'cdp:kimi' })]));
    expect(sse).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'video', url: 'https://cdn.example.com/generated/video.mp4', source: 'cdp:lovart' })]));
  });
  it('restores legacy Qianwen message-list media fields', () => {
    const body = JSON.stringify({ messages: [{ title: '千问作品', thumbnail_url: 'https://workspace-zb-cdn.qianwen.com/generated/result-1', width: 1024, height: 1024, src: 'https://cdn.qianwen.com/video/result.mp4', poster: 'https://workspace-zb-cdn.qianwen.com/generated/poster' }], result: { image_url: 'https://cdn.qianwen.com/generated/new-result.png' } });
    const result = adapters.qianwen.parseResponse!('https://chat2-api.qianwen.com/api/v1/session/msg/list', body);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image', url: 'https://workspace-zb-cdn.qianwen.com/generated/result-1', source: 'cdp:qianwen:message-list', qualityEvidence: 'platform-api' }),
      expect.objectContaining({ type: 'video', url: 'https://cdn.qianwen.com/video/result.mp4', source: 'cdp:qianwen:message-list' }),
      expect.objectContaining({ type: 'image', url: 'https://cdn.qianwen.com/generated/new-result.png', source: 'cdp:qianwen' })
    ]));
  });
  it('loads the safe Dola page bridge only through the Dola adapter', () => {
    expect(adapters.dola.scripts).toContain('dola-resource-bridge.js');
    expect(adapters.dola.scripts).toContain('dola-duration-bridge.js');
    expect(adapters.doubao.scripts).toContain('dola-duration-bridge.js');
    expect(adapters.qianwen.scripts).not.toContain('dola-resource-bridge.js');
    expect(adapters.qianwen.scripts).not.toContain('dola-duration-bridge.js');
  });
  it('removes stale compression and integrity headers after patching', () => {
    const headers = responsePatchHeaders([{ name: 'Content-Encoding', value: 'br' }, { name: 'Content-Length', value: '999' }, { name: 'ETag', value: 'old' }, { name: 'Content-Type', value: 'application/json' }], '{"ok":true}');
    expect(headers.find((item) => item.name === 'Content-Encoding')).toBeUndefined(); expect(headers.find((item) => item.name === 'ETag')).toBeUndefined(); expect(headers.find((item) => item.name === 'Content-Length')?.value).toBe('11');
  });
  it('adds a JSON content type when a patched response has no type header', () => {
    const headers = responsePatchHeaders([], '{}');
    expect(headers).toEqual(expect.arrayContaining([
      { name: 'Content-Type', value: 'application/json; charset=utf-8' },
      { name: 'Content-Length', value: '2' }
    ]));
  });
});
