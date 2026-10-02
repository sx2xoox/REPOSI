// Pure (DOM-free) logic for the on-screen touch controls: floating joystick
// math, the button layout for a given viewport / safe area / HUD geometry, a
// small pointer router that assigns every touch pointer to a stick, a button,
// the attack button or nothing, and the auto-aim target picker. Unit-tested in
// tests/touch.test.ts; ui/touch.ts binds it to the DOM, feeds engine/input and
// draws it.
//
// Two schemes (설정 > 터치 조작 방식):
//   'auto' (default): left floating stick = move, big ATTACK button bottom-right
//          (hold = attack, auto-aims at the best target; drag past a dead zone =
//          manual aim in the drag direction), action buttons in an arc around it.
//   'twin': left floating stick = move, right floating stick = aim + auto-fire.
//
// All coordinates here are CSS pixels of the viewport.

export interface Vec {
  x: number;
  y: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  l: number;
  r: number;
  t: number;
  b: number;
}

export type TouchButtonId = 'dash' | 'bomb' | 'active' | 'consumable' | 'special' | 'pause' | 'map' | 'inventory';

export type TouchScheme = 'auto' | 'twin';
export const TOUCH_SCHEMES: TouchScheme[] = ['auto', 'twin'];
export const TOUCH_SCHEME_LABEL: Record<TouchScheme, string> = { auto: '자동 조준', twin: '듀얼 스틱' };

export function touchScheme(v: string | undefined): TouchScheme {
  return v === 'twin' ? 'twin' : 'auto';
}

export const GAME_BUTTONS: TouchButtonId[] = ['dash', 'bomb', 'special', 'active', 'consumable'];
export const SYSTEM_BUTTONS: TouchButtonId[] = ['pause', 'map', 'inventory'];

// ---------------------------------------------------------------- joystick math
/** Fraction of the stick radius that is ignored around the center. */
export const MOVE_DEAD_ZONE = 0.16;
/** Deflection (fraction of radius) at which the move output reaches 1. */
export const MOVE_FULL_AT = 0.82;
/** Deflection needed before the aim stick starts firing. */
export const AIM_ENGAGE = 0.28;
/** Attack button: drag (fraction of its radius) that switches to manual aim ... */
export const MANUAL_ENGAGE = 0.5;
/** ... and the distance back toward the touch point that returns to auto-aim. */
export const MANUAL_RELEASE = 0.28;

/**
 * Analog stick output for a finger offset (dx, dy) from the stick base.
 * Inside the dead zone the output is zero; it then ramps linearly so that
 * `fullAt` deflection already gives full magnitude (easy to reach top speed).
 */
export function stickVector(dx: number, dy: number, radius: number, dead = MOVE_DEAD_ZONE, fullAt = MOVE_FULL_AT): Vec & { mag: number } {
  const d = Math.hypot(dx, dy);
  if (radius <= 0 || d <= dead * radius || d === 0) return { x: 0, y: 0, mag: 0 };
  const span = Math.max(1e-6, (fullAt - dead) * radius);
  const mag = Math.min(1, (d - dead * radius) / span);
  return { x: (dx / d) * mag, y: (dy / d) * mag, mag };
}

/**
 * Floating stick "follow": when the finger travels further than `maxDist`
 * from the base, drag the base along so it stays exactly `maxDist` away.
 * Returns the (possibly moved) base.
 */
export function followBase(base: Vec, finger: Vec, maxDist: number): Vec {
  const dx = finger.x - base.x;
  const dy = finger.y - base.y;
  const d = Math.hypot(dx, dy);
  if (d <= maxDist || d === 0) return { x: base.x, y: base.y };
  const k = (d - maxDist) / d;
  return { x: base.x + dx * k, y: base.y + dy * k };
}

/** Knob position drawn for a finger: clamped to the base radius. */
export function knobPosition(base: Vec, finger: Vec, radius: number): Vec {
  const dx = finger.x - base.x;
  const dy = finger.y - base.y;
  const d = Math.hypot(dx, dy);
  if (d <= radius || d === 0) return { x: finger.x, y: finger.y };
  return { x: base.x + (dx / d) * radius, y: base.y + (dy / d) * radius };
}

