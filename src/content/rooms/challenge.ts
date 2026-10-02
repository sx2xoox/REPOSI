// Challenge room "시련의 방": touching the altar seals the doors and summons three
// waves of this floor's enemies (telegraphed by summoning circles). Surviving all
// waves rewards an item pedestal and a chest.

import { registerRoomHandler } from '../../game/roomkinds';
import { Enemies } from '../../game/defs';
import { Entity } from '../../game/entity';
import { Chest, Pedestal } from '../../game/pickups';
import { RingFx } from '../../game/effects';
import type { World } from '../../game/world';
import type { Room } from '../../game/room';
import type { Renderer } from '../../engine/renderer';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { dist } from '../../engine/math';
import { Prop } from '../props/prop';
import { ritualCircle, withDecals } from './decor';
import { HintLabel } from './label';

const WAVES = 3;

defineDrawnSprite('trial_altar', 22, 22, (p) => {
  // stepped stone base
  p.rect(0, 15, 22, 7, '#3a3846');
  p.rect(0, 15, 22, 1, '#7a7890');
  p.rect(2, 10, 18, 6, '#4a4858');
  p.rect(2, 10, 18, 1, '#8a88a0');
  p.rect(0, 21, 22, 1, '#24222e');
  // crossed blades behind the gem
  p.line(4, 1, 17, 12, '#c8c8dc');
  p.line(17, 1, 4, 12, '#c8c8dc');
  p.line(5, 1, 17, 11, '#8a8aa0');
  p.line(16, 1, 4, 11, '#8a8aa0');
  p.rect(3, 11, 3, 2, '#8a5a2a');
  p.rect(16, 11, 3, 2, '#8a5a2a');
  // socket
  p.rect(8, 4, 6, 7, '#2a2834');
  p.rect(9, 5, 4, 5, '#120e18');
  // carvings
  for (let x = 2; x < 20; x += 3) p.px(x, 18, '#24222e');
}, { outline: '#0c0810', origin: [11, 21] });

defineDrawnSprite('trial_gem', 4, 5, (p) => {
  p.rect(0, 1, 4, 3, '#ff3a3a');
  p.rect(1, 0, 2, 5, '#ff3a3a');
  p.px(1, 1, '#ffd0c0');
  p.px(2, 3, '#a01010');
}, { origin: [2, 2] });

/** Telegraphed summoning circle: grows for `time`, then spawns the enemy. */
class SummonCircle extends Entity {
  enemyId: string;
  time: number;
  altar: TrialAltar;
  constructor(x: number, y: number, id: string, time: number, altar: TrialAltar) {
    super();
    this.x = x;
    this.y = y;
    this.enemyId = id;
    this.time = time;
    this.altar = altar;
    this.layer = 0;
    this.tileCollide = false;
    altar.pending++;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (fx.chance(dt * 20)) {
      const a = fx.angle();
      w.particles.spawn({ x: this.x + Math.cos(a) * 10, y: this.y + Math.sin(a) * 6, vx: -Math.cos(a) * 16, vy: -Math.sin(a) * 10 - 6, life: 0.4, colors: ['#ffd0d0', '#ff4040'], size: 1, additive: true });
    }
    if (this.age >= this.time) {
      this.dead = true;
      this.altar.pending--;
      const e = w.spawnEnemy(this.enemyId, this.x, this.y);
      if (e) e.dormant = 0.45;
      w.particles.burst(this.x, this.y - 4, { count: 18, speed: [30, 90], life: [0.3, 0.6], colors: ['#ffffff', '#ff6060', '#801010'], size: [1, 2], additive: true });
      w.spawn(new RingFx(this.x, this.y, 16, 0.3, '#ff6060', 2));
      w.sfx('enemy_spawn', { vol: 0.5 });
    }
  }

  override draw(r: Renderer): void {
    const t = Math.min(1, this.age / this.time);
    const rad = 4 + t * 9;
    r.circle(this.x, this.y, rad, '#ff2030', 0.18 + 0.1 * Math.sin(this.age * 30));
    r.ring(this.x, this.y, rad, '#ff6060', 1, 0.9);
    r.ring(this.x, this.y, 13, '#ff3040', 1, 0.35);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y, 30, '#ff3030', { intensity: 0.6 });
  }
}

export class TrialAltar extends Prop {
  state: 'idle' | 'active' | 'done' = 'idle';
  wave = 0;
  gapT = 0;
  pending = 0;
  flare = 0;
  constructor(x: number, y: number) {
    super(x, y, 1);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.flare = Math.max(0, this.flare - dt * 1.5);
    if (this.state === 'idle') {
      if (w.node.cleared) {
        this.state = 'done';
        return;
      }
      w.holdClear = Math.max(w.holdClear, 1);
      const p = w.player;
      if (!w.transitioning && p.alive && dist(p.x, p.y, this.x, this.y - 4) < 15) this.begin(w);
      return;
    }
    if (this.state !== 'active') return;
    w.holdClear = Math.max(w.holdClear, 1);
    const alive = w.enemies.some((e) => e.alive && !e.ignoreForClear);
    if (alive || this.pending > 0) return;
    this.gapT -= dt;
    if (this.gapT > 0) return;
    if (this.wave < WAVES) {
      this.wave++;
      this.spawnWave(w);
      this.gapT = 1.1;
    } else {
      // all waves beaten: let the room clear (rewards in onClear)
      this.state = 'done';
      w.holdClear = 0;
      this.flare = 1;
    }
  }

