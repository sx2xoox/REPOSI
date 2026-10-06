// Five conventional weapon roles. Their attacks remain readable and
// work with the ordinary projectile/melee hooks; no mandatory artifact set.
import { defineWeapon, type WeaponState } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { ProjBehavior } from '../../game/projectile';
import { attackInput, attackInterval, chargeTime, consumeAttack, handPos, kick, muzzle, rayLength, startSwingPose } from './common';
import { beginAttack } from './kit';
import { foundryTrail, drawFoundryWeapon, foundryImpact } from './foundry-presentation';
import type { ArsenalSpec } from './refuge-arsenal';

export const FOUNDRY_WEAPONS: readonly ArsenalSpec[] = [
  { id: 'sunset_rifle', name: '노을 사냥총', rarity: 'rare', shape: 'rifle', color: '#edbc77', rate: .5, damage: 2.2,
    desc: '느리고 정확한 대구경 사격. 강한 탄환이 적 두 마리를 관통하며 먼 적을 겨눈다.' },
  { id: 'gatekeeper_shotgun', name: '문지기 산탄총', rarity: 'epic', shape: 'shotgun', color: '#d4ac7b', rate: 1, damage: .295,
    desc: '산탄 여섯 발을 두 번 빠르게 쏜 뒤 재장전한다. 가까이서 탄을 모아 맞히면 강하다.' },
  { id: 'dawn_pike', name: '여명 관통창', rarity: 'epic', shape: 'spear', color: '#e9d196', rate: .72, damage: 1.23,
    desc: '긴 사거리로 일직선의 적을 꿰뚫는다. 세 번째 찌르기는 더 멀리 뻗고 두 배의 피해를 준다. 적 탄환을 막거나 반사하지 못한다.' },
  { id: 'gatebreaker_maul', name: '성문 파쇄추', rarity: 'rare', shape: 'mace', color: '#c9b1d7', rate: .5, damage: 3.1,
    desc: '짧게 들어 올린 뒤 넓게 후려친다. 느리지만 강한 충격으로 적을 크게 밀어낸다. 적 탄환을 막거나 반사하지 못한다.' },
  { id: 'silvermoon_longbow', name: '은월 장궁', rarity: 'epic', shape: 'bow', color: '#cbd4f2', rate: 1, damage: 2.6, charge: .76,
    desc: '누르면 당기고 떼면 쏜다. 완충 시 자동 발사하는 은빛 화살은 강해지고 적 네 마리를 관통한다.' },
];

// Accepted existing art is only a loading/headless fallback. The native
// PixelLab exports replace heldSprite/icon together during application boot.
const FALLBACK: Record<string, string> = {
  sunset_rifle: 'ember_musket', gatekeeper_shotgun: 'bell_blunderbuss',
  dawn_pike: 'comet_pike', gatebreaker_maul: 'cathedral_mace', silvermoon_longbow: 'crescent_bow',
};
function impactBehavior(kind: 'rifle' | 'shotgun' | 'bow' | 'bow-full'): ProjBehavior {
  return {
    id: `foundry_impact_${kind}`,
    onHit(shot, w, target) {
      // Read the shot's current owner so restored/co-op projectiles keep their attribution.
      if (shot.owner?.team === 'player') foundryImpact(w, shot.owner as Player, target.x, target.y - target.z, shot.angle, kind);
    },
  };
}
const rifleImpact = impactBehavior('rifle'), shotgunImpact = impactBehavior('shotgun');
const bowImpact = impactBehavior('bow'), fullBowImpact = impactBehavior('bow-full');

/** Falloff is per projectile's subsequent targets, never a fresh extra hit. */
const riflePierce: ProjBehavior = {
  id: 'foundry_rifle_pierce',
  onHit(p) { p.damage *= .86; },
};

function recordShot(w: World, p: Player, st: WeaponState, aim: number): void {
  consumeAttack(st);
  beginAttack(w, p, st, aim);
  st.combo++;
  // Player.update expires a combo once comboTimer reaches zero.
  st.comboTimer = st.cooldown + .55;
  st.mem.attackAim = aim;
  st.mem.interval = st.cooldown;
}

