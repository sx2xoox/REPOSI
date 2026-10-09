// 등불 도둑 사냥 — regressions from the adversarial gameplay review: the minion wave budget
// (no endless farm in a stalled hunt), party-scaled ember coins, no walking out of the hunt
// through a key door, leaving mid-hunt never spills a free win, the thief's top speed stays
// under the hunters' (slow keepers), a time stop holds its escape channel, a full mission run
// hashes alike with different cosmetic RNG / drawing / quality, and co-op with a downed
// keeper or after the keeper who started it leaves.
import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { RNG, fx } from '../src/engine/rng';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Enemy } from '../src/game/enemy';
import { Pedestal, Pickup } from '../src/game/pickups';
import { stateHash } from '../src/game/statehash';
import { WeaponChest } from '../src/content/weapons/drops';
import { HuntDevice, HuntEmber, MAX_WAVES, claimCoins } from '../src/content/rooms/hunt';
import { HUNT_BAND, ST, WEASEL_ID, speedCap } from '../src/content/rooms/hunt-weasel';
import { encounterCount } from '../src/content/rooms/encounter-kit';
import { huntRun } from './hunt-bot';
import { runCoop } from './coopsim';
import type { RoomNode } from '../src/game/dungeon';
import type { Entity } from '../src/game/entity';

loadContent();
const DT = 1 / 60;

function world(players: number, seed: string, floor = 1, character = 'ria'): World {
  const run = new RunState(seed, character);
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  if (players === 1) w.start();
  else w.startParty(Array.from({ length: players }, (_, slot) => ({ slot, characterId: character, name: 'P' + slot })), 0);
  if (floor > 1) w.startFloor(floor);
  return w;
}
function huntNode(w: World, pick: (n: RoomNode) => boolean = () => true): RoomNode {
  const n = w.map.nodes.find((x) => x.id !== w.map.startId && x.cw === 1 && x.ch === 1 && x.kind === 'normal' && pick(x))!;
  n.kind = 'hunt';
  n.templateId = 'hunt_den';
  n.visited = false;
  n.cleared = false;
  return n;
}
function enter(w: World, n: RoomNode): HuntDevice {
  w.enterRoom(n, null);
  for (const p of w.players) p.god = true;
  return w.entities.find((e) => e instanceof HuntDevice) as HuntDevice;
}
function begin(w: World, d: HuntDevice): boolean {
  w.player.x = d.x - 18;
  w.player.y = d.y + 8;
  return d.interact(w);
}
const park = (w: World) => { for (const p of w.players) { p.x = 48; p.y = 156; } };
const isReward = (e: Entity) => !e.dead && (e instanceof WeaponChest || (e instanceof Pedestal && e.item?.kind === 'artifact'));
const landed = (w: World) => w.entities.filter((e) => e instanceof HuntEmber && !e.dead && e.landed) as HuntEmber[];

describe('hunt review: no endless farm', () => {
  it('a stalled hunt (cornered, nothing claimed) stops sending minions after the wave budget', () => {
    const w = world(1, 'HUNT-FARM');
    const d = enter(w, huntNode(w));
    begin(w, d);
    d.mem.sealed = 7;
    d.mem.cornered = 1;
    const seen = new Set<number>();
    let lastNew = 0;
    for (let i = 0; i < 60 * 300; i++) {
      park(w);
      // the keepers keep killing whatever comes (a farm), and keep tumbling the thief
      for (const e of w.enemies) if (e.alive && e.def.id !== WEASEL_ID) { if (!seen.has(e.id)) lastNew = d.mem.clock; seen.add(e.id); e.dead = true; }
      const t = w.entityById(d.mem.weasel) as Enemy | undefined;
      if (t && t.vulnerable && i % 240 === 0) w.applyHit(t, { damage: 1e7, kind: 'projectile', attacker: w.player });
      w.update(DT);
    }
    expect(d.mem.phase).toBe(1);
    expect(d.mem.waves).toBe(MAX_WAVES);
    // every wave is at most the band's base x party count
    expect(seen.size).toBeLessThanOrEqual(MAX_WAVES * Math.ceil(HUNT_BAND.wave[0] * encounterCount(1)));
    expect(lastNew).toBeLessThan(200);
  }, 60000);

  it('a normal-length hunt never reaches the wave budget', () => {
    for (const [floor, weapon] of [[1, 'lantern_bolt'], [4, 'iron_spear'], [7, 'void_gaze']] as const) {
      let waves = 0;
      const r = huntRun(floor, weapon, `HUNT-BUDGET-${floor}`, { 1: 1, 4: 3.6 / 1.3, 7: 7.7 / 1.3 }[floor], 70, true, {
        onStep: (ww) => { const dd = ww.entities.find((e) => e instanceof HuntDevice) as HuntDevice | undefined; if (dd) waves = dd.mem.waves; },
      });
      expect(r.time).toBeGreaterThan(5);
      expect(waves).toBeLessThan(MAX_WAVES);
    }
  }, 120000);
});

