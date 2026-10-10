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
import { grantPerCopy, isAttack, isPrimary, proc } from '../items/lib';
import { addMatches } from '../../game/matches';
import { EMBER_MAX } from '../../game/player';

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


// ------------------------------------------------------------------ pool
bless({
  id: 'bless_vigor', name: '생명의 축복', desc: '최대 체력 +1, 체력 1칸 회복', quote: '등불이 심장을 데운다.',
  // a warm life flame (the blue flame of 푸른 불의 가호, leaning the other way)
  disk: '#7a2030', glyph: (p) => {
    p.poly([8, 2, 4.5, 7, 4, 10, 6, 13, 10, 13, 12, 10, 11.5, 7, 9.5, 8], '#ff7a34');
    p.poly([8, 6, 6, 9, 6.5, 12, 9.5, 12, 10, 9.5], '#ffcf5c');
    p.px(8, 11, '#fff4d4');
    p.px(9, 10, '#fff4d4');
    p.px(7, 4, '#ffb060');
  }, look: { aura: '#ff8a9a' },
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
  id: 'bless_kindle', name: '불씨의 축복', desc: '피해로 얻는 등불 게이지 +35%', quote: '작은 불씨도 모이면 횃불이 된다.',
  disk: '#7a3010', glyph: (p) => { p.poly([8, 2, 11.5, 8, 10, 12.5, 6, 12.5, 4.5, 8], '#ff9a30'); p.poly([8, 6, 9.6, 9.5, 8, 12, 6.4, 9.5], '#ffe080'); }, look: { mote: '#ffb040' },
  stats(m) {
    m.flag('kindleBlessing');
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
  id: 'bless_gold', name: '황금의 축복', desc: '동전 +8. 방 2개 클리어마다 동전 1개', quote: '등불 아래 반짝이는 것.',
  disk: '#6a4a10', glyph: (p) => { p.circle(8, 8, 4, '#ffd040'); p.ring(8, 8, 4, 1, '#b08020'); p.line(8, 6, 8, 10, '#fff6c0'); }, look: { mote: '#ffd040' },
  onAcquire(w, power) {
    grantPerCopy(w, 'bless_gold', power, () => { w.player.coins = Math.min(999, w.player.coins + 8); });
  },
  onRoomClear(w, power) {
    w.vars.__goldRooms = (w.vars.__goldRooms ?? 0) + 1;
    if (w.vars.__goldRooms % 2 !== 0) return;
    const pos = w.room.nearestFree(w.room.centerX - 18, w.room.centerY, 6);
    for (let i = 0; i < power; i++) w.spawn(new Pickup('coin', pos.x, pos.y).pop());
    proc(w, 'bless_gold');
  },
});

bless({
  id: 'bless_blastproof', name: '화약 내성', desc: '폭발 피해를 받지 않는다. 성냥 +2', quote: '불꽃이 길을 비켜 간다.',
  // a small shield standing in front of a blast star
  disk: '#4a2a1a', glyph: (p) => {
    p.poly([8, 1.5, 9.5, 5, 13.5, 4, 11, 7.5, 14, 10, 10, 10, 8, 14, 6, 10, 2, 10, 5, 7.5, 2.5, 4, 6.5, 5], '#ff9a30');
    p.poly([5, 5.5, 11, 5.5, 11, 9, 8, 12.5, 5, 9], '#c8d0e0');
    p.poly([8, 5.5, 11, 5.5, 11, 9, 8, 12.5], '#9aa4bc');
    p.line(8, 6, 8, 11, '#ffd060');
    p.px(6, 6, '#ffffff');
  }, look: { aura: '#ff9a30' },
  stats(m) {
    m.flag('blastImmune');
  },
  onAcquire(w, power) {
    grantPerCopy(w, 'bless_blastproof', power, () => { addMatches(w, 2); });
  },
});

bless({
  id: 'bless_first_strike', name: '선제의 축복', desc: '전투마다 첫 적중이 3배 피해 치명타', quote: '먼저 닿는 빛이 이긴다.',
  disk: '#5a1a2a', glyph: (p) => { p.line(4, 12, 12, 4, '#f0f0ff'); p.line(5, 12, 12, 5, '#a0a8c0'); p.line(3, 10, 6, 13, '#c8a060'); }, look: { hit: '#ffffff' },
  onRoomEnter(w) {
    if (!w.node.cleared) w.vars.__firstStrike = 1;
  },
  modifyHit(w, _t, hit) {
    if (!w.vars.__firstStrike || !isPrimary(hit)) return;
    w.vars.__firstStrike = 0;
    // one hit per room: a plain x3 crit (a natural crit is not multiplied again), not part of the bonus pool
    hit.damage *= hit.crit ? 3 / Math.max(1, w.player.stats.critMult) : 3;
    hit.crit = true;
    proc(w, 'bless_first_strike');
  },
});

bless({
  id: 'bless_hearth', name: '쉼터의 온기', desc: '방 3개마다 체력 반 칸 회복. 최대 체력이 없으면 푸른 불꽃 2칸까지 회복', quote: '잠시 쉬어 가도 괜찮다.',
  disk: '#6a3a1a', glyph: (p) => { p.line(4, 12, 12, 10, '#8a5a30'); p.line(4, 10, 12, 12, '#6a4020'); p.poly([8, 3, 10.5, 8, 8, 10, 5.5, 8], '#ffb040'); p.px(8, 7, '#fff0a0'); }, look: { aura: '#ffc080' },
  onRoomClear(w, power) {
    w.vars.__hearthN = (w.vars.__hearthN ?? 0) + 1;
    if (w.vars.__hearthN % 3 !== 0) return;
    const p = w.player;
    if (p.maxRed > 0 && p.red < p.maxRed) p.heal(power);
    else if (p.maxRed <= 0 && p.soul < 4) p.addSoul(Math.min(power, 4 - p.soul));
    else return;
    w.sfx('heal', { vol: 0.6 });
    w.particles.burst(p.x, p.y - 8, { count: 14, speed: [20, 60], life: [0.4, 0.8], colors: ['#ffffff', '#ffc080', '#ff8a5a'], size: [1, 2], additive: true });
    proc(w, 'bless_hearth');
  },
});

bless({
  id: 'bless_magnet', name: '끌림의 축복', desc: '줍기 범위 +55, 이동 속도 +5%', quote: '필요한 것은 스스로 다가온다.',
  disk: '#3a3a6a', glyph: (p) => { p.ring(8, 7, 4.5, 2, '#e04050'); p.rect(3, 7, 3, 5, '#e04050'); p.rect(10, 7, 3, 5, '#e04050'); p.rect(3, 10, 3, 2, '#e0e0f0'); p.rect(10, 10, 3, 2, '#e0e0f0'); p.rect(6, 7, 4, 6, null); }, look: { aura: '#c8d0ff' },
  stats(m, power) {
    m.addStat('magnet', 55 * power);
    m.mulStat('moveSpeed', 1 + 0.05 * power);
  },
});

const chestSeen = new WeakMap<object, boolean>();
bless({
  id: 'bless_locksmith', name: '상자 감별사', desc: '상자를 열면 성냥이나 동전이 하나 더 나온다', quote: '빈 상자는 없다.',
  // an open chest with a spark rising out of it
  disk: '#4a3a20', glyph: (p) => {
    p.rect(3, 8, 10, 5, '#a8682c');
    p.rect(3, 8, 10, 1, '#e8c870');
    p.line(3, 13, 12, 13, '#5a3418');
    p.rect(7, 9, 2, 2, '#ffe080');
    p.poly([3, 7, 13, 7, 12, 4.5, 4, 4.5], '#7a4a20');
    p.line(4, 5, 11, 5, '#c08840');
    p.px(8, 2, '#fff4c0');
    p.px(10, 3, '#ffd060');
    p.px(6, 3, '#ffd060');
  }, look: { mote: '#e8c870' },
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
      w.spawn(new Pickup(w.rng.chance(0.55) ? 'match' : 'coin', e.x, e.y).pop());
      proc(w, 'bless_locksmith');
    }
  },
});

