// 32-bit hash of the gameplay state of a World, for lockstep desync detection
// (peers exchange it every N ticks) and the determinism tests.
//
// Covers: rng streams, floor / room / tiles / doors / map progress, every
// non-cosmetic entity (type, id, position, velocity, hp, statuses, script
// progress, numeric scratch memory), the keeper (hearts, ember, pickups, items,
// weapons, active, stats, timers), item buffs, world timers, flags and vars.
// Floats are hashed by their exact IEEE-754 bits, so even a one-ulp drift
// changes the hash. Purely visual state (particles, lights, camera, cosmetic
// entities, UI banners) is left out on purpose: it may legitimately differ.
// Co-op: every keeper is covered in slot order (never "the local one": the hash
// must not depend on which peer computes it), plus the co-op state (downed,
// revive progress, enemy targets); a single-player world hashes exactly as before.

import type { World } from './world';
import type { Room } from './room';
import { Entity, Actor } from './entity';
import { Enemy } from './enemy';
import { Player } from './player';
import { Projectile } from './projectile';
import { Bomb, Chest, Pedestal, Pickup } from './pickups';
import type { RNG } from '../engine/rng';
import type { WeaponState } from './defs';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** Incremental 32-bit hash over words (murmur3-style mixing). */
export class StateHasher {
  h = 0x811c9dc5 | 0;

  word(w: number): this {
    let k = Math.imul(w | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    let h = this.h ^ k;
    h = (h << 13) | (h >>> 19);
    this.h = (Math.imul(h, 5) + 0xe6546b64) | 0;
    return this;
  }

  /** a double, by its exact bits (NaN / undefined hash as NaN) */
  num(x: number | undefined): this {
    f64[0] = x as number;
    return this.word(u32[0]).word(u32[1]);
  }

  int(n: number): this {
    return this.word(n | 0);
  }

  bool(b: unknown): this {
    return this.word(b ? 1 : 2);
  }

  str(s: string | null | undefined): this {
    if (s == null) return this.word(-1);
    this.word(s.length);
    for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i));
    return this;
  }

  rng(r: RNG): this {
    for (const v of r.getState()) this.word(v);
    return this;
  }

  /** numeric / boolean / string values of a scratch-memory object, in key order */
  mem(m: Record<string, unknown> | undefined): this {
    if (!m) return this.word(0);
    for (const k in m) {
      const v = m[k];
      const t = typeof v;
      if (t === 'number') this.str(k).num(v as number);
      else if (t === 'boolean') this.str(k).bool(v);
      else if (t === 'string') this.str(k).str(v as string);
    }
    return this.word(0x5eed);
  }

  /** final avalanche */
  digest(): number {
    let h = this.h;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
}

/** Private World timers that steer the simulation (hit-stop, slow motion, death, room-clear moment). */
interface WorldPrivates {
  hitstopT: number;
  hitstopGap: number;
  slowmoT: number;
  deathT: number;
  clearMomentT: number;
  pending: Entity[];
  roomCache: Map<number, { room: Room; entities: Entity[] }>;
}

/** Hash the gameplay state of `w` (see the file comment for what is covered). */
export function stateHash(w: World): number {
  const h = new StateHasher();
  hashWorld(h, w);
  return h.digest();
}

/** Per-part hashes, to locate a desync (which part diverged first). */
export function stateHashParts(w: World): Record<string, number> {
  const out: Record<string, number> = {};
  const part = (name: string, fn: (h: StateHasher) => void) => {
    const h = new StateHasher();
    fn(h);
    out[name] = h.digest();
  };
  part('run', (h) => hashRun(h, w));
  part('world', (h) => hashWorldScalars(h, w));
  part('room', (h) => hashRoom(h, w));
  part('player', (h) => {
    for (const p of keepers(w)) hashPlayer(h, p, w.coop);
  });
  part('entities', (h) => hashEntities(h, w));
  return out;
}

function hashWorld(h: StateHasher, w: World): void {
  hashRun(h, w);
  hashWorldScalars(h, w);
  hashRoom(h, w);
  for (const p of keepers(w)) hashPlayer(h, p, w.coop);
  hashEntities(h, w);
}

/** The keepers to hash: everyone (slot order) in co-op, else the world's keeper. */
function keepers(w: World): Player[] {
  if (w.coop) return w.players;
  return w.player ? [w.player] : [];
}

