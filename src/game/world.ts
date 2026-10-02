// World: simulation of one run — the current floor, room, entities and the
// player. Exposes the API used by all content (enemies, items, rooms).

import type { Renderer } from '../engine/renderer';
import { VIEW_H, VIEW_W } from '../engine/renderer';
import { Lighting } from '../engine/lighting';
import { Particles } from '../engine/particles';
import { RNG, fx } from '../engine/rng';
import { input } from '../engine/input';
import { clamp, damp, dist, dist2 } from '../engine/math';
import { save } from '../engine/save';
import { audio, sfx as playSfx, type SfxName, type SfxPlayOpts } from '../audio/audio';
import { TILE, WALL, CELL_W, CELL_H, DIR_VEC, type Dir } from './constants';
import { Characters, Enemies, Floors, RoomTemplates, Themes, Actives, Weapons, Potions, type FloorDef } from './defs';
import { generateFloor, matchingDoor, type FloorMap, type NodeDoor, type RoomNode } from './dungeon';
import { Room, type Door, type DoorKind } from './room';
import { Entity, Actor, type HitInfo, type StatusKind } from './entity';
import { Enemy } from './enemy';
import { Player, newWeaponState } from './player';
import { Projectile } from './projectile';
import { FlowField } from './flow';
import { ItemSystem, Loot } from './items';
import { RunState } from './run';
import { roomHandler } from './roomkinds';
import { FloatingText, RingFx } from './effects';
import { Bomb, Chest, FirePlace, Pedestal, Pickup, Trapdoor, itemInfo, type PedestalItem, type PickupKind } from './pickups';
import { Tile } from './tiles';

export interface Banner {
  title: string;
  desc: string;
  quote?: string;
  icon: string | null;
  color: string;
  t: number;
  small?: boolean;
}

export interface GameOverInfo {
  won: boolean;
  source: string;
}

export interface WorldHost {
  /** open the collection / status overlay */
  openInventory(): void;
  onGameOver(info: GameOverInfo): void;
}

interface RoomCacheEntry {
  room: Room;
  entities: Entity[];
}

interface Transition {
  snapshot: HTMLCanvasElement;
  dir: Dir | 'fade';
  t: number;
  dur: number;
}

export class World {
  readonly renderer: Renderer;
  readonly lights = new Lighting();
  readonly particles = new Particles();
  readonly run: RunState;
  readonly host: WorldHost;
  player!: Player;
  items: ItemSystem;
  loot: Loot;
  map!: FloorMap;
  floor!: FloorDef;
  room!: Room;
  node!: RoomNode;
  entities: Entity[] = [];
  private pending: Entity[] = [];
  /** per-frame caches */
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  hittables: Actor[] = [];
  flow = new FlowField();
  /** gameplay rng (shared with run) */
  get rng(): RNG {
    return this.run.rng;
  }

  time = 0;
  /** current (unscaled) simulation step */
  dt = 1 / 60;
  roomTime = 0;
  paused = false;
  private hitstopT = 0;
  /** enemies & enemy projectiles time scale (time-slow items) */
  enemyTimeScale = 1;
  /** global slow motion (boss death) */
  slowmo = 1;
  private slowmoT = 0;
  transitioning = false;
  private transition: Transition | null = null;
  private snapCanvas: HTMLCanvasElement;
  private roomCache = new Map<number, RoomCacheEntry>();
  /** prevents room clear while > 0 (scripted waves) */
  holdClear = 0;
  banners: Banner[] = [];
  floorCard: { name: string; subtitle: string; t: number } | null = null;
  bossIntro: { enemy: Enemy; t: number } | null = null;
  gameOver: GameOverInfo | null = null;
  private deathT = -1;
  /** camera target smoothing */
  private camInit = false;
  /** minimap / UI dirty counter */
  mapVersion = 0;
  /** free-form per-run flags for content (e.g. "devilDealTaken") */
  flags = new Set<string>();
  vars: Record<string, number> = {};

  constructor(renderer: Renderer, run: RunState, host: WorldHost) {
    this.renderer = renderer;
    this.run = run;
    this.host = host;
    this.items = new ItemSystem(this);
    this.loot = new Loot(this);
    this.snapCanvas = document.createElement('canvas');
    this.snapCanvas.width = VIEW_W;
    this.snapCanvas.height = VIEW_H;
    this.particles.density = save.settings.particles;
  }

  // ================================================================== setup
  /** Create the player and enter floor 1. */
  start(): void {
    const ch = Characters.must(this.run.characterId);
    const p = new Player(ch);
    this.player = p;
    p.red = ch.hearts * 2;
    p.soul = (ch.soulHearts ?? 0) * 2;
    p.coins = ch.coins ?? 0;
    p.bombs = ch.bombs ?? 1;
    p.keys = ch.keys ?? 0;
    this.items.recompute();
    for (const a of ch.artifacts ?? []) this.items.give(a);
    if (ch.active) {
      p.activeId = ch.active;
      p.activeCharge = Actives.get(ch.active)?.charge ?? 0;
    }
    for (const id of ch.artifacts ?? []) this.run.seenOnPedestal.add(id);
    this.items.recompute();
    p.red = p.maxRed;
    this.startFloor(1);
  }

  startFloor(index: number): void {
    this.run.floor = index;
    const floor = Floors.all().find((f) => f.index === index);
    if (!floor) throw new Error(`no floor ${index}`);
    this.floor = floor;
    this.map = generateFloor(floor, this.run.floorRng(index));
    this.roomCache.clear();
    this.mapVersion++;
    const start = this.map.nodes[this.map.startId];
    this.enterRoom(start, null);
    this.floorCard = { name: floor.name, subtitle: floor.subtitle, t: 0 };
    this.items.expire('floor');
    this.items.onFloorStart();
    audio.playMusic(floor.music);
    playSfx('floor_start');
    save.progress.bestFloor = Math.max(save.progress.bestFloor, index);
    save.saveProgress();
  }

  // ================================================================== rooms
  private buildRoom(node: RoomNode): Room {
    const theme = Themes.get(this.floor.theme) ?? Themes.all()[0];
    const template = RoomTemplates.get(node.templateId);
    const room = new Room(node, theme, template);
    for (const d of node.doors) {
      const target = this.map.nodes[d.to];
      const kind = doorKindFor(node, target);
      const hidden = d.secret && node.kind !== 'secret' && !(d as NodeDoor & { revealed?: boolean }).revealed;
      const door = room.addDoor(d.dir, d.cx - node.gx, d.cy - node.gy, d.to, kind, hidden);
      if (!hidden && target.locked) door.state = 'locked';
    }
    return room;
  }

