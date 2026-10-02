// 니엘, 공허를 삼킨 아이 — a black pomeranian puppy; unlockable. Floats instead
// of walking; channels a void beam (공허의 눈) and releases 심연 개방, a
// collapsing black hole.

// roster order on character select: 리아, 베른, 세린, 니엘 (registration order)
import './serin';
import { defineCharacter } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { releaseAbyss } from './releases';

export const NIEL: CharSpec = {
  prefix: 'niel',
  palette: {
    // void robe (deep indigo, darker than the fur so the head pops)
    '1': '#170e2e', '2': '#2c1e5a', '3': '#46348c', '4': '#7664c8',
    // black pomeranian fur with a violet sheen, fluffy rim light top-left
    K: '#1c1828', k: '#363048', q: '#5a4e84', Q: '#a08ae8', i: '#b070d0',
    m: '#8a7cb2', M: '#625686', n: '#07040c', p: '#f07aa8',
    // glowing eyes & void core
    e: '#1a0e2a', v: '#b070ff', V: '#ffffff',
    g: '#9a50ff', G: '#ead0ff',
  },
  front: [
    '....Q......k....',
    '...QiQ....kik...',
    '..QqqQqqqqkkkK..',
    '.QqqQqqqqkkkkkK.',
    'QqqQqkkkkkkkkkkK',
    'QqqkVvkkkkVvkkkK',
    '.qqkvvkmmkvvkkK.',
    '.QqkkmmnnmmkkkK.',
    '..QqkkmppmkkkK..',
    '.QqQqQkkkkKkKkK.',
    '..1QqQqqkqkK21..',
    '.14233gGg322211.',
    '.1423gGVGg32211.',
    '.14233gGg322211.',
    '.14222332222211.',
    '.13222222222211.',
    '..132212212221..',
    '...12.121.121...',
    '....1...1...1...',
    '................',
  ],
  back: [
    '....Q......k....',
    '...QqQ....kkk...',
    '..QqqQqqqqkkkK..',
    '.QqqQqqqqkkkkkK.',
    'QqqQqqkkkkkkkkkK',
    'QqqqkkkkkkkkkkkK',
    '.qqqkkkkkkkkkkK.',
    '.QqqkkkkkkkkkkK.',
    '..QqkkkkkkkkkK..',
    '.QqQqQkkkkKkKkK.',
    '..1QqQqqkqkK21..',
    '.14233222222211.',
    '.14232222222211.',
    '.14233222222211.',
    '.142322gGg22211.',
    '.1322222g222211.',
    '..132212212221..',
    '...12.121.121...',
    '....1...1...1...',
    '................',
  ],
  side: [
    '.....Q..........',
    '....QiK.........',
    '...QqikKk.......',
    '..QqqQqkkkK.....',
    '.QqqQqqkkkkkK...',
    'QqqqqkkkkVvkkK..',
    'QqqqkkkkkvvkkmmK',
    '.qqkkkkkkkkkmmmn',
    '.QqkkkkkkkkKpMM.',
    '.QqQqQkkkkK.....',
    '..1QqQqk2.......',
    '.1423gGg32......',
    '.143gGVGg32.....',
    '.1423gGg322.....',
    '.14223322221....',
    '.1322222222.....',
    '..13212221......',
    '...1.121.1......',
    '....1...1.......',
    '................',
  ],
  hemAlt: {
    front: [
      '..132122122121..',
      '..1.121.121.1...',
      '...1...1...1....',
      '................',
    ],
    back: [
      '..132122122121..',
      '..1.121.121.1...',
      '...1...1...1....',
      '................',
    ],
    side: [
      '..13122121......',
      '..1.12.12.......',
      '...1...1........',
      '................',
    ],
  },
  tail: {
    // big fluffy plume curled over the back, violet-tipped
    back: {
      x: 4, y: 10, over: true,
      frames: [
        ['.KQQK...', 'KQQqqK..', 'KqQqqK..', '.KqqkK..', '..KkK...', '...K....'],
        ['..KQQK..', '.KQQqqK.', '.KqQqqK.', '..KqqK..', '...KK...'],
        ['...KQQK.', '..KQQqqK', '..KqQqqK', '..KkqqK.', '...KkK..', '....K...'],
      ],
    },
    side: {
      x: 0, y: 9, over: true,
      frames: [
        ['QQ..', 'Qqq.', '.qkK', '..kK'],
        ['....', 'QQq.', 'qqkK', '.kK.'],
        ['....', '....', 'QQqk', 'qqkK'],
      ],
    },
  },
  float: true,
  feetRows: 0,
  eyes: [[4, 5], [5, 5], [4, 6], [5, 6], [10, 5], [11, 5], [10, 6], [11, 6]],
  hurtFill: '#221a34',
  portrait(p) {
    // the void eye orb floating beside the child
    p.circle(19, 9, 2.6, '#2a1844');
    p.circle(19, 9, 1.6, '#b070ff');
    p.px(19, 9, '#ffffff');
    p.px(18, 8, '#ead0ff');
  },
};

defineCharacter2D(NIEL);

defineCharacter({
  id: 'niel',
  name: '니엘',
  title: '공허를 삼킨 아이',
  desc: '심연의 틈에서 떠오른 까만 강아지. 발이 땅에 닿지 않아 함정 위를 떠다니며, 공허의 눈으로 모든 것을 꿰뚫는 광선을 쏟아낸다.',
  spritePrefix: 'niel',
  portrait: 'niel_portrait',
  color: '#c890ff',
  hearts: 2,
  soulHearts: 2,
  weapon: 'void_gaze',
  artifacts: ['void_body'],
  bombs: 0,
  baseStats: {
    moveSpeed: 90,
    range: 150,
    dashCooldown: 0.75,
  },
  unlocked: false,
  unlockHint: '3층의 보스를 쓰러뜨리면 심연 속에서 누군가 깨어난다.',
  lightColor: '#c8a0ff',
  release: releaseAbyss,
  releaseDesc: '조준한 곳에 심연을 열어 적과 탄환을 빨아들인 뒤, 붕괴시켜 폭발시킨다.',
});