function hashRun(h: StateHasher, w: World): void {
  const r = w.run;
  // co-op: run.characterId is each peer's own pick; the party roster is what they share
  h.str(r.seed).str(w.coop ? w.players.map((p) => `${p.slot}:${p.character.id}`).join(',') : r.characterId).int(r.floor).rng(r.rng).rng(r.lootRng);
  const s = r.stats;
  h.int(s.kills).num(s.timeSec).num(s.damageTaken).num(s.damageDealt).int(s.roomsCleared).int(s.itemsTaken);
  h.int(s.coinsCollected).int(s.coinsSpent).int(s.activesUsed).int(s.bossesKilled).int(s.secretsFound).int(s.releases);
  for (const id of r.identified) h.str(id);
  h.word(-2);
  for (const id of r.seenOnPedestal) h.str(id);
  h.word(-3);
  for (const id of r.obtained) h.str(id);
  h.word(-11).bool(r.won).str(r.lastDamageSource);
}

function hashWorldScalars(h: StateHasher, w: World): void {
  const pv = w as unknown as WorldPrivates;
  h.num(w.time).num(w.roomTime).num(w.dt).bool(w.transitioning).bool(w.paused);
  h.num(pv.hitstopT).num(pv.hitstopGap).num(w.slowmo).num(pv.slowmoT).num(w.enemyTimeScale).int(w.holdClear);
  h.num(pv.deathT).num(pv.clearMomentT).bool(w.gameOver).bool(w.gameOver?.won);
  const d = w.descending;
  if (d) h.num(d.x).num(d.y).num(d.t);
  else h.word(0);
  for (const f of w.flags) h.str(f);
  h.word(-4);
  // per keeper: hook scratch state and buffs (temporary item effects)
  for (const p of keepers(w)) {
    for (const k in p.vars) h.str(k).num(p.vars[k]);
    h.word(-5);
    for (const b of p.items.buffs) h.str(b.key).num(b.time).str(b.until ?? '');
    h.word(-6);
  }
}

function hashRoom(h: StateHasher, w: World): void {
  if (!w.map || !w.node || !w.room) return;
  h.int(w.floor.index).int(w.node.id).int(w.map.nodes.length);
  for (const n of w.map.nodes) {
    h.int(n.id).bool(n.visited).bool(n.discovered).bool(n.cleared).bool(n.locked);
    for (const d of n.doors) h.bool((d as { revealed?: boolean }).revealed);
  }
  hashTiles(h, w.room);
  // rooms visited earlier on this floor: their tiles and the entities left there
  const cache = (w as unknown as WorldPrivates).roomCache;
  if (cache) {
    for (const [id, c] of cache) {
      if (c.room === w.room) continue;
      h.int(id);
      hashTiles(h, c.room);
      for (const e of c.entities) if (!(e.constructor as typeof Entity).cosmetic) hashEntity(h, e, w.coop);
      h.word(-12);
    }
  }
}

function hashTiles(h: StateHasher, room: Room): void {
  h.int(room.w).int(room.h).int(room.version);
  const t = room.tiles;
  for (let i = 0; i < t.length; i += 4) h.word(t[i] | (t[i + 1] << 8) | (t[i + 2] << 16) | (t[i + 3] << 24));
  const hp = room.tileHp;
  for (let i = 0; i < hp.length; i++) if (hp[i] !== 0) h.int(i).num(hp[i]);
  for (const d of room.doors) h.str(d.state).num(d.open).int(d.to);
}

function hashWeapon(h: StateHasher, id: string | null, st: WeaponState): void {
  h.str(id).num(st.cooldown).num(st.charge).num(st.combo).num(st.comboTimer).num(st.sinceAttack).mem(st.mem as Record<string, unknown>);
}

