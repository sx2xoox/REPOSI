// The player character: movement + dash, weapon handling, hearts, consumables,
// active item and potion, and rendering (body, held weapon, lantern light).

import { Actor, type HitInfo } from './entity';
import type { World } from './world';
import type { Renderer } from '../engine/renderer';
import { Actives, Potions, Weapons, enemyHitDamage, type CharacterDef, type WeaponState } from './defs';
import { Inventory } from './inventory';
import { BASE_STATS, type Stats } from './stats';
import { angleOf, clamp, fromAngle, norm } from '../engine/math';
import { animFrame, hasAnim, hasSprite } from '../engine/sprites';
import { Projectile, fanAngles, type ProjectileOpts } from './projectile';
import { MeleeSwing, type SwingOpts } from './melee';
import { Afterimage, RingFx } from './effects';
import { Bomb } from './pickups';
import { Tile } from './tiles';
import { spikeState } from './spikes';
import { RELEASE_COOLDOWN } from './ember';
import { fx } from '../engine/rng';
import { DIR_VEC } from './constants';
import { drawBackWeapon, equipWeapon, swapWeapons, tickHolstered, withSwapPop } from './weaponslots';
import { emptyInput, HELD, PRESS, readLocalInput, type PlayerInput } from './seam';
import { FlowField } from './flow';
import type { ItemSystem } from './items';
import type { Entity } from './entity';

export type Facing = 'down' | 'up' | 'side';

export const EMBER_MAX = 100;

/**
 * Coins, bombs and keys. Every keeper has their own in single-player; a co-op
 * party shares one purse (`World.startParty` hands the same object to everyone).
 */
export class Purse {
  coins = 0;
  bombs = 1;
  keys = 0;
}

/** Default lantern release: a ring of flame that burns enemies and erases bullets. */
export function defaultRelease(w: World, p: Player): void {
  const radius = 90;
  w.sfx('fire', { vol: 1 });
  w.sfx('explosion', { vol: 0.6, pitch: 1.3 });
  w.shake(0.5);
  w.renderer.screenFlash('#ffd080', 0.35);
  w.spawn(new RingFx(p.x, p.y - 4, radius, 0.45, '#ffd080', 4));
  w.particles.burst(p.x, p.y - 4, { count: 60, speed: [80, 260], life: [0.3, 0.7], colors: ['#ffffff', '#ffe080', '#ff9a30', '#c04010'], size: [1, 3], additive: true, light: 6 });
  w.clearEnemyBullets(p.x, p.y, radius * 1.4);
  for (const e of w.enemiesInRadius(p.x, p.y, radius)) {
    const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
    w.applyHit(e, {
      damage: p.stats.damage * 4, kind: 'explosion', attacker: p, dirX: (e.x - p.x) / d, dirY: (e.y - p.y) / d, knockback: 300,
      statuses: [{ kind: 'burn', duration: 3, power: p.stats.damage * 0.6 }], noProc: true, release: true,
    });
  }
}

export function newWeaponState(): WeaponState {
  return { cooldown: 0, charge: 0, combo: 0, comboTimer: 0, sinceAttack: 99, anim: 0, mem: {} };
}

export class Player extends Actor {
  character: CharacterDef;
  stats: Stats = { ...BASE_STATS };
  flags = new Set<string>();
  /** base red heart containers (character + permanent pickups) */
  baseHearts: number;
  /** current red health in half hearts */
  red = 6;
  /** soul (shield) health in half hearts */
  soul = 0;
  /** one-hit barriers granted by items (each blocks one hit completely) */
  shields = 0;
  private peakMaxRed = 0;
  /** coins / bombs / keys (shared by the whole party in co-op) */
  purse = new Purse();
  inv = new Inventory();
  weaponId: string;
  weapon: WeaponState = newWeaponState();
  /** second weapon slot (null = empty); `swapWeapon` exchanges it with the current one */
  weapon2Id: string | null = null;
  weapon2: WeaponState = newWeaponState();
  /** world time of the last swap / weapon pickup (draw animation) */
  swapAt = -99;
  /** weapon put away by the last swap (UI animation) */
  lastSwapFrom: string | null = null;
  activeId: string | null = null;
  activeCharge = 0;
  potionId: string | null = null;
  /** ember gauge 0..EMBER_MAX, filled by dealing damage; F releases it */
  ember = 0;
  releaseT = 0;
  releaseCooldown = 0;

