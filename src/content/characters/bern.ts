// 베른, 검을 든 파수꾼 — a melee fighter. Sturdy (4 hearts) but slower; weapon
// 파수꾼의 장검 (3-hit combo that deflects bullets). Release: 등불 회전베기.

import { defineCharacter } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { releaseWhirlwind } from './releases';

export const BERN: CharSpec = {
  prefix: 'bern',
  palette: {
    '7': '#6a7090', '8': '#b8c2dc', '9': '#f2f5ff',
    s: '#f4d2b8', S: '#cc9a84', p: '#e88070',
    e: '#18203c', w: '#ffffff',
    a: '#5c1022', b: '#a8283a', c: '#e85062',
    '1': '#161c3c', '2': '#28366c', '3': '#3e58a0', '4': '#7896dc',
    m: '#3a4058', n: '#8690b0', o: '#e0e8fa',
    t: '#f0c050', l: '#5a3a24', '5': '#22263a',
  },
  front: [
    '.....9..98......',
    '....8998998.....',
    '...78999999887..',
    '..7899999998877.',
    '..7cbbbbbbbbba7.',
    '..789s8ss8s987..',
    '..78swesswes87..',
    '..7sseesseesS7..',
    '...7spsssspS7...',
    '....SssssssS....',
    '.onnm233332mnnm.',
    '.anm2334t321mna.',
    '.aon233t3221nma.',
    '.asllllttllllsa.',
    '.a.2334332221.a.',
    'aa.2333222211.aa',
    'a..5222222215..a',
    '................',
    '................',
    '................',
  ],
  back: [
    '......9..8......',
    '....8998998.....',
    '...78999998887..',
    '..7899999988877.',
    '..7cbbbbbbbbba7.',
    '..78999998888ab.',
    '..789998888877b.',
    '..78888887777.a.',
    '...777777777....',
    '....SSSSSSSS....',
    '.onnmbbbbbbmnnm.',
    '.anmcbbbbbbbmna.',
    '.aoncbbbbbbbbma.',
    '.ascbbbbbbbbbsa.',
    '..acbbbbbbbbba..',
    '..acbbbbbbbbaa..',
    '..aabbbbbbbaaa..',
    '................',
    '................',
    '................',
  ],
  side: [
    '.....9..98......',
    '...8899998......',
    '..789999998.....',
    '.78999999988....',
    'ba7bbbbbbbbbc...',
    '.a7889998s8ss...',
    '..788998swess...',
    '..78898sseesss..',
    '..7887ssspsS....',
    '...77SSSSS......',
    '.abmnooonm32....',
    '.ab2mnnnm332....',
    '.ab23mnm3321....',
    '.abllllltlls....',
    '.aa23333322.....',
    'aa.2333222211...',
    'a...52222215....',
    '................',
    '................',
    '................',
  ],
  hemAlt: {
    front: [
      '.a.2333222211.a.',
      '.a.5222222215.a.',
      '................',
      '................',
      '................',
    ],
    side: [
      '.aa2333222211...',
      'aa..52222215....',
      '................',
      '................',
      '................',
    ],
  },
  feet: ['#22263a', '#4a4e68', '#1a1420'],
  feetRows: 3,
  feetX: [5, 9],
  sideFeetX: [5, 8],
  eyes: [[5, 6], [6, 6], [5, 7], [6, 7], [9, 6], [10, 6], [9, 7], [10, 7]],
  portrait(p) {
    // longsword resting on the right shoulder
    for (let i = 0; i < 12; i++) p.px(15 + Math.floor(i * 0.45), 1 + i, i < 2 ? '#ffffff' : '#c8d4ec');
    for (let i = 2; i < 12; i++) p.px(16 + Math.floor(i * 0.45), 1 + i, '#7c88a8');
    p.rect(18, 12, 4, 1, '#f0c050');
    p.rect(19, 13, 2, 3, '#5a3a24');
  },
};

defineCharacter2D(BERN);

defineCharacter({
  id: 'bern',
  name: '베른',
  title: '검을 든 파수꾼',
  desc: '무너진 성문을 끝까지 지켰던 파수꾼. 단단하지만 느리고, 장검 3연격으로 탄환까지 베어낸다.',
  spritePrefix: 'bern',
  portrait: 'bern_portrait',
  color: '#8fb0ff',
  hearts: 4,
  weapon: 'sentinel_blade',
  bombs: 1,
  keys: 1,
  baseStats: {
    moveSpeed: 84,
    damage: 13,
    knockback: 90,
    dashCooldown: 0.8,
  },
  unlocked: true,
  lightColor: '#b8d0ff',
  release: releaseWhirlwind,
  releaseDesc: '등불을 두른 검으로 회전베기를 휘몰아친 뒤, 사방으로 검기를 날린다.',
});
