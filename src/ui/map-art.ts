// Pixel art of the 등불 성좌도 map (overlay + HUD minimap), painted with
// PixelPainter at art resolution (1 art px = PX UI units) so it runs in node
// tests and is cached as canvases by the map views. Rooms are panes of night
// glass: unknown rooms stay dark, seen rooms are dark plates with a buried
// ember, visited rooms are lit panes with a quiet floor-material motif,
// uncleared rooms smoulder red with two eyes, special rooms carry their sigil,
// and the current room is the hottest thing on the board. Threads of light run
// between lit rooms. Pure: nothing here reads or writes the world.

import { PixelPainter, bayer } from '../engine/painter';
import { clamp, mixColor } from '../engine/math';
import type { RoomKind } from '../game/constants';
import { MAP_W } from '../game/constants';
import type { CornerKind, EmblemKind, MapLook } from './map-look';
import type { BoardLayout, MapView, ViewDoor, ViewNode } from './map-view';
import { h32 } from './map-view';
import { PX } from './theme';
import { rivet } from './hud-gear';

/** Glyph outline (sigils, flame, lock). */
export const INK = '#0c0810';
/** Plate outline / deepest dark. */
export const OUT = '#05030a';
const mix = mixColor;
const rows = (s: string): string[] => s.split('/');

// ---------------------------------------------------------------- sigils
export type SigilKey = RoomKind | 'exit';

/** 7x7 sigils (board, legend): h hi, m mid, d shade, k ink. */
export const SIGIL7: Partial<Record<SigilKey, string[]>> = {
  boss: rows('m.....m/mm...mm/.mmmmm./mkkmkkm/mmmmmmm/.mdmdm./..d.d..'),
  elite: rows('h.....h/hm.h.mh/.mmmmm./mmmmmmd/mkkkkkd/mmmmmmd/.ddddd.'),
  challenge: rows('...h.../..hmd../..hmd../..hmd../hmmmmmd/...m.../..ddd..'),
  curse: rows('......./.hmmmh./hmmkmmd/mmkkkmd/.dmkmd./...d.../...d...'),
  treasure: rows('.hhhmm./hhmmmmd/hmmmmdd/.mmmdd./..mdd../...d.../.......'),
  shop: rows('..d.d../...m.../.hmmmm./hmmhmmd/hmmmmmd/hmmmmmd/.ddddd.'),
  secret: rows('..hhh../.hmmmd./.hmkmd./.hmkmd./..mkd../.hmkmd./.ddddd.'),
  shrine: rows('...h.../..hmh../...d.../..hhh../..mmm../.hmmmd./ddddddd'),
  relay: rows('..hhh../.h...d./.hmhmd./.mhmmd./.mmmdd./.d...d./..ddd..'),
  workshop: rows('..h.h../.hmmmh./hmm.mmd/.m...d./hmm.mmd/.dmmmd./..d.d..'),
  vault: rows('hhhhhhh/hm...md/hm.h.md/hmhkmmd/hm.m.md/hm...md/ddddddd'),
  hunt: rows('.h...h./.m.h.m./...m.../.hmmmh./hmmmmmd/.mmmmd./..ddd..'),
  refinery: rows('......./hhhhhh./mmmmmmh/.dmmmd./..mmm../.mmmmm./ddddddd'),
  well: rows('...h.../..hmh../.hmmmd./hmmmmmd/hmhmmmd/.dmmmd./..ddd..'),
  fusion: rows('h.....h/.m...m./..m.m../...h.../..hmm../.mmmmd./ddddddd'),
  exit: rows('..hmd../..hmd../hhhmmdd/.hmmmd./..hmd../......./hmmmmmd'),
};

/** 5x5 sigils (minimap, small boards). */
export const SIGIL5: Partial<Record<SigilKey, string[]>> = {
  boss: rows('m...m/mmmmm/mkmkm/mmmmm/.d.d.'),
  elite: rows('h...h/hmmmh/mkkkd/mmmmd/.ddd.'),
  challenge: rows('..h../..m../..m../hmmmd/..d..'),
  curse: rows('.hmh./hmkmd/mkkkd/.dmd./..d..'),
  treasure: rows('..h../.hmm./hmmmd/.mmd./..d..'),
  shop: rows('.d.d./..m../hmmmd/hmhmd/.ddd.'),
  secret: rows('.hmd./hmkmd/.mkd./.hkd./.ddd.'),
  shrine: rows('..h../..d../.hmh./.mmd./ddddd'),
  relay: rows('..h../.hmd./.mhd./.mmd./..d..'),
  workshop: rows('.h.h./hmmmd/m.k.d/hmmmd/.d.d.'),
  vault: rows('hhhhh/hm.md/hmkmd/hm.md/ddddd'),
  hunt: rows('h.m.d/...../.hmm./hmmmd/.ddd.'),
  refinery: rows('hhhh./mmmmh/.dmd./.mmm./ddddd'),
  well: rows('..h../.hmm./hmmmd/hhmmd/.ddd.'),
  fusion: rows('h...h/.m.m./..h../.hmd./ddddd'),
  exit: rows('..h../..h../hhmmm/.hmm./..m..'),
};

/** The way down (stage passage, a defeated boss's trapdoor) is the exit sigil: an arrow dropping through the floor. */
export const HATCH7 = SIGIL7.exit!;
export const HATCH5 = SIGIL5.exit!;

/** Pane / sigil colour of each special room kind. */
export const KIND_COLOR: Partial<Record<RoomKind, string>> = {
  boss: '#ff4a48', elite: '#ff7a4a', challenge: '#d8dcf0', curse: '#e05ac0', treasure: '#ffd040',
  shop: '#e0a848', secret: '#b4a4ff', shrine: '#94b4ff', relay: '#6ae0d0', workshop: '#ffb058',
  vault: '#9a80f0', hunt: '#b6e36e', refinery: '#e89060', well: '#4aa8f0', fusion: '#e8a0e0',
};

export interface SigilPal {
  h: string;
  m: string;
  d: string;
  k: string;
}

/** hi / mid / shade / ink ramp of a sigil colour. */
export function sigilPal(c: string): SigilPal {
  return { h: mix(c, '#ffffff', 0.5), m: c, d: mix(c, INK, 0.45), k: INK };
}

