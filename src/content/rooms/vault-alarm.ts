import { RNG, fx } from '../../engine/rng';
import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';

// 경보 금고 alarm: every 2.4 s cycle the wall emitters pick a new laser
// pattern from the room's alarm seed (a pure function of seed + clock, so
// lockstep peers, tests and drawing all agree without extra state). Lanes
// may cross the vault itself, so defenders have to read each warning and
// move; every pattern still leaves open floor to stand on. The alarm does not
// tell friend from foe: intruders caught in a beam are burned too.

export const ALARM_CYCLE = 2.4;
/** warning starts (quiet before) */
export const ALARM_WARN = 0.8;
/** beams fire (the last 0.6 s of the cycle) */
export const ALARM_FIRE = 1.8;
/** half thickness of a beam's damaging core (px), on top of the target's own radius share */
export const ALARM_HALF = 3;

export type AlarmPattern = 'grid' | 'cross' | 'pincer' | 'rotor';
export interface AlarmBeam { x0: number; y0: number; x1: number; y1: number }
/** interior rectangle the beams span, and the vault position */
export interface AlarmBox { x0: number; y0: number; x1: number; y1: number; vx: number; vy: number }
export interface VaultAlarm {
  cycle: number;
  /** 1..3, rises at 20 s and 40 s */
  stage: number;
  pattern: AlarmPattern;
  warning: boolean;
  active: boolean;
  /** 0..1 through the active window (moving patterns sweep with it) */
  k: number;
  /** where the beams are now (warning: where they start) */
  beams: AlarmBeam[];
  /** end positions of moving patterns (empty for still ones) */
  ends: AlarmBeam[];
}

export const alarmStage = (clock: number): number => (clock < 20 ? 1 : clock < 40 ? 2 : 3);

const PATTERNS: Record<number, [AlarmPattern, number][]> = {
  1: [['grid', 0.65], ['cross', 0.35]],
  2: [['grid', 0.4], ['cross', 0.25], ['pincer', 0.35]],
  3: [['grid', 0.3], ['cross', 0.25], ['pincer', 0.25], ['rotor', 0.2]],
};

// Pattern sequences per alarm seed, built cycle by cycle (a pure function of the
// seed, memoised so per-frame queries stay cheap; a handful of seeds at most).
const sequences = new Map<number, AlarmPattern[]>();

