// Screen geometry helpers shared by the renderer and the touch layer:
// the CSS size of the game canvas (follows 100dvh / the visual viewport on
// mobile) and the device safe-area insets (rounded corners, notch / camera
// cutout, home indicator) read from CSS `env(safe-area-inset-*)`.

export interface Insets {
  l: number;
  r: number;
  t: number;
  b: number;
}

export const NO_INSETS: Insets = { l: 0, r: 0, t: 0, b: 0 };

let probe: HTMLDivElement | null = null;
let cached: Insets = { ...NO_INSETS };
let dirty = true;
let listening = false;

function markDirty(): void {
  dirty = true;
}

/**
 * Safe-area insets in CSS px. Debug / automation can force values with
 * `window.__lkSafeOverride = { l, r, t, b }` (desktop browsers report 0).
 */
export function safeInsets(): Insets {
  if (typeof window === 'undefined' || typeof document === 'undefined') return NO_INSETS;
  const ov = (window as unknown as { __lkSafeOverride?: Partial<Insets> }).__lkSafeOverride;
  if (ov) return { l: ov.l ?? 0, r: ov.r ?? 0, t: ov.t ?? 0, b: ov.b ?? 0 };
  if (!listening) {
    listening = true;
    window.addEventListener('resize', markDirty);
    window.addEventListener('orientationchange', markDirty);
    window.visualViewport?.addEventListener('resize', markDirty);
  }
  if (!dirty) return cached;
  if (!probe && document.body) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(probe);
  }
  if (!probe) return cached;
  const cs = getComputedStyle(probe);
  cached = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  dirty = false;
  return cached;
}

/** Force the next `safeInsets()` call to re-read the CSS values. */
export function invalidateSafeInsets(): void {
  dirty = true;
}

/** CSS px size of the game canvas (falls back to the visual / layout viewport). */
export function cssViewportSize(canvas?: HTMLCanvasElement | null): { w: number; h: number } {
  if (canvas) {
    const r = canvas.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
  }
  if (typeof window === 'undefined') return { w: 1280, h: 720 };
  const vv = window.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0) return { w: vv.width * (vv.scale || 1), h: vv.height * (vv.scale || 1) };
  return { w: window.innerWidth || 1280, h: window.innerHeight || 720 };
}
