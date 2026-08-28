import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('Dola page bridge asset', () => {
  it('is a self-contained safe page script and routes downloads through the host bridge', () => {
    const source = readFileSync(resolve('site-assets/scripts/dola-resource-bridge.js'), 'utf8');
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain("type: 'dolaTokenExtracted'");
    expect(source).toContain("type: 'electronDownload'");
    expect(source).toContain('alternateUrls');
    expect(source).toContain('uniqueVideoUrls');
    expect(source).toContain('no[_-]?watermark');
    expect(source).toContain('watermark[_-]?free');
    expect(source).toContain('endpointName');
    expect(source).toContain('requestContext');
    expect(source).toContain('collectReactState');
    expect(source).toContain('__react(?:Props|Fiber)');
    expect(source).toContain('requestPlayInfo');
    expect(source).toContain('requestLegacyShare');
    expect(source).toContain('requestThreadShareInfo');
    expect(source).toContain('ciciai\\.com');
    expect(source).toContain('resolveRecord');
    expect(source).toContain('AIAM_DOLA_RESOLVE_RESOURCE');
    expect(source).toContain('AIAM_ALT_ORIGINAL_MEDIA_FOUND');
    expect(source).toContain('rememberLegacyOriginalMedia');
    expect(source).toContain("source: 'legacy-public-original'");
    expect(source).toContain('\\\\u([0-9a-f]{4})');
    expect(source).toContain('&#x([0-9a-f]+);?');
    expect(source).toContain('for (var round = 0; round < 3; round += 1)');
    expect(source).toContain('AIAM_DOLA_RESOURCE_DOWNLOAD');
    expect(source).toContain('thirdVideoUrl');
    expect(source).toContain('videoUrl: directUrl');
    expect(source).not.toContain('if (record.videoUrl) score += 5');
    expect(source).toContain('downloadAfterResolve');
    expect(source).toContain('postRecord(pending)');
    expect(source).toContain('conversationId: item.conversationId');
    expect(source).toContain('dolaVideoElementId = item.dolaVideoElementId || existing.dolaVideoElementId');
    expect(source).toContain('aiam-dola-video-overlay');
    expect(source).toContain('downloadResolvedVideo');
    expect(source).toContain('downloadCurrentVideo');
    expect(source).toContain('ensureVideoElementId');
    expect(source).toContain('解析并打开');
    expect(source).toContain("window.open(item.videoUrl, '_blank'");
    expect(source).toContain('解析原始');
    expect(source).toContain('videoGeneratedNotice');
    expect(source).toContain('scanGeneratedVideoNotices');
    expect(source).not.toContain('chrome.downloads');
  });
});

describe('Dola duration and media bridge asset', () => {
  it('is a self-contained page script with no legacy application authorization path', () => {
    const source = readFileSync(resolve('site-assets/scripts/dola-duration-bridge.js'), 'utf8');
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain('DOLA_AUDIO_REFERENCE_UPLOAD');
    expect(source).toContain('DOLA_AUDIO_REFERENCE_STATUS');
    expect(source).toContain('__WATERMARK_FREE_DOLA_REFERENCE_STATUS__');
    expect(source).toContain('matchedCount');
    expect(source).toContain('seedance_v2.5');
    expect(source).toContain('duration = 30');
    expect(source).toContain('ciciai.com');
    expect(source).not.toMatch(/chrome\.runtime|Paojiao|activation|license|授权|激活|machine.?id/i);
  });
});

describe('Dola ciciai compatibility', () => {
  it('keeps page task and MV3 completion hooks on the current Dola shell', () => {
    const task = readFileSync(resolve('src/main/dola-task.ts'), 'utf8');
    const content = readFileSync(resolve('site-assets/extensions/doubao-video-15s/content.js'), 'utf8');
    const manifest = readFileSync(resolve('site-assets/extensions/doubao-video-15s/manifest.json'), 'utf8');
    const bridge = readFileSync(resolve('site-assets/scripts/dola-resource-bridge.js'), 'utf8');
    expect(task).toContain('(?:dola|ciciai)');
    expect(content).toContain('doubao|dola|ciciai');
    expect(manifest).toContain('*://www.ciciai.com/*');
    expect(manifest).toContain('*://ciciai.com/*');
    expect(bridge).toContain('function startMutationObserver');
    expect(bridge).toContain('var root = document.documentElement || document.body');
  });
});