describe('hunt review: ember coins scale with the party', () => {
  for (const players of [1, 4]) it(`${players} keeper(s): ${claimCoins((1 << players) - 1)} coins per claimed ember`, () => {
    const w = world(players, `HUNT-COINS-${players}`);
    const d = enter(w, huntNode(w));
    begin(w, d);
    expect(claimCoins(d.mem.members)).toBe(2 + (players - 1));
    let e = w.entityById(d.mem.weasel) as Enemy;
    for (let i = 0; i < 300 && !(e.vulnerable && e.mem.state === ST.flee); i++) { park(w); w.update(DT); }
    w.applyHit(e, { damage: 1e7, kind: 'projectile', attacker: w.player });
    park(w);
    for (let i = 0; i < 60 && !landed(w).length; i++) w.update(DT);
    const em = landed(w)[0];
    w.players[0].x = em.x;
    w.players[0].y = em.y;
    w.update(DT);
    expect(d.mem.progress).toBe(1);
    const coins = w.entities.filter((x) => x instanceof Pickup && x.kind === 'coin' && x.encounterId === d.id && !x.dead);
    expect(coins).toHaveLength(2 + (players - 1));
    e = w.entityById(d.mem.weasel) as Enemy;
    expect(e).toBeTruthy();
  });
});

describe('hunt review: no way out mid-hunt', () => {
  /** A hunt room next to a key door (treasure / shop rooms are locked from floor 2). */
  function lockedSetup() {
    const w = world(1, 'HUNT-LOCKED');
    const n = huntNode(w, (x) => x.doors.filter((q) => !q.secret).length >= 2);
    const nb = w.map.nodes[n.doors.find((q) => !q.secret)!.to];
    nb.locked = true;
    const d = enter(w, n);
    const door = w.room.doors.find((x) => x.to === nb.id)!;
    expect(door.state).toBe('locked');
    return { w, n, d, door };
  }
  function pushInto(w: World, door: { x: number; y: number; dir: string }, frames: number, from: number) {
    const v = ({ N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] } as Record<string, number[]>)[door.dir];
    for (let i = 0; i < frames && w.node.id === from; i++) {
      for (const e of w.enemies) if (e.def.id !== WEASEL_ID) e.dead = true;
      w.player.x = door.x - v[0] * 6 + v[0] * Math.min(12, i * 0.3);
      w.player.y = door.y - v[1] * 6 + v[1] * Math.min(12, i * 0.3);
      w.update(DT);
    }
  }

  it('a key door stays locked (key kept) while the hunt holds the doors, and opens with the key afterwards', () => {
    const { w, n, d, door } = lockedSetup();
    begin(w, d);
    for (let i = 0; i < 60; i++) w.update(DT);
    w.player.purse.keys = 1;
    pushInto(w, door, 240, n.id);
    expect(w.node.id).toBe(n.id);
    expect(door.state).toBe('locked');
    expect(w.player.keys).toBe(1);
    expect(d.mem.phase).toBe(1);
    // the hunt ends: now the key works as usual
    d.mem.sealed = 0;
    d.mem.nextEscape = d.mem.clock;
    for (let i = 0; i < 60 * 40 && !d.mem.used; i++) { park(w); for (const e of w.enemies) if (e.def.id !== WEASEL_ID) e.dead = true; w.update(DT); }
    expect(d.mem.phase).toBe(5);
    pushInto(w, door, 240, n.id);
    expect(w.player.keys).toBe(0);
    expect(w.node.id).not.toBe(n.id);
  }, 60000);

  it('coming back after the room was left mid-hunt fails it: no spilled embers, no reward, coins kept', () => {
    const w = world(1, 'HUNT-LEFT');
    const n = huntNode(w);
    const d = enter(w, n);
    begin(w, d);
    for (let i = 0; i < 120; i++) { park(w); w.update(DT); }
    expect(d.mem.held).toBe(3);
    // (only debug / co-op teleports can leave a hunt now, but a leave must never pay)
    const other = w.map.nodes.find((x) => x.id === w.map.startId)!;
    w.teleportTo(other);
    for (let i = 0; i < 40; i++) w.update(DT);
    w.teleportTo(n);
    w.update(DT);
    expect(d.mem.used).toBe(true);
    expect(d.mem.phase).toBe(5);
    expect(w.node.cleared).toBe(true);
    for (let i = 0; i < 30; i++) w.update(DT);
    expect(landed(w)).toHaveLength(0);
    expect(w.entities.some(isReward)).toBe(false);
    expect(w.room.doors.every((x) => x.state !== 'closed')).toBe(true);
    expect(d.previewable()).toBe(false);
  });
});

