// "등불의 축복" (floor blessings): a pool of small permanent run buffs. At the
// start of every floor the keeper picks one of three (see game/blessings.ts and
// ui/blessing.ts). Blessings are hidden artifacts (`blessing: true`): they use
// the item hooks, show in the HUD artifact row / Tab screen with a gold frame,
// and leave a small visible trace like every artifact.

import { defineArtifact, type ArtifactDef, type ItemHooks } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp, type PixelPainter } from '../../engine/painter';
import { Chest, Pickup } from '../../game/pickups';
import { RingFx } from '../../game/effects';
import type { ArtifactLook } from '../../game/look';
import { grantPerCopy, hitWeight, isAttack, proc } from '../items/lib';

const O = '#140c1c';
const GOLD = '#ffd060';

/** Seal-shaped blessing icon: a tinted disk with a golden rim and a glyph. */
function sealIcon(name: string, disk: string, glyph: (p: PixelPainter) => void): string {
  return defineDrawnSprite(name, 16, 16, (p) => {
    p.circle(8, 8, 7.5, disk);
    p.shadeSphere(8, 8, 7.5, 7.5, ramp(disk, 4, 0.8), { dither: false });
    p.ring(8, 8, 7.5, 1, '#e0a848');
    p.px(3, 4, '#ffe09a');
    p.px(4, 3, '#ffe09a');
    glyph(p);
  }, { outline: O });
}

interface BlessingSpec extends ItemHooks {
  id: string;
  name: string;
  desc: string;
  quote: string;
  disk: string;
  glyph: (p: PixelPainter) => void;
  look: ArtifactLook;
}

function bless(b: BlessingSpec): ArtifactDef {
  const { disk, glyph, ...rest } = b;
  const icon = sealIcon(`icon_${b.id}`, disk, glyph);
  return defineArtifact({ ...rest, icon, rarity: 'rare', tags: [], pools: [], hidden: true, blessing: true });
}

const heart = (c: string) => (p: PixelPainter) => {
  p.circle(6, 7, 2.2, c);
  p.circle(10, 7, 2.2, c);
  p.poly([3.6, 7.6, 12.4, 7.6, 8, 12.4], c);
  p.px(6, 6, '#ffffff');
};

// ------------------------------------------------------------------ pool
bless({
  id: 'bless_vigor', name: '생명의 축복', desc: '최대 체력 +1, 체력 1칸 회복', quote: '등불이 심장을 데운다.',
  disk: '#7a2030', glyph: heart('#ff5a6a'), look: { aura: '#ff8a9a' },
  stats(m, power) {
    m.addStat('maxHearts', power);
  },
  onAcquire(w, power) {
    grantPerCopy(w, 'bless_vigor', power, () => w.player.heal(2));
  },
});

bless({
  id: 'bless_gale', name: '바람의 축복', desc: '대시 쿨다운 -25%, 대시 속도 +20%', quote: '발끝에 바람이 깃든다.',
  disk: '#2a5a7a', glyph: (p) => { p.poly([3, 12, 8, 4, 13, 3, 10, 8, 6, 12], '#e8f8ff'); p.line(4, 12, 11, 5, '#8ac8e8'); }, look: { step: '#e8f8ff' },
  stats(m, power) {
    m.mulStat('dashCooldown', Math.pow(0.75, power));
    m.mulStat('dashSpeed', 1 + 0.2 * power);
  },
});

bless({
  id: 'bless_kindle', name: '불씨의 축복', desc: '등불 게이지가 50% 더 빨리 찬다', quote: '작은 불씨도 모이면 횃불이 된다.',
  disk: '#7a3010', glyph: (p) => { p.poly([8, 2, 11.5, 8, 10, 12.5, 6, 12.5, 4.5, 8], '#ff9a30'); p.poly([8, 6, 9.6, 9.5, 8, 12, 6.4, 9.5], '#ffe080'); }, look: { mote: '#ffb040' },
  onHit(w, _t, hit, power) {
    if (isAttack(hit)) w.player.addEmber(1.25 * power * hitWeight(hit));
  },
});

bless({
  id: 'bless_pierce', name: '꿰뚫는 빛', desc: '탄환 관통 +1, 사거리 +10%', quote: '빛은 멈추지 않는다.',
  disk: '#5a4a1a', glyph: (p) => { p.line(3, 8, 12, 8, '#fff6d0'); p.poly([10, 5, 14, 8, 10, 11], '#fff6d0'); p.line(3, 7, 6, 7, '#e0c070'); }, look: { orbit: '#fff6d0' },
  stats(m, power) {
    m.addStat('pierce', power);
    m.mulStat('range', 1 + 0.1 * power);
  },
});