describe('generic media capture asset', () => {
  it('does not label an ordinary DOM image as a confirmed no-watermark resource', () => {
    const source = readFileSync(resolve('site-assets/scripts/generic-video-capture.js'), 'utf8');
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain('url: resource.url');
    expect(source).not.toContain('no_watermark_url: resource.url');
    expect(source).toContain('ciciai\\.com');
    expect(source).toContain("getEntriesByType('resource')");
    expect(source).toContain('generic-performance-video');
    expect(source).toContain('generic-performance-image');
    expect(source).toContain('const isKimiPage');
    expect(source).toContain('kimi\\.com');
    expect(source).toContain('data-resource-url');
    expect(source).toContain('data-asset-url');
    expect(source).toContain('data-mime-type');
    expect(source).toContain('function mediaTypeHint');
    expect(source).toContain('hintForAttribute');
    expect(source).toContain('A semantic image hint must win');
    expect(source).toContain('let started = false');
    expect(source).toContain("document.addEventListener('DOMContentLoaded', start");
    expect(source).not.toContain('moonshot\\.cn$/i.test(location.hostname)) return');
  });

  it('covers responsive picture sources and bounded CSS-backed media without losing type priority', () => {
    const source = readFileSync(resolve('site-assets/scripts/generic-video-capture.js'), 'utf8');
    expect(source).toContain('function parseSrcset(value)');
    expect(source).toContain('source[src],source[srcset]');
    expect(source).toContain('data-background-image');
    expect(source).toContain('function scanBackgroundImages()');
    expect(source).toContain('getBoundingClientRect');
    expect(source).toContain("getComputedStyle(node).backgroundImage");
    expect(source).toContain('imageExtPattern.test(url)');
    expect(source).toContain('videoExtPattern.test(url)');
    expect(source).toContain("attributeFilter: ['src', 'srcset'");
  });

  it('keeps the remote preload fallback aligned with the page capture bridge', () => {
    const source = readFileSync(resolve('src/preload/remote.ts'), 'utf8');
    expect(source).toContain('function parseSrcset(value: string)');
    expect(source).toContain('source[src],source[srcset]');
    expect(source).toContain('[style*="background"],[data-background-image],[data-bg-url]');
    expect(source).toContain('function isVisibleContentNode(node: Element)');
    expect(source).toContain('videoExtensionPattern.test(url)');
    expect(source).toContain('node.querySelectorAll(\'source[src]\')');
    expect(source).toContain("attributeFilter: ['src', 'srcset', 'poster', 'style']");
  });
});

describe('browser compatibility asset', () => {
  it('derives the default platform from the host browser and preserves account fingerprint overrides', () => {
    const source = readFileSync(resolve('site-assets/scripts/browser-compat.js'), 'utf8');
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain('var fingerprintApplied = Boolean(window.__AIAM_FINGERPRINT_APPLIED)');
    expect(source).toContain('var isMac =');
    expect(source).toContain('browserPlatform = isMac ? "MacIntel" : "Win32"');
    expect(source).toContain('dataPlatform = isMac ? "macOS" : "Windows"');
    expect(source).toContain('PluginArray');
    expect(source).toContain('MimeTypeArray');
    expect(source).toContain('Permissions.prototype.query');
    expect(source).toContain('Document.prototype.hasFocus');
    expect(source).toContain('window.outerWidth');
    expect(source).not.toContain('defineGetter(navigator, "platform", "Win32")');
    expect(source).not.toContain('Passkey disabled');
    expect(source).not.toContain('PublicKeyCredential');
    expect(source).not.toContain('CredentialsContainer');
    const higgsfield = readFileSync(resolve('site-assets/scripts/higgsfield-course.js'), 'utf8');
    expect(() => new Function(higgsfield)).not.toThrow();
    expect(higgsfield).toContain("location.replace(intro)");
    expect(higgsfield).toContain("location.replace(setup)");
    expect(higgsfield).toContain('attempts >= 3');
    expect(higgsfield).toContain('the old helper\'s reset-on-error behavior');
  });
});

describe('Jimeng asset adapter initialization', () => {
  it('defers DOM work until a document root exists for early new-document injection', () => {
    const source = readFileSync(resolve('site-assets/scripts/jimeng-image-download.js'), 'utf8');
    expect(source).toContain('const root = document.documentElement || document.body');
    expect(source).toContain("document.addEventListener('DOMContentLoaded', start");
    expect(source).toContain("root.classList.remove('aiam-jimeng-select-mode')");
  });
});

describe('Doubao creation asset', () => {
  it('exposes the original-creation scan entry and routes only platform download results', () => {
    const source = readFileSync(resolve('site-assets/scripts/doubao-creation-download.js'), 'utf8');
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain('__AIAM_DOUBAO_CREATION_SCAN_TO_RESOURCE_PANEL__');
    expect(source).toContain('get_download_info');
    expect(source).not.toContain('chrome.downloads');
  });
});

