// World objects the player interacts with: pickups (coins, health, blue flames,
// matches, potions), item pedestals (free or for sale), chests (a sealed one
// opens with a match), fireplaces and the trapdoor to the next floor.

import { Actor, Entity, type HitInfo } from './entity';
import type { World } from './world';
import { heartCostKind } from './heart-cost';
import type { Renderer } from '../engine/renderer';
import { Actives, Artifacts, Potions, RARITY_COLOR, Weapons, type Rarity } from './defs';
import { fx } from '../engine/rng';
import { clamp, dist } from '../engine/math';
import { orbSprite } from './projectile';
import { defineDrawnSprite } from '../engine/sprites';
import { ramp } from '../engine/painter';
import { sceneSprite } from '../ui/pixellab-scenery';
import { PREVIEW_RANGE } from './interact';
import { STAGES_PER_FLOOR } from './stage-plan';
import { MATCH_CAP, matchCard, tryLightWithMatch } from './matches';

export type PickupKind =
  | 'coin' | 'coin_string'
  | 'heart_half' | 'heart' | 'blue_flame' | 'blue_flame_half'
  | 'match' | 'matchbox' | 'potion';

/** Still sprite per pickup kind (preview cards, touch buttons; blue flames also animate in the world). */
export const PICKUP_SPRITE: Record<PickupKind, string> = {
  coin: 'pk_coin', coin_string: 'pk_coin_string',
  heart_half: 'pk_heart_half', heart: 'pk_heart', blue_flame: 'pk_blue_flame', blue_flame_half: 'pk_blue_flame_half',
  match: 'pk_match', matchbox: 'pk_matchbox', potion: 'pk_potion',
};

/** World animation per pickup kind (drawn instead of the still sprite). */
const PICKUP_ANIM: Partial<Record<PickupKind, string>> = {
  blue_flame: 'pk_blue_flame_anim', blue_flame_half: 'pk_blue_flame_half_anim',
};

const GOLDEN_ANGLE = 2.399963229728653;

function frac(v: number): number {
  return v - Math.floor(v);
}

export class Pickup extends Entity {
  override readonly worldLoot = true;
  kind: PickupKind;
  /** shop price (0 = free) */
  price = 0;
  /** potion id for kind 'potion' */
  potionId = '';
  /** can't be picked up for a short while after spawning (so drops are visible) */
  grace = 0.35;
  /** swapped-out potion: not collected (or magnet-pulled) until the player steps away once */
  waitForLeave = false;
  bobT = fx.range(0, 6);

  constructor(kind: PickupKind, x: number, y: number) {
    super();
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.r = 5;
    this.persistent = true;
    this.layer = 1;
  }

