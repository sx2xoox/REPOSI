import type { Renderer } from '../../engine/renderer';
import type { SupportFamily } from './refuge-common';

const TAU = Math.PI * 2;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const out = (t: number, duration: number): number => clamp01(1 - t / duration);

/**
 * All choreography is sampled from simulation age. Draws never write state.
 * Every stroke is a crisp pixel line (Renderer.pixelLine): a dark wide pass
 * under a bright narrow one reads as an outlined pixel shape, not a blur.
 */
function line(r: Renderer, x: number, y: number, angle: number, ax: number, ay: number, bx: number, by: number,
  color: string, width = 1, alpha = 1): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  r.pixelLine(x + c * ax - s * ay, y + s * ax + c * ay, x + c * bx - s * by, y + s * bx + c * by, color, width, clamp01(alpha));
}

function path(r: Renderer, x: number, y: number, angle: number, points: readonly (readonly [number, number])[], color: string, width: number, alpha: number): void {
  for (let i = 1; i < points.length; i++) line(r, x, y, angle, ...points[i - 1], ...points[i], color, width, alpha);
}

function diamond(r: Renderer, x: number, y: number, radius: number, color: string, alpha: number, angle = 0): void {
  path(r, x, y, angle, [[-radius, 0], [0, -radius * .65], [radius, 0], [0, radius * .65], [-radius, 0]], color, 1, alpha);
}

/** Small, pointed impact glint. Its bright area stays smaller than an enemy. */
function glint(r: Renderer, x: number, y: number, angle: number, size: number, alpha: number, color = '#fff0d5'): void {
  if (alpha <= 0) return;
  line(r, x, y, angle, -size, 0, size, 0, '#463146', 3, alpha * .45);
  line(r, x, y, angle, -size, 0, size, 0, color, 1, alpha);
  line(r, x, y, angle, 0, -size * .55, 0, size * .55, color, 1, alpha * .8);
  r.rect(x - 1, y - 1, 2, 2, '#fff8e5', alpha);
}

/**
 * A crisp fireball: white flash, a rising fire core in three heat bands, a
 * soot rim on the ground and a thin shock ring. Sparks, smoke and grit are
 * particles spawned by the simulation at the same moment (blastImpact).
 */
export function drawBlast(r: Renderer, x: number, y: number, t: number, radius: number, heavy = false): void {
  const life = heavy ? .46 : .36;
  if (t < 0 || t > life) return;
  const k = clamp01(t / life), grow = 1 - Math.pow(1 - clamp01(t / .1), 3);
  const shock = radius * (.3 + .7 * (1 - Math.pow(1 - clamp01(t / .2), 2)));
  r.pixelRing(x, y, shock, '#fff0c8', heavy ? 2 : 1, out(t, .2) * .85);
  r.pixelRing(x, y + 1, radius * .5 * grow, '#2a1a20', 2, out(t, .3) * .45);
  const core = radius * (heavy ? .4 : .34), fire = out(t - .06, life - .06), lift = (heavy ? 9 : 6) * k;
  const size = core * (t < .1 ? .55 + grow * .55 : 1.1 * (1 - (k - .2) * .9));
  if (size > .8) {
    // soot outline first, so the lobes read as one chunky silhouette
    r.pixelDisc(x - size * .42, y + size * .12 - lift, size * .7 + 1, '#3a1418', fire * .9);
    r.pixelDisc(x + size * .42, y + size * .16 - lift, size * .66 + 1, '#3a1418', fire * .9);
    r.pixelDisc(x, y - size * .3 - lift, size * .8 + 1, '#3a1418', fire * .9);
    r.pixelDisc(x - size * .42, y + size * .12 - lift, size * .7, '#a8321e', fire);
    r.pixelDisc(x + size * .42, y + size * .16 - lift, size * .66, '#a8321e', fire);
    r.pixelDisc(x, y - size * .3 - lift, size * .8, '#c8482a', fire);
    r.pixelDisc(x, y - size * .08 - lift, size * .72, '#f08a32', fire);
    r.pixelDisc(x - size * .14, y - size * .26 - lift, size * .46, '#ffcf6e', fire);
    r.pixelDisc(x - size * .2, y - size * .36 - lift, size * .22, '#fff6dc', fire);
  }
  if (t < .07) {
    // the flash: a small hot core with four short spikes, not a flat disc
    const f = 1 - t / .07, spike = core * (1.3 - t * 5);
    r.pixelDisc(x, y - 2, core * .55, '#ffffff', f);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) r.pixelLine(x, y - 2, x + dx * spike, y - 2 + dy * spike * .7, '#fff6dc', 2, f);
  }
  // a few hot embers thrown up and out (fixed by index: deterministic in drawing)
  const ember = out(t, life);
  for (let i = 0; i < (heavy ? 8 : 5); i++) {
    const a = -Math.PI / 2 + (i / ((heavy ? 8 : 5) - 1) - .5) * 2.6, d = radius * (.25 + .55 * grow) * (i % 2 ? .8 : 1);
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * .7 - lift - k * k * -10;
    r.rect(px - 1, py - 1, 2, 2, i % 3 ? '#ffd27a' : '#fff4d8', ember);
  }
}

