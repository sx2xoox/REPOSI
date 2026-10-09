// 등불 도둑 사냥 (hunt mission room): cracks, the never-dying weasel, claims, regrabs,
// escapes and drag-outs, success / fail rewards, the fallback, caltrops and flares,
// drawing purity and co-op lockstep.
import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { RNG } from '../src/engine/rng';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Enemy } from '../src/game/enemy';
import { Artifacts, Weapons } from '../src/game/defs';
import { GroundWarning } from '../src/game/effects';
import { Pedestal, Pickup } from '../src/game/pickups';
import { Projectile } from '../src/game/projectile';
import { stateHash } from '../src/game/statehash';
import { generateStage } from '../src/game/dungeon';
import { stageRoomPlan } from '../src/game/stage-plan';
import { Floors } from '../src/game/defs';
import { WeaponChest } from '../src/content/weapons/drops';
import { encounterHP, endEncounter } from '../src/content/rooms/encounter-kit';
import { HuntCaltrop, HuntDevice, HuntEmber, huntCracks } from '../src/content/rooms/hunt';
import { BAR_MULT, DOWN_TIME, ST, WEASEL_ID } from '../src/content/rooms/hunt-weasel';
import { runCoop } from './coopsim';
import type { Entity } from '../src/game/entity';

loadContent();
const DT = 1 / 60;

function setup(players = 1, floor = 1, template = 'hunt_den', seed = 'HUNT-TEST') {
  const run = new RunState(seed, 'ria');
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  if (players === 1) w.start();
  else w.startParty(Array.from({ length: players }, (_, slot) => ({ slot, characterId: 'ria', name: 'P' + slot })), 0);
  if (floor > 1) w.startFloor(floor);
  const n = w.map.nodes.find((x) => x.id !== w.map.startId && x.cw === 1 && x.ch === 1 && x.kind === 'normal')!;
  n.kind = 'hunt';
  n.templateId = template;
  n.visited = false;
  n.cleared = false;
  w.enterRoom(n, null);
  for (const p of w.players) p.god = true;
  const d = w.entities.find((e) => e instanceof HuntDevice) as HuntDevice;
  return { w, d };
}
function begin(w: World, d: HuntDevice): boolean {
  w.player.x = d.x - 18;
  w.player.y = d.y + 8;
  return d.interact(w);
}
const weasel = (w: World, d: HuntDevice) => w.entityById(d.mem.weasel) as Enemy | undefined;
function step(w: World, n: number, each?: () => void) {
  for (let i = 0; i < n; i++) {
    each?.();
    w.update(DT);
  }
}
function clearMinions(w: World) {
  for (const e of w.enemies) if (e.def.id !== WEASEL_ID) e.dead = true;
  for (const e of w.entities) if (e.constructor.name === 'EncounterSummon') e.dead = true;
}
/** Park every keeper in a far corner (away from the weasel and the tree). */
function park(w: World) {
  for (const p of w.players) { p.x = 48; p.y = 176 - 20; }
}
/** Until the weasel has landed from its leap and can be hit. */
function untilHittable(w: World, d: HuntDevice) {
  for (let i = 0; i < 600; i++) {
    const e = weasel(w, d);
    if (e && e.vulnerable && e.mem.state !== ST.leap && e.mem.state !== ST.down && e.script.done) return e;
    clearMinions(w);
    w.update(DT);
  }
  throw new Error('weasel never became hittable');
}
function knock(w: World, d: HuntDevice) {
  const e = untilHittable(w, d);
  w.applyHit(e, { damage: 1e7, kind: 'projectile', attacker: w.players[0], dirX: 1, dirY: 0 });
  return e;
}
const landed = (w: World) => w.entities.filter((e) => e instanceof HuntEmber && !e.dead && e.landed) as HuntEmber[];
function claimOne(w: World, d: HuntDevice, slot = 0) {
  for (let i = 0; i < 120 && !landed(w).length; i++) w.update(DT);
  const em = landed(w)[0];
  const p = w.players.find((q) => q.slot === slot)!;
  p.x = em.x;
  p.y = em.y;
  w.update(DT);
  park(w);
}
const isReward = (e: Entity): e is WeaponChest | Pedestal => !e.dead && (e instanceof WeaponChest || (e instanceof Pedestal && e.item?.kind === 'artifact'));
const coins = (w: World, d: HuntDevice) => w.entities.filter((e) => e instanceof Pickup && e.kind === 'coin' && e.encounterId === d.id && !e.dead);

