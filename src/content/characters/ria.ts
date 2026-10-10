// Starting character: 리아, the last lantern keeper — a golden retriever puppy in a
// teal hooded cloak. Balanced; weapon 등불 마탄 (src/content/weapons/lantern.ts).
// Release: 등불 개화 — a blooming spiral of homing flame bolts after a
// bullet-clearing flare.

import { defineCharacter } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { releaseLanternBloom } from './releases';
import { RIA_AFFINITY, RIA_DASH, RIA_PASSIVE } from './kit-ria';

export const RIA: CharSpec = {
  prefix: 'ria',
  palette: {
    // teal hood & cloak
    '1': '#1d3f52', '2': '#2c6c80', '3': '#46a0aa', '4': '#9adcc8',
    // golden retriever fur: light, mid, shade, deep shade
    f: '#ffe6a6', F: '#f2bb62', g: '#c8823a', G: '#8a4a2a',
    // floppy ears (a touch redder than the face)
    k: '#f0b058', K: '#cc7a34', l: '#8a4a2a',
    m: '#fff7e2', M: '#e8c898', n: '#2a1418', p: '#f8987c',
    e: '#1c1430', w: '#ffffff',
    a: '#8a1c28', b: '#d84038', c: '#ff8a64',
    t: '#e8c070',
    '5': '#2a2650', '6': '#433f7a',
  },
  front: [
    '......2332......',
    '....22344332....',
    '...k23444332l...',
    '..kk3ffffFF3ll..',
    '.kkKffffFFFFKll.',
    '.kKlweFFFFweKKl.',
    '.kKleeffffeeKKl.',
    '.kKlpFmnnmFpKKl.',
    '..KlgFmMMmFgll..',
    '...l.gFmmFg.l...',
    '...abccbbbbba...',
    '..2343322bt221..',
    '..2333222ab211..',
    '..F3222222221g..',
    '..g1232221211G..',
    '...56666666655..',
    '..5566666665555.',
    '..t5555555555t..',
    '................',
    '................',
  ],
  back: [
    '......2332......',
    '....22344332....',
    '...k23444332l...',
    '..kk344433332l..',
    '.kkK34433332Kll.',
    '.kKl33333222lKl.',
    '.kKl33332222lKl.',
    '.kKl23322221lKl.',
    '..Kl12222211ll..',
    '...l.122221.l...',
    '...abbbbbbbba...',
    '..2343bc222211..',
    '..2333ab232211..',
    '..F23322a22221g.',
    '..g12222222111G.',
    '...56666666655..',
    '..5566666665555.',
    '..t5555555555t..',
    '................',
    '................',
  ],
  side: [
    '....2332........',
    '..223443322.....',
    '.2234444332.....',
    '.23344433fff....',
    '.2334kkfffffF...',
    '.233kkKlfffweF..',
    '.233kKKlfFFeeFmn',
    '.123KKKlgFFFmmmn',
    '.122KKl.ggFgMMM.',
    '..12.l...gg.....',
    '..babbbbcbb.....',
    '.ba2333322221...',
    '...2333221221...',
    '...12222222F1...',
    '....1222221g....',
    '....56666655....',
    '...5666666555...',
    '...t55555555t...',
    '................',
    '................',
  ],
  tail: {
    // feathery golden tail: sweeps over the cloak (back), swings behind (side)
    back: {
      x: 4, y: 11, over: true,
      frames: [
        ['ff....', 'fFF...', '.gFF..', '..gFg.', '...g..'],
        ['...f..', '..fFg.', '..fFg.', '..gFg.', '...g..'],
        ['....ff', '...fFg', '..fFg.', '.gFg..', '..g...'],
      ],
    },
    side: {
      x: 0, y: 10,
      frames: [
        ['f...', 'Ff..', 'gFf.', '.gFf', '..gF'],
        ['....', 'ff..', 'FFf.', '.gFf', '..gF'],
        ['....', '....', 'ff..', 'gFFf', '.ggF'],
      ],
    },
  },
  ears: { keys: 'kKl', flop: true },
  paws: true,
  feet: ['#f2bb62', '#c8823a', '#8a4a2a'],
  feetRows: 2,
  feetX: [5, 9],
  sideFeetX: [5, 8],
  eyes: [[4, 5], [5, 5], [4, 6], [5, 6], [10, 5], [11, 5], [10, 6], [11, 6]],
  hurtFill: '#ffe6a6',
  portrait(p) {
    // the lantern, held out to the right
    p.rect(19, 9, 1, 2, '#8a7a5a');
    p.rect(17, 11, 5, 1, '#5a4030');
    p.rect(17, 12, 5, 4, '#ffd060');
    p.rect(18, 13, 3, 2, '#fff8d0');
    p.rect(17, 16, 5, 1, '#5a4030');
    p.px(16, 12, '#f2bb62');
  },
};

defineCharacter2D(RIA);

defineCharacter({
  id: 'ria',
  name: '리아',
  title: '마지막 등불지기',
  desc: '꺼져가는 마을의 등불을 되살리기 위해 지하로 내려간 강아지 소녀. 모든 능력이 고르고, 등불이 누구보다 빨리 타오른다.',
  spritePrefix: 'ria',
  portrait: 'ria_portrait',
  color: '#ffd078',
  hearts: 3,
  weapon: 'lantern_bolt',
  baseStats: {
    dashCooldown: 0.72,
  },
  unlocked: true,
  lightColor: '#ffd8a0',
  lightRadius: 125,
  release: releaseLanternBloom,
  releaseName: '등불 개화',
  releaseDesc: '탄환을 지우는 섬광 뒤, 유도 불꽃탄이 꽃잎처럼 사방으로 피어난다.',
  passive: RIA_PASSIVE,
  dash: RIA_DASH,
  affinity: RIA_AFFINITY,
  playstyle: ['균형', '등불 해방', '불꽃'],
  difficulty: 1,
  pitch: '해방을 가장 자주 터뜨리고, 어떤 무기든 불씨를 남긴다.',
});
