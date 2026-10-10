// 등잔대 (lamp stand): what every item pedestal is drawn as (treasure finds, shop wares,
// 대가의 방 offers, boss rewards, a discarded artifact). A short metal stand: a wide shallow
// oil plate on a thin pole with a knob and a round foot. The find floats in the plate's
// light and a small wick burns on the plate's left lip (light from the top left); once
// its find is taken the stand goes dark, only an ember left on the wick.
// One family, two looks: bronze (default; soot iron on the forge floor, verdigris in the
// brass clock tower) and a dark iron stand whose oil and wick burn crimson where the
// price is the keeper's own life flame (health prices, 대가의 방).
// Presentation only: drawn from Pedestal.draw / light(), timed by the pedestal's
// cosmetic clock; nothing here reaches the simulation.

import type { Renderer } from '../engine/renderer';
import type { World } from './world';
import { definePixelSprite, hasSprite } from '../engine/sprites';

const O = '#140c1c';

// 16 x 14. Row 0 is the plate's back rim (one px above the pedestal's y), row 13 the
// foot. a..f = the metal ramp (dark -> specular), o / p / q = the oil (rim -> centre),
// k = the wick.
const BODY = [
  '.k.bcdffeedcb...',
  '.bcdaoppppoadcb.',
  'bcdaopqqqqpoaccb',
  '.bcdfedddddccbb.',
  '..aabbbbbbbbaa..',
  '.......dc.......',
  '.......dc.......',
  '......cfdb......',
  '.......dc.......',
  '.......dc.......',
  '......bdcb......',
  '....bcdfedcb....',
  '..bcddddcccbba..',
  '..aabbbbbbbbaa..',
];
/** the oil well only: the lit oil, laid over the dark oil with a flickering alpha */
const OIL = BODY.map((r) => r.replace(/[^opq]/g, '.'));
/** rows 0..4 of BODY are the oil plate */
const PLATE_ROWS = 5;
/**
 * The plate's outline ring (18 wide, one px around the plate where the body has no
 * pixel): drawn in the find's rarity colour over the dark outline while it is in focus.
 */
const HALO = ((): string[] => {
  const body = (x: number, y: number) => y >= 0 && y < BODY.length && x >= 0 && x < 16 && BODY[y][x] !== '.';
  const plate = (x: number, y: number) => y < PLATE_ROWS && body(x, y) && BODY[y][x] !== 'k';
  const rows: string[] = [];
  for (let y = -1; y <= PLATE_ROWS; y++) {
    let row = '';
    for (let x = -1; x <= 16; x++) {
      const ring = !body(x, y) && (plate(x - 1, y) || plate(x + 1, y) || plate(x, y - 1) || plate(x, y + 1));
      row += ring ? 'w' : '.';
    }
    rows.push(row);
  }
  return rows;
})();
/** sprite pivot: the pedestal's own (x, y) */
const ORIGIN: [number, number] = [8, 1];
/** where the wick sits, relative to the pedestal's (x, y) */
const WICK_X = -7;
const WICK_Y = -1;

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
    metal: ['#3c1e1a', '#6e3a22', '#a0602c', '#cf9440', '#f2c766', '#fff4c8'],
    oil: ['#3a200e', '#5a3414', '#7a4c1c'],
    glow: ['#6a3a14', '#c08636', '#ffe6a2'],
    flame: ['#e0601a', '#ffb040', '#fff6c8'],
    light: '#ffc070',
  },
  blood: {
    metal: ['#241a26', '#423446', '#665470', '#927e9a', '#c0aec4', '#ece0f0'],
    oil: ['#2a0a14', '#40101e', '#56162a'],
    glow: ['#6a1428', '#c62a4c', '#ff8098'],
    flame: ['#a01040', '#ff4070', '#ffd0e0'],
    light: '#ff4a7a',
  },
};

/** Floors whose stone or brass would swallow a bronze stand: the stand's own metal there. */
const THEME_METAL: Record<string, string[]> = {
  // the forge glows orange: a soot-dark iron stand keeps its silhouette there
  forge: ['#1c1418', '#342830', '#54444c', '#806a70', '#b09a9a', '#e0d0c8'],
  // the clock tower is brass: a verdigris stand like its stone lanterns
  clock: ['#0e2420', '#1a4a40', '#2a7a66', '#48b094', '#8ae0c4', '#d0fff0'],
};

// wick flame, 3 x 5 (no outline: a lit lamp in the room, not a pickup), four frames
const FLAME = [
  ['.o.', '.m.', 'omo', 'mcm', '.m.'],
  ['..o', '.mo', 'omm', 'mcm', '.m.'],
  ['...', '.o.', 'omo', 'mcm', '.m.'],
  ['o..', 'om.', 'mmo', 'mcm', '.m.'],
];

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
function spriteSet(style: LampStandStyle, theme: string): SpriteSet {
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
    if (!hasSprite(name)) definePixelSprite(name, { o: fo, m: fm, c: fc }, rows, { origin: [1, 4] });
    return name;
  });
  set = { body, oil, flame };
  sets.set(key, set);
  return set;
}

const rims = new Map<string, string>();
/** the plate's focus ring in one colour (defined on first use) */
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
  /** 0..1 focus highlight and its colour (the find's rarity) */
  focus: number;
  focusColor: string;
  /** 0..1 flare as a find appears on it */
  flare: number;
}

/** Draw the stand under a pedestal at (x, y) (the find floats at y - 10 above it). */
export function drawLampStand(r: Renderer, w: World, x: number, y: number, o: LampStandDraw): void {
  const s = spriteSet(o.style, w.room.theme.id);
  r.shadow(x, y + 12, 15, 4, 0.32);
  r.sprite(s.body, x, y);
  if (o.lit) {
    const t = o.t;
    const flick = 0.72 + 0.12 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 17.9 + 1.3);
    r.sprite(s.oil, x, y, { alpha: Math.min(1, flick + o.flare), flash: o.flare * 0.5 });
  }
  if (o.focus > 0.02) r.sprite(rimSprite(o.focusColor), x, y, { alpha: o.focus * (0.85 + 0.15 * Math.sin(o.t * 6)) });
}

/** The wick on the plate's left lip, drawn over the floating find (it stands in front of it). */
export function drawLampWick(r: Renderer, w: World, x: number, y: number, o: LampStandDraw): void {
  const s = spriteSet(o.style, w.room.theme.id);
  if (o.lit) {
    r.sprite(s.flame[Math.floor(o.t * 9) & 3], x + WICK_X, y + WICK_Y - 1);
  } else {
    // a dying ember on the wick
    r.rect(x + WICK_X, y + WICK_Y, 1, 1, LOOKS[o.style].flame[1], 0.35 + 0.25 * Math.sin(o.t * 2.1));
  }
}

/** The stand's own light: the wick (only while a find rests on it). */
export function lampStandLight(w: World, x: number, y: number, style: LampStandStyle, t: number): void {
  const L = LOOKS[style];
  const fl = 1 + Math.sin(t * 11) * 0.06 + Math.sin(t * 23) * 0.04;
  w.lights.add(x + WICK_X, y + WICK_Y - 3, 26 * fl, L.light, { intensity: 0.55 });
  w.lights.glow(x + WICK_X, y + WICK_Y - 3, 5, L.light, 0.22 * fl);
  // the lit oil blooms softly under the find
  w.lights.glow(x, y + 1, 8, L.glow[2], 0.12 * fl);
}
