// Trap arms II (things that linger or hover; see trap-arms.ts):
//  먹물 붓       (ink_brush, rare)      — paints ink strokes toward the cursor; wet
//                                       ink hurts what stands on it until it dries
//  회전 팽이추   (spin_top_yoyo, rare)  — a spinning weight on a string: it hovers
//                                       at the cursor while the attack is held,
//                                       grinding enemies, and whips back on release

import { defineWeapon, type WeaponState } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { Entity } from '../../game/entity';
import type { Projectile, ProjBehavior } from '../../game/projectile';
import { defineDrawnSprite } from '../../engine/sprites';
import type { PixelPainter } from '../../engine/painter';
import { HELD } from '../../game/seam';
import { clamp } from '../../engine/math';
import { fx } from '../../engine/rng';
import { visualHandPos } from '../../game/weapon-pose';
import { O, attackInterval, drawHeld, handPos, kick, rayLength, segDist } from './common';
import { aimDistance, beginAttack, enemyInCone, shotFade } from './kit';
import { OwnedList, heldSpriteOf, ownedHit } from './frontier-kit';

// ================================================================== 먹물 붓
defineDrawnSprite('w_ink_brush', 25, 7, (p) => {
  // bamboo handle with nodes, brass ferrule, ink-soaked tip
  p.rect(1, 3, 14, 2, '#c8b070');
  p.rect(1, 3, 14, 1, '#e8d8a0');
  p.px(5, 3, '#8a7040'); p.px(5, 4, '#8a7040');
  p.px(10, 3, '#8a7040'); p.px(10, 4, '#8a7040');
  p.px(1, 4, '#8a7040');
  p.rect(15, 2, 2, 4, '#c8a040');
  p.px(15, 2, '#ffe080');
  p.poly([17, 1.5, 21, 2.5, 24, 3.5, 21, 5, 17, 5.5], '#141420');
  p.line(18, 2, 21, 3, '#3a4a7a');
  p.px(23, 3, '#5a78b8');
}, { outline: O, origin: [6, 4] });

defineDrawnSprite('icon_ink_brush', 16, 16, (p) => {
  // the stroke it paints, then the brush over it
  p.line(1, 13, 6, 14, '#141420');
  p.line(1, 12, 5, 13, '#141420');
  p.line(6, 14, 11, 14, '#2e3446');
  p.px(2, 12, '#5a78b8');
  p.line(4, 10, 11, 3, '#c8b070');
  p.line(5, 10, 12, 3, '#e8d8a0');
  p.px(7, 7, '#8a7040');
  p.rect(11, 2, 2, 2, '#c8a040');
  p.poly([12, 1, 15, 0, 14, 3], '#141420');
  p.px(13, 1, '#5a78b8');
  p.poly([2, 11, 5, 9, 4, 11], '#141420');
}, { outline: O });

/** Ink tuning (exported for tests). */
export const INK_LEN = 80;
export const INK_MAX_LEN = 124;
export const INK_LIFE = 1.8;
export const INK_PAINT = 0.1;
export const INK_REHIT = 0.45;
export const INK_TICK_MULT = 0.45;
export const INK_PAINT_MULT = 0.7;
export const INK_MAX = 5;
/** Ink drying ramp: glossy blue-black -> grey. */
const INK_RAMP = ['#0e1426', '#182036', '#283044', '#3e4454', '#585c68', '#76767e'];

/** One painted stroke: a line hazard on the floor that dries over `INK_LIFE`. */
export class InkStroke extends Entity {
  owner: Player;
  x2: number;
  y2: number;
  width: number;
  dmgPaint: number;
  dmgTick: number;
  ticks: Map<number, number>;
  painted = new Set<number>();
  dry = -1;
  constructor(owner: Player, x: number, y: number, x2: number, y2: number, width: number, dmgPaint: number, dmgTick: number, ticks: Map<number, number>) {
    super();
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.x2 = x2;
    this.y2 = y2;
    this.width = width;
    this.dmgPaint = dmgPaint;
    this.dmgTick = dmgTick;
    this.ticks = ticks;
    this.layer = 0;
    this.tileCollide = false;
  }

  /** Dry out at once (replaced by a newer stroke): no more damage, quick fade. */
  dryOut(): void {
    if (this.dry < 0) this.dry = 0;
  }

  override get sortY(): number {
    return Math.min(this.y, this.y2);
  }