/** The boss skull is bone, on a red plate. */
export const BONE: SigilPal = { h: '#ffffff', m: '#f4ead8', d: '#a89a88', k: '#300810' };

/** Every colour of a palette mixed toward `to` by `t` (dim sigils, defeated boss). */
export function fadePal(p: SigilPal, to: string, t: number): SigilPal {
  return { h: mix(p.h, to, t), m: mix(p.m, to, t), d: mix(p.d, to, t), k: mix(p.k, to, t) };
}

/** Sigil key of a room on the map (exit start room, special kinds), or null for a plain room. */
export function sigilKey(n: Pick<ViewNode, 'kind' | 'exit'>): SigilKey | null {
  if (n.exit) return 'exit';
  return SIGIL7[n.kind] ? n.kind : null;
}

/** Pane colour of a sigil room. */
export function plateColor(key: SigilKey, look: MapLook): string {
  return key === 'exit' ? look.thread : KIND_COLOR[key] ?? look.light;
}

/** Glyph palette of a sigil (boss bone, shop gold, exit in the floor's thread colour). */
export function glyphPal(key: SigilKey, look: MapLook): SigilPal {
  if (key === 'boss') return BONE;
  if (key === 'shop') return sigilPal('#ffe070');
  return sigilPal(plateColor(key, look));
}

/**
 * Stamp a sigil with its top-left at (x, y); `outline` adds a 1 px ink outline
 * around its set pixels (board), the minimap fills the plate without one.
 */
export function paintSigil(p: PixelPainter, key: SigilKey, x: number, y: number, size: 7 | 5, pal: SigilPal, outline = true): void {
  const mask = (size === 7 ? SIGIL7 : SIGIL5)[key];
  if (!mask) return;
  stampMask(p, mask, x, y, pal as unknown as Record<string, string>, outline ? INK : null);
}

/** Stamp an ASCII mask, optionally with a 1 px outline round its set pixels. */
export function stampMask(p: PixelPainter, mask: string[], x: number, y: number, pal: Record<string, string>, outline: string | null): void {
  if (!outline) {
    p.stamp(x, y, mask, pal);
    return;
  }
  const w = Math.max(...mask.map((r) => r.length));
  const g = new PixelPainter(w + 2, mask.length + 2);
  g.stamp(1, 1, mask, pal);
  g.outline(outline);
  p.blit(g, x - 1, y - 1);
}

// ---------------------------------------------------------------- small glyphs
/** Flame of the current room: 7x9, three frames (8 fps). o outer, y body, w core, r ember base. */
const F0 = rows('...o.../...o.../..oyo../..oyo../.oywyo./.oywyo./oyywyyo/.oyyyo./..rrr..');
export const FLAME7: string[][] = [
  F0,
  [...rows('..o..../..oo.../..oyo../.oyyo..'), ...F0.slice(4)],
  [...rows('....o../...oo../..oyo../..oyyo.'), ...F0.slice(4)],
];
/** 5x5 flame (minimap, small plates): two flicker frames. */
export const FLAME5: string[][] = [rows('..o../.oyo./oywyo/oywyo/.rrr.'), rows('...o./.oyo./oywyo/oyyyo/.rrr.')];
/** 3x4 flame badge (current special room, legend swatch). */
export const FLAME3: string[] = rows('.o./oyo/ywy/rrr');
export const FLAME_PAL = { o: '#ff9a3a', y: '#ffe070', w: '#fffef0', r: '#c04010' };

/** Red wax seal (round, two ribbon tails below) on the thread into a sealed room, which a match burns open: 3x4 (+ ink outline). */
export const SEAL: string[] = rows('.r./rhr/rrr/c.c');
export const SEAL_PAL = { c: '#8a2020', r: '#c02a2a', h: '#ff6050' };
/** thread colour into a sealed room */
export const SEALED_THREAD = '#ffd34a';

/** Floor emblems for the header medallion (7x7, light ramp). */
export const EMBLEM: Record<EmblemKind, string[]> = {
  candle: rows('...h.../..hm.../...d.../..hhm../..hmm../..hmd../.ddddd.'),
  mushroom: rows('..hhm../.hmhmm./hmmmmmd/.ddddd./..hmd../..hmd../.ddddd.'),
  hammer: rows('.hhhm../.mmmd../...d.../hhhhhm./.mmmmd./..mmd../.ddddd.'),
  snowflake: rows('h..h..h/.h.m.h./..mmm../hmmhmmd/..mmm../.d.m.d./d..d..d'),
  eye: rows('......./..hhm../.hmkmd./hmkkkmd/.dmkmd./..ddd../.......'),
  book: rows('......./hhh.mmm/hmh.mdm/hmmdmmd/hmm.mmd/dddkddd/.......'),
  gear: rows('..h.h../.hmmmh./hmmkmmd/.mkkkm./hmmkmmd/.dmmmd./..d.d..'),
  lantern: rows('..hh.../.hmmd../.mhmd../.mmmd../.hmmd../.dddd../.......'),
};

/** Corner ornaments of the board bezel (9x9, authored for the top-left corner, mirrored). */
export const CORNER: Record<Exclude<CornerKind, 'none'>, string[]> = {
  cobweb: rows('xxxxxxxxx/xx.x..x../x.x...x../xx.x.x.../x...xx.../x...xx.../x.xx..x../xx......./x........'),
  mushroom: rows('xxxxxxxxx/xxx.xxx.x/xx..x.x../x.xxx..../x.xxx..../xx.x...../x..x...../xx......./x........'),
  chain: rows('.xxx...../x...x..../x...xxx../x...x..x./.xxxx..x./....x..x./....xxx../........./.........'),
  frost: rows('xxxxxxxxx/xxx.x.x.x/xx.x...../x.xxx..../xx.x...../x......../xx......./x......../x........'),
  tendril: rows('xx......./x.x....../.x.x...../.x..xx.../..x...x../..x...x../...xx.x../.....x.../.........'),
  page: rows('xxxxx..x./xxxx...x./xxx....x./xx.....x./x......x./......x.x/........./........./.........'),
  gear: rows('xx..xx.xx/xx..xx.xx/...xx..../..xx...../xxx...x../xx...xxx./.....xx../xx......./xx.......'),
};