  // control state
  aim = 0;
  firing = false;
  facing: Facing = 'down';
  flip = false;
  moving = false;
  animT = 0;
  dashT = 0;
  dashCD = 0;
  dashDX = 0;
  dashDY = 1;
  /** where the current / last dash started (character dash hooks: trails, rifts) */
  dashX0 = 0;
  dashY0 = 0;
  private afterT = 0;
  /** dash pressed slightly before the cooldown ended: performed as soon as possible */
  private dashBuffer = 0;
  /** Isaac-style "hold the new item over your head" */
  holdIcon: string | null = null;
  holdT = 0;
  /** input locked (cutscenes, transitions) */
  frozen = false;
  /** 0..1 trapdoor fall (shrinks & sinks into the hole; driven by World.beginDescend) */
  fall = 0;
  god = false;
  /** recoil offset for the weapon sprite */
  recoil = 0;
  spikeCD = 0;
  /** world time of the last attack */
  lastAttackAt = -99;
  /**
   * This step's input (move / aim / buttons), filled by `World.inputSource` at
   * the start of every update: the only way input reaches the simulation
   * (lockstep seam, see game/seam.ts).
   */
  readonly input: PlayerInput = emptyInput();

  // ---- co-op (see World.startParty; single-player: slot 0, never downed)
  /** lockstep slot 0..3 (P1..P4) */
  slot = 0;
  /** nickname shown on the name tag / teammate panel */
  name = '';
  /** this keeper's artifacts, buffs, hook dispatch and looks (`w.items` while it is the context player) */
  items!: ItemSystem;
  /** per-keeper scratch state of item / kit hooks (`w.vars` while it is the context player) */
  vars: Record<string, number> = {};
  /** ground enemies' path field toward this keeper (`w.flow` while it is the context player) */
  readonly flow = new FlowField();
  /** the item this keeper stands next to (`w.focus` while it is the context player) */
  focus: Entity | null = null;
  /** co-op: at 0 HP the keeper is a ghost (moves, can't attack / interact / be hurt) until revived */
  downed = false;
  /** co-op: revive progress in seconds while a teammate stands close */
  reviveT = 0;
  /** co-op: left the session (removed from the world) */
  left = false;

  constructor(character: CharacterDef) {
    super();
    this.character = character;
    this.team = 'player';
    this.r = 5;
    this.baseHearts = character.hearts;
    this.weaponId = character.weapon;
    this.solid = false;
  }

  get coins(): number {
    return this.purse.coins;
  }

  set coins(v: number) {
    this.purse.coins = v;
  }

  get bombs(): number {
    return this.purse.bombs;
  }

  set bombs(v: number) {
    this.purse.bombs = v;
  }

  get keys(): number {
    return this.purse.keys;
  }

  set keys(v: number) {
    this.purse.keys = v;
  }

  get maxRed(): number {
    return this.stats.maxHearts * 2;
  }

  get totalHp(): number {
    return this.red + this.soul;
  }

  override get alive(): boolean {
    return !this.dead && !this.downed && this.red + this.soul > 0;
  }

  get dashing(): boolean {
    return this.dashT > 0;
  }

  /** Called by the item system after stats change. */
  onMaxHeartsChanged(_w: World, oldMaxHalf: number): void {
    const newMax = this.maxRed;
    if (oldMaxHalf >= 0 && newMax > Math.max(oldMaxHalf, this.peakMaxRed)) {
      this.red += newMax - Math.max(oldMaxHalf, this.peakMaxRed);
    }
    this.peakMaxRed = Math.max(this.peakMaxRed, newMax);
    this.red = Math.min(this.red, newMax);
    // total heart cap: 12 hearts
    if (this.red + this.soul > 24) this.soul = Math.max(0, 24 - this.red);
  }

  heal(halfHearts: number): number {
    if (this.downed) return 0;
    const before = this.red;
    this.red = Math.min(this.maxRed, this.red + halfHearts);
    return this.red - before;
  }

  addSoul(halfHearts: number): void {
    if (this.downed) return;
    this.soul = Math.min(24 - this.red, this.soul + halfHearts);
  }

