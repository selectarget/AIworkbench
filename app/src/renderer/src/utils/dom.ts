/**
 * Accessible dialog and DOM focus helpers.
 */

// Mounted dialogs, innermost last, so the focus trap can tell which one owns Tab when they stack.
export const openDialogs: HTMLElement[] = [];

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ].filter((node) => node.getClientRects().length > 0);
}

// main.tsx stamps data-platform on <html>, but its `import { App }` is hoisted and runs first,
// so this has to be read at render time rather than captured in a module constant.
export function isWindowsPlatform(): boolean {
  return document.documentElement.dataset.platform === 'windows';
}