/** The pattern of one cycle: weighted by stage, never the previous cycle's pattern. */
export function alarmPattern(seed: number, cycle: number, _stage = alarmStage(cycle * ALARM_CYCLE)): AlarmPattern {
  let seq = sequences.get(seed);
  if (!seq) {
    if (sequences.size > 8) sequences.clear();
    seq = [];
    sequences.set(seed, seq);
  }
  while (seq.length <= cycle) {
    const c = seq.length;
    const prev = c > 0 ? seq[c - 1] : null;
    const options = PATTERNS[alarmStage(c * ALARM_CYCLE)].filter((x) => x[0] !== prev);
    seq.push(new RNG(`vault-pattern:${seed}:${c}`).weighted(options, (x) => x[1])![0]);
  }
  return seq[cycle];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

/** Clip the infinite line through (x, y) at `angle` to the box. */
function lineThrough(b: AlarmBox, x: number, y: number, angle: number): AlarmBeam {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let t0 = -1e9;
  let t1 = 1e9;
  const clip = (p: number, d: number, lo: number, hi: number) => {
    if (Math.abs(d) < 1e-9) return;
    const a = (lo - p) / d;
    const c = (hi - p) / d;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  };
  clip(x, dx, b.x0, b.x1);
  clip(y, dy, b.y0, b.y1);
  return { x0: x + dx * t0, y0: y + dy * t0, x1: x + dx * t1, y1: y + dy * t1 };
}
const vLane = (b: AlarmBox, x: number): AlarmBeam => ({ x0: x, y0: b.y0, x1: x, y1: b.y1 });
const hLane = (b: AlarmBox, y: number): AlarmBeam => ({ x0: b.x0, y0: y, x1: b.x1, y1: y });

/** Lane offsets on one axis: random slots at least `gap` apart, kept off the walls. */
function lanes(r: RNG, lo: number, hi: number, n: number, gap: number, near?: number): number[] {
  const out: number[] = [];
  for (let tries = 0; out.length < n && tries < 40; tries++) {
    const v = near !== undefined && out.length === 0 ? near + r.range(-14, 14) : r.range(lo + 14, hi - 14);
    const at = Math.round(Math.max(lo + 10, Math.min(hi - 10, v)));
    if (out.every((o) => Math.abs(o - at) >= gap)) out.push(at);
  }
  return out;
}

/** The alarm at `clock` seconds into the defence. */
export function vaultAlarm(seed: number, clock: number, b: AlarmBox): VaultAlarm {
  const cycle = Math.floor(clock / ALARM_CYCLE);
  const phase = clock - cycle * ALARM_CYCLE;
  const stage = alarmStage(cycle * ALARM_CYCLE);
  const pattern = alarmPattern(seed, cycle);
  const r = new RNG(`vault-lanes:${seed}:${cycle}`);
  const k = Math.max(0, Math.min(1, (phase - ALARM_FIRE) / (ALARM_CYCLE - ALARM_FIRE)));
  const warning = phase >= ALARM_WARN;
  const active = phase >= ALARM_FIRE;
  const beams: AlarmBeam[] = [];
  const ends: AlarmBeam[] = [];
  if (pattern === 'grid') {
    // 2/3/4 straight lanes; from stage 2 one of them runs past the vault
    const n = stage + 1;
    const nx = Math.max(1, Math.round(n / 2 + (r.chance(0.5) ? 0.4 : -0.4)));
    const ny = Math.max(1, n - nx);
    const pressX = stage >= 2 && r.chance(0.5);
    for (const x of lanes(r, b.x0, b.x1, Math.min(n - 1, nx), 34, stage >= 2 && pressX ? b.vx : undefined)) beams.push(vLane(b, x));
    for (const y of lanes(r, b.y0, b.y1, Math.min(n - 1, ny), 30, stage >= 2 && !pressX ? b.vy : undefined)) beams.push(hLane(b, y));
  } else if (pattern === 'cross') {
    // a cross (stage 3: a star) centred on a random point, sometimes the vault
    const onVault = stage >= 2 && r.chance(0.4);
    const x = onVault ? b.vx + r.range(-10, 10) : r.range(b.x0 + 40, b.x1 - 40);
    const y = onVault ? b.vy + r.range(-8, 8) : r.range(b.y0 + 30, b.y1 - 30);
    beams.push(vLane(b, Math.round(x)), hLane(b, Math.round(y)));
    if (stage >= 3) beams.push(lineThrough(b, x, y, Math.PI / 4), lineThrough(b, x, y, -Math.PI / 4));
  } else if (pattern === 'pincer') {
    // two lanes close in from the walls and stop around a gap: stand in it
    const vertical = r.chance(0.5);
    const lo = vertical ? b.x0 : b.y0;
    const hi = vertical ? b.x1 : b.y1;
    const gap = vertical ? 22 : 18;
    const c = r.range(lo + 26 + gap, hi - 26 - gap);
    const from = [lo + 6, hi - 6];
    const to = [c - gap, c + gap];
    for (let i = 0; i < 2; i++) {
      const at = Math.round(lerp(from[i], to[i], easeInOut(k)));
      beams.push(vertical ? vLane(b, at) : hLane(b, at));
      ends.push(vertical ? vLane(b, Math.round(to[i])) : hLane(b, Math.round(to[i])));
    }
  } else {
    // rotor: two crossed beams through the vault turn an eighth of a circle
    const a0 = r.int(0, 7) * (Math.PI / 8);
    const turn = r.sign() * (Math.PI / 4);
    const a = a0 + turn * easeInOut(k);
    beams.push(lineThrough(b, b.vx, b.vy, a), lineThrough(b, b.vx, b.vy, a + Math.PI / 2));
    ends.push(lineThrough(b, b.vx, b.vy, a0 + turn), lineThrough(b, b.vx, b.vy, a0 + turn + Math.PI / 2));
  }
  return { cycle, stage, pattern, warning, active, k, beams, ends };
}

/** Distance from (x, y) to a beam segment. */
export function beamDistance(l: AlarmBeam, x: number, y: number): number {
  const dx = l.x1 - l.x0;
  const dy = l.y1 - l.y0;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - l.x0) * dx + (y - l.y0) * dy) / len2));
  return Math.hypot(x - (l.x0 + dx * t), y - (l.y0 + dy * t));
}

