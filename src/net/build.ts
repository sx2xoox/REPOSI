// Build identity + service-worker updates.
//
// Lockstep needs every peer to run identical code, so the lobby compares build
// ids (vite `define` __LK_BUILD__: git short hash + build time; 'dev' in dev).
// The service worker (sw.js, emitted by vite.config.ts) caches the game for
// offline play; to keep players on the newest deploy, the page checks for a new
// worker periodically / when it becomes visible / when the co-op lobby opens,
// and reloads itself once a new worker has taken over and the player is idle
// on the title screen.

declare const __LK_BUILD__: string | undefined;

/** Identifier of this build ('dev' under the dev server and tests). */
export const BUILD_ID: string = typeof __LK_BUILD__ === 'string' && __LK_BUILD__ ? __LK_BUILD__ : 'dev';

let updateCheck: (() => void) | null = null;
let reloadPending = false;

/** A newer deploy has taken over this page (reload when convenient). */
export function updatePending(): boolean {
  return reloadPending;
}

/** Ask the browser to look for a newer sw.js now (no-op without a service worker). */
export function checkForUpdate(): void {
  updateCheck?.();
}

/**
 * Register sw.js and keep the page current. `isIdle` says when a reload would
 * not interrupt anything (the title screen).
 */
export function installServiceWorker(isIdle: () => boolean): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // the very first install claims the page too: nothing changed, no reload
  let hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    reloadPending = true;
  });
  window.addEventListener('load', () => {
    sw.register('./sw.js')
      .then((reg) => {
        updateCheck = () => void reg.update().catch(() => undefined);
        setInterval(() => updateCheck?.(), 30 * 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') updateCheck?.();
        });
      })
      .catch((e) => console.warn('service worker registration failed', e));
  });
  setInterval(() => {
    if (reloadPending && isIdle()) location.reload();
  }, 1000);
}