function rifle(w: World, p: Player, st: WeaponState, firing: boolean, aim: number): void {
  if (st.cooldown > 0 || !attackInput(st, w, firing)) return;
  st.cooldown = attackInterval(p);
  recordShot(w, p, st, aim);
  const s = p.weaponStats;
  const shots = p.fireProjectiles(w, aim, {
    damageMult: 2.2, speed: s.shotSpeed * 2.2, range: s.range * 1.7,
    pierce: s.pierce + 2 + (p.flags.has('pierceAll') ? 99 : 0), radius: 1.8,
    style: 'sprite', sprite: 'shot_ember_musket', spriteRotates: true, color: '#edbc77',
    knockback: s.knockback * 1.4, spreadMult: .45, behaviors: [foundryTrail, riflePierce, rifleImpact],
  });
  for (const shot of shots) shot.mem.foundryKind = 1;
  const h = handPos(p, aim, 20);
  muzzle(w, h.x, h.y, aim, ['#fff3cd', '#edbc77', '#b96b45'], 6);
  kick(w, aim + Math.PI, .7);
  w.sfx('shoot', { vol: .55, pitch: .68 });
}

function shotgun(w: World, p: Player, st: WeaponState, firing: boolean, aim: number): void {
  if (st.cooldown > 0 || !attackInput(st, w, firing)) return;
  const second = (st.mem.shells ?? 0) === 1;
  st.mem.shells = second ? 0 : 1;
  st.mem.shotIndex = second ? 2 : 1;
  st.cooldown = attackInterval(p, second ? 2.55 : .68);
  st.mem.reloadStart = second ? w.time : 0;
  st.mem.reloadUntil = second ? w.time + st.cooldown : 0;
  recordShot(w, p, st, aim);
  const s = p.weaponStats;
  // Each of the six native pellets receives the ordinary multishot fan.
  // The proc gate treats them as one owner's shared additional-effect budget.
  for (let i = 0; i < 6; i++) {
    const shots = p.fireProjectiles(w, aim + (i - 2.5) * .075, {
      damageMult: .295, speed: s.shotSpeed * 1.4, range: s.range * .64,
      radius: Math.max(1.1, s.projSize * .65), style: 'sprite', sprite: 'shot_bell_blunderbuss',
      spriteRotates: true, color: '#d4ac7b', knockback: s.knockback * 1.3,
      spreadMult: .6, behaviors: [foundryTrail, shotgunImpact],
    });
    for (const shot of shots) shot.mem.foundryKind = 2;
  }
  const h = handPos(p, aim, 19);
  muzzle(w, h.x, h.y, aim, ['#fff2cf', '#eac085', '#b48252'], 9);
  kick(w, aim + Math.PI, .9);
  w.sfx('shoot', { vol: .58, pitch: .57 });
}

function pike(w: World, p: Player, st: WeaponState, firing: boolean, aim: number): void {
  if (st.cooldown > 0 || !attackInput(st, w, firing)) return;
  st.cooldown = attackInterval(p);
  recordShot(w, p, st, aim);
  const finisher = st.combo % 3 === 0, s = p.weaponStats;
  st.mem.finisher = finisher ? 1 : 0;
  const reach = Math.min((finisher ? 83 : 65) + s.range * .025, rayLength(w, p.x, p.y - 3, aim, 130));
  p.swing(w, {
    angle: aim, damage: s.damage * (finisher ? 2.46 : 1.23), thrust: true, reach,
    arc: finisher ? 14 : 10, duration: .09, visual: finisher ? .23 : .18,
    color: finisher ? '#fff0bc' : '#c9c998', knockback: s.knockback * (finisher ? 2.6 : 1.3),
    deflect: false, hitKick: finisher ? 1.5 : .7,
    onHit(ww, target) { foundryImpact(ww, p, target.x, target.y - target.z, aim, finisher ? 'pike-finisher' : 'pike'); },
  });
  w.sfx(finisher ? 'swing_heavy' : 'swing', { vol: .48, pitch: finisher ? .9 : 1.25 });
}