bless({
  id: 'bless_gold', name: '황금의 축복', desc: '동전 +10. 방을 클리어하면 동전 1개', quote: '등불 아래 반짝이는 것.',
  disk: '#6a4a10', glyph: (p) => { p.circle(8, 8, 4, '#ffd040'); p.ring(8, 8, 4, 1, '#b08020'); p.line(8, 6, 8, 10, '#fff6c0'); }, look: { mote: '#ffd040' },
  onAcquire(w, power) {
    grantPerCopy(w, 'bless_gold', power, () => { w.player.coins = Math.min(999, w.player.coins + 10); });
  },
  onRoomClear(w, power) {
    const pos = w.room.nearestFree(w.room.centerX - 18, w.room.centerY, 6);
    for (let i = 0; i < power; i++) w.spawn(new Pickup('coin', pos.x, pos.y).pop());
    proc(w, 'bless_gold');
  },
});

bless({
  id: 'bless_blastproof', name: '화약 내성', desc: '폭발 피해를 받지 않는다. 폭탄 +2', quote: '불꽃이 길을 비켜 간다.',
  disk: '#4a2a1a', glyph: (p) => { p.circle(7.5, 9, 3.8, '#1a1420'); p.ring(7.5, 9, 3.8, 1, '#ffb040'); p.px(6, 8, '#a8a0b8'); p.line(10, 6, 12, 3, '#c8a060'); p.px(12, 2, '#ffd040'); }, look: { aura: '#ff9a30' },
  stats(m) {
    m.flag('bombImmune');
  },
  onAcquire(w, power) {
    grantPerCopy(w, 'bless_blastproof', power, () => { w.player.bombs = Math.min(99, w.player.bombs + 2); });
  },
});

bless({
  id: 'bless_first_strike', name: '선제의 축복', desc: '전투마다 첫 적중이 3배 피해 치명타', quote: '먼저 닿는 빛이 이긴다.',
  disk: '#5a1a2a', glyph: (p) => { p.line(4, 12, 12, 4, '#f0f0ff'); p.line(5, 12, 12, 5, '#a0a8c0'); p.line(3, 10, 6, 13, '#c8a060'); }, look: { hit: '#ffffff' },
  onRoomEnter(w) {
    if (!w.node.cleared) w.vars.__firstStrike = 1;
  },
  modifyHit(w, _t, hit) {
    if (!w.vars.__firstStrike || !isAttack(hit)) return;
    w.vars.__firstStrike = 0;
    hit.crit = true;
    hit.damage *= 3;
    proc(w, 'bless_first_strike');
  },
});

bless({
  id: 'bless_hearth', name: '쉼터의 온기', desc: '방 3개를 클리어할 때마다 체력 반 칸 회복', quote: '잠시 쉬어 가도 괜찮다.',
  disk: '#6a3a1a', glyph: (p) => { p.line(4, 12, 12, 10, '#8a5a30'); p.line(4, 10, 12, 12, '#6a4020'); p.poly([8, 3, 10.5, 8, 8, 10, 5.5, 8], '#ffb040'); p.px(8, 7, '#fff0a0'); }, look: { aura: '#ffc080' },
  onRoomClear(w, power) {
    w.vars.__hearthN = (w.vars.__hearthN ?? 0) + 1;
    if (w.vars.__hearthN % 3 !== 0) return;
    const p = w.player;
    if (p.maxRed > 0 && p.red < p.maxRed) p.heal(power);
    else p.addSoul(1);
    w.sfx('heal', { vol: 0.6 });
    w.particles.burst(p.x, p.y - 8, { count: 14, speed: [20, 60], life: [0.4, 0.8], colors: ['#ffffff', '#ffc080', '#ff8a5a'], size: [1, 2], additive: true });
    proc(w, 'bless_hearth');
  },
});

bless({
  id: 'bless_magnet', name: '끌림의 축복', desc: '줍기 범위가 크게 늘어난다', quote: '필요한 것은 스스로 다가온다.',
  disk: '#3a3a6a', glyph: (p) => { p.ring(8, 7, 4.5, 2, '#e04050'); p.rect(3, 7, 3, 5, '#e04050'); p.rect(10, 7, 3, 5, '#e04050'); p.rect(3, 10, 3, 2, '#e0e0f0'); p.rect(10, 10, 3, 2, '#e0e0f0'); p.rect(6, 7, 4, 6, null); }, look: { aura: '#c8d0ff' },
  stats(m, power) {
    m.addStat('magnet', 55 * power);
  },
});

