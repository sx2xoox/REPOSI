// On-screen touch controls (Isaac-mobile style) and touch chrome for menus.
//
// Gameplay (GameScene on top): floating left stick = move, floating right
// stick = aim + auto-fire (fed through input.touchAim, the same path as the
// gamepad right stick), round buttons for dash / bomb / active / potion /
// lantern release, and pause / map / status buttons. Everything is drawn on
// the display canvas in CSS-pixel layout (so the letterbox bars of wide phones
// are used) with chunky pixel-art discs that match the UI theme.
//
// Menus: a short tap = left click at that point (Menu widgets select +
// confirm), a vertical drag = mouse wheel (lists scroll), plus per-scene
// buttons (`Scene.touchBack`, `Scene.touchButtons()`).

import { app } from '../game/app';
import { input, type Action } from '../engine/input';
import { isTouchDevice } from '../engine/save';
import type { Renderer } from '../engine/renderer';
import { UI_W, UI_H } from '../engine/renderer';
import { animFrame, definePixelSprite, getSprite } from '../engine/sprites';
import { clamp } from '../engine/math';
import { Actives } from '../game/defs';
import { EMBER_MAX } from '../game/player';
import { potionSpriteFor } from '../game/pickups';
import type { World } from '../game/world';
import { GameScene } from './game-scene';
import type { Scene, TouchButtonSpec } from './scene';
import { C } from './theme';
import { softKeyboard, touchUiActive } from './touch-mode';
import {
  computeTouchLayout, knobPosition, TapTracker, TouchRouter, GAME_BUTTONS, SYSTEM_BUTTONS,
  type Circle, type Insets, type TouchButtonId, type TouchLayout, type Vec,
} from './touch-logic';

const BUTTON_ACTION: Record<TouchButtonId, Action> = {
  dash: 'dash',
  bomb: 'bomb',
  active: 'active',
  consumable: 'consumable',
  special: 'special',
  pause: 'pause',
  map: 'map',
  inventory: 'inventory',
};

// ---------------------------------------------------------------- icons
const O = '#0c0810';
const W = { w: '#f4ead8', d: '#b4a8c0' };
definePixelSprite('tc_pause', W, ['ww.ww', 'wd.wd', 'wd.wd', 'wd.wd', 'wd.wd', 'dd.dd'], { outline: O });
definePixelSprite('tc_close', W, ['ww...ww', 'www.www', '.wwwww.', '..www..', '.wwdww.', 'wwd.dww', 'dd...dd'], { outline: O });
definePixelSprite('tc_back', W, ['...w...', '..ww...', '.wwwwww', 'wwwwwww', '.wddddd', '..wd...', '...d...'], { outline: O });
definePixelSprite('tc_full', W, ['www...www', 'w.......w', 'w.......w', '.........', '.........', '.........', 'd.......d', 'd.......d', 'ddd...ddd'], { outline: O });
definePixelSprite('tc_map', { p: '#e8d4a6', s: '#b89a6a', d: '#7a5a3a', r: '#e8283c' }, [
  'pppsppps',
  'pdpsppps',
  'ppdsprpr',
  'pppdpsrp',
  'pppsdrpr',
  'pppsppps',
  'ssssssss',
], { outline: O });
definePixelSprite('tc_bag', { b: '#b07a40', B: '#6a4420', h: '#e0a860', y: '#ffe09a' }, [
  '..BBBB..',
  '.B....B.',
  'BhhhhhhB',
  'BhbyybbB',
  'BbbyybbB',
  'BbbbbbbB',
  'BBBBBBBB',
], { outline: O });
definePixelSprite('tc_dash', { w: '#bfe8ff', b: '#5aa8e0', d: '#2a5a8a' }, [
  '....bw..',
  '...bww..',
  'd.bwwwww',
  'dbwwwwww',
  'd.bwwwww',
  '...bww..',
  '....bw..',
], { outline: O });
definePixelSprite('tc_arrow_l', { w: '#ffe09a', d: '#c08a3a' }, ['....w', '...ww', '..www', '.wwww', 'dwwww', '.dwww', '..dww', '...dw', '....d'], { outline: O });
definePixelSprite('tc_arrow_r', { w: '#ffe09a', d: '#c08a3a' }, ['w....', 'ww...', 'www..', 'wwww.', 'wwwwd', 'wwwd.', 'wwd..', 'wd...', 'd....'], { outline: O });

