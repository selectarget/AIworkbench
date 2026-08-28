import { describe, expect, it } from 'vitest';
import { accountSchema } from '../src/shared/contracts';
import { hasStableDolaLoginCookies, hasStableExternalLoginCookies, isAccountSiteCookieDomain, isAccountSitePage, isDolaCookieDomain, isGoogleAuthPage, isRelevantCookieDomain } from '../src/main/external-login';

function account(platform: 'dola' | 'qianwen' = 'dola') {
  return accountSchema.parse({
    id: `account_${platform}`,
    name: platform,
    platform,
    createdAt: new Date().toISOString(),
    order: 0
  });
}

describe('external login scope', () => {
  it('recognizes the account site and Google OAuth pages but rejects unrelated tabs', () => {
    const value = account();
    expect(isAccountSitePage('https://www.dola.com/chat', value)).toBe(true);
    expect(isAccountSitePage('https://ciciai.com/login', value)).toBe(true);
    expect(isAccountSitePage('https://example.com/', value)).toBe(false);
    expect(isGoogleAuthPage('https://accounts.google.com/o/oauth2/auth')).toBe(true);
    expect(isGoogleAuthPage('https://mail.example.com/')).toBe(false);
  });

  it('limits cookie transfer to the target site and Google auth domains', () => {
    const value = account();
    expect(isRelevantCookieDomain('.dola.com', value)).toBe(true);
    expect(isRelevantCookieDomain('api.ciciai.com', value)).toBe(true);
    expect(isRelevantCookieDomain('.google.com', value)).toBe(true);
    expect(isRelevantCookieDomain('unrelated.example', value)).toBe(false);
  });

  it('uses the configured platform host for non-Dola accounts', () => {
    const value = account('qianwen');
    expect(isAccountSitePage('https://www.qianwen.com/chat', value)).toBe(true);
    expect(isAccountSitePage('https://chat.qwen.ai/', value)).toBe(true);
    expect(isAccountSitePage('https://tongyi.aliyun.com/', value)).toBe(true);
    expect(isAccountSiteCookieDomain('.qianwen.com', value)).toBe(true);
    expect(isAccountSiteCookieDomain('.qwen.ai', value)).toBe(true);
    expect(isAccountSiteCookieDomain('.tongyi.aliyun.com', value)).toBe(true);
    expect(isAccountSiteCookieDomain('.google.com', value)).toBe(false);
    expect(isRelevantCookieDomain('.qianwen.com', value)).toBe(true);
    expect(isRelevantCookieDomain('.dola.com', value)).toBe(false);
  });

  it('recognizes only Dola-family domains and stable login cookie signals', () => {
    expect(isDolaCookieDomain('.dola.com')).toBe(true);
    expect(isDolaCookieDomain('api.ciciai.com')).toBe(true);
    expect(isDolaCookieDomain('accounts.google.com')).toBe(false);
    expect(hasStableDolaLoginCookies([{ name: 'sessionid_ss' }])).toBe(true);
    expect(hasStableDolaLoginCookies([{ name: 'csrf_token' }])).toBe(true);
    expect(hasStableExternalLoginCookies([{ name: '__Secure-next-auth.session-token' }])).toBe(true);
    expect(hasStableExternalLoginCookies([{ name: 'theme' }, { name: 'locale' }])).toBe(false);
    expect(hasStableDolaLoginCookies([{ name: 'theme' }, { name: 'locale' }])).toBe(false);
  });
});
