// Per-floor looks of the 등불 성좌도 map (overlay + HUD minimap): the lantern
// light, the thread colour between lit rooms, the night-glass panes, the bezel
// metal, ambient motes, corner ornaments, the floor emblem and the quiet
// material motif inside lit panes. Floors without an entry (8+) derive a look
// from their ThemeDef palette. The current-room hot ramp, the flame, the boss
// red, every sigil colour and the lock gold stay the same on every floor.

import { Themes, type ThemeDef } from '../game/defs';
import { mixColor } from '../engine/math';
import { ramp } from '../engine/painter';

/** How the ambient motes over the board move. */
export type MoteKind = 'dust' | 'spore' | 'ember' | 'snow' | 'spark' | 'bubble' | 'tick' | 'drift';
/** Material motif painted inside visited normal panes (board only). */
export type MotifKind = 'flag' | 'moss' | 'rivet' | 'frost' | 'vein' | 'wave' | 'parquet' | 'none';
/** Corner ornament of the board bezel. */
export type CornerKind = 'cobweb' | 'mushroom' | 'chain' | 'frost' | 'tendril' | 'page' | 'gear' | 'none';
/** The floor emblem in the header medallion. */
export type EmblemKind = 'candle' | 'mushroom' | 'hammer' | 'snowflake' | 'eye' | 'book' | 'gear' | 'lantern';

export interface MapLook {
  id: string;
  /** lantern light of this floor (glows, beads, reach rings) */
  light: string;
  /** threads between lit rooms */
  thread: string;
  /** board background, top -> bottom */
  bg: [string, string];
  /** pane glass: deep, mid, hi */
  glass: [string, string, string];
  /** lit pane rim */
  rim: string;
  /** bezel metal: lo, mid, hi */
  metal: [string, string, string];
  /** ambient mote colour */
  mote: string;
  motes: MoteKind;
  corner: CornerKind;
  emblem: EmblemKind;
  motif: MotifKind;
  /** darkest vignette step alpha */
  vignette: number;
}

export const MAP_LOOK: Record<string, MapLook> = {
  crypt: {
    id: 'crypt', light: '#ffa850', thread: '#ffd890', bg: ['#120e18', '#060409'],
    glass: ['#1c1824', '#2e2a3a', '#4a4458'], rim: '#6e6480', metal: ['#3a2c22', '#7a5a3a', '#c8a070'],
    mote: '#c8c0d8', motes: 'dust', corner: 'cobweb', emblem: 'candle', motif: 'flag', vignette: 0.56,
  },
  caves: {
    id: 'caves', light: '#40e0c0', thread: '#a8f4d8', bg: ['#0a1614', '#030807'],
    glass: ['#10201e', '#1c3430', '#2c4c46'], rim: '#4a7a6c', metal: ['#1c2a26', '#3e6a5a', '#80c0a0'],
    mote: '#a0f0d0', motes: 'spore', corner: 'mushroom', emblem: 'mushroom', motif: 'moss', vignette: 0.56,
  },
  forge: {
    id: 'forge', light: '#ff7a30', thread: '#ffc070', bg: ['#160a08', '#060303'],
    glass: ['#1e1618', '#30262a', '#4a3a38'], rim: '#7a5a48', metal: ['#2e1a12', '#7a4220', '#d08a40'],
    mote: '#ff8a30', motes: 'ember', corner: 'chain', emblem: 'hammer', motif: 'rivet', vignette: 0.56,
  },
  sanctum: {
    id: 'sanctum', light: '#7ac0ff', thread: '#c8e8ff', bg: ['#0c1424', '#04060c'],
    glass: ['#142238', '#20344e', '#34507a'], rim: '#5a7aa4', metal: ['#1a2638', '#4a6a90', '#a8d4f4'],
    mote: '#e8f4ff', motes: 'snow', corner: 'frost', emblem: 'snowflake', motif: 'frost', vignette: 0.56,
  },
  abyss: {
    id: 'abyss', light: '#a050ff', thread: '#e0b0ff', bg: ['#0e0718', '#030106'],
    glass: ['#140c20', '#221834', '#36264c'], rim: '#5a4478', metal: ['#1e1230', '#4a2a7a', '#a070e0'],
    mote: '#c070ff', motes: 'spark', corner: 'tendril', emblem: 'eye', motif: 'vein', vignette: 0.7,
  },
  archive: {
    id: 'archive', light: '#5ae8f4', thread: '#c8f8fa', bg: ['#08121c', '#02060a'],
    glass: ['#10182a', '#1a263a', '#2a3a54'], rim: '#3e6a7a', metal: ['#1a2420', '#8a7034', '#f0dc9a'],
    mote: '#a8f0f8', motes: 'bubble', corner: 'page', emblem: 'book', motif: 'wave', vignette: 0.56,
  },
  clock: {
    id: 'clock', light: '#ffb446', thread: '#f0d890', bg: ['#140a12', '#050306'],
    glass: ['#201418', '#34242a', '#4e3a34'], rim: '#7a5e44', metal: ['#2a1c12', '#9a7430', '#e8c870'],
    mote: '#e8c870', motes: 'tick', corner: 'gear', emblem: 'gear', motif: 'parquet', vignette: 0.56,
  },
};

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (c: string | undefined, fb: string): string => (c && HEX.test(c) ? c : fb);

/** A look derived from a theme's own palette (floors 8+ and unknown themes). */
export function deriveLook(t: ThemeDef): MapLook {
  const pal = t.palette;
  const dark = hex(pal.dark, '#05030a');
  const acc0 = hex(pal.accent[0], '#a07040');
  const light = hex(pal.accent[1] ?? pal.accent[0], '#ffa850');
  const wall = pal.wall;
  const w = (i: number, fb: string) => hex(wall[Math.min(i, wall.length - 1)], fb);
  const m = ramp(acc0, 5);
  return {
    id: t.id,
    light,
    thread: mixColor(light, '#ffffff', 0.4),
    bg: [mixColor(dark, light, 0.06), dark],
    glass: [w(1, '#1c1824'), w(2, '#2e2a3a'), w(3, '#4a4458')],
    rim: w(3, '#6e6480'),
    metal: [m[0], m[2], m[4]],
    mote: hex(t.ambient, '#c8c0d8'),
    motes: 'drift',
    corner: 'none',
    emblem: 'lantern',
    motif: 'none',
    vignette: 0.56,
  };
}

/** The map look of a theme (id or def); unknown ids fall back to a derived (or the crypt) look. */
export function lookFor(theme: string | ThemeDef | undefined): MapLook {
  if (theme && typeof theme !== 'string') return MAP_LOOK[theme.id] ?? deriveLook(theme);
  if (theme && MAP_LOOK[theme]) return MAP_LOOK[theme];
  const def = theme && Themes.has(theme) ? Themes.get(theme) : undefined;
  return def ? deriveLook(def) : MAP_LOOK.crypt;
}
