// Shop room: a moth-like lamp merchant ("등잔 상인 나비") behind a counter, wares on a
// woven runner, prices under each item. The merchant greets the player, cheers when
// something is bought and shakes his head when the player cannot afford an item.

import { registerRoomHandler } from '../../game/roomkinds';
import { Actives, Artifacts, defaultPrice } from '../../game/defs';
import { Entity } from '../../game/entity';
import { Pedestal, Pickup, itemInfo, type PedestalItem, type PickupKind } from '../../game/pickups';
import type { World } from '../../game/world';
import type { Room } from '../../game/room';
import type { Renderer } from '../../engine/renderer';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { dist } from '../../engine/math';
import { Prop } from '../props/prop';
import { rectRug, withDecals } from './decor';
import { pixelTextCanvas } from './floortext';

const O = '#0c0810';

// ------------------------------------------------------------------ sprites
for (let f = 0; f < 2; f++) {
  defineDrawnSprite(`shopkeep_body_${f}`, 26, 26, (p) => {
    const b = f; // breathing offset
    // feathery antennae
    p.line(9, 6 + b, 5, 0 + b, '#c8b090');
    p.line(16, 6 + b, 20, 0 + b, '#c8b090');
    for (let i = 0; i < 4; i++) {
      p.px(6 + i - 1, 1 + i + b, '#e8d4b0');
      p.px(19 - i + 1, 1 + i + b, '#e8d4b0');
    }
    // cloak body
    p.ellipse(12.5, 18, 10.5, 8, '#5a3e5e');
    p.ellipse(12.5, 11 + b, 8, 7, '#6a4a6e');
    p.shadeSphere(12.5, 14 + b, 11, 11, ['#2a1a30', '#402a46', '#5a3e5e', '#7a5a7e', '#9a7a9a']);
    // fuzzy collar
    for (let x = 5; x <= 20; x++) p.px(x, 16 + b + ((x * 3) % 2), '#d8c4a0');
    for (let x = 6; x <= 19; x += 2) p.px(x, 17 + b, '#b8a080');
    // hood opening
    p.ellipse(12.5, 11 + b, 5, 4, '#120a14');
    // patches on the cloak
    p.rect(4, 20, 3, 3, '#7a6a3a');
    p.px(4, 20, '#a8945a');
    p.rect(18, 19, 2, 3, '#3a5a6a');
  }, { outline: O, origin: [13, 25] });
}

defineDrawnSprite('shopkeep_lantern', 7, 12, (p) => {
  p.rect(3, 0, 1, 3, '#6a5a48');
  p.rect(1, 3, 5, 1, '#8a6a30');
  p.rect(1, 4, 5, 6, '#ffd060');
  p.rect(2, 4, 3, 6, '#fff4c0');
  p.rect(1, 4, 1, 6, '#8a6a30');
  p.rect(5, 4, 1, 6, '#8a6a30');
  p.rect(1, 10, 5, 2, '#8a6a30');
}, { outline: O, origin: [3, 0] });

defineDrawnSprite('shop_counter', 46, 16, (p) => {
  // top plank
  p.rect(0, 0, 46, 4, '#9a6a3a');
  p.rect(0, 0, 46, 1, '#d8a868');
  p.rect(0, 3, 46, 1, '#6a4424');
  // front panel
  p.rect(1, 4, 44, 12, '#6a4426');
  for (let x = 1; x < 45; x++) for (let y = 4; y < 16; y++) {
    if (x % 6 === 0) p.px(x, y, '#4a2e18');
    else if (x % 6 === 1) p.px(x, y, '#7e5634');
  }
  p.rect(1, 15, 44, 1, '#3a2414');
  // cloth banner on the front
  p.rect(16, 4, 14, 8, '#7a1e2a');
  p.rect(16, 4, 14, 1, '#a83a3a');
  for (let x = 16; x < 30; x += 2) p.px(x, 12, '#7a1e2a');
  p.ellipse(23, 8, 2.6, 2.6, '#ffd34a');
  p.px(22, 7, '#fff6c0');
  p.rect(23, 6, 1, 4, '#a07010');
}, { outline: O, origin: [23, 15] });

defineDrawnSprite('shop_wares', 46, 8, (p) => {
  // brass scale
  p.rect(6, 1, 1, 6, '#c8a050');
  p.rect(3, 1, 7, 1, '#e8c070');
  p.rect(2, 2, 3, 1, '#a07830');
  p.rect(8, 2, 3, 1, '#a07830');
  p.rect(4, 7, 5, 1, '#8a6428');
  // coin stack
  for (let i = 0; i < 4; i++) {
    p.rect(36, 6 - i * 1.5, 5, 1, i % 2 ? '#ffd34a' : '#e0a020');
  }
  p.px(37, 1, '#fff6c0');
  // potion jar
  p.rect(28, 3, 4, 5, '#4ac0a0');
  p.rect(28, 2, 4, 1, '#c8e8f0');
  p.rect(29, 1, 2, 1, '#8a6a40');
  p.px(28, 4, '#c0fff0');
}, { outline: O, origin: [23, 7] });