describe('hunt room layout', () => {
  it('places three cracks on open floor, clear of the doors and spread apart, varying by seed', () => {
    const layouts = new Set<string>();
    for (const template of ['hunt_den', 'hunt_yard']) for (let i = 0; i < 20; i++) {
      const { w, d } = setup(1, 1, template, `CRACKS-${template}-${i}`);
      const cracks = huntCracks(w.room, new RNG(`cracks-${i}`));
      expect(cracks).toHaveLength(3);
      for (const c of cracks) {
        expect(w.room.isFree(c.x, c.y, 8)).toBe(true);
        for (const door of w.room.doors) expect(Math.hypot(door.x - c.x, door.y - c.y)).toBeGreaterThanOrEqual(40);
      }
      for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) expect(Math.hypot(cracks[a].x - cracks[b].x, cracks[a].y - cracks[b].y)).toBeGreaterThanOrEqual(96);
      layouts.add(cracks.map((c) => `${c.x},${c.y}`).sort().join('|'));
      // the room's own cracks (room rng) are stored on the device and are valid too
      for (let k = 0; k < 3; k++) expect(w.room.isFree(d.crack(k).x, d.crack(k).y, 8)).toBe(true);
    }
    expect(layouts.size).toBeGreaterThan(5);
  });

  it('stage plans roll the hunt and the dungeon builds it from a hunt template', () => {
    let rolled = 0;
    for (let s = 0; s < 400; s++) if (stageRoomPlan(new RNG(`plan-${s}`)).includes('hunt')) rolled++;
    expect(rolled / 400).toBeGreaterThan(0.08);
    let built = 0;
    for (let s = 0; s < 120 && !built; s++) {
      const map = generateStage(Floors.all()[0], 1, new RNG(`hunt-stage-${s}`));
      for (const n of map.nodes) if (n.kind === 'hunt') { built++; expect(['hunt_den', 'hunt_yard']).toContain(n.templateId); }
    }
    expect(built).toBeGreaterThan(0);
  });
});

describe('the weasel', () => {
  it('never dies to a huge hit while hunted: it tumbles, drops an ember and comes back tougher; control is capped', () => {
    const { w, d } = setup();
    expect(begin(w, d)).toBe(true);
    const e = knock(w, d);
    expect(e.alive).toBe(true);
    expect(e.hp).toBe(1);
    expect(e.vulnerable).toBe(false);
    expect(e.mem.state).toBe(ST.down);
    expect(d.mem.held).toBe(2);
    expect(w.entityById(e.id)).toBe(e);
    // (the big hit starts a hit-stop: give the world a few steps)
    step(w, 8);
    expect(w.entities.filter((x) => x instanceof HuntEmber && !x.dead)).toHaveLength(1);
    // still untouchable during the tumble
    park(w);
    step(w, Math.round(DOWN_TIME / DT) - 16, () => clearMinions(w));
    expect(w.applyHit(e, { damage: 1e7, kind: 'projectile', attacker: w.player })).toBe(false);
    expect(e.hp).toBe(1);
    let refilled = 0;
    for (let i = 0; i < 60 && !e.vulnerable; i++) w.update(DT);
    refilled = e.maxHp;
    expect(e.vulnerable).toBe(true);
    expect(refilled).toBe(Math.round(e.mem.bb * BAR_MULT[1]));
    expect(refilled).toBeGreaterThan(Math.round(e.mem.bb));
    // boss-style control caps
    e.statuses.clear();
    expect(e.applyStatus({ kind: 'freeze', duration: 3 }, () => 0)).toBe(true);
    expect(e.statuses.get('freeze')!.time).toBeLessThanOrEqual(0.35);
    e.statuses.clear();
    expect(e.applyStatus({ kind: 'freeze', duration: 3 }, () => 0)).toBe(false);
    step(w, 125);
    expect(e.applyStatus({ kind: 'stun', duration: 3 }, () => 0)).toBe(true);
    expect(e.applyStatus({ kind: 'fear', duration: 3 }, () => 0)).toBe(false);
    expect(e.applyStatus({ kind: 'charm', duration: 3 }, () => 0)).toBe(false);
    expect(e.applyStatus({ kind: 'slow', duration: 3, power: 0.8 }, () => 0)).toBe(true);
    expect(e.statuses.get('slow')!.power).toBeLessThanOrEqual(0.3);
  });

  it('a standalone weasel (debug spawn) is a plain killable critter', () => {
    const { w } = setup();
    const e = w.spawnEnemy(WEASEL_ID, 120, 100)!;
    step(w, 50);
    expect(e.mem.root).toBe(0);
    w.applyHit(e, { damage: 1e7, kind: 'projectile', attacker: w.player });
    expect(e.dead).toBe(true);
    expect(w.entities.some((x) => x instanceof HuntEmber)).toBe(false);
  });
});

