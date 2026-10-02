// 보리, 구조견 등불지기 — a Saint Bernard rescue dog in a red rescue harness with
// the little barrel on her collar; big, slow and sturdy (5 hearts). Weapon
// 구조등 도리깨 (lantern flail). Release: 구조의 울음. Unlocked after 3 defeats.

// roster order on character select: 리아, 베른, 세린, 니엘, 보리, 백구, 모리 (registration order)
import './niel';
import { defineCharacter } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { BORI_AFFINITY, BORI_DASH, BORI_PASSIVE, releaseRescueHowl } from './kit-bori';

export const BORI: CharSpec = {
  prefix: 'bori',
  palette: {
    // Saint Bernard: white blaze & muzzle, red-brown patches, dark mask around the eyes
    h: '#fdf8ee', H: '#e6dccc', x: '#c9b9a6',
    b: '#b8643a', B: '#8a4426', c: '#df9660', d: '#5a2a16', m: '#3a2420',
    e: '#1c1420', w: '#ffffff', n: '#1a1214', p: '#f08a8a',
    // rescue harness (red, white cross), collar
    r: '#d83c2c', R: '#a02418', s: '#f4f0e8', a: '#6a3a1e',
    // the barrel: wood, dark wood, gold bands, lit side
    o: '#9a6a3a', O: '#6a4424', t: '#f0c050', y: '#c89858',
  },
  front: [
    '................',
    '...bbcccbbbBB...',
    '..bcccbhhbbbBB..',
    '.cBccbbhhbbbBBb.',
    'bBBcbbhhhhbbBBdb',
    'bBBmwehhhhewmBBb',
    'bBBmeehhhheemBBb',
    '.BBxhhhnnhhhxBB.',
    '.BB.hhhHHhhH.BB.',
    '..B.xhhpphhx.B..',
    '...ahhhhhhhha...',
    '..rahhOoyoOhhar.',
    '.rrrhhOtttOhhrrr',
    '.rrshhOoyoOhhsrr',
    '.rrRrhhHHhhRrrR.',
    '.rbbbbhhhhbbbbr.',
    '..bbbbhhhhbbbb..',
    '................',
    '................',
    '................',
  ],
  back: [
    '................',
    '...bbbbbbbbbb...',
    '..bccbbbbbbbBB..',
    '.bBbbbbbbbbbbBb.',
    'bBBbbbbbbbbbbBBb',
    'bBBbbbbbbbbbbBBb',
    'bBBBbbbbbbbbBBBb',
    '.BBBBbbbbbbBBBB.',
    '.BB.BBbbbbBB.BB.',
    '..B..BBBBBB..B..',
    '...abbbbbbbba...',
    '..rabbbssbbbar..',
    '.rrrbssHHssbrrR.',
    '.rrrbssssssbrrr.',
    '.rrrrbbssbbrrrr.',
    '.rbbbbbbbbbbbbr.',
    '..bbbbbbbbbbbb..',
    '................',
    '................',
    '................',
  ],
  side: [
    '................',
    '.....bbbbbbbb...',
    '....bcccbbbbBB..',
    '...bbBbbbbbbhhh.',
    '...bBBbbbbhhhhh.',
    '...bBBbbmhhwehhh',
    '...bBBbbmeehhhhn',
    '....BBbxhhhhhhh.',
    '....BB.hHhhhhhp.',
    '.......xhhhhph..',
    '....abbbbhhhha..',
    '...rrabbbhhOoy..',
    '..rrrrbbbhhOtt..',
    '..rrrsbbbhhOoy..',
    '...rrrbbbhhhh...',
    '...bbbbbbbhhh...',
    '...bbbbbbhhhh...',
    '................',
    '................',
    '................',
  ],
  tail: {
    // bushy red-brown tail with a white tip, swinging low behind the harness
    back: {
      x: 9, y: 12, over: true,
      frames: [
        ['bb....', 'bBB...', '.hBB..', '..hhB.', '...h..'],
        ['...b..', '..bBB.', '..hBB.', '..hhB.', '...h..'],
        ['....bb', '...bBB', '..hBB.', '.hhB..', '..h...'],
      ],
    },
    side: {
      x: 0, y: 11,
      frames: [
        ['b...', 'Bb..', 'hBb.', '.hBb', '..hB'],
        ['....', 'bb..', 'BBb.', '.hBb', '..hB'],
        ['....', '....', 'bb..', 'hBBb', '.hhB'],
      ],
    },
  },
  ears: { keys: 'B', flop: true },
  paws: true,
  feet: ['#fdf8ee', '#e6dccc', '#b8643a'],
  feetRows: 3,
  feetX: [4, 10],
  sideFeetX: [5, 9],
  eyes: [[4, 5], [5, 5], [4, 6], [5, 6], [10, 5], [11, 5], [10, 6], [11, 6]],
  hurtFill: '#fdf8ee',
  portrait(p) {
    // the lantern flail's lantern resting beside her right shoulder
    p.rect(19, 4, 1, 3, '#8a8a98');
    p.rect(18, 7, 5, 1, '#6a4424');
    p.rect(17, 8, 7, 5, '#ffd060');
    p.rect(18, 9, 5, 3, '#fff2a8');
    p.rect(19, 10, 2, 1, '#ffffff');
    p.rect(17, 8, 1, 5, '#6a4424');
    p.rect(23, 8, 1, 5, '#6a4424');
    p.rect(20, 8, 1, 5, '#c89848');
    p.rect(18, 13, 5, 1, '#6a4424');
  },
};

defineCharacter2D(BORI);

defineCharacter({
  id: 'bori',
  name: '보리',
  title: '구조견 등불지기',
  desc: '눈 덮인 고개에서 길 잃은 이들을 찾아내던 세인트버나드. 느리지만 좀처럼 쓰러지지 않고, 목에 건 작은 구조통에는 언제나 누군가를 위한 한 모금이 남아 있다.',
  spritePrefix: 'bori',
  portrait: 'bori_portrait',
  color: '#e8a060',
  hearts: 5,
  weapon: 'lantern_flail',
  bombs: 1,
  keys: 1,
  baseStats: {
    moveSpeed: 80,
    damage: 12,
    range: 165,
    knockback: 100,
    dashCooldown: 0.9,
    dashSpeed: 250,
    dashTime: 0.14,
    invuln: 1.1,
  },
  unlocked: false,
  unlockHint: '세 번 쓰러지면, 구조견이 당신의 냄새를 찾아온다.',
  lightColor: '#ffd9b0',
  lightRadius: 105,
  release: releaseRescueHowl,
  releaseName: '구조의 울음',
  releaseDesc: '울음 한 번에 주변의 적을 기절시켜 밀쳐내고 탄환을 지운 뒤, 통 위의 등불이 2초 남짓 온기를 뿜어 적을 태우고 보리를 치유한다.',
  passive: BORI_PASSIVE,
  dash: BORI_DASH,
  affinity: BORI_AFFINITY,
  playstyle: ['탱커', '회복', '협동'],
  difficulty: 1,
  pitch: '맞아도 버티고, 남는 하트는 통에 담는다. 든든하게 가고 싶은 이에게.',
  // co-op: a rescue dog revives twice as fast and brings the ally back with 2 hearts
  coop: { reviveSpeed: 2, reviveHearts: 2 },
});
