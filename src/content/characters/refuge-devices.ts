import type { Renderer } from '../../engine/renderer';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Enemy } from '../../game/enemy';
import { Projectile, type ProjBehavior } from '../../game/projectile';
import { runProc, runProcStatus } from '../../game/procs';
import { proc } from '../items/lib';
import { rayLength, segDist } from '../weapons/common';
import { RefugeOwned, nearby, visible, refugeHit, onLane, refugeVisualOpacity, type SupportFamily } from './refuge-common';
import { drawBlast, drawThreadKnot, drawShield, drawSeal, drawSupport } from './refuge-burst-fx';
import { blastImpact, pageImpact, shieldImpact, strikeImpact, threadPulse } from './refuge-impact-fx';

export class RefugeCharge extends RefugeOwned {
  constructor(w: World, p: Player, x: number, y: number, damage: number, targetId = 0, mine = false) {
    super(w, p);
    this.x = x; this.y = y;
    Object.assign(this.mem, { damage, targetId, mine: Number(mine), fired: 0, firedAt: 0, life: mine ? 3.2 : .68 });
  }
  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    const m = this.mem;
    if (m.fired) { if (this.age > m.firedAt + .38) this.dead = true; return; }
    const target = w.enemies.find(e => e.id === m.targetId && e.alive && !e.hidden);
    if (target) { this.x = target.x; this.y = target.y; }
    const triggered = m.mine && this.age >= .2 && nearby(w, this.x, this.y, 17).length > 0;
    if (m.mine && !triggered) { if (this.age >= m.life) this.dead = true; return; }
    if (!m.mine && this.age < m.life) return;
    runProc(w, m.mine ? 'keeper:tove:mine:burst' : 'keeper:tove:charge:burst', () => {
      m.fired = 1; m.firedAt = this.age;
      for (const enemy of nearby(w, this.x, this.y, m.mine ? 35 : 30)) refugeHit(w, this.owner, enemy, m.damage, this, false, 45);
      w.sfx('explosion', { vol: .3, pitch: m.mine ? 1 : 1.3, x: this.x });
      blastImpact(w, this.owner, this.x, this.y, m.mine ? 35 : 30, false);
      proc(w, 'passive:tove', true);
      return true;
    });
  }
  protected paint(r: Renderer): void {
    const m = this.mem;
    if (m.fired) { drawBlast(r, this.x, this.y, this.age - m.firedAt, m.mine ? 35 : 30); return; }
    const pulse = .65 + .35 * Math.sin(this.age * (m.mine ? 7 : 24));
    const remaining = Math.max(0, 1 - this.age / m.life);
    if (m.mine) {
      const armed = Math.min(1, this.age / .2);
      r.shadow(this.x, this.y + 2, 17, 6, .3);
      // Four short feelers show the trigger footprint without filling the floor.
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, nx = Math.cos(a), ny = Math.sin(a);
        const x = this.x + nx * 15, y = this.y + ny * 15;
        r.pixelLine(x - ny * 2, y + nx * 2, x + ny * 2, y - nx * 2, '#dba26a', 1, armed * .32);
        r.pixelLine(this.x + nx * 4, this.y + ny * 4, this.x + nx * 8, this.y + ny * 8, '#211d2c', 3);
        r.pixelLine(this.x + nx * 4, this.y + ny * 4 - 1, this.x + nx * 7, this.y + ny * 7 - 1, '#9a7755', 1);
      }
      r.rect(this.x - 4, this.y - 4, 8, 7, '#272330');
      r.rect(this.x - 3, this.y - 3, 6, 5, '#956746');
      r.rect(this.x - 2, this.y - 2, 4, 2, '#d2aa70');
      r.rect(this.x - 1, this.y - 2, 2, 2, this.age >= .2 ? '#ffd38c' : '#6b5350', pulse);
      r.rect(this.x - 2, this.y + 1, Math.max(1, Math.ceil(remaining * 4)), 1, '#f4d5a0', .7);
      return;
    }
    const y = this.y - 12, pop = Math.max(0, 1 - this.age / .12);
    // Three bound sticks and a shortening fuse read as an attached timed charge.
    r.rect(this.x - 5, y - 4, 10, 8, '#282332');
    for (let i = 0; i < 3; i++) {
      const x = this.x - 4 + i * 3;
      r.rect(x, y - 3, 2, 6, i === 1 ? '#c58250' : '#9d573e');
      r.rect(x, y - 3, 1, 4, '#e2ae71');
    }
    r.rect(this.x - 4, y - 1, 8, 2, '#e8c793');
    r.rect(this.x - 1, y - 1, 2, 2, '#9d7556');
    const fuseX = this.x + 4 + remaining * 5, fuseY = y - 3 - remaining * 3;
    r.pixelLine(this.x + 3, y - 2, fuseX, fuseY, '#231d2b', 3);
    r.pixelLine(this.x + 3, y - 2, fuseX, fuseY, '#e5cfa6', 1);
    r.rect(fuseX - 1, fuseY - 1, 2, 2, '#fff3c8', pulse);
    r.rect(fuseX + 2, fuseY - 3, 1, 1, '#f6a35a', pulse * .8);
    if (pop > 0) for (const side of [-1, 1])
      r.pixelLine(this.x + side * (6 + pop * 3), y - 2, this.x + side * (8 + pop * 5), y - 4, '#fff0be', 1, pop);
  }
  override light(w: World): void {
    const flash = this.mem.fired ? Math.max(0, 1 - (this.age - this.mem.firedAt) / .24) : .15;
    if (flash > 0) w.lights.add(this.x, this.y - (this.mem.mine ? 2 : 12), this.mem.fired ? 42 : 18, '#efb568', { intensity: flash * .45 * refugeVisualOpacity(w, this.owner) });
  }
}

