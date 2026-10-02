// Shared sprites: pickups, HUD icons, minimap icons, world props.

import { defineAnim, defineDrawnSprite, definePixelSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';

const O = '#140c1c'; // outline

// ------------------------------------------------------------------ hearts
const HEART = [
  '.rr.rr.',
  'rwrrrrr',
  'rrrrrrr',
  'rrrrrrr',
  '.rrrrr.',
  '..rrr..',
  '...r...',
];
const HEART_HALF = [
  '.rr.ee.',
  'rwrreee',
  'rrrreee',
  'rrrreee',
  '.rrree.',
  '..rre..',
  '...r...',
];
definePixelSprite('hud_heart_full', { r: '#e8283c', w: '#ffb0b8' }, HEART, { outline: O });
definePixelSprite('hud_heart_half', { r: '#e8283c', w: '#ffb0b8', e: '#3a1820' }, HEART_HALF, { outline: O });
definePixelSprite('hud_heart_empty', { r: '#3a1820', w: '#4a2830' }, HEART, { outline: O });
definePixelSprite('hud_soul_full', { r: '#6a8ae8', w: '#d0e0ff' }, HEART, { outline: O });
definePixelSprite('hud_soul_half', { r: '#6a8ae8', w: '#d0e0ff', e: '#00000000' }, HEART_HALF.map((row) => row.replace(/e/g, '.')), { outline: O });

definePixelSprite('pk_heart', { r: '#e8283c', w: '#ffb0b8' }, HEART, { outline: O });
definePixelSprite('pk_heart_half', { r: '#e8283c', w: '#ffb0b8' }, HEART_HALF.map((row) => row.replace(/e/g, '.')), { outline: O });
definePixelSprite('pk_soul', { r: '#7a9af8', w: '#e0ecff' }, HEART, { outline: '#101838' });
definePixelSprite('pk_soul_half', { r: '#7a9af8', w: '#e0ecff' }, HEART_HALF.map((row) => row.replace(/e/g, '.')), { outline: '#101838' });

// ------------------------------------------------------------------ coins
function coin(name: string, base: string, size: number): void {
  defineDrawnSprite(name, size, size, (p) => {
    const r = size / 2;
    p.circle(r, r, r, base);
    p.shadeSphere(r, r, r, r, ramp(base, 4), { dither: false });
    p.ring(r, r, r - 1.5, 1, ramp(base, 4)[0]);
    p.px(Math.floor(r - 1), Math.floor(r - 2), '#ffffff');
  }, { outline: O });
}
coin('pk_coin', '#f0c030', 6);
coin('pk_nickel', '#c8d0d8', 7);
coin('pk_dime', '#f0d870', 8);
coin('hud_coin', '#f0c030', 7);

// ------------------------------------------------------------------ bombs / keys
const BOMB = [
  '....fy',
  '...f..',
  '..kkk.',
  '.kkwkk',
  '.kwkkk',
  '.kkkkk',
  '..kkk.',
];
definePixelSprite('pk_bomb', { k: '#3a3448', w: '#8a84a0', f: '#c8a060', y: '#ffe060' }, BOMB, { outline: O });
definePixelSprite('hud_bomb', { k: '#3a3448', w: '#8a84a0', f: '#c8a060', y: '#ffe060' }, BOMB, { outline: O });
defineDrawnSprite('pk_bomb2', 11, 8, (p) => {
  p.circle(3.5, 4.5, 3.5, '#3a3448');
  p.circle(7.5, 4.5, 3.5, '#3a3448');
  p.px(2, 3, '#8a84a0');
  p.px(6, 3, '#8a84a0');
  p.px(9, 0, '#ffe060');
}, { outline: O });
defineDrawnSprite('bomb_placed', 10, 11, (p) => {
  p.circle(5, 6.5, 4.5, '#3a3448');
  p.shadeSphere(5, 6.5, 4.5, 4.5, ['#1a1428', '#2a2438', '#3a3448', '#5a5470', '#8a84a0']);
  p.rect(4, 1, 2, 2, '#5a5470');
  p.px(6, 0, '#c8a060');
  p.px(7, 0, '#ffe060');
}, { outline: O, origin: [5, 8] });
const KEY = [
  '.yyy.',
  'yy.yy',
  '.yyy.',
  '..y..',
  '..yy.',
  '..y..',
  '..yy.',
];
definePixelSprite('pk_key', { y: '#e8c050' }, KEY, { outline: O });
definePixelSprite('hud_key', { y: '#e8c050' }, KEY, { outline: O });

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
  defineDrawnSprite(name, 14, 12, (p) => {
    p.rect(0, 4, 14, 8, base);
    p.shadeVertical(0, 4, 14, 8, ramp(base, 4).reverse());
    if (open) {
      p.rect(0, 0, 14, 4, '#1a0e08');
      p.rect(1, 1, 12, 3, '#ffe9a0');
    } else {
      p.rect(0, 1, 14, 4, base);
      p.rect(0, 1, 14, 1, ramp(base, 4)[3]);
    }
    p.rect(0, 4, 14, 1, band);
    p.rect(6, 4, 2, 4, band);
    p.px(6, 6, '#ffffff');
  }, { outline: O, origin: [7, 9] });
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