describe('embers', () => {
  it('only members claim; a claim pays progress, coins and +15 ember; keepers win same-frame ties', () => {
    const { w, d } = setup(2);
    begin(w, d);
    expect(d.mem.members).toBe(3);
    const [p0, p1] = w.players;
    knock(w, d);
    park(w);
    for (let i = 0; i < 60 && !landed(w).length; i++) w.update(DT);
    const em = landed(w)[0];
    // a keeper that is not part of the hunt cannot take it
    d.mem.members = 1;
    p1.x = em.x;
    p1.y = em.y;
    w.update(DT);
    expect(d.mem.progress).toBe(0);
    expect(em.dead).toBe(false);
    // a keeper that left cannot either
    d.mem.members = 3;
    p1.left = true;
    w.update(DT);
    expect(d.mem.progress).toBe(0);
    p1.left = false;
    park(w);
    const ember0 = p0.ember;
    p0.x = em.x;
    p0.y = em.y;
    w.update(DT);
    expect(d.mem.progress).toBe(1);
    expect(em.dead).toBe(true);
    expect(p0.ember - ember0).toBeCloseTo(15, 6);
    // 2 coins per ember, +1 per extra hunter (two here)
    expect(coins(w, d)).toHaveLength(3);
    expect(d.mem.lightR).toBe(36);
    // a tie: the weasel and a keeper both on the next ember in one step
    const e = knock(w, d);
    park(w);
    for (let i = 0; i < 60 && !landed(w).length; i++) w.update(DT);
    const em2 = landed(w)[0];
    e.mem.state = ST.flee;
    e.vulnerable = true;
    e.x = em2.x;
    e.y = em2.y;
    p0.x = em2.x;
    p0.y = em2.y;
    // the first claim's coins are swept up first (one may lie right where this keeper stands)
    for (const c of coins(w, d)) c.dead = true;
    w.update(DT);
    expect(d.mem.progress).toBe(2);
    expect(d.mem.held).toBe(1);
    expect(coins(w, d)).toHaveLength(3);
  });

  it('after its tumble the weasel races back for a nearby ember and takes it back', () => {
    const { w, d } = setup();
    begin(w, d);
    const e = knock(w, d);
    park(w);
    let raced = false;
    for (let i = 0; i < 600 && d.mem.held < 3; i++) {
      clearMinions(w);
      w.update(DT);
      if (e.mem.state === ST.race) raced = true;
    }
    expect(raced).toBe(true);
    expect(d.mem.held).toBe(3);
    expect(landed(w)).toHaveLength(0);
    expect(d.mem.progress).toBe(0);
  });
});

