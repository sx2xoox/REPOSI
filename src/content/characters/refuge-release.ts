import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Renderer } from '../../engine/renderer';
import { runProc } from '../../game/procs';
import { rayLength, segDist } from '../weapons/common';
import { RefugeOwned, aimPoint, nearby, visible, onLane, refugeHit, supportFamily, type SupportFamily } from './refuge-common';
import { slowSealBullets, slowSealEnemy } from './refuge-devices';
import { drawBlast, drawShellWarning, drawThreadKnot, drawWovenThread, drawThreadCut, drawShield, drawShieldWake, drawReleaseStrike, drawCorridor } from './refuge-burst-fx';

/** Fixed-step, owner-bound choreography. Eleven base damage against an unobstructed target. */
export class RefugeRelease extends RefugeOwned {
  constructor(p: Player, mode: number, w: World) {
    super(w, p);
    const point = aimPoint(w, p);
    const length = Math.max(0, rayLength(w, p.x, p.y, p.aim, 155) - 3);
    Object.assign(this.mem, { mode, phase: 0, damage: p.stats.damage, angle: p.aim, ax: p.x, ay: p.y,
      tx: point.x, ty: point.y, length, first: supportFamily(p.weaponId), second: supportFamily(p.weapon2Id),
      prevX: p.x, prevY: p.y, blocks: 9 });
    if (mode === 0) for (let i = 0; i < 3; i++) {
      const requested = Math.max(0, point.length + [-14, 0, 14][i]);
      const d = Math.max(0, rayLength(w, p.x, p.y, p.aim, requested) - 2);
      this.mem['blastX' + i] = p.x + Math.cos(p.aim) * d;
      this.mem['blastY' + i] = p.y + Math.sin(p.aim) * d;
    }
    if (mode === 1) {
      const targets = nearby(w, point.x, point.y, 110).filter(e => visible(w, p.x, p.y, e.x, e.y, e.r)).slice(0, 6);
      for (let i = 0; i < targets.length; i++) this.mem['target' + i] = targets[i].id;
    }
    if (mode === 4) this.layer = 0;
  }

  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    const m = this.mem;
    if (m.mode === 0) this.bombard(w);
    else if (m.mode === 1) this.sever(w);
    else if (m.mode === 2) this.assault(w);
    else if (m.mode === 3) this.shield(w);
    else this.corridor(w);
    if (this.age >= [1.4, 1.45, 1.35, 2.1, 2.5][m.mode]) this.dead = true;
  }

  private bombard(w: World): void {
    const m = this.mem, times = [.26, .59, .92];
    if (m.phase >= 3 || this.age < times[m.phase]) return;
    runProc(w, 'keeper:tove:release:impact', () => {
      const x = m['blastX' + m.phase], y = m['blastY' + m.phase];
      m['blastAt' + m.phase] = this.age;
      for (const target of nearby(w, x, y, 44)) refugeHit(w, this.owner, target, m.damage * [3, 3.5, 4.5][m.phase], this, true, 30);
      w.sfx('explosion', { vol: .48, pitch: 1.15 - m.phase * .12, x });
      m.phase++;
      return true;
    });
  }

  private sever(w: World): void {
    const m = this.mem, times = [.25, .55, .9];
    if (m.phase >= 3 || this.age < times[m.phase]) return;
    runProc(w, 'keeper:luen:release:cut', () => {
      for (let i = 0; i < 6; i++) {
        const target = w.enemies.find(e => e.id === m['target' + i]);
        if (!target || !visible(w, m.ax, m.ay, target.x, target.y, target.r) || Math.hypot(target.x - m.ax, target.y - m.ay) > 240) continue;
        refugeHit(w, this.owner, target, m.damage * [2, 3, 6][m.phase], this, true);
      }
      w.sfx('paper_flutter', { vol: .4, pitch: 1.4 - m.phase * .15 });
      m.phase++;
      return true;
    });
  }

  private assault(w: World): void {
    const m = this.mem, times = [.22, .53, .86];
    if (m.phase >= 3 || this.age < times[m.phase]) return;
    runProc(w, 'keeper:ves:release:strike', () => {
      const family = m.phase === 0 ? m.first : m.second;
      const bx = m.ax + Math.cos(m.angle) * m.length, by = m.ay + Math.sin(m.angle) * m.length;
      for (const target of w.enemies) {
        const dx = target.x - m.ax, dy = target.y - m.ay, distance = Math.hypot(dx, dy);
        const direction = distance < 1 ? 1 : (dx * Math.cos(m.angle) + dy * Math.sin(m.angle)) / distance;
        const inside = m.phase === 2 || family === 0
          ? distance < 140 + target.r && direction > .25
          : family === 2 ? Math.hypot(target.x - m.tx, target.y - m.ty) < 55 + target.r
            : onLane(w, target, m.ax, m.ay, bx, by, 24);
        if (inside && visible(w, m.ax, m.ay, target.x, target.y, target.r)) refugeHit(w, this.owner, target, m.damage * [3, 3, 5][m.phase], this, true, m.phase === 2 ? 60 : 0);
      }
      w.sfx(m.phase === 2 ? 'swing_heavy' : 'swing', { vol: .4, pitch: m.phase === 2 ? .9 : 1.25 });
      m.phase++;
      return true;
    });
  }

  private shield(w: World): void {
    const m = this.mem, t = Math.min(1, this.age / 1.7), phase = t < .5 ? 0 : 1;
    const distance = m.length * (t < .5 ? t * 2 : (1 - t) * 2);
    this.x = m.ax + Math.cos(m.angle) * distance;
    this.y = m.ay + Math.sin(m.angle) * distance;
    const nx = Math.cos(m.angle), ny = Math.sin(m.angle);
    const previous = (m.prevX - m.ax) * nx + (m.prevY - m.ay) * ny;
    const swept = (x: number, y: number, radius: number): boolean => {
      const along = (x - m.ax) * nx + (y - m.ay) * ny;
      const across = -(x - m.ax) * ny + (y - m.ay) * nx;
      return Math.abs(across) <= 27 + radius && along >= Math.min(previous, distance) - 7 - radius && along <= Math.max(previous, distance) + 7 + radius;
    };
    for (const target of w.enemies) {
      if (!target.alive || target.hidden || !target.vulnerable || m['hit' + phase + ':' + target.id]) continue;
      if (swept(target.x, target.y, target.r) && visible(w, m.ax, m.ay, target.x, target.y, target.r)) {
        m['hit' + phase + ':' + target.id] = 1;
        m['pending:' + target.id] = (m['pending:' + target.id] ?? 0) + 1;
      }
    }
    runProc(w, 'keeper:ort:release:impact', () => {
      let success = false;
      for (const target of w.enemies) {
        const key = 'pending:' + target.id, hits = m[key] ?? 0;
        if (!hits) continue;
        m[key] = 0;
        if (visible(w, m.ax, m.ay, target.x, target.y, target.r)) success = refugeHit(w, this.owner, target, m.damage * 5.5 * hits, this, true, 35) || success;
      }
      if (success) w.sfx('hit_metal', { vol: .4, pitch: .8, x: this.x });
      return success;
    });
    if (m.blocks > 0) runProc(w, 'keeper:ort:release:block', () => {
      let count = 0;
      for (const bullet of w.projectiles) {
        if (count >= 3 || m.blocks <= 0) break;
        if (bullet.dead || bullet.team !== 'enemy' || bullet.delay > 0 || bullet.z > 18) continue;
        if (!swept(bullet.x, bullet.y, bullet.r) || !visible(w, this.x, this.y, bullet.x, bullet.y, bullet.r)) continue;
        bullet.dead = true; m.blocks--; count++;
      }
      return count > 0;
    });
    m.prevX = this.x; m.prevY = this.y;
  }

  private corridor(w: World): void {
    const m = this.mem, bx = m.ax + Math.cos(m.angle) * m.length, by = m.ay + Math.sin(m.angle) * m.length;
    const inside = (x: number, y: number, radius: number) => segDist(x, y, m.ax, m.ay, bx, by).d <= 29 + radius && visible(w, m.ax, m.ay, x, y, radius);
    if (this.age < 2) slowSealBullets(w, inside, .55);
    const times = [.2, .7, 1.2, 1.7, 2];
    if (m.phase >= times.length || this.age < times[m.phase]) return;
    runProc(w, 'keeper:mira:release:page', () => {
      for (const target of w.enemies) {
        if (!target.alive || target.hidden || !target.vulnerable || !inside(target.x, target.y, target.r)) continue;
        if (m.phase < 4) slowSealEnemy(w, target);
        refugeHit(w, this.owner, target, m.damage * (m.phase === 4 ? 8 : .75), this, true);
      }
      w.sfx('paper_flutter', { vol: m.phase === 4 ? .5 : .2, pitch: m.phase === 4 ? .8 : 1.3 });
      m.phase++;
      return true;
    });
  }

  protected paint(r: Renderer, w: World): void {
    const m = this.mem, t = this.age;
    if (m.mode === 0) {
      const times = [.26, .59, .92];
      for (let i = 0; i < 3; i++) {
        if (m['blastAt' + i] !== undefined) drawBlast(r, m['blastX' + i], m['blastY' + i], t - m['blastAt' + i], 44, true);
        else drawShellWarning(r, m['blastX' + i], m['blastY' + i], times[i] - t, i);
      }
    } else if (m.mode === 1) {
      const fade = Math.max(0, Math.min(1, (1.45 - t) / .4));
      const tension = Math.min(1, t / .23), cut = Math.max(0, Math.min(1, (t - .9) / .22));
      for (let i = 0; i < 6; i++) {
        const target = w.enemies.find(e => e.id === m['target' + i] && e.alive && !e.hidden);
        if (!target || !visible(w, m.ax, m.ay, target.x, target.y, target.r)) continue;
        const side = i % 2 ? 1 : -1;
        const ax = m.ax - Math.sin(m.angle) * side * 11, ay = m.ay + Math.cos(m.angle) * side * 11 - 5;
        drawWovenThread(r, ax, ay, target.x, target.y - 8, t + i * .12, (.3 + tension * .45) * (1 - cut), side * (13 - tension * 9));
        drawThreadKnot(r, target.x, target.y - 9, t, (8 - tension * 2) * (1 - cut * .45), fade * (1 - cut * .5));
        for (const [stage, at] of [.25, .55, .9].entries()) if (m.phase > stage) drawThreadCut(r, target.x, target.y - 8, t - at, stage);
      }
      // The shuttle remains visible even when the final cut defeats every target.
      drawThreadKnot(r, m.ax, m.ay - 6, t, 13 - tension * 4 + cut * 4, fade * .8);
      if (m.phase === 3) drawThreadCut(r, m.ax, m.ay - 6, t - .9, 2);
    } else if (m.mode === 2) {
      const times = [.22, .53, .86];
      for (let i = 0; i < 3; i++) {
        const family = (i === 2 ? 0 : i === 0 ? m.first : m.second) as SupportFamily;
        const offset = i === 0 ? -12 : i === 1 ? 12 : 0;
        const ax = m.ax - Math.sin(m.angle) * offset, ay = m.ay + Math.cos(m.angle) * offset;
        const tx = family === 1 || family === 3 ? ax + Math.cos(m.angle) * m.length : m.tx;
        const ty = family === 1 || family === 3 ? ay + Math.sin(m.angle) * m.length : m.ty;
        drawReleaseStrike(r, ax, ay, tx, ty, t - times[i], family, i === 2, i === 0 ? -1 : 1, m.length,
          (angle, radius) => Math.max(0, rayLength(w, ax, ay, angle, radius) - 3));
      }
    } else if (m.mode === 3) {
      const fade = Math.max(0, Math.min(1, (2.1 - t) / .4));
      const nx = Math.cos(m.angle), ny = Math.sin(m.angle);
      if (t < 1.7) drawShieldWake(r, this.x, this.y, m.angle, t, t < .85, fade);
      // Ground brackets identify its launch point and the safe side of the moving face.
      for (const side of [-1, 1]) {
        const x = m.ax - ny * side * 25, y = m.ay + nx * side * 25;
        r.line(x - nx * 5, y - ny * 5, x + nx * 5, y + ny * 5, '#b8caa1', 1, fade * .35);
      }
      drawShield(r, this.x, this.y, m.angle, 28, m.blocks > 0 ? 2 : 0, fade);
      const reversal = Math.max(0, 1 - Math.abs(t - .85) / .12);
      if (reversal > 0) r.line(this.x + ny * 23 + nx * 10, this.y - nx * 23 + ny * 10,
        this.x - ny * 23 + nx * 10, this.y + nx * 23 + ny * 10, '#edf0cd', 2, reversal * .75);
    } else drawCorridor(r, m.ax, m.ay, m.angle, m.length, t);
  }
}