/** Three linked targets; damage is a shared budget, never multiplied by edge count. */
export class RefugeWeave extends RefugeOwned {
  constructor(w: World, p: Player) {
    super(w, p);
    Object.assign(this.mem, { target0: 0, target1: 0, target2: 0, pool: 0, last: -99, source: 0, flash: -99 });
  }
  targets(w: World): Enemy[] {
    const out: Enemy[] = [];
    for (let i = 0; i < 3; i++) {
      const e = w.enemies.find(t => t.id === this.mem['target' + i] && t.alive && !t.hidden && t.vulnerable);
      if (e && Math.hypot(e.x - this.owner.x, e.y - this.owner.y) < 260 && visible(w, this.owner.x, this.owner.y, e.x, e.y, e.r) &&
        (!out.length || visible(w, out[0].x, out[0].y, e.x, e.y, e.r))) out.push(e);
    }
    return out;
  }
  record(w: World, target: Enemy, amount: number): void {
    const p = this.owner, m = this.mem;
    const retie = !!p.vars.rfLuenRetie;
    const members = this.targets(w);
    if (p.vars.rfLuenRetie || w.time - m.last > 1.4 || !members.some(e => e.id === target.id)) {
      const next = nearby(w, target.x, target.y, 95).slice(0, 3);
      for (let i = 0; i < 3; i++) m['target' + i] = next[i]?.id ?? 0;
      p.vars.rfLuenRetie = 0;
    }
    m.source = target.id;
    m.last = w.time;
    m.pool = Math.min(p.stats.damage * 2, m.pool + amount * .28 + (retie ? p.stats.damage * .4 : 0));
  }
  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    const m = this.mem;
    if (w.time - m.last > 3) { this.dead = true; return; }
    const members = this.targets(w);
    if (members.length) { this.x = members[0].x; this.y = members[0].y; }
    if (m.pool <= 0 || !members.length) return;
    runProc(w, 'keeper:luen:weave', () => {
      const others = members.filter(e => e.id !== m.source);
      const receivers = others.length ? others : members.slice(0, 1);
      const damage = m.pool / receivers.length;
      m.pool = 0;
      let hit = false;
      for (const target of receivers) hit = refugeHit(w, this.owner, target, damage, this) || hit;
      if (hit) {
        m.flash = w.time; proc(w, 'passive:luen', true); w.sfx('paper_flutter', { vol: .15, pitch: 1.45 });
        for (const target of receivers) threadPulse(w, this.owner, target.x, target.y - target.r - 7);
      }
      return hit;
    }, .5);
  }
  protected paint(r: Renderer, w: World): void {
    const targets = this.targets(w), lit = Math.max(0, 1 - (w.time - this.mem.flash) / .3);
    const source = targets.find(e => e.id === this.mem.source) ?? targets[0];
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      if (source && e !== source && visible(w, source.x, source.y, e.x, e.y, e.r)) {
        const ax = source.x, ay = source.y - source.r - 7, bx = e.x, by = e.y - e.r - 7;
        const lift = 3 + lit * 2;
        // Bounded segments keep the strands taut; the bright stitch follows actual damage flow.
        for (let j = 1; j <= 8; j++) {
          const t0 = (j - 1) / 8, t1 = j / 8;
          const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0 - Math.sin(t0 * Math.PI) * lift;
          const x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1 - Math.sin(t1 * Math.PI) * lift;
          r.pixelLine(x0, y0, x1, y1, '#30233f', 3, .55);
          r.pixelLine(x0, y0, x1, y1, '#c4abdf', 1, .42 + lit * .45);
        }
        if (lit > 0) {
          const t = Math.min(1, (1 - lit) * 1.35);
          const x = ax + (bx - ax) * t, y = ay + (by - ay) * t - Math.sin(t * Math.PI) * lift;
          r.rect(x - 1, y - 1, 3, 2, '#fff0de', lit);
          r.rect(x, y - 2, 1, 4, '#e2c6f1', lit * .6);
        }
      }
    }
    for (const e of targets) drawThreadKnot(r, e.x, e.y - e.r - 7, this.age, 4 + lit * 2, .7 + lit * .3);
  }
  override light(w: World): void {
    const lit = Math.max(0, 1 - (w.time - this.mem.flash) / .3);
    if (lit > 0) w.lights.add(this.x, this.y - 9, 24, '#bca1df', { intensity: lit * .25 * refugeVisualOpacity(w, this.owner) });
  }
}