/** Tove's charge: three bound sticks and a shortening fuse (remaining 1 → 0), at (x, y) = its center. */
export function drawCharge(r: Renderer, x: number, y: number, remaining: number, age: number, pulse = 1, alpha = 1): void {
  const pop = Math.max(0, 1 - age / .12);
  r.rect(x - 5, y - 4, 10, 8, '#282332', alpha);
  for (let i = 0; i < 3; i++) {
    const sx = x - 4 + i * 3;
    r.rect(sx, y - 3, 2, 6, i === 1 ? '#c58250' : '#9d573e', alpha);
    r.rect(sx, y - 3, 1, 4, '#e2ae71', alpha);
  }
  r.rect(x - 4, y - 1, 8, 2, '#e8c793', alpha);
  r.rect(x - 1, y - 1, 2, 2, '#9d7556', alpha);
  const fuseX = x + 4 + remaining * 5, fuseY = y - 3 - remaining * 3;
  r.pixelLine(x + 3, y - 2, fuseX, fuseY, '#231d2b', 3, alpha);
  r.pixelLine(x + 3, y - 2, fuseX, fuseY, '#e5cfa6', 1, alpha);
  r.rect(fuseX - 1, fuseY - 1, 2, 2, '#fff3c8', pulse * alpha);
  r.rect(fuseX + 2, fuseY - 3, 1, 1, '#f6a35a', pulse * .8 * alpha);
  if (pop > 0) for (const side of [-1, 1]) r.pixelLine(x + side * (6 + pop * 3), y - 2, x + side * (8 + pop * 5), y - 4, '#fff0be', 1, pop * alpha);
}

/** Ves: a streak from where the keeper was to where she lands, and a cross cut on the target. */
export function drawBlinkStrike(r: Renderer, fx: number, fy: number, tx: number, ty: number, cx: number, cy: number, t: number, hand: number, final: boolean): void {
  if (t < 0 || t > .36) return;
  const fade = out(t, .36), streak = out(t, .18);
  const color = hand < 0 ? '#ee9fb6' : hand > 0 ? '#9fcbe8' : '#f4e6f0';
  if (streak > 0) {
    r.pixelLine(fx, fy - 6, tx, ty - 6, '#3a2440', 5, streak * .5);
    r.pixelLine(fx, fy - 6, tx, ty - 6, color, 3, streak * .9);
    r.pixelLine(fx, fy - 6, tx, ty - 6, '#ffffff', 1, streak);
  }
  const size = (final ? 17 : 12) * (.7 + .3 * clamp01(t / .06)), a = Math.atan2(ty - fy, tx - fx);
  for (const side of [-1, 1]) {
    const k = a + side * .78;
    line(r, cx, cy - 6, k, -size, 0, size, 0, '#3a2440', final ? 5 : 4, fade * .6);
    line(r, cx, cy - 6, k, -size, 0, size, 0, side < 0 ? '#ee9fb6' : '#9fcbe8', final ? 3 : 2, fade);
    line(r, cx, cy - 6, k, -size + 2, 0, size - 2, 0, '#ffffff', 1, fade);
  }
  glint(r, cx, cy - 6, a, final ? 9 : 6, out(t, .12));
}

