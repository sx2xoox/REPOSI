// 등잔대 (lamp stand): what every item pedestal is drawn as (treasure finds, shop wares,
// 대가의 방 offers, boss rewards, secret / 시련방 rewards, a discarded artifact). A slender metal
// stand: a shallow oil dish (등잔) with a pinched spout on its left lip where the wick lies,
// a tall thin pole with a ring halfway up, and a flat round dish (받침) for a foot. The
// proportions are the point: a shallow dish on a long pole reads as a lamp stand, where a
// deep bowl on a short stem read as a goblet / trophy. The find floats over the dish's lit
// oil and the wick burns on the spout, clear of the find (light from the top left); once its
// find is taken the wick is snuffed (a thin smoke wisp) and only an ember stays on it.
// One family, two looks: bronze (default; soot iron on the forge floor, verdigris in the
// brass clock tower) and a warm pewter stand whose oil and wick burn crimson where the
// price is the keeper's own life flame (health prices, 대가의 방).
// Presentation only: drawn from Pedestal.draw / light(), timed by the pedestal's cosmetic
// clocks (bobT, snuffT); nothing here reaches the simulation.

import type { Renderer } from '../engine/renderer';
import type { World } from './world';
import { definePixelSprite, hasSprite } from '../engine/sprites';

const O = '#140c1c';

// 18 x 14. Row 0 is the dish's back rim (one px above the pedestal's y), row 13 the foot's
// front lip; column 9 is the pedestal's x (the dish spans x-8..x+7 like the old block, the
// spout sticks out to x-9). a..f = the metal ramp (dark -> specular), o / p / q = the oil
// (rim -> centre), k = the wick.
export const LAMP_STAND_BODY = [
  'k...bcdffeedcb....', // wick on the spout, the dish's back rim
  'dcbcdaoppppoadcb..', // spout, oil
  '.bcdaopqqqqpoaccb.',
  '..abbcdddddcbba...', // the dish's front lip (shallow: a dish, not a cup)
  '.......abba.......', // collar
  '........dc........',
  '........dc........',
  '.......bdfcb......', // ring on the pole
  '........dc........',
  '........dc........',
  '.......bddcb......', // socket
  '....bcdeedcdcb....', // foot dish: back rim
  '..bdbaaadcaaabcb..', //            the well the pole stands in
  '...bcdeffdddccb...', //            front lip
];
const BODY = LAMP_STAND_BODY;
/** the oil well only: the lit oil, laid over the dark oil with a flickering alpha */
const OIL = BODY.map((r) => r.replace(/[^opq]/g, '.'));
const BODY_W = BODY[0].length;
/** rows 0..3 of BODY are the oil dish */
const PLATE_ROWS = 4;
/**
 * The dish's outline ring (one px around the dish where the body has no pixel): drawn in
 * the find's rarity colour over the dark outline while it is in focus.
 */
const HALO = ((): string[] => {
  const body = (x: number, y: number) => y >= 0 && y < BODY.length && x >= 0 && x < BODY_W && BODY[y][x] !== '.';
  const plate = (x: number, y: number) => y < PLATE_ROWS && body(x, y) && BODY[y][x] !== 'k';
  const rows: string[] = [];
  for (let y = -1; y <= PLATE_ROWS; y++) {
    let row = '';
    for (let x = -1; x <= BODY_W; x++) {
      const ring = !body(x, y) && (plate(x - 1, y) || plate(x + 1, y) || plate(x, y - 1) || plate(x, y + 1));
      row += ring ? 'w' : '.';
    }
    rows.push(row);
  }
  return rows;
})();
/** sprite pivot: the pedestal's own (x, y) */
const ORIGIN: [number, number] = [9, 1];
/** where the wick sits, relative to the pedestal's (x, y) */
const WICK_X = -9;
const WICK_Y = -1;
/** seconds the snuffed wick smokes before it settles to an ember */
export const SNUFF_SECONDS = 1;

export type LampStandStyle = 'bronze' | 'blood';

interface Look {
  metal: string[];
  /** oil when dark (body) */
  oil: string[];
  /** lit oil (overlay) */
  glow: string[];
  /** wick flame: outer, mid, core */
  flame: [string, string, string];
  /** light colour of the wick */
  light: string;
}

