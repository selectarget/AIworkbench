export function isDoubaoPlaybackStream(value: string): boolean {
  try { return /^v\d+-vdl\.doubao\.com$/i.test(new URL(value).hostname); }
  catch { return false; }
}

export function supersededDoubaoPlayback(downloadedUrl: string | undefined, currentUrl: string): boolean {
  return Boolean(downloadedUrl && currentUrl && isDoubaoPlaybackStream(downloadedUrl) && !isDoubaoPlaybackStream(currentUrl));
}