  /** Painted fraction 0..1 (the brush sweeps along the stroke). */
  progress(age = this.age): number {
    return clamp(age / INK_PAINT, 0, 1);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.dry >= 0) {
      this.dry += dt;
      if (this.dry >= 0.25) this.dead = true;
      return;
    }
    if (this.age >= INK_LIFE) {
      this.dead = true;
      return;
    }
    const k = this.progress();
    const ex = this.x + (this.x2 - this.x) * k;
    const ey = this.y + (this.y2 - this.y) * k;
    const half = this.width / 2;
    for (const e of [...w.enemies]) {
      if (!e.alive || e.hidden) continue;
      // the wet brush itself: everything it sweeps over (fliers too) once
      if (!this.painted.has(e.id) && e.z <= 24) {
        const sd = segDist(e.x, e.y - e.z * 0.3, this.x, this.y, ex, ey);
        if (sd.d <= e.r + half) {
          this.painted.add(e.id);
          const l = Math.hypot(this.x2 - this.x, this.y2 - this.y) || 1;
          if (ownedHit(w, this.owner, 'ink_brush', e, this.dmgPaint, { kind: 'projectile', dirX: (this.x2 - this.x) / l, dirY: (this.y2 - this.y) / l, knockback: 40 })) {
            w.particles.burst(e.x, e.y - e.z - 3, { count: 5, speed: [30, 90], life: [0.2, 0.4], colors: ['#141420', '#2e3446', '#5a78b8'], size: [1, 2], gravity: 260, vz: [20, 60] });
          }
        }
      }
      // wet ink on the floor: grounded enemies on it, one tick per enemy per INK_REHIT across all strokes
      if (k < 1 || e.flying || e.z > 6 || this.age > INK_LIFE - 0.3) continue;
      if (w.time < (this.ticks.get(e.id) ?? -1)) continue;
      if (segDist(e.x, e.y, this.x, this.y, this.x2, this.y2).d > e.r * 0.7 + half) continue;
      this.ticks.set(e.id, w.time + INK_REHIT);
      if (ownedHit(w, this.owner, 'ink_brush', e, this.dmgTick, { kind: 'status', light: true, noProc: true, procs: ['ink'] })) {
        w.particles.burst(e.x, e.y, { count: 3, speed: [10, 30], life: [0.2, 0.35], colors: ['#141420', '#3a4a7a'], size: [1, 1], gravity: 200, vz: [20, 50] });
      }
    }
  }

  override draw(r: Renderer): void {
    const k = this.progress();
    if (k <= 0) return;
    const life = this.dry >= 0 ? 1 : this.age / INK_LIFE;
    const alpha = this.dry >= 0 ? 1 - this.dry / 0.25 : clamp((INK_LIFE - this.age) / 0.35, 0, 1);
    if (alpha <= 0) return;
    const col = INK_RAMP[Math.min(INK_RAMP.length - 1, Math.floor(life * INK_RAMP.length))];
    const dx = this.x2 - this.x;
    const dy = this.y2 - this.y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    // tapered body: five chunks, thick where the brush landed, lifting off at the end
    const N = 5;
    const w0 = Math.max(2, Math.round(this.width));
    const wob = (i: number) => (i === 0 || i === N ? 0 : Math.sin(this.id * 1.7 + i * 2.3) * 0.8);
    for (let i = 0; i < N; i++) {
      const a = i / N;
      const b = (i + 1) / N;
      if (a >= k) break;
      const bb = Math.min(b, k);
      const width = Math.max(2, Math.round(w0 * (1 - a * 0.75)));
      r.pixelLine(this.x + dx * a + nx * wob(i), this.y + dy * a + ny * wob(i), this.x + dx * bb + nx * wob(i + 1), this.y + dy * bb + ny * wob(i + 1), col, width, alpha * 0.92);
    }
    // the blot where the brush touched down, and a few flecks
    r.pixelDisc(this.x, this.y, Math.max(1.5, w0 * 0.6), col, alpha * 0.92);
    for (let i = 0; i < 3; i++) {
      const t = 0.15 + i * 0.27;
      if (t > k) break;
      const side = i % 2 ? 1 : -1;
      r.rect(this.x + dx * t + nx * side * (w0 + 1 + i), this.y + dy * t + ny * side * (w0 + 1 + i), 1, 1, col, alpha * 0.8);
    }
    // gloss on wet ink: a bright sheen along the upper edge that shrinks as it dries
    if (life < 0.6) {
      const g = (1 - life / 0.6) * alpha;
      const e = Math.min(k, 0.8 - life * 0.6);
      const off = Math.max(1, w0 / 2 - 1);
      const sx = ny < 0 ? -1 : 1;
      r.pixelLine(this.x + dx * 0.06 + nx * off * sx, this.y + dy * 0.06 + ny * off * sx, this.x + dx * e + nx * off * sx * 0.5, this.y + dy * e + ny * off * sx * 0.5, '#7a9ad8', 1, 0.85 * g);
      r.rect(this.x + dx * 0.1 - 1, this.y + dy * 0.1 - 1, 1, 1, '#c8d8ff', 0.9 * g);
    }
  }
}