// ------------------------------------------------------------------ speech bubble
/** Short Korean line in a bubble over a speaker (drawn above the lighting). */
export class SpeechBubble extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  text: string;
  follow: Entity;
  life: number;
  oy: number;
  constructor(follow: Entity, text: string, oy = -30, life = 2.2) {
    super();
    this.follow = follow;
    this.text = text;
    this.oy = oy;
    this.life = life;
    this.layer = 3;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    this.x = this.follow.x;
    this.y = this.follow.y + this.oy;
    if (this.age > this.life || this.follow.dead) this.dead = true;
  }

  override draw(r: Renderer): void {
    if (typeof document === 'undefined') return;
    const tc = pixelTextCanvas(this.text, { size: 12, font: 'Galmuri11', color: '#2a1e2e' });
    const pop = this.age < 0.12 ? 0.6 + (this.age / 0.12) * 0.4 : 1;
    const a = this.age > this.life - 0.25 ? (this.life - this.age) / 0.25 : 1;
    const w = Math.round((tc.width + 6) * pop);
    const h = Math.round(15 * pop);
    const x = Math.round(this.x - w / 2 - r.viewX);
    const y = Math.round(this.y - h - r.viewY - (this.age < 0.12 ? 0 : Math.sin(this.age * 3) * 0.5));
    const c = r.ctx;
    c.save();
    c.globalAlpha = a;
    c.fillStyle = '#140c1c';
    c.fillRect(x - 1, y, w + 2, h);
    c.fillRect(x, y - 1, w, h + 2);
    c.fillStyle = '#f4ecdc';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#c8bca8';
    c.fillRect(x, y + h - 1, w, 1);
    // tail
    const tx = Math.round(this.x - r.viewX);
    c.fillStyle = '#140c1c';
    c.fillRect(tx - 2, y + h, 5, 2);
    c.fillRect(tx - 1, y + h + 2, 3, 1);
    c.fillStyle = '#f4ecdc';
    c.fillRect(tx - 1, y + h, 3, 1);
    c.fillRect(tx, y + h + 1, 1, 1);
    if (pop >= 1) c.drawImage(tc, x + 3, y - 1);
    c.restore();
  }
}

// ------------------------------------------------------------------ merchant
const THANKS = ['고맙네!', '좋은 눈썰미군.', '거래 성립!', '또 들르게나.', '현명한 선택이야.'];
const BROKE = ['돈이 모자라는군...', '외상은 안 되네.', '동전을 더 모아 오게.'];
const IDLE = ['천천히 보게나.', '빛나는 건 다 판다네.', '흠흠...', '아래는 더 어둡다네.'];

type Mood = 'idle' | 'happy' | 'sad';

export class Shopkeeper extends Prop {
  mood: Mood = 'idle';
  moodT = 0;
  blinkT = fx.range(1, 3);
  lastSpent = -1;
  greeted = false;
  idleT = fx.range(8, 14);
  brokeT = 0;
  hop = 0;
  hopV = 0;

  constructor(x: number, y: number) {
    super(x, y, 1);
  }

  override get sortY(): number {
    return this.y + 6;
  }

  private say(w: World, text: string): void {
    for (const e of w.entities) if (e instanceof SpeechBubble && e.follow === this) e.dead = true;
    w.spawn(new SpeechBubble(this, text, -30));
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const spent = w.run.stats.coinsSpent;
    if (w.roomTime < 0.25 || this.lastSpent < 0) this.lastSpent = spent;
    if (spent > this.lastSpent) {
      this.lastSpent = spent;
      this.mood = 'happy';
      this.moodT = 1.4;
      this.hopV = 70;
      this.say(w, fx.pick(THANKS));
      w.particles.burst(this.x, this.y - 18, { count: 14, speed: [30, 80], life: [0.4, 0.8], colors: ['#fff6c0', '#ffd34a', '#e0a020'], size: [1, 2], gravity: 160, vz: [30, 70], additive: true });
    }
    const p = w.player;
    if (!this.greeted && w.roomTime > 0.5) {
      this.greeted = true;
      this.say(w, '어서 오게, 등불지기.');
    }
    // the player is touching something too expensive
    this.brokeT -= dt;
    if (this.brokeT <= 0) {
      for (const e of w.entities) {
        const price = e instanceof Pedestal ? (e.item ? e.price : 0) : e instanceof Pickup ? e.price : 0;
        if (price > 0 && p.coins < price && dist(e.x, e.y, p.x, p.y) < 14) {
          this.mood = 'sad';
          this.moodT = 1.2;
          this.brokeT = 4;
          this.say(w, fx.pick(BROKE));
          break;
        }
      }
    }
    this.idleT -= dt;
    if (this.idleT <= 0) {
      this.idleT = fx.range(10, 16);
      if (dist(this.x, this.y, p.x, p.y) < 120 && this.mood === 'idle') this.say(w, fx.pick(IDLE));
    }
    if (this.moodT > 0) {
      this.moodT -= dt;
      if (this.moodT <= 0) this.mood = 'idle';
    }
    this.blinkT -= dt;
    if (this.blinkT < -0.14) this.blinkT = fx.range(2, 4.5);
    // hop physics
    this.hopV -= 400 * dt;
    this.hop = Math.max(0, this.hop + this.hopV * dt);
    if (this.hop === 0 && this.mood === 'happy' && this.moodT > 0.5 && this.hopV < 0) this.hopV = 60;
  }