  /**
   * Give it a little hop outward when dropped. The default direction / strength
   * spread consecutive drops evenly (golden angle over the entity id): no RNG,
   * so the landing spot is identical on every lockstep peer.
   */
  pop(angle = this.id * GOLDEN_ANGLE, speed = 40 + 50 * frac(this.id * 0.6180339887)): this {
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.vz = 90 + 50 * frac(this.id * 0.7548776662);
    this.z = 1;
    return this;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.bobT += dt;
    if (this.grace > 0) this.grace -= dt;
    // z physics
    if (this.z > 0 || this.vz !== 0) {
      this.vz -= 500 * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        this.vz = Math.abs(this.vz) > 60 ? -this.vz * 0.35 : 0;
      }
    }
    // friction
    const k = Math.exp(-dt * (this.z > 0 ? 1 : 6));
    this.vx *= k;
    this.vy *= k;
    const p = w.player;
    const d = dist(this.x, this.y, p.x, p.y);
    if (this.waitForLeave && d > this.r + p.r + 8) this.waitForLeave = false;
    // magnet (free pickups only; never pulls a potion into a full hand)
    if (this.price === 0 && this.grace <= 0 && d < p.stats.magnet + 10 && this.canCollect(w) && !(this.kind === 'potion' && p.potionId)) {
      const pull = 260 * (1 - d / (p.stats.magnet + 10)) + 30;
      this.vx += ((p.x - this.x) / (d || 1)) * pull * dt * 6;
      this.vy += ((p.y - this.y) / (d || 1)) * pull * dt * 6;
    }
    this.move(w, dt);
    if (this.price === 0 && this.grace <= 0 && !this.waitForLeave && d < this.r + p.r + 1 && this.z < 6 && !p.dead) this.tryCollect(w);
  }

  /** shop wares and potions show a preview card when the keeper comes close */
  override previewable(): boolean {
    return (this.price > 0 || this.kind === 'potion') && this.z < 6 && !this.dead;
  }

  canCollect(w: World): boolean {
    const p = w.player;
    switch (this.kind) {
      case 'heart_half':
      case 'heart':
        // 'overheal' keepers (보리's rescue barrel) store hearts they cannot use
        return p.red < p.maxRed || p.flags.has('overheal');
      case 'blue_flame':
      case 'blue_flame_half':
        return p.red + p.soul < 24;
      case 'match':
      case 'matchbox':
        // a full purse leaves them lying (not magnet-pulled, not for sale)
        return p.matches < MATCH_CAP;
      default:
        return true;
    }
  }

  override interact(w: World): boolean {
    if (this.price <= 0 || !this.previewable() || this.grace > 0 || dist(this.x, this.y, w.player.x, w.player.y) >= PREVIEW_RANGE) return false;
    return this.tryCollect(w);
  }

  tryCollect(w: World): boolean {
    if (this.dead || !w.player.alive || w.player.downed || !this.canCollect(w)) return false;
    const p = w.player;
    if (this.price > 0) {
      if (p.coins < this.price) {
        if (!this.mem.noMoneyT || w.time - this.mem.noMoneyT > 1) {
          w.sfx('no_money');
          this.mem.noMoneyT = w.time;
        }
        return false;
      }
      p.coins -= this.price;
      w.sfx('buy');
      w.run.stats.coinsSpent += this.price;
    }
    this.dead = true;
    w.collectPickup(this);
    return true;
  }

  mem: Record<string, number> = {};

  override draw(r: Renderer, w: World): void {
    const bob = this.z > 0 ? 0 : Math.sin(this.bobT * 3) * 0.6;
    r.shadow(this.x, this.y + 3, 8, 3, 0.3);
    let name = PICKUP_SPRITE[this.kind];
    if (this.kind === 'potion') name = potionSpriteFor(w, this.potionId);
    const shine = Math.floor(this.bobT * 2) % 5 === 0 ? 0.25 : 0;
    const anim = PICKUP_ANIM[this.kind];
    if (anim) r.anim(anim, this.bobT, this.x, this.y - this.z - 2 + bob);
    else r.sprite(name, this.x, this.y - this.z - 2 + bob, { flash: shine });
    if (this.price > 0) {
      const col = w.player.coins >= this.price ? '#ffffff' : '#ff7070';
      r.pixelText(`${this.price}`, this.x, this.y + 6, col, { align: 'center', outline: '#140c1c' });
    }
  }

  override light(w: World): void {
    if (this.kind === 'blue_flame' || this.kind === 'blue_flame_half') w.lights.add(this.x, this.y, 22, '#8ab0ff', { intensity: 0.6 });
    else if (this.kind === 'coin' || this.kind === 'coin_string') w.lights.add(this.x, this.y, 14, '#ffd060', { intensity: 0.4 });
    else if (this.kind === 'match' || this.kind === 'matchbox') w.lights.add(this.x, this.y - 3, 10, '#ffb060', { intensity: 0.35 });
  }
}

/** Sprite name for a potion pickup in this run (unidentified potions look like colored flasks). */
export function potionSpriteFor(w: World, potionId: string): string {
  const color = w.run.potionColors[potionId] ?? '#c04a6a';
  return potionFlask(color);
}

const flaskCache = new Set<string>();
/** Sprite of a potion flask filled with `color` (defined lazily). */
export function potionFlask(color: string): string {
  const name = `__flask_${color}`;
  if (flaskCache.has(name)) return name;
  flaskCache.add(name);
  defineDrawnSprite(name, 9, 12, (p) => {
    p.rect(3, 0, 3, 1, '#a07850');
    p.rect(3, 1, 3, 3, '#d8e8f0');
    p.ellipse(4.5, 7.5, 4.2, 4.2, '#d8e8f0');
    p.ellipse(4.5, 8, 3.4, 3.2, color);
    p.shadeSphere(4.5, 8, 3.6, 3.4, ramp(color, 4));
    p.px(2, 6, '#ffffff');
    p.px(3, 2, '#ffffff');
  }, { outline: '#140c1c' });
  return name;
}