const STROKES = new OwnedList<InkStroke>();
const INK_TICKS = new WeakMap<WeaponState, Map<number, number>>();

function inkTicks(w: World, st: WeaponState): Map<number, number> {
  let m = INK_TICKS.get(st);
  if (!m) INK_TICKS.set(st, (m = new Map()));
  if (st.mem.inkRoom !== w.node.id) {
    st.mem.inkRoom = w.node.id;
    m.clear();
  }
  return m;
}

defineWeapon({
  id: 'ink_brush',
  name: '먹물 붓',
  desc: '조준한 쪽으로 먹물 획을 긋는다. 붓이 지나간 적은 베이고, 젖은 먹물 위에 선 적은 마를 때까지 계속 피해를 입는다. 획은 다섯까지 남는다.',
  icon: 'icon_ink_brush',
  heldSprite: 'w_ink_brush',
  kind: 'ranged',
  archetype: '붓',
  rarity: 'rare',
  tags: ['staff', 'arcane'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('fireRate', 0.75);
  },
  update(w, p, st, dt, firing, aim) {
    const ticks = inkTicks(w, st);
    const live = STROKES.live(w, st);
    // ink drips from the brush tip (visual)
    if (fx.chance(dt * 2.5)) {
      const t = handPos(p, p.aim, 19);
      w.particles.spawn({ x: t.x, y: t.y, vy: 10, life: 0.35, colors: ['#141420', '#3a4a7a'], size: 1, gravity: 300, z: 4, vz: 0, ground: true });
    }
    if (!firing || st.cooldown > 0) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p);
    const s = p.weaponStats;
    const n = Math.max(1, Math.floor(s.shots));
    const cap = INK_MAX + n - 1;
    // at least INK_LEN; a far cursor stretches the stroke to reach it (up to INK_MAX_LEN)
    const maxLen = INK_MAX_LEN + clamp((s.range - 185) * 0.15, -20, 40);
    const len = clamp(aimDistance(w, p, 0, maxLen, INK_LEN) + 2, INK_LEN, maxLen);
    const width = 6 + (s.projSize - 3) * 1.5;
    // painted on the floor in front of the keeper's feet (never starting inside a wall)
    const td = clamp(rayLength(w, p.x, p.y + 1, aim, 12) - 3, 0, 12);
    const tip = { x: p.x + Math.cos(aim) * td, y: p.y + 1 + Math.sin(aim) * td * 0.75 };
    for (let i = 0; i < n; i++) {
      const a = aim + (i - (n - 1) / 2) * 0.26;
      const l = Math.max(4, rayLength(w, tip.x, tip.y, a, len));
      const stroke = new InkStroke(p, tip.x, tip.y, tip.x + Math.cos(a) * l, tip.y + Math.sin(a) * l, width, s.damage * INK_PAINT_MULT, s.damage * INK_TICK_MULT, ticks);
      while (live.length >= cap) {
        const old = live.shift()!;
        old.dryOut();
        STROKES.remove(st, old);
      }
      w.spawn(stroke);
      STROKES.add(w, st, stroke);
      live.push(stroke);
    }
    st.combo = (st.combo + 1) % 2;
    st.comboTimer = 2;
    kick(w, aim, 0.5);
    w.sfx('quill_write', { vol: 0.35, pitch: 1.2 + w.rng.next() * 0.15 });
    w.sfx('ink_splash', { vol: 0.25, pitch: 1.4 });
  },
  onHolster(w, _p, st) {
    for (const s of STROKES.live(w, st)) s.dryOut();
  },
  draw(w, p, r, st) {
    // the brush flicks along the stroke, alternating direction
    const f = shotFade(st, w, 0.18);
    const side = st.combo ? 1 : -1;
    const sweep = f > 0 ? (f - 0.5) * 0.9 * side : 0;
    drawHeld(r, p, heldSpriteOf('ink_brush', 'w_ink_brush'), p.aim + sweep, 5 + f * 4);
  },
});

