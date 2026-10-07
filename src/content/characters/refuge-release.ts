import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Enemy } from '../../game/enemy';
import type { Renderer } from '../../engine/renderer';
import { runProc } from '../../game/procs';
import { Afterimage } from '../../game/effects';
import type { ProjBehavior } from '../../game/projectile';
import { rayLength } from '../weapons/common';
import { RefugeOwned, aimPoint, nearby, visible, refugeHit } from './refuge-common';
import { RefugeCharge, slowSealEnemy } from './refuge-devices';
import { drawBlast, drawCharge, drawThreadKnot, drawWovenThread, drawThreadCut, drawShield, drawShieldWake, drawBlinkStrike, drawStasis } from './refuge-burst-fx';
import { blastImpact, pageImpact, shieldDust, shieldImpact, stasisClose, strikeImpact, threadImpact } from './refuge-impact-fx';

// Five releases, one verb each. Every one deals about eleven base damage to a
// single unobstructed target with no preparation; preparation or reading the
// fight adds something on top instead of being required:
//   토브 연쇄 기폭  charges thrown onto every enemy in sight burst in a chain (a crowd
//                  shares the budget); charges and mines already placed go off first at double power
//   루엔 매듭 끌어당기기  linked enemies are hauled to one knot and bound, then cut
//   베스 교차 습격  blink behind up to three enemies in turn, invulnerable meanwhile
//   오르트 되받아치는 방패  a tower shield sends enemy shots back, then bashes forward
//   미라 멈춘 책장  enemies and their shots stop inside the dome; the keeper's own
//                  hits inside are written down and paid back when it closes

const TOVE_RANGE = 170;
const TOVE_MAX = 6;
/**
 * A lone target takes the full 11x; a crowd shares a 40x budget (so three or
 * more targets get 40/n each), in line with the other keepers' crowd releases.
 * Each enemy's total from the chain, splash included, is capped at its share.
 */
const TOVE_SINGLE = 11;
const TOVE_CROWD = 40;
const TOVE_SPLASH = 3;
const TOVE_THROW = .26;
const LUEN_TIMES = [.25, .55, .9];
const LUEN_DAMAGE = [2, 3, 6];
const VES_TIMES = [.22, .53, .86];
const VES_DAMAGE = [3, 3, 5];
const ORT_SLAM = .14;
const ORT_BASH = 1.5;
const ORT_RETURNS = 10;
const MIRA_PULSES = [.2, .7, 1.2, 1.7];
const MIRA_CLOSE = 2;
const MIRA_RADIUS = 58;
/** share of the keeper's own direct damage inside the dome paid back on closing, capped per enemy */
const MIRA_STORE = .3;
const MIRA_STORE_CAP = 6;

/** Enemy shots inside Mira's dome stand still (velocity only; syncVel restores it every step). */
const stasisBulletBehavior: ProjBehavior = {
  id: 'refuge_stasis',
  update(bullet, w) {
    if ((bullet.mem.rfStasisAt ?? -99) < w.time - w.dt - .000001) return;
    bullet.vx = 0;
    bullet.vy = 0;
  },
  draw(bullet, r, w) {
    if ((bullet.mem.rfStasisAt ?? -99) < w.time - w.dt - .000001) return;
    const y = bullet.y - bullet.z;
    r.pixelRing(bullet.x, y, bullet.r + 3, '#d5e1f3', 1, .7);
  },
};

function alive(e: Enemy | undefined): e is Enemy {
  return !!e && e.alive && !e.hidden && e.vulnerable;
}