/** A bounded, explicit off-hand skill. No weapon update, item shoot hook or copied projectile. */
export class RefugeSupport extends RefugeOwned {
  constructor(w: World, p: Player, family: SupportFamily, target: Enemy, damage: number) {
    super(w, p);
    const a = Math.atan2(target.y - p.y, target.x - p.x);
    const length = Math.max(0, rayLength(w, p.x, p.y, a, Math.min(200, Math.hypot(target.x - p.x, target.y - p.y))) - 2);
    Object.assign(this.mem, { family, damage, ax: p.x, ay: p.y, angle: a,
      tx: p.x + Math.cos(a) * length, ty: p.y + Math.sin(a) * length, phase: 0 });
  }
  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    const m = this.mem, times = m.family === 3 ? [.12, .34, .56] : [m.family === 2 ? .24 : .12];
    if (m.phase < times.length && this.age >= times[m.phase]) {
      runProc(w, 'keeper:ves:support:impact', () => {
        const factor = m.family === 3 ? 1 / 3 : 1;
        for (const target of w.enemies) {
          if (!target.alive || target.hidden || !target.vulnerable) continue;
          const inside = m.family === 0 || m.family === 2
            ? Math.hypot(target.x - m.tx, target.y - m.ty) <= (m.family === 0 ? 23 : 34) + target.r && visible(w, m.tx, m.ty, target.x, target.y, target.r)
            : onLane(w, target, m.ax, m.ay, m.tx + Math.cos(m.angle) * 8, m.ty + Math.sin(m.angle) * 8, m.family === 3 ? 10 : 5);
          if (inside && visible(w, m.ax, m.ay, target.x, target.y, target.r)) refugeHit(w, this.owner, target, m.damage * factor, this);
        }
        m.phase++;
        w.sfx(m.family === 0 ? 'swing' : m.family === 2 ? 'explosion' : 'shoot_magic', { vol: .2, pitch: 1.4, x: m.tx });
        if (m.family === 2) blastImpact(w, this.owner, m.tx, m.ty, 34, false);
        else strikeImpact(w, this.owner, m.tx, m.ty, m.angle, m.family === 0 ? 0 : 1, false);
        return true;
      });
    }
    if (this.age > (m.family === 3 ? .82 : .62)) this.dead = true;
  }
  protected paint(r: Renderer): void {
    const m = this.mem, wind = Math.max(0, 1 - this.age / (m.family === 2 ? .24 : .12));
    if (wind > 0) {
      const nx = Math.cos(m.angle), ny = Math.sin(m.angle);
      for (const side of [-1, 1]) {
        const x = m.ax - ny * side * (4 + wind * 3), y = m.ay + nx * side * (4 + wind * 3) - 5;
        r.pixelLine(x - nx * 5, y - ny * 5, x + nx * 3, y + ny * 3, '#332638', 3, wind);
        r.pixelLine(x - nx * 5, y - ny * 5, x + nx * 3, y + ny * 3, side < 0 ? '#ecabb6' : '#b4d7e8', 1, wind);
      }
    }
    drawSupport(r, m.ax, m.ay, m.tx, m.ty, this.age, m.family as SupportFamily);
  }
}