// ------------------------------------------------------------------ pedestals
export type PedestalItemKind = 'artifact' | 'active' | 'weapon';

export interface PedestalItem {
  temper?: number;
  kind: PedestalItemKind;
  id: string;
  /** an active item put down by a keeper keeps its charge (unset: full) */
  charge?: number;
}

export function itemInfo(it: PedestalItem): { name: string; desc: string; detail?: string; icon: string; rarity: Rarity; quote?: string } {
  switch (it.kind) {
    case 'artifact': {
      const d = Artifacts.must(it.id);
      return { name: d.name, desc: d.desc, detail: d.detail, icon: d.icon, rarity: d.rarity, quote: d.quote };
    }
    case 'active': {
      const d = Actives.must(it.id);
      return { name: d.name, desc: d.desc, icon: d.icon, rarity: d.rarity, quote: d.quote };
    }
    case 'weapon': {
      const d = Weapons.must(it.id);
      const temper = it.temper ?? 0;
      return { name: d.name + (temper ? ` [${temper > 0 ? '+' : ''}${temper}]` : ''), desc: d.desc + (temper ? ` · 제련: 무기 피해 ${100 + temper * 10}%` : ''), icon: d.icon, rarity: d.rarity };
    }
  }
}

export class Pedestal extends Entity {
  override readonly worldLoot = true;
  item: PedestalItem | null;
  price = 0;
  /** pedestals sharing a choice group vanish when one of them is taken */
  group = 0;
  /** blocks pickup until the player steps away once (after swapping) */
  waitForLeave = false;
  /** optional: costs hearts instead of coins (대가의 방, 성소) */
  heartPrice = 0;
  bobT = fx.range(0, 6);
  spawnFx = 0.5;

  constructor(x: number, y: number, item: PedestalItem | null) {
    super();
    this.x = x;
    this.y = y;
    this.item = item;
    this.r = 7;
    this.persistent = true;
    this.solid = false;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.bobT += dt;
    if (this.spawnFx > 0) this.spawnFx -= dt;
    if (w.focus === this) this.focusT = Math.min(1, this.focusT + dt * 6);
    else if (this.focusT > 0) this.focusT = Math.max(0, this.focusT - dt * 4);
    // items are no longer taken on touch: the keeper reads the preview card and
    // presses 'interact' (World.interact). `waitForLeave` only matters to bots now.
    if (this.waitForLeave && dist(this.x, this.y, w.player.x, w.player.y) > 20) this.waitForLeave = false;
  }

  override previewable(): boolean {
    return !!this.item && !this.dead;
  }

  /** the price (coins or hearts) can be paid right now */
  affordable(w: World): boolean {
    const p = w.player;
    if (this.price > 0 && p.coins < this.price) return false;
    if (this.heartPrice > 0 && !heartCostKind(p, this.heartPrice)) return false;
    return true;
  }

  mem: Record<string, number> = {};
  /** 0..1 highlight while this is the keeper's focus (preview card shown) */
  focusT = 0;

  override draw(r: Renderer, w: World): void {
    // stone pedestal
    r.sprite('pedestal', this.x, this.y + 6);
    if (!this.item) return;
    const info = itemInfo(this.item);
    const bob = Math.sin(this.bobT * 2.4) * 2;
    const y = this.y - 10 + bob;
    r.shadow(this.x, this.y - 1, 10 - bob, 3, 0.25);
    const glowCol = RARITY_COLOR[info.rarity];
    const f = this.focusT;
    r.sprite(orbSprite(16, glowCol), this.x, y, { alpha: 0.12 + 0.05 * Math.sin(this.bobT * 4) + f * 0.16, additive: true });
    // focused (preview card open): a soft rarity ring on the pedestal top
    if (f > 0.02) r.ring(this.x, this.y + 3, 9 + (1 - f) * 3, glowCol, 1, f * (0.45 + 0.2 * Math.sin(this.bobT * 6)));
    r.sprite(info.icon, this.x, y, { flash: this.spawnFx > 0 ? this.spawnFx * 2 : f * 0.12 * (1 + Math.sin(this.bobT * 6)) });
    if (this.price > 0) {
      const col = w.player.coins >= this.price ? '#ffe680' : '#ff7070';
      r.pixelText(`${this.price}`, this.x, this.y + 9, col, { align: 'center', outline: '#140c1c' });
    }
    if (this.heartPrice > 0) {
      r.pixelText(`${this.heartPrice}`, this.x - 3, this.y + 9, '#ff5060', { align: 'center', outline: '#140c1c' });
      r.sprite('pk_heart', this.x + 5, this.y + 11);
    }
  }

