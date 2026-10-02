// Pure (DOM-free) logic for the on-screen touch controls: floating joystick
// math, the button layout for a given viewport / safe area / game rect, and a
// small pointer router that assigns every touch pointer to a stick, a button
// or nothing. Unit-tested in tests/touch.test.ts; ui/touch.ts binds it to the
// DOM, feeds engine/input and draws it.
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

export const GAME_BUTTONS: TouchButtonId[] = ['dash', 'bomb', 'special', 'active', 'consumable'];
export const SYSTEM_BUTTONS: TouchButtonId[] = ['pause', 'map', 'inventory'];

// ---------------------------------------------------------------- joystick math
/** Fraction of the stick radius that is ignored around the center. */
export const MOVE_DEAD_ZONE = 0.16;
/** Deflection (fraction of radius) at which the move output reaches 1. */
export const MOVE_FULL_AT = 0.82;
/** Deflection needed before the aim stick starts firing. */
export const AIM_ENGAGE = 0.28;

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
  /** size unit (1 ≈ a 380px tall phone in landscape) */
  u: number;
  stickR: number;
  knobR: number;
  leftRest: Vec;
  rightRest: Vec;
  /** x (CSS px) dividing the left (move) and right (aim) stick zones */
  splitX: number;
  buttons: Record<TouchButtonId, Circle>;
  /** generic back / close button for menu screens (top-right) */
  back: Circle;
  /** same, top-left corner */
  backLeft: Circle;
}

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Button layout for a landscape viewport. `game` is the rect (CSS px) the
 * 16:9 game image occupies; it is used to keep the system buttons clear of the
 * HUD's minimap (top-right of the game rect).
 */
export function computeTouchLayout(view: { w: number; h: number }, safe: Insets, game: Rect): TouchLayout {
  const short = Math.min(view.w, view.h);
  const u = clampN(short / 380, 0.8, 1.3);
  const stickR = 44 * u;
  const knobR = 19 * u;
  const l = safe.l;
  const r = safe.r;
  const t = safe.t;
  const b = safe.b;
  // resting sticks sit low in the corners, but on tall screens (tablets, with a
  // letterbox below the game) they are lifted to mostly clear the HUD's bottom row
  const restY = Math.min(view.h - b - 22 * u - stickR, game.y + game.h - game.h * 0.11 - stickR * 0.4);
  const leftRest = { x: l + 26 * u + stickR, y: restY };
  const rightRest = { x: view.w - r - 26 * u - stickR, y: restY };
  const cx = rightRest.x;
  const cy = rightRest.y;
  const D = stickR + 42 * u;
  const D2 = D + 50 * u;
  const at = (deg: number, dist: number, rad: number): Circle => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + Math.cos(a) * dist, y: cy - Math.sin(a) * dist, r: rad };
  };
  const buttons = {
    dash: at(180, D, 27 * u),
    bomb: at(136, D, 21 * u),
    special: at(96, D, 24 * u),
    active: at(120, D2, 20 * u),
    consumable: at(80, D2, 20 * u),
  } as Record<TouchButtonId, Circle>;

  // system buttons: a column in the right letterbox bar when it is wide enough,
  // otherwise a row just left of the HUD minimap (top-right of the game rect)
  const sr = 17 * u;
  const barW = view.w - r - (game.x + game.w);
  if (barW >= 2 * sr + 10 * u) {
    const x = view.w - r - Math.max(sr + 6 * u, barW / 2);
    SYSTEM_BUTTONS.forEach((id, i) => {
      buttons[id] = { x, y: t + 8 * u + sr + i * (2 * sr + 10 * u), r: sr };
    });
  } else {
    const minimapLeft = game.x + game.w * (636 / 768);
    const right = Math.min(minimapLeft - 8 * u, view.w - r - 8 * u);
    SYSTEM_BUTTONS.forEach((id, i) => {
      buttons[id] = { x: right - sr - i * (2 * sr + 10 * u), y: Math.max(t, game.y) + 8 * u + sr, r: sr };
    });
  }
  const back = { x: view.w - r - 10 * u - 18 * u, y: t + 10 * u + 18 * u, r: 18 * u };
  const backLeft = { x: l + 10 * u + 18 * u, y: back.y, r: back.r };
  return { u, stickR, knobR, leftRest, rightRest, splitX: view.w * 0.5, buttons, back, backLeft };
}

/** Distance-based hit test with a generous margin (fingers are fat). */
export function hitCircle(c: Circle, x: number, y: number, margin = 1.25): boolean {
  return Math.hypot(x - c.x, y - c.y) <= c.r * margin;
}

/** Closest enabled button under (x, y), or null. */
export function hitButton(layout: TouchLayout, x: number, y: number, enabled: (id: TouchButtonId) => boolean, margin = 1.25): TouchButtonId | null {
  let best: TouchButtonId | null = null;
  let bestD = Infinity;
  for (const id of Object.keys(layout.buttons) as TouchButtonId[]) {
    if (!enabled(id)) continue;
    const c = layout.buttons[id];
    const d = Math.hypot(x - c.x, y - c.y);
    if (d <= c.r * margin && d < bestD) {
      best = id;
      bestD = d;
    }
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

export type Owner =
  | { kind: 'stick'; side: 'left' | 'right' }
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
  readonly owners = new Map<number, Owner>();
  /** last aim direction (kept while the finger rests in the dead zone) */
  private lastAim: Vec = { x: 1, y: 0 };

  constructor(layout: TouchLayout) {
    this.layout = layout;
  }

  down(id: number, x: number, y: number, enabled: (b: TouchButtonId) => boolean = () => true): Owner {
    const btn = hitButton(this.layout, x, y, enabled);
    let owner: Owner;
    if (btn) owner = { kind: 'button', id: btn };
    else {
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
    return o;
  }

  /** Forget every pointer (mode switch / overlay opened). Fingers still down become ignored. */
  reset(): void {
    for (const id of this.owners.keys()) this.owners.set(id, { kind: 'ignored' });
    this.left = null;
    this.right = null;
  }

  moveVector(): Vec {
    return this.left ? { ...this.left.out } : { x: 0, y: 0 };
  }

  /** Aim direction while the aim stick is held and engaged, else null. */
  aimVector(): Vec | null {
    return this.right && this.right.engaged ? { ...this.right.out } : null;
  }

  /** Buttons currently held by some pointer. */
  heldButtons(): Set<TouchButtonId> {
    const s = new Set<TouchButtonId>();
    for (const o of this.owners.values()) if (o.kind === 'button') s.add(o.id);
    return s;
  }
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