describe('hunt review: a slow keeper can run the thief down', () => {
  it('its top speed stays under the quickest hunter\'s move speed (88 at the usual 92)', () => {
    const w = world(2, 'HUNT-SPEEDCAP');
    const [a, b] = w.players;
    a.stats.moveSpeed = 80;
    b.stats.moveSpeed = 80;
    expect(speedCap([a, b])).toBe(76);
    b.stats.moveSpeed = 106;
    expect(speedCap([a, b])).toBe(88);
    expect(speedCap([])).toBe(88);
  });

  it('bori (80 px/s) on floor 7: an emptied thief never outruns her on foot', () => {
    const w = world(1, 'HUNT-BORI', 7, 'bori');
    const d = enter(w, huntNode(w));
    const p = w.player;
    expect(p.stats.moveSpeed).toBeLessThan(88);
    begin(w, d);
    const e = w.entityById(d.mem.weasel) as Enemy;
    for (let i = 0; i < 120; i++) w.update(DT);
    d.mem.held = 0;
    let top = 0;
    for (let i = 0; i < 60 * 12; i++) {
      for (const m of w.enemies) if (m.def.id !== WEASEL_ID) m.dead = true;
      // a hunter right behind it (inside 120 px: full flee speed), never close enough to flare
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      p.x = e.x + Math.cos(a) * 60;
      p.y = e.y + Math.sin(a) * 60;
      w.update(DT);
      const st = e.mem.state;
      if (e.script.done && e.z === 0 && (st === ST.flee || st === ST.race || st === ST.escape)) top = Math.max(top, Math.hypot(e.vx, e.vy));
    }
    expect(top).toBeGreaterThan(40);
    expect(top).toBeLessThanOrEqual(p.stats.moveSpeed - 4 + 1e-6);
  });
});

describe('hunt review: time stop holds the squeeze', () => {
  it('a keeper\'s time stop (enemy time scale) pauses the thief\'s channel instead of letting it slip away meanwhile', () => {
    const w = world(1, 'HUNT-TIMESTOP');
    const d = enter(w, huntNode(w));
    begin(w, d);
    const e = w.entityById(d.mem.weasel) as Enemy;
    for (let i = 0; i < 300 && !(e.vulnerable && e.mem.state === ST.flee); i++) { park(w); w.update(DT); }
    d.mem.nextEscape = d.mem.clock;
    for (let i = 0; i < 60 * 20 && d.mem.escState !== 2; i++) { park(w); for (const m of w.enemies) if (m.def.id !== WEASEL_ID) m.dead = true; w.update(DT); }
    expect(d.mem.escState).toBe(2);
    // a time stop for 4 s (longer than any channel)
    w.enemyTimeScale = 0.04;
    for (let i = 0; i < 60 * 4; i++) { park(w); w.update(DT); }
    expect(d.mem.used).toBe(false);
    expect(d.mem.escState).toBe(2);
    expect(d.mem.chanT).toBeLessThan(0.2);
    w.enemyTimeScale = 1;
    for (let i = 0; i < 60 * 4 && !d.mem.used; i++) { park(w); w.update(DT); }
    expect(d.mem.phase).toBe(5);
  });
});

describe('hunt review: determinism of a whole mission', () => {
  it('same seed, different cosmetic RNG / drawing / lighting: identical state hashes every step', () => {
    for (const [floor, weapon] of [[1, 'lantern_bolt'], [4, 'hunter_bow'], [7, 'iron_spear']] as const) {
      const power = { 1: 1, 4: 3.6 / 1.3, 7: 7.7 / 1.3 }[floor];
      fx.setState(new RNG(1).getState());
      const a: number[] = [];
      const ra = huntRun(floor, weapon, `HUNT-DET-${floor}`, power, 70, false, { onStep: (w) => a.push(stateHash(w)) });
      fx.setState(new RNG(0x9e3779b9).getState());
      const b: number[] = [];
      const rb = huntRun(floor, weapon, `HUNT-DET-${floor}`, power, 70, false, {
        full: true,
        onStep: (w, i) => {
          if (i % 2 === 0) w.draw(0.37);
          b.push(stateHash(w));
        },
      });
      expect(rb.success).toBe(ra.success);
      expect(b.length).toBe(a.length);
      let first = -1;
      for (let i = 0; i < a.length && first < 0; i++) if (a[i] !== b[i]) first = i;
      expect(first).toBe(-1);
      expect(a.length).toBeGreaterThan(300);
    }
  }, 120000);
});

