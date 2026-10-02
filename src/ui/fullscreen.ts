// Fullscreen + landscape lock helpers (mobile browsers). Must be called from
// a user gesture (touch handler) or shortly after one.

interface LockableOrientation extends ScreenOrientation {
  lock?: (o: string) => Promise<void>;
}

export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenEnabled && !isStandalone();
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenElement;
}

/** Launched as an installed PWA (already fullscreen)? */
export function isStandalone(): boolean {
  try {
    return typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: fullscreen)').matches || window.matchMedia?.('(display-mode: standalone)').matches);
  } catch {
    return false;
  }
}

export function toggleFullscreen(): void {
  if (typeof document === 'undefined') return;
  if (document.fullscreenElement) {
    void document.exitFullscreen?.().catch(() => undefined);
    return;
  }
  const el = document.documentElement;
  const p = el.requestFullscreen?.({ navigationUI: 'hide' });
  if (p) {
    void p.then(() => {
      const o = screen.orientation as LockableOrientation | undefined;
      return o?.lock?.('landscape');
    }).catch(() => undefined);
  }
}