/** Mira: a dome of stopped time: pale floor, a ring of pages and a clock whose hands stand still. */
export function drawStasis(r: Renderer, x: number, y: number, radius: number, t: number, alpha: number, pulse: number, closing: number): void {
  if (alpha <= 0) return;
  const shrink = 1 - closing * .85, rad = radius * shrink;
  r.pixelDisc(x, y, rad, '#b3c9ee', alpha * (.1 + pulse * .06));
  r.pixelRing(x, y, rad, '#3c415b', 3, alpha * .55);
  r.pixelRing(x, y, rad, '#d5e1f3', 1, alpha * (.75 + pulse * .25));
  // twelve hour ticks, then two hands frozen at a fixed hour
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, inner = rad - (i % 3 === 0 ? 7 : 4);
    r.pixelLine(x + Math.cos(a) * inner, y + Math.sin(a) * inner, x + Math.cos(a) * (rad - 1), y + Math.sin(a) * (rad - 1), i % 3 === 0 ? '#eef2ff' : '#9fb4d8', 1, alpha * .8);
  }
  const hand = -Math.PI / 2 + Math.sin(t * 40) * .02 * (1 - closing);
  line(r, x, y, hand, 0, 0, rad * .55, 0, '#3c415b', 3, alpha * .7);
  line(r, x, y, hand, 0, 0, rad * .55, 0, '#eef2ff', 1, alpha);
  line(r, x, y, hand + 2.1, 0, 0, rad * .38, 0, '#3c415b', 3, alpha * .7);
  line(r, x, y, hand + 2.1, 0, 0, rad * .38, 0, '#c8d4ee', 1, alpha);
  r.pixelDisc(x, y, 2, '#ffffff', alpha);
  // pages pinned round the rim (they fly in when the dome closes)
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + t * .15 * (1 - closing), d = rad + 2;
    bookMark(r, x + Math.cos(a) * d, y + Math.sin(a) * d, a + Math.PI / 2, alpha * .9, .8, .8);
  }
}

/** Woven loops cross over and under a small ivory shuttle, never an orbiting orb. */
export function drawThreadKnot(r: Renderer, x: number, y: number, t: number, radius: number, alpha = 1): void {
  const a = Math.sin(t * 2) * .08, h = radius * .62;
  const first: [number, number][] = [[-radius, 0], [-radius * .25, -h], [radius * .25, h], [radius, 0]];
  const second: [number, number][] = [[-radius, 0], [-radius * .25, h], [radius * .25, -h], [radius, 0]];
  path(r, x, y, a, first, '#594361', 3, alpha * .6);
  path(r, x, y, a, second, '#594361', 3, alpha * .6);
  path(r, x, y, a, first, '#b79bda', 1, alpha);
  path(r, x, y, a, second, '#f0d7e9', 1, alpha * .95);
  line(r, x, y, a, -radius * .7, 0, radius * .7, 0, '#bca7db', 1, alpha * .4);
  diamond(r, x, y, Math.max(2, radius * .25), '#fff0d7', alpha, Math.PI / 2);
  r.rect(x - 1, y - 1, 2, 2, '#fff3e3', alpha);
}

