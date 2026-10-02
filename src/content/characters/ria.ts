// Starting character: 리아, the last lantern keeper. Balanced; weapon 등불 마탄
// (src/content/weapons/lantern.ts). Release: 등불 개화 — a blooming spiral of
// homing flame bolts after a bullet-clearing flare.

import { defineCharacter } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { releaseLanternBloom } from './releases';

export const RIA: CharSpec = {
  prefix: 'ria',
  palette: {
    '1': '#1d3f52', '2': '#2c6c80', '3': '#46a0aa', '4': '#9adcc8',
    '7': '#b07428', '8': '#e8b048', '9': '#ffe48a',
    s: '#f8dcc4', S: '#d8a48c', p: '#f08878',
    e: '#1c1430', w: '#ffffff',
    a: '#8a1c28', b: '#d84038', c: '#ff8a64',
    t: '#e8c070',
    '5': '#2a2650', '6': '#433f7a',
  },
  front: [
    '......2332......',
    '....22333332....',
    '...2334433221...',
    '..223344333221..',
    '..233888998821..',
    '..2389s999s981..',
    '..28swesswes81..',
    '..27seesseeS71..',
    '..17spsssspS71..',
    '...12SssssS21...',
    '...abccbbbbba...',
    '..2333322bc221..',
    '..2333222ab221..',
    '..s3222222221s..',
    '..S1222222111S..',
    '...56666666655..',
    '..5566666665555.',
    '..t5555555555t..',
    '................',
    '................',
  ],
  back: [
    '......2332......',
    '....22333332....',
    '...2334433221...',
    '..223344333221..',
    '..233443333221..',
    '..233433332221..',
    '..233333322221..',
    '..223333222211..',
    '..122332222111..',
    '...1222222211...',
    '...abbbbbbbba...',
    '..2333bc222221..',
    '..2333ab222221..',
    '..s23322a22221s.',
    '..S12222222111S.',
    '...56666666655..',
    '..5566666665555.',
    '..t5555555555t..',
    '................',
    '................',
  ],
  side: [
    '.....2332.......',
    '...223333322....',
    '..22334433322...',
    '.2233443333221..',
    '.2233433888821..',
    '.2233337898ss...',
    '.223337ssswes...',
    '.223337ssseess..',
    '.122277ssspsS...',
    '..12221SSSS.....',
    '..babbbbcbb.....',
    '.ba2333322221...',
    'a..2333222221...',
    '...12222222s1...',
    '....1222221S....',
    '....56666655....',
    '...5666666555...',
    '...t55555555t...',
    '................',
    '................',
  ],
  feet: ['#1c2838', '#7a5032', '#2a1810'],
  feetRows: 2,
  feetX: [5, 9],
  sideFeetX: [5, 8],
  eyes: [[5, 6], [6, 6], [5, 7], [6, 7], [9, 6], [10, 6], [9, 7], [10, 7]],
  portrait(p) {
    // the lantern, held out to the right
    p.rect(19, 9, 1, 2, '#8a7a5a');
    p.rect(17, 11, 5, 1, '#5a4030');
    p.rect(17, 12, 5, 4, '#ffd060');
    p.rect(18, 13, 3, 2, '#fff8d0');
    p.rect(17, 16, 5, 1, '#5a4030');
    p.px(16, 12, '#f8dcc4');
  },
};

defineCharacter2D(RIA);

defineCharacter({
  id: 'ria',
  name: '리아',
  title: '마지막 등불지기',
  desc: '꺼져가는 마을의 등불을 되살리기 위해 지하로 내려간 소녀. 모든 능력이 고르다.',
  spritePrefix: 'ria',
  portrait: 'ria_portrait',
  color: '#ffd078',
  hearts: 3,
  weapon: 'lantern_bolt',
  bombs: 1,
  unlocked: true,
  lightColor: '#ffd8a0',
  release: releaseLanternBloom,
  releaseDesc: '탄환을 지우는 섬광 뒤, 유도 불꽃탄이 꽃잎처럼 사방으로 피어난다.',
});
