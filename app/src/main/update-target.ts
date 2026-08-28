export type UpdateTarget = 'win32-x64' | 'darwin-x64' | 'darwin-arm64';

export type ReleaseManifestAsset = { name: string; browser_download_url: string };

export function resolveUpdateTarget(platform: string, arch: string): UpdateTarget | null {
  if (platform === 'win32' && arch === 'x64') return 'win32-x64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  return null;
}

export function selectUpdateManifestAsset(assets: readonly ReleaseManifestAsset[], target: UpdateTarget): ReleaseManifestAsset | undefined {
  const targetName = `update-manifest-${target}.json`.toLowerCase();
  return assets.find((asset) => asset.name.toLowerCase() === targetName)
    ?? assets.find((asset) => asset.name.toLowerCase() === 'update-manifest.json');
}

/** Only the GitHub release page returned by the public update API may be opened. */
export function validateReleaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('更新发布页地址无效'); }
  if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) throw new Error('更新发布页只允许打开 GitHub HTTPS 地址');
  return url.href;
}

/**
 * A signed manifest still needs a cheap target sanity check. This does not
 * replace signature verification; it prevents a macOS process from accepting
 * a legacy Windows-only manifest simply because the release has one generic
 * update-manifest.json file.
 */
export function isCompatibleUpdateAsset(name: string, target: UpdateTarget): boolean {
  const normalized = String(name || '').toLowerCase();
  if (!normalized || normalized.includes('update-manifest')) return false;
  if (target === 'win32-x64') return /(?:^|[-_.])(win|windows|win32)(?:[-_.]|$)/i.test(normalized) && /(?:^|[-_.])(x64|amd64|win64)(?:[-_.]|$)/i.test(normalized) && !/(?:^|[-_.])(?:arm64|aarch64)(?:[-_.]|$)/i.test(normalized);
  if (!/(?:^|[-_.])(mac|macos|darwin|osx)(?:[-_.]|$)/i.test(normalized)) return false;
  if (target === 'darwin-x64') return /(?:^|[-_.])(?:x64|amd64|intel)(?:[-_.]|$)/i.test(normalized) && !/(?:^|[-_.])(?:arm64|aarch64)(?:[-_.]|$)/i.test(normalized);
  return /(?:^|[-_.])(?:arm64|aarch64)(?:[-_.]|$)/i.test(normalized);
}