  // -------------------------------------------------------------- update
  override update(w: World, dt: number): void {
    this.age += dt;
    this.animT += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.dashCD > 0) this.dashCD -= dt;
    if (this.holdT > 0) this.holdT -= dt;
    if (this.spikeCD > 0) this.spikeCD -= dt;
    if (this.releaseT > 0) this.releaseT -= dt;
    this.releaseCooldown = Math.max(0, this.releaseCooldown - dt);
    if (this.emberReadyFlash > 0) this.emberReadyFlash -= dt * 2;
    this.recoil *= Math.exp(-dt * 20);
    this.updateStatuses(w, dt);
    this.updateKnockback(dt);
    this.updateSquash(dt);
    if (!this.alive) {
      if (this.downed) this.updateGhost(w, dt);
      return;
    }

    const s = this.stats;
    const inp = this.input;
    (w.inputSource ?? readLocalInput)(w, this, inp);
    let mv = { x: 0, y: 0 };
    let wantFire = false;
    if (!this.frozen && !w.paused) {
      mv = { x: inp.mx, y: inp.my };
      // aiming: arrow keys / aim stick (aim + fire) > mouse cursor
      if (inp.ax !== 0 || inp.ay !== 0) {
        this.aim = angleOf(inp.ax, inp.ay);
        wantFire = true;
      } else if (inp.held & HELD.cursorAim) {
        this.aim = Math.atan2(inp.cy - (this.y - 6), inp.cx - this.x);
        wantFire = (inp.held & HELD.fire) !== 0;
      } else {
        wantFire = (inp.held & HELD.fire) !== 0;
      }
      const pressed = inp.pressed;
      if (pressed & PRESS.dash) this.dashBuffer = 0.14;
      if (this.dashBuffer > 0) {
        if (this.tryDash(w, mv)) this.dashBuffer = 0;
        else this.dashBuffer -= dt;
      }
      if (pressed & PRESS.bomb) this.placeBomb(w);
      if (pressed & PRESS.active) this.useActive(w);
      if (pressed & PRESS.potion) this.usePotion(w);
      if (pressed & PRESS.release) this.release(w);
      if (pressed & PRESS.swap) this.swapWeapon(w);
      if (pressed & PRESS.interact) w.interact();
    }
    this.firing = wantFire && this.holdT <= 0;

    // movement
    if (this.dashT > 0) {
      const dd = this.character.dash;
      this.dashT -= dt;
      if (dd?.blink) {
        // already at the destination: stand still while re-appearing
        this.vx = 0;
        this.vy = 0;
      } else {
        this.vx = this.dashDX * s.dashSpeed;
        this.vy = this.dashDY * s.dashSpeed;
        this.afterT -= dt;
        if (this.afterT <= 0) {
          this.afterT = 0.03;
          w.spawn(new Afterimage(this.frameName(), this.x, this.y, this.flip, dd?.color ?? this.character.lightColor ?? '#7ad0ff'));
        }
      }
      dd?.update?.(w, this, dt);
      if (this.dashT <= 0) {
        this.vx *= 0.35;
        this.vy *= 0.35;
        dd?.end?.(w, this);
      }
    } else {
      const speed = s.moveSpeed * this.speedMult() * (this.firing && this.weaponSlowsMove() ? 0.85 : 1);
      const tx = mv.x * speed;
      const ty = mv.y * speed;
      const accel = mv.x || mv.y ? 1100 : 900;
      const dvx = tx - this.vx;
      const dvy = ty - this.vy;
      const dl = Math.hypot(dvx, dvy);
      const maxD = accel * dt;
      if (dl > maxD) {
        this.vx += (dvx / dl) * maxD;
        this.vy += (dvy / dl) * maxD;
      } else {
        this.vx = tx;
        this.vy = ty;
      }
    }
    if (this.dashT <= 0) this.doorAssist(w, mv, dt);
    this.moving = Math.hypot(this.vx, this.vy) > 12;

    const vx = this.vx;
    const vy = this.vy;
    this.vx += this.kbx;
    this.vy += this.kby;
    this.move(w, dt);
    this.vx = vx;
    this.vy = vy;