  override light(w: World): void {
    if (!this.item) return;
    const info = itemInfo(this.item);
    w.lights.add(this.x, this.y - 10, 40, RARITY_COLOR[info.rarity], { intensity: 0.7 });
  }
}

// ------------------------------------------------------------------ chests
/**
 * A chest. A plain one opens when a keeper touches it; a sealed one (red wax
 * seal and cords over the lid) opens only when a keeper lights it with a match
 * through 'interact' (never by brushing past).
 */
export class Chest extends Entity {
  override readonly worldLoot = true;
  mem: Record<string, number> = {};
  locked: boolean;
  opened = false;
  constructor(x: number, y: number, locked = false) {
    super();
    this.x = x;
    this.y = y;
    this.locked = locked;
    this.r = 7;
    this.persistent = true;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.opened || this.locked) return;
    const p = w.player;
    if (!p.alive || p.downed) return;
    if (dist(this.x, this.y, p.x, p.y) < this.r + p.r + 1) {
      this.opened = true;
      w.openChest(this);
    }
  }

  override previewable(): boolean {
    return this.locked && !this.opened && !this.dead;
  }

  override interactionInfo(w?: World) {
    if (!w) return { name: '봉랍 상자', desc: '성냥으로 봉랍을 녹이면 열린다.', icon: 'icon_seal', actionLabel: '불 붙이기', available: false, price: { icon: 'hud_match', text: '1', ok: false } };
    return matchCard(w, { name: '봉랍 상자', desc: '성냥으로 봉랍을 녹이면 열린다.' });
  }

  override interact(w: World): boolean {
    if (!this.previewable() || !w.entities.includes(this)) return false;
    if (!tryLightWithMatch(w, this, false)) return false;
    this.opened = true;
    w.sfx('seal_burn', { x: this.x });
    w.particles.burst(this.x, this.y - 5, { count: 10, speed: [10, 40], life: [0.4, 0.8], colors: ['#ff6050', '#c02a2a', '#8a1a1a'], size: [1, 2], gravity: 260, vz: [10, 40] });
    w.particles.burst(this.x, this.y - 6, { count: 8, speed: [10, 30], life: [0.3, 0.6], colors: ['#ffffff', '#ffd060', '#ff8a30'], size: [1, 1], additive: true });
    w.openChest(this);
    return true;
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y + 4, 14, 4, 0.3);
    const base = this.locked ? 'chest_gold' : 'chest';
    r.sprite(sceneSprite(this.opened ? `${base}_open` : base), this.x, this.y);
    if (this.locked && !this.opened) r.sprite('chest_seal', this.x, this.y);
  }
}