describe('hunt review: co-op', () => {
  it('a downed keeper cannot claim embers; the standing one finishes the hunt', () => {
    const w = world(2, 'HUNT-DOWNED');
    const d = enter(w, huntNode(w));
    begin(w, d);
    const [p0, p1] = w.players;
    // apart, so the standing keeper does not revive the downed one
    const apart = () => { p0.x = 48; p0.y = 156; p1.x = 288; p1.y = 156; p1.downed = true; };
    const e = w.entityById(d.mem.weasel) as Enemy;
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 400 && !(e.vulnerable && e.script.done && (e.mem.state === ST.flee || e.mem.state === ST.race)); i++) { apart(); for (const m of w.enemies) if (m.def.id !== WEASEL_ID) m.dead = true; w.update(DT); }
      w.applyHit(e, { damage: 1e7, kind: 'projectile', attacker: p0 });
      for (let i = 0; i < 60 && !landed(w).length; i++) { apart(); w.update(DT); }
      apart();
      const em = landed(w)[0];
      p1.x = em.x;
      p1.y = em.y;
      w.update(DT);
      expect(d.mem.progress).toBe(k);
      expect(em.dead).toBe(false);
      p0.x = em.x;
      p0.y = em.y;
      w.update(DT);
      expect(d.mem.progress).toBe(k + 1);
      apart();
    }
    expect(d.mem.phase).toBe(4);
    w.update(DT);
    // rewards still go to both members (the downed one can be revived)
    expect(w.entities.filter(isReward)).toHaveLength(2);
  });


  it('the keeper who started the hunt leaves; the rest finish it in sync and get the members\' rewards', () => {
    const rewards = new Map<World, number>();
    const result = runCoop({
      name: 'hunt-leave', seed: 'HUNT-LEAVE', chars: ['ria', 'bern', 'serin'], ms: 30000, link: { latencyMs: 30, jitterMs: 10, drop: 0.02 },
      bossAt: 0, downAt: 0, leaveAt: 0, discardAt: 0, stayInRoom: true,
      extraStep: (w, tick) => {
        if (tick === 5) w.enterRoom(huntNode(w), null);
        if (tick < 6 || w.node.kind !== 'hunt') return;
        const d = w.entities.find((e) => e instanceof HuntDevice) as HuntDevice;
        for (const p of w.players) p.god = true;
        if (tick === 6) w.asPlayer(w.players[0], () => begin(w, d));
        if (tick === 200 && w.players.length > 2) w.removePlayer(w.players[0].slot);
        if (d.mem.used) {
          // (counted when it ends: the session bots may open a chest afterwards)
          if (!rewards.has(w)) rewards.set(w, w.entities.filter(isReward).length);
          w.players.forEach((p, i) => { p.x = d.x - 30 + i * 20; p.y = d.y + 50; });
          return;
        }
        if (tick % 120 === 0) for (const e of w.enemies) if (e.def.id !== WEASEL_ID) e.dead = true;
        const e = w.entityById(d.mem.weasel) as Enemy | undefined;
        if (e && e.vulnerable && tick % 15 === 0) w.applyHit(e, { damage: e.maxHp * 0.3, kind: 'projectile', attacker: w.players[(tick / 15) % w.players.length], dirX: 1, dirY: 0 });
        landed(w).forEach((em, i) => { const p = w.players[i % w.players.length]; p.x = em.x; p.y = em.y; });
      },
    });
    const first = result.peers[0];
    for (const peer of result.peers) {
      expect(peer.desyncs).toEqual([]);
      const d = peer.world.entities.find((e) => e instanceof HuntDevice) as HuntDevice;
      expect(peer.world.players).toHaveLength(2);
      expect(d.mem.phase).toBe(4);
      // rewards follow the members at the start (as every mission does)
      expect(rewards.get(peer.world)).toBe(3);
      for (let i = 0; i < Math.min(first.hashes.length, peer.hashes.length); i++) if (first.hashes[i] !== undefined && peer.hashes[i] !== undefined) expect(peer.hashes[i]).toBe(first.hashes[i]);
    }
  }, 120000);
});
