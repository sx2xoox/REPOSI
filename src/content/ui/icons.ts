// UI sprites: lantern emblem (logo / cursor), stat icons, summary icons, map
// markers, wax seal for the item plaque, lock, tab icons. All 1px outlined,
// light from the top-left, drawn on the same pixel grid as the world.

import { defineAnim, defineDrawnSprite, definePixelSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';

const O = '#0c0810';

// ------------------------------------------------------------------ lantern emblem
function lanternFrame(name: string, k: number, lit = true): void {
  defineDrawnSprite(name, 13, 21, (p) => {
    const iron = ['#1e1828', '#3a3046', '#5e5070', '#8a7c9c'];
    // hanging ring
    p.ring(6.5, 2.5, 2.6, 1, iron[2]);
    p.px(5, 1, iron[3]);
    // cap
    p.rect(3, 5, 7, 1, iron[2]);
    p.rect(2, 6, 9, 2, iron[1]);
    p.rect(3, 6, 6, 1, iron[3]);
    p.px(6, 4, iron[2]);
    // glass cage
    const glass = lit ? ['#c86a1c', '#ff9a3a', '#ffd070', '#fff4c0'] : ['#20182a', '#2a2234', '#342a40', '#3e3448'];
    p.rect(3, 8, 7, 8, glass[1]);
    p.rect(4, 8, 5, 8, glass[2]);
    if (lit) {
      // flame flicker
      const sway = [0, 1, -1][k % 3];
      const tall = [0, -1, 0][k % 3];
      p.rect(5 + (sway > 0 ? 1 : 0), 10 + tall, 3 - (sway !== 0 ? 1 : 0), 5 - tall, glass[3]);
      p.px(6 + sway, 9 + tall, glass[3]);
      p.px(6, 14, '#ffffff');
    }
    // bars
    p.rect(2, 8, 1, 8, iron[1]);
    p.rect(10, 8, 1, 8, iron[0]);
    p.rect(6, 8, 1, 8, lit ? glass[2] : iron[1]);
    p.px(6, 11, lit ? '#fff8d8' : iron[2]);
    p.rect(2, 16, 9, 2, iron[1]);
    p.rect(3, 16, 6, 1, iron[2]);
    p.rect(4, 18, 5, 1, iron[0]);
    p.px(6, 19, iron[1]);
  }, { outline: O });
}
for (let k = 0; k < 3; k++) lanternFrame(`ui_lantern_${k}`, k);
lanternFrame('ui_lantern_off', 0, false);
defineAnim('ui_lantern', ['ui_lantern_0', 'ui_lantern_1', 'ui_lantern_0', 'ui_lantern_2'], 7);

// small flame used as the menu cursor
function cursorFlame(name: string, k: number): void {
  defineDrawnSprite(name, 7, 9, (p) => {
    const s = [0, 1, 0, -1][k];
    p.poly([0.5, 8.5, 6.5, 8.5, 6 + s * 0.5, 4, 3.5 + s, 0, 1 + s * 0.5, 4], '#ff7a20');
    p.poly([1.5, 8.5, 5.5, 8.5, 5 + s * 0.5, 5, 3.5 + s, 2, 2, 5], '#ffc040');
    p.rect(2.5, 6, 2, 3, '#fff2b0');
  }, { outline: O, origin: [3, 8] });
}
for (let k = 0; k < 4; k++) cursorFlame(`ui_cursor_${k}`, k);
defineAnim('ui_cursor', ['ui_cursor_0', 'ui_cursor_1', 'ui_cursor_2', 'ui_cursor_3'], 9);

// ------------------------------------------------------------------ stat icons (9x9)
definePixelSprite('st_damage', { w: '#f0f4ff', l: '#a8b4d0', h: '#e0a848', d: '#7a4e1c', g: '#6a3a2a' }, [
  '.......lw',
  '......lwl',
  '.....lwl.',
  '....lwl..',
  '.h.lwl...',
  '..hwl....',
  '..dh.....',
  '.g..h....',
  'g........',
], { outline: O });
definePixelSprite('st_firerate', { y: '#ffd060', o: '#ff8a30', w: '#fff4c0' }, [
  'o..o.....',
  '.o..o....',
  '..y..y...',
  '...w..w..',
  '....ww.w.',
  '...w..w..',
  '..y..y...',
  '.o..o....',
  'o..o.....',
], { outline: O });
definePixelSprite('st_range', { w: '#e8f0ff', b: '#4ab0c8', d: '#1a5a70', k: '#0c0810' }, [
  '.........',
  '...www...',
  '.wwbbbww.',
  'wwbddkbww',
  'wbbdkkbbw',
  'wwbbbbbww',
  '.wwbbbww.',
  '...www...',
  '.........',
], { outline: O });
definePixelSprite('st_shotspeed', { b: '#7ac8ff', w: '#e8f6ff', l: '#3a7ab0' }, [
  '.........',
  '......w..',
  'll.....w.',
  '..lbbbbbw',
  'l.......w',  // placeholder row, replaced below
  '..lbbbbbw',
  'll.....w.',
  '......w..',
  '.........',
].map((r, i) => (i === 4 ? '.........' : r)), { outline: O });
definePixelSprite('st_speed', { b: '#b07a4a', d: '#6a4224', l: '#e0b080', w: '#f0f4ff', s: '#3a2418' }, [
  '..bbb....',
  '..lbbw.w.',
  '..lbbww..',
  '..lbbw.w.',
  '..lbbb...',
  '.lbbbbbb.',
  '.bbbbbbbd',
  '.sssssss.',
  '.........',
], { outline: O });
definePixelSprite('st_luck', { g: '#4ac060', G: '#9af08a', d: '#2a7a3a', s: '#6a8a3a' }, [
  '.gg...gg.',
  'gGGg.gGGg',
  'gGgggggGg',
  '.gggdggg.',
  '..gdddg..',
  '.gggdggg.',
  'gGgg.gggg',
  '.gg..sgg.',
  '.....s...',
], { outline: O });
definePixelSprite('st_crit', { y: '#ffe060', o: '#ff8a30', w: '#ffffff' }, [
  '....y....',
  '.y..y..y.',
  '..y.o.y..',
  '...owo...',
  'yyowwwoyy',
  '...owo...',
  '..y.o.y..',
  '.y..y..y.',
  '....y....',
], { outline: O });
definePixelSprite('st_dash', { w: '#e8e0ff', b: '#a090e0', d: '#5a4aa0' }, [
  '.........',
  '..bbbww..',
  '.......w.',
  'dbbbbwww.',
  '.......w.',
  '..dbbww..',
  '.........',
  '.........',
  '.........',
], { outline: O });
definePixelSprite('st_pierce', { w: '#f0f0ff', b: '#c07bff', d: '#6a3aa0' }, [
  '.........',
  '..d...d..',
  '..d...d..',
  'bbbbbbbbw',
  '..d...d..',
  '..d...d..',
  '.........',
  '.........',
  '.........',
], { outline: O });
definePixelSprite('st_shots', { y: '#ffd060', w: '#fff4c0' }, [
  '.....yw..',
  '.........',
  '..yw.....',
  '.......yw',
  '..yw.....',
  '.........',
  '.....yw..',
  '.........',
  '.........',
], { outline: O });
definePixelSprite('st_heart', { r: '#e8283c', w: '#ffb0b8', d: '#8a1020' }, [
  '.rr.rr.',
  'rwrrrrr',
  'rrrrrrd',
  '.rrrrd.',
  '..rrd..',
  '...d...',
], { outline: O });
definePixelSprite('st_shield', { b: '#c8d0e0', w: '#ffffff', d: '#7a8098', y: '#ffd060' }, [
  'bbbbbbb',
  'bwwybbd',
  'bwyyybd',
  'bbbybbd',
  '.bbybd.',
  '..bbd..',
  '...d...',
], { outline: O });

// ------------------------------------------------------------------ misc UI icons
definePixelSprite('ui_skull', { w: '#f0e8d8', s: '#b8a890', k: '#2a0810', r: '#ff3040' }, [
  '..wwwww..',
  '.wwwwwww.',
  'wwwwwwwws',
  'wkkwwkkws',
  'wkrwwrkws',
  'swwwkwwss',
  '.swwwwws.',
  '..wswsw..',
  '..sksks..',
], { outline: O });
definePixelSprite('ui_lock', { y: '#e8c050', Y: '#fff0a0', d: '#9a6a20', k: '#3a2408', g: '#8a8098' }, [
  '..gggg..',
  '.g....g.',
  '.g....g.',
  'yyyyyyyy',
  'yYYYYYYd',
  'yYYkkYYd',
  'yYYkkYYd',
  'yYYYkYYd',
  'dddddddd',
], { outline: O });
definePixelSprite('ui_question', { w: '#a89cc0', d: '#5a4e70' }, [
  '.wwww.',
  'ww..ww',
  '....ww',
  '...ww.',
  '..ww..',
  '..dd..',
  '......',
  '..ww..',
], { outline: O });
definePixelSprite('ui_arrow_r', { w: '#ffe09a', d: '#c08a3a' }, ['w...', 'ww..', 'www.', 'wwwd', 'wwd.', 'wd..', 'd...'], { outline: O });
definePixelSprite('ui_arrow_l', { w: '#ffe09a', d: '#c08a3a' }, ['...w', '..ww', '.www', 'dwww', '.dww', '..dw', '...d'], { outline: O });
definePixelSprite('ui_check', { g: '#8ee07a', d: '#3a8a3a' }, ['......g', '.....gd', 'g...gd.', 'dg.gd..', '.dgd...', '..d....'], { outline: O });

definePixelSprite('ui_hourglass', { w: '#e0d8c8', s: '#f0c060', d: '#8a6a3a', g: '#a8c8e8' }, [
  'ddddddd',
  '.gssg..',
  '.gsssg.',
  '..gsg..',
  '...s...',
  '..g.g..',
  '.g.s.g.',
  '.gsssg.',
  'ddddddd',
], { outline: O });
definePixelSprite('ui_swords', { w: '#e8eef8', l: '#a8b4d0', h: '#e0a848', g: '#6a3a2a' }, [
  'w.......w',
  '.l.....l.',
  '..l...l..',
  '...l.l...',
  '....w....',
  '...l.l...',
  '.hh...hh.',
  '..g...g..',
  '.g.....g.',
], { outline: O });
definePixelSprite('ui_chest', { b: '#8a5a2a', B: '#b07a3a', y: '#e8c050', k: '#3a2408' }, [
  '.BBBBBBB.',
  'BbbbbbbbB',
  'bbbbbbbbb',
  'yyyyyyyyy',
  'bbbbybbbb',
  'bbbbkbbbb',
  'bbbbbbbbb',
  'kkkkkkkkk',
], { outline: O });
definePixelSprite('ui_crown', { y: '#ffd040', Y: '#fff0a0', d: '#b07a20', r: '#ff4060' }, [
  'y...y...y',
  'yy.yYy.yy',
  'yYyyyyyYy',
  'yyyyryyyy',
  'ddddddddd',
], { outline: O });
definePixelSprite('ui_eye', { w: '#e8e0ff', p: '#a070ff', k: '#1a0a30' }, [
  '..wwwww..',
  '.ww...ww.',
  'ww.ppp.ww',
  'w.ppkpp.w',
  'ww.ppp.ww',
  '.ww...ww.',
  '..wwwww..',
], { outline: O });
definePixelSprite('ui_door', { b: '#6a4a3a', d: '#3a2418', s: '#9a8aa8', y: '#e8c050' }, [
  '.sssss.',
  'ssbbbss',
  'sbbdbbs',
  'sbbdbbs',
  'sbbdbys',
  'sbbdbbs',
  'sbbdbbs',
], { outline: O });
definePixelSprite('ui_flame', { r: '#c04010', o: '#ff8a30', y: '#ffe080', w: '#ffffff' }, [
  '...o...',
  '..oo...',
  '..oyo..',
  '.oyyoo.',
  'ooywyoo',
  'oyywyyo',
  'royyyor',
  '.rrrrr.',
], { outline: O });
definePixelSprite('ui_book', { b: '#7a3a4a', B: '#a85a6a', p: '#f0e0c0', y: '#e8c050' }, [
  'bbbbbbbb.',
  'bBBBBBBbp',
  'bByyyyBbp',
  'bBBBBBBbp',
  'bBByyBBbp',
  'bBBBBBBbp',
  'bbbbbbbbp',
  '.pppppppp',
], { outline: O });
definePixelSprite('ui_gem', { b: '#c07bff', w: '#f0e0ff', d: '#6a3aa0' }, [
  '.bbbbb.',
  'bwwbbbd',
  'bwbbbdd',
  '.bbbdd.',
  '..bdd..',
  '...d...',
], { outline: O });
definePixelSprite('ui_bell', { y: '#e8c050', Y: '#fff0a0', d: '#9a6a20', k: '#3a2408' }, [
  '...y...',
  '..yYy..',
  '.yYyyd.',
  '.yYyyd.',
  '.yyyyd.',
  'yyyyyyd',
  'ddddddd',
  '...k...',
], { outline: O });
definePixelSprite('ui_gamepad', { g: '#8a8098', G: '#c8c0d8', d: '#4a4258', r: '#e04a4a', b: '#4a8ae0' }, [
  '.ggggggggg.',
  'gGGGGGGGGGg',
  'gGdGGGGGrGg',
  'gdddGGGbGrg',
  'gGdGGGGGbGg',
  'gggg...gggg',
], { outline: O });

// rarity gems (tiny)
const RAR: [string, string][] = [['common', '#d8d0c0'], ['rare', '#5fb8ff'], ['epic', '#c07bff'], ['legendary', '#ffb340']];
for (const [r, c] of RAR) {
  const rp = ramp(c, 4);
  definePixelSprite(`ui_rarity_${r}`, { a: rp[0], b: rp[1], c: rp[2], w: rp[3] }, ['.cc.', 'cwcb', 'bcba', '.ba.'], { outline: O });
}

// ------------------------------------------------------------------ map markers
definePixelSprite('map_player', { o: '#ff8a30', y: '#ffe080', w: '#ffffff' }, ['.o.', 'oyo', 'ywy', '.y.'], { outline: O });
definePixelSprite('map_start', { s: '#a8a0c0', w: '#e8e0ff' }, ['.w.', 'sws', '.s.'], { outline: O });

// ------------------------------------------------------------------ wax seal (item plaque)
defineDrawnSprite('ui_seal', 15, 15, (p) => {
  const red = ramp('#b0202c', 5);
  // irregular wax blob
  p.circle(7.5, 7.5, 7, red[2]);
  for (const [x, y] of [[1, 3], [13, 4], [2, 12], [12, 13], [7, 0], [0, 8], [14, 9]]) p.px(x, y, red[2]);
  p.shadeSphere(7.5, 7.5, 7.2, 7.2, red, { dither: true });
  p.ring(7.5, 7.5, 5, 1, red[1]);
  // embossed lantern
  p.rect(6, 4, 3, 1, red[4]);
  p.rect(5, 5, 5, 1, red[3]);
  p.rect(5, 6, 1, 4, red[3]);
  p.rect(9, 6, 1, 4, red[1]);
  p.rect(7, 7, 1, 2, red[4]);
  p.rect(5, 10, 5, 1, red[1]);
}, { outline: '#2a0408' });

// ------------------------------------------------------------------ keeper silhouette (character select "locked")
definePixelSprite('ui_keyhole', { k: '#05030a', g: '#3a3048' }, [
  '.ggg.',
  'gkkkg',
  'gkkkg',
  '.gkg.',
  '.gkg.',
  'gkkkg',
  'ggggg',
], { outline: O });
