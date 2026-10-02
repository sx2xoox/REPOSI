// 세린, 잿빛 숲의 사냥꾼 — a beagle hunter; fragile (2 hearts) but fast.
// Weapon 사냥꾼의 장궁: hold to draw, release a piercing arrow. Release: 별똥 화살비.

// roster order on character select: 리아, 베른, 세린, 니엘 (registration order)
import './bern';
import { defineCharacter } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { releaseArrowRain } from './releases';
import { SERIN_AFFINITY, SERIN_DASH, SERIN_PASSIVE } from './kit-serin';

export const SERIN: CharSpec = {
  prefix: 'serin',
  palette: {
    // green hunter hood & tunic, red-gold feather
    '1': '#183620', '2': '#28642e', '3': '#46943c', '4': '#90cc5c',
    f: '#e03c2c', F: '#ffd860',
    // beagle tri-color: tan, white blaze & muzzle, black saddle, long brown ears
    q: '#f2b46c', j: '#d4843e', J: '#9a5428',
    h: '#fff8ea', H: '#e2d0b8',
    k: '#3a2c30', K: '#1e161c',
    r: '#b8642e', R: '#7e3c1e', z: '#4a2214',
    e: '#24140c', w: '#ffffff', n: '#1a1214', p: '#ec8470',
    // leather & cloth
    a: '#42261a', b: '#74482a', c: '#ac7846',
    '5': '#e0d0a8', '6': '#a89670', d: '#2e2a3c',
  },
  front: [
    '...........fF...',
    '......2333.fF...',
    '....22334444f...',
    '...r23344433R...',
    '..rrqqqhhjjjRz..',
    '.rRzweqhhjweRRz.',
    '.rRzeeqhhjeeRRz.',
    '.rRzpjhnnhjpRRz.',
    '.rRzJhhHHhhJRRz.',
    '.rRz.JhhhhJ.zRz.',
    '.rRz3222222zRRz.',
    '..Rz22b2222zRz..',
    '...q5b5555b5J...',
    '...Jab6556abJ...',
    '....aacbbaaa....',
    '....d2222222....',
    '....dd2222dd....',
    '................',
    '................',
    '................',
  ],
  back: [
    '.........f......',
    '......2333.fF...',
    '....22334444f...',
    '...r23344433R...',
    '..rr233333322z..',
    '.rRz333333221Rz.',
    '.rRz12333322RRz.',
    '.rRzjj1222jjRRz.',
    '.rRzqjjjjjFfRRz.',
    '.rRz.JjjjJcbzRz.',
    '.rRz332222cbRRz.',
    '..Rz222222cbRz..',
    '...q22222cb2J...',
    '...J2222cb22J...',
    '....aacbbaaa....',
    '....d2222222....',
    '....dd2222dd....',
    '................',
    '................',
    '................',
  ],
  side: [
    '..........fF....',
    '.....2333fF.....',
    '...223344fF.....',
    '..2233444433....',
    '.122333333qqq...',
    '.1223rRqqqweqq..',
    '..123rRzqqeehhhn',
    '...12rRzJqqhhhhn',
    '....rRz.JjjHHH..',
    '....Rz...JJ.....',
    '....3322223.....',
    '...a32222b23....',
    '...ab555b5q.....',
    '...aab556J......',
    '....aacbaa......',
    '....d22222......',
    '....dd22dd......',
    '................',
    '................',
    '................',
  ],
  hemAlt: {
    side: [
      '...ab555b5q.....',
      '...aab556J......',
      '....aacbaa......',
      '....d22222......',
      '....dd22dd......',
      '................',
      '................',
      '................',
    ],
  },
  tail: {
    // thin beagle "flag" tail with a white tip, held high
    back: {
      x: 4, y: 10, over: true,
      frames: [
        ['hh...', 'hj...', '.jJ..', '..jJ.', '...J.'],
        ['..hh.', '..hJ.', '..jJ.', '..jJ.', '...J.'],
        ['....h', '...hh', '..jJ.', '..jJ.', '...J.'],
      ],
    },
    side: {
      x: 0, y: 9, over: true,
      frames: [
        ['.h..', '.hJ.', '.jJ.', '..jJ', '...J'],
        ['....', 'hh..', '.jJ.', '..jJ', '...J'],
        ['....', '....', '....', 'hjjJ', '...J'],
      ],
    },
  },
  ears: { keys: 'rRz', flop: true },
  paws: true,
  feet: ['#f2b46c', '#fff8ea', '#9a5428'],
  feetRows: 3,
  feetX: [5, 9],
  sideFeetX: [5, 8],
  eyes: [[4, 5], [5, 5], [4, 6], [5, 6], [10, 5], [11, 5], [10, 6], [11, 6]],
  hurtFill: '#f2b46c',
  portrait(p) {
    // longbow held upright on the right
    for (let y = 2; y < 19; y++) {
      const k = Math.abs(y - 10.5) / 8.5;
      p.px(19 - Math.round(k * k * 3), y, y < 4 || y > 17 ? '#c08a50' : '#8a5a30');
    }
    p.line(16, 2, 16, 18, '#e8e0d0');
  },
};

defineCharacter2D(SERIN);

defineCharacter({
  id: 'serin',
  name: '세린',
  title: '잿빛 숲의 사냥꾼',
  desc: '불타 버린 숲에서 홀로 살아남은 비글 사냥꾼. 몸은 약하지만 누구보다 빠르고, 한 번 맡은 냄새는 놓치지 않는다.',
  spritePrefix: 'serin',
  portrait: 'serin_portrait',
  color: '#a8e070',
  hearts: 2,
  weapon: 'hunter_bow',
  bombs: 1,
  coins: 5,
  baseStats: {
    moveSpeed: 106,
    damage: 11,
    range: 215,
    dashCooldown: 0.6,
    dashSpeed: 400,
    dashTime: 0.16,
    critChance: 0.1,
    luck: 1,
  },
  unlocked: true,
  lightColor: '#d8f0b0',
  release: releaseArrowRain,
  releaseName: '별똥 화살비',
  releaseDesc: '하늘로 쏘아 올린 등불 화살이 별똥처럼 갈라져 방 안의 모든 적에게 쏟아진다.',
  passive: SERIN_PASSIVE,
  dash: SERIN_DASH,
  affinity: SERIN_AFFINITY,
  playstyle: ['원거리', '표식', '치명타'],
  difficulty: 2,
  pitch: '첫 발은 반드시 치명타. 거리를 재며 한 발씩 끊어 쏘는 이에게.',
});