/** Stage bead lantern (8x9): k ink, m metal, g/G/W glass ramp. */
export const BEAD: string[] = rows('...kk.../..kmmk../.kmmmmk./.kgGGgk./.kGWWGk./.kGWWGk./.kgGGgk./.kmmmmk./..kkkk..');

// ---------------------------------------------------------------- helpers
/** Rounded box with a 1 px outline (same shape as the UI frames). */
function roundBox(p: PixelPainter, w: number, h: number, outline: string, fill: string): void {
  p.rect(2, 0, w - 4, h, outline);
  p.rect(0, 2, w, h - 4, outline);
  p.px(1, 1, outline);
  p.px(w - 2, 1, outline);
  p.px(1, h - 2, outline);
  p.px(w - 2, h - 2, outline);
  p.rect(2, 1, w - 4, h - 2, fill);
  p.rect(1, 2, w - 2, h - 4, fill);
}

/**
 * A pane's glass: a solid lit band across the top third, two dithered rows
 * of transition, then the deeper body colour (clean at 1 art px, no noise).
 */
function paneFill(p: PixelPainter, x: number, y: number, w: number, h: number, top: string, bottom: string): void {
  const band = Math.max(1, Math.round(h * 0.3));
  for (let v = 0; v < h; v++) {
    const t = v < band ? 1 : v === band ? 0.5 : v === band + 1 ? 0.25 : 0;
    for (let u = 0; u < w; u++) p.px(x + u, y + v, t >= 1 || (t > 0 && bayer(x + u, y + v) < t) ? top : bottom);
  }
}

/** Ordered-dither vertical gradient over a rect: `top` share falls from `amount` to 0. */
function ditherV(p: PixelPainter, x: number, y: number, w: number, h: number, top: string, bottom: string, amount: number): void {
  const span = Math.max(1, h - 1);
  for (let yy = 0; yy < h; yy++) {
    const t = yy / span;
    for (let xx = 0; xx < w; xx++) p.px(x + xx, y + yy, bayer(x + xx, y + yy) < (1 - t) * amount ? top : bottom);
  }
}

const alphaHex = (a: number): string => Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0');

// ---------------------------------------------------------------- plates
export type PlateState = 'seen' | 'visited' | 'uncleared' | 'current';

export interface PlateOpts {
  state: PlateState;
  /** pane colour of a sigil room; null = a plain room */
  special: string | null;
  look: MapLook;
  lod: 'board' | 'mini';
  /** node id (motif placement) */
  id?: number;
  /** paint the floor-material motif (visited plain panes on the board) */
  motif?: boolean;
  /** paint the plain-room centre (ember / bead / eyes); off when a sigil or flame sits there */
  centre?: boolean;
  /** centre of the bead (default: plate centre) */
  cx?: number;
  cy?: number;
  /** mullions at these absolute x / y (multi-cell rooms) */
  splitsX?: number[];
  splitsY?: number[];
}

/** The hot ramp of the current room (constant on every floor). */
export const HOT = { top: '#fff0c8', bottom: '#e8b870', shade: '#8a4a1e', rim: '#ffe9a8', ring: '#f0a24c' };
export const SMOULDER = { top: '#6e2a34', bottom: '#4a1822', shade: '#2a0c14', rim: '#a04252', eye: '#ff4a5a', eyeHi: '#ffb0b4', eyeMini: '#ff6a70' };
const SEEN = { fill: '#0e0a14', dither: '#1a1424', top: '#2a2236', topMini: '#3e3450', left: '#211a2c', ember: '#6a2c12', emberHi: '#e07a2a' };

interface PaneCols {
  top: string;
  bottom: string;
  amount: number;
  rimT: string;
  rimL: string;
  shade: string | null;
  mullion: string;
}

function paneCols(o: PlateOpts): PaneCols {
  const L = o.look;
  if (o.state === 'seen') {
    // the minimap's 7 px plates get a slightly lifted rim so seen rooms stay findable at HUD size
    const mini = o.lod === 'mini';
    const rimT = o.special ? mix(o.special, INK, mini ? 0.5 : 0.62) : mini ? SEEN.topMini : SEEN.top;
    return { top: SEEN.fill, bottom: SEEN.fill, amount: 0, rimT, rimL: mini ? SEEN.top : SEEN.left, shade: null, mullion: SEEN.dither };
  }
  if (o.state === 'current' && !o.special) {
    return { top: HOT.top, bottom: HOT.bottom, amount: 0.75, rimT: HOT.rim, rimL: HOT.rim, shade: HOT.shade, mullion: mix(HOT.bottom, HOT.shade, 0.6) };
  }
  if (o.state === 'uncleared') {
    return { top: SMOULDER.top, bottom: SMOULDER.bottom, amount: 0.75, rimT: SMOULDER.rim, rimL: mix(SMOULDER.rim, SMOULDER.top, 0.4), shade: SMOULDER.shade, mullion: '#3a121c' };
  }
  if (o.special) {
    const c = o.special;
    return { top: mix(c, INK, 0.46), bottom: mix(c, INK, 0.66), amount: 0.75, rimT: c, rimL: mix(c, INK, 0.22), shade: mix(c, INK, 0.82), mullion: mix(c, INK, 0.76) };
  }
  return { top: L.glass[2], bottom: L.glass[1], amount: 0.75, rimT: L.rim, rimL: mix(L.rim, L.glass[2], 0.4), shade: L.glass[0], mullion: mix(L.glass[1], L.glass[0], 0.8) };
}

/**
 * One room plate at (x, y), w x h art px including its 1 px outline: state
 * fill, bevel rows, mullions, the floor motif and the plain-room centre.
 */