/** A single shield follows or stays behind. Dashing does not create/refill extra shields. */
export class RefugeGuard extends RefugeOwned {
  constructor(w: World, p: Player) {
    super(w, p);
    Object.assign(this.mem, { angle: p.aim, parkUntil: -1, flash: -99 });
    const length = Math.max(0, rayLength(w, p.x, p.y, p.aim, 18) - 2);
    this.x = p.x + Math.cos(p.aim) * length;
    this.y = p.y + Math.sin(p.aim) * length;
    p.vars.rfOrtCharges ??= 2;
    p.vars.rfOrtRefill ??= w.time + 2.4;
  }
  park(w: World): void { this.mem.parkUntil = w.time + 1.1; }
  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    const p = this.owner, m = this.mem;
    if ((p.vars.rfOrtCharges ?? 0) < 2 && w.time >= p.vars.rfOrtRefill) {
      p.vars.rfOrtCharges++;
      p.vars.rfOrtRefill = w.time + 2.4;
    }
    if (p.vars.rfOrtCharges >= 2) p.vars.rfOrtRefill = w.time + 2.4;
    if (w.time >= m.parkUntil) {
      m.angle = p.aim;
      const length = Math.max(0, rayLength(w, p.x, p.y, p.aim, 18) - 2);
      this.x = p.x + Math.cos(p.aim) * length;
      this.y = p.y + Math.sin(p.aim) * length;
    }
    if (p.vars.rfOrtCharges <= 0) return;
    const nx = Math.cos(m.angle), ny = Math.sin(m.angle);
    for (const bullet of w.projectiles) {
      if (bullet.dead || bullet.team !== 'enemy' || bullet.delay > 0 || bullet.z > 18) continue;
      const speed = bullet.vx * nx + bullet.vy * ny;
      if (speed >= 0) continue;
      const dx = bullet.x - this.x, dy = bullet.y - this.y;
      const front = dx * nx + dy * ny;
      const prior = front - speed * dt * (w.floor.shotSpeed ?? 1);
      const step = dt * (w.floor.shotSpeed ?? 1);
      if (front + speed * step > bullet.r + 3 || prior < -bullet.r - 3) continue;
      const cross = Math.max(-step, Math.min(step, -front / speed));
      const tangent = -(dx + bullet.vx * cross) * ny + (dy + bullet.vy * cross) * nx;
      if (Math.abs(tangent) > 17 + bullet.r || !visible(w, this.x, this.y, bullet.x, bullet.y, bullet.r)) continue;
      if (runProc(w, 'keeper:ort:guard', () => {
        bullet.dead = true;
        p.vars.rfOrtCharges--;
        m.flash = w.time;
        shieldImpact(w, p, bullet.x, bullet.y, m.angle, false);
        w.sfx('parry', { vol: .3, pitch: .9, x: this.x });
        proc(w, 'passive:ort', true);
        return true;
      })) break;
    }
  }
  protected paint(r: Renderer, w: World): void {
    const lit = Math.max(0, 1 - (w.time - this.mem.flash) / .24), parked = this.mem.parkUntil > w.time;
    const nx = Math.cos(this.mem.angle), ny = Math.sin(this.mem.angle), sx = -ny, sy = nx;
    if (parked) for (const side of [-1, 1]) {
      const x = this.x + sx * side * 12, y = this.y + sy * side * 12 + 2;
      r.pixelLine(x - nx * 4, y - ny * 4, x + nx * 3, y + ny * 3, '#263a35', 4, .8);
      r.pixelLine(x - nx * 3, y - ny * 3 - 1, x + nx * 2, y + ny * 2 - 1, '#c3d6ae', 1, .7);
    }
    drawShield(r, this.x - nx * lit * 2, this.y - ny * lit * 2, this.mem.angle, 17, this.owner.vars.rfOrtCharges, .75 + lit * .25);
    if (lit > 0) for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1, spread = (1 - lit) * (5 + i * 2);
      const x = this.x + nx * (5 + spread) + sx * side * (2 + spread), y = this.y + ny * (5 + spread) + sy * side * (2 + spread);
      r.pixelLine(x, y, x + nx * 3 + sx * side * 2, y + ny * 3 + sy * side * 2, i < 2 ? '#fff0c6' : '#a6d3b0', 1, lit);
    }
  }
  override light(w: World): void {
    const lit = Math.max(0, 1 - (w.time - this.mem.flash) / .24);
    if (lit > 0) w.lights.add(this.x, this.y, 27, '#b8dcae', { intensity: lit * .35 * refugeVisualOpacity(w, this.owner) });
  }
}

