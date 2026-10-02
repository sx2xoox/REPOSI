// Graphics quality preset (설정 > 그래픽 품질): caps the display resolution
// (devicePixelRatio) and scales particle density. Mobile defaults to 보통.

import { save } from '../engine/save';
import { app } from '../game/app';
import type { World } from '../game/world';
import { qualityProfile } from './touch-logic';

let dprCap = 2;
let installed = false;

/**
 * The renderer sizes its canvas from window.devicePixelRatio (capped at 2);
 * shadow that getter with a lower, settings-driven cap so low-end phones
 * render fewer pixels without touching the renderer.
 */
function installDprCap(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    let desc: PropertyDescriptor | undefined;
    for (let o: object | null = window; o && !desc; o = Object.getPrototypeOf(o)) desc = Object.getOwnPropertyDescriptor(o, 'devicePixelRatio');
    const getter = desc?.get;
    const fixed = window.devicePixelRatio || 1;
    const real = getter ? () => Number(getter.call(window)) || 1 : () => fixed;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, enumerable: true, get: () => Math.min(real(), dprCap) });
  } catch {
    // non-configurable in this browser: quality only affects particles
  }
}

/** Apply the current graphics preset (call after changing settings). */
export function applyGraphics(world?: World): void {
  const prof = qualityProfile(save.settings.graphicsQuality);
  installDprCap();
  dprCap = prof.dprCap;
  app.renderer?.resize();
  const w = world ?? (typeof window !== 'undefined' ? (window as unknown as { __world?: World }).__world : undefined);
  if (w?.particles) w.particles.density = save.settings.particles * prof.particleMult;
}
