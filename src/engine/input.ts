// Unified input: keyboard + mouse + gamepad + touch mapped onto abstract actions.
// Call `input.update()` exactly once per fixed simulation step; edge queries
// (`pressed`, `released`) are relative to the previous step. Very short taps that
// begin and end between two steps are latched so they are never lost.
// Touch: the on-screen controls (ui/touch.ts) feed `touchMove` / `touchAim` and
// press virtual buttons with `touchPress` / `touchRelease` / `touchTap`.

export type Action =
  | 'up' | 'down' | 'left' | 'right'
  | 'shootUp' | 'shootDown' | 'shootLeft' | 'shootRight'
  | 'fire' | 'dash' | 'bomb' | 'active' | 'consumable' | 'special'
  | 'inventory' | 'map' | 'pause' | 'confirm' | 'cancel'
  | 'uiUp' | 'uiDown' | 'uiLeft' | 'uiRight' | 'restart';

export type AimMode = 'mouse' | 'keys' | 'pad' | 'touch';

/** Input device family used most recently (drives automatic touch-control visibility). */
export type InputDevice = 'keyboard' | 'mouse' | 'pad' | 'touch';

/** Key codes (KeyboardEvent.code) or mouse buttons ("Mouse0", "Mouse2"). */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  shootUp: ['ArrowUp'],
  shootDown: ['ArrowDown'],
  shootLeft: ['ArrowLeft'],
  shootRight: ['ArrowRight'],
  fire: ['Mouse0'],
  dash: ['Space', 'ShiftLeft', 'ShiftRight', 'Mouse2'],
  bomb: ['KeyE'],
  active: ['KeyQ'],
  consumable: ['KeyR'],
  special: ['KeyF', 'Mouse1'],
  inventory: ['Tab', 'KeyI'],
  map: ['KeyM'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter', 'Space'],
  cancel: ['Escape', 'Backspace'],
  uiUp: ['ArrowUp', 'KeyW'],
  uiDown: ['ArrowDown', 'KeyS'],
  uiLeft: ['ArrowLeft', 'KeyA'],
  uiRight: ['ArrowRight', 'KeyD'],
  restart: ['KeyR'],
};

// Standard gamepad mapping button indices
const PAD_BUTTONS: Partial<Record<Action, number[]>> = {
  dash: [0, 5],          // A, RB
  bomb: [2],             // X
  active: [3],           // Y
  consumable: [1],       // B
  inventory: [8],        // Back/Select
  map: [4],              // LB
  pause: [9],            // Start
  confirm: [0],
  cancel: [1],
  uiUp: [12],
  uiDown: [13],
  uiLeft: [14],
  uiRight: [15],
  fire: [7],             // RT (fires in last aim direction)
  special: [6],          // LT (lantern release)
};