const chestSeen = new WeakMap<object, boolean>();
bless({
  id: 'bless_locksmith', name: '상자 감별사', desc: '상자를 열면 열쇠나 폭탄이 하나 더 나온다', quote: '빈 상자는 없다.',
  disk: '#4a3a20', glyph: (p) => { p.circle(5.5, 8, 2.5, '#e8c870'); p.circle(5.5, 8, 1, null); p.line(8, 8, 13, 8, '#e8c870'); p.line(11, 9, 11, 10, '#e8c870'); p.line(13, 9, 13, 10, '#e8c870'); }, look: { mote: '#e8c870' },
  onUpdate(w) {
    for (const e of w.entities) {
      if (!(e instanceof Chest)) continue;
      const was = chestSeen.get(e);
      if (was === undefined) {
        chestSeen.set(e, e.opened);
        continue;
      }
      if (was || !e.opened) continue;
      chestSeen.set(e, true);
      w.spawn(new Pickup(w.rng.chance(0.55) ? 'key' : 'bomb', e.x, e.y).pop());
      proc(w, 'bless_locksmith');
    }
  },
});

bless({
  id: 'bless_might', name: '힘의 축복', desc: '공격력 +15%', quote: '등불이 팔에 힘을 싣는다.',
  disk: '#6a1a1a', glyph: (p) => { p.poly([8, 2, 12.5, 7, 9.5, 7, 9.5, 13, 6.5, 13, 6.5, 7, 3.5, 7], '#ff7a60'); p.line(8, 3, 8, 12, '#ffc0a0'); }, look: { grow: 0.5, hit: '#ff8a70' },
  stats(m, power) {
    m.mulStat('damage', Math.pow(1.15, power));
  },
});

bless({
  id: 'bless_haste', name: '신속의 축복', desc: '공격 속도 +15%', quote: '숨 쉴 틈도 없이.',
  disk: '#1a4a5a', glyph: (p) => { p.poly([3, 4, 7, 8, 3, 12, 5, 8], '#c8f0ff'); p.poly([8, 4, 12, 8, 8, 12, 10, 8], '#c8f0ff'); }, look: { trail: 'wind' },
  stats(m, power) {
    m.mulStat('fireRate', Math.pow(1.15, power));
  },
});

bless({
  id: 'bless_soul', name: '영혼의 가호', desc: '영혼 하트 +2', quote: '보이지 않는 손이 등을 받친다.',
  disk: '#1a2a6a', glyph: heart('#8ab0ff'), look: { mote: '#8ab0ff' },
  onAcquire(w, power) {
    grantPerCopy(w, 'bless_soul', power, () => w.player.addSoul(4));
  },
});

bless({
  id: 'bless_fortune', name: '행운의 별', desc: '행운 +2', quote: '오늘은 별이 웃는다.',
  disk: '#3a2a6a', glyph: (p) => { p.poly([8, 2, 9.6, 6.4, 14, 6.6, 10.5, 9.4, 11.8, 14, 8, 11.2, 4.2, 14, 5.5, 9.4, 2, 6.6, 6.4, 6.4], '#ffe890'); p.px(8, 7, '#ffffff'); }, look: { mote: '#fff2a0' },
  stats(m, power) {
    m.addStat('luck', 2 * power);
  },
});

bless({
  id: 'bless_keen', name: '날카로운 눈', desc: '치명타 확률 +8%, 치명타 피해 +20%', quote: '틈은 언제나 있다.',
  disk: '#2a4a3a', glyph: (p) => { p.ellipse(8, 8, 5.5, 3, '#f0f0e0'); p.circle(8, 8, 2, '#40a070'); p.px(8, 8, '#0c0810'); p.px(7, 7, '#ffffff'); }, look: { hit: '#fff6d0', orbit: '#fff6d0' },
  stats(m, power) {
    m.addStat('critChance', 0.08 * power);
    m.addStat('critMult', 0.2 * power);
  },
});

bless({
  id: 'bless_aegis', name: '수호의 축복', desc: '보스 방에 들어서면 보호막 1개', quote: '마지막 문 앞에서 빛이 감싼다.',
  disk: '#2a3a6a', glyph: (p) => { p.poly([4, 4, 12, 4, 12, 8, 8, 13, 4, 8], '#b8d0ff'); p.poly([8, 4, 12, 4, 12, 8, 8, 13], '#8aa8e8'); p.px(6, 6, '#ffffff'); }, look: { aura: '#b8d0ff' },
  onRoomEnter(w, power) {
    if (w.node.kind !== 'boss' || w.node.cleared) return;
    const p = w.player;
    if (p.shields >= power) return;
    p.shields = power;
    w.spawn(new RingFx(p.x, p.y - 6, 30, 0.4, '#d8e8ff', 2));
    proc(w, 'bless_aegis');
  },
});