  override draw(r: Renderer, w: World): void {
    const breath = Math.floor(this.age * 1.6) % 2;
    const shake = this.mood === 'sad' ? Math.round(Math.sin(this.age * 30) * 1.2) : 0;
    const x = this.x + shake;
    const y = this.y - Math.round(this.hop);
    r.shadow(this.x, this.y - 1, 22, 5, 0.3);
    // lantern hanging from a pole held to the side
    const sw = Math.sin(this.age * 1.8) * 1.5;
    r.rect(x + 9, y - 26, 1, 14, '#6a5a48');
    r.rect(x + 9, y - 26, 6, 1, '#6a5a48');
    r.sprite('shopkeep_lantern', x + 14 + sw * 0.4, y - 25);
    r.sprite(`shopkeep_body_${breath}`, x, y);
    // eyes
    const ey = y - 14 + breath;
    const p = w.player;
    const look = Math.max(-1, Math.min(1, (p.x - this.x) / 60));
    const ex = Math.round(look);
    if (this.mood === 'happy') {
      for (const dx of [-3, 2]) {
        r.rect(x + dx - 1 + ex, ey, 1, 1, '#ffd060');
        r.rect(x + dx + ex, ey - 1, 1, 1, '#ffd060');
        r.rect(x + dx + 1 + ex, ey, 1, 1, '#ffd060');
      }
    } else if (this.blinkT < 0) {
      r.rect(x - 4 + ex, ey, 3, 1, '#a07820');
      r.rect(x + 1 + ex, ey, 3, 1, '#a07820');
    } else {
      const half = this.mood === 'sad';
      r.rect(x - 4 + ex, ey - (half ? 0 : 1), 3, half ? 2 : 3, '#ffc840');
      r.rect(x + 1 + ex, ey - (half ? 0 : 1), 3, half ? 2 : 3, '#ffc840');
      r.rect(x - 3 + ex, ey, 1, 1, '#fff6d0');
      r.rect(x + 2 + ex, ey, 1, 1, '#fff6d0');
    }
    // counter in front
    r.sprite('shop_counter', this.x, this.y + 6);
    r.sprite('shop_wares', this.x, this.y - 9);
  }

  override light(w: World): void {
    const sw = Math.sin(this.age * 1.8) * 1.5;
    w.lights.add(this.x + 14 + sw * 0.4, this.y - 20, 80, '#ffc870', { intensity: 0.85 });
    w.lights.glow(this.x + 14, this.y - 20, 8, '#ffd070', 0.3);
  }
}

// ------------------------------------------------------------------ handler
function priceOf(item: PedestalItem): number {
  const info = itemInfo(item);
  const base = item.kind === 'artifact' ? Artifacts.get(item.id)?.price : item.kind === 'active' ? Actives.get(item.id)?.price : undefined;
  return base ?? defaultPrice(info.rarity);
}

function keeperSpot(room: Room): { x: number; y: number } {
  const y = room.interiorY + 20;
  const cands = [room.centerX, room.centerX - 84, room.centerX + 84];
  for (const x of cands) if (!room.doors.some((d) => d.dir === 'N' && Math.abs(d.x - x) < 44)) return { x, y };
  return { x: room.centerX - 84, y };
}

registerRoomHandler('shop', {
  populate(w, room, rng) {
    const cx = room.centerX;
    const cy = room.centerY + 8;
    withDecals(room, (p) => rectRug(p, Math.round(cx - 100), Math.round(cy - 15), 200, 30, ['#2a1424', '#4a2238', '#6a3248', '#8a4a5a'], '#d0a050'));
    const k = keeperSpot(room);
    w.spawn(new Shopkeeper(k.x, k.y));
    const slots = [-72, -36, 0, 36, 72];
    const itemSlots = rng.chance(0.5) ? 2 : 3;
    // items in the middle, consumables on the sides
    const order = itemSlots === 3 ? [1, 2, 3, 0, 4] : [1, 3, 0, 2, 4];
    order.forEach((slot, i) => {
      const x = cx + slots[slot];
      if (i < itemSlots) {
        const item = w.loot.rollItem('shop', w.run.lootRng);
        if (!item) return;
        const ped = new Pedestal(x, cy - 2, item);
        ped.price = priceOf(item);
        w.spawn(ped);
      } else {
        const pool: [PickupKind, number][] = [['heart', 4], ['match', 4], ['match', 4], ['blue_flame', 7], ['potion', 5]];
        const potions = Object.keys(w.run.potionColors);
        let [kind, price] = rng.pick(pool);
        if (kind === 'potion' && !potions.length) [kind, price] = ['heart', 4];
        const pk = new Pickup(kind, x, cy);
        pk.price = price;
        if (kind === 'potion') pk.potionId = rng.pick(potions);
        w.spawn(pk);
      }
    });
  },
});