// ---------------------------------------------------------------- layout
export interface TouchLayout {
  scheme: TouchScheme;
  /** size unit (1 ≈ a 380px tall phone in landscape) */
  u: number;
  stickR: number;
  knobR: number;
  leftRest: Vec;
  /** twin: resting aim stick; auto: the attack button center */
  rightRest: Vec;
  /** the big attack button ('auto' scheme), else null */
  attack: Circle | null;
  /** x (CSS px) dividing the left (move) and right (aim) stick zones */
  splitX: number;
  buttons: Record<TouchButtonId, Circle>;
  /** generic back / close button for menu screens (top-right) */
  back: Circle;
  /** same, top-left corner */
  backLeft: Circle;
}

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Where the HUD draws things the touch buttons must stay clear of (CSS px). */
export interface HudGeometry {
  /** the world image rect */
  game: Rect;
  /** minimap block (map + floor name + seed lines), top-right */
  minimap: Rect;
}

/** Button layout for a landscape viewport (CSS px), honoring the safe-area insets. */
export function computeTouchLayout(view: { w: number; h: number }, safe: Insets, hud: HudGeometry, scheme: TouchScheme = 'auto'): TouchLayout {
  const short = Math.min(view.w, view.h);
  const u = clampN(short / 380, 0.8, 1.3);
  const stickR = 44 * u;
  const knobR = 19 * u;
  const l = safe.l;
  const r = safe.r;
  const t = safe.t;
  const b = safe.b;
  // >= 44 pt touch targets (radius 22) for every gameplay button
  const rad = (k: number) => Math.max(22, k * u);
  const restY = view.h - b - 22 * u - stickR;
  const leftRest = { x: l + 26 * u + stickR, y: restY };
  let rightRest: Vec;
  let attack: Circle | null = null;
  const buttons = {} as Record<TouchButtonId, Circle>;
  const place = (cx: number, cy: number, id: TouchButtonId, deg: number, dist: number, rr: number) => {
    const a = (deg * Math.PI) / 180;
    buttons[id] = { x: cx + Math.cos(a) * dist, y: cy - Math.sin(a) * dist, r: rr };
  };
  if (scheme === 'auto') {
    const AR = Math.max(34, 38 * u);
    const cx = view.w - r - 20 * u - AR;
    const cy = view.h - b - 16 * u - AR;
    attack = { x: cx, y: cy, r: AR };
    rightRest = { x: cx, y: cy };
    const gap = 10 * u;
    // inner arc (thumb reach): dash left, bomb upper-left, release above
    const rDash = rad(27);
    const rBomb = rad(23);
    const rSpec = rad(25);
    place(cx, cy, 'dash', 182, AR + gap + rDash, rDash);
    place(cx, cy, 'bomb', 135, AR + gap + rBomb, rBomb);
    place(cx, cy, 'special', 88, AR + gap + rSpec, rSpec);
    // outer arc: active item + potion (only shown while held)
    const rItem = rad(23);
    const outer = AR + gap + 2 * rDash + 8 * u + rItem * 0.3;
    place(cx, cy, 'active', 112, outer, rItem);
    place(cx, cy, 'consumable', 157, outer, rItem);
  } else {
    rightRest = { x: view.w - r - 26 * u - stickR, y: restY };
    const cx = rightRest.x;
    const cy = rightRest.y;
    const D = stickR + 42 * u;
    const D2 = D + 50 * u;
    place(cx, cy, 'dash', 180, D, rad(27));
    place(cx, cy, 'bomb', 136, D, rad(22));
    place(cx, cy, 'special', 96, D, rad(24));
    place(cx, cy, 'active', 120, D2, rad(22));
    place(cx, cy, 'consumable', 80, D2, rad(22));
  }

  // system buttons: a column in the right pillarbox bar when it is wide enough,
  // otherwise a row just left of the HUD minimap
  const sr = 17 * u;
  const game = hud.game;
  const barW = view.w - r - (game.x + game.w);
  if (barW >= 2 * sr + 10 * u) {
    const x = view.w - r - Math.max(sr + 6 * u, barW / 2);
    SYSTEM_BUTTONS.forEach((id, i) => {
      buttons[id] = { x, y: t + 8 * u + sr + i * (2 * sr + 10 * u), r: sr };
    });
  } else {
    const right = Math.min(hud.minimap.x - 8 * u, view.w - r - 8 * u);
    const top = Math.max(t + 4 * u, hud.minimap.y);
    SYSTEM_BUTTONS.forEach((id, i) => {
      buttons[id] = { x: right - sr - i * (2 * sr + 10 * u), y: top + sr, r: sr };
    });
  }
  const back = { x: view.w - r - 10 * u - 18 * u, y: t + 10 * u + 18 * u, r: 18 * u };
  const backLeft = { x: l + 10 * u + 18 * u, y: back.y, r: back.r };
  return { scheme, u, stickR, knobR, leftRest, rightRest, attack, splitX: view.w * 0.5, buttons, back, backLeft };
}