describe('escapes', () => {
  it('no attempt before 15 s or during a tumble; a finished channel fails the hunt with no reward, no HP cost and paid coins kept', () => {
    const { w, d } = setup();
    begin(w, d);
    knock(w, d);
    claimOne(w, d);
    expect(d.mem.progress).toBe(1);
    const paid = coins(w, d).map((c) => c.id);
    expect(paid).toHaveLength(2);
    while (d.mem.clock < 14.5) { park(w); clearMinions(w); w.update(DT); expect(d.mem.escState).toBe(0); }
    // tumble it right before the timer: no attempt while it is down or racing
    const e = knock(w, d);
    park(w);
    while (e.mem.state === ST.down || e.mem.state === ST.race) { clearMinions(w); w.update(DT); expect(d.mem.escState).toBe(0); }
    expect(d.mem.clock).toBeGreaterThan(15);
    const p = w.player;
    p.god = false;
    p.invuln = 1e9;
    const hp = p.red + p.soul;
    for (let i = 0; i < 60 * 30 && !d.mem.used; i++) { park(w); clearMinions(w); w.update(DT); }
    expect(d.mem.phase).toBe(5);
    expect(w.node.cleared).toBe(true);
    expect(p.red + p.soul).toBe(hp);
    w.update(DT);
    expect(w.entities.some(isReward)).toBe(false);
    for (const id of paid) expect(w.entities.find((x) => x.id === id && !x.dead)).toBeTruthy();
    expect(d.previewable()).toBe(false);
    expect(begin(w, d)).toBe(false);
    expect(w.room.doors.every((door) => door.state !== 'closed')).toBe(true);
  });

  it('drag-outs (25 % damage or a touch) board the crack; a tumble cancels; three boards corner it for good', () => {
    const { w, d } = setup();
    begin(w, d);
    const e = untilHittable(w, d);
    const channel = () => {
      d.mem.nextEscape = d.mem.clock;
      for (let i = 0; i < 60 * 20 && d.mem.escState !== 2; i++) { park(w); clearMinions(w); w.update(DT); }
      expect(d.mem.escState).toBe(2);
    };
    const sealedCount = () => [0, 1, 2].filter((i) => d.mem.sealed & (1 << i)).length;
    // 1) a hit worth 25 % of the bar
    channel();
    e.hp = e.maxHp;
    w.applyHit(e, { damage: 0.26 * e.maxHp, kind: 'projectile', attacker: w.player, crit: false });
    expect(e.hp).toBeGreaterThanOrEqual(1);
    // (a hit that size starts a short hit-stop: the world catches up within a few frames)
    for (let i = 0; i < 10 && !sealedCount(); i++) w.update(DT);
    expect(sealedCount()).toBe(1);
    expect(d.mem.escState).toBe(0);
    expect(d.mem.nextEscape).toBeCloseTo(d.mem.clock + d.mem.interval, 1);
    expect(e.mem.state).toBe(ST.yank);
    step(w, 60, () => clearMinions(w));
    // 2) a hand on it
    channel();
    w.player.x = e.x;
    w.player.y = e.y;
    w.update(DT);
    expect(sealedCount()).toBe(2);
    park(w);
    step(w, 60, () => clearMinions(w));
    // 3) a tumble cancels the attempt without boarding
    channel();
    const crack = d.mem.escCrack;
    w.applyHit(e, { damage: 1e7, kind: 'projectile', attacker: w.player });
    expect(d.mem.escState).toBe(0);
    expect(sealedCount()).toBe(2);
    expect(d.mem.sealed & (1 << crack)).toBe(0);
    expect(d.mem.nextEscape).toBeCloseTo(d.mem.clock + d.mem.interval, 3);
    // 4) the last crack boarded: cornered, no more attempts
    for (let i = 0; i < 300 && !(e.vulnerable && e.mem.state === ST.flee); i++) { park(w); clearMinions(w); w.update(DT); }
    channel();
    w.player.x = e.x;
    w.player.y = e.y;
    w.update(DT);
    expect(sealedCount()).toBe(3);
    expect(d.mem.cornered).toBe(1);
    for (let i = 0; i < 60 * 120; i++) {
      park(w);
      if (i % 30 === 0) clearMinions(w);
      w.update(DT);
      expect(d.mem.escState).toBe(0);
    }
    expect(d.mem.used).toBe(false);
  }, 60000);
});

describe('outcomes', () => {
  for (const [players, floor, rarity] of [[1, 1, 'rare'], [4, 4, 'epic']] as const) it(`${players} keeper(s) on floor ${floor}: three claims win one free ${rarity} reward each`, () => {
    const { w, d } = setup(players, floor);
    begin(w, d);
    // co-op scaling
    const e0 = weasel(w, d)!;
    expect(e0.maxHp).toBe(Math.round(80 * w.floor.hpMult * encounterHP(players)));
    expect(d.mem.interval).toBe(Math.max(10, [20, 19, 18][Math.min(2, Math.floor((floor - 1) / 3))] - (players - 1)));
    for (let k = 0; k < 3; k++) {
      knock(w, d);
      park(w);
      claimOne(w, d, k % players);
    }
    expect(d.mem.phase).toBe(4);
    expect(w.node.cleared).toBe(true);
    w.update(DT);
    const rewards = w.entities.filter(isReward);
    expect(rewards).toHaveLength(players);
    for (const r of rewards) {
      expect(r.mem.ownerSlot).toBeUndefined();
      const def = r instanceof WeaponChest ? Weapons.must(r.weaponId) : Artifacts.must(r.item!.id);
      expect(def.rarity).toBe(rarity);
    }
    expect(w.enemies.filter((x) => x.alive)).toHaveLength(0);
    expect(w.room.doors.every((door) => door.state !== 'closed')).toBe(true);
  });

  it('a weasel removed some other way spills its embers and the hunt can still be won', () => {
    const { w, d } = setup();
    begin(w, d);
    knock(w, d);
    claimOne(w, d);
    const e = untilHittable(w, d);
    expect(d.mem.held).toBe(2);
    w.killEnemy(e);
    step(w, 8);
    expect(d.mem.weasel).toBe(0);
    expect(d.mem.held).toBe(0);
    expect(landed(w)).toHaveLength(2);
    claimOne(w, d);
    claimOne(w, d);
    expect(d.mem.phase).toBe(4);
  });
});