const LOOKS: Record<LampStandStyle, Look> = {
  bronze: {
    // an old lamp bronze: browner and less yellow in the highlights than gold, so a plain
    // stand never reads as a trophy and a legendary find's gold rim still stands out
    metal: ['#3a1c1a', '#683622', '#9a5a2e', '#c68842', '#e8b660', '#fde8b4'],
    oil: ['#3a200e', '#5a3414', '#7a4c1c'],
    glow: ['#6a3a14', '#c08636', '#ffe6a2'],
    flame: ['#e0601a', '#ffb040', '#fff6c8'],
    light: '#ffc070',
  },
  blood: {
    // warm pewter, a step lighter than the 대가의 방 floor so pole and dish keep their shape
    metal: ['#2c1c24', '#56404a', '#86686e', '#b29498', '#dcc2c0', '#fbeee8'],
    oil: ['#2a0a14', '#40101e', '#56162a'],
    glow: ['#6a1428', '#c62a4c', '#ff8098'],
    flame: ['#a01040', '#ff4070', '#ffd0e0'],
    light: '#ff4a7a',
  },
};

/** Floors whose stone or brass would swallow a bronze stand: the stand's own metal there. */
const THEME_METAL: Record<string, string[]> = {
  // the forge glows orange: a soot iron stand keeps its silhouette there (a pale steel
  // top end, so the thin pole still shows on the forge floor and the shop's dark rug)
  forge: ['#2a2026', '#4a3c44', '#6e5e66', '#9c888a', '#c8b4b0', '#f0e2da'],
  // the clock tower is brass: a verdigris stand like its stone lanterns
  clock: ['#0e2420', '#1a4a40', '#2a7a66', '#48b094', '#8ae0c4', '#d0fff0'],
};

// wick flame, 3 x 7 (no outline: a lit lamp in the room, not a pickup; the room candles'
// flame family, a size up so it reads beside the find), four frames
const FLAME = [
  ['.o.', '.m.', 'omo', 'mcm', 'mcm', 'mcm', '.m.'],
  ['..o', '.mo', '.m.', 'omm', 'mcm', 'mcm', '.m.'],
  ['...', '.o.', 'omo', 'mmm', 'mcm', 'mcm', '.m.'],
  ['o..', 'om.', '.m.', 'mmo', 'mcm', 'mcm', '.m.'],
];
const FLAME_H = FLAME[0].length;

function metalPalette(m: string[]): Record<string, string> {
  return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] };
}

interface SpriteSet {
  body: string;
  oil: string;
  flame: string[];
}
const sets = new Map<string, SpriteSet>();

/** sprite names of one style on one floor theme (defined on first use) */
export function lampStandSprites(style: LampStandStyle, theme: string): SpriteSet {
  const metal = style === 'bronze' ? THEME_METAL[theme] : undefined;
  const key = metal ? `${style}@${theme}` : style;
  let set = sets.get(key);
  if (set) return set;
  const look = LOOKS[style];
  const body = `lampstand_${key}`;
  if (!hasSprite(body)) {
    const pal = { ...metalPalette(metal ?? look.metal), o: look.oil[0], p: look.oil[1], q: look.oil[2], k: '#2a1a14' };
    definePixelSprite(body, pal, BODY, { outline: O, origin: ORIGIN });
  }
  const oil = `lampstand_oil_${style}`;
  if (!hasSprite(oil)) definePixelSprite(oil, { o: look.glow[0], p: look.glow[1], q: look.glow[2] }, OIL, { origin: ORIGIN });
  const [fo, fm, fc] = look.flame;
  const flame = FLAME.map((rows, k) => {
    const name = `lampstand_flame_${style}_${k}`;
    if (!hasSprite(name)) definePixelSprite(name, { o: fo, m: fm, c: fc }, rows, { origin: [1, FLAME_H - 1] });
    return name;
  });
  set = { body, oil, flame };
  sets.set(key, set);
  return set;
}

const rims = new Map<string, string>();
/** the dish's focus ring in one colour (defined on first use) */
function rimSprite(color: string): string {
  let name = rims.get(color);
  if (name) return name;
  name = `lampstand_rim_${color}`;
  if (!hasSprite(name)) definePixelSprite(name, { w: color }, HALO, { origin: [ORIGIN[0] + 1, ORIGIN[1] + 1] });
  rims.set(color, name);
  return name;
}

/** Health-priced offers (대가의 방) burn crimson; everything else is bronze. */
export function lampStandStyle(heartPrice: number): LampStandStyle {
  return heartPrice > 0 ? 'blood' : 'bronze';
}

export interface LampStandDraw {
  style: LampStandStyle;
  /** a find rests on it: the wick burns and the oil glows */
  lit: boolean;
  /** cosmetic clock (s) for the flicker */
  t: number;
  /** cosmetic: seconds since the wick was snuffed (its find taken); large = long out */
  outT: number;
  /** 0..1 focus highlight and its colour (the find's rarity) */
  focus: number;
  focusColor: string;
  /** 0..1 flare as a find appears on it */
  flare: number;
}