/** Sparse curved threads expose their tension and carry one moving shuttle. */
export function drawWovenThread(r: Renderer, ax: number, ay: number, bx: number, by: number, t: number, alpha: number, bend: number): void {
  const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
  const point = (k: number): [number, number] => [ax + dx * k + nx * Math.sin(k * Math.PI) * bend, ay + dy * k + ny * Math.sin(k * Math.PI) * bend];
  for (let i = 0; i < 8; i++) {
    const a = point(i / 8), b = point((i + 1) / 8);
    r.pixelLine(...a, ...b, '#584666', 2, alpha * .35);
    r.pixelLine(...a, ...b, i % 2 ? '#d4bce9' : '#a58dc9', 1, alpha);
  }
  const p = point((t * 1.7) % 1);
  r.rect(p[0] - 1, p[1] - 1, 2, 2, '#fff0d7', alpha);
}

export function drawThreadCut(r: Renderer, x: number, y: number, t: number, stage: number): void {
  if (t < 0 || t > .3) return;
  const k = clamp01(t / .3), fade = 1 - k, angle = stage === 1 ? -.8 : .8;
  const extent = (stage === 2 ? 15 : 9) + k * 8;
  line(r, x, y, angle, -extent, 0, extent, 0, '#7d588d', 4 * fade + 1, fade * .5);
  line(r, x, y, angle, -extent, 0, extent, 0, '#f8dfef', 1, fade);
  glint(r, x, y, angle + Math.PI / 2, 5 * fade, fade, '#fff3e4');
  for (const side of [-1, 1]) {
    const d = 5 + k * 13;
    path(r, x + side * d, y - k * 5, side * k, [[-4, -2], [0, 2], [5, -1]], '#c4a5df', 1, fade * .8);
  }
}

/** Faceted metal body, turned rim and two readable durability notches. */
export function drawShield(r: Renderer, x: number, y: number, angle: number, radius: number, charges: number, alpha = 1): void {
  const strength = charges > 0 ? 1 : .35;
  const shape: [number, number][] = [[-4, -radius], [3, -radius + 3], [8, -radius * .38], [9, 0], [8, radius * .38], [3, radius - 3], [-4, radius], [-7, radius * .55], [-7, -radius * .55], [-4, -radius]];
  // A narrow translucent body, with an opaque bevel only on its leading edge.
  line(r, x, y, angle, -1, -radius + 5, -1, radius - 5, '#34534b', 10, alpha * .48 * strength);
  path(r, x - Math.cos(angle) * 2, y - Math.sin(angle) * 2 + 2, angle, shape, '#263d3d', 3, alpha * .65);
  path(r, x, y, angle, shape, charges > 0 ? '#92c1a5' : '#607b73', 2, alpha * strength);
  path(r, x, y, angle, [[3, -radius + 3], [8, -radius * .38], [9, 0], [8, radius * .38], [3, radius - 3]], '#dceccb', 2, alpha * strength);
  line(r, x, y, angle, 2, -radius * .65, 2, radius * .65, '#6c9b82', 3, alpha * .45 * strength);
  for (const side of [-1, 1]) {
    line(r, x, y, angle, -5, side * radius * .57, 6, side * radius * .36, '#5f947e', 1, alpha * strength);
    line(r, x, y, angle, 0, side * (radius - 5), 2, side * (radius - 5), '#f4ddb0', 2, alpha * strength);
  }
  diamond(r, x + Math.cos(angle) * 2, y + Math.sin(angle) * 2, 4, '#ead7a8', alpha * strength, angle);
  for (let i = 0; i < 2; i++) {
    line(r, x, y, angle, -4, i ? 6 : -6, 1, i ? 6 : -6, '#243d38', 3, alpha);
    line(r, x, y, angle, -3, i ? 6 : -6, 0, i ? 6 : -6, i < charges ? '#e2edc7' : '#49685b', 1, alpha);
  }
}

/** Only a few ground chevrons and dust flecks follow a moving shield. */
export function drawShieldWake(r: Renderer, x: number, y: number, angle: number, t: number, forward: boolean, alpha = 1): void {
  const direction = forward ? 1 : -1;
  for (let i = 0; i < 3; i++) {
    const lag = 10 + i * 11, a = alpha * (1 - i / 3) * .3;
    path(r, x, y, angle, [[-direction * lag - 5, -21], [-direction * lag + 2, 0], [-direction * lag - 5, 21]], '#8dbd9f', 1, a);
    for (const side of [-1, 1]) {
      const drift = ((t * 22 + i * 5) % 13);
      line(r, x, y, angle, -direction * (lag + drift), side * (20 + drift * .2), -direction * (lag + drift + 3), side * (20 + drift * .2), '#c6c59b', 1, a * 1.4);
    }
  }
}

