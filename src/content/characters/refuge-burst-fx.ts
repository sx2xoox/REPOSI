import type { Renderer } from '../../engine/renderer';
import type { SupportFamily } from './refuge-common';

const TAU = Math.PI * 2;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const out = (t: number, duration: number): number => clamp01(1 - t / duration);

/** All choreography is sampled from simulation age. Draws never write state. */
function line(r: Renderer, x: number, y: number, angle: number, ax: number, ay: number, bx: number, by: number,
  color: string, width = 1, alpha = 1): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  r.line(x + c * ax - s * ay, y + s * ax + c * ay, x + c * bx - s * by, y + s * bx + c * by, color, width, clamp01(alpha));
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

/** Broken ground shock, short fire tongues and brass shrapnel; no opaque disk. */
export function drawBlast(r: Renderer, x: number, y: number, t: number, radius: number, heavy = false): void {
  if (t < 0 || t > .44) return;
  const k = clamp01(t / .34), fade = out(t, .44), burst = 1 - Math.pow(1 - clamp01(t / .18), 3);
  const edge = radius * (.2 + .8 * burst);
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8 + .13, b = a + .25, d = edge * (i % 2 ? .92 : 1);
    const ax = x + Math.cos(a) * d, ay = y + Math.sin(a) * d;
    const bx = x + Math.cos(b) * d, by = y + Math.sin(b) * d;
    r.line(ax, ay, bx, by, '#503844', heavy ? 4 : 3, fade * .4);
    r.line(ax, ay - 1, bx, by - 1, '#e1a568', heavy ? 2 : 1, fade * .75);
    if (i % 2 === 0) {
      const inner = d - 6;
      r.line(x + Math.cos(a) * inner, y + Math.sin(a) * inner,
        x + Math.cos(a + .18) * (inner - 4), y + Math.sin(a + .18) * (inner - 4), '#94735e', 1, fade * .5);
    }
  }
  const flame = out(t, .24), lift = (heavy ? 24 : 16) * (1 - Math.pow(1 - k, 2));
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5 - 1.3, reach = (8 + i % 3 * 4) * burst;
    const px = x + Math.cos(a) * reach, py = y + Math.sin(a) * reach * .55 - lift;
    r.line(x + Math.cos(a) * 3, y - 2, px, py, '#794b47', (heavy ? 7 : 5) * flame + 1, flame * .6);
    r.line(x + Math.cos(a) * 3, y - 3, px, py - 3, '#efb366', (heavy ? 4 : 3) * flame + 1, flame * .9);
    r.rect(px - 1, py - 5, 2, 4, '#ffe4a8', flame);
  }
  glint(r, x, y - 3, -.18, (heavy ? 16 : 11) * out(t, .1), out(t, .1));
  for (let i = 0; i < (heavy ? 14 : 9); i++) {
    const a = i * 2.399963 + .2, d = radius * (.28 + (i * 5 % 9) / 14) * burst;
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d - Math.sin(k * Math.PI) * (7 + i % 3 * 4);
    if (i % 3 === 0) line(r, px, py, a + k * 2, -3, -1, 2, 1, '#5a4242', 3, fade * .8);
    r.rect(px - 1, py - 1, i % 3 === 0 ? 3 : 2, 2, i % 2 ? '#efc88a' : '#b77652', fade);
    if (i < 4) r.line(px, py, px - Math.cos(a) * 5 * (1 - k), py - Math.sin(a) * 5 * (1 - k), '#fff1c5', 1, fade * .7);
  }
}

