import type { Renderer } from '../../engine/renderer';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import type { Enemy } from '../../game/enemy';
import { Projectile, type ProjBehavior } from '../../game/projectile';
import { runProc, runProcStatus } from '../../game/procs';
import { proc } from '../items/lib';
import { rayLength, segDist } from '../weapons/common';
import { RefugeOwned, nearby, visible, refugeHit, onLane, refugeVisualOpacity, type SupportFamily } from './refuge-common';
import { drawBlast, drawCharge, drawThreadKnot, drawShield, drawSeal, drawSupport } from './refuge-burst-fx';
import { blastImpact, pageImpact, shieldImpact, strikeImpact, threadPulse } from './refuge-impact-fx';

// Favoured weapon (CharacterDef.affinity, p.flags 'affinity'): each keeper's own device
// gets stronger instead of the weapon hitting harder (see REFUGE_AFFINITIES).
/** 토브: a blast hands a fresh charge to an enemy it caught (that one never relays), and more mines */
export const TOVE_RELAY_SHARE = 1.2;
export const TOVE_RELAY_FUSE = .45;
/** the handed-on charge is a tighter blast (charges 30 px, mines 35 px) */
export const TOVE_RELAY_RADIUS = 22;
/** ...that hits its carrier in full and the others it catches at this share (it must not turn a pack into a second full blast) */
export const TOVE_RELAY_SPLASH = .3;
export const TOVE_MINES = 2;
export const TOVE_MINES_AFFINITY = 3;
/** 루엔: linked enemies, and the double knot tied on the struck enemy at every transfer (share of the pool) */
export const LUEN_LINKS = 3;
export const LUEN_LINKS_AFFINITY = 5;
export const LUEN_KNOT_AFFINITY = 1.1;
/** 베스: with a favoured weapon each support technique is followed by the other hand's (delay s, share of its damage) */
export const VES_ECHO_DELAY = .22;
export const VES_ECHO_AFFINITY = 1.08;
/** the follow-up is aimed at the first technique's enemy: anyone else it catches takes this share */
export const VES_ECHO_SPLASH = .35;
/** 오르트: shield durability, refill time (s), and the blocked shot sent back (x keeper damage) */
export const ORT_CHARGES = 2;
export const ORT_CHARGES_AFFINITY = 3;
export const ORT_REFILL = 2.4;
export const ORT_REFILL_AFFINITY = 1.8;
export const ORT_REFLECT_AFFINITY = 3;
/** half-width of the shield face (px): a favoured weapon raises a broader shield */
export const ORT_WIDTH = 17;
export const ORT_WIDTH_AFFINITY = 23;
/**
 * 미라: seal pulse interval (s); with a favoured weapon the enemy the seal was opened on is pinned:
 * its own pulse every MIRA_PIN_AFFINITY s, carrying what the seal wrote down of Mira's hits on it
 */
export const MIRA_PULSE = .5;
export const MIRA_PIN_AFFINITY = .2;
/** a pin pulse's damage, x the ordinary pulse (0.2x keeper damage) */
export const MIRA_PIN_SHARE = .8;
/** the pinned enemy's seal also writes down this share of Mira's own hits on it; the next pin pulse reads it out */
export const MIRA_PIN_RECORD = .12;
/** at most this x keeper damage written down per pin pulse */
export const MIRA_PIN_RECORD_CAP = 1.5;

const favoured = (p: Player): boolean => p.flags.has('affinity');