// ---------------------------------------------------------------- pixel discs
type DiscStyle = 'button' | 'pressed' | 'ready' | 'base' | 'knob' | 'knobHot' | 'ghost';

interface DiscPalette {
  fill: string;
  sheen: string;
  rim: string;
  rimHi: string;
  rimLo: string;
}

const PALETTES: Record<DiscStyle, DiscPalette> = {
  button: { fill: '#1b1424d0', sheen: '#2c2238d0', rim: '#4a3a5c', rimHi: '#8a7aa0', rimLo: '#2a1f36' },
  pressed: { fill: '#3a2c48e8', sheen: '#4e3c60e8', rim: '#c8862c', rimHi: '#ffe09a', rimLo: '#7a4e1c' },
  ready: { fill: '#2a1a14e0', sheen: '#40261ae0', rim: '#e0a848', rimHi: '#ffe09a', rimLo: '#7a4e1c' },
  base: { fill: '#0c081050', sheen: '#1b142450', rim: '#4a3a5c', rimHi: '#7a6a8c', rimLo: '#2a1f36' },
  ghost: { fill: '#0c081030', sheen: '#1b142430', rim: '#3a2e48', rimHi: '#5a4a6c', rimLo: '#221a2c' },
  knob: { fill: '#3a2c48', sheen: '#5a4870', rim: '#8a7aa0', rimHi: '#d8cce8', rimLo: '#4a3a5c' },
  knobHot: { fill: '#5a3a24', sheen: '#7a5232', rim: '#e0a848', rimHi: '#ffe09a', rimLo: '#7a4e1c' },
};

const discCache = new Map<string, HTMLCanvasElement>();

/** A shaded pixel disc of radius `rp` art pixels (1px ink outline, bevelled rim, top-left light). */
function discCanvas(rp: number, style: DiscStyle): HTMLCanvasElement {
  const key = `${rp}:${style}`;
  let c = discCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = rp * 2;
  const g = c.getContext('2d')!;
  const pal = PALETTES[style];
  const ringW = rp >= 14 ? 2.2 : 1.6;
  for (let j = 0; j < rp * 2; j++) {
    for (let i = 0; i < rp * 2; i++) {
      const px = i + 0.5 - rp;
      const py = j + 0.5 - rp;
      const d = Math.hypot(px, py);
      if (d > rp) continue;
      let col: string;
      if (d > rp - 1) col = O;
      else if (d > rp - 1 - ringW) {
        const l = (-px - py) / (d * Math.SQRT2 || 1);
        col = l > 0.35 ? pal.rimHi : l < -0.35 ? pal.rimLo : pal.rim;
      } else {
        col = px + py < -rp * 0.75 && d > rp * 0.45 ? pal.sheen : pal.fill;
      }
      g.fillStyle = col;
      g.fillRect(i, j, 1, 1);
    }
  }
  discCache.set(key, c);
  return c;
}

const rimCache = new Map<number, { x: number; y: number; a: number }[]>();

/** Rim pixels of a disc with their clockwise angle from 12 o'clock (0..1). */
function rimPixels(rp: number): { x: number; y: number; a: number }[] {
  let list = rimCache.get(rp);
  if (list) return list;
  list = [];
  const ringW = rp >= 14 ? 2.2 : 1.6;
  for (let j = 0; j < rp * 2; j++) {
    for (let i = 0; i < rp * 2; i++) {
      const px = i + 0.5 - rp;
      const py = j + 0.5 - rp;
      const d = Math.hypot(px, py);
      if (d <= rp - 1 && d > rp - 1 - ringW) {
        let a = Math.atan2(px, -py) / (Math.PI * 2);
        if (a < 0) a += 1;
        list.push({ x: i, y: j, a });
      }
    }
  }
  rimCache.set(rp, list);
  return list;
}

// ---------------------------------------------------------------- controller
interface ChromeHit {
  kind: 'back' | 'button';
  spec?: TouchButtonSpec;
}