function hashPlayer(h: StateHasher, p: Player, coop = false): void {
  hashActor(h, p);
  if (coop) h.int(p.slot).bool(p.downed).num(p.reviveT);
  h.num(p.red).num(p.soul).num(p.shields).num(p.baseHearts).num(p.ember).num(p.releaseT);
  h.int(p.coins).int(p.bombs).int(p.keys);
  h.num(p.aim).bool(p.firing).str(p.facing).bool(p.moving).num(p.dashT).num(p.dashCD).num(p.dashDX).num(p.dashDY).num(p.dashX0).num(p.dashY0);
  h.num((p as unknown as { dashBuffer: number }).dashBuffer).num(p.holdT).bool(p.frozen).num(p.fall).bool(p.god);
  h.num(p.spikeCD).num(p.lastAttackAt).num(p.swapAt);
  hashWeapon(h, p.weaponId, p.weapon);
  hashWeapon(h, p.weapon2Id, p.weapon2);
  h.str(p.activeId).num(p.activeCharge).str(p.potionId);
  for (const it of p.inv.items) h.str(it.id);
  h.word(-7);
  for (const f of p.flags) h.str(f);
  h.word(-8);
  const s = p.stats as unknown as Record<string, unknown>;
  for (const k in s) if (typeof s[k] === 'number') h.str(k).num(s[k] as number);
}

function hashActor(h: StateHasher, a: Actor): void {
  h.int(a.id).num(a.x).num(a.y).num(a.z).num(a.vx).num(a.vy).num(a.vz).num(a.r).bool(a.dead).num(a.age);
  h.num(a.hp).num(a.maxHp).num(a.kbx).num(a.kby).num(a.invuln).num(a.lastHurtAt);
  for (const [k, s] of a.statuses) h.str(k).num(s.time).num(s.power).num(s.tick).int(s.stacks);
  h.word(-9);
}

function hashEntity(h: StateHasher, e: Entity, coop = false): void {
  if (e instanceof Player) return; // hashed by hashPlayer (it is also in the list: mark its slot)
  if (coop) {
    h.int(e.ctxP instanceof Player ? e.ctxP.slot : -1);
    const owner = (e as { owner?: unknown }).owner;
    h.int(owner instanceof Player ? owner.slot : -1);
  }
  if (e instanceof Enemy) {
    h.str(e.def.id);
    hashActor(h, e);
    if (coop) h.int(e.tgt ? e.tgt.slot : -1).int(e.lastHitBy ? e.lastHitBy.slot : -1);
    h.num(e.script.steps).num(e.script.waiting).bool(e.script.done).num(e.dormant).num(e.telegraphT).int(e.phase);
    h.bool(e.hidden).bool(e.vulnerable).bool(e.harmful).bool(e.champion).bool(e.isMinion).num(e.speed);
    h.num(e.wantVX).num(e.wantVY).num(e.accel).int(e.facing).str(e.anim).num(e.contactDamage).num(e.mass);
    h.mem(e.mem);
    return;
  }
  if (e instanceof Actor) {
    h.str(e.constructor.name);
    hashActor(h, e);
    return;
  }
  h.str(e.constructor.name).int(e.id).num(e.x).num(e.y).num(e.z).num(e.vx).num(e.vy).num(e.vz).num(e.r).bool(e.dead).num(e.age);
  if (e instanceof Projectile) {
    h.str(e.team).num(e.angle).num(e.speed).num(e.damage).num(e.traveled).num(e.life).int(e.pierce).int(e.bounce);
    h.num(e.homing).num(e.delay).num(e.curve).int(e.generation).int(e.hitIds.size).int(e.behaviors.length).mem(e.mem);
  } else if (e instanceof Pickup) {
    h.str(e.kind).int(e.price).str(e.potionId).num(e.grace).bool(e.waitForLeave);
  } else if (e instanceof Pedestal) {
    h.str(e.item?.kind).str(e.item?.id).int(e.price).int(e.heartPrice).int(e.group).bool(e.waitForLeave);
  } else if (e instanceof Chest) {
    h.bool(e.locked).bool(e.opened);
  } else if (e instanceof Bomb) {
    h.num(e.fuse).num(e.damage).num(e.radius).str(e.owner);
  }
  const m = (e as unknown as { mem?: Record<string, unknown> }).mem;
  if (m && !(e instanceof Projectile)) h.mem(m);
}

function hashEntities(h: StateHasher, w: World): void {
  const pending = (w as unknown as WorldPrivates).pending ?? [];
  let n = 0;
  for (const list of [w.entities, pending]) {
    for (const e of list) {
      if ((e.constructor as typeof Entity).cosmetic) continue;
      if (w.coop ? e instanceof Player : e === w.player) h.word(0x91a7e5 + (w.coop ? (e as Player).slot : 0));
      else hashEntity(h, e, w.coop);
      n++;
    }
    h.word(-10);
  }
  h.int(n);
}
