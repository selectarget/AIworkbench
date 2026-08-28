import { describe, expect, it } from 'vitest';
import { isRemoteAdapterEnabled, isTrustedMainFrame, isTrustedOwnedFrame } from '../src/main/ipc-security';

describe('IPC sender boundary', () => {
  it('accepts only the expected renderer main frame', () => {
    expect(isTrustedMainFrame(10, 10, 20, 20)).toBe(true);
    expect(isTrustedMainFrame(11, 10, 20, 20)).toBe(false);
    expect(isTrustedMainFrame(10, 10, 21, 20)).toBe(false);
  });

  it('accepts only the owned WebContents main frame for remote page bridges', () => {
    expect(isTrustedOwnedFrame(20, 20)).toBe(true);
    expect(isTrustedOwnedFrame(21, 20)).toBe(false);
  });

  it('applies one disabled-adapter gate to every remote page event path', () => {
    expect(isRemoteAdapterEnabled('dola', [])).toBe(true);
    expect(isRemoteAdapterEnabled('dola', ['doubao'])).toBe(true);
    expect(isRemoteAdapterEnabled('dola', ['dola'])).toBe(false);
  });
});