/** An artillery survey mark tightens, then a physical shell enters the impact point. */
export function drawShellWarning(r: Renderer, x: number, y: number, timeToImpact: number, index: number): void {
  if (timeToImpact < 0) return;
  const tension = 1 - clamp01(timeToImpact / .28), size = 14 + (1 - tension) * 6, alpha = .24 + tension * .52;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    r.line(x + sx * size, y + sy * (size - 5), x + sx * size, y + sy * size, '#e6bb7e', 1, alpha);
    r.line(x + sx * size, y + sy * size, x + sx * (size - 5), y + sy * size, '#e6bb7e', 1, alpha);
  }
  r.line(x - 3, y, x + 3, y, '#f3d29b', 1, alpha);
  r.line(x, y - 3, x, y + 3, '#f3d29b', 1, alpha);
  for (let i = 0; i <= index; i++) r.rect(x - index * 2 + i * 4 - 1, y + size + 4, 2, 1, '#b98556', alpha);
  if (timeToImpact > .2) return;
  const flight = clamp01(timeToImpact / .2), px = x - flight * 15, py = y - flight * 55;
  line(r, px, py, 1.3, -12, 0, -3, 0, '#e1ba7c', 2, .45 * (1 - flight));
  line(r, px, py, 1.3, -5, 0, 4, 0, '#382f3a', 5, .95);
  line(r, px, py, 1.3, -4, -1, 3, -1, '#d7a367', 3, .95);
  glint(r, px + 1, py + 2, 1.3, 3, .85);
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
    r.line(...a, ...b, '#584666', 2, alpha * .35);
    r.line(...a, ...b, i % 2 ? '#d4bce9' : '#a58dc9', 1, alpha);
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
      r.line(x + Math.cos(u) * radius, y + Math.sin(u) * radius,
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
  if (t < 0 || t > .32) return;
  const k = clamp01(t / .32), direction = reverse ? -1 : 1;
  const head = angle + direction * (-1.1 + clamp01(k * 3) * 2.2), fade = out(t, .32);
  for (let i = 0; i < 14; i++) {
    const a = head - direction * i * .075, b = a - direction * .08, tail = 1 - i / 14;
    const ra = clip ? clip(a, radius) : radius, rb = clip ? clip(b, radius) : radius;
    // Occluded arc pieces disappear; projecting them onto a wall would draw a false rail.
    if (ra < radius - 4 || rb < radius - 4) continue;
    const ax = x + Math.cos(a) * ra, ay = y + Math.sin(a) * ra;
    const bx = x + Math.cos(b) * rb, by = y + Math.sin(b) * rb;
    r.line(ax, ay, bx, by, '#593c59', tail * 5 + 1, fade * .45 * tail);
    r.line(ax, ay, bx, by, color, tail * 3 + 1, fade * .8 * tail);
    r.line(x + Math.cos(a) * (ra + 1), y + Math.sin(a) * (ra + 1), x + Math.cos(b) * (rb + 1), y + Math.sin(b) * (rb + 1), '#fff0df', 1, fade * tail);
  }
  const tip = clip ? clip(head, radius) : radius;
  const px = x + Math.cos(head) * tip, py = y + Math.sin(head) * tip;
  glint(r, px, py, head, 3, fade);
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
    r.line(ax, ay, px, py, '#6c486a', 3, fade * .25);
    r.line(ax, ay, px, py, '#efc5d5', 1, fade * .8);
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
    r.line(ax, ay, tx, ty, '#9f77a7', 5 * scale, .2 * pulse);
    r.line(ax, ay, tx, ty, '#f1dceb', 1, .9 * pulse);
    for (const q of [.18, .55, .84]) diamond(r, ax + (tx - ax) * q, ay + (ty - ay) * q, 3 + pulse * 2, '#c2dbe8', pulse * .8, angle);
    glint(r, tx, ty, angle + .8, 7, pulse);
  }
}

/** One visual impact per release strike, independent of support-family tick schedules. */
export function drawReleaseStrike(r: Renderer, ax: number, ay: number, tx: number, ty: number, t: number, family: SupportFamily, final: boolean, side: number, reach: number,
  clip?: (angle: number, radius: number) => number): void {
  if (t < -.18 || t > .46) return;
  const angle = Math.atan2(ty - ay, tx - ax), color = side < 0 ? '#edb2c8' : '#b4d4e5';
  if (t < 0) {
    const ready = 1 + t / .18;
    const d = final ? 14 : 9;
    path(r, ax, ay, angle, [[-4, side * d], [5, side * (d + 4)], [14, side * d]], color, 1, ready * .75);
    line(r, ax, ay, angle, 4, side * d, 17, side * d, '#fff0df', 1, ready * .8);
    return;
  }
  if (final || family === 0) {
    slash(r, ax, ay, angle, Math.max(18, Math.min(final ? 136 : 126, reach)), t, color, final ? false : side > 0, clip);
    if (final) {
      slash(r, ax, ay, angle, Math.max(15, Math.min(123, reach - 8)), t + .02, '#b8d8e7', true, clip);
      glint(r, tx, ty, angle + .75, 16, out(t, .2));
    }
  } else if (family === 2) drawBlast(r, tx, ty, t, 50, true);
  else {
    const fade = out(t, .28), width = family === 3 ? 5 : 3;
    r.line(ax, ay, tx, ty, '#8b628a', width + 3, fade * .2);
    r.line(ax, ay, tx, ty, color, width, fade * .7);
    r.line(ax, ay, tx, ty, '#fff2e5', 1, fade);
    for (const q of [.2, .5, .8]) {
      const px = ax + (tx - ax) * q, py = ay + (ty - ay) * q;
      path(r, px, py, angle, [[-4, -5], [3, 0], [-4, 5]], color, 1, fade * .6);
    }
    glint(r, tx, ty, angle + .8, 12, out(t, .25));
  }
}

