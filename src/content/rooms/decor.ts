// Floor dressing for special rooms (rugs, ritual circles, coin heaps), painted once
// into the room's decal layer when the room is first populated.

import { PixelPainter, darken, lighten } from '../../engine/painter';
import type { RNG } from '../../engine/rng';
import type { Room } from '../../game/room';
import { hash2, rampPick } from '../../game/roomart';

/** Translucent pixel (decals are composited onto the floor with alpha). */
export function ap(p: PixelPainter, x: number, y: number, color: string, a: number): void {
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
  p.px(x, y, color.slice(0, 7) + v);
}
const shadePx = (p: PixelPainter, x: number, y: number, k: number) => ap(p, x, y, '#000000', k);
const blendPx = ap;

/** Paint with a PixelPainter into the room's decal canvas. */
export function withDecals(room: Room, fn: (p: PixelPainter) => void): void {
  if (typeof document === 'undefined') return;
  const p = new PixelPainter(room.pxW, room.pxH);
  fn(p);
  room.ensureDecals().getContext('2d')!.drawImage(p.toCanvas(), 0, 0);
}

/** Woven rectangular rug with a border band, diamond pattern and fringes. */
export function rectRug(p: PixelPainter, x0: number, y0: number, w: number, h: number, k: string[], accent: string): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const lx = x - x0;
      const ly = y - y0;
      const edge = Math.min(lx, ly, w - 1 - lx, h - 1 - ly);
      let c: string;
      if (edge === 0) c = k[0];
      else if (edge <= 2) c = edge === 1 ? accent : k[1];
      else {
        const cx = Math.abs(lx - w / 2);
        const cy = Math.abs(ly - h / 2);
        const dia = (cx / (w / 2 - 3) + cy / (h / 2 - 3));
        const band = Math.floor(dia * 4);
        c = rampPick(k, 1.6 + (band % 2) * 0.8 + ((lx + ly) % 4 === 0 ? 0.4 : 0) + (hash2(x, y, 3) - 0.5) * 0.4, x, y);
        if (Math.abs(dia - 0.5) < 0.04 || Math.abs(dia - 0.85) < 0.035) c = accent;
      }
      p.px(x, y, c);
    }
  }
  // fringes on the short sides
  for (let y = y0 + 1; y < y0 + h - 1; y += 2) {
    p.px(x0 - 1, y, lighten(accent, 0.2));
    p.px(x0 + w, y, lighten(accent, 0.2));
  }
  // soft shadow under the bottom edge
  for (let x = x0; x < x0 + w; x++) shadePx(p, x, y0 + h, 0.3);
}

/** Round medallion rug. */
export function roundRug(p: PixelPainter, cx: number, cy: number, rx: number, ry: number, k: string[], accent: string): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      if (d > 1) continue;
      let c: string;
      if (d > 0.93) c = k[0];
      else if (d > 0.84) c = accent;
      else if (d > 0.78) c = k[1];
      else {
        const a = Math.atan2(y - cy, x - cx);
        const petal = Math.cos(a * 8) * 0.12;
        c = rampPick(k, 1.5 + (d + petal < 0.45 ? 1 : 0) + (Math.abs(d + petal - 0.6) < 0.05 ? 2 : 0) + (hash2(x, y, 9) - 0.5) * 0.4, x, y);
        if (d < 0.14) c = accent;
      }
      p.px(x, y, c);
    }
  }
  for (let x = Math.floor(cx - rx); x <= cx + rx; x++) shadePx(p, x, Math.round(cy + ry + 1), 0.25);
}

/** Glowing ritual circle with runes (curse / challenge / shrine floors). */
export function ritualCircle(p: PixelPainter, cx: number, cy: number, r: number, color: string, alpha = 0.7): void {
  const ring = (rr: number, a: number) => {
    for (let t = 0; t < Math.PI * 2; t += 0.4 / rr) blendPx(p, cx + Math.cos(t) * rr, cy + Math.sin(t) * rr * 0.62, color, a);
  };
  ring(r, alpha);
  ring(r - 1, alpha * 0.5);
  ring(r * 0.72, alpha * 0.8);
  // star
  const pts = 5;
  for (let i = 0; i < pts; i++) {
    const a0 = -Math.PI / 2 + (i / pts) * Math.PI * 2;
    const a1 = -Math.PI / 2 + (((i + 2) % pts) / pts) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * r * 0.72;
    const y0 = cy + Math.sin(a0) * r * 0.72 * 0.62;
    const x1 = cx + Math.cos(a1) * r * 0.72;
    const y1 = cy + Math.sin(a1) * r * 0.72 * 0.62;
    for (let s = 0; s <= 1; s += 0.02) blendPx(p, x0 + (x1 - x0) * s, y0 + (y1 - y0) * s, color, alpha * 0.75);
  }
  // rune ticks between the rings
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rr = r * 0.86;
    const x = Math.round(cx + Math.cos(a) * rr);
    const y = Math.round(cy + Math.sin(a) * rr * 0.62);
    blendPx(p, x, y, lighten(color, 0.4), alpha);
    blendPx(p, x + (i % 2 ? 1 : 0), y + (i % 2 ? 0 : 1), color, alpha);
  }
}

/** Little heap of coins on the floor. */
export function coinHeap(p: PixelPainter, x: number, y: number, rng: RNG, n = 8): void {
  for (let i = 0; i < n; i++) {
    const cx = Math.round(x + rng.range(-5, 5));
    const cy = Math.round(y + rng.range(-3, 3));
    shadePx(p, cx + 1, cy + 1, 0.4);
    p.px(cx, cy, '#e0a020');
    p.px(cx + 1, cy, '#ffd040');
    p.px(cx, cy - 1, '#fff0a0');
  }
}

export function darkRing(p: PixelPainter, cx: number, cy: number, r: number, k: number): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r * 1.6); x <= cx + r * 1.6; x++) {
    const d = Math.hypot((x - cx) / 1.6, y - cy) / r;
    if (d <= 1) shadePx(p, x, y, k * (1 - d));
  }
}

export { darken, lighten };
