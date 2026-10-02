// Floor 6 (수몰된 서고) room templates: reading halls between rows of bookcases (X),
// flooded channels (O), toppled book piles (#) and ink jars (p). Legend as in
// normal-1x1.ts; big rooms use the same mirror helpers as normal-big.ts.

import { defineRoom } from '../../game/defs';
import type { RoomKind, RoomShape } from '../../game/constants';

const M = (half: string) => half + [...half].reverse().join('');
const C = (left9: string) => left9 + [...left9.slice(0, 8)].reverse().join('');

function room(shape: RoomShape, id: string, difficulty: number, rows: string[], weight = 1): void {
  defineRoom({ id: `ar${shape}_${id}`, shape, kinds: ['normal'], difficulty, rows, floors: [6], weight });
}

function sp(kind: RoomKind, id: string, rows: string[]): void {
  defineRoom({ id: `${kind}_archive_${id}`, shape: '1x1', kinds: [kind], rows, floors: [6] });
}

// ====================================================================== 1x1
// reading hall: desks (bookcases) in two rows with aisles between
room('1x1', 'readinghall', 1, [
  '.................',
  '..e...........e..',
  '...XX..XXX..XX...',
  '.................',
  '....e...E...e....',
  '.................',
  '...XX..XXX..XX...',
  '..e...........e..',
  '.................',
]);

// aisles flooded by two channels
room('1x1', 'floodedaisles', 2, [
  '.................',
  '.e..O.......O..e.',
  '....O..X.X..O....',
  '....O.......O....',
  '........e........',
  '....O.......O....',
  '....O..X.X..O....',
  '.e..O.......O..e.',
  '.................',
]);

// the stacks: toppled piles and standing cases
room('1x1', 'stacks', 2, [
  '.................',
  '..#...e.....#....',
  '.....XXX...#.....',
  '.#..........X....',
  '........E........',
  '....X..........#.',
  '.....#...XXX.....',
  '....#.....e...#..',
  '.................',
]);

// an ink pool in the middle, jars around it
room('1x1', 'inkpool', 2, [
  '.................',
  '.e.............e.',
  '....p.......p....',
  '......OOOOO......',
  '...e..OOOOO..e...',
  '......OOOOO......',
  '....p.......p....',
  '.e.............e.',
  '.................',
]);

// a maze of bookcases
room('1x1', 'shelfmaze', 3, [
  '.................',
  '.XXX.XXXXX.XXX.e.',
  '...X.....X.......',
  '.X.X.XXX.X.XXX.X.',
  '...e.X.E.X.....X.',
  '.X.X.X...X.XXX.X.',
  '...X...X.....X...',
  '.e.XXX.XXXXX.XXX.',
  '.................',
]);

// drowned desks: channels left and right, a desk in the middle of each row
room('1x1', 'drowneddesks', 1, [
  '.................',
  '..e.....X.....e..',
  '.................',
  '.OOO.........OOO.',
  '.OOO....e....OOO.',
  '.OOO.........OOO.',
  '.................',
  '..e.....X.....e..',
  '.................',
]);

// scriptorium: a lectern (block) ringed by jars, piles in the corners
room('1x1', 'scriptorium', 2, [
  '#...............#',
  '....e.......e....',
  '.....p.....p.....',
  '.......X.X.......',
  '...e....X....e...',
  '.......X.X.......',
  '.....p.....p.....',
  '....e.......e....',
  '#...............#',
]);

// ====================================================================== 2x1
// long gallery: a flooded channel down each half, cases at the ends
room('2x1', 'gallery', 2, [
  M('.................'),
  M('..e....X....X....'),
  M('.......X....X....'),
  M('..OOOOO.....e....'),
  M('..OOOOO..........'),
  M('..OOOOO.....e....'),
  M('.......X....X....'),
  M('..e....X....X....'),
  M('.................'),
]);

// two reading rooms divided by a wall of bookcases with a gap
room('2x1', 'twinrooms', 3, [
  M('................X'),
  M('..e.............X'),
  M('.....XX.........X'),
  M('.....XX..........'),
  M('........E........'),
  M('.....XX..........'),
  M('.....XX.........X'),
  M('..e.......e.....X'),
  M('................X'),
]);

// ====================================================================== 1x2
// stairwell: landings between flooded steps
room('1x2', 'stairwell', 2, [
  C('.........'),
  C('..e......'),
  C('....XX...'),
  C('.........'),
  C('.......e.'),
  C('.OOO.....'),
  C('.OOO.....'),
  C('.........'),
  C('....E....'),
  C('.........'),
  C('.OOO.....'),
  C('.OOO.....'),
  C('.......e.'),
  C('.........'),
  C('....XX...'),
  C('..e......'),
  C('.........'),
  C('.........'),
]);

// archive well: a deep pool in the middle, piles along the edges
room('1x2', 'well', 3, [
  C('.........'),
  C('.e.......'),
  C('.........'),
  C('.#...OOOO'),
  C('.....OOOO'),
  C('..e..OOOO'),
  C('.#.......'),
  C('.........'),
  C('....E....'),
  C('.........'),
  C('.#.......'),
  C('..e..OOOO'),
  C('.....OOOO'),
  C('.#...OOOO'),
  C('.........'),
  C('.e.......'),
  C('.........'),
  C('.........'),
]);

// ====================================================================== 2x2
// grand hall: a central lake with reading desks around it
room('2x2', 'grandhall', 3, [
  M('.................'),
  M('..e..............'),
  M('...XXX.....XXX...'),
  M('.................'),
  M('......e..........'),
  M('.........OOOOOOOO'),
  M('.........OOOOOOOO'),
  M('..XX.....OOOOOOOO'),
  M('..XX.........E...'),
  M('..XX.........e...'),
  M('..XX.....OOOOOOOO'),
  M('.........OOOOOOOO'),
  M('.........OOOOOOOO'),
  M('......e..........'),
  M('.................'),
  M('...XXX.....XXX...'),
  M('..e..............'),
  M('.................'),
]);

// sunken stacks: channels in the corners, piles and cases everywhere
room('2x2', 'sunkenstacks', 2, [
  M('.................'),
  M('..e.......#......'),
  M('....#...XXX......'),
  M('.OOO.............'),
  M('.OOO..e.......#..'),
  M('.OOO.....#.......'),
  M('.........#..XXX..'),
  M('..#..............'),
  M('.......e......E..'),
  M('.......e.........'),
  M('..#..............'),
  M('.........#..XXX..'),
  M('.OOO.....#.......'),
  M('.OOO..e.......#..'),
  M('.OOO.............'),
  M('....#...XXX......'),
  M('..e.......#......'),
  M('.................'),
]);

// ====================================================================== special rooms
sp('start', 'desks', [
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
sp('treasure', 'lectern', [
  '.................',
  '.#.............#.',
  '....OO.....OO....',
  '....OO.....OO....',
  '.................',
  '....OO.....OO....',
  '....OO.....OO....',
  '.#.............#.',
  '.................',
]);
sp('boss', 'drownedhall', [
  '.................',
  '.................',
  '..#.....B.....#..',
  '.................',
  '.................',
  '.................',
  '.................',
  '..#...........#..',
  '.................',
]);
