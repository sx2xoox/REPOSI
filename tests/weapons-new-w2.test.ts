// Workshop weapons (w2 batch): 거울 방패, 톱날 사출기, 폭죽 통, 뇌전 말뚝,
// 떠도는 등령, 점착 화약 쇠뇌, 별자리 지팡이, 태엽 정지 석궁.
// Registry + art, each weapon's signature verb in the real World, the dummy
// DPS band, draw purity, lockstep determinism and no leaks across rooms.

import './headless';
import { describe, expect, it, vi } from 'vitest';
import { measureDps, bestDps, PLAIN_ID, DUMMY_ID } from './dpsharness';
import { FIXED_DT, TILE } from '../src/game/constants';
import { tileProps } from '../src/game/tiles';
import { Weapons } from '../src/game/defs';
import { Projectile } from '../src/game/projectile';
import { HELD, type PlayerInput } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import { hasSprite } from '../src/engine/sprites';
import { RNG, fx } from '../src/engine/rng';
import { swapWeapons } from '../src/game/weaponslots';
import type { World } from '../src/game/world';
import type { Player } from '../src/game/player';
import type { Enemy } from '../src/game/enemy';
import type { Entity } from '../src/game/entity';
import { ownedBy } from '../src/content/weapons/arms-kit';
import { runCoop, type CoopResult } from './coopsim';
import { MIRROR_BASH, MIRROR_RETURN, MIRROR_STRIDE, SAW_BITE, SAW_STICK_SECONDS, StuckSaw, mirrorReturnsPerSecond, sawMaxStuck } from '../src/content/weapons/guild-arms';
import { FIREWORK_BLAST, FIREWORK_SPARK, TESLA_CHAIN, TESLA_FENCE, TESLA_LANDING, TESLA_ZAP, TeslaStake, teslaMaxStakes } from '../src/content/weapons/guild-sparks';
import { LAMP_KEEPER_SHOT, LAMP_MAX, LAMP_SPIRIT_SHOT, STICKY_BLAST, STICKY_BOLT, STICKY_FUSE, StickyCharge } from '../src/content/weapons/star-lamps';
import { CONSTELLATION_BURST, CONSTELLATION_EDGE, Constellation, STAR_LIFE, STAR_PLACE, STASIS_LAUNCH, STASIS_OUT, StarMark, hangingBolts, stasisCapacity } from '../src/content/weapons/star-arms';

const IDS = ['mirror_buckler', 'saw_launcher', 'firework_barrel', 'tesla_stake', 'wandering_lamp', 'sticky_crossbow', 'constellation_staff', 'stasis_arbalest'];
const TAGS = new Set(['blade', 'spear', 'heavy', 'quick', 'bow', 'gun', 'arcane', 'staff', 'explosive']);

// ---------------------------------------------------------------- harness
interface Sim { w: World; p: Player; dmg: number }

/** The kitless keeper holding `weapon` in the start room, no foes, crits off. */
function sim(weapon: string, seed = `W2-${weapon}`): Sim {
  const r = measureDps({ character: PLAIN_ID, weapon, seconds: 0, seed });
  const w = r.world;
  for (const e of r.dummies) w.killEnemy(e);
  idle(w, 20);
  w.player.stats.critChance = 0;
  return { w, p: w.player, dmg: w.player.weaponStats.damage };
}

type Fill = (o: PlayerInput, p: Player) => void;

/** Run `frames` steps with input from `fill` (defaults: stand still, cursor ahead, not firing). */
function drive(w: World, frames: number, fill: Fill = () => {}): void {
  w.inputSource = (_w, p, o) => {
    o.mx = o.my = o.ax = o.ay = 0;
    o.pressed = 0;
    o.cx = p.x + 60;
    o.cy = p.y - 6;
    o.held = HELD.cursorAim;
    fill(o, p);
  };
  for (let i = 0; i < frames; i++) w.update(FIXED_DT);
}

const idle = (w: World, frames: number) => drive(w, frames);