// ------------------------------------------------------------------ fireplace
export class FirePlace extends Actor {
  lit = true;
  /** blue fire: harder, drops more */
  blue: boolean;
  constructor(x: number, y: number, blue = false) {
    super();
    this.x = x;
    this.y = y;
    this.r = 6;
    this.team = 'neutral';
    this.maxHp = this.hp = blue ? 40 : 22;
    this.blue = blue;
    this.persistent = true;
    this.solid = false;
    this.mass = Infinity;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.flash > 0) this.flash -= dt;
    if (!this.lit) return;
    for (const p of w.coop ? w.players : [w.player]) if (dist(this.x, this.y, p.x, p.y) < this.r + p.r - 1) p.hurt(w, 1, '모닥불');
    if (fx.chance(dt * 14)) {
      w.particles.spawn({
        x: this.x + fx.range(-3, 3), y: this.y - 8, vy: -fx.range(15, 35), vx: fx.range(-6, 6), life: fx.range(0.3, 0.7),
        colors: this.blue ? ['#ffffff', '#80d0ff', '#3060ff'] : ['#fff0a0', '#ffb040', '#e04010'], size: fx.range(1, 2), additive: true,
      });
    }
  }

  override takeHit(w: World, hit: HitInfo): boolean {
    if (!this.lit) return false;
    if (hit.attacker && hit.attacker.team !== 'player') return false;
    this.hp -= hit.damage;
    this.flash = 0.08;
    if (this.hp <= 0) {
      this.lit = false;
      w.sfx('fire', { vol: 0.5, pitch: 0.7 });
      w.particles.burst(this.x, this.y - 6, { count: 14, speed: [20, 60], life: [0.3, 0.8], colors: ['#c0c0c0', '#808080', '#404040'], size: [1, 3] });
      w.onFireExtinguished(this);
    }
    return true;
  }

  override draw(r: Renderer): void {
    r.sprite('fireplace_logs', this.x, this.y + 3);
    if (!this.lit) return;
    const s = clamp(this.hp / this.maxHp, 0.35, 1);
    r.anim(this.blue ? 'fire_blue' : 'fire', this.age, this.x, this.y + 1, { sx: s, sy: s, flash: this.flash > 0 ? 0.8 : 0 });
  }

  override light(w: World): void {
    if (!this.lit) return;
    const fl = 1 + Math.sin(this.age * 17) * 0.08;
    w.lights.add(this.x, this.y - 6, 60 * fl * clamp(this.hp / this.maxHp, 0.4, 1), this.blue ? '#70b0ff' : '#ff9a40');
  }
}

// ------------------------------------------------------------------ trapdoor
export class Trapdoor extends Entity {
  /** Opens visually before it can be used. Entry always requires interaction. */
  openT = 0;
  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.r = 8;
    this.layer = 0;
    this.persistent = true;
  }

  override previewable(): boolean {
    return !this.dead && this.openT >= 1;
  }

  override interactionInfo(w?: World) {
    const run = w?.run;
    const nextStage = run?.staged && run.stage < STAGES_PER_FLOOR;
    const returning = run?.campaign && !nextStage && run.floor >= run.targetFloor;
    const destination = !run ? '내려가기' : returning ? '마을로 귀환' :
      nextStage ? `${run.floor}-${run.stage + 1}로 내려가기` :
      run.staged ? `${run.floor + 1}-1로 내려가기` : `${run.floor + 1}층으로 내려가기`;
    const desc = returning ? '원정을 마치고 마을로 돌아갑니다.' :
      nextStage ? '구덩이를 이용해 다음 스테이지로 이동합니다.' : '구덩이를 이용해 다음 층으로 이동합니다.';
    return { name: destination, icon: 'trapdoor', desc: desc + (w?.coop ? ' 팀원 모두 함께 이동합니다.' : ''),
      actionLabel: returning ? '귀환' : '내려가기', available: this.previewable() };
  }

  override interact(w: World): boolean {
    const p = w.player;
    if (!this.previewable() || !p.alive || p.downed || w.paused || w.transitioning || w.descending || w.gameOver ||
      !w.entities.includes(this) || dist(this.x, this.y, p.x, p.y) >= PREVIEW_RANGE) return false;
    w.beginDescend(this.x, this.y);
    return true;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.openT = Math.min(1, this.openT + dt * 1.5);
    // while the keeper falls in, the hole breathes out a little dust
    if (w.descending && fx.chance(dt * 40)) {
      const a = fx.angle();
      w.particles.spawn({
        x: this.x + Math.cos(a) * 9, y: this.y + Math.sin(a) * 4, vx: -Math.cos(a) * 12, vy: -Math.sin(a) * 6 - 4,
        life: fx.range(0.3, 0.5), colors: ['#a090b0', '#504060'], size: 1, drag: 1,
      });
    }
  }

  override draw(r: Renderer): void {
    r.sprite('trapdoor', this.x, this.y, { sy: 0.3 + this.openT * 0.7 });
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, 30, '#b080ff', { intensity: 0.5 });
  }
}

export { Potions };