/** Distance-based hit test with a generous margin (fingers are fat). */
export function hitCircle(c: Circle, x: number, y: number, margin = 1.25): boolean {
  return Math.hypot(x - c.x, y - c.y) <= c.r * margin;
}

/**
 * Closest enabled button under (x, y), or null; with `attack` the attack button
 * competes too (returned as 'attack'). Closeness is relative to each radius.
 */
export function hitButton(layout: TouchLayout, x: number, y: number, enabled: (id: TouchButtonId) => boolean, margin = 1.25): TouchButtonId | null {
  const h = hitControl(layout, x, y, enabled, margin);
  return h === 'attack' ? null : h;
}

export function hitControl(layout: TouchLayout, x: number, y: number, enabled: (id: TouchButtonId) => boolean, margin = 1.25): TouchButtonId | 'attack' | null {
  let best: TouchButtonId | 'attack' | null = null;
  let bestK = Infinity;
  for (const id of Object.keys(layout.buttons) as TouchButtonId[]) {
    if (!enabled(id)) continue;
    const c = layout.buttons[id];
    const k = Math.hypot(x - c.x, y - c.y) / c.r;
    if (k <= margin && k < bestK) {
      best = id;
      bestK = k;
    }
  }
  const a = layout.attack;
  if (a) {
    const k = Math.hypot(x - a.x, y - a.y) / a.r;
    if (k <= 1.3 && k < bestK) best = 'attack';
  }
  return best;
}

// ---------------------------------------------------------------- gameplay pointer router
export interface StickState {
  pointerId: number;
  base: Vec;
  finger: Vec;
  /** output (move: analog, aim: unit direction) */
  out: Vec;
  /** aim stick passed the engage threshold during this hold */
  engaged: boolean;
}

/** The held attack button ('auto' scheme). */
export interface AttackState {
  pointerId: number;
  /** where the finger landed (follows the finger past `followR`) */
  base: Vec;
  finger: Vec;
  /** dragged past the dead zone: aim in the drag direction instead of auto-aim */
  manual: boolean;
  /** last manual aim direction (unit) */
  dir: Vec;
  /** the touch started on the attack button itself (vs. anywhere on the right half) */
  onButton: boolean;
}

export type Owner =
  | { kind: 'stick'; side: 'left' | 'right' }
  | { kind: 'attack' }
  | { kind: 'button'; id: TouchButtonId }
  | { kind: 'ignored' };

/**
 * Assigns gameplay touch pointers: buttons first, then the floating stick of
 * the screen half the touch landed in. One pointer per stick; extra fingers in
 * an occupied half are ignored until lifted.
 */
export class TouchRouter {
  layout: TouchLayout;
  left: StickState | null = null;
  right: StickState | null = null;
  attack: AttackState | null = null;
  readonly owners = new Map<number, Owner>();
  /** last aim direction (kept while the finger rests in the dead zone) */
  private lastAim: Vec = { x: 1, y: 0 };

  constructor(layout: TouchLayout) {
    this.layout = layout;
  }