export class RefugeCharge extends RefugeOwned {
  /** `relay`: a charge handed on by another blast (favoured weapon); it does not hand on again */
  constructor(w: World, p: Player, x: number, y: number, damage: number, targetId = 0, mine = false, relay = false) {
    super(w, p);
    this.x = x; this.y = y;
    Object.assign(this.mem, { damage, targetId, mine: Number(mine), fired: 0, firedAt: 0, life: mine ? 3.2 : relay ? TOVE_RELAY_FUSE : .68, primed: 0, relay: Number(relay) });
  }
  get radius(): number { return this.mem.mine ? 35 : this.mem.relay ? TOVE_RELAY_RADIUS : 30; }
  /** Tove's release: go off `delay` s from now at double power (once). */
  prime(delay: number): boolean {
    const m = this.mem;
    if (this.dead || m.fired || m.primed > 0) return false;
    m.primed = this.age + delay;
    m.damage *= 2;
    return true;
  }
  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    const m = this.mem;
    if (m.fired) { if (this.age > m.firedAt + .38) this.dead = true; return; }
    const target = w.enemies.find(e => e.id === m.targetId && e.alive && !e.hidden);
    if (target) { this.x = target.x; this.y = target.y; }
    // m.primed: Tove's release set this charge / mine off early, at double power
    const triggered = m.mine && (m.primed > 0 && this.age >= m.primed || this.age >= .2 && nearby(w, this.x, this.y, 17).length > 0);
    if (m.mine && !triggered) { if (this.age >= m.life) this.dead = true; return; }
    if (!m.mine && this.age < (m.primed > 0 ? Math.min(m.life, m.primed) : m.life)) return;
    runProc(w, m.mine ? 'keeper:tove:mine:burst' : 'keeper:tove:charge:burst', () => {
      m.fired = 1; m.firedAt = this.age;
      const caught = nearby(w, this.x, this.y, this.radius);
      for (const enemy of caught) refugeHit(w, this.owner, enemy, m.relay && enemy.id !== m.targetId ? m.damage * TOVE_RELAY_SPLASH : m.damage, this, false, 45);
      w.sfx('explosion', { vol: .3, pitch: m.mine ? 1 : 1.3, x: this.x });
      blastImpact(w, this.owner, this.x, this.y, this.radius, false);
      if (!m.relay && favoured(this.owner)) this.relay(w, caught);
      proc(w, 'passive:tove', true);
      return true;
    });
  }
  /** Favoured weapon: the blast hands a fresh charge to an enemy it caught (a neighbour first, else the same one). */
  private relay(w: World, caught: Enemy[]): void {
    const alive = caught.filter(e => e.alive && !e.hidden && e.vulnerable);
    const next = alive.find(e => e.id !== this.mem.targetId) ?? alive[0];
    if (!next) return;
    // the release's double power stays with the charge it primed
    const damage = this.mem.primed > 0 ? this.mem.damage / 2 : this.mem.damage;
    w.spawn(new RefugeCharge(w, this.owner, next.x, next.y, damage * TOVE_RELAY_SHARE, next.id, false, true));
  }
  protected paint(r: Renderer): void {
    const m = this.mem;
    if (m.fired) { drawBlast(r, this.x, this.y, this.age - m.firedAt, this.radius); return; }
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
    drawCharge(r, this.x, this.y - 12, remaining, this.age, pulse);
  }
  override light(w: World): void {
    const flash = this.mem.fired ? Math.max(0, 1 - (this.age - this.mem.firedAt) / .24) : .15;
    if (flash > 0) w.lights.add(this.x, this.y - (this.mem.mine ? 2 : 12), this.mem.fired ? 42 : 18, '#efb568', { intensity: flash * .45 * refugeVisualOpacity(w, this.owner) });
  }
}

