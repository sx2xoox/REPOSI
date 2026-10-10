// 백구, 반격의 달인 — a white Jindo swordsman in a navy jacket with a white sash;
// fragile (2 hearts), quick, built around perfect dodges (간파). Weapon 흰 송곳니
// (fang blade). Release: 섬광 연참. Unlocked by a flawless boss kill.

// roster order on character select: 리아, 베른, 세린, 니엘, 보리, 백구, 모리 (registration order)
import './bori';
import { defineCharacter } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { BAEKGU_AFFINITY, BAEKGU_DASH, BAEKGU_PASSIVE, releaseFlashSlashes } from './kit-baekgu';

export const BAEKGU: CharSpec = {
  prefix: 'baekgu',
  palette: {
    // white Jindo: white face & muzzle, cream cap and ears, pink ear insides
    h: '#fbf7ec', H: '#e4dccb', x: '#c4b8a2', k: '#f1e3c2', K: '#d8c69c', i: '#f0a8a0',
    e: '#1a1420', w: '#ffffff', n: '#141014', p: '#e89090',
    // navy jacket, white sash, gold belt, red charm
    '1': '#1c2650', '2': '#2d3f80', '3': '#4a62b8', '4': '#7a8fd8',
    s: '#f4ecd8', t: '#d8a040', r: '#d83c2c',
  },
  front: [
    '...k........k...',
    '..kik......kik..',
    '..kiik....kiik..',
    '..khhkkkkkkkKK..',
    '.khhhhhhhhhhKKk.',
    '.khhwehhhhhewhhk',
    '.khheehhhhheehhk',
    '..xhhhhhnnhhhhx.',
    '..xHhhhHHhhhhHx.',
    '...xHHhhhhHHHx..',
    '..s2222222222r..',
    '..1s23433332211.',
    '..123s233322121.',
    '..1222s22222221.',
    '..12222s2222221.',
    '..1ttttsntttt1..',
    '..122222222221..',
    '................',
    '................',
    '................',
  ],
  back: [
    '...k........k...',
    '..kkk......kkk..',
    '..kkkk....kkkk..',
    '..kkkkkkkkkkkk..',
    '.kkkkkkkkkkkkkk.',
    '.kkkkkkkkkkkkkk.',
    '.kkkKkkkkkkKkkk.',
    '..KkkkkkkkkkkK..',
    '..KKkkkkkkkkKK..',
    '...KKKKkkKKKK...',
    '..s22222222222..',
    '..1s2332222211..',
    '..123s22212221..',
    '..122s22222221..',
    '..1222s2222221..',
    '..1tttttttttt1..',
    '..122222222221..',
    '................',
    '................',
    '................',
  ],
  side: [
    '.....k....k.....',
    '....kik..kik....',
    '....kiik.kiik...',
    '....kkkkkkkkk...',
    '...kkkkkkhhhhh..',
    '...kkkkkhhhwehh.',
    '...kkkkhhhheehhn',
    '....xhhhhhhhhhh.',
    '....xHhhhhhhhhp.',
    '.....xHHhhhhh...',
    '....s22222222...',
    '...1s233332221..',
    '...12s3333222...',
    '...122s222221...',
    '...1222s22221...',
    '...1tttttttt1...',
    '...1222222221...',
    '................',
    '................',
    '................',
  ],
  tail: {
    // the Jindo's sickle tail curls up over the back (cream with a white tip)
    back: {
      x: 8, y: 9, over: true,
      frames: [
        ['..hkk.', '.hkkK.', '.kkK..', '.kK...', '.K....'],
        ['...hk.', '..hkkK', '..kkK.', '.kK...', '.K....'],
        ['....hk', '...hkK', '..kkK.', '..kK..', '.K....'],
      ],
    },
    side: {
      x: 0, y: 8, over: true,
      frames: [
        ['.hkk', 'hkkK', 'kkK.', 'kK..', 'K...'],
        ['..hk', '.hkK', 'kkK.', 'kK..', 'K...'],
        ['...h', '..hk', '.kkK', 'kkK.', 'K...'],
      ],
    },
  },
  paws: true,
  feet: ['#fbf7ec', '#e4dccb', '#c4b8a2'],
  feetRows: 3,
  feetX: [5, 9],
  sideFeetX: [5, 8],
  eyes: [[4, 5], [5, 5], [4, 6], [5, 6], [10, 5], [11, 5], [10, 6], [11, 6]],
  hurtFill: '#fbf7ec',
  portrait(p) {
    // the fang blade held low on the right, point up
    p.line(19, 15, 19, 11, '#2d3f80');
    p.px(19, 16, '#d8a040');
    p.rect(18, 10, 3, 1, '#d8a040');
    for (let i = 0; i < 7; i++) p.px(19 + Math.floor(i * 0.3), 9 - i, i > 4 ? '#ffffff' : '#f4f2ea');
    for (let i = 0; i < 5; i++) p.px(20 + Math.floor(i * 0.3), 9 - i, '#b8b4a8');
  },
};

defineCharacter2D(BAEKGU);

defineCharacter({
  id: 'baekgu',
  name: '백구',
  title: '반격의 달인',
  desc: '달빛 아래 홀로 칼을 갈던 진돗개 검객. 몸은 약하지만 눈은 누구보다 빠르다. 피하는 순간이 곧 베는 순간이다.',
  spritePrefix: 'baekgu',
  portrait: 'baekgu_portrait',
  color: '#f0ece0',
  hearts: 2,
  weapon: 'fang_blade',
  coins: 3,
  baseStats: {
    moveSpeed: 100,
    damage: 11,
    range: 150,
    dashCooldown: 0.55,
    dashSpeed: 300,
    dashTime: 0.12,
    critChance: 0.08,
  },
  unlocked: false,
  unlockRequirement: '보스방에서 피해를 받지 않고 보스 처치',
  unlockHint: '보스를 한 번도 맞지 않고 쓰러뜨리면, 흰 개가 당신을 알아본다.',
  lightColor: '#e8f0ff',
  release: releaseFlashSlashes,
  releaseName: '섬광 연참',
  releaseDesc: '잔상만 남기며 적 사이를 누벼 여섯 번 베고, 스치는 탄환을 모두 되받아친 뒤 묵직한 십자 베기로 끝낸다.',
  passive: BAEKGU_PASSIVE,
  dash: BAEKGU_DASH,
  affinity: BAEKGU_AFFINITY,
  playstyle: ['근접', '간파', '고위험'],
  difficulty: 3,
  pitch: '적의 공격을 읽어 베어 넘긴다. 타이밍을 갈고닦는 이에게.',
});