describe('caltrops and flares', () => {
  it('a caltrop is harmless while settling, pricks a keeper once, never enemies, and goes with the encounter', () => {
    const { w, d } = setup();
    begin(w, d);
    untilHittable(w, d);
    const p = w.player;
    p.god = false;
    p.invuln = 0;
    p.soul = 6;
    const hp = p.red + p.soul;
    const c = w.spawn(new HuntCaltrop(200, 130, d.id));
    c.encounterId = d.id;
    const bystander = w.spawnEnemy('bone_walker', 240, 140)!;
    const under = w.spawn(new HuntCaltrop(240, 140, d.id));
    under.encounterId = d.id;
    for (let i = 0; i < 25; i++) { p.x = 200; p.y = 130; p.invuln = 0; bystander.x = 240; bystander.y = 140; bystander.dormant = 1; w.update(DT); }
    expect(p.red + p.soul).toBe(hp);
    const ehp = bystander.hp;
    for (let i = 0; i < 20 && !c.dead; i++) { p.x = 200; p.y = 130; bystander.x = 240; bystander.y = 140; w.update(DT); }
    expect(c.dead).toBe(true);
    expect(p.red + p.soul).toBe(hp - 1);
    expect(bystander.hp).toBe(ehp);
    expect(under.dead).toBe(false);
    const last = w.spawn(new HuntCaltrop(150, 60, d.id));
    last.encounterId = d.id;
    w.update(DT);
    endEncounter(w, d, false);
    expect(last.dead).toBe(true);
  });

  it('a crowded weasel telegraphs its flare and the ember ring comes only after the wind-up', () => {
    const { w, d } = setup();
    begin(w, d);
    const e = untilHittable(w, d);
    let tele = -1;
    let shot = -1;
    let warned = false;
    for (let i = 0; i < 600 && shot < 0; i++) {
      clearMinions(w);
      w.player.x = e.x - 28;
      w.player.y = e.y;
      w.update(DT);
      if (tele < 0 && e.mem.state === ST.flare) {
        tele = w.time;
        warned = w.entities.some((x) => x instanceof GroundWarning && Math.hypot(x.x - e.x, x.y - e.y) < 2);
      }
      if (tele >= 0 && w.projectiles.some((q) => q.team === 'enemy' && (q as Projectile).owner === e)) shot = w.time;
    }
    expect(tele).toBeGreaterThan(0);
    expect(warned).toBe(true);
    expect(shot - tele).toBeGreaterThanOrEqual(0.55 - DT - 1e-9);
    expect(w.projectiles.filter((q) => q.team === 'enemy' && (q as Projectile).owner === e).length).toBe(8);
  });
});

describe('presentation', () => {
  it('shows its card before the start only, and drawing never changes the simulation', async () => {
    const { buildCard } = await import('../src/ui/item-tooltip');
    const { w, d } = setup();
    expect(buildCard(w, d)?.desc).toBeTruthy();
    expect(buildCard(w, d)?.name).toBe('등불 도둑 사냥 · 보통');
    const drawAll = () => {
      const h = stateHash(w);
      for (const e of w.entities) { e.draw(w.renderer, w); e.light(w); }
      expect(stateHash(w)).toBe(h);
    };
    drawAll();
    begin(w, d);
    expect(d.previewable()).toBe(false);
    expect(buildCard(w, d)).toBeNull();
    step(w, 30);
    drawAll();
    knock(w, d);
    w.update(DT);
    drawAll();
    step(w, 40);
    drawAll();
    d.mem.nextEscape = d.mem.clock;
    for (let i = 0; i < 60 * 20 && d.mem.escState !== 2; i++) { park(w); clearMinions(w); w.update(DT); if (i === 5) drawAll(); }
    drawAll();
    // the draw 40 steps after the knockdown happened mid-tumble
    expect(DOWN_TIME).toBeGreaterThan(40 * DT);
  });
});

