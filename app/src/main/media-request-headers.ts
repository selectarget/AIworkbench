export function mediaRequestHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const result = { ...headers };
  for (const name of Object.keys(result)) {
    if (name.toLowerCase() !== 'referer') continue;
    try {
      const referer = new URL(result[name]!);
      // Doubao's media CDN rejects the chat route as a download referrer.
      // Use its site root; keep other platforms' required page paths intact.
      if (referer.hostname === 'doubao.com' || referer.hostname.endsWith('.doubao.com')) result[name] = `${referer.origin}/`;
    } catch { /* Preserve validation behavior for other caller input. */ }
  }
  return result;
}

export function isSignedMediaCdn(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    const trusted = /^v\d+-(vdl|videoweb)\.doubao\.com$/i.test(url.hostname)
      || /(^|\.)(douyinpic|byteimg)\.com$/i.test(url.hostname);
    const signedPath = /^v\d+-(vdl|videoweb)\.doubao\.com$/i.test(url.hostname) && /^\/[a-f0-9]{32}\/[a-f0-9]{8}\/video\/tos\//i.test(url.pathname);
    return signedPath || trusted && [...url.searchParams.keys()].some((key) => /^(x-signature|signature|auth_key)$/i.test(key) && Boolean(url.searchParams.get(key)));
  } catch { return false; }
}