export function paintRoomPlate(p: PixelPainter, x: number, y: number, w: number, h: number, o: PlateOpts): void {
  if (w < 3 || h < 3) return;
  p.rectOutline(x, y, w, h, OUT);
  const ix = x + 1;
  const iy = y + 1;
  const iw = w - 2;
  const ih = h - 2;
  const c = paneCols(o);
  const board = o.lod === 'board';
  if (o.state === 'seen') {
    p.rect(ix, iy, iw, ih, SEEN.fill);
    for (let xx = 0; xx < iw; xx++) if (bayer(ix + xx, iy + 1) < 0.5) p.px(ix + xx, iy + 1, SEEN.dither);
  } else {
    // each row of cells of a big room is its own pane (lit band under every mullion)
    let y0 = iy;
    for (const my of [...(o.splitsY ?? []).filter((v) => v > iy && v < iy + ih - 1).sort((a, b) => a - b), iy + ih]) {
      if (my > y0) paneFill(p, ix, y0, iw, my - y0, c.top, c.bottom);
      y0 = my + 1;
    }
  }
  if (o.motif && o.state === 'visited' && !o.special && board) paintMotif(p, o.look, ix + 1, iy + 1, iw - 2, ih - 2, o.id ?? 0);
  // mullions between the cells of a big room
  for (const mx of o.splitsX ?? []) if (mx > ix && mx < ix + iw - 1) p.rect(mx, iy, 1, ih, c.mullion);
  for (const my of o.splitsY ?? []) if (my > iy && my < iy + ih - 1) p.rect(ix, my, iw, 1, c.mullion);
  // bevel: lit top / left, shaded bottom / right
  if (c.shade) {
    p.rect(ix, iy + ih - 1, iw, 1, c.shade);
    p.rect(ix + iw - 1, iy, 1, ih, c.shade);
  }
  p.rect(ix, iy, 1, ih - (c.shade ? 1 : 0), c.rimL);
  p.rect(ix, iy, iw - (c.shade ? 1 : 0), 1, c.rimT);
  // glass glint: a short diagonal shine just inside the lit corner (board panes that are lit)
  if (board && o.state !== 'seen' && iw >= 9 && ih >= 9) {
    const gl = mix(c.top, '#ffffff', o.state === 'current' && !o.special ? 0.7 : 0.32);
    p.px(ix + 1, iy + 3, gl);
    p.px(ix + 2, iy + 2, gl);
    p.px(ix + 3, iy + 1, gl);
    p.px(ix + 1, iy + 5, mix(c.top, gl, 0.5));
    p.px(ix + 2, iy + 4, mix(c.top, gl, 0.5));
  }
  if (o.centre === false || o.special) return;
  const cx = o.cx ?? ix + Math.floor((iw - 1) / 2);
  const cy = o.cy ?? iy + Math.floor((ih - 1) / 2);
  const mini = o.lod === 'mini';
  if (o.state === 'seen') {
    if (mini) p.px(cx, cy, '#a8481c');
    else {
      p.rect(cx, cy, 2, 2, SEEN.ember);
      p.px(cx, cy, SEEN.emberHi);
    }
  } else if (o.state === 'visited') {
    if (mini) p.px(cx, cy, o.look.thread);
    else if (iw < 8 || ih < 8) {
      p.rect(cx, cy, 2, 2, o.look.light);
      p.px(cx, cy, mix(o.look.thread, '#ffffff', 0.5));
    } else {
      // the room's lantern, lit: a small round orb of the floor's light
      const core = mix(o.look.thread, '#ffffff', 0.55);
      const halo = o.look.light;
      p.rect(cx, cy - 1, 2, 4, halo);
      p.rect(cx - 1, cy, 4, 2, halo);
      p.rect(cx, cy, 2, 2, core);
      p.px(cx, cy, '#ffffff');
      p.px(cx + 1, cy + 1, mix(core, halo, 0.5));
    }
  } else if (o.state === 'uncleared') {
    if (mini) {
      p.px(cx - 1, cy, SMOULDER.eyeMini);
      p.px(cx + 1, cy, SMOULDER.eyeMini);
    } else {
      const ey = cy + 1;
      for (const ex of [cx - 1, cx + 2]) {
        p.px(ex, ey, SMOULDER.eye);
        p.px(ex, ey - 1, SMOULDER.eyeHi);
      }
    }
  }
}