describe('co-op lockstep', () => {
  /** Scripted, state-only actions every peer applies alike: hits through applyHit, keepers onto landed embers. */
  function hunter(n: number) {
    return (w: World, tick: number) => {
      if (tick === 5) {
        const node = w.map.nodes.find((x) => x.id !== w.map.startId && x.cw === 1 && x.ch === 1 && x.kind === 'normal')!;
        node.kind = 'hunt';
        node.templateId = 'hunt_den';
        node.visited = false;
        node.cleared = false;
        w.enterRoom(node, null);
      }
      if (tick < 6 || w.node.kind !== 'hunt') return;
      const d = w.entities.find((e) => e instanceof HuntDevice) as HuntDevice;
      for (const p of w.players) p.god = true;
      if (tick === 6) { w.players[0].x = d.x - 18; w.players[0].y = d.y + 8; w.asPlayer(w.players[0], () => d.interact(w)); }
      if (d.mem.used) {
        // stay with the rewards (the bots would wander out of the opened doors)
        w.players.forEach((p, i) => { p.x = d.x - 30 + i * 20; p.y = d.y + 50; });
        return;
      }
      if (tick % 120 === 0) for (const e of w.enemies) if (e.def.id !== WEASEL_ID) e.dead = true;
      const e = w.entityById(d.mem.weasel) as Enemy | undefined;
      if (e && e.vulnerable && tick % 15 === 0) {
        const p = w.players[(tick / 15) % w.players.length];
        w.applyHit(e, { damage: e.maxHp * 0.3, kind: 'projectile', attacker: p, dirX: 1, dirY: 0 });
      }
      const ems = w.entities.filter((x) => x instanceof HuntEmber && !x.dead && x.landed);
      ems.forEach((em, i) => { const p = w.players[i % n]; p.x = em.x; p.y = em.y; });
    };
  }

  it('stays in sync on a delayed, lossy two-keeper link', () => {
    const result = runCoop({ name: 'hunt-2p', seed: 'HUNT-COOP-2', chars: ['ria', 'bern'], ms: 20000, link: { latencyMs: 40, jitterMs: 15, drop: 0.05 }, bossAt: 0, downAt: 0, leaveAt: 0, discardAt: 0, stayInRoom: true, extraStep: hunter(2) });
    for (const peer of result.peers) expect(peer.desyncs).toEqual([]);
    const [a, b] = result.peers;
    let compared = 0;
    for (let i = 0; i < Math.min(a.hashes.length, b.hashes.length); i++) if (a.hashes[i] !== undefined && b.hashes[i] !== undefined) { expect(a.hashes[i]).toBe(b.hashes[i]); compared++; }
    expect(compared).toBeGreaterThan(600);
    const d = a.world.entities.find((e) => e instanceof HuntDevice) as HuntDevice;
    expect(d.mem.phase).toBeGreaterThan(0);
  }, 60000);

  it('four keepers finish the hunt with one free reward each and matching hashes', () => {
    const result = runCoop({ name: 'hunt-4p', seed: 'HUNT-COOP-4', chars: ['ria', 'bern', 'serin', 'bori'], ms: 40000, link: { latencyMs: 35, jitterMs: 15, drop: 0.03 }, bossAt: 0, downAt: 0, leaveAt: 0, discardAt: 0, stayInRoom: true, extraStep: hunter(4) });
    for (const peer of result.peers) {
      expect(peer.desyncs).toEqual([]);
      const d = peer.world.entities.find((e) => e instanceof HuntDevice) as HuntDevice;
      expect(d.mem.phase).toBe(4);
      const rewards = peer.world.entities.filter(isReward);
      expect(rewards).toHaveLength(4);
      expect(rewards.every((r) => r.mem.ownerSlot === undefined)).toBe(true);
    }
    const first = result.peers[0];
    for (const peer of result.peers.slice(1)) for (let i = 0; i < Math.min(first.hashes.length, peer.hashes.length); i++) if (first.hashes[i] !== undefined && peer.hashes[i] !== undefined) expect(first.hashes[i]).toBe(peer.hashes[i]);
  }, 120000);
});