/** Three linked targets (five with a favoured weapon); damage is a shared budget, never multiplied by edge count. */
export class RefugeWeave extends RefugeOwned {
  constructor(w: World, p: Player) {
    super(w, p);
    Object.assign(this.mem, { target0: 0, target1: 0, target2: 0, target3: 0, target4: 0, pool: 0, last: -99, source: 0, flash: -99, knot: -99 });
  }
  links(): number { return favoured(this.owner) ? LUEN_LINKS_AFFINITY : LUEN_LINKS; }
  targets(w: World): Enemy[] {
    const out: Enemy[] = [];
    for (let i = 0, n = this.links(); i < n; i++) {
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
      const next = nearby(w, target.x, target.y, 95).slice(0, this.links());
      for (let i = 0; i < LUEN_LINKS_AFFINITY; i++) m['target' + i] = next[i]?.id ?? 0;
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
      const pool = m.pool, damage = pool / receivers.length;
      m.pool = 0;
      let hit = false;
      for (const target of receivers) hit = refugeHit(w, this.owner, target, damage, this) || hit;
      // favoured weapon: the thread is pulled tight on the struck enemy as well (a double knot)
      const knot = favoured(this.owner) ? members.find(e => e.id === m.source) ?? members[0] : undefined;
      if (knot && refugeHit(w, this.owner, knot, pool * LUEN_KNOT_AFFINITY, this)) {
        hit = true;
        m.knot = w.time;
        threadPulse(w, this.owner, knot.x, knot.y - knot.r - 7);
      }
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
    // the double knot: a second, wider loop cinches around the struck enemy
    const tight = Math.max(0, 1 - (w.time - this.mem.knot) / .32);
    const knotted = tight > 0 ? targets.find(e => e.id === this.mem.source) ?? targets[0] : undefined;
    if (knotted) drawThreadKnot(r, knotted.x, knotted.y - knotted.r - 7, -this.age, 9 - tight * 3, tight);
  }
  override light(w: World): void {
    const lit = Math.max(0, 1 - (w.time - this.mem.flash) / .3);
    if (lit > 0) w.lights.add(this.x, this.y - 9, 24, '#bca1df', { intensity: lit * .25 * refugeVisualOpacity(w, this.owner) });
  }
}

/** A bounded, explicit off-hand skill. No weapon update, item shoot hook or copied projectile. */
export class RefugeSupport extends RefugeOwned {
  /** `delay` > 0: the other hand's follow-up (favoured weapon), aimed again when it starts */
  constructor(w: World, p: Player, family: SupportFamily, target: Enemy, damage: number, delay = 0) {
    super(w, p);
    Object.assign(this.mem, { family, damage, phase: 0, targetId: target.id, wait: delay, echo: Number(delay > 0) });
    this.aim(w, target);
  }
  private aim(w: World, target: Enemy): void {
    const p = this.owner, a = Math.atan2(target.y - p.y, target.x - p.x);
    const length = Math.max(0, rayLength(w, p.x, p.y, a, Math.min(200, Math.hypot(target.x - p.x, target.y - p.y))) - 2);
    Object.assign(this.mem, { ax: p.x, ay: p.y, angle: a, tx: p.x + Math.cos(a) * length, ty: p.y + Math.sin(a) * length });
  }
  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    const m = this.mem;
    if (m.wait > 0) {
      m.wait -= dt;
      if (m.wait > 1e-9) return;
      m.wait = 0;
      // the follow-up starts from where Ves stands now (a fallen target leaves the first aim)
      const target = w.enemies.find(e => e.id === m.targetId && e.alive && !e.hidden && e.vulnerable);
      if (target) this.aim(w, target);
    }
    this.age += dt;
    const times = m.family === 3 ? [.12, .34, .56] : [m.family === 2 ? .24 : .12];
    if (m.phase < times.length && this.age >= times[m.phase]) {
      runProc(w, m.echo ? 'keeper:ves:support:echo' : 'keeper:ves:support:impact', () => {
        const factor = m.family === 3 ? 1 / 3 : 1;
        for (const target of w.enemies) {
          if (!target.alive || target.hidden || !target.vulnerable) continue;
          const inside = m.family === 0 || m.family === 2
            ? Math.hypot(target.x - m.tx, target.y - m.ty) <= (m.family === 0 ? 23 : 34) + target.r && visible(w, m.tx, m.ty, target.x, target.y, target.r)
            : onLane(w, target, m.ax, m.ay, m.tx + Math.cos(m.angle) * 8, m.ty + Math.sin(m.angle) * 8, m.family === 3 ? 10 : 5);
          if (inside && visible(w, m.ax, m.ay, target.x, target.y, target.r)) {
            refugeHit(w, this.owner, target, m.damage * factor * (m.echo && target.id !== m.targetId ? VES_ECHO_SPLASH : 1), this);
          }
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
    if (this.mem.wait > 0) return;
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
    Object.assign(this.mem, { angle: p.aim, parkUntil: -1, flash: -99, sentAt: -99, sx: 0, sy: 0, ex: 0, ey: 0 });
    const length = Math.max(0, rayLength(w, p.x, p.y, p.aim, 18) - 2);
    this.x = p.x + Math.cos(p.aim) * length;
    this.y = p.y + Math.sin(p.aim) * length;
    p.vars.rfOrtCharges ??= ORT_CHARGES;
    p.vars.rfOrtRefill ??= w.time + this.refill();
  }
  /** durability (3 with a favoured weapon) */
  maxCharges(): number { return favoured(this.owner) ? ORT_CHARGES_AFFINITY : ORT_CHARGES; }
  refill(): number { return favoured(this.owner) ? ORT_REFILL_AFFINITY : ORT_REFILL; }
  width(): number { return favoured(this.owner) ? ORT_WIDTH_AFFINITY : ORT_WIDTH; }
  park(w: World): void { this.mem.parkUntil = w.time + 1.1; }
  /** Ort's release raises the tower shield: the small one stands aside meanwhile. */
  towerUp(w: World): boolean {
    const tower = w.entityById(this.owner.vars.rfOrtTower);
    return !!tower && !tower.dead && tower.age < 1.5 && (tower as { owner?: unknown }).owner === this.owner;
  }
  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    const p = this.owner, m = this.mem, max = this.maxCharges();
    // swapping off a favoured weapon drops the third plate
    if (p.vars.rfOrtCharges > max) p.vars.rfOrtCharges = max;
    if ((p.vars.rfOrtCharges ?? 0) < max && w.time >= p.vars.rfOrtRefill) {
      p.vars.rfOrtCharges++;
      p.vars.rfOrtRefill = w.time + this.refill();
    }
    if (p.vars.rfOrtCharges >= max) p.vars.rfOrtRefill = w.time + this.refill();
    if (w.time >= m.parkUntil) {
      m.angle = p.aim;
      const length = Math.max(0, rayLength(w, p.x, p.y, p.aim, 18) - 2);
      this.x = p.x + Math.cos(p.aim) * length;
      this.y = p.y + Math.sin(p.aim) * length;
    }
    if (p.vars.rfOrtCharges <= 0 || this.towerUp(w)) return;
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
      if (Math.abs(tangent) > this.width() + bullet.r || !visible(w, this.x, this.y, bullet.x, bullet.y, bullet.r)) continue;
      if (runProc(w, 'keeper:ort:guard', () => {
        bullet.dead = true;
        p.vars.rfOrtCharges--;
        m.flash = w.time;
        shieldImpact(w, p, bullet.x, bullet.y, m.angle, false);
        if (favoured(p)) this.sendBack(w, bullet.x, bullet.y);
        // a held line builds toward the release
        p.addEmber(4);
        w.sfx('parry', { vol: .3, pitch: .9, x: this.x });
        proc(w, 'passive:ort', true);
        return true;
      })) break;
    }
  }
  /** Favoured weapon: the blocked shot flies back at the nearest enemy ahead of the shield. */
  private sendBack(w: World, x: number, y: number): void {
    const p = this.owner, m = this.mem, nx = Math.cos(m.angle), ny = Math.sin(m.angle);
    let ahead: Enemy | undefined, best = Infinity;
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || !e.vulnerable) continue;
      const ex = e.x - this.x, ey = e.y - this.y, d = Math.hypot(ex, ey) || 1;
      if (d > 240 || (ex * nx + ey * ny) / d <= .2 || !visible(w, this.x, this.y, e.x, e.y, e.r)) continue;
      if (d < best || d === best && ahead && e.id < ahead.id) { best = d; ahead = e; }
    }
    if (!ahead || !refugeHit(w, p, ahead, p.stats.damage * ORT_REFLECT_AFFINITY, this, false, 20)) return;
    Object.assign(m, { sentAt: w.time, sx: x, sy: y, ex: ahead.x, ey: ahead.y - 4 });
    shieldImpact(w, p, ahead.x, ahead.y - 4, Math.atan2(ahead.y - y, ahead.x - x), false);
  }
  protected paint(r: Renderer, w: World): void {
    // the shot sent back: a bright streak from the shield face to the enemy it struck
    const sent = Math.max(0, 1 - (w.time - this.mem.sentAt) / .16);
    if (sent > 0) {
      const m = this.mem, k = Math.min(1, (1 - sent) * 2.4), x = m.sx + (m.ex - m.sx) * k, y = m.sy + (m.ey - m.sy) * k;
      r.pixelLine(m.sx, m.sy, x, y, '#263a35', 3, sent * .7);
      r.pixelLine(m.sx, m.sy, x, y, '#c9ecbd', 1, sent);
      r.rect(x - 1, y - 1, 3, 3, '#fff4cf', sent);
    }
    if (this.towerUp(w) && this.mem.parkUntil <= w.time) return;
    const lit = Math.max(0, 1 - (w.time - this.mem.flash) / .24), parked = this.mem.parkUntil > w.time;
    const nx = Math.cos(this.mem.angle), ny = Math.sin(this.mem.angle), sx = -ny, sy = nx;
    if (parked) for (const side of [-1, 1]) {
      const x = this.x + sx * side * 12, y = this.y + sy * side * 12 + 2;
      r.pixelLine(x - nx * 4, y - ny * 4, x + nx * 3, y + ny * 3, '#263a35', 4, .8);
      r.pixelLine(x - nx * 3, y - ny * 3 - 1, x + nx * 2, y + ny * 2 - 1, '#c3d6ae', 1, .7);
    }
    drawShield(r, this.x - nx * lit * 2, this.y - ny * lit * 2, this.mem.angle, this.width(), this.owner.vars.rfOrtCharges, .75 + lit * .25, this.maxCharges());
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

/** Mira's page seal. `anchor`: the enemy it was opened on (pinned with a favoured weapon); 0 = none (dash). */
export class RefugeSeal extends RefugeOwned {
  constructor(w: World, p: Player, x: number, y: number, anchor = 0) {
    super(w, p);
    this.x = x; this.y = y;
    Object.assign(this.mem, { until: w.time + 2.8, damage: p.stats.damage, radius: 42, pulse: -99, anchor, pin: -99, written: 0 });
    this.layer = 0;
  }
  place(w: World, x: number, y: number, anchor = 0): void {
    this.x = x; this.y = y;
    this.mem.until = w.time + 2.8;
    this.mem.damage = this.owner.stats.damage;
    if (anchor !== this.mem.anchor) this.mem.written = 0;
    this.mem.anchor = anchor;
    this.age = 0;
  }
  /** Favoured weapon: Mira's own hit on the pinned enemy is written into the seal (read out by the next pin pulse). */
  write(w: World, target: Enemy, amount: number): void {
    if (amount <= 0 || this.pinned(w) !== target) return;
    this.mem.written = Math.min(this.mem.damage * MIRA_PIN_RECORD_CAP, this.mem.written + amount * MIRA_PIN_RECORD);
  }
  /** Favoured weapon: the enemy the seal was opened on, while it stays inside. */
  pinned(w: World): Enemy | undefined {
    if (!this.mem.anchor || !favoured(this.owner)) return undefined;
    const e = w.enemies.find(t => t.id === this.mem.anchor);
    return e && e.alive && !e.hidden && e.vulnerable && this.contains(w, e.x, e.y, e.r) ? e : undefined;
  }
  contains(w: World, x: number, y: number, radius = 0): boolean {
    return Math.hypot(x - this.x, y - this.y) <= this.mem.radius + radius && visible(w, this.x, this.y, x, y, radius);
  }
  override update(w: World, dt: number): void {
    if (!this.valid(w)) return;
    this.age += dt;
    if (w.time >= this.mem.until) { this.dead = true; return; }
    slowSealBullets(w, (x, y, r) => this.contains(w, x, y, r), .7);
    const pinned = this.pinned(w);
    runProc(w, 'keeper:mira:seal:pulse', () => {
      // a pinned enemy has its own, faster pulse below
      const targets = nearby(w, this.x, this.y, this.mem.radius).filter(e => e !== pinned);
      if (!targets.length) return false;
      for (const target of targets) { slowSealEnemy(w, target); refugeHit(w, this.owner, target, this.mem.damage * .2, this); }
      this.mem.pulse = w.time;
      pageImpact(w, this.owner, this.x, this.y - 2, false);
      return true;
    }, MIRA_PULSE);
    if (pinned) runProc(w, 'keeper:mira:seal:pin', () => {
      slowSealEnemy(w, pinned);
      if (!refugeHit(w, this.owner, pinned, this.mem.damage * .2 * MIRA_PIN_SHARE + this.mem.written, this)) return false;
      this.mem.written = 0;
      this.mem.pin = w.time;
      return true;
    }, MIRA_PIN_AFFINITY);
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
    // the pinned enemy: four page corners close around it, flashing with each pin pulse
    const pinned = this.pinned(w);
    if (pinned) {
      const lit = Math.max(0, 1 - (w.time - this.mem.pin) / .18), d = pinned.r + 5 - lit * 2;
      const cx = pinned.x, cy = pinned.y - pinned.r * .6;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4 + this.age * .8, nx = Math.cos(a), ny = Math.sin(a);
        const x = cx + nx * d, y = cy + ny * d * .8;
        r.pixelLine(x - ny * 3, y + nx * 3, x, y, '#3c415b', 3, fade * .7);
        r.pixelLine(x - ny * 3, y + nx * 3, x, y, lit > 0 ? '#f0e5cd' : '#b3c9ee', 1, fade * (.75 + lit * .25));
        r.pixelLine(x, y, x + ny * 3, y - nx * 3, '#d5e1f3', 1, fade * (.55 + lit * .45));
      }
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