describe('bundled Doubao extension status', () => {
  it('does not carry an expiry or activation gate', () => {
    const background = readFileSync(resolve('site-assets/extensions/doubao-download/background.js'), 'utf8');
    const forwarder = readFileSync(resolve('site-assets/extensions/doubao-download/forwarder.js'), 'utf8');
    const popup = readFileSync(resolve('site-assets/extensions/doubao-download/popup.js'), 'utf8');
    const html = readFileSync(resolve('site-assets/extensions/doubao-download/popup.html'), 'utf8');

    expect(background).toContain('GET_STATUS');
    expect(background).not.toContain('CHECK_VERSION');
    expect(forwarder).not.toContain('isVersionValid');
    expect(popup).toContain('GET_STATUS');
    expect(html).toContain('id="versionText"');
    expect(popup).not.toContain('CHECK_VERSION');
    expect(html).not.toContain('versionWarning');
    expect(html).not.toContain('expired');
    expect(html).not.toMatch(/无需激活|版本失效|永久有效/);
  });
});

describe('bundled Doubao extension coexistence', () => {
  it('uses one shared marker to prevent duplicate image actions', () => {
    const legacyForwarder = readFileSync(resolve('site-assets/extensions/doubao-download/forwarder.js'), 'utf8');
    const maowangContent = readFileSync(resolve('site-assets/extensions/maowang-doubao/content/doubao.js'), 'utf8');

    expect(legacyForwarder).toContain('data-aiam-doubao-image-action');
    expect(legacyForwarder).toContain('legacy-download');
    expect(maowangContent).toContain('data-aiam-doubao-image-action');
    expect(maowangContent).toContain('maowang');
    expect(maowangContent).toContain('processedImages.add(image);');
  });
});

describe('bundled Qianwen extension host coverage', () => {
  it('grants the content script access to every Qianwen shell declared by the manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve('site-assets/extensions/maowang-doubao/manifest.json'), 'utf8')) as { host_permissions?: string[]; content_scripts?: Array<{ matches?: string[] }> };
    const permissions = manifest.host_permissions ?? [];
    const matches = manifest.content_scripts?.flatMap((item) => item.matches ?? []).filter((value) => /qianwen|qwen\.ai|tongyi\.aliyun/i.test(value)) ?? [];
    expect(matches).toEqual(expect.arrayContaining([
      'https://www.qianwen.com/*',
      'https://*.qwen.ai/*',
      'https://*.tongyi.aliyun.com/*'
    ]));
    expect(permissions).toEqual(expect.arrayContaining([
      'https://*.qianwen.com/*',
      'https://*.qwen.ai/*',
      'https://qwen.ai/*',
      'https://*.tongyi.aliyun.com/*',
      'https://tongyi.aliyun.com/*'
    ]));
  });
});

describe('Doubao play-info candidate compatibility', () => {
  it('keeps safe public play variants instead of only play_infos[0]', () => {
    const source = readFileSync(resolve('site-assets/extensions/maowang-doubao/shared/platform-rules.js'), 'utf8');
    const sandbox = { URL, URLSearchParams, console: { warn() {}, error() {} } } as Record<string, unknown>;
    runInNewContext(source, sandbox);
    const rules = (sandbox as any).MaowangPlatformRules;
    const result = rules.extractDoubaoPlayInfo({
      code: 0,
      data: {
        original_media_info: {
          main_url: 'https://cdn.example.com/main.mp4?lr=video_gen_watermark',
          backup_url: 'https://cdn.example.com/backup.mp4?lr=video_gen_watermark',
          no_watermark_url: 'https://cdn.example.com/original.mp4',
          width: 1920,
          height: 1080
        },
        play_infos: [
          { main: 'https://cdn.example.com/720.mp4?lr=video_gen_watermark', backup: 'https://cdn.example.com/720-backup.mp4?lr=video_gen_watermark' },
          { main: 'https://cdn.example.com/1080.mp4?lr=video_gen_no_watermark' },
          { main: 'javascript:alert(1)' }
        ]
      }
    });
    expect(result).toMatchObject({
      success: true,
      url: 'https://cdn.example.com/main.mp4?lr=video_gen_no_watermark',
      backupUrl: 'https://cdn.example.com/backup.mp4?lr=video_gen_no_watermark'
    });
    expect(result.alternateUrls).toEqual(expect.arrayContaining([
      'https://cdn.example.com/720.mp4?lr=video_gen_no_watermark',
      'https://cdn.example.com/720-backup.mp4?lr=video_gen_no_watermark',
      'https://cdn.example.com/1080.mp4?lr=video_gen_no_watermark',
      'https://cdn.example.com/original.mp4'
    ]));
    expect(result.alternateUrls).not.toContain('javascript:alert(1)');
  });

  it('keeps explicit no-watermark aliases in the bundled download candidates', () => {
    const source = readFileSync(resolve('site-assets/extensions/doubao-download/content.js'), 'utf8');
    expect(source).toContain("'no_watermark_url'");
    expect(source).toContain("'watermark_free_url'");
    expect(source).toContain("'unwatermarked_url'");
  });
});