/** Quiet floor-material motif inside a lit pane (board only). (x, y, w, h): inside the bevel. */
export function paintMotif(p: PixelPainter, look: MapLook, x: number, y: number, w: number, h: number, id: number): void {
  if (w < 5 || h < 5) return;
  const g = look.glass;
  const r = h32(id, 0x6d61, look.id.length);
  const at = (k: number, span: number) => ((r >>> k) & 0xffff) % Math.max(1, span);
  /** a seam darker than the pane body */
  const seam = mix(g[1], g[0], 0.6);
  /** the lit lip under a seam */
  const lip = mix(g[1], g[2], 0.55);
  const hline = (v: number, u0: number, u1: number, c: string) => {
    for (let u = Math.max(0, u0); u <= Math.min(w - 1, u1); u++) p.px(x + u, y + v, c);
  };
  const vline = (u: number, v0: number, v1: number, c: string) => {
    for (let v = Math.max(0, v0); v <= Math.min(h - 1, v1); v++) p.px(x + u, y + v, c);
  };
  switch (look.motif) {
    case 'flag': {
      // two courses of flagstones: one seam across, joints staggered
      const hs = Math.round(h * 0.5);
      hline(hs, 0, w - 1, seam);
      hline(hs + 1, 0, w - 1, lip);
      vline(Math.floor(w * 0.3), 0, hs - 1, seam);
      vline(Math.floor(w * 0.72), hs + 1, h - 1, seam);
      break;
    }
    case 'moss': {
      for (let v = Math.max(0, h - 2); v < h; v++) for (let u = 0; u < w; u++) if (bayer(x + u, y + v) < (v === h - 1 ? 0.6 : 0.3)) p.px(x + u, y + v, '#2c4c3a');
      p.px(x + at(0, w), y + h - 2, '#4a8a62');
      p.px(x + at(8, Math.max(1, w)), y + at(16, Math.max(1, h - 4)), '#a0f0d0');
      break;
    }
    case 'rivet': {
      // a riveted iron plate with a soot-dark foot
      for (const [u, v] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) p.px(x + u, y + v, look.metal[2]);
      for (let u = 0; u < w; u++) if (bayer(x + u, y + h - 2) < 0.4) p.px(x + u, y + h - 2, seam);
      vline(Math.floor(w / 2) - (at(0, 2) ? 3 : -3), 0, Math.round(h * 0.3) - 1, seam);
      break;
    }
    case 'frost': {
      // rime creeping in from two corners
      const fr = mix(g[2], '#e8f4ff', 0.55);
      const fr2 = mix(g[1], '#c8e8ff', 0.35);
      for (const [u, v, c] of [[w - 1, 0, fr], [w - 2, 0, fr], [w - 1, 1, fr], [w - 3, 0, fr2], [w - 1, 2, fr2], [w - 2, 1, fr2], [0, h - 1, fr], [1, h - 1, fr], [0, h - 2, fr], [2, h - 1, fr2], [0, h - 3, fr2], [1, h - 2, fr2]] as [number, number, string][]) p.px(x + u, y + v, c);
      break;
    }
    case 'vein': {
      const vc = mix(g[1], '#7a30d0', 0.6);
      const base = Math.round(h * 0.55) + at(0, 2);
      for (let u = 0; u < w; u++) p.px(x + u, y + Math.min(h - 1, base + ((u >> 1) & 1)), vc);
      p.px(x + 1 + at(8, Math.max(1, w - 2)), y + Math.min(h - 1, base + 3), '#c070ff');
      break;
    }
    case 'wave': {
      const wave = [0, 0, 1, 1, 0, 0, -1, -1];
      const row = Math.round(h * 0.62);
      for (let u = 0; u < w; u++) p.px(x + u, y + clamp(row + wave[(u + at(0, 8)) & 7], 0, h - 1), mix(g[2], look.light, 0.25));
      p.px(x + at(8, w), y + Math.max(0, row - 3), '#d8c8a0');
      break;
    }
    case 'parquet': {
      // floor boards: two seams across, joints staggered, brass inlay at the corners
      const s1 = Math.round(h * 0.4);
      const s2 = Math.round(h * 0.72);
      hline(s1, 0, w - 1, seam);
      hline(s2, 0, w - 1, seam);
      vline(Math.floor(w * 0.35), s1 + 1, s2 - 1, seam);
      vline(Math.floor(w * 0.7), s2 + 1, h - 1, seam);
      for (const [u, v] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) p.px(x + u, y + v, '#9a7430');
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------- board / minimap rooms
export interface GlowSpot {
  /** UI units, relative to the painter's top-left */
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
}

export interface RoomsPaint {
  painter: PixelPainter;
  glows: GlowSpot[];
}

export interface PlateRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Art-px rect of a room's plate (outline included) for a layout. */
export function plateRect(n: { gx: number; gy: number; cw: number; ch: number }, L: Pick<BoardLayout, 'cell' | 'gap' | 'ox' | 'oy'>): PlateRect {
  const fg = Math.floor(L.gap / 2);
  return { x: L.ox + n.gx * L.cell + fg, y: L.oy + n.gy * L.cell + fg, w: n.cw * L.cell - L.gap, h: n.ch * L.cell - L.gap };
}

/** Art-px centre of a map cell's plate area. */
export function cellCentre(cx: number, cy: number, L: Pick<BoardLayout, 'cell' | 'gap' | 'ox' | 'oy'>): { x: number; y: number } {
  const fg = Math.floor(L.gap / 2);
  const ps = L.cell - L.gap;
  return { x: L.ox + cx * L.cell + fg + Math.floor((ps - 1) / 2), y: L.oy + cy * L.cell + fg + Math.floor((ps - 1) / 2) };
}

/** Pixels of a door's thread across the gap (art px), in order from `a` to `b`, and its axis. */
export function threadPixels(d: Pick<ViewDoor, 'cx' | 'cy' | 'dir'>, L: Pick<BoardLayout, 'cell' | 'gap' | 'ox' | 'oy'>): { pts: [number, number][]; horizontal: boolean } {
  const fg = Math.floor(L.gap / 2);
  const c = cellCentre(d.cx, d.cy, L);
  const pts: [number, number][] = [];
  if (d.dir === 'E' || d.dir === 'W') {
    const B = L.ox + (d.dir === 'E' ? d.cx + 1 : d.cx) * L.cell;
    for (let i = 0; i < L.gap; i++) pts.push([B - L.gap + fg + i, c.y]);
    if (d.dir === 'W') pts.reverse();
    return { pts, horizontal: true };
  }
  const B = L.oy + (d.dir === 'S' ? d.cy + 1 : d.cy) * L.cell;
  for (let i = 0; i < L.gap; i++) pts.push([c.x, B - L.gap + fg + i]);
  if (d.dir === 'N') pts.reverse();
  return { pts, horizontal: false };
}

/** Default canvas sizes (art px): board interior and the minimap's map-space canvas. */
export const BOARD_IN_W = 212;
export const BOARD_IN_H = 150;
export const MINI_CELL = 9;
export const MINI_GAP = 2;
export const MINI_SIZE = MAP_W * MINI_CELL + 4;

/** Minimap layout in map space: every cell at a fixed spot of the MINI_SIZE canvas. */
export const MINI_LAYOUT: BoardLayout = { cell: MINI_CELL, gap: MINI_GAP, ox: 2, oy: 2, sigil: 5 };

/** Layers under the threads: lattice dots and the reach rings round the current room (board). */
function paintGround(p: PixelPainter, view: MapView, look: MapLook, L: BoardLayout, lod: 'board' | 'mini'): void {
  const bgMid = mix(look.bg[0], look.bg[1], 0.5);
  const dot = mix(bgMid, look.mote, 0.13);
  const b = view.bounds;
  for (let gy = b.y0 - 1; gy <= b.y1 + 1; gy++) for (let gx = b.x0 - 1; gx <= b.x1 + 1; gx++) p.px(L.ox + gx * L.cell - 1, L.oy + gy * L.cell - 1, dot);
  if (lod !== 'board') return;
  const cur = view.nodes.find((n) => n.id === view.curId);
  if (!cur) return;
  const r = plateRect(cur, L);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rings: [number, number][] = [[2.5, 0.08], [5, 0.07], [7.5, 0.06]];
  for (const [k, a] of rings) {
    const R = k * L.cell;
    const col = mix(bgMid, look.light, a * 1.6);
    if (look.motes === 'tick' && k === 5) {
      for (let i = 0; i < 60; i++) {
        const ang = (i / 60) * Math.PI * 2;
        const len = i % 5 === 0 ? 3 : 2;
        for (let s = 0; s < len; s++) p.px(Math.floor(cx + Math.cos(ang) * (R + s)), Math.floor(cy + Math.sin(ang) * (R + s)), col);
      }
      continue;
    }
    const x0 = Math.max(0, Math.floor(cx - R - 1));
    const x1 = Math.min(p.w - 1, Math.ceil(cx + R + 1));
    const y0 = Math.max(0, Math.floor(cy - R - 1));
    const y1 = Math.min(p.h - 1, Math.ceil(cy + R + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (((x + y) & 1) !== 0) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (Math.abs(d - R) < 0.55) p.px(x, y, col);
    }
  }
}

/** Threads of light between rooms (under the plates). */
function paintThreads(p: PixelPainter, view: MapView, look: MapLook, L: BoardLayout, lod: 'board' | 'mini', glows: GlowSpot[]): void {
  const dim = mix(look.light, INK, 0.45);
  for (const d of view.doors) {
    const { pts, horizontal } = threadPixels(d, L);
    if (!pts.length) continue;
    const locked = d.lockTo >= 0;
    if (lod === 'mini') {
      const col = locked ? SEALED_THREAD : d.type === 'lit' ? look.thread : d.type === 'secret' ? '#b4a4ff' : dim;
      pts.forEach(([x, y], i) => {
        if (d.type === 'secret' && i % 2 === 1) return;
        p.px(x, y, col);
      });
      continue;
    }
    if (d.type === 'lit') {
      for (const [x, y] of pts) {
        p.px(x, y, look.thread);
        if (horizontal) {
          p.px(x, y + 1, OUT + alphaHex(0.7));
          p.px(x, y - 1, look.thread + alphaHex(0.25));
        } else {
          p.px(x + 1, y, OUT + alphaHex(0.7));
          p.px(x - 1, y, look.thread + alphaHex(0.25));
        }
      }
      const m = pts[Math.floor(pts.length / 2)];
      glows.push({ x: (m[0] + 0.5) * PX, y: (m[1] + 0.5) * PX, r: 10, color: look.light, alpha: 0.18 });
    } else if (d.type === 'frontier') {
      pts.forEach(([x, y], i) => {
        if (i % 3 !== 2) p.px(x, y, dim);
      });
    } else {
      pts.forEach(([x, y], i) => {
        if (i % 2 === 0) p.px(x, y, '#b4a4ff');
      });
    }
  }
}

/** Mullion positions (absolute art px) of a big room's plate. */
function mullions(n: ViewNode, L: BoardLayout): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < n.cw; i++) xs.push(L.ox + (n.gx + i) * L.cell - 1);
  for (let i = 1; i < n.ch; i++) ys.push(L.oy + (n.gy + i) * L.cell - 1);
  return { xs, ys };
}

/** Hot ring 1 px outside a plate (current special room). */
function hotRing(p: PixelPainter, r: PlateRect): void {
  p.rect(r.x - 1, r.y - 1, r.w + 2, 1, HOT.rim);
  p.rect(r.x - 1, r.y - 1, 1, r.h + 2, HOT.rim);
  p.rect(r.x - 1, r.y + r.h, r.w + 2, 1, HOT.ring);
  p.rect(r.x + r.w, r.y, 1, r.h + 1, HOT.ring);
}

/**
 * Paint every known room, thread, sigil, lock and seal of a map view. Board
 * LOD also paints the lattice, reach rings, motifs, horns and rims; the mini
 * LOD uses 5x5 sigils filling the plates. Returns the cached glow spots.
 */
export function paintRooms(view: MapView, look: MapLook, L: BoardLayout, lod: 'board' | 'mini', size?: { w: number; h: number }): RoomsPaint {
  const W = size?.w ?? (lod === 'board' ? BOARD_IN_W : MINI_SIZE);
  const H = size?.h ?? (lod === 'board' ? BOARD_IN_H : MINI_SIZE);
  const p = new PixelPainter(W, H);
  const glows: GlowSpot[] = [];
  paintGround(p, view, look, L, lod);
  paintThreads(p, view, look, L, lod, glows);
  for (const n of view.nodes) {
    const r = plateRect(n, L);
    const key = sigilKey(n);
    const hatchBoss = n.bossDone && !view.lastFloor;
    const special = key ? plateColor(key, look) : null;
    const st: PlateState = n.state === 'current' ? 'current' : n.state;
    const m = mullions(n, L);
    const board = lod === 'board';
    paintRoomPlate(p, r.x, r.y, r.w, r.h, {
      state: st, special, look, lod, id: n.id, motif: board, splitsX: m.xs, splitsY: m.ys,
      centre: !(st === 'current' && !special),
      cx: r.x + Math.floor((r.w - 1) / 2),
      cy: r.y + Math.floor((r.h - 1) / 2),
    });
    if (st === 'current' && special) hotRing(p, r);
    // sigil
    if (key) {
      const size: 7 | 5 = board && Math.min(r.w, r.h) >= 11 ? 7 : 5;
      let pal = glyphPal(key, look);
      if (st === 'seen') pal = fadePal(pal, INK, 0.3);
      let drawKey: SigilKey = key;
      if (n.bossDone) {
        pal = fadePal(pal, mix(special!, INK, 0.56), 0.5);
        if (!board && hatchBoss) {
          drawKey = 'exit';
          pal = sigilPal(look.thread);
        }
      }
      const outline = board;
      const gx = r.x + Math.floor((r.w - size) / 2);
      const gy = r.y + Math.floor((r.h - size) / 2);
      paintSigil(p, drawKey, gx, gy, size, pal, outline);
    }
    if (board) {
      if (n.kind === 'boss') {
        const red = KIND_COLOR.boss!;
        for (let i = 1; i <= 2; i++) {
          p.px(r.x - i, r.y - i, red);
          p.px(r.x + r.w - 1 + i, r.y - i, red);
          p.px(r.x - i, r.y + r.h - 1 + i, red);
          p.px(r.x + r.w - 1 + i, r.y + r.h - 1 + i, red);
        }
        if (hatchBoss) stampMask(p, HATCH5, r.x + r.w - 4, r.y + r.h - 4, sigilPal(look.thread) as unknown as Record<string, string>, INK);
      }
      if (n.kind === 'secret') {
        const dot = '#b4a4ff' + alphaHex(0.6);
        for (let x = r.x - 1; x <= r.x + r.w; x++) {
          if ((x & 1) === 0) {
            p.px(x, r.y - 1, dot);
            p.px(x, r.y + r.h, dot);
          }
        }
        for (let y = r.y; y < r.y + r.h; y++) {
          if ((y & 1) === 0) {
            p.px(r.x - 1, y, dot);
            p.px(r.x + r.w, y, dot);
          }
        }
      }
    }
    // glow spots
    const cxU = (r.x + r.w / 2) * PX;
    const cyU = (r.y + r.h / 2) * PX;
    const rad = 0.9 * Math.max(r.w, r.h) * PX;
    if (st === 'visited') glows.push({ x: cxU, y: cyU, r: rad, color: special ?? look.light, alpha: special ? 0.2 : 0.12 });
    else if (st === 'uncleared') glows.push({ x: cxU, y: cyU, r: rad, color: '#ff4050', alpha: 0.12 });
    else if (st === 'seen' && special) glows.push({ x: cxU, y: cyU, r: 0.6 * Math.max(r.w, r.h) * PX, color: special, alpha: 0.08 });
  }
  // wax seals on the threads into sealed rooms
  if (lod === 'board') {
    for (const d of view.doors) {
      if (d.lockTo < 0) continue;
      const { pts } = threadPixels(d, L);
      const m = pts[Math.floor(pts.length / 2)];
      if (!m) continue;
      stampMask(p, SEAL, m[0] - 1, m[1] - 2, SEAL_PAL, INK);
    }
  }
  return { painter: p, glows };
}

// ---------------------------------------------------------------- board bezel
/**
 * The board: rounded ink box, metal bevel + band + ink inner line (interior at
 * (4, 4)), rivets on the band corners, a dithered night background and corner
 * ornaments. `aw` x `ah` art px (220 x 158 on the overlay).
 */
export function paintBoardStatic(look: MapLook, aw = BOARD_IN_W + 8, ah = BOARD_IN_H + 8): PixelPainter {
  const p = new PixelPainter(aw, ah);
  const [lo, mid, hi] = look.metal;
  roundBox(p, aw, ah, INK, look.bg[0]);
  // bevel ring (1), metal band (2), ink inner line (3)
  p.rect(2, 1, aw - 4, 1, hi);
  p.rect(1, 2, 1, ah - 4, hi);
  p.rect(2, ah - 2, aw - 4, 1, lo);
  p.rect(aw - 2, 2, 1, ah - 4, lo);
  p.rectOutline(2, 2, aw - 4, ah - 4, mid);
  p.rectOutline(3, 3, aw - 6, ah - 6, INK);
  for (const [x, y] of [[2, 2], [aw - 4, 2], [2, ah - 4], [aw - 4, ah - 4]]) {
    p.rect(x, y, 2, 2, mid);
    p.px(x, y, hi);
  }
  const iw = aw - 8;
  const ih = ah - 8;
  ditherV(p, 4, 4, iw, ih, look.bg[0], look.bg[1], 0.7);
  if (look.corner !== 'none') {
    const mask = CORNER[look.corner];
    const col = mix(mix(look.bg[0], look.bg[1], 0.5), mid, 0.5);
    for (let v = 0; v < 9; v++) for (let u = 0; u < 9; u++) {
      if (mask[v][u] !== 'x') continue;
      p.px(4 + u, 4 + v, col);
      p.px(4 + iw - 1 - u, 4 + v, col);
      p.px(4 + u, 4 + ih - 1 - v, col);
      p.px(4 + iw - 1 - u, 4 + ih - 1 - v, col);
    }
  }
  if (look.motes === 'snow') {
    // frost on the top band
    for (let x = 6; x < aw - 6; x++) {
      const h = h32(x, 0x5f, 3) % 7;
      if (h === 0) p.px(x, 2, '#e8f4ff');
      else if (h === 1) p.px(x, 1, mix(hi, '#e8f4ff', 0.6));
    }
  }
  return p;
}

// ---------------------------------------------------------------- HUD minimap plate
/** HUD minimap window (art px) inside its 62x43 plate. */
export const MINI_PLATE = { w: 62, h: 43, hole: { x: 3, y: 4, w: 56, h: 37 }, view: { x: 4, y: 5, w: 54, h: 35 } };

/**
 * The HUD minimap plate in the purse's brass language: plum body, brass rail on
 * top, cool rim, soot bottom, rivets, and a bevelled window left transparent.
 */
export function paintMapPlate(w = MINI_PLATE.w, h = MINI_PLATE.h): PixelPainter {
  const p = new PixelPainter(w, h);
  roundBox(p, w, h, INK, '#18111e');
  for (let y = 3; y < h - 2; y++) {
    const t = (y - 3) / Math.max(1, h - 5);
    for (let x = 2; x < w - 2; x++) p.px(x, y, bayer(x, y) < (1 - t) * 0.6 ? '#241a2d' : '#17111d');
  }
  p.rect(2, 1, w - 4, 1, '#e0b064');
  p.rect(2, 2, w - 4, 1, '#7a4e1c');
  p.px(1, 2, '#b8843c');
  p.px(w - 2, 2, '#5a3814');
  p.rect(1, 3, 1, h - 5, '#33263f');
  p.rect(w - 2, 3, 1, h - 5, '#0e0a12');
  p.rect(2, h - 2, w - 4, 1, '#0e0a12');
  const H = MINI_PLATE.hole;
  // window bevel (dark top / left, lit bottom / right), then the hole itself
  p.rect(H.x, H.y, H.w, H.h, '#2e2340');
  p.rect(H.x, H.y, H.w - 1, 1, '#050308');
  p.rect(H.x, H.y, 1, H.h - 1, '#050308');
  const V = MINI_PLATE.view;
  p.rect(V.x, V.y, V.w, V.h, null);
  rivet(p, 2, h - 4);
  rivet(p, w - 5, h - 4);
  return p;
}

/** Minimap window background (54 x 35 art): the floor's night, dithered. */
export function paintMiniBackground(look: MapLook, w = MINI_PLATE.view.w, h = MINI_PLATE.view.h): PixelPainter {
  const p = new PixelPainter(w, h);
  ditherV(p, 0, 0, w, h, look.bg[0], look.bg[1], 0.7);
  return p;
}

// ---------------------------------------------------------------- vignette
/**
 * Art-crisp vignette: four ordered-dither steps of the outline dark, from
 * nothing inside r0 to `look.vignette` beyond r1 (art px, centred on cx, cy).
 */
export function paintVignette(look: MapLook, w: number, h: number, cx: number, cy: number, r0: number, r1: number, maxAlpha = look.vignette): PixelPainter {
  const p = new PixelPainter(w, h);
  const cols = [0, 1, 2, 3, 4].map((i) => (i === 0 ? null : OUT + alphaHex((maxAlpha * i) / 4)));
  const span = Math.max(1, r1 - r0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = clamp((Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r0) / span, 0, 1);
    const lvl = clamp(Math.floor(t * 4 + bayer(x, y)), 0, 4);
    const c = cols[lvl];
    if (c) p.px(x, y, c);
  }
  return p;
}

// ---------------------------------------------------------------- header pieces
/** The floor medallion (16x16 art): metal ring, glass disc, the floor emblem in the light ramp. */
export function paintEmblemMedallion(look: MapLook): PixelPainter {
  const p = new PixelPainter(16, 16);
  const [lo, mid, hi] = look.metal;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x + 0.5 - 8;
    const dy = y + 0.5 - 8;
    const d = Math.hypot(dx, dy);
    if (d > 8) continue;
    if (d > 7) p.px(x, y, INK);
    else if (d > 5.2) {
      const diag = dx + dy;
      p.px(x, y, diag < -3 ? hi : diag > 3 ? lo : mid);
    } else if (d > 4.9) p.px(x, y, INK);
    else {
      const t = (y - 3) / 10;
      p.px(x, y, bayer(x, y) < (1 - t) * 0.7 ? look.bg[0] : look.bg[1]);
    }
  }
  const pal = sigilPal(look.light);
  stampMask(p, EMBLEM[look.emblem], 4, 4, pal as unknown as Record<string, string>, INK);
  return p;
}

export type BeadState = 'past' | 'current' | 'future';

/** One stage bead lantern (8x9 art); the boss stage gets two red horn pixels by its cap. */
export function paintStageBead(look: MapLook, state: BeadState, boss: boolean): PixelPainter {
  const p = new PixelPainter(8, 9);
  const pal: Record<string, string> =
    state === 'future'
      ? { k: INK, m: '#2a2236', g: '#140e1a', G: '#140e1a', W: '#140e1a' }
      : state === 'current'
        ? { k: INK, m: look.metal[1], g: '#c07a30', G: '#ffe070', W: '#fffef0' }
        : { k: INK, m: look.metal[1], g: look.thread, G: look.light, W: mix(look.light, '#ffffff', 0.6) };
  p.stamp(0, 0, BEAD, pal);
  if (state !== 'future') p.px(3, 1, look.metal[2]);
  if (boss) {
    p.px(2, 0, KIND_COLOR.boss!);
    p.px(5, 0, KIND_COLOR.boss!);
  }
  return p;
}

/** A flame mask (FLAME7 / FLAME5 / FLAME3) with its ink outline. */
export function paintFlame(mask: string[]): PixelPainter {
  const w = Math.max(...mask.map((r) => r.length));
  const p = new PixelPainter(w + 2, mask.length + 2);
  stampMask(p, mask, 1, 1, FLAME_PAL, INK);
  return p;
}

/** Teammate pip (4x4 art): 2x2 slot colour in an ink frame; downed = pale ring, dark centre. */
export function paintPip(col: string, downed: boolean): PixelPainter {
  const p = new PixelPainter(4, 4);
  p.rectOutline(0, 0, 4, 4, INK);
  if (downed) {
    p.rectOutline(0, 0, 4, 4, '#a8d8ff');
    p.rect(1, 1, 2, 2, INK);
  } else {
    p.rect(1, 1, 2, 2, col);
    p.px(1, 1, mix(col, '#ffffff', 0.6));
  }
  return p;
}

/** Grey sigil palette of a kind not found yet (legend). */
export const UNFOUND: SigilPal = { h: '#4e4660', m: '#3a3248', d: '#241c30', k: INK };

/**
 * A cartographer's compass rose (25x25 art) in the floor's bezel metal, the
 * north point lit with the floor's lantern light. Decoration for the free
 * space under the legend.
 */
export function paintCompass(look: MapLook): PixelPainter {
  const S = 25;
  const c = 12;
  const p = new PixelPainter(S, S);
  const [lo, mid, hi] = look.metal;
  /** a spike from the centre toward (dx, dy), `len` long, `half` wide at the base; lit / shaded halves */
  const spike = (dx: number, dy: number, len: number, half: number, lit: string, dark: string) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const rx = x - c;
      const ry = y - c;
      const along = rx * dx + ry * dy;
      const across = -rx * dy + ry * dx;
      if (along < 0 || along > len) continue;
      const w = half * (1 - along / len);
      if (Math.abs(across) > w + 0.35) continue;
      // light from the top-left: the half facing it is lit
      const k = across * (dy - dx);
      const side = k > 0 || (k === 0 && across >= 0) ? lit : dark;
      p.px(x, y, side);
    }
  };
  const s2 = Math.SQRT1_2;
  for (const [dx, dy] of [[s2, s2], [-s2, s2], [s2, -s2], [-s2, -s2]]) spike(dx, dy, 7, 1.6, mid, lo);
  spike(0, 1, 11, 2.6, mid, lo);
  spike(1, 0, 11, 2.6, mid, lo);
  spike(-1, 0, 11, 2.6, hi, mid);
  spike(0, -1, 11, 2.6, mix(look.light, '#ffffff', 0.35), look.light);
  p.outline(INK);
  // dotted outer ring (round the spikes, not over them)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - c, y - c);
    if (Math.abs(d - 11.5) < 0.5 && ((x + y) & 1) === 0 && !p.isSet(x, y)) p.px(x, y, mix(mid, lo, 0.35));
  }
  // hub
  p.rect(c - 1, c - 1, 3, 3, INK);
  p.px(c, c, mix(look.thread, '#ffffff', 0.5));
  return p;
}