/** Fixed-step, owner-bound choreography. */
export class RefugeRelease extends RefugeOwned {
  constructor(p: Player, mode: number, w: World) {
    super(w, p);
    const point = aimPoint(w, p);
    const length = Math.max(0, rayLength(w, p.x, p.y, p.aim, 155) - 3);
    Object.assign(this.mem, { mode, phase: 0, damage: p.stats.damage, angle: p.aim, ax: p.x, ay: p.y,
      tx: point.x, ty: point.y, length, prevX: p.x, prevY: p.y });
    if (mode === 0) this.setupCharges(w, p);
    if (mode === 1) {
      const targets = nearby(w, point.x, point.y, 110).filter(e => visible(w, p.x, p.y, e.x, e.y, e.r)).slice(0, 6);
      for (let i = 0; i < targets.length; i++) this.mem['target' + i] = targets[i].id;
    }
    if (mode === 2) p.invuln = Math.max(p.invuln, VES_TIMES[2] + .25);
    if (mode === 4) {
      const q = aimPoint(w, p, 120, 70);
      this.mem.kx = q.x;
      this.mem.ky = q.y;
      this.x = q.x;
      this.y = q.y;
      this.layer = 0;
    }
  }

  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    const m = this.mem;
    if (m.mode === 0) this.chain(w);
    else if (m.mode === 1) this.haul(w);
    else if (m.mode === 2) this.assault(w);
    else if (m.mode === 3) this.tower(w, dt);
    else this.stasis(w);
    if (this.age >= [1.5, 1.45, 1.3, 2.05, 2.45][m.mode]) this.dead = true;
  }

  // ------------------------------------------------------------- 토브
  private setupCharges(w: World, p: Player): void {
    const m = this.mem;
    const targets = w.enemies.filter(e => alive(e) && Math.hypot(e.x - p.x, e.y - p.y) <= TOVE_RANGE + e.r && visible(w, p.x, p.y, e.x, e.y, e.r))
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y) || a.id - b.id).slice(0, TOVE_MAX);
    m.count = Math.max(1, targets.length);
    for (let i = 0; i < targets.length; i++) {
      m['target' + i] = targets[i].id;
      m['lastX' + i] = targets[i].x;
      m['lastY' + i] = targets[i].y;
    }
    // nobody in sight: one charge lands where the keeper aims
    if (!targets.length) { m.target0 = 0; m.lastX0 = m.tx; m.lastY0 = m.ty; }
    // what Tove already placed goes off first, at double power
    let primed = 0;
    for (const e of w.entities) if (e instanceof RefugeCharge && e.owner === p && e.prime(.12 + primed * .06)) primed++;
    m.primed = primed;
  }

  private fuse(i: number): number {
    return TOVE_THROW + .3 + i * .09;
  }

  private chain(w: World): void {
    const m = this.mem;
    for (let i = 0; i < m.count; i++) {
      const target = m['target' + i] ? w.enemies.find(e => e.id === m['target' + i]) : undefined;
      if (alive(target)) { m['lastX' + i] = target.x; m['lastY' + i] = target.y; }
    }
    if (m.phase >= m.count || this.age < this.fuse(m.phase)) return;
    runProc(w, 'keeper:tove:release:impact', () => {
      const i = m.phase, x = m['lastX' + i], y = m['lastY' + i];
      const share = Math.min(TOVE_SINGLE, TOVE_CROWD / m.count), cap = m.damage * share;
      m['blastAt' + i] = this.age;
      for (const target of nearby(w, x, y, 34)) {
        const key = 'dealt:' + target.id, dealt = m[key] ?? 0;
        const wanted = m.damage * (target.id === m['target' + i] || !m['target' + i] ? share : TOVE_SPLASH);
        const amount = Math.min(wanted, cap - dealt);
        if (amount > 0 && refugeHit(w, this.owner, target, amount, this, true, 40)) m[key] = dealt + amount;
      }
      w.sfx('explosion', { vol: .45, pitch: 1.2 - i * .05, x });
      blastImpact(w, this.owner, x, y, 40, i === 0 || i === m.count - 1);
      m.phase++;
      return true;
    });
  }

  // ------------------------------------------------------------- 루엔
  private haul(w: World): void {
    const m = this.mem;
    if (m.phase >= 3 || this.age < LUEN_TIMES[m.phase]) return;
    runProc(w, 'keeper:luen:release:cut', () => {
      const knotX = m.tx, knotY = m.ty;
      for (let i = 0; i < 6; i++) {
        const target = w.enemies.find(e => e.id === m['target' + i]);
        if (!target || !visible(w, m.ax, m.ay, target.x, target.y, target.r) || Math.hypot(target.x - m.ax, target.y - m.ay) > 240) continue;
        refugeHit(w, this.owner, target, m.damage * LUEN_DAMAGE[m.phase], this, true);
        if (m.phase === 0 && target.alive && !target.isBoss) {
          // hauled to the knot (wall-stopped by its own movement) and bound there
          const dx = knotX - target.x, dy = knotY - target.y, d = Math.hypot(dx, dy);
          const pull = Math.max(0, Math.min(110, d - 6 - target.r));
          if (pull > 0 && visible(w, target.x, target.y, knotX, knotY, target.r)) target.knock(dx / d, dy / d, pull * 10 * Math.max(.2, target.mass));
          target.applyStatus({ kind: 'stun', duration: .9, power: 1 }, () => w.rng.next());
        }
        threadImpact(w, this.owner, target.x, target.y - 8, m.phase === 1 ? -.8 : .8, m.phase === 2);
      }
      if (m.phase === 2) threadImpact(w, this.owner, knotX, knotY - 6, 0, true);
      w.sfx('paper_flutter', { vol: .4, pitch: 1.4 - m.phase * .15 });
      m.phase++;
      return true;
    });
  }

  // ------------------------------------------------------------- 베스
  /** Next enemy to cross: the nearest one not struck yet, else the nearest; only ones Ves can reach and stand behind. */
  private pickVictim(w: World, p: Player): Enemy | undefined {
    const m = this.mem;
    const pool = w.enemies.filter(e => alive(e) && Math.hypot(e.x - p.x, e.y - p.y) <= 140 + e.r && visible(w, p.x, p.y, e.x, e.y, e.r))
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y) || a.id - b.id);
    return pool.find(e => !m['struck:' + e.id]) ?? pool[0];
  }

  private assault(w: World): void {
    const m = this.mem, p = this.owner;
    if (m.phase >= 3 || this.age < VES_TIMES[m.phase]) return;
    runProc(w, 'keeper:ves:release:strike', () => {
      const final = m.phase === 2, damage = m.damage * VES_DAMAGE[m.phase];
      const victim = this.pickVictim(w, p);
      const fromX = p.x, fromY = p.y;
      let cx: number, cy: number;
      if (victim) {
        // land just behind the victim; if that is a wall or a pit, on the near side; else strike from here
        const d = Math.hypot(victim.x - p.x, victim.y - p.y) || 1, ux = (victim.x - p.x) / d, uy = (victim.y - p.y) / d;
        const gap = victim.r + p.r + 4;
        const spots: [number, number][] = [[victim.x + ux * gap, victim.y + uy * gap], [victim.x - ux * gap, victim.y - uy * gap]];
        for (const [x, y] of spots) {
          if (w.room.isFree(x, y, p.r) && visible(w, p.x, p.y, x, y, 0)) { p.x = x; p.y = y; break; }
        }
        cx = victim.x; cy = victim.y;
        m['struck:' + victim.id] = 1;
      } else {
        // nobody in reach: a short lunge along the aim, cutting whatever is there
        const reach = Math.max(0, rayLength(w, p.x, p.y, m.angle, 70) - p.r - 2);
        const x = p.x + Math.cos(m.angle) * reach, y = p.y + Math.sin(m.angle) * reach;
        if (w.room.isFree(x, y, p.r)) { p.x = x; p.y = y; }
        cx = p.x + Math.cos(m.angle) * 14; cy = p.y + Math.sin(m.angle) * 14;
      }
      p.vx = p.vy = 0;
      p.invuln = Math.max(p.invuln, .3);
      const hand = final ? 0 : m.phase === 0 ? -1 : 1;
      for (const target of nearby(w, cx, cy, final ? 30 : 22)) {
        if (refugeHit(w, this.owner, target, damage, this, true, final ? 60 : 0)) strikeImpact(w, this.owner, target.x, target.y - 4, Math.atan2(target.y - fromY, target.x - fromX), hand, final);
      }
      if (fromX !== p.x || fromY !== p.y) w.spawn(new Afterimage(p.frameName(), fromX, fromY, p.spriteFlip, hand < 0 ? '#ee9fb6' : '#9fcbe8', .3));
      Object.assign(m, { ['fx' + m.phase]: fromX, ['fy' + m.phase]: fromY, ['lx' + m.phase]: p.x, ['ly' + m.phase]: p.y, ['cx' + m.phase]: cx, ['cy' + m.phase]: cy, ['at' + m.phase]: this.age });
      w.sfx(final ? 'swing_heavy' : 'swing', { vol: .4, pitch: final ? .9 : 1.25 });
      if (final) w.shake(.25);
      m.phase++;
      return true;
    });
  }

  // ------------------------------------------------------------- 오르트
  private tower(w: World, dt: number): void {
    const m = this.mem, p = this.owner;
    const nx0 = Math.cos(p.aim), ny0 = Math.sin(p.aim);
    if (this.age < ORT_BASH) {
      // the tower shield stands in front of Ort and turns with the aim
      m.angle = p.aim;
      const d = Math.max(0, rayLength(w, p.x, p.y, p.aim, 20) - 2);
      this.x = p.x + nx0 * d;
      this.y = p.y + ny0 * d;
      m.ax = p.x; m.ay = p.y; m.bashFrom = d;
    } else {
      // the bash: the shield drives forward along its last facing
      const k = Math.min(1, (this.age - ORT_BASH) / .22), reach = Math.max(m.bashFrom, rayLength(w, m.ax, m.ay, m.angle, 100) - 4);
      const d = m.bashFrom + (reach - m.bashFrom) * (1 - (1 - k) * (1 - k));
      this.x = m.ax + Math.cos(m.angle) * d;
      this.y = m.ay + Math.sin(m.angle) * d;
    }
    const nx = Math.cos(m.angle), ny = Math.sin(m.angle);
    if (!m.slammed && this.age >= ORT_SLAM) runProc(w, 'keeper:ort:release:slam', () => {
      m.slammed = 1;
      for (const target of w.enemies) {
        if (!alive(target)) continue;
        const dx = target.x - p.x, dy = target.y - p.y, dist = Math.hypot(dx, dy) || 1;
        if (dist <= 64 + target.r && (dx * nx + dy * ny) / dist > .35 && visible(w, p.x, p.y, target.x, target.y, target.r) &&
          refugeHit(w, this.owner, target, m.damage * 3, this, true, 50)) shieldImpact(w, this.owner, target.x, target.y - 4, m.angle, true);
      }
      w.sfx('hit_metal', { vol: .45, pitch: .7, x: this.x });
      w.shake(.2);
      return true;
    });
    if (this.age < ORT_BASH && (m.returns ?? 0) < ORT_RETURNS) this.returnShots(w, dt, nx, ny);
    if (this.age >= ORT_BASH) {
      // anything the moving face sweeps over is bashed once
      const previous = Math.hypot(m.prevX - m.ax, m.prevY - m.ay), now = Math.hypot(this.x - m.ax, this.y - m.ay);
      runProc(w, 'keeper:ort:release:impact', () => {
        let success = false;
        for (const target of w.enemies) {
          if (!alive(target) || m['bashed:' + target.id]) continue;
          const along = (target.x - m.ax) * nx + (target.y - m.ay) * ny, across = -(target.x - m.ax) * ny + (target.y - m.ay) * nx;
          if (Math.abs(across) > 27 + target.r || along < Math.min(previous, now) - 8 - target.r || along > Math.max(previous, now) + 8 + target.r) continue;
          if (!visible(w, m.ax, m.ay, target.x, target.y, target.r)) continue;
          m['bashed:' + target.id] = 1;
          if (refugeHit(w, this.owner, target, m.damage * 8, this, true, 70)) {
            success = true;
            shieldImpact(w, this.owner, target.x, target.y - 4, m.angle, true);
          }
        }
        if (success) { w.sfx('hit_metal', { vol: .5, pitch: .8, x: this.x }); w.shake(.25); }
        return success;
      });
      if (this.age < ORT_BASH + .25 && Math.floor(this.age * 20) !== Math.floor((this.age - dt) * 20)) shieldDust(w, this.owner, this.x, this.y);
    }
    m.prevX = this.x; m.prevY = this.y;
  }

  /** Shots striking the shield face are destroyed and returned at the nearest enemy ahead (one batch per step). */
  private returnShots(w: World, dt: number, nx: number, ny: number): void {
    const m = this.mem, step = dt * (w.floor.shotSpeed ?? 1);
    const struck = w.projectiles.filter(bullet => {
      if (bullet.dead || bullet.team !== 'enemy' || bullet.delay > 0 || bullet.z > 18) return false;
      const speed = bullet.vx * nx + bullet.vy * ny;
      if (speed >= 0) return false;
      const dx = bullet.x - this.x, dy = bullet.y - this.y, front = dx * nx + dy * ny;
      if (front + speed * step > bullet.r + 4 || front - speed * step < -bullet.r - 4) return false;
      return Math.abs(-dx * ny + dy * nx) <= 28 + bullet.r && visible(w, this.x, this.y, bullet.x, bullet.y, bullet.r);
    });
    if (!struck.length) return;
    runProc(w, 'keeper:ort:release:return', () => {
      for (const bullet of struck) {
        if ((m.returns ?? 0) >= ORT_RETURNS) break;
        bullet.dead = true;
        m.returns = (m.returns ?? 0) + 1;
        const ahead = w.enemies.filter(e => {
          if (!alive(e)) return false;
          const ex = e.x - this.x, ey = e.y - this.y, d = Math.hypot(ex, ey) || 1;
          return d <= 240 && (ex * nx + ey * ny) / d > .2 && visible(w, this.x, this.y, e.x, e.y, e.r);
        }).sort((a, b) => Math.hypot(a.x - this.x, a.y - this.y) - Math.hypot(b.x - this.x, b.y - this.y) || a.id - b.id)[0];
        const slot = (m.returns - 1) % 4;
        Object.assign(m, { ['rx' + slot]: bullet.x, ['ry' + slot]: bullet.y, ['rt' + slot]: this.age,
          ['rex' + slot]: ahead ? ahead.x : bullet.x + nx * 60, ['rey' + slot]: ahead ? ahead.y : bullet.y + ny * 60 });
        if (ahead) refugeHit(w, this.owner, ahead, m.damage * 1.2, this, true, 20);
        shieldImpact(w, this.owner, bullet.x, bullet.y, m.angle, false);
      }
      w.sfx('parry', { vol: .3, pitch: 1.1, x: this.x });
      return true;
    });
  }

  // ------------------------------------------------------------- 미라
  inside(w: World, x: number, y: number, radius: number): boolean {
    return Math.hypot(x - this.mem.kx, y - this.mem.ky) <= MIRA_RADIUS + radius && visible(w, this.mem.kx, this.mem.ky, x, y, radius);
  }

  /** Mira's own direct hit on an enemy inside the dome (from her passive): written down for the closing. */
  record(w: World, target: Enemy, amount: number): void {
    const m = this.mem;
    if (this.dead || this.age >= MIRA_CLOSE || !this.inside(w, target.x, target.y, target.r)) return;
    const key = 'store:' + target.id;
    m[key] = Math.min(m.damage * MIRA_STORE_CAP, (m[key] ?? 0) + amount * MIRA_STORE);
  }

  private stasis(w: World): void {
    const m = this.mem;
    if (this.age < MIRA_CLOSE) {
      for (const bullet of w.projectiles) {
        if (bullet.dead || bullet.team !== 'enemy' || bullet.delay > 0 || !this.inside(w, bullet.x, bullet.y, bullet.r)) continue;
        bullet.mem.rfStasisAt = w.time;
        if (!bullet.mem.rfStasisBehavior) { bullet.mem.rfStasisBehavior = 1; bullet.addBehavior(stasisBulletBehavior); }
      }
      for (const target of w.enemies) {
        if (!alive(target) || !this.inside(w, target.x, target.y, target.r)) continue;
        // bosses only stagger once and are slowed; everyone else stands frozen
        if (target.isBoss) { if (!m['boss:' + target.id]) { m['boss:' + target.id] = 1; target.applyStatus({ kind: 'freeze', duration: .35, power: 1 }, () => w.rng.next()); } slowSealEnemy(w, target); }
        else target.applyStatus({ kind: 'freeze', duration: .12, power: 1 }, () => w.rng.next());
      }
    }
    const times = [...MIRA_PULSES, MIRA_CLOSE];
    if (m.phase >= times.length || this.age < times[m.phase]) return;
    runProc(w, 'keeper:mira:release:page', () => {
      const closing = m.phase === 4;
      for (const target of w.enemies) {
        if (!alive(target) || !this.inside(w, target.x, target.y, target.r)) continue;
        const stored = closing ? m['store:' + target.id] ?? 0 : 0;
        refugeHit(w, this.owner, target, m.damage * (closing ? 8 : .75) + stored, this, true);
      }
      if (closing) stasisClose(w, this.owner, m.kx, m.ky, MIRA_RADIUS);
      else pageImpact(w, this.owner, m.kx, m.ky - 4, false);
      w.sfx('paper_flutter', { vol: closing ? .5 : .2, pitch: closing ? .8 : 1.3 });
      m.phase++;
      return true;
    });
  }

  // ------------------------------------------------------------- drawing
  protected paint(r: Renderer, w: World): void {
    const m = this.mem, t = this.age;
    if (m.mode === 0) {
      for (let i = 0; i < m.count; i++) {
        const target = m['target' + i] ? w.enemies.find(e => e.id === m['target' + i]) : undefined;
        const x = alive(target) ? target.x : m['lastX' + i], y = alive(target) ? target.y : m['lastY' + i];
        if (m['blastAt' + i] !== undefined) { drawBlast(r, x, y, t - m['blastAt' + i], 34, true); continue; }
        if (t < TOVE_THROW) {
          // thrown in an arc from Tove's hands
          const k = t / TOVE_THROW, px = m.ax + (x - m.ax) * k, py = m.ay - 8 + (y - 12 - m.ay + 8) * k - Math.sin(k * Math.PI) * 22;
          drawCharge(r, px, py, 1, t, 1);
        } else {
          const remaining = Math.max(0, 1 - (t - TOVE_THROW) / (this.fuse(i) - TOVE_THROW));
          drawCharge(r, x, y - 12, remaining, t - TOVE_THROW, .6 + .4 * Math.sin(t * 30 + i));
        }
      }
    } else if (m.mode === 1) {
      const fade = Math.max(0, Math.min(1, (1.45 - t) / .4));
      const tension = Math.min(1, t / LUEN_TIMES[0]), cut = Math.max(0, Math.min(1, (t - LUEN_TIMES[2]) / .22));
      for (let i = 0; i < 6; i++) {
        const target = w.enemies.find(e => e.id === m['target' + i] && e.alive && !e.hidden);
        if (!target || !visible(w, m.ax, m.ay, target.x, target.y, target.r)) continue;
        if (t < LUEN_TIMES[0]) {
          // threads shoot out from Luen's hands to every target
          const side = i % 2 ? 1 : -1;
          const ax = m.ax - Math.sin(m.angle) * side * 8, ay = m.ay + Math.cos(m.angle) * side * 8 - 5;
          drawWovenThread(r, ax, ay, target.x, target.y - 8, t + i * .12, .55 + tension * .4, side * (12 - tension * 9));
        } else drawWovenThread(r, m.tx, m.ty - 6, target.x, target.y - 8, t + i * .12, .85 * (1 - cut), 0);
        drawThreadKnot(r, target.x, target.y - 9, t, 6 * (1 - cut * .45), fade * (1 - cut * .5));
        for (const [stage, at] of LUEN_TIMES.entries()) if (m.phase > stage) drawThreadCut(r, target.x, target.y - 8, t - at, stage);
      }
      drawThreadKnot(r, m.tx, m.ty - 6, t, 6 + tension * 6 + cut * 4, fade);
      if (m.phase === 3) drawThreadCut(r, m.tx, m.ty - 6, t - LUEN_TIMES[2], 2);
    } else if (m.mode === 2) {
      for (let i = 0; i < 3; i++) {
        if (m['at' + i] === undefined) {
          // the next blade drawn back: a glint beside the keeper before each blink
          const until = VES_TIMES[i] - t;
          if (until > 0 && until < .14) {
            const p = this.owner, side = i === 1 ? 1 : -1, k = 1 - until / .14;
            r.pixelLine(p.x + side * 6, p.y - 10, p.x + side * (6 + k * 5), p.y - 16, '#ffffff', 1, k);
          }
          continue;
        }
        drawBlinkStrike(r, m['fx' + i], m['fy' + i], m['lx' + i], m['ly' + i], m['cx' + i], m['cy' + i], t - m['at' + i], i === 2 ? 0 : i === 0 ? -1 : 1, i === 2);
      }
    } else if (m.mode === 3) {
      const fade = Math.max(0, Math.min(1, (2.05 - t) / .35));
      if (t >= ORT_BASH && t < ORT_BASH + .4) drawShieldWake(r, this.x, this.y, m.angle, t, true, fade);
      const slam = Math.max(0, 1 - Math.abs(t - ORT_SLAM) / .12);
      if (slam > 0) r.pixelRing(this.x, this.y + 2, 18 + (1 - slam) * 22, '#edf0cd', 2, slam * .7);
      drawShield(r, this.x, this.y, m.angle, 28, (m.returns ?? 0) < ORT_RETURNS ? 2 : 1, fade);
      for (let s = 0; s < 4; s++) {
        const at = m['rt' + s];
        if (at === undefined || t - at > .16) continue;
        const k = 1 - (t - at) / .16;
        r.pixelLine(m['rx' + s], m['ry' + s], m['rex' + s], m['rey' + s] - 4, '#263d38', 3, k * .6);
        r.pixelLine(m['rx' + s], m['ry' + s], m['rex' + s], m['rey' + s] - 4, '#f4f0c8', 1, k);
      }
    } else {
      const open = Math.min(1, t / .18), closing = Math.max(0, Math.min(1, (t - MIRA_CLOSE) / .22));
      let pulse = 0;
      for (const at of MIRA_PULSES) if (t >= at && t < MIRA_CLOSE) pulse = Math.max(pulse, Math.max(0, 1 - (t - at) / .25));
      const alpha = open * (t < MIRA_CLOSE ? 1 : Math.max(0, 1 - (t - MIRA_CLOSE) / .4));
      drawStasis(r, m.kx, m.ky, MIRA_RADIUS * (.6 + .4 * open), t, alpha, pulse, closing);
      if (t >= MIRA_CLOSE && t < MIRA_CLOSE + .2) {
        const k = 1 - (t - MIRA_CLOSE) / .2;
        r.pixelDisc(m.kx, m.ky, 10 + (1 - k) * 18, '#ffffff', k * .8);
      }
    }
  }
}