export class Input {
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);

  private down = new Set<string>();       // raw codes currently held
  private latched = new Set<string>();    // codes pressed since last update (tap latch)
  private prevActions = new Set<Action>();
  private curActions = new Set<Action>();

  /** Mouse position in canvas backing-store pixels. */
  mouseX = 0;
  mouseY = 0;
  mouseMoved = false;
  wheel = 0;
  private wheelAcc = 0;

  aimMode: AimMode = 'mouse';
  /** Characters typed since last update (for text entry such as seeds). */
  typed: string[] = [];
  private typedAcc: string[] = [];

  // gamepad
  padConnected = false;
  padMove = { x: 0, y: 0 };
  padAim = { x: 0, y: 0 };
  private padPrevButtons: boolean[] = [];
  private padButtons: boolean[] = [];

  /** set by the game when a text box is focused, so WASD etc. do not trigger actions */
  textCapture = false;

  // touch (virtual sticks / buttons)
  /** left virtual stick, length <= 1 */
  touchMove = { x: 0, y: 0 };
  /** right virtual stick direction (unit vector) while aiming, else null */
  touchAim: { x: number; y: number } | null = null;
  private touchHeld = new Set<Action>();
  private touchLatched = new Set<Action>();
  /** most recently used device family */
  lastDevice: InputDevice = 'keyboard';
  /** performance.now() of the last touch event (compat mouse events after it are ignored) */
  lastTouchAt = -1e9;

  private canvas: HTMLCanvasElement | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (isTextField(e.target)) {
        // a DOM text box (mobile seed entry) owns the keyboard: only Enter / Escape pass
        if (e.key === 'Enter' || e.key === 'Escape') {
          this.latched.add(e.key === 'Enter' ? 'Enter' : 'Escape');
        }
        return;
      }
      this.lastDevice = 'keyboard';
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code)) e.preventDefault();
      if (e.repeat) {
        if (this.textCapture && e.key === 'Backspace') this.typedAcc.push('\b');
        return;
      }
      this.down.add(e.code);
      this.latched.add(e.code);
      if (e.code.startsWith('Arrow')) this.aimMode = 'keys';
      if (this.textCapture) {
        if (e.key.length === 1) this.typedAcc.push(e.key);
        else if (e.key === 'Backspace') this.typedAcc.push('\b');
      }
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
    });
    const toCanvas = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = ((e.clientX - rect.left) / rect.width) * canvas.width;
      this.mouseY = ((e.clientY - rect.top) / rect.height) * canvas.height;
    };
    canvas.addEventListener('mousemove', (e) => {
      if (this.fromTouch()) return;
      toCanvas(e);
      this.mouseMoved = true;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) {
        this.aimMode = 'mouse';
        this.lastDevice = 'mouse';
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.fromTouch()) {
        e.preventDefault();
        return;
      }
      this.lastDevice = 'mouse';
      toCanvas(e);
      const code = `Mouse${e.button}`;
      this.down.add(code);
      this.latched.add(code);
      if (e.button === 0) this.aimMode = 'mouse';
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.down.delete(`Mouse${e.button}`);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      this.wheelAcc += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('gamepadconnected', () => { this.padConnected = true; });
    window.addEventListener('gamepaddisconnected', () => { this.padConnected = false; });
  }

  /** Mouse events synthesized by the browser right after a touch are not real mouse use. */
  private fromTouch(): boolean {
    return typeof performance !== 'undefined' && performance.now() - this.lastTouchAt < 900;
  }

  // ------------------------------------------------------------ touch API
  /** Note touch activity (called by the touch layer on every touch pointer event). */
  noteTouch(now = typeof performance !== 'undefined' ? performance.now() : 0): void {
    this.lastTouchAt = now;
    this.lastDevice = 'touch';
  }

  /** Hold a virtual button down (until `touchRelease`). */
  touchPress(a: Action): void {
    this.touchHeld.add(a);
    this.touchLatched.add(a);
  }

  touchRelease(a: Action): void {
    this.touchHeld.delete(a);
  }

  /** One-step press (pressed on the next update, released on the one after). */
  touchTap(a: Action): void {
    this.touchLatched.add(a);
  }

  /** A tap at canvas backing-store coords acting like a left click (menus). */
  tapMouse(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseMoved = true;
    this.latched.add('Mouse0');
  }

  /** Move the virtual pointer (hover in menus) without clicking. */
  pointMouse(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseMoved = true;
  }

  /** Scroll as if by mouse wheel (touch drag in lists); + = down. */
  addWheel(steps: number): void {
    this.wheelAcc += steps;
  }

  /** Simulate a key press from code (used by automated tests / bots). */
  simulateDown(code: string): void {
    this.down.add(code);
    this.latched.add(code);
  }

  simulateUp(code: string): void {
    this.down.delete(code);
  }

  releaseAll(): void {
    this.down.clear();
    this.latched.clear();
    this.touchHeld.clear();
    this.touchLatched.clear();
    this.touchMove.x = this.touchMove.y = 0;
    this.touchAim = null;
  }

  private pollPad(): void {
    this.padPrevButtons = this.padButtons;
    this.padButtons = [];
    this.padMove.x = this.padMove.y = this.padAim.x = this.padAim.y = 0;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads ? Array.from(pads).find((p) => p && p.connected) : undefined;
    if (!pad) return;
    this.padConnected = true;
    const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
    this.padMove.x = dz(pad.axes[0] ?? 0);
    this.padMove.y = dz(pad.axes[1] ?? 0);
    this.padAim.x = dz(pad.axes[2] ?? 0);
    this.padAim.y = dz(pad.axes[3] ?? 0);
    this.padButtons = pad.buttons.map((b) => b.pressed);
    if (Math.hypot(this.padAim.x, this.padAim.y) > 0.4) this.aimMode = 'pad';
    if (this.padButtons.some((b, i) => b && !this.padPrevButtons[i])) {
      if (this.aimMode === 'mouse' || this.aimMode === 'touch') this.aimMode = 'pad';
      this.lastDevice = 'pad';
    }
    if (Math.hypot(this.padMove.x, this.padMove.y) > 0.5 || Math.hypot(this.padAim.x, this.padAim.y) > 0.5) this.lastDevice = 'pad';
  }

  update(): void {
    this.pollPad();
    this.prevActions = this.curActions;
    this.curActions = new Set();
    for (const action of Object.keys(this.bindings) as Action[]) {
      if (this.textCapture && action !== 'confirm' && action !== 'cancel') continue;
      const codes = this.bindings[action];
      let on = false;
      for (const c of codes) {
        if (this.down.has(c) || this.latched.has(c)) { on = true; break; }
      }
      if (!on && (this.touchHeld.has(action) || this.touchLatched.has(action))) on = true;
      if (!on) {
        const pb = PAD_BUTTONS[action];
        if (pb) for (const i of pb) if (this.padButtons[i]) { on = true; break; }
      }
      if (!on && this.padConnected) {
        // left stick as d-pad for UI navigation
        if (action === 'uiUp' && this.padMove.y < -0.6) on = true;
        if (action === 'uiDown' && this.padMove.y > 0.6) on = true;
        if (action === 'uiLeft' && this.padMove.x < -0.6) on = true;
        if (action === 'uiRight' && this.padMove.x > 0.6) on = true;
      }
      if (on) this.curActions.add(action);
    }
    this.latched.clear();
    this.touchLatched.clear();
    this.wheel = this.wheelAcc;
    this.wheelAcc = 0;
    this.typed = this.typedAcc;
    this.typedAcc = [];
  }

  /** Clear the "mouse moved" flag; called once per rendered frame by the game. */
  endFrame(): void {
    this.mouseMoved = false;
  }

  held(a: Action): boolean {
    return this.curActions.has(a);
  }

  pressed(a: Action): boolean {
    return this.curActions.has(a) && !this.prevActions.has(a);
  }

  released(a: Action): boolean {
    return !this.curActions.has(a) && this.prevActions.has(a);
  }

  /** Consume a press so other systems in the same step do not react to it. */
  consume(a: Action): void {
    this.prevActions.add(a);
  }

  mouseHeld(button = 0): boolean {
    return this.down.has(`Mouse${button}`);
  }

  /** Movement vector, length <= 1. */
  moveVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (this.held('up')) y -= 1;
    if (this.held('down')) y += 1;
    if (x === 0 && y === 0 && (this.touchMove.x || this.touchMove.y)) {
      x = this.touchMove.x;
      y = this.touchMove.y;
    }
    if (x === 0 && y === 0 && (this.padMove.x || this.padMove.y)) {
      x = this.padMove.x;
      y = this.padMove.y;
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  /** Direction from arrow keys (Isaac-style 4/8-way shooting), or null. */
  keyAim(): { x: number; y: number } | null {
    let x = 0;
    let y = 0;
    if (this.held('shootLeft')) x -= 1;
    if (this.held('shootRight')) x += 1;
    if (this.held('shootUp')) y -= 1;
    if (this.held('shootDown')) y += 1;
    if (x === 0 && y === 0) return null;
    const l = Math.hypot(x, y);
    return { x: x / l, y: y / l };
  }

  /** Right-stick aim (gamepad, or the touch aim stick): aim + auto-fire while non-null. */
  padAimVector(): { x: number; y: number } | null {
    const l = Math.hypot(this.padAim.x, this.padAim.y);
    if (l >= 0.4) return { x: this.padAim.x / l, y: this.padAim.y / l };
    const t = this.touchAim;
    if (t) {
      const tl = Math.hypot(t.x, t.y);
      if (tl > 1e-6) return { x: t.x / tl, y: t.y / tl };
    }
    return null;
  }
}

function isTextField(t: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

export const input = new Input();