/** Fire at a point given relative to the keeper's chest (x, y - 6). */
const fireAt = (dx: number, dy: number): Fill => (o, p) => {
  o.cx = p.x + dx;
  o.cy = p.y - 6 + dy;
  o.held = HELD.cursorAim | HELD.fire;
};
const aimAt = (dx: number, dy: number): Fill => (o, p) => {
  o.cx = p.x + dx;
  o.cy = p.y - 6 + dy;
};

function dummy(w: World, x: number, y: number): Enemy {
  const e = w.spawnEnemy(DUMMY_ID, x, y)!;
  e.dormant = 0;
  return e;
}

/** Fire exactly one attack at (dx, dy), then wait `after` frames. */
function oneShot(w: World, dx: number, dy: number, after: number): void {
  const p = w.player;
  const n = p.weapon.sinceAttack;
  for (let i = 0; i < 90 && p.weapon.sinceAttack >= n && p.weapon.sinceAttack > 0; i++) drive(w, 1, fireAt(dx, dy));
  drive(w, after, aimAt(dx, dy));
}

const lost = (e: Enemy, hp: number, dmg: number) => (hp - e.hp) / dmg;

// ---------------------------------------------------------------- registry
describe('w2 weapons: registry and art', () => {
  it.each(IDS)('%s is registered with art, Korean text, a new archetype, valid tags and pools', (id) => {
    const d = Weapons.must(id);
    expect(hasSprite(d.icon), 'icon').toBe(true);
    expect(d.heldSprite, 'held').toBe(`w_${id}`);
    expect(hasSprite(d.heldSprite!), 'held sprite').toBe(true);
    expect(/[가-힣]/.test(d.name)).toBe(true);
    expect(/[가-힣]/.test(d.desc) && d.desc.length > 10).toBe(true);
    expect(d.archetype && /[가-힣]/.test(d.archetype)).toBe(true);
    expect(d.tags?.length).toBeGreaterThan(0);
    for (const t of d.tags!) expect(TAGS.has(t), t).toBe(true);
    expect(d.pools).toEqual(d.rarity === 'legendary' ? ['boss', 'secret'] : ['treasure', 'shop', 'boss']);
    // archetypes are this batch's own labels
    const others = Weapons.all().filter((o) => o.id !== id && !IDS.includes(o.id));
    expect(others.some((o) => o.archetype === d.archetype), d.archetype).toBe(false);
  });

  it('carries the agreed rarities, kinds and tags', () => {
    const spec: Record<string, [string, string, string[]]> = {
      mirror_buckler: ['rare', 'melee', ['heavy']],
      saw_launcher: ['rare', 'ranged', ['heavy']],
      firework_barrel: ['epic', 'ranged', ['explosive', 'gun']],
      tesla_stake: ['epic', 'ranged', ['arcane']],
      wandering_lamp: ['epic', 'ranged', ['arcane']],
      sticky_crossbow: ['epic', 'ranged', ['bow', 'explosive']],
      constellation_staff: ['legendary', 'ranged', ['staff', 'arcane']],
      stasis_arbalest: ['legendary', 'ranged', ['bow']],
    };
    for (const [id, [rarity, kind, tags]] of Object.entries(spec)) {
      const d = Weapons.must(id);
      expect([d.rarity, d.kind, d.tags], id).toEqual([rarity, kind, tags]);
    }
    const names = Weapons.all().map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every projectile / placed-object sprite exists', () => {
    for (const s of ['proj_mirror_glint', 'proj_sawblade', 'proj_firework_rocket', 'fx_tesla_stake', 'fx_wandering_lamp', 'proj_sticky_bolt', 'fx_const_star', 'proj_stasis_bolt']) expect(hasSprite(s), s).toBe(true);
  });
});

