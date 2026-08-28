import { extname } from 'node:path';

export type MediaKind = 'image' | 'video' | 'other';

const imageExtensions = new Set([
  '.png', '.apng', '.jpg', '.jpeg', '.jfif', '.webp', '.gif', '.bmp', '.dib',
  '.tif', '.tiff', '.avif', '.heic', '.heif', '.svg', '.ico', '.jxl'
]);
const videoExtensions = new Set([
  '.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.flv', '.ts', '.m2ts',
  '.mts', '.mpeg', '.mpg', '.3gp', '.3g2', '.ogv'
]);

const mimeExtensions = new Map<string, string>([
  ['image/jpeg', '.jpg'], ['image/jpg', '.jpg'], ['image/pjpeg', '.jpg'],
  ['image/png', '.png'], ['image/apng', '.png'], ['image/webp', '.webp'],
  ['image/gif', '.gif'], ['image/bmp', '.bmp'], ['image/x-bmp', '.bmp'],
  ['image/x-ms-bmp', '.bmp'], ['image/tiff', '.tiff'], ['image/x-tiff', '.tiff'],
  ['image/avif', '.avif'], ['image/avif-sequence', '.avif'],
  ['image/heic', '.heic'], ['image/heic-sequence', '.heic'],
  ['image/heif', '.heif'], ['image/heif-sequence', '.heif'],
  ['image/svg+xml', '.svg'], ['image/x-icon', '.ico'], ['image/vnd.microsoft.icon', '.ico'],
  ['image/jxl', '.jxl'],
  ['video/mp4', '.mp4'], ['video/webm', '.webm'], ['video/quicktime', '.mov'],
  ['video/x-m4v', '.m4v'], ['video/x-matroska', '.mkv'], ['video/matroska', '.mkv'],
  ['video/x-msvideo', '.avi'], ['video/avi', '.avi'], ['video/x-flv', '.flv'],
  ['video/mpeg', '.mpeg'], ['video/mp2t', '.ts'], ['video/3gpp', '.3gp'],
  ['video/3gpp2', '.3g2'], ['video/ogg', '.ogv'],
  ['audio/mpeg', '.mp3'], ['audio/mp4', '.m4a']
]);

/** Return a lower-case extension from either a file path or an absolute URL. */
export function extensionFromValue(value: string): string {
  const input = String(value ?? '').trim();
  if (!input) return '';
  let pathname = input;
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) pathname = new URL(input).pathname;
  } catch {
    // Fall back to the path-like text below. A malformed URL must not break a download.
  }
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? '';
  // Callers also pass a bare suffix such as `.png` when validating a MIME
  // mapping. Node's extname treats that value as a dot-file and returns an
  // empty string, so handle it explicitly.
  if (/^\.[a-z\d]{1,12}$/i.test(pathOnly)) return pathOnly.toLowerCase();
  return extname(pathOnly).toLowerCase();
}

/** Normalize equivalent image suffixes to the suffix used by the workbench. */
export function canonicalMediaExtension(value: string): string | undefined {
  const extension = extensionFromValue(value);
  if (!extension) return undefined;
  if (extension === '.jpeg' || extension === '.jfif') return '.jpg';
  if (extension === '.apng') return '.png';
  if (extension === '.tif') return '.tiff';
  if (extension === '.dib') return '.bmp';
  return imageExtensions.has(extension) || videoExtensions.has(extension) ? extension : undefined;
}

export function mediaTypeFromExtension(value: string): MediaKind {
  const extension = extensionFromValue(value);
  if (imageExtensions.has(extension)) return 'image';
  if (videoExtensions.has(extension)) return 'video';
  return 'other';
}

export function normalizeContentType(value: string): string {
  return String(value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function extensionFromMimeType(value: string): string | undefined {
  return mimeExtensions.get(normalizeContentType(value));
}

export function mediaTypeFromMimeType(value: string): MediaKind {
  const normalized = normalizeContentType(value);
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  return 'other';
}

export function isImageExtension(value: string): boolean { return mediaTypeFromExtension(value) === 'image'; }
export function isVideoExtension(value: string): boolean { return mediaTypeFromExtension(value) === 'video'; }

function startsWithAscii(bytes: Uint8Array, value: string, offset = 0): boolean {
  if (bytes.length < offset + value.length) return false;
  for (let index = 0; index < value.length; index++) if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  return true;
}

function isoBmffImageExtension(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12 || !startsWithAscii(bytes, 'ftyp', 4)) return undefined;
  let avif = false;
  let heic = false;
  let heif = false;
  const end = Math.min(bytes.length, 64);
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    const brand = String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
    avif ||= brand === 'avif' || brand === 'avis';
    heic ||= brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx';
    heif ||= brand === 'heif' || brand === 'mif1' || brand === 'msf1';
  }
  if (avif) return '.avif';
  if (heic) return '.heic';
  return heif ? '.heif' : undefined;
}

/** Identify a media suffix from the bytes already read from a response. */
export function mediaExtensionFromSignature(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes?.length) return undefined;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
  if (startsWithAscii(bytes, '\x89PNG')) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return '.png';
  }
  if (bytes.length >= 12 && startsWithAscii(bytes, 'RIFF') && startsWithAscii(bytes, 'WEBP', 8)) return '.webp';
  if (startsWithAscii(bytes, 'GIF87a') || startsWithAscii(bytes, 'GIF89a')) return '.gif';
  if (startsWithAscii(bytes, 'BM')) return '.bmp';
  if (bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))) return '.tiff';
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return '.ico';
  if ((bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0x0a) || (bytes.length >= 12 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x0c && startsWithAscii(bytes, 'JXL ', 4) && bytes[8] === 0x0d && bytes[9] === 0x0a && bytes[10] === 0x87 && bytes[11] === 0x0a)) return '.jxl';
  const imageContainer = isoBmffImageExtension(bytes);
  if (imageContainer) return imageContainer;
  if (startsWithAscii(bytes, '\x1aE\xdf\xa3')) return '.webm';
  if (startsWithAscii(bytes, 'FLV')) return '.flv';
  if (bytes.length >= 12 && startsWithAscii(bytes, 'RIFF') && startsWithAscii(bytes, 'AVI ', 8)) return '.avi';
  if (startsWithAscii(bytes, 'OggS')) return '.ogv';
  const text = Buffer.from(bytes).toString('utf8').replace(/^\ufeff/, '').trimStart();
  if (/^<svg(?:\s|>)/i.test(text) || (/^<\?xml/i.test(text) && /<svg(?:\s|>)/i.test(text))) return '.svg';
  const brand = bytes.length >= 12 && startsWithAscii(bytes, 'ftyp', 4) ? String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0) : '';
  if (brand === 'qt  ') return '.mov';
  if (/^(?:isom|iso2|iso5|iso6|iso8|iso9|mp41|mp42|avc1|M4V |dash|cmfc|msdh|msix)$/.test(brand)) return '.mp4';
  return undefined;
}