  /** Enter `node`. `via` = the door (in the previous room) we walked through. */
  enterRoom(node: RoomNode, via: NodeDoor | null): void {
    // save the room we are leaving
    if (this.room) {
      const keep = this.entities.filter((e) => e.persistent && !e.dead);
      this.roomCache.set(this.node.id, { room: this.room, entities: keep });
      this.items.expire('room');
    }
    const prevNode = this.node;
    this.node = node;
    const cached = this.roomCache.get(node.id);
    let room: Room;
    const firstVisit = !cached;
    if (cached) {
      room = cached.room;
      this.entities = [...cached.entities];
    } else {
      room = this.buildRoom(node);
      this.entities = [];
    }
    this.room = room;
    this.pending = [];
    this.particles.clear();
    this.roomTime = 0;
    this.holdClear = 0;
    this.bossIntro = null;
    node.visited = true;
    node.discovered = true;
    for (const d of node.doors) {
      if (!d.secret || node.kind === 'secret' || (d as NodeDoor & { revealed?: boolean }).revealed) this.map.nodes[d.to].discovered = true;
    }
    this.mapVersion++;

    // place the player
    const p = this.player;
    if (via && prevNode) {
      const back = matchingDoor(this.map, prevNode, via);
      const door = back ? room.doors.find((d) => d.to === prevNode.id && d.dir === back.dir && sameCell(d, back, node, room)) : undefined;
      if (door) {
        const v = DIR_VEC[door.dir];
        p.x = door.x - v.x * 14;
        p.y = door.y - v.y * 14 + (door.dir === 'N' ? 2 : 0);
      } else {
        p.x = room.centerX;
        p.y = room.centerY;
      }
    } else {
      p.x = room.centerX;
      p.y = room.centerY + 20;
    }
    const free = room.nearestFree(p.x, p.y, p.r);
    p.x = free.x;
    p.y = free.y;
    p.vx = p.vy = p.kbx = p.kby = 0;
    p.dashT = 0;
    this.entities.push(p);

    const rng = new RNG(node.seed ^ 0xa5a5);
    const handler = roomHandler(node.kind);
    if (firstVisit) {
      room.theme.decorate?.(this, new RNG(node.seed ^ 0x77));
      handler?.populate?.(this, room, rng);
      this.spawnTemplateMarkers(room, rng);
    }
    let hostile = false;
    if (!node.cleared) {
      hostile = handler?.spawnEnemies ? handler.spawnEnemies(this, room, new RNG(node.seed ^ 0x1234)) : this.spawnRoomEnemies(room, new RNG(node.seed ^ 0x1234));
      this.flushPending();
      if (!hostile && (handler?.clearOnEnter ?? true)) {
        node.cleared = true;
      }
    }
    room.setDoorsClosed(!node.cleared && hostile);
    for (const d of room.doors) d.open = d.state === 'open' ? 1 : 0;
    handler?.onEnter?.(this, room);
    this.flushPending();
    this.camInit = false;
    this.items.onRoomEnter();
    this.updateCamera(1);
    // music: boss / shop
    if (node.kind === 'shop') audio.playMusic('shop');
    else if (node.kind === 'secret') audio.playMusic('secret');
    else if (node.kind !== 'boss' && audio.currentMusic !== this.floor.music && audio.currentMusic !== 'victory') audio.playMusic(this.floor.music);
    if (hostile) playSfx('door_close', { vol: 0.6 });
  }

  /** Spawn pickups / fireplaces etc. from template markers (enemies handled separately). */
  private spawnTemplateMarkers(room: Room, rng: RNG): void {
    for (const m of room.markers) {
      switch (m.ch) {
        case 'f': this.spawn(new FirePlace(m.x, m.y, rng.chance(0.08 * this.floor.index))); break;
        case 'c': this.spawn(new Pickup('coin', m.x, m.y)); break;
        case 'h': this.spawn(new Pickup('heart', m.x, m.y)); break;
        case 'k': this.spawn(new Pickup('key', m.x, m.y)); break;
        case 'b': this.spawn(new Pickup('bomb', m.x, m.y)); break;
      }
    }
  }

  /** Enemy pool for the current floor: id -> weight. */
  enemyPool(): Record<string, number> {
    if (this.floor.enemies) return this.floor.enemies;
    const out: Record<string, number> = {};
    for (const d of Enemies.all()) if (!d.boss && d.floors?.includes(this.floor.index)) out[d.id] = d.weight ?? 1;
    return out;
  }

  /** Default normal-room population from 'e' / 'E' markers + floor pool. */
  spawnRoomEnemies(room: Room, rng: RNG): boolean {
    const markers = room.markers.filter((m) => m.ch === 'e' || m.ch === 'E');
    const pool = Object.entries(this.enemyPool()).map(([id, w]) => ({ def: Enemies.get(id)!, w })).filter((x) => x.def);
    if (!pool.length || (!markers.length && room.node.kind !== 'normal')) return false;
    // choose 1-3 enemy types for this room (Isaac rooms are themed)
    const types: typeof pool = [];
    const nTypes = rng.int(1, Math.min(3, pool.length));
    for (let i = 0; i < nTypes; i++) {
      const pick = rng.weighted(pool.filter((p) => !types.includes(p)), (p) => p.w);
      if (pick) types.push(pick);
    }
    let budget = rng.range(this.floor.budget[0], this.floor.budget[1]) * (1 + room.node.cw * room.node.ch * 0.35 - 0.35);
    const spots = markers.length ? rng.shuffle([...markers]) : [];
    if (!spots.length) {
      const n = Math.max(2, Math.round(budget / 1.5));
      for (let i = 0; i < n; i++) {
        const pos = room.randomFreePos(rng, 8, { x: this.player.x, y: this.player.y, dist: 70 });
        spots.push({ ch: 'e', x: pos.x, y: pos.y });
      }
    }
    let spawned = 0;
    for (const s of spots) {
      if (budget <= 0 && spawned >= 2) break;
      const cands = s.ch === 'E' ? [...types].sort((a, b) => (b.def.cost ?? 1) - (a.def.cost ?? 1)).slice(0, 1) : types;
      const pick = rng.weighted(cands, (p) => p.w) ?? types[0];
      if (!pick) break;
      if (Math.hypot(s.x - this.player.x, s.y - this.player.y) < 40) continue;
      const e = this.spawnEnemy(pick.def.id, s.x, s.y);
      if (e && pick.def.champion !== false && rng.chance(this.floor.championChance)) makeChampion(e, rng);
      budget -= pick.def.cost ?? 1;
      spawned++;
    }
    return spawned > 0;
  }

  /** Spawn an enemy by id at (x,y) with floor HP scaling. */
  spawnEnemy(id: string, x: number, y: number): Enemy | null {
    const def = Enemies.get(id);
    if (!def) {
      console.warn(`[world] unknown enemy ${id}`);
      return null;
    }
    const e = new Enemy(def, x, y, this.floor.hpMult);
    if (!def.flying && !def.phasing) {
      const f = this.room.nearestFree(x, y, Math.min(def.radius, 7));
      e.x = f.x;
      e.y = f.y;
    }
    this.spawn(e);
    e.start(this);
    return e;
  }

  spawn<T extends Entity>(e: T): T {
    this.pending.push(e);
    return e;
  }

  private flushPending(): void {
    if (this.pending.length) {
      for (const e of this.pending) this.entities.push(e);
      this.pending.length = 0;
    }
  }