// ================================================================== 회전 팽이추
function topFrame(p: PixelPainter, f: number): void {
  // a turned wooden top: crown knob, wide striped body, iron tip
  p.rect(5, 1, 2, 2, '#8a5a30');
  p.px(5, 1, '#c89060');
  p.poly([1, 4, 11, 4, 9, 8, 6.5, 11, 5.5, 11, 3, 8], '#e8d0a0');
  p.rect(1, 4, 10, 1, '#fff0c8');
  // stripes slide around as it spins
  for (let i = 0; i < 3; i++) {
    const x = 2 + ((i * 3 + f) % 8);
    p.line(x, 5, x + 0.5, 7, '#c83a2a');
    p.line(x + 1, 5, x + 1, 6, '#e05a3a');
  }
  p.rect(2, 7, 8, 1, '#a07848');
  p.px(6, 11, '#8a92a8');
}

for (let f = 0; f < 3; f++) defineDrawnSprite(`proj_spin_top_${f}`, 12, 13, (p) => topFrame(p, f), { outline: O, origin: [6, 6] });
defineDrawnSprite('w_spin_top', 12, 13, (p) => topFrame(p, 0), { outline: O, origin: [6, 6] });

defineDrawnSprite('icon_spin_top_yoyo', 16, 16, (p) => {
  // the string from the hand, the top, its motion arcs
  p.line(0, 0, 6, 5, '#f0e8d8');
  p.rect(7, 4, 2, 2, '#8a5a30');
  p.poly([3, 7, 13, 7, 11, 11, 8.5, 14, 7.5, 14, 5, 11], '#e8d0a0');
  p.rect(3, 7, 10, 1, '#fff0c8');
  p.line(5, 8, 5, 10, '#c83a2a');
  p.line(8, 8, 8, 11, '#c83a2a');
  p.line(11, 8, 10, 10, '#c83a2a');
  p.px(8, 14, '#8a92a8');
  p.px(1, 10, '#fff0a0'); p.px(2, 12, '#fff0a0');
  p.px(15, 10, '#fff0a0'); p.px(14, 12, '#fff0a0');
}, { outline: O });

/** Yo-yo tuning (exported for tests). */
export const YOYO_MAX = 120;
export const YOYO_HOLD = 2.5;
/** Grind radius around the spinning top (px). */
export const YOYO_REACH = 16;
/** Seconds between grinding hits at base fire rate. */
export const YOYO_TICK = 0.25;
/** Drift speed toward the cursor while held (px/s). */
export const YOYO_DRIFT = 110;

const YOYOS = new OwnedList<Projectile>();