/** Velocity-only modifier. syncVel restores the native speed every simulation step. */
const sealBulletBehavior: ProjBehavior = {
  id: 'refuge_seal_slow',
  update(bullet, w) {
    if ((bullet.mem.rfSealAt ?? -99) < w.time - w.dt - .000001) return;
    const k = Math.max(.55, bullet.mem.rfSealSpeed ?? 1);
    bullet.vx *= k;
    bullet.vy *= k;
  },
  draw(bullet, r, w) {
    if ((bullet.mem.rfSealAt ?? -99) >= w.time - w.dt - .000001) {
      const y = bullet.y - bullet.z;
      // Small page corners leave the hostile projectile's own core fully visible.
      for (const side of [-1, 1]) {
        r.pixelLine(bullet.x + side * 4, y - 4, bullet.x + side * 4, y - 1, '#d3dff1', 1, .6);
        r.pixelLine(bullet.x + side * 4, y - 4, bullet.x + side * 2, y - 4, '#b3c9ee', 1, .6);
      }
    }
  },
};

export function slowSealBullets(w: World, inside: (x: number, y: number, r: number) => boolean, speed: number): void {
  for (const bullet of w.projectiles) {
    if (bullet.dead || bullet.team !== 'enemy' || bullet.delay > 0 || !inside(bullet.x, bullet.y, bullet.r)) continue;
    bullet.mem.rfSealSpeed = bullet.mem.rfSealAt === w.time ? Math.min(bullet.mem.rfSealSpeed, speed) : speed;
    bullet.mem.rfSealAt = w.time;
    if (!bullet.mem.rfSealBehavior) { bullet.mem.rfSealBehavior = 1; bullet.addBehavior(sealBulletBehavior); }
  }
}

export function slowSealEnemy(w: World, target: Enemy): boolean {
  return runProcStatus(w, 'keeper:mira:slow', target.id, () =>
    target.alive && target.applyStatus({ kind: 'slow', duration: .62, power: target.isBoss ? .12 : .3 }, () => w.rng.next()));
}

