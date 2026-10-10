// Floor 7 (멈춘 태엽탑) room templates: halls of pendulum pillars (X), gear shafts (O)
// dropping into the works below, gear stacks (#) and porcelain vases (p). Legend as in
// normal-1x1.ts; big rooms use the same mirror helpers as normal-big.ts.

import { defineRoom } from '../../game/defs';
import type { RoomKind, RoomShape } from '../../game/constants';

const M = (half: string) => half + [...half].reverse().join('');
const C = (left9: string) => left9 + [...left9.slice(0, 8)].reverse().join('');

function room(shape: RoomShape, id: string, difficulty: number, rows: string[], weight = 1): void {
  defineRoom({ id: `ck${shape}_${id}`, shape, kinds: ['normal'], difficulty, rows, floors: [7], weight });
}

function sp(kind: RoomKind, id: string, rows: string[]): void {
  defineRoom({ id: `${kind}_clock_${id}`, shape: '1x1', kinds: [kind], rows, floors: [7] });
}

// ====================================================================== 1x1
// gear hall: four pendulum pillars
room('1x1', 'gearhall', 1, [
  '.................',
  '..e...........e..',
  '....X.......X....',
  '.................',
  '...e....E....e...',
  '.................',
  '....X.......X....',
  '..e...........e..',
  '.................',
]);

// the main shaft: a gear shaft in the middle, pillars at its corners
room('1x1', 'shaft', 2, [
  '.................',
  '.e.............e.',
  '.......OOO.......',
  '....X..OOO..X....',
  '...e...OOO...e...',
  '....X..OOO..X....',
  '.......OOO.......',
  '.e.............e.',
  '.................',
]);

// rows of pendulums with gear stacks between
room('1x1', 'pendulumrow', 2, [
  '.................',
  '..e.....#.....e..',
  '.X.X.X.....X.X.X.',
  '.................',
  '...#....E....#...',
  '.................',
  '.X.X.X.....X.X.X.',
  '..e.....#.....e..',
  '.................',
]);

// the workshop: vases, gear stacks and a stone lantern
room('1x1', 'workshop', 1, [
  '.................',
  '.p....e........p.',
  '....#.......#....',
  '..e......t....e..',
  '.......#.#.......',
  '..e...........e..',
  '....#.......#....',
  '.p....e........p.',
  '.................',
]);

// escapement: a maze of pillars around the centre
room('1x1', 'escapement', 3, [
  '.................',
  '.XX.e......e..XX.',
  '.X.....X.X.....X.',
  '....X.......X....',
  '...e...X.X...e...',
  '....X.......X....',
  '.X.....X.X.....X.',
  '.XX.e......e..XX.',
  '.................',
]);

// two shafts with a bridge of pillars between
room('1x1', 'shaftbridge', 2, [
  '.................',
  '.e.............e.',
  '.OOOO.......OOOO.',
  '.OOOO...e...OOOO.',
  '.......X.X.......',
  '.OOOO...e...OOOO.',
  '.OOOO.......OOOO.',
  '.e.............e.',
  '.................',
]);

// clock face: pillars on the hours around a shaft
room('1x1', 'clockface', 2, [
  '.................',
  '..e...X...X...e..',
  '....X.......X....',
  '.......OOO.......',
  '...X...OOO...X...',
  '.......OOO.......',
  '....X.......X....',
  '..e...X...X...e..',
  '.................',
]);

// ====================================================================== 2x1
// long gallery: shafts either side of a narrow middle, pillars at the ends
room('2x1', 'gallery', 2, [
  M('.................'),
  M('..e.....X......e.'),
  M('....X.......OOOO.'),
  M('............OOOO.'),
  M('...e....E...OOOO.'),
  M('............OOOO.'),
  M('....X.......OOOO.'),
  M('..e.....X......e.'),
  M('.................'),
]);

// twin shafts: two long drops with pillars at the corners
room('2x1', 'twinshafts', 3, [
  M('.................'),
  M('.e..X.........X..'),
  M('......OOOO.......'),
  M('.X....OOOO...e...'),
  M('......OOOO.......'),
  M('.X....OOOO...e...'),
  M('......OOOO.......'),
  M('.e..X.........X..'),
  M('.................'),
]);

// ====================================================================== 1x2
// the tower: landings between shafts and pillars
room('1x2', 'tower', 2, [
  C('.........'),
  C('..e......'),
  C('....X....'),
  C('.........'),
  C('.OOO.....'),
  C('.OOO..e..'),
  C('.........'),
  C('....X....'),
  C('...e.E...'),
  C('.........'),
  C('....X....'),
  C('.........'),
  C('.OOO..e..'),
  C('.OOO.....'),
  C('.........'),
  C('....X....'),
  C('..e......'),
  C('.........'),
]);

// stairs: gear stacks and pillars climbing past two shafts
room('1x2', 'stairs', 3, [
  C('.........'),
  C('.e...e...'),
  C('.#.......'),
  C('...X.X...'),
  C('.........'),
  C('.OO...e..'),
  C('.OO......'),
  C('.....#...'),
  C('..e..E...'),
  C('.........'),
  C('.....#...'),
  C('.OO......'),
  C('.OO...e..'),
  C('.........'),
  C('...X.X...'),
  C('.#.......'),
  C('.e...e...'),
  C('.........'),
]);

// ====================================================================== 2x2
// the great wheel: four shafts around a cross of pillars
room('2x2', 'greatwheel', 3, [
  M('.................'),
  M('..e...........e..'),
  M('....X.......X....'),
  M('........OOOOO....'),
  M('...e....OOOOO....'),
  M('........OOOOO....'),
  M('.X..........X....'),
  M('.......e.......E.'),
  M('.X......OOOOO....'),
  M('.X......OOOOO....'),
  M('.......e.......E.'),
  M('.X..........X....'),
  M('........OOOOO....'),
  M('...e....OOOOO....'),
  M('........OOOOO....'),
  M('....X.......X....'),
  M('..e...........e..'),
  M('.................'),
]);

// assembly hall: rows of pillars, vases and a long central shaft
room('2x2', 'assembly', 2, [
  M('.................'),
  M('.p..e.........#..'),
  M('.................'),
  M('....X....X....X..'),
  M('...e....e........'),
  M('....X....X....X..'),
  M('.........OOO.....'),
  M('.#.......OOO...e.'),
  M('.........OOO.....'),
  M('.........OOO.....'),
  M('.#.......OOO...e.'),
  M('.........OOO.....'),
  M('....X....X....X..'),
  M('...e....e........'),
  M('....X....X....X..'),
  M('.................'),
  M('.p..e.........#..'),
  M('.................'),
]);

// ====================================================================== special rooms
sp('start', 'pillars', [
  '.................',
  '.X.............X.',
  '.................',
  '.................',
  '.................',
  '.................',
  '.................',
  '.X.............X.',
  '.................',
]);
sp('treasure', 'vault', [
  '.................',
  '.p.............p.',
  '..OO.........OO..',
  '..OO.........OO..',
  '.................',
  '..OO.........OO..',
  '..OO.........OO..',
  '.p.............p.',
  '.................',
]);
sp('boss', 'belfry', [
  '.................',
  '.................',
  '..X.....B.....X..',
  '.................',
  '.................',
  '.................',
  '.................',
  '..X...........X..',
  '.................',
]);