function yoyoBehavior(p: Player, st: WeaponState, tick: number, maxD: number): ProjBehavior {
  const recall = (pr: Projectile, w: World) => {
    if (pr.mem.phase === 2) return;
    pr.mem.phase = 2;
    pr.hitIds.clear();
    pr.speed = Math.max(pr.speed, 120);
    w.sfx('clock_rewind', { vol: 0.25, pitch: 1.8, x: pr.x });
  };
  return {
    id: 'spin_top',
    update(pr, w, dt) {
      pr.mem.spin = (pr.mem.spin ?? 0) + dt * 30;
      const ph = pr.mem.phase ?? 0;
      const held = st.mem.hold === 1 && w.time - (st.mem.holdAt ?? -9) < 0.3;
      if (ph < 2 && (pr.age >= YOYO_HOLD || (!held && pr.age > 0.12))) recall(pr, w);
      const phase = pr.mem.phase ?? 0;
      if (phase === 0) {
        // out to the aimed point
        const tx = pr.mem.tx ?? pr.x;
        const ty = pr.mem.ty ?? pr.y;
        const d = Math.hypot(tx - pr.x, ty - pr.y);
        if (d <= pr.speed * dt + 0.5) {
          pr.x = tx;
          pr.y = ty;
          pr.mem.phase = 1;
          pr.mem.tickT = 0;
          pr.speed = 0;
          pr.vx = pr.vy = 0;
          return;
        }
        pr.angle = Math.atan2(ty - pr.y, tx - pr.x);
        pr.vx = Math.cos(pr.angle) * pr.speed;
        pr.vy = Math.sin(pr.angle) * pr.speed;
        return;
      }
      if (phase === 1) {
        // spinning in place: grind what is within reach every tick; drift toward the cursor
        pr.mem.tickT = (pr.mem.tickT ?? 0) + dt;
        if (pr.mem.tickT >= tick) {
          pr.mem.tickT -= tick;
          pr.hitIds.clear();
        }
        let vx = 0;
        let vy = 0;
        const inp = p.input;
        if (inp && (inp.held & HELD.cursorAim) !== 0) {
          let cx = inp.cx;
          let cy = inp.cy;
          const dd = Math.hypot(cx - p.x, cy - (p.y - 5));
          if (dd > maxD) {
            cx = p.x + ((cx - p.x) / dd) * maxD;
            cy = p.y - 5 + ((cy - (p.y - 5)) / dd) * maxD;
          }
          const dx = cx - pr.x;
          const dy = cy - pr.y;
          const l = Math.hypot(dx, dy);
          if (l > 2) {
            vx = (dx / l) * Math.min(YOYO_DRIFT, l * 6);
            vy = (dy / l) * Math.min(YOYO_DRIFT, l * 6);
          }
        }
        pr.speed = 0;
        pr.vx = vx;
        pr.vy = vy;
        if (fx.chance(0.35)) w.particles.spawn({ x: pr.x + fx.range(-5, 5), y: pr.y - pr.z + 3, vx: fx.range(-30, 30), vy: fx.range(-10, 10), life: 0.15, colors: ['#fff0c8', '#e8d0a0'], size: 1 });
        return;
      }
      // whipping back to the hand, cutting what it passes
      const hx = p.x;
      const hy = p.y - 5;
      const d = Math.hypot(hx - pr.x, hy - pr.y);
      pr.speed = Math.min(520, pr.speed + 1600 * dt);
      if (d < 8 + pr.speed * dt || pr.age > YOYO_HOLD + 2) {
        pr.dead = true;
        pr.mem.caught = 1;
        st.cooldown = Math.min(st.cooldown, 0.06);
        w.sfx('clock_snap', { vol: 0.25, pitch: 1.9 });
        return;
      }
      pr.angle = Math.atan2(hy - pr.y, hx - pr.x);
      pr.vx = Math.cos(pr.angle) * pr.speed;
      pr.vy = Math.sin(pr.angle) * pr.speed;
    },
    onHit(pr, w, target) {
      w.particles.burst(target.x, target.y - target.z - 3, { count: 4, speed: [40, 120], life: [0.08, 0.18], colors: ['#ffffff', '#fff0c8', '#e05a3a'], shape: 'spark', size: [1, 2] });
      if ((pr.mem.phase ?? 0) === 1) w.sfx('clock_ratchet', { vol: 0.12, pitch: 2.2, x: pr.x });
    },
    onWall(pr, w) {
      const ph = pr.mem.phase ?? 0;
      if (ph === 0) {
        // stop short of the wall and spin there
        pr.x -= pr.vx * w.dt;
        pr.y -= pr.vy * w.dt;
        pr.mem.tx = pr.x;
        pr.mem.ty = pr.y;
      } else if (ph === 1) {
        pr.x -= pr.vx * w.dt;
        pr.y -= pr.vy * w.dt;
      }
      return true;
    },
    draw(pr, r, w) {
      const y = pr.y - pr.z;
      const ph = pr.mem.phase ?? 0;
      const s = pr.mem.spin ?? 0;
      r.shadow(pr.x, pr.y + 3, 9, 3, 0.25);
      if (ph === 1) {
        // the grind radius: two bright arcs whirling around the top
        r.pixelRing(pr.x, y, YOYO_REACH - 3, '#fff0c8', 1, 0.16);
        for (let i = 0; i < 2; i++) {
          const a0 = s * 0.9 + i * Math.PI;
          for (let j = 0; j < 9; j++) {
            const a = a0 - j * 0.12;
            r.rect(pr.x + Math.cos(a) * (YOYO_REACH - 3), y + Math.sin(a) * (YOYO_REACH - 3), 1, 1, j < 2 ? '#ffffff' : '#fff0c8', 0.95 - j * 0.09);
          }
        }
      }
      r.sprite(`proj_spin_top_${Math.floor(s) % 3}`, pr.x, y, { rot: Math.sin(w.time * 25) * (ph === 1 ? 0.08 : 0.25) });
    },
  };
}