bless({
  id: 'bless_powder', name: '화약 주머니', desc: '폭탄 +3. 폭탄을 놓으면 주변 적 탄환이 사라진다', quote: '쾅, 하고 조용해진다.',
  disk: '#5a3a1a', glyph: (p) => { p.ellipse(8, 9.5, 4.5, 3.8, '#f0c890'); p.ellipse(8, 10, 3.5, 2.8, '#d09858'); p.rect(6, 4, 4, 2, '#fff0c0'); p.px(8, 9, '#ff7a20'); p.px(12, 3, '#ffd040'); p.px(13, 2, '#ffffff'); }, look: { step: '#ffb040' },
  onAcquire(w, power) {
    grantPerCopy(w, 'bless_powder', power, () => { w.player.bombs = Math.min(99, w.player.bombs + 3); });
  },
  onBomb(w, x, y) {
    if (w.clearEnemyBullets(x, y, 70) > 0) proc(w, 'bless_powder');
  },
});

bless({
  id: 'bless_reach', name: '멀리 닿는 빛', desc: '사거리 +25%, 탄속 +15%', quote: '빛은 멀리서도 닿는다.',
  disk: '#3a4a5a', glyph: (p) => { p.line(2, 8, 13, 8, '#e8f0ff'); p.poly([11, 5, 15, 8, 11, 11], '#e8f0ff'); p.px(4, 7, '#a8c8e8'); p.px(6, 9, '#a8c8e8'); }, look: { trail: 'comet' },
  stats(m, power) {
    m.mulStat('range', 1 + 0.25 * power);
    m.mulStat('shotSpeed', 1 + 0.15 * power);
  },
});

bless({
  id: 'bless_release_heal', name: '해방의 온기', desc: '등불 해방 시 체력 반 칸 회복', quote: '불꽃을 놓아줄 때 따뜻해진다.',
  disk: '#6a4a2a', glyph: (p) => { p.rect(6, 5, 4, 7, '#ffd890'); p.rect(5, 4, 6, 1, '#a07040'); p.rect(5, 12, 6, 1, '#a07040'); p.px(8, 8, '#ff8a30'); p.px(8, 7, '#fff0a0'); }, look: { aura: '#ffe0a0' },
  onRelease(w, power) {
    const p = w.player;
    if (p.maxRed > 0 && p.red < p.maxRed) p.heal(power);
    else p.addSoul(1);
    proc(w, 'bless_release_heal');
  },
});

bless({
  id: 'bless_hunter', name: '사냥꾼의 불씨', desc: '처치할 때마다 등불 게이지 +5', quote: '사냥이 등불을 먹인다.',
  disk: '#4a2a10', glyph: (p) => { p.line(4, 4, 7, 12, '#ffb070'); p.line(7, 4, 10, 12, '#ffb070'); p.line(10, 4, 13, 12, '#ffb070'); }, look: { hit: '#ff9a30' },
  onKill(w, _e, power) {
    w.player.addEmber(5 * power);
  },
});

bless({
  id: 'bless_swift', name: '가벼운 발', desc: '이동 속도 +15%', quote: '땅이 발을 밀어 준다.',
  disk: '#1a5a3a', glyph: (p) => { p.rect(5, 4, 4, 6, '#c8ffd8'); p.rect(5, 9, 8, 3, '#c8ffd8'); p.line(2, 6, 4, 6, '#8ae0a8'); p.line(1, 9, 4, 9, '#8ae0a8'); }, look: { step: '#c8ffd8' },
  stats(m, power) {
    m.mulStat('moveSpeed', 1 + 0.15 * power);
  },
});

bless({
  id: 'bless_shade', name: '그림자 망토', desc: '12% 확률로 피해를 회피한다', quote: '어둠이 대신 맞아 준다.',
  disk: '#2a1a3a', glyph: (p) => { p.poly([8, 3, 12, 6, 13, 13, 8, 11, 3, 13, 4, 6], '#7a5aa8'); p.poly([8, 3, 12, 6, 13, 13, 8, 11], '#5a3a88'); p.px(7, 6, '#c0a0ff'); }, look: { step: '#8a7a9a' },
  stats(m, power) {
    m.addStat('dodge', 0.12 * power);
  },
});