  down(id: number, x: number, y: number, enabled: (b: TouchButtonId) => boolean = () => true): Owner {
    const L = this.layout;
    const hit = hitControl(L, x, y, enabled);
    let owner: Owner;
    if (hit && hit !== 'attack') owner = { kind: 'button', id: hit };
    else if (L.scheme === 'auto' && (hit === 'attack' || x >= L.splitX)) {
      // the attack button, or anywhere else on the right half (forgiving: floating attack)
      if (this.attack) owner = { kind: 'ignored' };
      else {
        this.attack = { pointerId: id, base: { x, y }, finger: { x, y }, manual: false, dir: { x: 1, y: 0 }, onButton: hit === 'attack' };
        owner = { kind: 'attack' };
      }
    } else {
      const side: 'left' | 'right' = x < this.layout.splitX ? 'left' : 'right';
      if (this[side]) owner = { kind: 'ignored' };
      else {
        this[side] = { pointerId: id, base: { x, y }, finger: { x, y }, out: { x: 0, y: 0 }, engaged: false };
        owner = { kind: 'stick', side };
      }
    }
    this.owners.set(id, owner);
    return owner;
  }

  move(id: number, x: number, y: number): void {
    const o = this.owners.get(id);
    if (o?.kind === 'attack' && this.attack) {
      const at = this.attack;
      const AR = this.layout.attack?.r ?? this.layout.stickR;
      at.finger = { x, y };
      at.base = followBase(at.base, at.finger, AR * 1.2);
      const dx = x - at.base.x;
      const dy = y - at.base.y;
      const d = Math.hypot(dx, dy);
      if (d >= MANUAL_ENGAGE * AR) at.manual = true;
      else if (d <= MANUAL_RELEASE * AR) at.manual = false;
      if (at.manual && d > 1e-6) at.dir = { x: dx / d, y: dy / d };
      return;
    }
    if (!o || o.kind !== 'stick') return;
    const st = this[o.side];
    if (!st) return;
    const R = this.layout.stickR;
    st.finger = { x, y };
    st.base = followBase(st.base, st.finger, R);
    const dx = x - st.base.x;
    const dy = y - st.base.y;
    if (o.side === 'left') {
      const v = stickVector(dx, dy, R);
      st.out = { x: v.x, y: v.y };
    } else {
      const d = Math.hypot(dx, dy);
      if (d >= AIM_ENGAGE * R) {
        st.engaged = true;
        this.lastAim = { x: dx / d, y: dy / d };
      }
      st.out = st.engaged ? { ...this.lastAim } : { x: 0, y: 0 };
    }
  }

  /** Returns the owner the pointer had (so the caller can release buttons). */
  up(id: number): Owner | undefined {
    const o = this.owners.get(id);
    this.owners.delete(id);
    if (o?.kind === 'stick') this[o.side] = null;
    if (o?.kind === 'attack') this.attack = null;
    return o;
  }

  /** Forget every pointer (mode switch / overlay opened). Fingers still down become ignored. */
  reset(): void {
    for (const id of this.owners.keys()) this.owners.set(id, { kind: 'ignored' });
    this.left = null;
    this.right = null;
    this.attack = null;
  }

  moveVector(): Vec {
    return this.left ? { ...this.left.out } : { x: 0, y: 0 };
  }

  /** Aim direction while the aim stick is held and engaged, else null. */
  aimVector(): Vec | null {
    return this.right && this.right.engaged ? { ...this.right.out } : null;
  }

  /** Attack button held ('auto' scheme). */
  attackHeld(): boolean {
    return !!this.attack;
  }

  /** Manual aim direction while the attack button is dragged past its dead zone, else null. */
  manualAim(): Vec | null {
    return this.attack && this.attack.manual ? { ...this.attack.dir } : null;
  }

  /** Buttons currently held by some pointer. */
  heldButtons(): Set<TouchButtonId> {
    const s = new Set<TouchButtonId>();
    for (const o of this.owners.values()) if (o.kind === 'button') s.add(o.id);
    return s;
  }
}

// ---------------------------------------------------------------- auto-aim targeting
export interface TargetCandidate {
  id: number;
  x: number;
  y: number;
  /** clear line of sight from the shooter */
  visible: boolean;
  /** extra cost multiplier (e.g. charmed enemies), default 1 */
  weight?: number;
}

export interface TargetParams {
  /** candidates further away are ignored (the current target gets `keepRange` x this) */
  maxDist: number;
  keepRange: number;
  /** extra cost for targets away from the facing direction (0 = pure nearest) */
  facingWeight: number;
  /** cost multiplier for targets behind walls / rocks */
  losPenalty: number;
  /** cost multiplier for the current target (hysteresis: < 1 keeps it unless another is clearly better) */
  stickiness: number;
}

