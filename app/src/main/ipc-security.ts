export function isTrustedMainFrame(senderId: number, expectedSenderId: number, senderFrameId: number, mainFrameId: number): boolean {
  return senderId === expectedSenderId && senderFrameId === mainFrameId;
}

/**
 * Remote account pages use a different WebContents than the local React UI.
 * They may report page-derived media through the dedicated preload bridge,
 * but only their own main frame is allowed to do so. The caller must still
 * verify ownership with BrowserManager before accepting the message.
 */
export function isTrustedOwnedFrame(senderFrameId: number, mainFrameId: number): boolean {
  return senderFrameId === mainFrameId;
}

/**
 * Page bridges run in a sandboxed remote WebContents and can still be alive
 * for the current document when an adapter is disabled from Settings. Keep
 * the gate in one small pure helper so every remote event path (media,
 * notices and Dola token resolution) applies the same policy.
 */
export function isRemoteAdapterEnabled(platform: string, disabledAdapters: readonly string[]): boolean {
  return !disabledAdapters.includes(platform);
}