// ---------------------------------------------------------------- verbs
describe('w2 weapons: signature mechanics', () => {
  it('거울 방패: frontal shots return to their shooter at 0.6x, shots from behind are not caught', () => {
    const { w, p, dmg } = sim('mirror_buckler');
    const shooter = dummy(w, p.x + 110, p.y - 5);
    drive(w, 10, fireAt(110, 1));
    const hp = shooter.hp;
    const front = w.spawn(new Projectile({ team: 'enemy', x: p.x + 40, y: p.y - 5, angle: Math.PI, speed: 120, damage: 1, range: 300, owner: shooter }));
    const back = w.spawn(new Projectile({ team: 'enemy', x: p.x - 40, y: p.y - 5, angle: 0, speed: 120, damage: 1, range: 300, owner: shooter }));
    drive(w, 70, fireAt(110, 1));
    expect(front.team).toBe('player');
    expect(front.owner).toBe(p);
    expect(back.team).toBe('enemy');
    expect(lost(shooter, hp, dmg)).toBeCloseTo(MIRROR_RETURN, 5);
  });

  it('거울 방패: returns are capped per second (the rest are only blocked)', () => {
    const { w, p } = sim('mirror_buckler');
    drive(w, 80, fireAt(110, 1));
    const volley = Array.from({ length: 14 }, (_, i) => w.spawn(new Projectile({ team: 'enemy', x: p.x + 30, y: p.y - 11 + i * 0.8, angle: Math.PI, speed: 100, damage: 1, range: 300 })));
    drive(w, 20, fireAt(110, 1));
    const returned = volley.filter((s) => s.team === 'player').length;
    expect(returned).toBe(mirrorReturnsPerSecond(1));
    expect(volley.filter((s) => s.team === 'enemy').every((s) => s.dead)).toBe(true);
  });

  it('거울 방패: the raised shield bashes on the attack beat and slows the stride', () => {
    const { w, p, dmg } = sim('mirror_buckler');
    const foe = dummy(w, p.x + 18, p.y - 4);
    const swings = vi.spyOn(p, 'swing');
    const hp = foe.hp;
    drive(w, 120, fireAt(18, 2));
    drive(w, 6, aimAt(18, 2));
    expect(swings.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(lost(foe, hp, dmg)).toBeCloseTo(swings.mock.calls.length * MIRROR_BASH, 4);
    // stride: the same walk with the shield down and raised
    const walk = (raised: boolean) => {
      const s = sim('mirror_buckler', 'W2-stride');
      drive(s.w, 10);
      const x0 = s.p.x;
      drive(s.w, 40, (o, q) => { o.mx = -1; o.cx = q.x + 80; o.cy = q.y - 6; if (raised) o.held |= HELD.fire; });
      return x0 - s.p.x;
    };
    const ratio = walk(true) / walk(false);
    expect(ratio).toBeGreaterThan(MIRROR_STRIDE - 0.06);
    expect(ratio).toBeLessThan(MIRROR_STRIDE + 0.04);
  });

  it('톱날 사출기: a blade pierces, bites into the wall it reaches and grinds what touches it; three stay at most', () => {
    const { w, p, dmg } = sim('saw_launcher');
    // the first shot-stopping tile straight ahead
    let tx = Math.floor(p.x / TILE);
    const ty = Math.floor((p.y - 5) / TILE);
    while (!tileProps(w.room.tileAt(tx, ty)).blocksShots) tx++;
    const wallX = tx * TILE;
    const pierced = dummy(w, p.x + 40, p.y - 4);
    const grinder = dummy(w, wallX - 8, p.y + 2);
    const hp0 = pierced.hp;
    oneShot(w, wallX - p.x, 0, 1);
    drive(w, 50, aimAt(60, 0));
    expect(lost(pierced, hp0, dmg)).toBeCloseTo(1, 5); // one pass, and it flew on
    const saws = ownedBy(w, StuckSaw, p);
    expect(saws).toHaveLength(1);
    expect(Math.abs(saws[0].x - wallX)).toBeLessThan(5);
    const hpG = grinder.hp;
    drive(w, 60, aimAt(60, 0));
    const bites = lost(grinder, hpG, dmg) / SAW_BITE;
    expect(bites).toBeGreaterThanOrEqual(2.99);
    expect(Math.abs(bites - Math.round(bites))).toBeLessThan(0.02);
    // only the newest few stay in the walls
    for (let i = 0; i < 5; i++) oneShot(w, wallX - p.x, -40 + i * 18, 20);
    expect(ownedBy(w, StuckSaw, p).length).toBeLessThanOrEqual(sawMaxStuck(1));
    idle(w, Math.ceil((SAW_STICK_SECONDS + 0.5) / FIXED_DT));
    expect(ownedBy(w, StuckSaw, p)).toHaveLength(0);
  });

  it('폭죽 통: the rocket bursts at the cursor; the spark ring reaches a foe past the blast without double-hitting', () => {
    const { w, p, dmg } = sim('firework_barrel');
    const near = dummy(w, p.x + 60, p.y - 6 + 14);
    const far = dummy(w, p.x + 60 + 46, p.y - 6);
    const hpN = near.hp;
    const hpF = far.hp;
    drive(w, 1, fireAt(60, 0));
    const rocket = w.projectiles.find((q) => q.behaviors.some((b) => b.id === 'firework_rocket'))!;
    expect(rocket).toBeDefined();
    let at = { x: rocket.x, y: rocket.y };
    for (let i = 0; i < 60 && !rocket.dead; i++) {
      at = { x: rocket.x, y: rocket.y };
      drive(w, 1, aimAt(60, 0));
    }
    expect(rocket.dead).toBe(true);
    expect(Math.hypot(at.x - (p.x + 60), at.y - (p.y - 6))).toBeLessThan(8);
    drive(w, 40, aimAt(60, 0));
    // blast with falloff (inside), one spark (outside)
    expect(lost(near, hpN, dmg)).toBeGreaterThan(FIREWORK_BLAST * 0.6);
    expect(lost(near, hpN, dmg)).toBeLessThan(FIREWORK_BLAST);
    expect(lost(far, hpF, dmg)).toBeCloseTo(FIREWORK_SPARK, 5);
  });

  it('뇌전 말뚝: lands at the cursor, zaps the nearest foe on a beat and chains once', () => {
    const { w, p, dmg } = sim('tesla_stake');
    const a = dummy(w, p.x + 90, p.y - 6);
    const b = dummy(w, p.x + 115, p.y - 6);
    const hpA = a.hp;
    const hpB = b.hp;
    oneShot(w, 60, 0, 0);
    // flight + landing shock + one beat (0.5 s at the base fire rate)
    drive(w, 50, aimAt(-60, 0));
    const stakes = ownedBy(w, TeslaStake, p);
    expect(stakes).toHaveLength(1);
    expect(Math.hypot(stakes[0].x - (p.x + 60), stakes[0].y - (p.y - 6))).toBeLessThan(6);
    expect(lost(a, hpA, dmg)).toBeCloseTo(TESLA_LANDING + TESLA_ZAP, 5);
    expect(lost(b, hpB, dmg)).toBeCloseTo(2 * TESLA_CHAIN, 5);
  });

  it('뇌전 말뚝: two stakes string a fence that shocks a foe crossing between them; two at most; holstering pulls them', () => {
    const { w, p, dmg } = sim('tesla_stake');
    p.x = w.room.centerX - 80;
    p.y = w.room.centerY + 6;
    idle(w, 2);
    // foes beside each stake soak the zaps (too far apart to chain); the one in the middle only meets the fence
    dummy(w, p.x + 33, p.y - 6);
    dummy(w, p.x + 147, p.y - 6);
    const mid = dummy(w, p.x + 90, p.y - 6);
    oneShot(w, 40, 0, 40);
    const hp1 = mid.hp;
    drive(w, 30, aimAt(-60, 0));
    expect(mid.hp).toBe(hp1); // one stake: no fence
    oneShot(w, 140, 0, 30);
    const hp2 = mid.hp;
    drive(w, 40, aimAt(-60, 0));
    const fence = lost(mid, hp2, dmg) / TESLA_FENCE;
    expect(fence).toBeGreaterThanOrEqual(0.99);
    expect(Math.abs(fence - Math.round(fence))).toBeLessThan(0.02);
    for (let i = 0; i < 3; i++) oneShot(w, 40 + i * 20, -30, 10);
    expect(ownedBy(w, TeslaStake, p)).toHaveLength(teslaMaxStakes(1));
    expect(swapWeapons(w, p, true)).toBe(true);
    idle(w, 1);
    expect(ownedBy(w, TeslaStake, p)).toHaveLength(0);
  });

  it('뇌전 말뚝 / 태엽 정지 석궁: things still in flight when the weapon is put away do not linger', () => {
    const t = sim('tesla_stake');
    drive(t.w, 1, fireAt(100, 0));
    expect(swapWeapons(t.w, t.p, true)).toBe(true);
    idle(t.w, 40);
    expect(ownedBy(t.w, TeslaStake, t.p)).toHaveLength(0);
    const a = sim('stasis_arbalest');
    const foe = dummy(a.w, a.p.x - 60, a.p.y - 6);
    const hp = foe.hp;
    drive(a.w, 1, fireAt(100, 0));
    expect(swapWeapons(a.w, a.p, true)).toBe(true);
    idle(a.w, 60);
    expect(hangingBolts(a.w, a.p)).toHaveLength(0);
    expect(lost(foe, hp, a.dmg)).toBeCloseTo(STASIS_LAUNCH, 5);
  });

  it('떠도는 등령: the lamp drifts toward the cursor on its tether; each attack fires from the keeper and from the lamp', () => {
    const { w, p } = sim('wandering_lamp');
    drive(w, 90, aimAt(200, 0));
    const st = p.weapon;
    const d = Math.hypot(st.mem.lx - p.x, st.mem.ly - (p.y - 6));
    expect(d).toBeLessThanOrEqual(LAMP_MAX + 1e-6);
    expect(d).toBeGreaterThan(LAMP_MAX * 0.75);
    expect(Math.abs(Math.atan2(st.mem.ly - (p.y - 6), st.mem.lx - p.x))).toBeLessThan(0.35);
    const fire = vi.spyOn(p, 'fireProjectiles');
    drive(w, 1, fireAt(200, 0));
    expect(fire.mock.calls).toHaveLength(2);
    const [keeper, lamp] = fire.mock.calls.map((c) => c[2]!);
    expect(keeper.damageMult).toBe(LAMP_KEEPER_SHOT);
    expect(lamp.damageMult).toBe(LAMP_SPIRIT_SHOT);
    expect(lamp.x).toBeCloseTo(st.mem.lx, 6);
    expect(lamp.y).toBeCloseTo(st.mem.ly, 6);
    expect(lamp.spectral).toBe(true);
    // both flames land on the aimed foe
    const { w: w2, p: p2, dmg } = sim('wandering_lamp', 'W2-lamp-hit');
    const foe = dummy(w2, p2.x + 100, p2.y - 30);
    const hp = foe.hp;
    drive(w2, 60, aimAt(100, -24));
    drive(w2, 1, fireAt(100, -24));
    drive(w2, 40, aimAt(100, -24));
    expect(lost(foe, hp, dmg)).toBeCloseTo(LAMP_KEEPER_SHOT + LAMP_SPIRIT_SHOT, 5);
  });

  it('떠도는 등령: the lamp leaves with the weapon and comes back at the keeper', () => {
    const { w, p } = sim('wandering_lamp');
    drive(w, 60, aimAt(200, 0));
    expect(p.weapon.mem.lampOn).toBe(1);
    expect(swapWeapons(w, p, true)).toBe(true);
    idle(w, 2);
    expect(p.weapon2.mem.lampOn).toBe(0);
    expect(w.entities.some((e) => e.constructor.name === 'LampWisp' && !e.dead)).toBe(false);
    expect(swapWeapons(w, p, true)).toBe(true);
    drive(w, 1, aimAt(200, 0));
    expect(Math.hypot(p.weapon.mem.lx - p.x, p.weapon.mem.ly - p.y)).toBeLessThan(12);
  });

  it('점착 화약 쇠뇌: bolts stick, blow a moment later, and several on one foe merge into one bigger blast', () => {
    const { w, p, dmg } = sim('sticky_crossbow');
    const foe = dummy(w, p.x + 45, p.y - 6);
    const side = dummy(w, p.x + 45, p.y - 6 + 30);
    const hp = foe.hp;
    const hpS = side.hp;
    // three quick bolts inside one fuse
    oneShot(w, 45, 0, 2);
    oneShot(w, 45, 0, 2);
    oneShot(w, 45, 0, 8);
    const charges = ownedBy(w, StickyCharge, p);
    expect(charges).toHaveLength(1);
    expect(charges[0].mem.bolts).toBe(3);
    expect(charges[0].target).toBe(foe);
    expect(lost(foe, hp, dmg)).toBeCloseTo(3 * STICKY_BOLT, 5);
    drive(w, Math.ceil(STICKY_FUSE / FIXED_DT) + 5, aimAt(-60, 0));
    expect(ownedBy(w, StickyCharge, p)).toHaveLength(0);
    expect(lost(foe, hp, dmg)).toBeCloseTo(3 * STICKY_BOLT + 3 * STICKY_BLAST, 5);
    // the merged blast is wider: a foe 30 px away is caught (a single bolt's blast would not reach it)
    expect(lost(side, hpS, dmg)).toBeCloseTo(3 * STICKY_BLAST, 5);
  });

  it('점착 화약 쇠뇌: a single bolt only catches what is close', () => {
    const { w, p, dmg } = sim('sticky_crossbow');
    const foe = dummy(w, p.x + 45, p.y - 6);
    const side = dummy(w, p.x + 45, p.y - 6 + 34);
    const hpS = side.hp;
    const hp = foe.hp;
    oneShot(w, 45, 0, Math.ceil(STICKY_FUSE / FIXED_DT) + 10);
    expect(lost(foe, hp, dmg)).toBeCloseTo(STICKY_BOLT + STICKY_BLAST, 5);
    expect(side.hp).toBe(hpS);
  });

  it('별자리 지팡이: three stars connect; the triangle strikes the inside once and burns foes on its edges', () => {
    const { w, p, dmg } = sim('constellation_staff');
    const inside = dummy(w, p.x + 67, p.y - 6);
    const onEdge = dummy(w, p.x + 34, p.y - 6 + 12);
    const atStar = dummy(w, p.x + 40, p.y - 6 - 40);
    const hpI = inside.hp;
    const hpE = onEdge.hp;
    const hpS = atStar.hp;
    oneShot(w, 40, -40, 40);
    expect(lost(atStar, hpS, dmg)).toBeCloseTo(STAR_PLACE, 5);
    oneShot(w, 120, 0, 40);
    expect(ownedBy(w, StarMark, p)).toHaveLength(2);
    expect(inside.hp).toBe(hpI);
    oneShot(w, 40, 40, 1);
    expect(ownedBy(w, StarMark, p)).toHaveLength(0);
    expect(ownedBy(w, Constellation, p)).toHaveLength(1);
    drive(w, 60, aimAt(-60, 0));
    expect(ownedBy(w, Constellation, p)).toHaveLength(0);
    expect(lost(inside, hpI, dmg)).toBeCloseTo(CONSTELLATION_BURST, 5);
    expect(lost(onEdge, hpE, dmg)).toBeCloseTo(3 * CONSTELLATION_EDGE, 5);
  });

  it('별자리 지팡이: a lone star fades after a while; holstering scatters waiting stars', () => {
    const { w, p } = sim('constellation_staff');
    oneShot(w, 60, 0, 10);
    expect(ownedBy(w, StarMark, p)).toHaveLength(1);
    idle(w, Math.ceil(STAR_LIFE / FIXED_DT) + 2);
    expect(ownedBy(w, StarMark, p)).toHaveLength(0);
    oneShot(w, 60, 0, 10);
    expect(ownedBy(w, StarMark, p)).toHaveLength(1);
    expect(swapWeapons(w, p, true)).toBe(true);
    idle(w, 1);
    expect(ownedBy(w, StarMark, p)).toHaveLength(0);
  });

  it('태엽 정지 석궁: bolts stop at the cursor, hang while firing goes on, then all launch at the nearest foe', () => {
    const { w, p, dmg } = sim('stasis_arbalest');
    const foe = dummy(w, p.x + 60, p.y + 70);
    const hp = foe.hp;
    for (let i = 0; i < 3; i++) oneShot(w, 70, 0, 2);
    drive(w, 12, fireAt(70, 0));
    const hanging = hangingBolts(w, p);
    expect(hanging.length).toBeGreaterThanOrEqual(3);
    for (const b of hanging) {
      expect(b.speed).toBe(0);
      expect(Math.hypot(b.x - (p.x + 70), b.y - (p.y - 6))).toBeLessThan(6);
    }
    const n = hanging.length;
    expect(foe.hp).toBe(hp);
    // let go: half a second later they all fly
    drive(w, 70, aimAt(70, 0));
    expect(hangingBolts(w, p)).toHaveLength(0);
    expect(lost(foe, hp, dmg)).toBeCloseTo(n * STASIS_LAUNCH, 5);
  });

  it('태엽 정지 석궁: a bolt clips foes on the way out and still hangs; a full clock launches even while firing', () => {
    const { w, p, dmg } = sim('stasis_arbalest');
    const path = dummy(w, p.x + 40, p.y - 6);
    const hp = path.hp;
    oneShot(w, 80, 0, 20);
    expect(lost(path, hp, dmg)).toBeCloseTo(STASIS_OUT, 5);
    expect(hangingBolts(w, p)).toHaveLength(1);
    // keep firing at an empty spot: the clock fills and releases on its own
    const releases: number[] = [];
    for (let i = 0; i < 400; i++) {
      drive(w, 1, fireAt(-80, -30));
      const k = hangingBolts(w, p).length;
      expect(k).toBeLessThanOrEqual(stasisCapacity(1));
      if (w.time - (p.weapon.mem.releaseAt ?? -9) < FIXED_DT / 2) releases.push(p.weapon.mem.released);
    }
    expect(releases.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------- balance
describe('w2 weapons: dummy band', () => {
  const base = bestDps(PLAIN_ID, 'lantern_bolt');
  const baseCrowd = bestDps(PLAIN_ID, 'lantern_bolt', true);
  it.each(IDS)('%s: 0.85x..1.35x single target, crowd within 6.5x of the lantern', (id) => {
    const k = bestDps(PLAIN_ID, id) / base;
    const c = bestDps(PLAIN_ID, id, true) / baseCrowd;
    expect(k).toBeGreaterThanOrEqual(0.85);
    expect(k).toBeLessThanOrEqual(1.35);
    expect(c).toBeLessThanOrEqual(6.5);
    // rarity: legendaries edge out (mechanics carry them, not raw numbers)
    if (Weapons.must(id).rarity === 'legendary') expect(k).toBeGreaterThanOrEqual(1.05);
  }, 60_000);
});

// ---------------------------------------------------------------- purity, determinism, rooms
function crowdFight(id: string, seed: string): { w: World; p: Player } {
  const r = measureDps({ character: PLAIN_ID, weapon: id, seconds: 0, crowd: true, seed });
  return { w: r.world, p: r.world.player };
}

/** Steps with a bot that sweeps its aim and taps fire (so placements, hangs and releases all happen). */
function sweep(w: World, frames: number, after?: (i: number) => void): void {
  const bot = w.inputSource!;
  w.inputSource = (ww, p, o) => {
    bot(ww, p, o);
    const t = ww.time;
    o.cx += Math.sin(t * 1.7) * 40;
    o.cy += Math.cos(t * 1.3) * 30;
    if (Math.floor(t / 1.3) % 3 === 2) o.held &= ~HELD.fire;
  };
  for (let i = 0; i < frames; i++) {
    w.update(FIXED_DT);
    after?.(i);
  }
}

const MINE = [StuckSaw, TeslaStake, StickyCharge, StarMark, Constellation];

describe('w2 weapons: purity, lockstep and rooms', () => {
  it.each(IDS)('%s: drawing never changes the simulation', (id) => {
    const { w } = crowdFight(id, 'W2-PURE');
    sweep(w, 240, (i) => {
      if (i % 3) return;
      const before = stateHash(w);
      w.draw(1);
      expect(stateHash(w), `${id} ${i}`).toBe(before);
    });
  });

  it.each(IDS)('%s: identical runs stay bit-identical whatever the cosmetic RNG does', (id) => {
    const run = (fxSeed: number, draw: boolean) => {
      fx.setState(new RNG(fxSeed).getState());
      const { w } = crowdFight(id, 'W2-LOCKSTEP');
      const hashes: number[] = [];
      sweep(w, 300, (i) => {
        if (draw && i % 2) w.draw(0.5);
        if (i % 10 === 0) hashes.push(stateHash(w));
      });
      return hashes;
    };
    expect(run(7, true)).toEqual(run(0x9e3779b9, false));
  });

  it.each(IDS)('%s: nothing is left behind in the next room and the weapon keeps working', (id) => {
    const { w, p } = crowdFight(id, 'W2-ROOMS');
    sweep(w, 150);
    const next = w.map.nodes.find((n) => n.id !== w.node.id)!;
    w.withIds(() => w.enterRoom(next, null));
    idle(w, 2);
    const left = w.entities.filter((e: Entity) => !e.dead && MINE.some((c) => e instanceof c));
    expect(left).toHaveLength(0);
    expect(w.projectiles.filter((q) => q.owner === p && !q.dead)).toHaveLength(0);
    if (id === 'wandering_lamp') expect(Math.hypot(p.weapon.mem.lx - p.x, p.weapon.mem.ly - p.y)).toBeLessThan(12);
    const n = p.weapon.sinceAttack;
    drive(w, 60, fireAt(50, 0));
    expect(p.weapon.sinceAttack).toBeLessThan(n + 1);
  });
});

describe('w2 weapons: online co-op', () => {
  /** Every peer's per-frame hashes equal the host's on the frames both simulated. */
  function sameHashes(res: CoopResult): number {
    const ref = res.peers[0].hashes;
    let checked = 0;
    for (const peer of res.peers) {
      for (let t = 0; t < Math.min(ref.length, peer.hashes.length); t++) {
        if (peer.hashes[t] === undefined || ref[t] === undefined) continue;
        expect(peer.hashes[t], `slot ${peer.slot} tick ${t}`).toBe(ref[t]);
        checked++;
      }
    }
    return checked;
  }

  const PAIRS = [['mirror_buckler', 'saw_launcher'], ['firework_barrel', 'tesla_stake'], ['wandering_lamp', 'sticky_crossbow'], ['constellation_staff', 'stasis_arbalest']];
  it.each(PAIRS)('%s + %s: two keepers stay in lockstep while their weapons work', (a, b) => {
    // attacks made with the w2 weapons, per world (every peer must count the same)
    const used = new Map<World, number[]>();
    const res = runCoop({
      name: `w2 ${a}`, seed: `W2-COOP-${a}`, chars: ['ria', 'bern'], ms: 24_000, link: { latencyMs: 35, jitterMs: 25 },
      bossAt: 0, downAt: 0, leaveAt: 0, discardAt: 0,
      extraStep: (w, tick) => {
        const n = used.get(w) ?? [0, 0];
        used.set(w, n);
        for (const p of w.players) {
          const id = p.slot === 0 ? a : b;
          // the bot also tries other weapons: hand ours back now and then
          if (tick % 120 === 3 && p.weaponId !== id) w.asPlayer(p, () => w.withIds(() => p.equipWeapon(w, id)));
          if (p.weaponId === id && p.weapon.sinceAttack === 0) n[p.slot]++;
        }
      },
    });
    expect(sameHashes(res)).toBeGreaterThan(500);
    for (const peer of res.peers) expect(peer.desyncs).toHaveLength(0);
    const counts = res.peers.map((peer) => used.get(peer.world));
    expect(counts[0]![0]).toBeGreaterThan(5);
    expect(counts[0]![1]).toBeGreaterThan(5);
    expect(res.peers[0].world.run.stats.kills).toBeGreaterThan(0);
  }, 120_000);
});