export class TouchControls {
  private canvas: HTMLCanvasElement | null = null;
  private probe: HTMLDivElement | null = null;
  private safe: Insets = { l: 0, r: 0, t: 0, b: 0 };
  private safeDirty = true;
  private layoutKey = '';
  layout: TouchLayout = computeTouchLayout({ w: 800, h: 400 }, { l: 0, r: 0, t: 0, b: 0 }, { x: 0, y: 0, w: 800, h: 400 });
  readonly router = new TouchRouter(this.layout);
  private taps = new Map<number, TapTracker>();
  private chromePtr = new Map<number, ChromeHit>();
  private mode: 'game' | 'menu' = 'menu';
  private fade = 0;
  private t = 0;
  private flash: Partial<Record<TouchButtonId, number>> = {};
  private lastFrame = 0;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    if (isTouchDevice()) input.lastDevice = 'touch';
    const active = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), active);
    window.addEventListener('pointermove', (e) => this.onMove(e), active);
    window.addEventListener('pointerup', (e) => this.onUp(e, false), active);
    window.addEventListener('pointercancel', (e) => this.onUp(e, true), active);
    // block browser gestures (scroll / pinch / double-tap zoom / callout) and compat mouse events
    const block = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    canvas.addEventListener('touchstart', block, active);
    canvas.addEventListener('touchmove', block, active);
    canvas.addEventListener('touchend', (e) => {
      softKeyboard.flush();
      block(e);
    }, active);
    document.addEventListener('gesturestart', block as EventListener, active);
    const dirty = () => {
      this.safeDirty = true;
    };
    window.addEventListener('resize', dirty);
    window.addEventListener('orientationchange', dirty);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(probe);
    this.probe = probe;
    // automation / debugging (Playwright): layout + current mode
    (window as unknown as { __lktouch?: unknown }).__lktouch = {
      layout: () => {
        this.refreshLayout();
        return this.layout;
      },
      mode: () => this.mode,
      visible: () => touchUiActive(),
      scene: () => app.scenes?.top?.constructor?.name ?? '',
      chrome: () => {
        const c = this.chromeOf(app.scenes?.top);
        return { back: c.back, backAt: c.backAt, buttons: c.buttons.map((b) => ({ ...this.uiToCss(b.x, b.y, b.w, b.h), label: b.label ?? b.icon ?? '' })) };
      },
    };
  }

  // ------------------------------------------------------------ geometry
  /** backing-store pixels per CSS pixel */
  private get k(): number {
    const c = this.canvas;
    if (!c) return 1;
    const w = c.clientWidth || window.innerWidth || 1;
    return c.width / w;
  }

  private cssPoint(e: PointerEvent): Vec {
    const rect = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private toCanvas(p: Vec): Vec {
    const k = this.k;
    return { x: p.x * k, y: p.y * k };
  }

  /** UI-space (768x432) rect -> CSS px rect. */
  private uiToCss(x: number, y: number, w = 0, h = 0): { x: number; y: number; w: number; h: number } {
    const r = app.renderer;
    const k = this.k;
    const s = r.uiScale / k;
    return { x: r.offsetX / k + x * s, y: r.offsetY / k + y * s, w: w * s, h: h * s };
  }

  private refreshLayout(): void {
    const c = this.canvas;
    const r = app.renderer;
    if (!c || !r) return;
    if (this.safeDirty && this.probe) {
      const cs = getComputedStyle(this.probe);
      this.safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
      this.safeDirty = false;
    }
    const vw = c.clientWidth || window.innerWidth;
    const vh = c.clientHeight || window.innerHeight;
    const key = `${vw}x${vh}|${this.safe.l},${this.safe.r},${this.safe.t},${this.safe.b}|${r.offsetX},${r.offsetY},${r.scale},${c.width}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const k = this.k;
    const game = { x: r.offsetX / k, y: r.offsetY / k, w: (384 * r.scale) / k, h: (216 * r.scale) / k };
    this.layout = computeTouchLayout({ w: vw, h: vh }, this.safe, game);
    this.router.layout = this.layout;
  }

  // ------------------------------------------------------------ scene queries
  private gameScene(): GameScene | null {
    const top = app.scenes?.top;
    return top instanceof GameScene && !top.world.gameOver ? top : null;
  }

  private buttonEnabled(id: TouchButtonId, w: World): boolean {
    const p = w.player;
    if (!p) return false;
    if (id === 'active') return !!p.activeId;
    if (id === 'consumable') return !!p.potionId;
    return true;
  }

  private chromeOf(scene: Scene | undefined): { back: Scene['touchBack']; backAt: Circle; buttons: TouchButtonSpec[] } {
    const backAt = scene?.touchBackAt === 'left' ? this.layout.backLeft : this.layout.back;
    if (!scene) return { back: false, backAt, buttons: [] };
    let buttons: TouchButtonSpec[] = [];
    try {
      buttons = scene.touchButtons?.() ?? [];
    } catch {
      buttons = [];
    }
    return { back: scene.touchBack ?? false, backAt, buttons };
  }

  private hitChrome(p: Vec): ChromeHit | null {
    const { back, backAt, buttons } = this.chromeOf(app.scenes?.top);
    if (back && Math.hypot(p.x - backAt.x, p.y - backAt.y) <= backAt.r * 1.4) return { kind: 'back' };
    for (const b of buttons) {
      const r = this.uiToCss(b.x, b.y, b.w, b.h);
      const m = 6 * this.layout.u; // generous margin
      if (p.x >= r.x - m && p.x <= r.x + r.w + m && p.y >= r.y - m && p.y <= r.y + r.h + m) return { kind: 'button', spec: b };
    }
    return null;
  }

  private sameChrome(a: ChromeHit | null, b: ChromeHit): boolean {
    if (!a || a.kind !== b.kind) return false;
    if (a.kind === 'back') return true;
    return !!a.spec && !!b.spec && a.spec.x === b.spec.x && a.spec.y === b.spec.y && a.spec.label === b.spec.label;
  }

  // ------------------------------------------------------------ pointer events
  private isTouch(e: PointerEvent): boolean {
    return e.pointerType === 'touch' || e.pointerType === 'pen';
  }

  private onDown(e: PointerEvent): void {
    if (!this.isTouch(e) || !this.canvas) return;
    e.preventDefault();
    input.noteTouch();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no active pointer to capture
    }
    this.refreshLayout();
    const p = this.cssPoint(e);
    const g = this.gameScene();
    const vis = touchUiActive();
    if (g) {
      this.setMode('game');
      if (!vis) return;
      input.aimMode = 'touch';
      const owner = this.router.down(e.pointerId, p.x, p.y, (id) => this.buttonEnabled(id, g.world));
      if (owner.kind === 'button') {
        input.touchPress(BUTTON_ACTION[owner.id]);
        this.flash[owner.id] = 1;
      }
      this.syncSticks();
      return;
    }
    this.setMode('menu');
    const chrome = vis ? this.hitChrome(p) : null;
    if (chrome) {
      this.chromePtr.set(e.pointerId, chrome);
      return;
    }
    this.taps.set(e.pointerId, new TapTracker(p.x, p.y));
    const c = this.toCanvas(p);
    input.pointMouse(c.x, c.y);
  }

  private onMove(e: PointerEvent): void {
    if (!this.isTouch(e)) return;
    const id = e.pointerId;
    const known = this.router.owners.has(id) || this.taps.has(id) || this.chromePtr.has(id);
    if (!known) return;
    if (e.cancelable) e.preventDefault();
    input.noteTouch();
    const p = this.cssPoint(e);
    if (this.router.owners.has(id)) {
      this.router.move(id, p.x, p.y);
      this.syncSticks();
      return;
    }
    const tr = this.taps.get(id);
    if (tr) {
      const steps = tr.move(p.x, p.y);
      if (steps) input.addWheel(steps);
      const c = this.toCanvas(p);
      input.pointMouse(c.x, c.y);
    }
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    if (!this.isTouch(e)) return;
    const id = e.pointerId;
    input.noteTouch();
    softKeyboard.flush();
    const owner = this.router.up(id);
    if (owner?.kind === 'button') input.touchRelease(BUTTON_ACTION[owner.id]);
    if (owner?.kind === 'stick') this.syncSticks();
    const p = this.canvas ? this.cssPoint(e) : { x: 0, y: 0 };
    const chrome = this.chromePtr.get(id);
    if (chrome) {
      this.chromePtr.delete(id);
      if (!cancelled && this.sameChrome(this.hitChrome(p), chrome)) this.fireChrome(chrome);
      return;
    }
    const tr = this.taps.get(id);
    if (tr) {
      this.taps.delete(id);
      if (!cancelled && tr.isTap()) {
        const c = this.toCanvas(p);
        input.tapMouse(c.x, c.y);
      }
    }
  }

  private fireChrome(c: ChromeHit): void {
    if (c.kind === 'back') {
      input.touchTap('cancel');
      return;
    }
    const tap = c.spec?.tap;
    if (typeof tap === 'function') tap();
    else if (tap) input.touchTap(tap);
    softKeyboard.flush();
  }

  private syncSticks(): void {
    const mv = this.router.moveVector();
    input.touchMove.x = mv.x;
    input.touchMove.y = mv.y;
    input.touchAim = this.router.aimVector();
  }

  private setMode(m: 'game' | 'menu'): void {
    if (m === this.mode) return;
    this.mode = m;
    // fingers that were down keep doing nothing until lifted
    this.router.reset();
    this.taps.clear();
    this.chromePtr.clear();
    for (const id of [...GAME_BUTTONS, ...SYSTEM_BUTTONS]) input.touchRelease(BUTTON_ACTION[id]);
    this.syncSticks();
    if (m === 'game') this.fade = 0;
  }

  /** Once per rendered frame, before the simulation steps. */
  frame(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    this.t += dt;
    for (const id of Object.keys(this.flash) as TouchButtonId[]) this.flash[id] = Math.max(0, (this.flash[id] ?? 0) - dt * 4);
    const g = this.gameScene();
    this.setMode(g ? 'game' : 'menu');
    this.fade = clamp(this.fade + dt * 4, 0, 1);
    this.refreshLayout();
    // turning a phone to portrait mid-run pauses the game
    if (g && !g.world.paused && touchUiActive() && this.portraitPhone()) input.touchTap('pause');
  }

  /** Same condition as the CSS rotate prompt (index.html / style.css). */
  private portraitPhone(): boolean {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia?.('(orientation: portrait) and (pointer: coarse)').matches;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ drawing
  /** Art pixel size in backing pixels (close to the world's pixel size). */
  private artPx(): number {
    return Math.max(2, Math.round((app.renderer?.scale ?? 3) * 0.8));
  }

  draw(r: Renderer): void {
    if (!this.canvas || !touchUiActive()) return;
    const d = r.dctx;
    d.save();
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.imageSmoothingEnabled = false;
    const g = this.gameScene();
    if (g && this.mode === 'game') this.drawGame(r, g.world);
    else this.drawMenuChrome(r);
    d.restore();
  }

  private disc(r: Renderer, c: Vec, rCss: number, style: DiscStyle, alpha: number): number {
    const k = this.k;
    const P = this.artPx();
    const rp = Math.max(5, Math.round((rCss * k) / P));
    const cv = discCanvas(rp, style);
    const x = Math.round(c.x * k - rp * P);
    const y = Math.round(c.y * k - rp * P);
    r.dctx.globalAlpha = alpha;
    r.dctx.drawImage(cv, x, y, rp * 2 * P, rp * 2 * P);
    r.dctx.globalAlpha = 1;
    return rp;
  }

  /** Progress arc on a disc's rim (clockwise from 12 o'clock). */
  private ring(r: Renderer, c: Vec, rp: number, frac: number, color: string, alpha: number): void {
    if (frac <= 0) return;
    const k = this.k;
    const P = this.artPx();
    const x0 = Math.round(c.x * k - rp * P);
    const y0 = Math.round(c.y * k - rp * P);
    const d = r.dctx;
    d.globalAlpha = alpha;
    d.fillStyle = color;
    for (const p of rimPixels(rp)) if (p.a <= frac) d.fillRect(x0 + p.x * P, y0 + p.y * P, P, P);
    d.globalAlpha = 1;
  }

  private icon(r: Renderer, name: string, c: Vec, rp: number, alpha: number, o: { fill?: number; dy?: number } = {}): void {
    const s = getSprite(name);
    const P = this.artPx();
    const k = this.k;
    const want = (rp * 2 * (o.fill ?? 0.62)) / Math.max(s.w, s.h);
    const sc = Math.max(1, Math.floor(want + 0.25)) * P;
    const x = Math.round(c.x * k - (s.w * sc) / 2);
    const y = Math.round(c.y * k - (s.h * sc) / 2 + (o.dy ?? 0) * P);
    r.dctx.globalAlpha = alpha;
    r.dctx.drawImage(s.canvas, x, y, s.w * sc, s.h * sc);
    r.dctx.globalAlpha = 1;
  }

  /** Text in CSS px coordinates. */
  private text(r: Renderer, str: string, x: number, y: number, size: number, color: string, alpha: number, align: CanvasTextAlign = 'center'): void {
    const k = this.k;
    const d = r.dctx;
    d.save();
    d.setTransform(k, 0, 0, k, 0, 0);
    r.uiText(str, x, y, { size, font: 'small', align, color, alpha, outline: C.ink });
    d.restore();
  }

  private drawStick(r: Renderer, side: 'left' | 'right', A: number, hot: boolean): void {
    const L = this.layout;
    const st = this.router[side];
    if (!st) {
      const rest = side === 'left' ? L.leftRest : L.rightRest;
      this.disc(r, rest, L.stickR, 'ghost', A * 0.8);
      this.disc(r, rest, L.knobR, 'knob', A * 0.35);
      if (side === 'right') this.text(r, '조준', rest.x, rest.y - 5, 10, C.textDim, A * 0.55);
      else this.text(r, '이동', rest.x, rest.y - 5, 10, C.textDim, A * 0.55);
      return;
    }
    const rp = this.disc(r, st.base, L.stickR, 'base', A);
    const kp = knobPosition(st.base, st.finger, L.stickR);
    if (side === 'right' && st.engaged) {
      // direction pip on the rim
      const a = Math.atan2(st.out.y, st.out.x);
      const pip = { x: st.base.x + Math.cos(a) * (L.stickR - 5 * L.u), y: st.base.y + Math.sin(a) * (L.stickR - 5 * L.u) };
      this.disc(r, pip, 6 * L.u, 'ready', A);
    }
    void rp;
    this.disc(r, kp, L.knobR, hot ? 'knobHot' : 'knob', A * 0.95);
  }

  private drawGame(r: Renderer, w: World): void {
    const p = w.player;
    if (!p) return;
    const L = this.layout;
    const cine = w.bossIntro ? 0.35 : 1;
    const A = this.fade * cine;
    if (A <= 0.01) return;
    const held = this.router.heldButtons();
    this.drawStick(r, 'left', A, false);
    this.drawStick(r, 'right', A, !!this.router.right?.engaged);

    const btn = (id: TouchButtonId, opts: { icon: string; enabled?: boolean; ready?: boolean; frac?: number; fracColor?: string; label?: string; badge?: string; hidden?: boolean }) => {
      const c: Circle = L.buttons[id];
      if (opts.hidden) return;
      const on = held.has(id);
      const fl = this.flash[id] ?? 0;
      const style: DiscStyle = on ? 'pressed' : opts.ready ? 'ready' : 'button';
      const en = opts.enabled !== false;
      const alpha = A * (on ? 0.95 : en ? 0.78 : 0.45);
      const scale = on ? 0.92 : 1 + fl * 0.04;
      const rp = this.disc(r, c, c.r * scale, style, alpha);
      if (opts.frac !== undefined && opts.frac < 1) this.ring(r, c, rp, opts.frac, opts.fracColor ?? C.gold, alpha);
      if (opts.ready && !on) {
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
        this.ring(r, c, rp, 1, '#ffe09a', A * 0.35 * pulse);
      }
      this.icon(r, opts.icon, c, rp, A * (en ? 1 : 0.5), { dy: opts.label ? -1 : 0 });
      if (opts.label) this.text(r, opts.label, c.x, c.y + c.r * 0.38, 10, en ? C.text : C.textFaint, A * (en ? 0.95 : 0.6));
      if (opts.badge) this.text(r, opts.badge, c.x + c.r * 0.62, c.y + c.r * 0.28, 10, en ? C.goldHi : C.textFaint, A);
    };

    // dash: cooldown sweep
    const dashMax = p.stats?.dashCooldown || 1;
    const dashFrac = p.dashCD > 0 ? 1 - p.dashCD / dashMax : 1;
    btn('dash', { icon: 'tc_dash', frac: dashFrac, fracColor: '#7ac8ff', label: '대시', enabled: dashFrac >= 1 });
    // bomb: count
    btn('bomb', { icon: 'hud_bomb', enabled: p.bombs > 0, badge: String(p.bombs) });
    // lantern release: ember gauge
    const ember = clamp(p.ember / EMBER_MAX, 0, 1);
    const full = ember >= 1;
    btn('special', { icon: full ? animFrame('ui_lantern', this.t) : 'ui_lantern_0', frac: ember, fracColor: C.ember, ready: full, enabled: full, label: '해방' });
    // active item: charge
    const adef = p.activeId ? Actives.get(p.activeId) : undefined;
    if (adef) {
      const frac = adef.charge > 0 ? clamp(p.activeCharge / adef.charge, 0, 1) : 1;
      btn('active', { icon: adef.icon, frac, fracColor: '#8ee07a', ready: frac >= 1, enabled: frac >= 1 });
    } else btn('active', { icon: 'tc_pause', hidden: true });
    // potion
    if (p.potionId) btn('consumable', { icon: potionSpriteFor(w, p.potionId) });
    else btn('consumable', { icon: 'tc_pause', hidden: true });
    // system
    btn('pause', { icon: 'tc_pause' });
    btn('map', { icon: 'tc_map' });
    btn('inventory', { icon: 'tc_bag' });
  }

  private drawMenuChrome(r: Renderer): void {
    const top = app.scenes?.top;
    const { back, backAt, buttons } = this.chromeOf(top);
    const pressed = [...this.chromePtr.values()];
    if (back) {
      const on = pressed.some((c) => c.kind === 'back');
      const rp = this.disc(r, backAt, backAt.r * (on ? 0.92 : 1), on ? 'pressed' : 'button', on ? 0.95 : 0.85);
      this.icon(r, back === 'back' ? 'tc_back' : 'tc_close', backAt, rp, 1, { fill: 0.5 });
    }
    for (const b of buttons) if (!b.ghost) this.drawSpecButton(r, b, pressed.some((c) => c.spec && c.spec.x === b.x && c.spec.y === b.y && c.spec.label === b.label));
  }

  /** A rectangular framed button (UI-space spec) drawn in display space. */
  private drawSpecButton(r: Renderer, b: TouchButtonSpec, on: boolean): void {
    const d = r.dctx;
    d.save();
    const ui = r.uiScale;
    d.setTransform(ui, 0, 0, ui, r.offsetX, r.offsetY);
    const k = on ? 0.96 : 1;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    d.translate(cx, cy);
    d.scale(k, k);
    d.translate(-cx, -cy);
    // frame
    const style = on ? '#3a2c48' : b.primary ? '#2a1a14' : '#1b1424';
    d.globalAlpha = 0.9;
    d.fillStyle = C.ink;
    d.fillRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    d.fillStyle = on || b.primary ? C.gold : C.rim;
    d.fillRect(b.x, b.y, b.w, b.h);
    d.fillStyle = on || b.primary ? C.goldDark : C.rimDark;
    d.fillRect(b.x + 2, b.y + b.h - 2, b.w - 2, 2);
    d.fillRect(b.x + b.w - 2, b.y + 2, 2, b.h - 2);
    d.fillStyle = style;
    d.fillRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
    d.globalAlpha = 1;
    let tx = cx;
    if (b.icon) {
      const s = getSprite(b.icon);
      const sc = 2;
      const ix = b.label ? b.x + 10 : cx - (s.w * sc) / 2;
      d.drawImage(s.canvas, Math.round(ix), Math.round(cy - (s.h * sc) / 2), s.w * sc, s.h * sc);
      if (b.label) tx = cx + (s.w * sc) / 2 + 2;
    }
    if (b.label) r.uiText(b.label, tx, cy - 7, { size: 12, bold: !!b.primary, align: 'center', color: b.primary ? C.goldHi : C.text, outline: C.ink });
    d.restore();
  }
}

export const touch = new TouchControls();

/** Keep UI-space buttons inside the 768x432 canvas. */
export function uiButton(x: number, y: number, w: number, h: number, tap: TouchButtonSpec['tap'], o: Partial<TouchButtonSpec> = {}): TouchButtonSpec {
  return { x: clamp(x, 0, UI_W - w), y: clamp(y, 0, UI_H - h), w, h, tap, ...o };
}