function bookMark(r: Renderer, x: number, y: number, angle: number, alpha: number, open = 1, scale = 1): void {
  const width = (3 + open * 3) * scale, height = 5 * scale;
  for (const side of [-1, 1]) {
    line(r, x, y, angle, side * width * .55, -height + 1, side * width * .55, height - 2, '#92a6c8', Math.max(1, width - 1), alpha * .6);
    path(r, x, y, angle, [[0, -height + 1], [side * width, -height - 1], [side * width, height - 1], [0, height + 1]], '#3c415b', 3, alpha * .85);
    path(r, x, y, angle, [[0, -height + 1], [side * width, -height - 1], [side * width, height - 1], [0, height + 1]], '#d5dcef', 1, alpha);
    line(r, x, y, angle, side * 1, -height + 1, side * (width - 1), -height, '#f0e5cd', 1, alpha * .9);
    line(r, x, y, angle, side * 2, -1, side * (width - 1), -2, '#8ba2c7', 1, alpha * .75);
    line(r, x, y, angle, side * 2, 2, side * (width - 1), 1, '#8ba2c7', 1, alpha * .65);
  }
  line(r, x, y, angle, 0, -height + 1, 0, height + 2, '#eddfbf', 1, alpha);
}

/** Four indexed page boundaries and a central seal keep the protected area hollow. */
export function drawSeal(r: Renderer, x: number, y: number, radius: number, t: number, alpha = 1, pulse = 0): void {
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    // Broken quarter corners hint at the actual circular footprint without a full ring.
    for (let j = 0; j < 3; j++) {
      const u = a - .2 + j * .13, v = u + .13;
      r.pixelLine(x + Math.cos(u) * radius, y + Math.sin(u) * radius,
        x + Math.cos(v) * radius, y + Math.sin(v) * radius, '#9aafd4', 1, alpha * (.4 + pulse * .15));
    }
    const px = x + Math.cos(a) * (radius - 5), py = y + Math.sin(a) * (radius - 5);
    line(r, px, py, a, -3, -3, 2, -3, '#d5e1f3', 1, alpha * .75);
    line(r, px, py, a, -3, 0, 0, 0, '#91a9cd', 1, alpha * .55);
    if (pulse > 0) {
      const d = 8 + (1 - pulse) * (radius - 15);
      diamond(r, x + Math.cos(a) * d, y + Math.sin(a) * d, 2, '#e1e8f4', pulse * alpha * .6, a);
    }
  }
  diamond(r, x, y, 15, '#718cb8', alpha * .32);
  bookMark(r, x, y - 1, Math.sin(t * 1.2) * .035, alpha * .65, .85);
  for (const side of [-1, 1]) r.rect(x + side * 11 - 1, y + 8, 2, 1, '#d8c9ac', alpha * .7);
}

