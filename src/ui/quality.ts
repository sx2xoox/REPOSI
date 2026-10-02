// Graphics quality preset (설정 > 그래픽 품질): caps the display resolution
// (Renderer.maxDpr), scales particle density and, on 낮음, skips the light map
// (the world is drawn flat-lit; everything stays readable). Mobile defaults to 보통.

import { save } from '../engine/save';
import { app } from '../game/app';
import type { World } from '../game/world';
import { qualityProfile } from './touch-logic';

/** Apply the current graphics preset (call after changing settings). */
export function applyGraphics(world?: World): void {
  const q = save.settings.graphicsQuality;
  const prof = qualityProfile(q);
  if (app.renderer) {
    app.renderer.maxDpr = prof.dprCap;
    app.renderer.resize();
  }
  const w = world ?? (typeof window !== 'undefined' ? (window as unknown as { __world?: World }).__world : undefined);
  if (!w) return;
  const particles = save.settings.particles * prof.particleMult;
  if (typeof w.setQuality === 'function') w.setQuality({ lighting: q !== 'low', particles });
  else if (w.particles) w.particles.density = particles;
}