    // footstep dust (floating characters leave none)
    if (this.moving && !this.dashing && !this.flying && Math.floor(this.animT * 7) !== Math.floor((this.animT - dt) * 7)) {
      w.particles.burst(this.x, this.y + 4, { count: 1, speed: [5, 15], life: [0.2, 0.35], colors: ['#a09080', '#706050'], size: [1, 2], ground: true });
    }

    // facing
    const lookA = this.dashing ? Math.atan2(this.dashDY, this.dashDX) : this.firing || (inp.held & HELD.cursorAim) !== 0 ? this.aim : this.moving ? Math.atan2(this.vy, this.vx) : null;
    if (lookA !== null) {
      const cx = Math.cos(lookA);
      const cy = Math.sin(lookA);
      if (Math.abs(cy) > Math.abs(cx) * 1.1) this.facing = cy < 0 ? 'up' : 'down';
      else this.facing = 'side';
      this.flip = cx < 0;
    }

    // weapon
    const wdef = Weapons.get(this.weaponId);
    this.weapon.cooldown -= dt;
    this.weapon.sinceAttack += dt;
    if (this.weapon.comboTimer > 0) this.weapon.comboTimer -= dt;
    else this.weapon.combo = 0;
    if (wdef && !this.dashing) wdef.update(w, this, this.weapon, dt, this.firing, this.aim);
    tickHolstered(this, dt);

    // active item timed charge
    const act = this.activeId ? Actives.get(this.activeId) : undefined;
    if (act) {
      if (act.timed && this.activeCharge < act.charge) {
        this.activeCharge = Math.min(act.charge, this.activeCharge + dt);
        if (this.activeCharge >= act.charge) w.sfx('active_ready');
      }
      act.onUpdate?.(w, dt);
    }