export class RefugeSeal extends RefugeOwned {
  constructor(w: World, p: Player, x: number, y: number) {
    super(w, p);
    this.x = x; this.y = y;
    Object.assign(this.mem, { until: w.time + 2.8, damage: p.stats.damage, radius: 42, pulse: -99 });
    this.layer = 0;
  }
  place(w: World, x: number, y: number): void {
    this.x = x; this.y = y;
    this.mem.until = w.time + 2.8;
    this.mem.damage = this.owner.stats.damage;
    this.age = 0;
  }
  contains(w: World, x: number, y: number, radius = 0): boolean {
    return Math.hypot(x - this.x, y - this.y) <= this.mem.radius + radius && visible(w, this.x, this.y, x, y, radius);
  }
  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    if (w.time >= this.mem.until) { this.dead = true; return; }
    slowSealBullets(w, (x, y, r) => this.contains(w, x, y, r), .7);
    runProc(w, 'keeper:mira:seal:pulse', () => {
      const targets = nearby(w, this.x, this.y, this.mem.radius);
      if (!targets.length) return false;
      for (const target of targets) { slowSealEnemy(w, target); refugeHit(w, this.owner, target, this.mem.damage * .2, this); }
      this.mem.pulse = w.time;
      pageImpact(w, this.owner, this.x, this.y - 2, false);
      return true;
    }, .5);
  }
  protected paint(r: Renderer, w: World): void {
    const fade = Math.min(1, this.age / .15) * Math.min(1, (this.mem.until - w.time) / .35);
    drawSeal(r, this.x, this.y, this.mem.radius, this.age, fade, Math.max(0, 1 - (w.time - this.mem.pulse) / .3));
    const opening = Math.max(0, 1 - this.age / .28);
    if (opening > 0) for (const side of [-1, 1]) {
      const x = this.x + side * (4 + (1 - opening) * 10), y = this.y - 3 - Math.sin(opening * Math.PI) * 5;
      r.pixelLine(this.x, this.y - 2, x, y - 4, '#e4e8ee', 2, opening * .8);
      r.pixelLine(x, y - 4, x + side * 2, y + 2, '#8faed3', 1, opening * .7);
    }
  }
  override light(w: World): void {
    const lit = Math.max(0, 1 - (w.time - this.mem.pulse) / .3);
    const fade = Math.min(1, this.age / .15) * Math.max(0, Math.min(1, (this.mem.until - w.time) / .35));
    w.lights.add(this.x, this.y, 30, '#b3c9ee', { intensity: (.1 + lit * .16) * fade * refugeVisualOpacity(w, this.owner) });
  }
}

/** One short dash flourish, excluded from lockstep state and all damage logic. */
export class RefugeFootwork extends RefugeOwned {
  static override readonly cosmetic = true;
  constructor(w: World, p: Player, private readonly mode: 1 | 2) {
    super(w, p);
    this.x = p.dashX0; this.y = p.dashY0;
    this.layer = 0;
  }
  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    if (this.age >= .34) this.dead = true;
  }
  protected paint(r: Renderer): void {
    const p = this.owner, fade = Math.max(0, 1 - this.age / .34);
    const dx = p.x - this.x, dy = p.y - this.y, length = Math.hypot(dx, dy);
    if (length < 2) return;
    const nx = dx / length, ny = dy / length;
    if (this.mode === 1) {
      for (let i = 1; i <= 6; i++) {
        const a = (i - 1) / 6, b = i / 6;
        const bendA = Math.sin(a * Math.PI) * 4, bendB = Math.sin(b * Math.PI) * 4;
        r.pixelLine(this.x + dx * a - ny * bendA, this.y + dy * a + nx * bendA,
          this.x + dx * b - ny * bendB, this.y + dy * b + nx * bendB, '#c3a9e7', 1, fade * .7);
      }
      drawThreadKnot(r, this.x, this.y, this.age, 3, fade * .8);
    } else {
      for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
        const d = length * (i + .6) / 4, x = this.x + nx * d - ny * side * 4, y = this.y + ny * d + nx * side * 4;
        r.pixelLine(x - nx * 3, y - ny * 3, x + nx * 2, y + ny * 2, side < 0 ? '#e8a5b5' : '#bad8e8', 2, fade * (1 - i * .15));
        r.pixelLine(x + nx * 2, y + ny * 2, x + nx * 2 - ny * side * 2, y + ny * 2 + nx * side * 2, '#f4e6dc', 1, fade * .65);
      }
    }
  }
}