defineWeapon({
  id: 'spin_top_yoyo',
  name: '회전 팽이추',
  desc: '줄 달린 팽이추를 조준점으로 던진다. 공격을 누르고 있으면 그 자리에서 돌며 닿는 적을 계속 갈고, 떼면 손으로 되돌아오며 지나는 적을 친다.',
  icon: 'icon_spin_top_yoyo',
  heldSprite: 'w_spin_top',
  kind: 'ranged',
  archetype: '요요',
  rarity: 'rare',
  tags: ['quick'],
  pools: ['treasure', 'shop', 'boss'],
  stats(m) {
    m.mulStat('damage', 0.6);
  },
  update(w, p, st, _dt, firing, aim) {
    const live = YOYOS.live(w, st);
    st.mem.hold = firing ? 1 : 0;
    st.mem.holdAt = w.time;
    st.mem.out = live.length;
    if (!firing || st.cooldown > 0 || live.length) return;
    beginAttack(w, p, st, aim);
    st.cooldown = attackInterval(p, 0.4);
    const s = p.weaponStats;
    const maxD = YOYO_MAX + clamp((s.range - 185) * 0.2, -30, 60);
    // where it goes: the cursor, else the enemy roughly ahead, else a mid throw
    const ahead = enemyInCone(w, p.x, p.y - 5, aim, 0.45, maxD);
    const fallback = ahead ? Math.hypot(ahead.x - p.x, ahead.y - (p.y - 5)) : maxD * 0.7;
    const d0 = aimDistance(w, p, 20, maxD, fallback);
    const h = handPos(p, aim, 8);
    const tick = YOYO_TICK * clamp(2.6 / Math.max(0.4, p.stats.fireRate), 0.35, 2.5);
    const shots = p.fireProjectiles(w, aim, {
      style: 'none', x: h.x, y: h.y, speed: Math.max(260, s.shotSpeed * 1.3), range: 99999, life: YOYO_HOLD + 3, pierce: 999, bounce: 0, homing: 0,
      radius: Math.max(4, YOYO_REACH - 7 + (s.projSize - 3)), knockback: s.knockback * 0.5, color: '#fff0c8', light: 10, spreadMult: 2.5,
      behaviors: [yoyoBehavior(p, st, tick, maxD)],
    });
    for (const pr of shots) {
      const d = Math.max(12, rayLength(w, p.x, p.y - 5, pr.angle, d0) - 4);
      pr.mem.tx = p.x + Math.cos(pr.angle) * d;
      pr.mem.ty = p.y - 5 + Math.sin(pr.angle) * d;
      YOYOS.add(w, st, pr);
    }
    st.mem.out = shots.length;
    kick(w, aim, 0.6);
    w.sfx('whoosh', { vol: 0.45, pitch: 1.5 });
    w.sfx('clock_spring', { vol: 0.2, pitch: 2 });
  },
  onHolster(w, _p, st) {
    for (const pr of YOYOS.live(w, st)) pr.dead = true;
    st.mem.out = 0;
    st.mem.hold = 0;
  },
  draw(w, p, r, st) {
    const out = YOYOS.peek(w, st);
    const h = visualHandPos(p, p.aim, 6);
    if (!out.length) {
      r.sprite(heldSpriteOf('spin_top_yoyo', 'w_spin_top'), h.x, h.y, { rot: Math.sin(w.time * 3) * 0.2 });
      return;
    }
    // the string, taut while it spins, a little slack on the way back
    for (const pr of out) {
      const ph = pr.mem.phase ?? 0;
      const tx = pr.x;
      const ty = pr.y - pr.z - 4;
      const len = Math.hypot(tx - h.x, ty - h.y);
      const n = Math.max(2, Math.ceil(len));
      const sag = ph === 2 ? 2.5 : 0;
      let lx = NaN;
      let ly = NaN;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const x = Math.round(h.x + (tx - h.x) * k);
        const y = Math.round(h.y + (ty - h.y) * k + Math.sin(k * Math.PI) * sag);
        if (x === lx && y === ly) continue;
        lx = x;
        ly = y;
        r.rect(x, y, 1, 1, '#f0e8d8', 0.85);
      }
    }
    r.rect(h.x - 1, h.y - 1, 2, 2, '#c89060');
  },
});
