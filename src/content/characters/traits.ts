// Signature starting artifacts of the playable characters (hidden: never drop,
// one copy, no resonance tags). They make each keeper play differently.

import { defineArtifact } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { glowSprite } from '../weapons/common';
import { proc } from '../items/lib';

const O = '#0c0810';

// ------------------------------------------------------------------ 리아
defineDrawnSprite('icon_keeper_wick', 16, 16, (p) => {
  p.rect(5, 8, 6, 6, '#e8e0c8');
  p.shadeVertical(5, 8, 6, 6, ramp('#e8e0c8', 3).reverse());
  p.rect(4, 13, 8, 2, '#a07838');
  p.line(8, 5, 8, 8, '#3a2a1a');
  p.ellipse(8, 4, 2.5, 3.5, '#ff9a30');
  p.ellipse(8, 4.5, 1.4, 2.2, '#ffe080');
  p.px(8, 4, '#ffffff');
  p.px(3, 3, '#ffd060');
  p.px(13, 5, '#ffd060');
}, { outline: O });

/** Extra ember gained on a hit (fraction of the base gain). Exported for tests. */
export const KEEPER_WICK_BONUS = 0.35;

defineArtifact({
  id: 'keeper_wick',
  name: '마지막 등불의 심지',
  desc: '등불 해방 게이지가 35% 더 빨리 찬다.',
  quote: '마을의 마지막 불씨.',
  rarity: 'rare',
  tags: [],
  icon: 'icon_keeper_wick',
  look: { aura: '#ffd8a0' },
  pools: [],
  hidden: true,
  unique: true,
  onHit(w, _t, hit) {
    if (hit.noProc || hit.kind === 'status') return;
    const p = w.player;
    p.addEmber(KEEPER_WICK_BONUS * Math.min(6, 1.2 + (hit.damage / Math.max(1, p.stats.damage)) * 1.3));
  },
});

// ------------------------------------------------------------------ 베른
defineDrawnSprite('icon_sentinel_oath', 16, 16, (p) => {
  p.poly([2, 2, 14, 2, 14, 8, 8, 15, 2, 8], '#3e58a0');
  p.shadeSphere(8, 7, 7, 7, ramp('#3e58a0', 4), { dither: false });
  p.poly([4, 4, 12, 4, 12, 8, 8, 12.5, 4, 8], '#28366c');
  p.rect(7, 5, 2, 6, '#f0c050');
  p.rect(5, 7, 6, 2, '#f0c050');
  p.px(7, 5, '#fff0a0');
  p.line(2, 2, 14, 2, '#7896dc');
}, { outline: O });

defineArtifact({
  id: 'sentinel_oath',
  name: '파수꾼의 맹세',
  desc: '적 탄환을 쳐낼 때마다 등불 해방 게이지가 찬다. 층마다 첫 피해를 막는 보호막을 얻는다.',
  quote: '성문은 아직 무너지지 않았다.',
  rarity: 'rare',
  tags: [],
  icon: 'icon_sentinel_oath',
  look: { aura: '#b8d0ff', hit: '#e0ecff' },
  pools: [],
  hidden: true,
  unique: true,
  onDeflect(w) {
    w.player.addEmber(3.5);
  },
  onFloorStart(w) {
    w.player.shields = Math.max(w.player.shields, 1);
    proc(w, 'sentinel_oath');
  },
  draw(w, r) {
    const p = w.player;
    if (p.shields <= 0) return;
    const a = 0.25 + 0.1 * Math.sin(w.time * 4);
    r.ring(p.x, p.y - 7, 11, '#b8d0ff', 1, a);
  },
});

// ------------------------------------------------------------------ 세린
defineDrawnSprite('icon_hunter_eye', 16, 16, (p) => {
  p.ellipse(8, 8, 7, 4.5, '#e8e0d0');
  p.circle(8, 8, 3.4, '#46943c');
  p.circle(8, 8, 1.6, '#14281c');
  p.px(7, 6, '#ffffff');
  p.line(1, 8, 3, 8, '#46943c');
  p.line(13, 8, 15, 8, '#46943c');
  p.line(8, 1, 8, 3, '#e03c2c');
  p.line(8, 13, 8, 15, '#e03c2c');
}, { outline: O });

/** Window (s) after a dash in which Serin's first hit is a guaranteed critical. */
export const HUNTER_EYE_WINDOW = 1.0;

defineArtifact({
  id: 'hunter_eye',
  name: '사냥꾼의 눈',
  desc: '대시한 뒤 1초 안의 첫 적중은 반드시 치명타가 된다.',
  quote: '숨을 고르고, 단 한 발.',
  rarity: 'rare',
  tags: [],
  icon: 'icon_hunter_eye',
  look: { orbit: '#ffe08a', hit: '#ffe08a' },
  pools: [],
  hidden: true,
  unique: true,
  onDash(w) {
    w.vars.__hunterEyeUntil = w.time + HUNTER_EYE_WINDOW;
  },
  modifyHit(w, _t, hit) {
    if ((w.vars.__hunterEyeUntil ?? -1) < w.time || hit.noProc || hit.crit) return;
    if (hit.kind !== 'projectile' && hit.kind !== 'melee' && hit.kind !== 'laser') return;
    w.vars.__hunterEyeUntil = -1;
    hit.crit = true;
    hit.damage *= w.player.stats.critMult;
    w.sfx('hit_crit', { vol: 0.5, pitch: 1.3 });
    proc(w, 'hunter_eye');
  },
  draw(w, r) {
    if ((w.vars.__hunterEyeUntil ?? -1) < w.time) return;
    const p = w.player;
    r.sprite(glowSprite(7, '#ffe08a'), p.x + 6, p.y - 17, { alpha: 0.6 + 0.4 * Math.sin(w.time * 20), additive: true });
  },
});

// ------------------------------------------------------------------ 니엘
defineDrawnSprite('icon_void_body', 16, 16, (p) => {
  p.circle(8, 8, 6.5, '#1c1432');
  p.ring(8, 8, 6.5, 1.2, '#7c6ac4');
  p.circle(8, 8, 3, '#9a50ff');
  p.circle(8, 8, 1.5, '#ead0ff');
  p.px(3, 13, '#7c6ac4');
  p.px(13, 3, '#7c6ac4');
  p.px(2, 4, '#b070ff');
}, { outline: O });

defineArtifact({
  id: 'void_body',
  name: '공허의 몸',
  desc: '몸이 떠 있다. 구덩이와 가시 함정 위를 지나간다.',
  quote: '발밑이 텅 비어 있다.',
  rarity: 'epic',
  tags: [],
  icon: 'icon_void_body',
  look: { step: '#8a5ad8', aura: '#4a2a7a' },
  pools: [],
  hidden: true,
  unique: true,
  stats(m) {
    m.flag('flying');
  },
});
