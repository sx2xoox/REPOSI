// 베른, 검을 든 파수꾼 — a husky knight with a red headband; melee fighter.
// Sturdy (4 hearts) but slower; weapon 파수꾼의 장검 (3-hit combo that deflects
// bullets). Release: 등불 회전베기.

// roster order on character select: 리아, 베른, 세린, 니엘 (registration order)
import './ria';
import { defineCharacter } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { releaseWhirlwind } from './releases';
import { BERN_AFFINITY, BERN_DASH, BERN_PASSIVE } from './kit-bern';

export const BERN: CharSpec = {
  prefix: 'bern',
  palette: {
    // husky fur: grey cap & back, white mask (hue-shifted toward blue)
    d: '#a4aec8', D: '#6c7896', x: '#3e4660',
    h: '#f6f8ff', H: '#c8d0e4', i: '#e89aa8',
    u: '#7ad8ff', e: '#18203c', w: '#ffffff', n: '#141420',
    // red headband & cape
    a: '#5c1022', b: '#a8283a', c: '#e85062',
    // blue armor, steel pauldrons, gold & leather
    '1': '#161c3c', '2': '#28366c', '3': '#3e58a0', '4': '#7896dc',
    m: '#3a4058', N: '#8690b0', o: '#e0e8fa',
    t: '#f0c050', l: '#5a3a24', '5': '#22263a',
  },
  front: [
    '..d..........x..',
    '.dhD........DiD.',
    '.dhiDddddDDDiHx.',
    '.acbbbbbbbbbbba.',
    '..dhhDDDDDDhhx..',
    '.DhueDhDDhDueHx.',
    '.DheehhDDhheeHx.',
    '.xDhhhhnnhhhHDx.',
    '..xDhhhHHhhhDx..',
    '...xDHhhhhHDx...',
    '.oNNm233332mNNm.',
    '.aNm2334t321mNa.',
    '.aoN233t3221Nma.',
    '.ahllllttllllHa.',
    '.a.2334332221.a.',
    'aa.2333222211.aa',
    'a..5222222215..a',
    '................',
    '................',
    '................',
  ],
  back: [
    '..d..........x..',
    '.ddD........DDx.',
    '.dddDddddDDDDDx.',
    '.acbbbbbbbbbbba.',
    '..ddddDDDDDDDxcb',
    '.DddddDDDDDDDxba',
    '.DddDDDDDDDDDx..',
    '.xDDDDDDDDDDxx..',
    '..xDDDDDDDDxx...',
    '...xxHHHHxxx....',
    '.oNNmbbbbbbmNNm.',
    '.aNmcbbbbbbbmNa.',
    '.aoNcbbbbbbbbma.',
    '.ahcbbbbbbbbbHa.',
    '..acbbbbbbbbba..',
    '..acbbbbbbbbaa..',
    '..aabbbbbbbaaa..',
    '................',
    '................',
    '................',
  ],
  side: [
    '...x.d..........',
    '...xdhD.........',
    '..xDdhiDDD......',
    '..acbbbbbbbc....',
    '.ab.ddDDDhhh....',
    '.b.ddDDhhuehhh..',
    '...dDDhhheehhhhn',
    '...DDhhhhhhhhhH.',
    '...xDDhhhHHHH...',
    '....xxDHHH......',
    '.abNooomN32.....',
    '.ab2NNNm332.....',
    '.ab23mNm3321....',
    '.abllllltllh....',
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
  tail: {
    // bushy husky tail with a white tip, curled up over the cape
    back: {
      x: 5, y: 11, over: true,
      frames: [
        ['.hh...', 'hhhD..', 'dhDx..', '.dDD..', '..dD..'],
        ['..hh..', '.hhhD.', '.dhhD.', '..dDx.', '..dD..'],
        ['...hh.', '..hhhD', '..dhDx', '..dDD.', '..dD..'],
      ],
    },
    side: {
      x: 0, y: 12, over: true,
      frames: [
        ['hh..', 'dhD.', '.dDx', '..dD'],
        ['....', 'hhd.', 'hdDx', '..dD'],
        ['....', '....', 'hhdD', '.ddD'],
      ],
    },
  },
  paws: true,
  feet: ['#c8d0e4', '#a4aec8', '#6c7896'],
  feetRows: 3,
  feetX: [5, 9],
  sideFeetX: [5, 8],
  eyes: [[3, 5], [4, 5], [3, 6], [4, 6], [11, 5], [12, 5], [11, 6], [12, 6]],
  hurtFill: '#f6f8ff',
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
  desc: '무너진 성문을 끝까지 지켰던 허스키 파수꾼. 썰매를 끌던 다리는 느리게 출발하지만, 한 번 기세가 붙으면 아무도 따라잡지 못한다.',
  spritePrefix: 'bern',
  portrait: 'bern_portrait',
  color: '#8fb0ff',
  hearts: 4,
  weapon: 'sentinel_blade',
  bombs: 1,
  keys: 1,
  baseStats: {
    moveSpeed: 86,
    damage: 11,
    range: 160,
    knockback: 90,
    dashCooldown: 0.8,
    dashSpeed: 370,
    dashTime: 0.17,
  },
  unlocked: true,
  lightColor: '#b8d0ff',
  release: releaseWhirlwind,
  releaseName: '등불 회전베기',
  releaseDesc: '등불을 두른 검으로 회전베기를 휘몰아친 뒤, 사방으로 검기를 날린다.',
  passive: BERN_PASSIVE,
  dash: BERN_DASH,
  affinity: BERN_AFFINITY,
  playstyle: ['근접', '기세', '돌진'],
  difficulty: 2,
  pitch: '때릴수록 빨라진다. 멈추지 않고 몰아붙이는 이에게.',
});