export const TARGET_DEFAULTS: TargetParams = { maxDist: 340, keepRange: 1.15, facingWeight: 0.6, losPenalty: 2.2, stickiness: 0.72 };

/** Cost of a candidate (lower is better), or Infinity when out of range. */
export function targetCost(origin: Vec, facing: Vec | null, c: TargetCandidate, prevId: number | null, o: TargetParams = TARGET_DEFAULTS): number {
  const dx = c.x - origin.x;
  const dy = c.y - origin.y;
  const d = Math.hypot(dx, dy);
  const sticky = c.id === prevId;
  if (d > o.maxDist * (sticky ? o.keepRange : 1)) return Infinity;
  let cost = Math.max(d, 1);
  const fl = facing ? Math.hypot(facing.x, facing.y) : 0;
  if (facing && fl > 1e-6 && d > 1e-6) {
    const cos = (dx * facing.x + dy * facing.y) / (d * fl);
    cost *= 1 + o.facingWeight * (1 - cos) * 0.5;
  }
  if (!c.visible) cost *= o.losPenalty;
  if (c.weight !== undefined) cost *= c.weight;
  if (sticky) cost *= o.stickiness;
  return cost;
}

/**
 * Best auto-aim target: the nearest enemy with line of sight, preferring ones
 * roughly in the facing / move direction, sticking to the previous target
 * unless another is clearly better (no flicker). Null when nothing is in range.
 */
export function pickTarget(origin: Vec, facing: Vec | null, cands: readonly TargetCandidate[], prevId: number | null, o: TargetParams = TARGET_DEFAULTS): TargetCandidate | null {
  let best: TargetCandidate | null = null;
  let bestCost = Infinity;
  for (const c of cands) {
    const cost = targetCost(origin, facing, c, prevId, o);
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------- menu taps / drags
/** Drag distance (CSS px) after which a touch counts as a drag, not a tap. */
export const TAP_SLOP = 12;
/** Vertical drag (CSS px) per scroll step in lists. */
export const SCROLL_STEP = 26;

/**
 * Menu-mode gesture tracker for one pointer: short touches are taps (click on
 * release), vertical drags become wheel steps (finger up = scroll down).
 */
export class TapTracker {
  readonly startX: number;
  readonly startY: number;
  dragged = false;
  private accY = 0;
  private lastY: number;

  constructor(x: number, y: number) {
    this.startX = x;
    this.startY = y;
    this.lastY = y;
  }

  /** Returns wheel steps produced by this move (+ = scroll down). */
  move(x: number, y: number): number {
    if (!this.dragged && Math.hypot(x - this.startX, y - this.startY) > TAP_SLOP) this.dragged = true;
    const dy = y - this.lastY;
    this.lastY = y;
    if (!this.dragged) return 0;
    this.accY += dy;
    let steps = 0;
    while (this.accY <= -SCROLL_STEP) {
      this.accY += SCROLL_STEP;
      steps++;
    }
    while (this.accY >= SCROLL_STEP) {
      this.accY -= SCROLL_STEP;
      steps--;
    }
    return steps;
  }

  /** True when the gesture ends as a tap. */
  isTap(): boolean {
    return !this.dragged;
  }
}

// ---------------------------------------------------------------- visibility / quality
export type TouchMode = 'auto' | 'on' | 'off';

/** Should the on-screen controls be shown? */
export function touchVisible(mode: TouchMode, lastDevice: string): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return lastDevice === 'touch';
}

export type Quality = 'high' | 'medium' | 'low';

export interface QualityProfile {
  /** max devicePixelRatio for the display canvas */
  dprCap: number;
  /** multiplier applied on top of the particle setting */
  particleMult: number;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  high: { dprCap: 2, particleMult: 1 },
  medium: { dprCap: 1.5, particleMult: 0.75 },
  low: { dprCap: 1, particleMult: 0.45 },
};

export const QUALITY_LABEL: Record<Quality, string> = { high: '높음', medium: '보통', low: '낮음' };
export const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high'];

export function qualityProfile(q: string | undefined): QualityProfile {
  return QUALITY[(q as Quality) in QUALITY ? (q as Quality) : 'high'];
}