  // ================================================================== update
  update(dt: number): void {
    this.dt = dt;
    if (this.renderer) this.renderer.updateEffects(dt);
    this.updateUiTimers(dt);
    if (this.transition) {
      this.transition.t += dt;
      if (this.transition.t >= this.transition.dur) {
        this.transition = null;
        this.transitioning = false;
      }
      return;
    }
    if (this.paused) return;
    if (this.hitstopT > 0) {
      this.hitstopT -= dt;
      return;
    }
    if (this.slowmoT > 0) {
      this.slowmoT -= dt;
      if (this.slowmoT <= 0) this.slowmo = 1;
    }
    const sdt = dt * this.slowmo;
    this.dt = sdt;
    this.time += sdt;
    this.roomTime += sdt;
    this.run.stats.timeSec += dt;

    this.flushPending();
    this.rebuildCaches();
    this.flow.update(this.room, this.player.x, this.player.y);

    for (const e of this.entities) {
      if (e.dead) continue;
      if (e instanceof Projectile && e.team === 'enemy') e.update(this, sdt * this.enemyTimeScale);
      else e.update(this, sdt);
    }
    this.items.update(sdt);
    this.flushPending();
    this.rebuildCaches();
    this.collisions();

    // deaths
    for (const e of this.enemies) if (!e.dead && e.hp <= 0) this.killEnemy(e);
    for (const e of this.entities) if (e.dead) e.onRemove(this);
    this.entities = this.entities.filter((e) => !e.dead || e === this.player);

    this.particles.update(sdt);
    this.room.updateDoors(sdt);
    this.room.theme.ambientFx?.(this, sdt);
    this.checkDoors();
    this.checkClear();
    this.updateCamera(sdt);
    audio.setMusicIntensity(this.enemies.length > 0 ? 1 : 0);

    if (this.deathT >= 0) {
      this.deathT += dt;
      if (this.deathT > 1.6 && !this.gameOver) {
        this.gameOver = { won: false, source: this.run.lastDamageSource };
        this.host.onGameOver(this.gameOver);
      }
    }
  }

  private updateUiTimers(dt: number): void {
    for (const b of this.banners) b.t += dt;
    this.banners = this.banners.filter((b) => b.t < 3.2);
    if (this.floorCard) {
      this.floorCard.t += dt;
      if (this.floorCard.t > 3) this.floorCard = null;
    }
    if (this.bossIntro) {
      this.bossIntro.t += dt;
      if (this.bossIntro.t > 2.2) this.bossIntro = null;
    }
  }

  private rebuildCaches(): void {
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.hittables.length = 0;
    for (const e of this.entities) {
      if (e.dead) continue;
      if (e instanceof Enemy) this.enemies.push(e);
      else if (e instanceof Projectile) this.projectiles.push(e);
      else if (e instanceof Actor && e !== this.player && e.team === 'neutral') this.hittables.push(e);
    }
  }

