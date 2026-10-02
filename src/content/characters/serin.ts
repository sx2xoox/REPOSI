// 세린, 잿빛 숲의 사냥꾼 — fragile (2 hearts) but fast. Weapon 사냥꾼의 장궁:
// hold to draw, release a piercing arrow. Release: 별똥 화살비.

// roster order on character select: 리아, 베른, 세린, 니엘 (registration order)
import './bern';
import { defineCharacter } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { releaseArrowRain } from './releases';

export const SERIN: CharSpec = {
  prefix: 'serin',
  palette: {
    '1': '#183620', '2': '#28642e', '3': '#46943c', '4': '#90cc5c',
    '7': '#782a16', '8': '#c05628', '9': '#f48c48',
    s: '#f6d6bc', S: '#d0a088', p: '#ec8470',
    e: '#14281c', w: '#ffffff',
    a: '#42261a', b: '#74482a', c: '#ac7846',
    f: '#e03c2c', F: '#ffd860',
    '5': '#e0d0a8', '6': '#a89670', d: '#2e2a3c',
  },
  front: [
    '...........fF...',
    '......2333.fF...',
    '....22334444f...',
    '...22334443332..',
    '..1223333333321.',
    '..1788999998871.',
    '..78swesswes87..',
    '..78seesseeS87..',
    '..77spsssspS77..',
    '..78.SssssS.87..',
    '..73322222233.7.',
    '..8322b222223...',
    '...s5b5555b5s...',
    '...Sab6556abS...',
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
    '...22334443332..',
    '..1223333333321.',
    '..1233333332221.',
    '..712233332217..',
    '..778888887777F5',
    '...7777887777cF.',
    '.....S.87.S.cb..',
    '..3332287223b...',
    '..332228722b3...',
    '...s22287b22s...',
    '...S2ba77b22S...',
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
    '.122333333332...',
    '.12233388898....',
    '78123378swes....',
    '7877378sseess...',
    '87.7877sspsS....',
    '8...777SSSS.....',
    '....3322223.....',
    '...a32222b23....',
    '...ab555b5s.....',
    '...aab556S......',
    '....aacbaa......',
    '....d22222......',
    '....dd22dd......',
    '................',
    '................',
    '................',
  ],
  hemAlt: {
    side: [
      '...ab555b5s.....',
      '...aab556S......',
      '....aacbaa......',
      '....d22222......',
      '....dd22dd......',
      '................',
      '................',
      '................',
    ],
  },
  feet: ['#2e2a3c', '#74482a', '#24140c'],
  feetRows: 3,
  feetX: [5, 9],
  sideFeetX: [5, 8],
  eyes: [[5, 6], [6, 6], [5, 7], [6, 7], [9, 6], [10, 6], [9, 7], [10, 7]],
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
  desc: '불타 버린 숲에서 홀로 살아남은 사냥꾼. 몸은 약하지만 누구보다 빠르고, 활시위를 끝까지 당기면 화살이 모든 것을 꿰뚫는다.',
  spritePrefix: 'serin',
  portrait: 'serin_portrait',
  color: '#a8e070',
  hearts: 2,
  weapon: 'hunter_bow',
  artifacts: ['hunter_eye'],
  bombs: 1,
  coins: 5,
  baseStats: {
    moveSpeed: 106,
    dashCooldown: 0.6,
    dashSpeed: 360,
    critChance: 0.1,
    luck: 1,
  },
  unlocked: true,
  lightColor: '#d8f0b0',
  release: releaseArrowRain,
  releaseDesc: '하늘로 쏘아 올린 등불 화살이 별똥처럼 갈라져 방 안의 모든 적에게 쏟아진다.',
});