bless({
  id: 'bless_might', name: '힘의 축복', desc: '공격력 +12%', quote: '등불이 팔에 힘을 싣는다.',
  disk: '#6a1a1a', glyph: (p) => { p.poly([8, 2, 12.5, 7, 9.5, 7, 9.5, 13, 6.5, 13, 6.5, 7, 3.5, 7], '#ff7a60'); p.line(8, 3, 8, 12, '#ffc0a0'); }, look: { grow: 0.5, hit: '#ff8a70' },
  stats(m, power) {
    m.mulStat('damage', 1 + 0.12 * power);
  },
});

bless({
  id: 'bless_haste', name: '신속의 축복', desc: '공격 속도 +12%', quote: '숨 쉴 틈도 없이.',
  disk: '#1a4a5a', glyph: (p) => { p.poly([3, 4, 7, 8, 3, 12, 5, 8], '#c8f0ff'); p.poly([8, 4, 12, 8, 8, 12, 10, 8], '#c8f0ff'); }, look: { trail: 'wind' },
  stats(m, power) {
    m.mulStat('fireRate', 1 + 0.12 * power);
  },
});

bless({
  id: 'bless_soul', name: '푸른 불의 가호', desc: '푸른 불꽃 +2', quote: '보이지 않는 손이 등을 받친다.',
  // a blue flame
  disk: '#1a2a6a', glyph: (p) => {
    p.poly([8, 2, 11.5, 7, 12, 10, 10, 13, 6, 13, 4, 10, 4.5, 7, 6.5, 8], '#7a9af8');
    p.poly([8, 6, 10, 9, 9.5, 12, 6.5, 12, 6, 9.5], '#c8d8ff');
    p.px(8, 11, '#ffffff');
    p.px(7, 10, '#e0ecff');
  }, look: { mote: '#8ab0ff' },
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
  id: 'bless_keen', name: '날카로운 눈', desc: '치명타 확률 +6%, 치명타 피해 +15%', quote: '틈은 언제나 있다.',
  disk: '#2a4a3a', glyph: (p) => { p.ellipse(8, 8, 5.5, 3, '#f0f0e0'); p.circle(8, 8, 2, '#40a070'); p.px(8, 8, '#0c0810'); p.px(7, 7, '#ffffff'); }, look: { hit: '#fff6d0', orbit: '#fff6d0' },
  stats(m, power) {
    m.addStat('critChance', 0.06 * power);
    m.addStat('critMult', 0.15 * power);
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
  id: 'bless_match_pouch', name: '성냥 주머니', desc: '성냥 +3. 성냥을 쓰면 등불 게이지가 차오른다', quote: '불을 붙일 때마다 마음도 데워진다.',
  // a lit match leaning out of a small matchbox
  disk: '#5a3a1a', glyph: (p) => {
    p.rect(2, 10, 8, 4, '#a06a3a');
    p.rect(2, 10, 8, 1, '#c89058');
    p.rect(3, 11, 5, 2, '#b02a20');
    p.line(9, 11, 9, 13, '#3a2420');
    p.line(6, 10, 10, 6, '#f0dcb0');
    p.line(7, 10, 10, 7, '#c8a070');
    p.rect(10, 4, 2, 2, '#c03a2a');
    p.poly([10, 4, 11, 0.5, 13, 2, 13.5, 4.5, 12, 5.5], '#ff9a30');
    p.px(11, 3, '#fff0a0');
    p.px(12, 2, '#ffd060');
  }, look: { step: '#ffb040' },
  onAcquire(w, power) {
    grantPerCopy(w, 'bless_match_pouch', power, () => { addMatches(w, 3); });
  },
  onMatch(w, _x, _y, power) {
    const p = w.player;
    p.addEmber(EMBER_MAX * 0.35 * power);
    w.particles.burst(p.x, p.y - 8, { count: 10, speed: [20, 60], life: [0.3, 0.6], colors: ['#ffffff', '#ffd060', '#ff9a30'], size: [1, 2], additive: true });
    proc(w, 'bless_match_pouch');
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
  id: 'bless_release_heal', name: '해방의 온기', desc: '해방 시 반 칸 회복 (방마다 한 번). 최대 체력이 없으면 푸른 불꽃 2칸까지 회복', quote: '불꽃을 놓아줄 때 따뜻해진다.',
  disk: '#6a4a2a', glyph: (p) => { p.rect(6, 5, 4, 7, '#ffd890'); p.rect(5, 4, 6, 1, '#a07040'); p.rect(5, 12, 6, 1, '#a07040'); p.px(8, 8, '#ff8a30'); p.px(8, 7, '#fff0a0'); }, look: { aura: '#ffe0a0' },
  onRelease(w, power) {
    // once per room: several releases a floor would otherwise out-heal every other source
    const room = (w.run.floor * 4 + w.run.stage) * 10000 + w.node.id;
    if (w.vars.__releaseHealRoom === room) return;
    w.vars.__releaseHealRoom = room;
    const p = w.player;
    if (p.maxRed > 0 && p.red < p.maxRed) p.heal(power);
    else if (p.maxRed <= 0 && p.soul < 4) p.addSoul(Math.min(power, 4 - p.soul));
    else return;
    proc(w, 'bless_release_heal');
  },
});

bless({
  id: 'bless_hunter', name: '사냥꾼의 불씨', desc: '처치할 때마다 등불 게이지 +5', quote: '사냥이 등불을 먹인다.',
  disk: '#4a2a10', glyph: (p) => { p.line(4, 4, 7, 12, '#ffb070'); p.line(7, 4, 10, 12, '#ffb070'); p.line(10, 4, 13, 12, '#ffb070'); }, look: { hit: '#ff9a30' },
  onKill(w, e, power) {
    // boss minions feed it less: releases skip the boss damage budget
    w.player.addEmber(5 * power * (e.isMinion ? 0.4 : 1));
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
