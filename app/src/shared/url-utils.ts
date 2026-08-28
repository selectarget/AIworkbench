const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const RESOURCE_PROTOCOLS = new Set(['http:', 'https:', 'blob:']);

function trimCapturedQuotes(value: string): string {
  let text = value.trim();
  for (let index = 0; index < 3; index += 1) {
    const first = text[0];
    const last = text[text.length - 1];
    if (text.length < 2 || (first !== '"' && first !== "'") || last !== first) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

function decodeHtmlEntities(value: string): string {
  const named = value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
  return named
    .replace(/&#x([0-9a-f]+);?/gi, (_match, digits: string) => {
      const codePoint = Number.parseInt(digits, 16);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : _match;
    })
    .replace(/&#(\d+);?/g, (_match, digits: string) => {
      const codePoint = Number.parseInt(digits, 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : _match;
    });
}

/**
 * Normalize URLs copied from JSON, SSE, HTML attributes, or a page message.
 * Legacy responses commonly contain escaped slashes, unicode escapes,
 * entities, and one or more layers of surrounding quotes.  Decoding is
 * deliberately bounded and never turns a non-URL into an accepted resource.
 */
export function decodeCapturedUrlText(value: unknown): string {
  let text = trimCapturedQuotes(String(value ?? ''));
  for (let index = 0; index < 3; index += 1) {
    const before = text;
    text = text
      .replace(/\\u([0-9a-f]{4})/gi, (_match, digits: string) => String.fromCharCode(Number.parseInt(digits, 16)))
      .replace(/\\\//g, '/')
      .replace(/\\(["'\\])/g, '$1');
    text = decodeHtmlEntities(trimCapturedQuotes(text));
    text = trimCapturedQuotes(text);
    if (text === before) break;
  }
  return text;
}

export function normalizeCapturedUrl(value: unknown, baseUrl = '', protocols: ReadonlySet<string> = RESOURCE_PROTOCOLS): string {
  const text = decodeCapturedUrlText(value);
  if (!text) return '';
  try {
    const parsed = baseUrl ? new URL(text, baseUrl) : new URL(text);
    return protocols.has(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

export function normalizeCapturedHttpUrl(value: unknown): string {
  return normalizeCapturedUrl(value, '', HTTP_PROTOCOLS);
}