  private begin(w: World): void {
    this.state = 'active';
    this.wave = 0;
    this.gapT = 0.9;
    this.flare = 1;
    w.room.setDoorsClosed(true);
    w.sfx('door_close');
    w.sfx('boss_roar', { vol: 0.5, pitch: 1.3 });
    w.shake(0.35);
    w.banner('시련의 방', `${WAVES}번의 습격을 버텨내라!`, { color: '#ff8080', small: true });
    w.spawn(new RingFx(this.x, this.y - 6, 60, 0.5, '#ff6060', 3));
  }

  private spawnWave(w: World): void {
    const pool = Object.entries(w.enemyPool())
      .map(([id, weight]) => ({ def: Enemies.get(id), weight }))
      .filter((x): x is { def: NonNullable<typeof x.def>; weight: number } => !!x.def && !x.def.boss);
    const n = 2 + this.wave + Math.floor(w.floor.index / 2);
    const room = w.room;
    const p = w.player;
    for (let i = 0; i < n && pool.length; i++) {
      const pick = w.rng.weighted(pool, (x) => x.weight / Math.max(1, (x.def.cost ?? 1) * 0.7));
      if (!pick) break;
      const pos = room.randomFreePos(w.rng, 8, { x: p.x, y: p.y, dist: 64 });
      w.spawn(new SummonCircle(pos.x, pos.y, pick.def.id, 0.85 + i * 0.12, this));
    }
    w.banner(`${this.wave}번째 습격`, this.wave === WAVES ? '마지막 파도다!' : '버텨라!', { color: '#ff9090', small: true });
    w.sfx('summon', { vol: 0.7 });
    this.flare = 1;
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y - 1, 24, 6, 0.35);
    r.sprite('trial_altar', this.x, this.y);
    const gemY = this.y - 14 + Math.sin(this.age * 2) * (this.state === 'idle' ? 1 : 0);
    const done = this.state === 'done';
    r.sprite('trial_gem', this.x, gemY, { tint: done ? '#ffd040' : undefined, tintAmount: done ? 0.8 : 0, flash: this.flare * 0.8 });
    if (this.state === 'active') {
      for (let i = 0; i < WAVES; i++) {
        const lit = i < this.wave;
        r.rect(this.x - 5 + i * 4, this.y - 4, 2, 2, lit ? '#ff5050' : '#3a2a30');
      }
    }
  }

  override light(w: World): void {
    const col = this.state === 'done' ? '#ffd060' : '#ff3a3a';
    const pulse = this.state === 'idle' ? 0.6 + 0.25 * Math.sin(this.age * 3) : 0.85;
    w.lights.add(this.x, this.y - 14, 46 + this.flare * 40, col, { intensity: pulse });
    w.lights.glow(this.x, this.y - 14, 8 + this.flare * 10, col, 0.35 + this.flare * 0.4);
  }
}

function altarSpot(room: Room): { x: number; y: number } {
  const m = room.markers.find((k) => k.ch === '@');
  return m ? { x: m.x, y: m.y + 6 } : { x: room.centerX, y: room.centerY + 6 };
}

registerRoomHandler('challenge', {
  clearOnEnter: false,
  populate(w, room) {
    const a = altarSpot(room);
    withDecals(room, (p) => ritualCircle(p, a.x, a.y - 4, 50, '#c03030', 0.45));
    const altar = w.spawn(new TrialAltar(a.x, a.y));
    w.spawn(new HintLabel(a.x, a.y - 30, '제단에 닿으면 시련 시작', () => altar.state === 'idle', '#ffb0b0'));
  },
  spawnEnemies() {
    return false;
  },
  onEnter(w) {
    if (!w.node.cleared) w.holdClear = Math.max(w.holdClear, 1);
  },
  onClear(w, room, rng) {
    const a = altarSpot(room);
    const item = w.loot.rollItem('challenge', w.run.lootRng) ?? w.loot.rollItem('treasure', w.run.lootRng);
    if (item) w.spawn(new Pedestal(a.x, a.y - 40, item));
    w.spawn(new Chest(a.x - 34, a.y + 22, w.floor.index >= 3 && rng.chance(0.5)));
    w.spawn(new Chest(a.x + 34, a.y + 22, false));
    w.banner('시련 극복', '등불이 더 밝게 타오른다.', { color: '#ffd060', small: true });
    w.sfx('item_get_rare', { vol: 0.6 });
  },
});
