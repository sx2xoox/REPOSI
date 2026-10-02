// 모리, 혼령 양치기 — a black-and-white border collie in a moss-green poncho with
// a red bandana; fights beside two spirit sheep that herd enemies together.
// Weapon 목동의 지팡이 (shepherd's crook). Release: 양몰이 돌격. Unlocked at 300 kills.

// roster order on character select: 리아, 베른, 세린, 니엘, 보리, 백구, 모리 (registration order)
import './baekgu';
import { defineCharacter } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { MORI_AFFINITY, MORI_DASH, MORI_PASSIVE, releaseStampede } from './kit-mori';

export const MORI: CharSpec = {
  prefix: 'mori',
  palette: {
    // border collie: black cap, back and ears with a white blaze, muzzle, collar & socks
    K: '#1e1c26', k: '#363444', q: '#55536a',
    h: '#fbf8f2', H: '#dcd6cf', x: '#b8b0a8',
    // one brown eye, one blue eye (a collie thing)
    e: '#1a1420', v: '#6ab8ff', w: '#ffffff', n: '#141014', p: '#f08a8a',
    // red bandana with white dots, moss-green poncho
    r: '#d83c2c', R: '#a02418', s: '#fff0e0',
    '1': '#2e4a2a', '2': '#4a7040', '3': '#6f9a54', '4': '#a6cc78',
  },
  front: [
    '..K.........K...',
    '.KkK.......KkK..',
    '.KkkKKKhhKKKkkK.',
    '.KkkkKKhhKKkkkK.',
    '..KkkkkhhkkkkK..',
    '..KkwekhhkevkK..',
    '..KkeekhhkeekK..',
    '..xhhhhnnhhhhx..',
    '...hHhhhhhhHh...',
    '....xhhpphx.....',
    '...hrrrrrrrrh...',
    '..1hrRrsrrrRrh1.',
    '..13322hhhh2231.',
    '..1332hhhhhh331.',
    '..1222hhhhhh221.',
    '..11222hhhh2211.',
    '...1122hhhh211..',
    '................',
    '................',
    '................',
  ],
  back: [
    '..K.........K...',
    '.KkK.......KkK..',
    '.KkkKKKKKKKKkkK.',
    '.KkkkKKKKKKkkkK.',
    '..KkkkkkkkkkkK..',
    '..KkkkkkkkkkkK..',
    '..KkkkkkkkkkkK..',
    '..xKkkkkkkkkKx..',
    '...KKkkkkkkKK...',
    '....KKKKKKKK....',
    '...hrrrrrrrrh...',
    '..1hrrrrrrrrh1..',
    '..1332222222331.',
    '..1332222222331.',
    '..1222222222221.',
    '..11222222222211',
    '...11222222211..',
    '................',
    '................',
    '................',
  ],
  side: [
    '....K.....K.....',
    '...KkK...KkK....',
    '...KkkKKKKkkK...',
    '...KkkkkKKkkhh..',
    '...KkkkkkkhhhHh.',
    '...KkkkkkhhhvwH.',
    '...KkkkkkhhheeHn',
    '....xkkhhhhhhhh.',
    '....xHhhhhhhhhp.',
    '.....xhhhhhhh...',
    '....hrrrrrrrh...',
    '...1hrRrsrrrh1..',
    '...13322hhh231..',
    '...1332hhhh331..',
    '...1222hhhh221..',
    '...1122hhh2211..',
    '....112hhh211...',
    '................',
    '................',
    '................',
  ],
  hemAlt: {
    front: [
      '..11222hhhh2211.',
      '..1122hhhhhh211.',
      '................',
      '................',
      '................',
    ],
    back: [
      '..11222222222211',
      '..1122222222211.',
      '................',
      '................',
      '................',
    ],
  },
  tail: {
    // long black tail with a white tip, wagging behind the poncho
    back: {
      x: 9, y: 11, over: true,
      frames: [
        ['kk....', 'kKK...', '.hKK..', '..hhK.', '...h..'],
        ['...k..', '..kKK.', '..hKK.', '..hhK.', '...h..'],
        ['....kk', '...kKK', '..hKK.', '.hhK..', '..h...'],
      ],
    },
    side: {
      x: 0, y: 10,
      frames: [
        ['k...', 'Kk..', 'hKk.', '.hKk', '..hK'],
        ['....', 'kk..', 'KKk.', '.hKk', '..hK'],
        ['....', '....', 'kk..', 'hKKk', '.hhK'],
      ],
    },
  },
  paws: true,
  feet: ['#fbf8f2', '#dcd6cf', '#1e1c26'],
  feetRows: 3,
  feetX: [5, 9],
  sideFeetX: [5, 8],
  eyes: [[4, 5], [5, 5], [4, 6], [5, 6], [10, 5], [11, 5], [10, 6], [11, 6]],
  hurtFill: '#363444',
  portrait(p) {
    // the shepherd's crook standing at her right, hook at the top
    p.rect(19, 5, 1, 14, '#7a5230');
    p.rect(20, 5, 1, 14, '#a87a4a');
    p.rect(18, 3, 1, 3, '#a87a4a');
    p.rect(18, 2, 4, 1, '#a87a4a');
    p.px(22, 3, '#7a5230');
    p.px(22, 4, '#7a5230');
    p.px(20, 4, '#9af0e0');
    p.rect(19, 11, 2, 2, '#d83c2c');
  },
};

defineCharacter2D(MORI);

defineCharacter({
  id: 'mori',
  name: '모리',
  title: '혼령 양치기',
  desc: '안개 낀 언덕에서 양을 치던 보더콜리. 양들은 죽어서도 모리 곁을 떠나지 않았고, 휘파람 한 번이면 적을 한곳으로 몰아넣는다.',
  spritePrefix: 'mori',
  portrait: 'mori_portrait',
  color: '#7ae0d0',
  hearts: 3,
  weapon: 'shepherd_crook',
  bombs: 1,
  baseStats: {
    moveSpeed: 96,
    damage: 9,
    range: 190,
    dashCooldown: 0.5,
    dashSpeed: 360,
    dashTime: 0.1,
  },
  unlocked: false,
  unlockHint: '적을 모두 300마리 처치하면, 언덕 너머에서 휘파람이 들린다.',
  lightColor: '#bff5ea',
  release: releaseStampede,
  releaseName: '양몰이 돌격',
  releaseDesc: '휘파람으로 조준한 곳에 울타리를 세워 적을 끌어모은 뒤, 혼령 양 떼가 그 위를 짓밟고 울타리가 닫힌다.',
  passive: MORI_PASSIVE,
  dash: MORI_DASH,
  affinity: MORI_AFFINITY,
  playstyle: ['소환', '몰이', '위치 선정'],
  difficulty: 2,
  pitch: '양들이 적을 몰고, 뭉친 적은 더 아프게 맞는다. 판을 짜는 이에게.',
});