    // hazards
    const tile = w.room.tileAtPx(this.x, this.y + 2);
    if (tile === Tile.SPIKES && !this.flying && this.spikeCD <= 0 && w.time > 0.3 && spikeState(w.roomTime, w.node.cleared).active) {
      this.spikeCD = 0.6;
      this.hurt(w, 1, '가시 함정');
    }
  }

  /**
   * Co-op: a downed keeper drifts around as a translucent ghost (movement only,
   * over pits; no attacks, dash, items or interact) until a teammate revives them.
   */
  private updateGhost(w: World, dt: number): void {
    const inp = this.input;
    (w.inputSource ?? readLocalInput)(w, this, inp);
    this.firing = false;
    this.dashT = 0;
    const speed = this.stats.moveSpeed * 0.8;
    const k = 1 - Math.exp(-dt * 10);
    this.vx += (inp.mx * speed - this.vx) * k;
    this.vy += (inp.my * speed - this.vy) * k;
    this.moving = Math.hypot(this.vx, this.vy) > 12;
    if (this.moving) {
      this.facing = Math.abs(this.vy) > Math.abs(this.vx) * 1.1 ? (this.vy < 0 ? 'up' : 'down') : 'side';
      this.flip = this.vx < 0;
    }
    const fly = this.flying;
    this.flying = true;
    this.vx += this.kbx;
    this.vy += this.kby;
    this.move(w, dt);
    this.vx -= this.kbx;
    this.vy -= this.kby;
    this.flying = fly;
  }

  /** Gain embers (called when dealing damage). */
  addEmber(amount: number): void {
    const before = this.ember;
    this.ember = Math.min(EMBER_MAX, this.ember + amount * (1 + this.stats.luck * 0.02));
    if (before < EMBER_MAX && this.ember >= EMBER_MAX) this.emberReadyFlash = 1;
  }

  emberReadyFlash = 0;

  /** "등불 해방" — spend a full ember gauge on the character's special move. */
  release(w: World): void {
    if (this.ember < EMBER_MAX || this.holdT > 0 || this.releaseCooldown > 0) {
      if (this.ember < EMBER_MAX) w.sfx('ui_error', { vol: 0.4 });
      return;
    }
    this.ember = 0;
    this.releaseCooldown = RELEASE_COOLDOWN;
    this.releaseT = 0.5;
    this.invuln = Math.max(this.invuln, 0.6);
    w.run.stats.releases++;
    if (this.character.release) this.character.release(w, this);
    else defaultRelease(w, this);
    w.items.onRelease();
  }

  /** Switch to the weapon in the second slot (no-op when it is empty). */
  swapWeapon(w: World): boolean {
    return swapWeapons(w, this);
  }

  /**
   * Take weapon `id` into the hands: fills the empty second slot first (the old
   * weapon goes to the back); with both slots full the current weapon is
   * replaced and its id returned so the caller can drop it.
   */
  equipWeapon(w: World, id: string): string | null {
    return equipWeapon(w, this, id);
  }

  weaponSlowsMove(): boolean {
    return Weapons.get(this.weaponId)?.kind === 'charge';
  }

  /**
   * Doorways are one tile wide: when pushing into an open door slightly off-center,
   * slide sideways toward its middle instead of snagging on the frame.
   */
  private doorAssist(w: World, mv: { x: number; y: number }, dt: number): void {
    if (!mv.x && !mv.y) return;
    for (const d of w.room.doors) {
      if (d.state !== 'open' || d.open < 0.6) continue;
      const v = DIR_VEC[d.dir];
      if (mv.x * v.x + mv.y * v.y < 0.5) continue;
      const along = v.x !== 0 ? (this.x - d.x) * v.x : (this.y - d.y) * v.y;
      if (along < -12 || along > 8) continue;
      const off = v.x !== 0 ? this.y - d.y : this.x - d.x;
      if (Math.abs(off) < 0.25 || Math.abs(off) > 12) continue;
      const slide = -Math.sign(off) * Math.min(Math.abs(off) / dt, this.stats.moveSpeed);
      if (v.x !== 0) this.vy = slide;
      else this.vx = slide;
      return;
    }
  }

  /**
   * Start a dash toward the move input (or the aim). Returns false while on
   * cooldown. The character's `dash` (DashDef) adds i-frames, a blink and its
   * start / update / end hooks on top of the plain rush.
   */
  tryDash(w: World, mv: { x: number; y: number }): boolean {
    if (this.dashCD > 0 || this.dashing) return false;
    let d = norm(mv.x, mv.y);
    if (d.x === 0 && d.y === 0) d = fromAngle(this.aim);
    const dd = this.character.dash;
    this.dashDX = d.x;
    this.dashDY = d.y;
    this.dashX0 = this.x;
    this.dashY0 = this.y;
    this.dashT = this.stats.dashTime;
    this.dashCD = this.stats.dashCooldown;
    this.invuln = Math.max(this.invuln, this.stats.dashTime + (dd?.iframes ?? 0.06));
    this.squash(1.3, 0.75);
    w.sfx(dd?.sfx ?? 'dash');
    w.particles.burst(this.x, this.y + 3, { count: 8, speed: [20, 60], angle: Math.atan2(-d.y, -d.x), spread: 1.2, life: [0.2, 0.4], colors: ['#d0c8c0', '#908070'], size: [1, 2] });
    if (dd?.blink) this.blink(w, d.x, d.y, this.stats.dashSpeed * this.stats.dashTime);
    dd?.start?.(w, this);
    w.items.onDash();
    return true;
  }

  /**
   * Blink dash: jump to the farthest point along (dx, dy) within `len` px that
   * the keeper can stand on; the path may cross pits and enemies but stops at
   * walls and rocks. Leaves an after-image at the origin.
   */
  private blink(w: World, dx: number, dy: number, len: number): void {
    let bx = this.x;
    let by = this.y;
    for (let s = 4; s <= len; s += 4) {
      const nx = this.x + dx * s;
      const ny = this.y + dy * s;
      if (w.room.boxBlocked(nx, ny, this.r, true, this.phasing)) break;
      if (!w.room.boxBlocked(nx, ny, this.r, this.flying, this.phasing)) {
        bx = nx;
        by = ny;
      }
    }
    w.spawn(new Afterimage(this.frameName(), this.x, this.y, this.flip, this.character.dash?.color ?? this.character.lightColor ?? '#7ad0ff', 0.35));
    this.x = bx;
    this.y = by;
  }

  placeBomb(w: World): void {
    if (this.bombs <= 0) return;
    if (!(this.stats.thrift > 0 && w.rng.chance(this.stats.thrift))) this.bombs--;
    const b = new Bomb(this.x, this.y + 2, 'player', 1.5, 60 + this.stats.damage * 2);
    w.spawn(b);
    w.sfx('bomb_place');
    w.items.onBomb(this.x, this.y);
  }

  useActive(w: World): void {
    if (!this.activeId) return;
    const def = Actives.get(this.activeId);
    if (!def) return;
    if (this.activeCharge < def.charge) {
      w.sfx('ui_error', { vol: 0.5 });
      return;
    }
    const r = def.use(w);
    if (r === false) return;
    this.activeCharge = 0;
    w.sfx('active_use');
    w.run.stats.activesUsed++;
  }

  usePotion(w: World): void {
    if (!this.potionId) return;
    const def = Potions.get(this.potionId);
    this.potionId = null;
    if (!def) return;
    const known = w.run.identified.has(def.id);
    w.run.identified.add(def.id);
    w.sfx('potion');
    w.banner(def.name, def.desc, { icon: null, color: def.nature === 'bad' ? '#ff7070' : def.nature === 'good' ? '#8aff8a' : '#ffe080', small: known });
    def.use(w);
  }

  /** Give the player an active item; returns the replaced one (to drop). */
  setActive(id: string, w: World): string | null {
    const old = this.activeId;
    this.activeId = id;
    const def = Actives.get(id);
    this.activeCharge = def ? def.charge : 0;
    w.sfx('item_get');
    return old;
  }

  // -------------------------------------------------------------- attacks
  /**
   * Fire the standard volley of player projectiles toward `angle` using current
   * stats (multishot, size, speed, range, pierce, bounce, homing ...).
   */
  fireProjectiles(w: World, angle: number, o: Partial<ProjectileOpts> & { damageMult?: number; count?: number; spreadMult?: number; noHooks?: boolean } = {}): Projectile[] {
    const s = this.stats;
    const count = o.count ?? s.shots;
    const out: Projectile[] = [];
    const spread = s.spread * (o.spreadMult ?? 1);
    for (const a of fanAngles(angle, count, spread)) {
      const jitter = this.flags.has('inaccurate') ? (w.rng.next() - 0.5) * 0.3 : 0;
      const ang = a + jitter;
      const p = new Projectile({
        team: 'player',
        x: this.x + Math.cos(ang) * 6,
        y: this.y - 5 + Math.sin(ang) * 4,
        angle: ang,
        speed: s.shotSpeed,
        damage: s.damage * (o.damageMult ?? 1),
        radius: s.projSize,
        range: s.range,
        owner: this,
        pierce: s.pierce + (this.flags.has('pierceAll') ? 99 : 0),
        bounce: s.bounce,
        homing: s.homing,
        spectral: this.flags.has('spectral'),
        color: this.character.lightColor ?? '#9fd8ff',
        knockback: s.knockback,
        fromWeapon: true,
        ...o,
      });
      // inherit a little of the player's movement (Isaac feel)
      p.vx += this.vx * 0.25;
      p.vy += this.vy * 0.25;
      p.angle = Math.atan2(p.vy, p.vx);
      p.speed = Math.hypot(p.vx, p.vy);
      w.spawn(p);
      out.push(p);
      if (!o.noHooks) w.items.onShoot(p);
    }
    this.recoil = 2;
    this.lastAttackAt = w.time;
    return out;
  }

  /** Spawn a melee swing. Damage defaults to stats.damage. */
  swing(w: World, o: Partial<SwingOpts> & { angle: number }): MeleeSwing {
    const s = this.stats;
    const sw = new MeleeSwing(this, {
      arc: 2.0,
      reach: 22 + s.range * 0.06,
      damage: s.damage,
      knockback: s.knockback * 2,
      color: this.character.lightColor ?? '#ffffff',
      ...o,
    });
    w.spawn(sw);
    this.lastAttackAt = w.time;
    this.recoil = -3;
    return sw;
  }

  // -------------------------------------------------------------- damage
  /**
   * Player takes `halfHearts` damage. Returns true if damage was applied. The
   * amount is scaled by the floor's enemy damage (FloorDef.enemyDamage) unless
   * `raw` (the keeper's own bombs, status ticks).
   */
  hurt(w: World, halfHearts: number, source = '???', raw = false, origin?: { x: number; y: number }): boolean {
    if (!this.alive || this.invuln > 0 || this.god || w.transitioning) return false;
    // co-op: the hurt keeper's items react (onHurt) and its death downs it
    if (w.coop && w.player !== this) return w.asPlayer(this, () => this.hurt(w, halfHearts, source, raw, origin));
    // co-op: screen shake / flash only for this peer's own keeper
    const own = !w.coop || this === w.local;
    if (this.shields > 0) {
      this.shields--;
      this.invuln = Math.max(this.invuln, 0.6);
      w.sfx('shield_block');
      if (own) w.shake(0.2);
      w.spawn(new RingFx(this.x, this.y - 6, 26, 0.35, '#c8f0ff', 2));
      w.particles.burst(this.x, this.y - 6, { count: 16, speed: [40, 120], life: [0.2, 0.5], colors: ['#ffffff', '#c8f0ff', '#70b0ff'], size: [1, 2], shape: 'spark' });
      return false;
    }
    if (this.stats.dodge > 0 && w.rng.chance(this.stats.dodge)) {
      this.invuln = 0.4;
      w.floatText(this.x, this.y - 16, 'MISS', '#c0e0ff');
      w.sfx('shield_block');
      return false;
    }
    halfHearts = raw ? Math.max(1, Math.round(halfHearts)) : enemyHitDamage(w.floor, halfHearts);
    let dmg = halfHearts;
    const fromSoul = Math.min(this.soul, dmg);
    this.soul -= fromSoul;
    dmg -= fromSoul;
    this.red = Math.max(0, this.red - dmg);
    this.invuln = this.stats.invuln;
    this.flash = 0.15;
    this.lastHurtAt = w.time;
    w.run.stats.damageTaken += halfHearts;
    w.run.lastDamageSource = source;
    // feedback scales with the hit (1 = normal, 2+ = heavy attack)
    const heavy = Math.max(0, Math.round(halfHearts) - 1);
    if (own) w.shake(0.42 + 0.15 * heavy);
    w.hitstop(0.08 + 0.025 * heavy);
    if (own) {
      w.renderer.screenFlash('#ff2030', 0.24 + 0.08 * heavy);
      w.playerHurtFx?.(halfHearts, origin);
    }
    w.floatText(this.x, this.y - 22, `-${halfHearts / 2}♥`, fromSoul === halfHearts ? '#a8c8ff' : '#ff7a8a');
    this.squash(0.72, 1.3);
    w.sfx('player_hurt', { pitch: heavy ? 0.9 : 1 });
    w.spawn(new RingFx(this.x, this.y - 6, 16 + 6 * heavy, 0.25, '#ff5060', 2));
    w.particles.burst(this.x, this.y - 6, { count: 14 + 6 * heavy, speed: [40, 120], life: [0.3, 0.6], colors: ['#ff5060', '#c01828', '#800010'], size: [1, 2], gravity: 300, vz: [40, 100] });
    w.items.onHurt(halfHearts);
    if (!this.alive) w.playerDied(source);
    return true;
  }

  /** Enemy-side Actor API: interpret damage as half hearts. */
  override takeHit(w: World, hit: HitInfo): boolean {
    return this.hurt(w, hit.damage, hit.attacker && 'def' in hit.attacker ? (hit.attacker as { def: { name: string } }).def.name : '???', false, hit.source ?? hit.attacker ?? undefined);
  }

  // -------------------------------------------------------------- drawing
  private animName(): string {
    const pre = this.character.spritePrefix;
    if (this.dashing && hasAnim(`${pre}_dash_${this.facing}`)) return `${pre}_dash_${this.facing}`;
    if (this.dashing && hasAnim(`${pre}_dash`)) return `${pre}_dash`;
    if (this.flash > 0 && hasAnim(`${pre}_hurt`)) return `${pre}_hurt`;
    const kind = this.moving ? 'walk' : 'idle';
    const n = `${pre}_${kind}_${this.facing}`;
    if (hasAnim(n) || hasSprite(n)) return n;
    return `${pre}_idle_down`;
  }

  frameName(): string {
    const a = this.animName();
    return hasAnim(a) ? animFrame(a, this.animT) : a;
  }

  override draw(r: Renderer, w: World): void {
    if (this.dead) return;
    if (this.fall > 0) {
      this.drawFalling(r);
      return;
    }
    if (this.downed) {
      this.drawGhost(r);
      return;
    }
    const blink = this.invuln > 0 && !this.dashing && Math.floor(this.invuln * 14) % 2 === 0;
    // flying characters hover a little above their (smaller) shadow
    const hover = this.flying ? 2 + Math.sin(this.age * 3.2) : 0;
    r.shadow(this.x, this.y + 4, this.flying ? 9 : 11, this.flying ? 3 : 4, this.flying ? 0.25 : 0.35);
    const wdef = Weapons.get(this.weaponId);
    const behind = this.facing === 'up';
    if (!behind) drawBackWeapon(r, this, hover);
    if (behind) this.drawWeapon(r, w, wdef);
    const tint = this.statusTint();
    r.sprite(this.frameName(), this.x, this.y + 5 - this.z - hover, {
      flipX: this.flip,
      sx: this.squashX,
      sy: this.squashY,
      alpha: blink ? 0.35 : 1,
      flash: this.flash > 0 ? 0.8 : 0,
      tint: tint?.color,
      tintAmount: tint?.amount,
    });
    if (behind) drawBackWeapon(r, this, hover);
    if (!behind) this.drawWeapon(r, w, wdef);
    w.items.draw(r);
    if (this.holdT > 0 && this.holdIcon) {
      const t = clamp(1 - this.holdT / 1.0, 0, 1);
      r.sprite(this.holdIcon, this.x, this.y - 26 - Math.min(1, t * 4) * 4);
    }
  }

  /** Co-op downed keeper: a pale, floating, see-through lantern ghost. */
  private drawGhost(r: Renderer): void {
    const bob = Math.sin(this.age * 2.6) * 1.5;
    r.shadow(this.x, this.y + 4, 8, 3, 0.15);
    r.sprite(this.frameName(), this.x, this.y + 1 + bob, {
      flipX: this.flip,
      alpha: 0.42 + 0.08 * Math.sin(this.age * 5),
      tint: '#a8d8ff',
      tintAmount: 0.6,
    });
  }

  /** Trapdoor fall: shrink, spin a little and sink into the hole. */
  private drawFalling(r: Renderer): void {
    const f = this.fall;
    const s = 1 - f * 0.85;
    r.shadow(this.x, this.y + 2, 11 * s, 4 * s, 0.35 * (1 - f));
    r.sprite(this.frameName(), this.x, this.y + 3 + f * 4, {
      flipX: this.flip,
      sx: s * (1 + Math.sin(f * 9) * 0.08),
      sy: s,
      rot: f * f * 1.6 * (this.flip ? -1 : 1),
      alpha: f > 0.75 ? Math.max(0, (1 - f) / 0.25) : 1,
      tint: '#140c1c',
      tintAmount: f * 0.7,
    });
  }

  private drawWeapon(r: Renderer, w: World, wdef = Weapons.get(this.weaponId)): void {
    // `weapon.mem.hideUntil` lets special moves hide the held weapon for a moment
    if (!wdef || this.holdT > 0 || (this.weapon.mem.hideUntil ?? -1) > w.time) return;
    withSwapPop(r, w, this, () => {
      if (wdef.draw) {
        wdef.draw(w, this, r, this.weapon);
        return;
      }
      if (!wdef.heldSprite) return;
      const a = this.aim;
      const dist = 7 + this.recoil;
      r.sprite(wdef.heldSprite, this.x + Math.cos(a) * dist, this.y - 5 + Math.sin(a) * dist * 0.8, {
        rot: a,
        flipY: Math.cos(a) < 0,
      });
    });
  }

  override light(w: World): void {
    if (this.downed) {
      w.lights.add(this.x, this.y - 4, 34, '#a8d8ff', { intensity: 0.5 });
      return;
    }
    const fl = (1 + Math.sin(this.age * 9) * 0.03 + Math.sin(this.age * 23) * 0.02) * (1 - this.fall * 0.6);
    w.lights.add(this.x, this.y - 6, (this.character.lightRadius ?? 95) * fl, this.character.lightColor ?? '#ffd8a0', { intensity: 0.95 });
    w.lights.add(this.x, this.y - 6, 30, '#ffffff', { intensity: 0.35 });
  }
}

export { fx };
