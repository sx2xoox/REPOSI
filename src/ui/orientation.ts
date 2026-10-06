export interface OrientationState {
  userAgent: string; platform: string; touchPoints: number; coarse: boolean;
  orientation?: string; width: number; height: number;
}

/** Touch-capable Windows PCs and narrow desktop windows are never phones. */
export function needsLandscape(s: OrientationState): boolean {
  const mobile = /Android|iPhone|iPad|iPod/i.test(s.userAgent)
    || (s.platform === 'MacIntel' && s.touchPoints > 1);
  if (!mobile || !s.coarse || s.width <= 0 || s.height <= 0) return false;
  if (s.orientation?.startsWith('landscape')) return false;
  return s.height > s.width * 1.12;
}

let shown = false;
export function landscapePromptShown(): boolean { return shown; }

export function installOrientationPrompt(): void {
  let since = 0;
  const check = () => {
    const wants = needsLandscape({ userAgent: navigator.userAgent, platform: navigator.platform,
      touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches,
      orientation: screen.orientation?.type, width: innerWidth, height: innerHeight });
    if (!wants) { since = 0; shown = false; }
    else if (!since) since = performance.now();
    else if (performance.now() - since >= 750) shown = true;
    document.documentElement.classList.toggle('needs-landscape', shown);
  };
  check();
  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
  document.addEventListener('visibilitychange', check);
  setInterval(check, 250);
}