/** Indexed book leaves build a hollow aisle; closing pages meet on the real final hit. */
export function drawCorridor(r: Renderer, x: number, y: number, angle: number, length: number, t: number): void {
  const fade = clamp01(t / .16) * clamp01((2.5 - t) / .4);
  const closure = clamp01((t - 1.82) / .18), width = 29 * (1 - closure);
  const nx = Math.cos(angle), ny = Math.sin(angle), sx = -ny, sy = nx;
  // The full corridor remains active through the final hit. Only the book leaves
  // fold inward: keep its floor boundaries fixed so the closing animation cannot
  // imply that enemies near the edges are already outside the attack.
  const boundary = t < 2 ? fade : out(t - 2, .3);
  for (const side of [-1, 1]) {
    line(r, x, y, angle, 0, side * 29, length, side * 29, '#51678e', 3, boundary * .25);
    line(r, x, y, angle, 0, side * 29, length, side * 29, '#afc6e6', 1, boundary * .65);
    for (let i = 0; i <= 4; i++) {
      const distance = length * i / 4, reveal = clamp01(t * 7 - i * .18);
      const px = x + nx * distance + sx * side * width, py = y + ny * distance + sy * side * width;
      bookMark(r, px, py, angle + side * (.2 + closure * 1.15), fade * reveal * .88 * (t < 2 ? 1 : out(t - 2, .16)), (1 - closure) * reveal);
      if (i < 4 && t < 1.82) {
        line(r, x, y, angle, distance + 10, side * 25, distance + 15, side * 25, '#d2c7b0', 1, fade * .45);
        line(r, x, y, angle, distance + 10, side * 22, distance + 12, side * 22, '#91a6ca', 1, fade * .38);
      }
    }
  }
  let pulse = 0;
  for (const at of [.2, .7, 1.2, 1.7]) if (t >= at && t < 2) pulse = Math.max(pulse, out(t - at, .22));
  for (let i = 1; i <= 3; i++) {
    const d = length * i / 4, px = x + nx * d, py = y + ny * d;
    diamond(r, px, py, 6 + pulse * 2, '#b3c9ea', fade * (.14 + pulse * .35), angle);
    if (pulse > 0) for (const side of [-1, 1]) line(r, x, y, angle, d - 2, side * (6 + 14 * (1 - pulse)), d + 2, side * (6 + 14 * (1 - pulse)), '#e4deed', 1, pulse * fade);
  }
  if (t >= 2) {
    const end = t - 2, glow = out(end, .3);
    line(r, x, y, angle, 0, 0, length, 0, '#637fa9', 7, glow * .2);
    line(r, x, y, angle, 0, 0, length, 0, '#eef1ff', 2, glow * .95);
    for (const side of [-1, 1]) line(r, x, y, angle, 0, side * 23, length, side * 23, '#d8e2f4', 1, glow * .55);
    for (let i = 0; i < 7; i++) {
      const d = length * (i + .5) / 7, drift = end * (10 + i % 3 * 5), side = i % 2 ? 1 : -1;
      const px = x + nx * d + sx * side * drift, py = y + ny * d + sy * side * drift - end * 13;
      path(r, px, py, angle + side * end * 2, [[-3, -3], [3, -3], [3, 3], [-3, 3], [-3, -3]], '#cbd7e9', 1, fade * .7);
      if (i % 2 === 0) line(r, x, y, angle, d - 2, -26, d + 2, 26, '#c8d5ed', 1, glow * .3);
      if (i % 2 === 0) glint(r, x + nx * d, y + ny * d, angle + Math.PI / 2, 8, glow * .65, '#f4e9ff');
    }
  }
}