/** Does a body of radius `r` at (x, y) touch a beam? */
export function inBeam(a: VaultAlarm, x: number, y: number, r: number): boolean {
  return a.beams.some((l) => beamDistance(l, x, y) < ALARM_HALF + r * 0.8);
}

/** Root state the drawing reads (the RoomDevice's hashed mem). */
export interface AlarmSource { mem: { alarmSeed: number; clock: number; phase: number; used: boolean }; dead: boolean }

/** Draws the alarm above everything (after lighting, so the lasers glow). Purely visual. */
export class VaultAlarmFx extends Entity {
  static override readonly cosmetic = true;
  constructor(readonly source: AlarmSource, readonly box: AlarmBox) {
    super();
    this.layer = 3;
    this.tileCollide = false;
  }
  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.source.dead) this.dead = true;
    const s = this.source.mem;
    if (s.phase !== 1 || s.used) return;
    // sparks where live beams meet the walls
    const a = vaultAlarm(s.alarmSeed, s.clock, this.box);
    if (!a.active || !fx.chance(0.6)) return;
    const l = fx.pick(a.beams);
    const end = fx.chance(0.5);
    w.particles.burst(end ? l.x1 : l.x0, end ? l.y1 : l.y0, { count: 2, speed: [30, 90], life: [0.1, 0.25], colors: ['#ffffff', '#ffd6dc', '#ff7088'], size: [1, 1], shape: 'spark', additive: true });
  }
  override draw(r: Renderer, w: World): void {
    const s = this.source.mem;
    if (s.phase !== 1 || s.used) return;
    const a = vaultAlarm(s.alarmSeed, s.clock, this.box);
    if (!a.warning) {
      // idle emitters: faint dots along the walls
      return;
    }
    const phase = s.clock - a.cycle * ALARM_CYCLE;
    if (!a.active) {
      // warning: thin lines that blink faster as the beam locks in, plus the end positions of moving patterns
      const lock = phase > ALARM_FIRE - 0.3;
      const blink = lock ? (Math.floor(w.time * 16) % 2 ? 1 : 0.35) : 0.55 + 0.25 * Math.sin(w.time * 12);
      const grow = Math.min(1, (phase - ALARM_WARN) / 0.25);
      for (const l of a.beams) {
        // the band the beam will burn (as wide as its hit area), then the aiming line
        r.line(l.x0, l.y0, l.x1, l.y1, '#ff4a66', 12, (lock ? 0.2 : 0.1) * grow);
        r.pixelLine(l.x0, l.y0, l.x1, l.y1, lock ? '#ffd0d8' : '#ff5a74', 1, blink);
        this.emitter(r, l, lock ? '#ffffff' : '#ff8aa0', 0.9);
      }
      for (const l of a.ends) this.dashed(r, l, '#ffb4c2', 0.55);
      return;
    }
    // active: hot core, red body, soft glow, white emitters
    const fade = 1 - Math.max(0, a.k - 0.85) / 0.15;
    for (const l of a.beams) {
      r.line(l.x0, l.y0, l.x1, l.y1, '#ff3a5a', 10, 0.18 * fade);
      r.pixelLine(l.x0, l.y0, l.x1, l.y1, '#ff6a84', 4, 0.85 * fade);
      r.pixelLine(l.x0, l.y0, l.x1, l.y1, '#fff6e8', 2, fade);
      this.emitter(r, l, '#ffffff', fade);
    }
  }
  private emitter(r: Renderer, l: AlarmBeam, color: string, alpha: number): void {
    for (const [x, y] of [[l.x0, l.y0], [l.x1, l.y1]]) {
      r.rect(Math.round(x) - 3, Math.round(y) - 3, 6, 6, '#2a1c30', alpha);
      r.rect(Math.round(x) - 2, Math.round(y) - 2, 4, 4, color, alpha);
    }
  }
  private dashed(r: Renderer, l: AlarmBeam, color: string, alpha: number): void {
    const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
    const n = Math.max(1, Math.floor(len / 8));
    for (let i = 0; i < n; i += 2) {
      const t0 = i / n;
      const t1 = Math.min(1, (i + 1) / n);
      r.pixelLine(l.x0 + (l.x1 - l.x0) * t0, l.y0 + (l.y1 - l.y0) * t0, l.x0 + (l.x1 - l.x0) * t1, l.y0 + (l.y1 - l.y0) * t1, color, 1, alpha);
    }
  }
}