function slash(r: Renderer, x: number, y: number, angle: number, radius: number, t: number, color: string, reverse = false,
  clip?: (angle: number, radius: number) => number): void {
  if (t < 0 || t > .3) return;
  const k = clamp01(t / .3), direction = reverse ? -1 : 1;
  const head = angle + direction * (-1.1 + clamp01(k * 3) * 2.2), fade = out(t, .3);
  // a solid crescent: dark rim, colored body, white leading edge; thick at the head, thin at the tail
  for (let i = 0; i < 16; i++) {
    const a = head - direction * i * .07, b = a - direction * .075, tail = 1 - i / 16;
    const ra = clip ? clip(a, radius) : radius, rb = clip ? clip(b, radius) : radius;
    // Occluded arc pieces disappear; projecting them onto a wall would draw a false rail.
    if (ra < radius - 4 || rb < radius - 4) continue;
    const thick = Math.max(1, Math.round(tail * 4));
    const ax = x + Math.cos(a) * ra, ay = y + Math.sin(a) * ra;
    const bx = x + Math.cos(b) * rb, by = y + Math.sin(b) * rb;
    r.pixelLine(ax, ay, bx, by, '#3a2440', thick + 2, fade * .55 * tail);
    r.pixelLine(ax, ay, bx, by, color, thick, fade * .95 * tail);
    r.pixelLine(x + Math.cos(a) * (ra + thick / 2), y + Math.sin(a) * (ra + thick / 2), x + Math.cos(b) * (rb + thick / 2), y + Math.sin(b) * (rb + thick / 2), '#fff6ee', 1, fade * tail);
  }
  const tip = clip ? clip(head, radius) : radius;
  glint(r, x + Math.cos(head) * tip, y + Math.sin(head) * tip, head, 4, fade);
}

/** Support skills preserve their existing impact times: .12 / .24 / .12,.34,.56. */
export function drawSupport(r: Renderer, ax: number, ay: number, tx: number, ty: number, t: number, family: SupportFamily, scale = 1): void {
  if (t < 0 || t > .86) return;
  const angle = Math.atan2(ty - ay, tx - ax);
  if (family === 0) {
    const prep = out(t, .12);
    for (const side of [-1, 1]) {
      line(r, tx, ty, angle + side * .72, -12 - prep * 6, 0, -3 - prep * 6, 0, side > 0 ? '#edb6c7' : '#b3d2e3', 2, prep * .7);
      slash(r, tx, ty, angle + side * .72, 19 * scale, t - .12, side > 0 ? '#e9b4c6' : '#afcddd', side < 0);
    }
    glint(r, tx, ty, angle + .8, 8, out(t - .12, .16) * Number(t >= .12));
  } else if (family === 1) {
    const q = clamp01(t / .12), fade = out(Math.max(0, t - .12), .25), px = ax + (tx - ax) * q, py = ay + (ty - ay) * q;
    r.pixelLine(ax, ay, px, py, '#6c486a', 3, fade * .25);
    r.pixelLine(ax, ay, px, py, '#efc5d5', 1, fade * .8);
    path(r, px, py, angle, [[-7, -3], [1, 0], [-7, 3]], '#fff0db', 1, fade);
    if (t >= .12) glint(r, tx, ty, angle + .8, 9, out(t - .12, .2));
  } else if (family === 2) {
    if (t < .24) {
      const k = t / .24, px = ax + (tx - ax) * k, py = ay + (ty - ay) * k - Math.sin(k * Math.PI) * 22;
      for (const side of [-1, 1]) path(r, tx, ty, angle, [[side * 10, -4], [side * 13, 0], [side * 10, 4]], '#b98ea7', 1, .45);
      r.rect(px - 3, py - 3, 6, 6, '#4d354d', .9); r.rect(px - 2, py - 2, 4, 4, '#eac1c2', 1);
      r.rect(px - 1, py - 3, 2, 2, '#fff0dc', 1);
    } else drawBlast(r, tx, ty, t - .24, 34 * scale);
  } else {
    let pulse = 0;
    for (const at of [.12, .34, .56]) if (t >= at) pulse = Math.max(pulse, out(t - at, .17));
    if (t < .12) diamond(r, ax, ay, 3 + t * 30, '#cbd6ec', t / .12 * .7, angle);
    r.pixelLine(ax, ay, tx, ty, '#9f77a7', 5 * scale, .2 * pulse);
    r.pixelLine(ax, ay, tx, ty, '#f1dceb', 1, .9 * pulse);
    for (const q of [.18, .55, .84]) diamond(r, ax + (tx - ax) * q, ay + (ty - ay) * q, 3 + pulse * 2, '#c2dbe8', pulse * .8, angle);
    glint(r, tx, ty, angle + .8, 7, pulse);
  }
}