function maul(w: World, p: Player, st: WeaponState, firing: boolean, aim: number): void {
  if (st.mem.winding) {
    if (w.time < st.mem.impactAt) return;
    st.mem.winding = 0;
    const a = st.mem.windAim;
    st.cooldown = attackInterval(p, .8);
    recordShot(w, p, st, a);
    const side = st.combo % 2 ? 1 : -1;
    p.swing(w, {
      angle: a, damage: p.weaponStats.damage * 3.1, reach: 48 + p.weaponStats.range * .02,
      arc: 2.55, knockback: p.weaponStats.knockback * 4, visual: .27, duration: .1,
      color: '#d9c7e4', swingDir: side, deflect: false, hitKick: 2.1,
      onHit(ww, target) { foundryImpact(ww, p, target.x, target.y - target.z, a, 'maul'); },
    });
    startSwingPose(st, w, a - 1.3 * side, a + 1.5 * side, .12, .09);
    kick(w, a, .6);
    w.sfx('swing_heavy', { vol: .62, pitch: .65 });
    return;
  }
  if (st.cooldown > 0 || !attackInput(st, w, firing)) return;
  consumeAttack(st);
  st.mem.winding = 1;
  st.mem.windAim = aim;
  st.mem.windStart = w.time;
  st.mem.impactAt = w.time + Math.max(.075, .18 * 2.6 / p.stats.fireRate);
}

function bow(w: World, p: Player, st: WeaponState, dt: number, firing: boolean, aim: number): void {
  if (st.cooldown > 0) return;
  if (firing) st.charge = Math.min(1, st.charge + dt / chargeTime(p, .76));
  if ((firing && st.charge < 1) || (!firing && st.charge <= 0)) return;
  const q = st.charge, full = q >= 1 - 1e-6, s = p.weaponStats;
  st.mem.lastCharge = q;
  st.charge = 0;
  st.cooldown = attackInterval(p, .34);
  recordShot(w, p, st, aim);
  const shots = p.fireProjectiles(w, aim, {
    damageMult: .35 + 2.25 * q * q, speed: s.shotSpeed * (1.1 + q),
    range: s.range * (1 + q * .65), pierce: s.pierce + (full ? 4 : 0) + (p.flags.has('pierceAll') ? 99 : 0),
    radius: full ? 2.5 : 1.6, style: 'sprite', sprite: 'shot_crescent_bow', spriteRotates: true,
    color: '#cbd4f2', knockback: s.knockback * (1 + q), spreadMult: .6, behaviors: [foundryTrail, full ? fullBowImpact : bowImpact],
  });
  for (const shot of shots) {
    shot.mem.silvermoon = full ? 1 : 0;
    shot.mem.foundryKind = full ? 4 : 3;
  }
  w.sfx('shoot_arrow', { vol: .55, pitch: full ? .75 : 1.2 });
}

for (const d of FOUNDRY_WEAPONS) {
  const melee = d.shape === 'spear' || d.shape === 'mace';
  defineWeapon({
    id: d.id, name: d.name, desc: d.desc, rarity: d.rarity,
    icon: `icon_${FALLBACK[d.id]}`, heldSprite: `w_${FALLBACK[d.id]}`,
    kind: melee ? 'melee' : d.shape === 'bow' ? 'charge' : 'ranged',
    archetype: d.shape === 'spear' ? '창' : d.shape === 'mace' ? '검·둔기' : d.shape === 'bow' ? '활·쇠뇌' : '사격',
    tags: d.shape === 'spear' ? ['spear'] : d.shape === 'mace' ? ['blade', 'heavy'] : d.shape === 'bow' ? ['bow'] : ['gun'],
    pools: ['treasure', 'shop', 'boss'],
    stats(m) { m.mulStat('fireRate', d.rate); },
    update(w, p, st, dt, firing, aim) {
      switch (d.id) {
        case 'sunset_rifle': rifle(w, p, st, firing, aim); break;
        case 'gatekeeper_shotgun': shotgun(w, p, st, firing, aim); break;
        case 'dawn_pike': pike(w, p, st, firing, aim); break;
        case 'gatebreaker_maul': maul(w, p, st, firing, aim); break;
        default: bow(w, p, st, dt, firing, aim);
      }
    },
    onHolster(_w, _p, st) { st.charge = 0; st.mem.winding = 0; },
    draw(w, p, r, st) { drawFoundryWeapon(d, w, p, r, st); },
  });
}