  private collisions(): void {
    const p = this.player;
    // projectiles
    for (const pr of this.projectiles) {
      if (pr.dead || pr.delay > 0) continue;
      if (pr.team === 'player') {
        for (const e of this.enemies) {
          if (pr.dead) break;
          if (!e.alive || e.hidden || !e.vulnerable || pr.hitIds.has(e.id)) continue;
          if (e.z > 28 && !e.isBoss) continue;
          const rr = pr.r + e.r;
          if (dist2(pr.x, pr.y, e.x, e.y - e.z * 0.3) < rr * rr) pr.hitActor(this, e);
        }
        if (!pr.dead) {
          for (const h of this.hittables) {
            if (pr.hitIds.has(h.id)) continue;
            const rr = pr.r + h.r;
            if (dist2(pr.x, pr.y, h.x, h.y) < rr * rr) {
              if (h instanceof FirePlace && !h.lit) continue;
              pr.hitIds.add(h.id);
              h.takeHit(this, { damage: pr.damage, kind: 'projectile', attacker: p, source: pr });
              pr.expire(this, true);
              break;
            }
          }
        }
      } else if (pr.team === 'enemy') {
        if (!p.alive || p.z > 12) continue;
        const rr = pr.r + p.r - 1;
        if (dist2(pr.x, pr.y, p.x, p.y - 4) < rr * rr) {
          if (p.invuln > 0 && !p.dashing) continue;
          if (p.dashing) continue; // dodge through
          if (p.hurt(this, pr.damage, pr.owner instanceof Enemy ? pr.owner.def.name : '탄환')) {
            p.knock(Math.cos(pr.angle), Math.sin(pr.angle), 120);
          }
          pr.expire(this, true);
        }
      }
    }
    // enemy contact & separation
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (!e.alive || e.hidden) continue;
      if (e.harmful && e.dormant <= 0 && e.contactDamage > 0 && e.z < 10 && p.alive && !e.hasStatus('charm')) {
        const rr = e.r + p.r - 2;
        if (dist2(e.x, e.y, p.x, p.y) < rr * rr) {
          if (p.hurt(this, e.contactDamage, e.def.name)) {
            const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
            p.knock((p.x - e.x) / d, (p.y - e.y) / d, 160);
          }
        }
      }
      if (e.hasStatus('charm') && e.contactDamage > 0) {
        for (const o of es) {
          if (o === e || !o.alive || o.hasStatus('charm')) continue;
          const rr = e.r + o.r;
          if (dist2(e.x, e.y, o.x, o.y) < rr * rr && (e.mem.__charmHitT ?? 0) < this.time) {
            e.mem.__charmHitT = this.time + 0.5;
            this.applyHit(o, { damage: this.player.stats.damage, kind: 'contact', attacker: this.player, dirX: 0, dirY: 0 });
          }
        }
      }
      if (!e.solid || e.z > 4) continue;
      for (let j = i + 1; j < es.length; j++) {
        const o = es[j];
        if (!o.solid || !o.alive || o.hidden || o.z > 4) continue;
        const rr = e.r + o.r;
        const d2 = dist2(e.x, e.y, o.x, o.y);
        if (d2 < rr * rr && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (rr - d) * 0.5;
          const nx = (o.x - e.x) / d;
          const ny = (o.y - e.y) / d;
          const me = isFinite(e.mass) ? e.mass : 1e6;
          const mo = isFinite(o.mass) ? o.mass : 1e6;
          const ke = mo / (me + mo);
          const ko = me / (me + mo);
          if (!this.room.boxBlocked(e.x - nx * push * ke * 2, e.y - ny * push * ke * 2, e.r, e.flying, e.phasing)) {
            e.x -= nx * push * ke * 2;
            e.y -= ny * push * ke * 2;
          }
          if (!this.room.boxBlocked(o.x + nx * push * ko * 2, o.y + ny * push * ko * 2, o.r, o.flying, o.phasing)) {
            o.x += nx * push * ko * 2;
            o.y += ny * push * ko * 2;
          }
        }
      }
    }
  }

  // ================================================================== combat
  /**
   * Apply a hit to any actor. Player-caused hits on enemies go through crits,
   * item hooks, damage numbers and kill handling. Returns true if applied.
   */
  applyHit(target: Actor, hit: HitInfo): boolean {
    const p = this.player;
    const byPlayer = hit.attacker === p || (hit.source instanceof Projectile && hit.source.team === 'player');
    if (target instanceof Enemy && byPlayer) {
      if (!target.alive || !target.vulnerable || target.hidden) return false;
      hit.attacker = p;
      if (hit.kind !== 'status' && !hit.crit && this.rng.chance(p.stats.critChance)) hit.crit = true;
      if (target.hasStatus('mark') && hit.kind !== 'status') {
        hit.crit = true;
        target.statuses.delete('mark');
      }
      if (hit.crit) hit.damage *= p.stats.critMult;
      if (target.isBoss) hit.damage *= 1 + p.stats.bossDamage;
      if (hit.kind !== 'status') this.items.modifyHit(target, hit);
      const before = target.hp;
      const applied = target.takeHit(this, hit);
      if (!applied) return false;
      const dealt = Math.max(0, before - Math.max(0, target.hp));
      this.run.stats.damageDealt += dealt;
      if (hit.kind !== 'status' && !hit.noProc) p.addEmber(Math.min(6, 1.2 + dealt / Math.max(1, p.stats.damage) * 1.3) * (target.isBoss ? 0.6 : 1));
      this.hitFeedback(target, hit, dealt);
      this.items.onHit(target, hit);
      if (target.hp <= 0) this.killEnemy(target);
      return true;
    }
    if (target === p) return p.takeHit(this, hit);
    return target.takeHit(this, hit);
  }

  private hitFeedback(e: Enemy, hit: HitInfo, dealt: number): void {
    if (save.settings.damageNumbers && dealt > 0) {
      const big = hit.crit;
      const txt = `${Math.max(1, Math.round(dealt))}${big ? '!' : ''}`;
      const col = hit.kind === 'status' ? statusColor(hit) : big ? '#ffd23a' : '#ffffff';
      this.spawn(new FloatingText(e.x, e.y - e.r - 6 - e.z, txt, col, big ? 2 : 1, big ? 0.9 : 0.6)).layer = 3;
    }
    if (hit.kind === 'status') return;
    const blood = e.def.bloodColor ?? '#b8202c';
    const ang = Math.atan2(hit.dirY ?? 0, hit.dirX ?? 1);
    this.particles.burst(e.x, e.y - e.z - 3, {
      count: hit.crit ? 10 : 5, speed: [40, 120], angle: ang, spread: 1.4, life: [0.2, 0.45],
      colors: ['#ffffff', blood, blood], size: [1, 2], gravity: 250, vz: [20, 80],
    });
    if (hit.crit) {
      this.particles.burst(e.x, e.y - e.z - 3, { count: 6, speed: [60, 160], life: [0.1, 0.25], colors: ['#ffffff', '#ffe060'], shape: 'spark', size: [1, 2] });
      this.shake(0.12);
      if (!hit.light && save.settings.hitStop) this.hitstop(0.035);
      playSfx('hit_crit', { vol: 0.6, pitch: fx.range(0.95, 1.1) });
    } else if (!hit.light) {
      playSfx(e.def.hurtSfx ?? 'hit', { vol: 0.45, pitch: fx.range(0.9, 1.15) });
    }
    if (hit.kind === 'melee' && save.settings.hitStop && !hit.light) this.hitstop(0.045);
  }

  /** Damage-over-time tick (burn/poison/bleed). */
  statusDamage(target: Actor, dmg: number, kind: StatusKind): void {
    if (target === this.player) {
      if (kind === 'burn' || kind === 'poison') this.player.hurt(this, 1, kind === 'burn' ? '화상' : '독');
      return;
    }
    this.applyHit(target, { damage: dmg, kind: 'status', attacker: this.player, light: true, noProc: true, procs: [kind] });
    const col = kind === 'burn' ? ['#ffe060', '#ff7020'] : kind === 'poison' ? ['#c0ff60', '#40a020'] : ['#ff4050', '#801020'];
    this.particles.burst(target.x, target.y - 4, { count: 3, speed: [10, 30], life: [0.3, 0.6], colors: col, size: [1, 2], vz: [10, 30], gravity: -20 });
  }

  killEnemy(e: Enemy): void {
    if (e.dead) return;
    e.hp = Math.min(0, e.hp);
    e.dead = true;
    try {
      e.def.onDeath?.(e, this);
    } catch (err) {
      console.error(err);
    }
    this.deathEffects(e);
    if (!e.isMinion) this.run.stats.kills++;
    save.progress.totalKills++;
    save.markSeenEnemy(e.def.id);
    this.items.onKill(e);
    const p = this.player;
    if (p.stats.lifesteal > 0 && this.rng.chance(p.stats.lifesteal) && p.red < p.maxRed) {
      p.heal(1);
      this.floatText(p.x, p.y - 18, '+♥', '#ff6070');
    }
    // drops
    if (e.champion) this.dropRandom(e.x, e.y, 'champion');
    else if (!e.isMinion && !e.isBoss && this.rng.chance(0.06 + p.stats.luck * 0.01)) this.dropRandom(e.x, e.y, 'enemy');
    if (e.isBoss) this.bossKilled(e);
    else if (save.settings.hitStop) this.hitstop(0.025);
  }

  private deathEffects(e: Enemy): void {
    const fxKind = e.def.deathFx ?? 'blood';
    const col = e.def.bloodColor ?? (fxKind === 'goo' ? '#5aa02a' : fxKind === 'ember' ? '#ff7a2a' : fxKind === 'ice' ? '#a0e0ff' : fxKind === 'void' ? '#8a4aff' : fxKind === 'bone' ? '#e0d8c0' : fxKind === 'metal' ? '#9098a8' : fxKind === 'spore' ? '#c0d060' : '#b01c28');
    const big = e.r > 10 || e.isBoss;
    playSfx(e.def.dieSfx ?? (big ? 'enemy_die_big' : 'enemy_die'), { vol: 0.7, pitch: fx.range(0.9, 1.1) });
    if (fxKind === 'none') return;
    const n = big ? 34 : 18;
    this.particles.burst(e.x, e.y - e.z - 3, {
      count: n, speed: [40, big ? 200 : 140], life: [0.3, 0.8], colors: ['#ffffff', col, col, darkenHex(col)], size: [1, 3],
      gravity: 320, vz: [40, 140], bounce: 0.3,
      onLand: fxKind === 'blood' || fxKind === 'goo' ? (x, y) => { if (fx.chance(0.35)) this.decal(x, y, col, fx.range(1, 2.5)); } : undefined,
    });
    this.particles.spawn({ x: e.x, y: e.y - 3, life: 0.3, size: 2, sizeEnd: e.r * 2.2, colors: ['#ffffff'], shape: 'ring' });
    if (fxKind === 'blood' || fxKind === 'goo' || fxKind === 'void') {
      // big splat decal
      for (let i = 0; i < (big ? 9 : 4); i++) this.decal(e.x + fx.range(-e.r, e.r), e.y + fx.range(-e.r * 0.5, e.r * 0.6), col, fx.range(2, big ? 7 : 4.5));
    } else if (fxKind === 'bone') {
      for (let i = 0; i < 5; i++) this.decal(e.x + fx.range(-6, 6), e.y + fx.range(-3, 4), '#d8d0b8', fx.range(1, 2));
    } else if (fxKind === 'ember') {
      this.decal(e.x, e.y, '#1a1010', e.r * 0.9, 0.5);
    }
    if (e.isBoss) {
      for (let i = 0; i < 4; i++) this.spawn(new RingFx(e.x, e.y, 40 + i * 20, 0.4 + i * 0.15, i % 2 ? col : '#ffffff', 3));
    }
  }

  private bossKilled(e: Enemy): void {
    this.run.stats.bossesKilled++;
    playSfx('boss_die');
    this.shake(1);
    this.renderer.screenFlash('#ffffff', 0.6);
    this.slowmo = 0.3;
    this.slowmoT = 0.9;
  }

  /**
   * Explosion: damages everyone in radius (player too, unless immune flag),
   * breaks rocks & pots, reveals secret doors, pushes things away.
   */
  explode(x: number, y: number, radius: number, damage: number, o: { source?: Entity | null; byPlayer?: boolean; hurtsPlayer?: boolean; color?: string; noTiles?: boolean } = {}): void {
    const p = this.player;
    playSfx('explosion', { vol: Math.min(1, 0.6 + radius / 100) });
    this.shake(Math.min(1, 0.35 + radius / 90));
    this.renderer.screenFlash('#fff2c0', 0.12);
    const col = o.color ?? '#ff9a2a';
    this.particles.burst(x, y, { count: 34, speed: [60, 220], life: [0.25, 0.6], colors: ['#ffffff', '#fff0a0', col, '#a03010', '#402020'], size: [2, 4], sizeEnd: 0.5, additive: true, light: 8 });
    this.particles.burst(x, y, { count: 22, speed: [10, 60], life: [0.6, 1.4], colors: ['#706060', '#504848', '#302828'], size: [3, 6], sizeEnd: 8, drag: 3, fade: true });
    this.particles.burst(x, y, { count: 12, speed: [60, 160], life: [0.4, 0.9], colors: ['#806050', '#504030'], size: [1, 2], gravity: 300, vz: [60, 160] });
    this.spawn(new RingFx(x, y, radius, 0.3, '#fff0c0', 3));
    this.decal(x, y, '#140c0c', radius * 0.55, 0.55);
    this.lights.glow(x, y, radius * 2, col, 0.8);
    this.vars.__lastExplosion = this.time;

    for (const e of [...this.enemies]) {
      const d = dist(x, y, e.x, e.y);
      if (d < radius + e.r && e.alive) {
        const n = d || 1;
        this.applyHit(e, { damage, kind: 'explosion', source: o.source, attacker: o.byPlayer !== false ? p : null, dirX: (e.x - x) / n, dirY: (e.y - y) / n, knockback: 260 });
      }
    }
    for (const h of [...this.hittables]) if (dist(x, y, h.x, h.y) < radius + h.r) h.takeHit(this, { damage, kind: 'explosion', attacker: p });
    if ((o.hurtsPlayer ?? true) && !p.flags.has('bombImmune') && dist(x, y, p.x, p.y) < radius + p.r - 4) {
      if (p.hurt(this, 2, '폭발')) {
        const d = dist(x, y, p.x, p.y) || 1;
        p.knock((p.x - x) / d, (p.y - y) / d, 240);
      }
    }
    for (const e of this.entities) {
      if (e instanceof Pickup || e instanceof Bomb) {
        const d = dist(x, y, e.x, e.y);
        if (d < radius * 1.5 && d > 0.1) {
          e.vx += ((e.x - x) / d) * 160;
          e.vy += ((e.y - y) / d) * 160;
        }
      }
    }
    if (!o.noTiles) {
      const r = radius + 4;
      for (let ty = Math.floor((y - r) / TILE); ty <= Math.floor((y + r) / TILE); ty++) {
        for (let tx = Math.floor((x - r) / TILE); tx <= Math.floor((x + r) / TILE); tx++) {
          const cx = (tx + 0.5) * TILE;
          const cy = (ty + 0.5) * TILE;
          if (dist(x, y, cx, cy) > r + 6) continue;
          this.room.destroyTile(this, tx, ty, 'bomb');
        }
      }
      // secret doors
      for (const d of this.room.doors) {
        if (d.state === 'hidden' && dist(x, y, d.x, d.y) < radius + 18) this.revealSecretDoor(d);
      }
    }
  }

  revealSecretDoor(d: Door): void {
    this.room.revealDoor(d);
    const nd = this.node.doors.find((x) => x.to === d.to && x.dir === d.dir) as (NodeDoor & { revealed?: boolean }) | undefined;
    if (nd) {
      nd.revealed = true;
      const back = matchingDoor(this.map, this.node, nd) as (NodeDoor & { revealed?: boolean }) | undefined;
      if (back) back.revealed = true;
    }
    this.map.nodes[d.to].discovered = true;
    this.mapVersion++;
    this.run.stats.secretsFound++;
    playSfx('secret_found');
  }

  onTileDestroyed(t: number, tx: number, ty: number, cx: number, cy: number): void {
    const pal = this.room.theme.palette;
    if (t === Tile.POT) {
      playSfx('pot_break', { vol: 0.7 });
      this.particles.burst(cx, cy, { count: 16, speed: [40, 120], life: [0.3, 0.7], colors: ['#c08a5a', '#8a5a3a', '#5a3a2a'], size: [1, 3], gravity: 300, vz: [40, 120], shape: 'square', vrot: 10 });
      const r = this.rng.next();
      if (r < 0.25) this.spawn(new Pickup('coin', cx, cy).pop());
      else if (r < 0.31) this.spawn(new Pickup('heart_half', cx, cy).pop());
      else if (r < 0.34) this.spawn(new Pickup('bomb', cx, cy).pop());
      else if (r < 0.36) this.spawn(new Pickup('key', cx, cy).pop());
    } else {
      playSfx('rock_break', { vol: 0.8 });
      this.particles.burst(cx, cy, { count: 18, speed: [40, 140], life: [0.4, 0.9], colors: pal.rock, size: [1, 3], gravity: 300, vz: [60, 150], shape: 'square', vrot: 8, bounce: 0.3 });
      this.particles.burst(cx, cy, { count: 8, speed: [10, 40], life: [0.5, 1.0], colors: ['#9a9088', '#6a6058'], size: [3, 5], sizeEnd: 7, drag: 3 });
      if (t === Tile.TINTED) {
        const r = this.rng.next();
        if (r < 0.4) { for (let i = 0; i < 3; i++) this.spawn(new Pickup('coin', cx, cy).pop()); }
        else if (r < 0.65) this.spawn(new Pickup('soul_heart', cx, cy).pop());
        else if (r < 0.85) { this.spawn(new Pickup('bomb', cx, cy).pop()); this.spawn(new Pickup('key', cx, cy).pop()); }
        else this.spawn(new Chest(cx, cy, false));
        playSfx('secret_found', { vol: 0.6 });
      } else if (t === Tile.SKULL_ROCK && this.rng.chance(0.3)) {
        this.spawn(new Pickup('soul_half', cx, cy).pop());
      }
    }
  }

  onFireExtinguished(f: FirePlace): void {
    if (this.rng.chance(f.blue ? 0.6 : 0.2)) this.dropRandom(f.x, f.y, 'enemy');
  }

  // ================================================================== pickups / items
  /** Random drop from a table. */
  dropRandom(x: number, y: number, table: 'enemy' | 'champion' | 'room' | 'chest'): void {
    const rng = this.rng;
    const luck = this.player.stats.luck;
    const kinds: [PickupKind | 'chest' | 'potion' | null, number][] =
      table === 'room'
        ? [[null, Math.max(10, 38 - luck * 3)], ['coin', 22], ['heart_half', 6], ['heart', 6], ['bomb', 9], ['key', 9], ['chest', 4], ['potion', 3], ['soul_heart', 2], ['nickel', 1]]
        : table === 'chest'
          ? [['coin', 30], ['nickel', 6], ['heart', 10], ['bomb', 12], ['key', 12], ['soul_heart', 6], ['potion', 8], ['bomb2', 4]]
          : [['coin', 40], ['heart_half', 15], ['bomb', 12], ['key', 12], ['soul_half', 6], ['heart', 6]];
    const pick = rng.weighted(kinds, (k) => k[1]);
    if (!pick || pick[0] === null) return;
    const k = pick[0];
    if (k === 'chest') {
      const pos = this.room.nearestFree(x, y, 7);
      this.spawn(new Chest(pos.x, pos.y, rng.chance(0.25)));
    } else if (k === 'potion') {
      const pots = Potions.all();
      if (!pots.length) return;
      const pk = new Pickup('potion', x, y).pop();
      pk.potionId = rng.weighted(pots, (p) => p.weight ?? 1)!.id;
      this.spawn(pk);
    } else {
      this.spawn(new Pickup(k, x, y).pop());
    }
  }

  collectPickup(pk: Pickup): void {
    const p = this.player;
    const s = p.stats;
    switch (pk.kind) {
      case 'coin': case 'nickel': case 'dime': {
        const v = (pk.kind === 'coin' ? 1 : pk.kind === 'nickel' ? 5 : 10) * Math.max(1, Math.round(s.greed));
        p.coins = Math.min(999, p.coins + v);
        this.run.stats.coinsCollected += v;
        playSfx('coin', { pitch: pk.kind === 'coin' ? 1 : 0.85 });
        this.floatText(pk.x, pk.y - 8, `+${v}`, '#ffe060');
        break;
      }
      case 'heart_half': p.heal(1); playSfx('heart'); break;
      case 'heart': p.heal(2); playSfx('heart'); break;
      case 'soul_heart': p.addSoul(2); playSfx('soul_heart'); break;
      case 'soul_half': p.addSoul(1); playSfx('soul_heart'); break;
      case 'bomb': p.bombs = Math.min(99, p.bombs + 1); playSfx('bomb_pickup'); break;
      case 'bomb2': p.bombs = Math.min(99, p.bombs + 2); playSfx('bomb_pickup'); break;
      case 'key': p.keys = Math.min(99, p.keys + 1); playSfx('key'); break;
      case 'potion': {
        if (p.potionId) {
          const old = new Pickup('potion', p.x, p.y).pop();
          old.potionId = p.potionId;
          old.grace = 1.2;
          this.spawn(old);
        }
        p.potionId = pk.potionId;
        const def = Potions.get(pk.potionId);
        const known = this.run.identified.has(pk.potionId);
        this.banner(known && def ? def.name : '정체불명의 물약', known && def ? def.desc : 'R 키로 마시기', { icon: null, color: '#e0c0ff', small: true });
        playSfx('potion', { vol: 0.6 });
        break;
      }
    }
    this.particles.burst(pk.x, pk.y - 3, { count: 6, speed: [20, 60], life: [0.2, 0.4], colors: ['#ffffff', '#ffe8a0'], size: [1, 2] });
    this.items.onPickup(pk.kind);
  }

  takePedestal(ped: Pedestal): void {
    const p = this.player;
    const it = ped.item;
    if (!it) return;
    if (ped.price > 0) {
      p.coins -= ped.price;
      this.run.stats.coinsSpent += ped.price;
      playSfx('buy');
    }
    if (ped.heartPrice > 0) {
      const cost = ped.heartPrice * 2;
      const fromMax = Math.min(cost, p.maxRed);
      p.baseHearts = Math.max(0, p.baseHearts - Math.ceil(fromMax / 2));
      if (fromMax < cost) p.soul = Math.max(0, p.soul - (cost - fromMax));
      this.flags.add('devilDeal');
    }
    ped.item = null;
    const info = itemInfo(it);
    this.run.stats.itemsTaken++;
    save.markSeenItem(it.id);
    switch (it.kind) {
      case 'artifact':
        this.items.give(it.id);
        break;
      case 'active': {
        const old = p.setActive(it.id, this);
        if (old) {
          ped.item = { kind: 'active', id: old };
          ped.waitForLeave = true;
          ped.price = 0;
        }
        break;
      }
      case 'weapon': {
        const old = p.weaponId;
        p.weaponId = it.id;
        p.weapon = newWeaponState();
        ped.item = { kind: 'weapon', id: old };
        ped.waitForLeave = true;
        ped.price = 0;
        this.items.recompute();
        break;
      }
    }
    if (ped.group) {
      for (const e of this.entities) if (e instanceof Pedestal && e !== ped && e.group === ped.group && e.item) {
        e.item = null;
        this.particles.burst(e.x, e.y - 10, { count: 16, speed: [20, 70], life: [0.3, 0.6], colors: ['#ffffff', '#a080ff'], size: [1, 2] });
      }
    }
    if (it.kind !== 'weapon' && it.kind !== 'active') ped.price = 0;
    p.holdIcon = info.icon;
    p.holdT = 1.0;
    p.squash(0.8, 1.25);
    const rare = info.rarity === 'epic' || info.rarity === 'legendary';
    playSfx(rare ? 'item_get_rare' : 'item_get');
    this.banner(info.name, info.desc, { icon: info.icon, color: rareColor(info.rarity), quote: info.quote });
    this.spawn(new RingFx(p.x, p.y - 8, 30, 0.4, rareColor(info.rarity), 2));
  }

  /** Put an item on a new pedestal (e.g. swapped out / dropped from a full inventory). */
  dropItemPedestal(item: PedestalItem, x: number, y: number): Pedestal {
    const pos = this.room.nearestFree(x, y, 8);
    const ped = new Pedestal(pos.x, pos.y, item);
    ped.waitForLeave = true;
    this.spawn(ped);
    return ped;
  }

  openChest(c: Chest): void {
    playSfx('chest_open');
    const n = c.locked ? this.rng.int(2, 4) : this.rng.int(1, 3);
    if (c.locked && this.rng.chance(0.3)) {
      const item = this.loot.rollItem('treasure', this.run.lootRng);
      if (item) {
        this.spawn(new Pedestal(c.x, c.y - 4, item));
        c.dead = true;
        return;
      }
    }
    for (let i = 0; i < n; i++) this.dropRandom(c.x, c.y, 'chest');
  }

  /** Isaac-style item banner. */
  banner(title: string, desc: string, o: { icon?: string | null; color?: string; quote?: string; small?: boolean } = {}): void {
    this.banners.push({ title, desc, quote: o.quote, icon: o.icon ?? null, color: o.color ?? '#ffffff', t: 0, small: o.small });
    if (this.banners.length > 2) this.banners.shift();
  }

  floatText(x: number, y: number, text: string, color = '#ffffff', scale = 1): void {
    const f = new FloatingText(x, y, text, color, scale);
    f.layer = 3;
    this.spawn(f);
  }

  // ================================================================== room flow
  private checkDoors(): void {
    const p = this.player;
    if (!p.alive || this.transitioning) return;
    for (const d of this.room.doors) {
      // unlock with key
      if (d.state === 'locked') {
        if (dist(p.x, p.y, d.x, d.y) < 16 && p.keys > 0) {
          p.keys--;
          d.state = 'open';
          this.map.nodes[d.to].locked = false;
          playSfx('door_unlock');
          this.room.markDirty();
        }
        continue;
      }
      if (d.state !== 'open' || d.open < 0.9) continue;
      const v = DIR_VEC[d.dir];
      // crossed the inner wall edge into the doorway?
      const along = v.x !== 0 ? (p.x - d.x) * v.x : (p.y - d.y) * v.y;
      const across = v.x !== 0 ? Math.abs(p.y - d.y) : Math.abs(p.x - d.x);
      if (along > 3 && across < 10) {
        this.goThroughDoor(d);
        return;
      }
    }
  }

  private goThroughDoor(d: Door): void {
    const nd = this.node.doors.find((x) => x.to === d.to && x.dir === d.dir && sameCellNode(x, d, this.node, this.room));
    if (!nd) return;
    const target = this.map.nodes[d.to];
    this.beginTransition(d.dir);
    this.enterRoom(target, nd);
  }

  /** Take a snapshot of the current frame and slide/fade to the next room. */
  beginTransition(dir: Dir | 'fade', dur = dir === 'fade' ? 0.6 : 0.28): void {
    const sc = this.snapCanvas.getContext('2d')!;
    sc.clearRect(0, 0, VIEW_W, VIEW_H);
    sc.drawImage(this.renderer.world, 0, 0);
    this.transition = { snapshot: this.snapCanvas, dir, t: 0, dur };
    this.transitioning = true;
  }

  /** Teleport to a node (no door). Used by teleport items / debug. */
  teleportTo(node: RoomNode): void {
    this.beginTransition('fade', 0.4);
    this.enterRoom(node, null);
  }

  private checkClear(): void {
    if (this.node.cleared || this.holdClear > 0 || this.roomTime < 0.3) return;
    for (const e of this.enemies) if (!e.dead && !e.ignoreForClear) return;
    for (const e of this.pending) if (e instanceof Enemy && !e.ignoreForClear) return;
    this.roomCleared();
  }

  roomCleared(): void {
    const node = this.node;
    if (node.cleared) return;
    node.cleared = true;
    this.mapVersion++;
    this.run.stats.roomsCleared++;
    this.room.setDoorsClosed(false);
    playSfx('door_open');
    playSfx('room_clear', { vol: 0.6 });
    // active item charge
    const p = this.player;
    const act = p.activeId ? Actives.get(p.activeId) : undefined;
    if (act && !act.timed && p.activeCharge < act.charge) {
      p.activeCharge = Math.min(act.charge, p.activeCharge + (node.cw * node.ch > 1 ? 2 : 1));
      if (p.activeCharge >= act.charge) playSfx('active_ready');
    }
    const handler = roomHandler(node.kind);
    const rng = new RNG(node.seed ^ 0xc1ea);
    if (handler?.onClear) handler.onClear(this, this.room, rng);
    else if (node.kind === 'normal') {
      const pos = this.room.nearestFree(this.room.centerX, this.room.centerY, 6);
      this.dropRandom(pos.x, pos.y, 'room');
    }
    this.items.onRoomClear();
  }

  /** Go down the trapdoor. */
  descend(): void {
    if (this.transitioning) return;
    playSfx('trapdoor');
    const next = this.run.floor + 1;
    if (!Floors.all().some((f) => f.index === next)) {
      this.victory();
      return;
    }
    this.beginTransition('fade', 0.9);
    this.startFloor(next);
  }

  victory(): void {
    if (this.gameOver) return;
    this.run.won = true;
    this.gameOver = { won: true, source: '' };
    audio.playMusic('victory');
    this.host.onGameOver(this.gameOver);
  }

  playerDied(source: string): void {
    if (this.deathT >= 0) return;
    this.deathT = 0;
    this.run.lastDamageSource = source;
    const p = this.player;
    playSfx('player_die');
    audio.stopMusic(1.2);
    this.slowmo = 0.35;
    this.slowmoT = 1.2;
    this.shake(0.8);
    this.particles.burst(p.x, p.y - 6, { count: 40, speed: [40, 180], life: [0.4, 1.0], colors: ['#ff5060', '#c01828', '#ffffff'], size: [1, 3], gravity: 300, vz: [60, 160] });
    for (let i = 0; i < 6; i++) this.decal(p.x + fx.range(-8, 8), p.y + fx.range(-4, 6), '#a01020', fx.range(2, 5));
  }

  /** Open the collection / status overlay through the host scene. */
  openInventory(): void {
    this.host.openInventory();
  }

  // ================================================================== queries
  nearestEnemy(x: number, y: number, maxDist = Infinity, exclude?: Set<number>, self?: Enemy): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxDist * maxDist;
    for (const e of this.enemies) {
      if (!e.alive || e.hidden || e === self || !e.vulnerable || exclude?.has(e.id)) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  enemiesInRadius(x: number, y: number, r: number): Enemy[] {
    return this.enemies.filter((e) => e.alive && !e.hidden && dist2(x, y, e.x, e.y) < (r + e.r) * (r + e.r));
  }

  get bosses(): Enemy[] {
    return this.enemies.filter((e) => e.isBoss && e.alive && !e.isMinion);
  }

  mouseWorld(): { x: number; y: number } {
    return this.renderer.displayToWorld(input.mouseX, input.mouseY);
  }

  // ================================================================== feedback helpers
  sfx(name: SfxName, o: SfxPlayOpts = {}): void {
    playSfx(name, o);
  }

  shake(amount: number): void {
    this.renderer.shake(amount);
  }

  hitstop(t: number): void {
    this.hitstopT = Math.min(0.12, Math.max(this.hitstopT, t));
  }

  /** Permanent floor stain (blood, scorch ...). */
  decal(x: number, y: number, color: string, radius: number, alpha = 0.75): void {
    const c = this.room.ensureDecals().getContext('2d')!;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    // pixel-y blob: a few overlapping squares
    const r = Math.max(1, radius);
    const n = Math.max(1, Math.round(r));
    for (let i = 0; i < n; i++) {
      const ox = Math.round((fx.next() - 0.5) * r);
      const oy = Math.round((fx.next() - 0.5) * r * 0.7);
      const s = Math.max(1, Math.round(r * fx.range(0.5, 1)));
      c.fillRect(Math.round(x + ox - s / 2), Math.round(y + oy - s / 3), s, Math.max(1, Math.round(s * 0.66)));
    }
    c.globalAlpha = 1;
  }

  // ================================================================== camera & draw
  private updateCamera(dt: number): void {
    const r = this.renderer;
    const p = this.player;
    const room = this.room;
    let tx: number;
    let ty: number;
    if (room.pxW <= VIEW_W) tx = (room.pxW - VIEW_W) / 2;
    else tx = clamp(p.x - VIEW_W / 2, 0, room.pxW - VIEW_W);
    if (room.pxH <= VIEW_H) ty = (room.pxH - VIEW_H) / 2;
    else ty = clamp(p.y - VIEW_H / 2, 0, room.pxH - VIEW_H);
    if (!this.camInit || dt >= 1) {
      r.camX = tx;
      r.camY = ty;
      this.camInit = true;
    } else {
      r.camX = damp(r.camX, tx, 10, dt);
      r.camY = damp(r.camY, ty, 10, dt);
    }
  }

  draw(): void {
    const r = this.renderer;
    r.beginWorld('#06040a');
    this.room.drawBackground(r);
    this.particles.draw(r, true);
    const sorted = this.entities.filter((e) => !e.dead || e === this.player);
    for (const e of sorted) if (e.layer === 0) e.draw(r, this);
    this.room.drawDoors(r, this.time);
    const mid = sorted.filter((e) => e.layer === 1).sort((a, b) => a.sortY - b.sortY);
    for (const e of mid) e.draw(r, this);
    this.particles.draw(r, false);
    for (const e of sorted) if (e.layer === 2) e.draw(r, this);

    // lighting
    this.lights.begin(r, this.room.theme.ambient);
    for (const e of sorted) e.light(this);
    this.drawParticleLights();
    this.lights.apply();

    for (const e of sorted) if (e.layer === 3) e.draw(r, this);
    this.drawVignette();

    if (this.transition) this.drawTransition();
  }

  private drawParticleLights(): void {
    for (const p of this.particles.list) {
      if (p.light > 0) this.lights.add(p.x, p.y - p.z, p.light, p.lightColor ?? p.colors[0].slice(0, 7), { intensity: 0.7 * (1 - p.age / p.life) });
    }
  }

  private vignette: HTMLCanvasElement | null = null;
  private drawVignette(): void {
    if (!this.vignette) {
      const c = document.createElement('canvas');
      c.width = VIEW_W;
      c.height = VIEW_H;
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.45, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.62);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = grd;
      g.fillRect(0, 0, VIEW_W, VIEW_H);
      this.vignette = c;
    }
    const ctx = this.renderer.ctx;
    ctx.drawImage(this.vignette, 0, 0);
    // low health pulse
    const p = this.player;
    if (p.alive && p.red + p.soul <= 2) {
      ctx.globalAlpha = 0.18 + 0.12 * Math.sin(this.time * 6);
      ctx.fillStyle = '#ff0010';
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.vignette, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  private transCanvas: HTMLCanvasElement | null = null;
  private drawTransition(): void {
    const tr = this.transition!;
    const ctx = this.renderer.ctx;
    const t = clamp(tr.t / tr.dur, 0, 1);
    if (tr.dir === 'fade') {
      // fade out old -> black -> new
      if (t < 0.5) {
        ctx.drawImage(tr.snapshot, 0, 0);
        ctx.globalAlpha = t * 2;
      } else {
        ctx.globalAlpha = 1 - (t - 0.5) * 2;
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
      return;
    }
    const v = DIR_VEC[tr.dir];
    const e = 1 - Math.pow(1 - t, 3);
    // new frame is already drawn: move it, then draw the old one sliding out
    if (!this.transCanvas) {
      this.transCanvas = document.createElement('canvas');
      this.transCanvas.width = VIEW_W;
      this.transCanvas.height = VIEW_H;
    }
    const cur = this.transCanvas;
    const cc = cur.getContext('2d')!;
    cc.clearRect(0, 0, VIEW_W, VIEW_H);
    cc.drawImage(this.renderer.world, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.drawImage(tr.snapshot, Math.round(-v.x * VIEW_W * e), Math.round(-v.y * VIEW_H * e));
    ctx.drawImage(cur, Math.round(v.x * VIEW_W * (1 - e)), Math.round(v.y * VIEW_H * (1 - e)));
  }
}

// ---------------------------------------------------------------------- helpers
function doorKindFor(node: RoomNode, target: RoomNode): DoorKind {
  const special = (k: string) => k !== 'normal' && k !== 'start';
  if (special(target.kind)) return target.kind as DoorKind;
  if (special(node.kind)) return node.kind as DoorKind;
  return 'normal';
}

/** Does room door `d` (in `room`, belonging to `node`) correspond to node door `nd`? */
function sameCell(d: Door, nd: NodeDoor, node: RoomNode, room: Room): boolean {
  return sameCellNode(nd, d, node, room);
}

function sameCellNode(nd: NodeDoor, d: Door, node: RoomNode, _room: Room): boolean {
  if (nd.dir !== d.dir || nd.to !== d.to) return false;
  const lx = nd.cx - node.gx;
  const ly = nd.cy - node.gy;
  const tx = d.tiles[0][0];
  const ty = d.tiles[0][1];
  if (d.dir === 'N' || d.dir === 'S') return Math.floor((tx - WALL) / CELL_W) === lx;
  return Math.floor((ty - WALL) / CELL_H) === ly;
}

function makeChampion(e: Enemy, rng: RNG): void {
  e.champion = true;
  const kinds = [
    { color: '#ff4040', apply: () => { e.maxHp = e.hp = e.hp * 1.6; } },
    { color: '#40ff60', apply: () => { e.speed *= 1.35; e.maxHp = e.hp = e.hp * 1.3; } },
    { color: '#ffd040', apply: () => { e.maxHp = e.hp = e.hp * 2.2; e.scale = 1.15; } },
    { color: '#6080ff', apply: () => { e.maxHp = e.hp = e.hp * 1.4; e.mass *= 2; } },
  ];
  const k = rng.pick(kinds);
  e.championColor = k.color;
  k.apply();
}

function statusColor(hit: HitInfo): string {
  const k = hit.procs?.[0];
  return k === 'burn' ? '#ff9a3a' : k === 'poison' ? '#9aff5a' : k === 'bleed' ? '#ff4a5a' : '#c0c0c0';
}

function rareColor(r: string): string {
  return r === 'legendary' ? '#ffb340' : r === 'epic' ? '#c07bff' : r === 'rare' ? '#5fb8ff' : '#ffffff';
}

function darkenHex(c: string): string {
  const n = parseInt(c.slice(1, 7), 16);
  const r = ((n >> 16) & 255) * 0.5;
  const g = ((n >> 8) & 255) * 0.5;
  const b = (n & 255) * 0.5;
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export { Weapons };
