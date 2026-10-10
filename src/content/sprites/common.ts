// Shared sprites: pickups, HUD icons, minimap icons, world props.

import { defineAnim, defineDrawnSprite, definePixelSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';

const O = '#140c1c'; // outline

// ------------------------------------------------------------------ life flames (불꽃 / 작은 불꽃: health)
// Health is the keeper's own lamp fire (the HUD gauge), so its pickups are warm
// flames, the sibling of the blue flame below: the same build (a pointed tip that
// sways, a side lick, a white-hot bed low in the body) leaning the other way, lit
// like the gauge: crimson rim and tip, red-orange body, gold and cream core at the
// base. Redder than the forge's orange-yellow fire motes and bullets on purpose.
// Internal kinds stay 'heart' / 'heart_half'.
export const LIFE_FLAME_PAL = { e: '#9e1c22', r: '#dc3c28', o: '#ff7430', y: '#ffc04a', c: '#fff0c8' };
const LIFE_OUTLINE = '#260a10';
const LIFE_FLAME: string[][] = [
  [
    '..e.....',
    '..re....',
    '..ere...',
    'e.erre..',
    'reoooe..',
    'eooyooe.',
    'eoocyoe.',
    'eooccyoe',
    '.eocccoe',
    '.eoccoe.',
    '..eeee..',
  ],
  [
    '.....e..',
    '....er..',
    '...ere..',
    '..erre.e',
    '.eoooeer',
    '.eoyoooe',
    'eoocyooe',
    'eooccyoe',
    'eoocccoe',
    '.eoccoe.',
    '..eeee..',
  ],
  [
    '....e...',
    '.e.er...',
    'er.ere..',
    'ererre..',
    'eoooooe.',
    'eooyooe.',
    'eoocyooe',
    'eooccyoe',
    'eoocccoe',
    '.eoccoe.',
    '..eeee..',
  ],
];
// the small one: the same licks and white-hot base, never a plain drop
const LIFE_FLAME_HALF: string[][] = [
  ['...e..', '..er..', 'e.ere.', 'reooe.', 'eooyoe', 'eoycye', '.eoce.', '..ee..'],
  ['..e...', '.er...', '.ere.e', 'erooer', 'eooyoe', 'eoycye', '.eoce.', '..ee..'],
  ['...e..', '...re.', 'e.ere.', 'erooe.', 'eooyoe', 'eoycye', '.eoce.', '..ee..'],
];
for (const [name, frames] of [['pk_flame', LIFE_FLAME], ['pk_flame_half', LIFE_FLAME_HALF]] as const) {
  frames.forEach((rows, k) => definePixelSprite(`${name}_${k}`, LIFE_FLAME_PAL, rows, { outline: LIFE_OUTLINE }));
  definePixelSprite(name, LIFE_FLAME_PAL, frames[0], { outline: LIFE_OUTLINE });
  defineAnim(`${name}_anim`, [0, 1, 2, 1].map((k) => `${name}_${k}`), 7);
}
// price / stat icon (item card, 대가의 방 pedestal, shrine, character select): one still
// flame; artifact icons about max health stamp the same rows (items/starter.ts)
export const LIFE_FLAME_ICON = [
  '..e....',
  '..re...',
  'e.ere..',
  'reoore.',
  'eooyooe',
  'eoocyoe',
  'eoccyoe',
  '.eccoe.',
  '..eee..',
];
// (pivot one row below the middle: the pointed tip stays inside a card's top edge like the round coin)
definePixelSprite('hud_flame', LIFE_FLAME_PAL, LIFE_FLAME_ICON, { outline: LIFE_OUTLINE, origin: [3, 3] });
// tiny flames written after world float numbers ("-1" + flame, game/effects.ts):
// life and blue; the pivot is the ink's bottom-left so they sit on the text baseline
const MINI_FLAME = ['.e...', '.re..', 'eroe.', 'eoyoe', 'eycye', 'eccoe', '.eee.'];
definePixelSprite('fx_life_flame', LIFE_FLAME_PAL, MINI_FLAME, { outline: LIFE_OUTLINE, origin: [0, 7] });
definePixelSprite('fx_blue_flame', { e: '#3050c8', r: '#5a78e8', o: '#7a9af8', y: '#c8d8ff', c: '#e0ecff' }, MINI_FLAME.map((r) => [...r].reverse().join('')), { outline: '#101838', origin: [0, 7] });

// ------------------------------------------------------------------ blue flames (푸른 불꽃: burns before health)
// a cool flame: white-blue core low in the body, a pointed tip that sways
// between frames and a small side lick; deep blue rim, dark navy outline
const BLUE = { c: '#e0ecff', b: '#7a9af8', e: '#3050c8' };
const BLUE_FLAME: string[][] = [
  [
    '.....e..',
    '....eb..',
    '...ebe..',
    '..ebbe.e',
    '..ebbbeb',
    '.ebbcbbe',
    '.ebccbbe',
    'ebcccbbe',
    'ebcccbe.',
    '.ebccbe.',
    '..eeee..',
  ],
  [
    '..e.....',
    '..be....',
    '..ebe...',
    'e.ebbe..',
    'beebbbe.',
    'ebbbcbe.',
    'ebbccbbe',
    'ebcccbbe',
    'ebcccbbe',
    '.ebccbe.',
    '..eeee..',
  ],
  [
    '...e....',
    '...be.e.',
    '..ebe.be',
    '..ebbebe',
    '.ebbbbbe',
    '.ebbcbbe',
    'ebbccbbe',
    'ebcccbbe',
    'ebcccbbe',
    '.ebccbe.',
    '..eeee..',
  ],
];
// the small one keeps the same licks: a bent tip and a side tongue, never a plain drop
const BLUE_FLAME_HALF: string[][] = [
  ['..e...', '..be..', '.ebe.e', '.ebbeb', 'ebcbbe', 'ebccbe', '.ebbe.', '..ee..'],
  ['...e..', '...be.', 'e.ebe.', 'beebbe', 'ebcbbe', 'ebccbe', '.ebbe.', '..ee..'],
  ['..e...', '.eb...', '.ebe.e', '.ebbbe', 'ebcbbe', 'ebccbe', '.ebbe.', '..ee..'],
];
for (const [name, frames] of [['pk_blue_flame', BLUE_FLAME], ['pk_blue_flame_half', BLUE_FLAME_HALF]] as const) {
  frames.forEach((rows, k) => definePixelSprite(`${name}_${k}`, BLUE, rows, { outline: '#101838' }));
  definePixelSprite(name, BLUE, frames[2], { outline: '#101838' });
  defineAnim(`${name}_anim`, [0, 1, 2, 1].map((k) => `${name}_${k}`), 7);
}

// ------------------------------------------------------------------ coins (동전: brass, square hole)
const BRASS = { g: '#fff0b0', l: '#f0c868', b: '#d8a040', m: '#b0782a', d: '#7a4418' };
// the hole is left empty: the outline pass fills it dark
definePixelSprite('pk_coin', BRASS, [
  '.llbb.',
  'lgbbbm',
  'lb..bm',
  'bb..mm',
  'bbbmmd',
  '.bmdd.',
], { outline: O });
definePixelSprite('hud_coin', BRASS, [
  '..llbb..',
  '.lglbbb.',
  'llbbbbbm',
  'lbb..bbm',
  'lbb..bmm',
  'bbbbbmmd',
  '.bbmmmd.',
  '..mmdd..',
], { outline: O });
// 동전 꾸러미: two full coins threaded on a red cord (both holes show); the cord
// comes out of the back coin's hole in a knot with a short tail
const STRUNG_COIN = ['.llbb.', 'lgbbbm', 'lbkkbm', 'bbkkmm', 'bbbmmd', '.bmdd.'];
defineDrawnSprite('pk_coin_string', 12, 8, (p) => {
  const pal = { ...BRASS, k: '#2a1006' };
  p.stamp(4, 0, STRUNG_COIN, pal);
  p.stamp(0, 2, STRUNG_COIN, pal);
  // the cord comes out of the back coin's hole to the knot
  p.px(8, 3, '#c03030');
  p.px(9, 3, '#e04040');
  p.rect(10, 2, 2, 2, '#e04040');
  p.px(10, 2, '#ff8080');
  p.px(10, 4, '#c03030');
  p.px(11, 5, '#8a1c1c');
}, { outline: O });

// ------------------------------------------------------------------ matches (성냥)
const MATCH = { w: '#e8d0a0', s: '#b89060', r: '#c03a2a', h: '#ff8a60', d: '#7a2018' };
definePixelSprite('pk_match', MATCH, [
  '.hr.',
  'hrrd',
  'rrrd',
  '.dd.',
  '.ws.',
  '.ws.',
  '.ws.',
  '.ws.',
  '.ws.',
  '.ws.',
  '.ss.',
], { outline: O });
// 성냥갑: a small brown box, red label with a flame mark, dark striker strip, three heads peeking out
definePixelSprite('pk_matchbox', { ...MATCH, b: '#a06a3a', t: '#c89058', k: '#6a4020', L: '#b02a20', y: '#ffd060', x: '#3a2420', g: '#6a5040' }, [
  '.hr.hr.hr.',
  '.ws.ws.ws.',
  'tttttttttt',
  'bLLLyLLLLk',
  'bLLyyyLLLk',
  'xgxxxgxxgx',
  'kkkkkkkkkk',
], { outline: O });
definePixelSprite('hud_match', MATCH, [
  '.....hr.',
  '....hrrd',
  '....rrd.',
  '...ws...',
  '..ws....',
  '.ws.....',
  'ws......',
  's.......',
], { outline: O });

// ------------------------------------------------------------------ wax seals (봉인: sealed doors and chests)
const WAX = { r: '#c02a2a', h: '#ff6050', s: '#7a1414', d: '#8a1a1a' };
const SEAL = [
  '.rhr.',
  'rhrrr',
  'rrsrr',
  'rrrrd',
  '.rdd.',
];
definePixelSprite('seal_wax', WAX, SEAL, { outline: '#3a0a0a' });
// the sealed chest's overlay (same canvas and origin as the chest sprite): cords over the lid to a wax seal
defineDrawnSprite('chest_seal', 32, 32, (p) => {
  p.line(9, 9, 23, 25, '#8a2020');
  p.line(23, 9, 9, 25, '#8a2020');
  p.px(9, 9, '#c04040');
  p.px(23, 9, '#c04040');
  p.rect(13, 15, 7, 5, '#3a0a0a');
  p.rect(14, 14, 5, 7, '#3a0a0a');
  p.stamp(14, 15, SEAL, WAX);
}, { origin: [16, 22] });
// card icon of a sealed door / chest: crossed red cords and the wax seal
defineDrawnSprite('icon_seal', 16, 16, (p) => {
  p.line(1, 2, 14, 13, '#8a2020');
  p.line(14, 2, 1, 13, '#8a2020');
  p.line(1, 3, 13, 14, '#5a1010');
  p.line(14, 3, 2, 14, '#5a1010');
  p.circle(7.5, 7.5, 4.2, WAX.r);
  p.shadeSphere(7.5, 7.5, 4.2, 4.2, ['#5a0a0a', WAX.d, WAX.r, '#e04040', WAX.h], { dither: false });
  // the stamp: a tiny lantern
  p.rect(7, 5, 2, 1, WAX.s);
  p.rect(6, 6, 4, 3, WAX.s);
  p.px(7, 7, '#e04040');
  p.px(8, 7, '#e04040');
  p.rect(7, 9, 2, 1, WAX.s);
}, { outline: O });
// the cold iron lamp hung in a sealed doorway (lit: warm glass, a flame drawn inside)
const LAMP = [
  '...k...',
  '..kmk..',
  '.kmmmk.',
  '.khkgk.',
  '.kgkgk.',
  '.kgkgk.',
  '.kmmmk.',
  '..kmk..',
  '...k...',
];
definePixelSprite('seal_lamp', { k: '#2a2630', m: '#6a6474', g: '#3a3048', h: '#6a6080' }, LAMP, { outline: O, origin: [3, 0] });
definePixelSprite('seal_lamp_lit', { k: '#3a3440', m: '#8a8494', g: '#ffc870', h: '#fff0b0' }, LAMP, { outline: O, origin: [3, 0] });

// ------------------------------------------------------------------ misc
// death screen icon for blasts
defineDrawnSprite('ui_blast', 12, 12, (p) => {
  const pts: number[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 2.6 : 5.8;
    pts.push(5.5 + Math.cos(a) * r, 5.5 + Math.sin(a) * r);
  }
  p.poly(pts, '#ff9a30');
  p.circle(5.5, 5.5, 2.8, '#ffd060');
  p.circle(5, 5, 1.4, '#fff8d0');
  p.px(9, 2, '#ffe080');
  p.px(2, 9, '#c04010');
}, { outline: O });

definePixelSprite('hud_ember', { f: '#ff8a30', y: '#ffe080', r: '#c03810' }, [
  '..f..',
  '.ff..',
  '.fyf.',
  'fyyff',
  'fyyyf',
  'rfyfr',
  '.rrr.',
], { outline: O });

// ------------------------------------------------------------------ minimap icons
definePixelSprite('map_boss', { w: '#f0e8d8', k: '#300810' }, ['.www.', 'wkwkw', 'wwwww', '.w.w.'], { outline: '#300810' });
definePixelSprite('map_treasure', { y: '#ffd040', w: '#fff8c0' }, ['..y..', '.yyy.', 'yywyy', '.yyy.', '..y..'], { outline: O });
definePixelSprite('map_shop', { y: '#ffd040', k: '#805010' }, ['.yyy.', 'yykyy', 'yykyy', '.yyy.'], { outline: O });
definePixelSprite('map_secret', { w: '#c0b0ff' }, ['.ww.', 'w..w', '..w.', '....', '..w.'], { outline: O });
definePixelSprite('map_challenge', { w: '#e0e0f0' }, ['w...w', '.w.w.', '..w..', '.w.w.', 'w...w'], { outline: O });
definePixelSprite('map_shrine', { b: '#80a0ff', w: '#e0e8ff' }, ['..w..', '.bwb.', '..b..', '.bbb.'], { outline: O });
definePixelSprite('map_curse', { p: '#c050c0' }, ['.ppp.', 'p.p.p', 'ppppp', '.p.p.'], { outline: O });

// ------------------------------------------------------------------ world props
defineDrawnSprite('pedestal', 16, 12, (p) => {
  p.rect(1, 0, 14, 3, '#9a92a8');
  p.rect(3, 3, 10, 6, '#7a7288');
  p.rect(1, 9, 14, 3, '#6a6278');
  p.rect(1, 0, 14, 1, '#c8c0d8');
  p.rect(3, 3, 1, 6, '#9a92a8');
  p.rect(12, 3, 1, 6, '#5a5268');
}, { outline: O, origin: [8, 6] });

function chest(name: string, base: string, band: string, open: boolean): void {
  defineDrawnSprite(name, 18, 17, (p) => {
    const wood = ramp(base, 5), metal = ramp(band, 4);
    // Rounded lid, visible top plane, dark right face and separate feet.
    p.rect(2,10,14,6,wood[1]); p.rect(2,10,12,1,wood[3]);
    p.rect(15,9,2,6,wood[0]); p.rect(3,15,3,2,'#291c20'); p.rect(13,15,3,2,'#291c20');
    p.line(3,12,14,12,wood[0]); p.line(4,14,12,14,wood[2]);
    if (open) {
      p.rect(2,1,14,6,wood[1]); p.rect(3,1,12,1,metal[2]);
      p.rect(4,3,10,3,wood[0]); p.rect(2,7,14,4,'#140d19');
      p.rect(3,7,12,1,metal[1]); p.rect(4,9,10,1,'#382634');
    } else {
      p.rect(2,5,14,5,wood[2]); p.rect(3,3,12,3,wood[3]);
      p.rect(5,2,8,2,wood[4]); p.line(3,6,14,6,wood[1]);
      p.rect(2,9,14,1,'#231820');
    }
    for (const x of [4,13]) {
      p.rect(x,open ? 1 : 3,2,open ? 6 : 7,metal[1]);
      p.rect(x,11,2,4,metal[1]); p.px(x,4,metal[3]); p.px(x,12,metal[3]);
    }
    // A brass clasp on plain chests; a distinct padlock on key-locked chests.
    if (!open) {
      const locked = name.includes('gold');
      if (locked) { p.rect(7,7,4,4,metal[2]); p.rect(8,8,2,2,'#2d2431'); }
      p.rect(7,10,4,locked ? 4 : 3,metal[2]); p.px(7,10,metal[3]);
      p.rect(9,11,1,2,'#392735');
    }
  }, { outline: O, origin: [9, 13] });
}

chest('chest', '#8a5a2a', '#c8b060', false);
chest('chest_open', '#8a5a2a', '#c8b060', true);
chest('chest_gold', '#d0a030', '#fff0a0', false);
chest('chest_gold_open', '#d0a030', '#fff0a0', true);

defineDrawnSprite('trapdoor', 22, 18, (p) => {
  p.ellipse(11, 9, 10.5, 8.5, '#3a2a20');
  p.ellipse(11, 9.5, 8.5, 6.5, '#06030a');
  p.ellipse(11, 11, 6, 3.5, '#120a1a');
  p.ring(11, 9, 10, 1, '#6a5040');
}, { origin: [11, 9] });

defineDrawnSprite('fireplace_logs', 14, 6, (p) => {
  p.rect(1, 1, 12, 3, '#5a3a20');
  p.rect(3, 0, 8, 2, '#7a5030');
  p.rect(0, 3, 14, 3, '#3a2414');
  p.px(4, 1, '#a07040');
}, { outline: O, origin: [7, 3] });

function flameFrame(name: string, k: number, cols: string[]): void {
  defineDrawnSprite(name, 12, 16, (p) => {
    const sway = [0, 1, 0, -1][k];
    p.poly([2, 15, 10, 15, 9 + sway, 6, 6 + sway, 0, 3 + sway, 6], cols[0]);
    p.poly([3.5, 15, 8.5, 15, 8 + sway, 8, 6 + sway, 3, 4 + sway, 8], cols[1]);
    p.poly([4.5, 15, 7.5, 15, 7 + sway, 10, 6 + sway, 7, 5 + sway, 10], cols[2]);
  }, { origin: [6, 15] });
}
for (let k = 0; k < 4; k++) {
  flameFrame(`fire_${k}`, k, ['#e04010', '#ff9a30', '#fff0a0']);
  flameFrame(`fire_blue_${k}`, k, ['#2040e0', '#60a0ff', '#e0f0ff']);
}
defineAnim('fire', ['fire_0', 'fire_1', 'fire_2', 'fire_3'], 10);
defineAnim('fire_blue', ['fire_blue_0', 'fire_blue_1', 'fire_blue_2', 'fire_blue_3'], 10);

// generic enemy bullets with a hot core
defineDrawnSprite('bullet_red', 7, 7, (p) => {
  p.circle(3.5, 3.5, 3.5, '#d01830');
  p.circle(3, 3, 2, '#ff6a70');
  p.px(2, 2, '#ffffff');
}, { outline: '#300008' });