/** Draw the stand under a pedestal at (x, y) (the find floats at y - 10 above it). */
export function drawLampStand(r: Renderer, w: World, x: number, y: number, o: LampStandDraw): void {
  const s = lampStandSprites(o.style, w.room.theme.id);
  r.shadow(x, y + 12, 15, 4, 0.32);
  r.sprite(s.body, x, y);
  if (o.lit) {
    const t = o.t;
    const flick = 0.72 + 0.12 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 17.9 + 1.3);
    // in focus the oil burns full and bright (focus reads through brightness, not only the rim)
    const lift = Math.max(o.flare, o.focus);
    r.sprite(s.oil, x, y, { alpha: Math.min(1, flick + lift), flash: Math.max(o.flare * 0.5, o.focus * 0.3) });
    if (o.focus > 0.02) r.sprite(s.oil, x, y, { additive: true, alpha: o.focus * (0.4 + 0.1 * Math.sin(t * 6)) });
  }
  if (o.focus > 0.02) r.sprite(rimSprite(o.focusColor), x, y, { alpha: o.focus * (0.85 + 0.15 * Math.sin(o.t * 6)) });
}

/** The wick on the dish's spout, drawn over the floating find (it stands in front of it). */
export function drawLampWick(r: Renderer, w: World, x: number, y: number, o: LampStandDraw): void {
  const L = LOOKS[o.style];
  const wx = x + WICK_X;
  const wy = y + WICK_Y;
  if (o.lit) {
    const s = lampStandSprites(o.style, w.room.theme.id);
    r.sprite(s.flame[Math.floor(o.t * 9) & 3], wx, wy - 1);
    return;
  }
  const u = o.outT;
  // the ember left on the wick: a hot tip over the charred wick, breathing slowly
  const hot = u < 0.4 ? 1 - u / 0.4 : 0;
  const breathe = 0.82 + 0.18 * Math.sin(o.t * 2.1);
  r.rect(wx, wy - 1, 1, 1, L.flame[1], Math.min(1, breathe + hot));
  r.rect(wx, wy, 1, 1, L.flame[0], Math.min(1, 0.85 + hot));
  if (u >= SNUFF_SECONDS) return;
  // snuffed: the wick tip flashes white-hot for a blink, then a thin wisp of smoke curls up
  if (u < 0.2) r.rect(wx, wy - 1, 1, 1, L.flame[2], 1 - u / 0.2);
  // (pale enough to read on the treasure rug's red, widening a little as it rises)
  const a = Math.min(1, u * 10) * (1 - u / SNUFF_SECONDS);
  for (let j = 0; j < 6; j++) {
    const h = 2 + j * 2 + u * 8;
    const sway = Math.round(Math.sin(u * 5 + j * 1.2) * (0.3 + j * 0.4));
    const col = j < 2 ? '#f4eef4' : j < 4 ? '#cec6d6' : '#a49cb0';
    const sy = Math.round(wy - h);
    r.rect(wx + sway, sy, 1, 1, col, a * (1 - j * 0.13));
    if (j >= 2 && j <= 4) r.rect(wx + sway + (j & 1 ? 1 : -1), sy, 1, 1, col, a * 0.4);
  }
}

/** The stand's own light: the wick and the lit oil while a find rests on it (focus brightens the plate). */
export function lampStandLight(w: World, x: number, y: number, style: LampStandStyle, t: number, focus = 0, focusColor = '#ffffff'): void {
  const L = LOOKS[style];
  const fl = 1 + Math.sin(t * 11) * 0.06 + Math.sin(t * 23) * 0.04;
  w.lights.add(x + WICK_X, y + WICK_Y - 4, 26 * fl, L.light, { intensity: 0.55 });
  w.lights.glow(x + WICK_X, y + WICK_Y - 4, 5, L.light, 0.22 * fl);
  // the lit oil blooms softly under the find
  w.lights.glow(x, y + 1, 8, L.glow[2], 0.12 * fl);
  if (focus > 0.02) w.lights.glow(x, y + 1, 11, focusColor, 0.26 * focus);
}

/** An emptied stand: the snuffed wick's last light, then only the ember's tiny glow. */
export function lampStandEmberLight(w: World, x: number, y: number, style: LampStandStyle, t: number, outT: number): void {
  const L = LOOKS[style];
  // the wick's light dies down over the smoke's life (so the wisp stays readable), then the
  // ember keeps a faint warm spot of its own
  const fade = outT < SNUFF_SECONDS ? 1 - outT / SNUFF_SECONDS : 0;
  const breathe = 1 + 0.08 * Math.sin(t * 2.1);
  w.lights.add(x + WICK_X, y + WICK_Y - 2 - 2 * fade, (10 + 16 * fade) * breathe, L.light, { intensity: 0.4 + 0.15 * fade });
  w.lights.glow(x + WICK_X, y + WICK_Y - 1, 3, L.flame[1], (0.3 + 0.2 * fade) * breathe);
}
