// On-screen touch controls and touch chrome for menus.
//
// Gameplay (GameScene on top), scheme 'auto' (default, 설정 > 터치 조작 방식):
// fixed left stick = move; a big ATTACK button bottom-right: hold to attack,
// it auto-aims at the best target (nearest enemy in line of sight, preferring
// the move / facing direction, sticky so it does not flicker; a reticle marks
// it), dragging it past a dead zone aims manually in the drag direction, with no
// enemies the aim follows the movement. Scheme 'twin': floating right stick =
// aim + auto-fire. Either way the aim is fed through input.touchAim (the same
// path as the gamepad right stick), so gameplay code has no touch special cases;
// targeting only reads the world. Round buttons for dash / interact (take, buy,
// light a match) / active / potion / lantern release sit in an arc around the attack button, plus pause /
// map / status buttons. Everything is drawn on the display canvas in CSS-pixel
// layout inside the device safe area, with chunky pixel-art discs.
//
// Menus: a short tap = left click at that point (Menu widgets select +
// confirm), a vertical drag = mouse wheel (lists scroll), plus per-scene
// buttons (`Scene.touchBack`, `Scene.touchButtons()`).

import { app } from '../game/app';
import { landscapePromptShown } from './orientation';
import { input, type Action } from '../engine/input';
import { isTouchDevice, save } from '../engine/save';
import type { Renderer } from '../engine/renderer';
import { UI_W, UI_H, VIEW_W, VIEW_H } from '../engine/renderer';
import { safeInsets } from '../engine/viewport';
import { animFrame, definePixelSprite, getSprite } from '../engine/sprites';
import { clamp } from '../engine/math';
import { Actives, Weapons } from '../game/defs';
import type { Enemy } from '../game/enemy';
import { EMBER_MAX } from '../game/player';
import { Pedestal, Pickup, PICKUP_SPRITE, itemInfo, potionSpriteFor } from '../game/pickups';
import type { World } from '../game/world';
import { GameScene } from './game-scene';
import { minimapBlockRect } from './hud';
import type { Scene, TouchButtonSpec } from './scene';
import { C } from './theme';
import { softKeyboard, touchUiActive } from './touch-mode';
import {
  computeTouchLayout, hitMoveStick, knobPosition, pickTarget, touchScheme, TapTracker, TouchRouter, GAME_BUTTONS, SYSTEM_BUTTONS,
  type Circle, type Insets, type TargetCandidate, type TouchButtonId, type TouchLayout, type Vec,
} from './touch-logic';

const BUTTON_ACTION: Record<TouchButtonId, Action> = {
  dash: 'dash',
  active: 'active',
  consumable: 'consumable',
  special: 'special',
  swap: 'swap',
  interact: 'interact',
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
definePixelSprite('tc_swap', { w: '#ffe8b0', g: '#e0a848', d: '#8a5a20' }, [
  '....gw...',
  'wwwwwwg..',
  '....gw...',
  '.........',
  '...wg....',
  '..gwwwwww',
  '...wg....',
], { outline: O });
// open hand (the contextual "줍기" button in the controls reference)
definePixelSprite('tc_pick', { w: '#f4dcb8', d: '#b07a50', g: '#ffe09a' }, [
  '..w.w.w..',
  '..w.w.w.w',
  '.ww.w.w.w',
  '.wwwwwwww',
  'wwwwwwwwd',
  '.wwwwwwd.',
  '..wwwwd..',
  '..dddd...',
  '...g.....',
], { outline: O });
definePixelSprite('tc_attack', { w: '#f4ead8', d: '#b4a8c0', g: '#e0a848', h: '#7a4e1c' }, [
  '.......ww',
  '......wwd',
  '.....wwd.',
  '....wwd..',
  'g..wwd...',
  '.gwwd....',
  '..gd.....',
  '.hhg.....',
  'hh..g....',
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
  private safe: Insets = { l: 0, r: 0, t: 0, b: 0 };
  private layoutKey = '';
  layout: TouchLayout = computeTouchLayout({ w: 800, h: 400 }, { l: 0, r: 0, t: 0, b: 0 }, { game: { x: 0, y: 0, w: 800, h: 400 }, minimap: { x: 660, y: 8, w: 130, h: 110 } });
  readonly router = new TouchRouter(this.layout);
  private taps = new Map<number, TapTracker>();
  private chromePtr = new Map<number, ChromeHit>();
  private mode: 'game' | 'menu' = 'menu';
  private exploration: Scene | null = null;
  private fade = 0;
  private t = 0;
  private flash: Partial<Record<TouchButtonId, number>> = {};
  private lastFrame = 0;
  // auto-aim ('auto' scheme)
  private target: Enemy | null = null;
  private targetId: number | null = null;
  /** current auto-aim direction (target, else movement, else last aim) */
  private aimDir: Vec = { x: 1, y: 0 };
  private cands: TargetCandidate[] = [];
  private candPool: TargetCandidate[] = [];
  /** the aim vector handed to input.touchAim (reused) */
  private aimOut: Vec = { x: 1, y: 0 };
  private candEnemy = new Map<number, Enemy>();
  /** reticle: displayed world position (eased toward the target) and fade */
  private ret = { x: 0, y: 0, half: 8, a: 0, id: -1 };

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
    // automation / debugging (Playwright): layout + current mode
    (window as unknown as { __lktouch?: unknown }).__lktouch = {
      layout: () => {
        this.refreshLayout();
        return this.layout;
      },
      target: () => (this.target ? { id: this.target.id, x: this.target.x, y: this.target.y } : null),
      /** profiling hooks: the touch layer itself and the running GameScene (HUD) */
      self: () => this,
      game: () => this.gameScene(),
      aim: () => ({ ...this.aimDir }),
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

  /** UI-space (UI_W x 432) rect -> CSS px rect. */
  private uiToCss(x: number, y: number, w = 0, h = 0): { x: number; y: number; w: number; h: number } {
    const r = app.renderer;
    const k = this.k;
    const s = r.uiScale / k;
    return { x: r.uiOffsetX / k + x * s, y: r.uiOffsetY / k + y * s, w: w * s, h: h * s };
  }

  private refreshLayout(): void {
    const c = this.canvas;
    const r = app.renderer;
    if (!c || !r) return;
    this.safe = safeInsets();
    const vw = c.clientWidth || window.innerWidth;
    const vh = c.clientHeight || window.innerHeight;
    const scheme = touchScheme(save.settings.touchScheme);
    const key = `${vw}x${vh}|${this.safe.l},${this.safe.r},${this.safe.t},${this.safe.b}|${r.offsetX},${r.offsetY},${r.scale},${r.uiOffsetX},${r.uiOffsetY},${r.uiScale},${UI_W},${c.width}|${scheme}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const k = this.k;
    const game = { x: r.offsetX / k, y: r.offsetY / k, w: (VIEW_W * r.scale) / k, h: (VIEW_H * r.scale) / k };
    const mm = minimapBlockRect(UI_W, r.uiSafe);
    const schemeChanged = this.layout.scheme !== scheme;
    const oldLayout = this.layout;
    this.layout = computeTouchLayout({ w: vw, h: vh }, this.safe, { game, minimap: this.uiToCss(mm.x, mm.y, mm.w, mm.h) }, scheme);
    this.router.layout = this.layout;
    if (schemeChanged || oldLayout.leftRest.x !== this.layout.leftRest.x || oldLayout.leftRest.y !== this.layout.leftRest.y || oldLayout.stickR !== this.layout.stickR) {
      this.router.reset();
      this.syncSticks();
    }
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
    if (id === 'swap') return !!p.weapon2Id;
    if (id === 'interact') {
      if (w.focus instanceof Pickup) return w.focus.price > 0 && w.focus.previewable();
      return (w.focus instanceof Pedestal && !!w.focus.item) || !!w.focus?.interact;
    }
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
    if (app.scenes.top?.touchMovement) {
      this.setMode('game');
      const chrome = vis ? this.hitChrome(p) : null;
      if (chrome) { this.chromePtr.set(e.pointerId, chrome); return; }
      if (vis && hitMoveStick(this.layout, p.x, p.y)) {
        this.router.down(e.pointerId, p.x, p.y, () => false);
        this.syncSticks();
        return;
      }
      this.taps.set(e.pointerId, new TapTracker(p.x, p.y));
      const point = this.toCanvas(p); input.pointMouse(point.x, point.y);
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
    if (owner?.kind === 'stick' || owner?.kind === 'attack') this.syncSticks();
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
    if (this.layout.scheme === 'twin') {
      input.touchAim = this.router.aimVector();
      return;
    }
    if (!this.router.attackHeld()) {
      input.touchAim = null;
      return;
    }
    const g = this.gameScene();
    if (g) this.updateTarget(g.world);
    const man = this.router.manualAim();
    const src = man ?? this.aimDir;
    this.aimOut.x = src.x;
    this.aimOut.y = src.y;
    input.touchAim = this.aimOut;
  }

  // ------------------------------------------------------------ auto-aim
  /** Pick the auto-aim target (read-only world queries) and the resulting aim direction. */
  private updateTarget(w: World): void {
    const p = w.player;
    if (!p || this.layout.scheme !== 'auto') {
      this.target = null;
      this.targetId = null;
      return;
    }
    // reuse candidate objects (no per-frame allocation)
    const pool = this.candPool;
    const cands = this.cands;
    cands.length = 0;
    this.candEnemy.clear();
    for (const e of w.enemies) {
      if (e.dead || !e.alive || e.hidden || !e.vulnerable) continue;
      let c = pool[cands.length];
      if (!c) pool.push((c = { id: 0, x: 0, y: 0, visible: true, weight: 1 }));
      c.id = e.id;
      c.x = e.x;
      c.y = e.y;
      c.visible = w.room.lineOfSight(p.x, p.y, e.x, e.y);
      c.weight = e.hasStatus('charm') ? 1.8 : 1;
      cands.push(c);
      this.candEnemy.set(e.id, e);
    }
    const mv = input.touchMove;
    const ml = Math.hypot(mv.x, mv.y);
    const last = { x: Math.cos(p.aim), y: Math.sin(p.aim) };
    const facing = ml > 0.25 ? { x: mv.x / ml, y: mv.y / ml } : last;
    const t = pickTarget({ x: p.x, y: p.y }, facing, cands, this.targetId);
    this.target = t ? this.candEnemy.get(t.id) ?? null : null;
    this.targetId = t ? t.id : null;
    if (t) {
      const dx = t.x - p.x;
      const dy = t.y - p.y;
      const d = Math.hypot(dx, dy);
      this.aimDir = d > 1e-6 ? { x: dx / d, y: dy / d } : last;
    } else this.aimDir = facing;
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
    const exploration=app.scenes.top?.touchMovement?app.scenes.top:null;
    if(exploration!==this.exploration){this.exploration=exploration;this.router.reset();this.syncSticks();}
    this.setMode(g || exploration ? 'game' : 'menu');
    this.fade = clamp(this.fade + dt * 4, 0, 1);
    this.refreshLayout();
    if (g && this.mode === 'game' && touchUiActive() && this.layout.scheme === 'auto') {
      this.updateTarget(g.world);
      if (this.router.attackHeld()) this.syncSticks();
      this.easeReticle(dt);
    } else {
      this.target = null;
      this.targetId = null;
      this.ret.a = 0;
    }
    // turning a phone to portrait mid-run pauses the game
    if (g && !g.net && !g.world.paused && touchUiActive() && landscapePromptShown()) input.touchTap('pause');
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
    else { if(app.scenes.top?.touchMovement)this.drawStick(r,'left',this.fade,false); this.drawMenuChrome(r); }
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
    d.setTransform(k, 0, 0, k, this.tox, this.toy);
    r.uiText(str, x, y, { size, font: 'small', align, color, alpha, outline: C.ink });
    d.restore();
  }

  private drawStick(r: Renderer, side: 'left' | 'right', A: number, hot: boolean): void {
    const L = this.layout;
    const st = this.router[side];
    if (!st) {
      // resting ghost stick + label: one cached bitmap
      const rest = side === 'left' ? L.leftRest : L.rightRest;
      const key = `${side}|${rest.x},${rest.y}|${L.stickR}|${this.k}|${this.artPx()}`;
      if (this.compBegin(r, side === 'left' ? 'stickL' : 'stickR', key, rest, L.stickR + 4)) {
        this.disc(r, rest, L.stickR, 'ghost', 0.8);
        this.disc(r, rest, L.knobR, 'knob', 0.35);
        this.text(r, side === 'right' ? '조준' : '이동', rest.x, rest.y - 5, 10, C.textDim, 0.55);
        this.compEnd(r);
      }
      this.compBlit(r, side === 'left' ? 'stickL' : 'stickR', A);
      return;
    }
    this.disc(r, st.base, L.stickR, 'base', A);
    const kp = knobPosition(st.base, st.finger, L.stickR);
    if (side === 'right' && st.engaged) {
      // direction pip on the rim
      const a = Math.atan2(st.out.y, st.out.x);
      this.disc(r, { x: st.base.x + Math.cos(a) * (L.stickR - 5 * L.u), y: st.base.y + Math.sin(a) * (L.stickR - 5 * L.u) }, 6 * L.u, 'ready', A);
    }
    this.disc(r, kp, L.knobR, hot ? 'knobHot' : 'knob', A * 0.95);
  }

  // ------------------------------------------------------------ cached composites
  // Every button (disc + progress ring + icon + label + badge) is painted once into
  // an offscreen canvas at display resolution and blitted with one drawImage per
  // frame until its look changes (key). Text outlines are never re-stroked per frame.
  private comps = new Map<string, { key: string; cv: HTMLCanvasElement; g: CanvasRenderingContext2D; x0: number; y0: number }>();
  private compSlot = '';
  private compPrev: CanvasRenderingContext2D | null = null;
  /** translation applied by `text()` while painting a composite (display px) */
  private tox = 0;
  private toy = 0;

  /** Start repainting composite `slot` around c (CSS px, half-size `extent`) if `key` changed; returns false when the cache is valid. */
  private compBegin(r: Renderer, slot: string, key: string, c: Vec, extent: number): boolean {
    let e = this.comps.get(slot);
    if (e && e.key === key) return false;
    const k = this.k;
    const half = Math.ceil(extent * k) + 2;
    const x0 = Math.round(c.x * k) - half;
    const y0 = Math.round(c.y * k) - half;
    if (!e) {
      const cv = document.createElement('canvas');
      e = { key, cv, g: cv.getContext('2d')!, x0, y0 };
      this.comps.set(slot, e);
    }
    e.key = key;
    e.x0 = x0;
    e.y0 = y0;
    if (e.cv.width !== half * 2 || e.cv.height !== half * 2) {
      e.cv.width = half * 2;
      e.cv.height = half * 2;
    } else {
      e.g.setTransform(1, 0, 0, 1, 0, 0);
      e.g.clearRect(0, 0, e.cv.width, e.cv.height);
    }
    e.g.setTransform(1, 0, 0, 1, -x0, -y0);
    e.g.imageSmoothingEnabled = false;
    const rr = r as unknown as { dctx: CanvasRenderingContext2D };
    this.compPrev = rr.dctx;
    rr.dctx = e.g;
    this.compSlot = slot;
    this.tox = -x0;
    this.toy = -y0;
    return true;
  }

  private compEnd(r: Renderer): void {
    const rr = r as unknown as { dctx: CanvasRenderingContext2D };
    if (this.compPrev) rr.dctx = this.compPrev;
    this.compPrev = null;
    this.compSlot = '';
    this.tox = 0;
    this.toy = 0;
  }

  private compBlit(r: Renderer, slot: string, alpha: number): void {
    const e = this.comps.get(slot);
    if (!e || alpha <= 0.003) return;
    const d = r.dctx;
    d.globalAlpha = alpha > 1 ? 1 : alpha;
    d.drawImage(e.cv, e.x0, e.y0);
    d.globalAlpha = 1;
  }

  /** A round action / system button (cached composite) with optional progress ring, label and badge. */
  private drawBtn(r: Renderer, id: TouchButtonId, A: number, held: boolean, icon: string, enabled = true, ready = false, frac = 1, fracColor = '', label = '', badge = ''): void {
    const c: Circle = this.layout.buttons[id];
    const fl = this.flash[id] ?? 0;
    const style: DiscStyle = held ? 'pressed' : ready ? 'ready' : 'button';
    const scale = held ? 0.92 : 1 + fl * 0.04;
    const P = this.artPx();
    const rp = Math.max(5, Math.round((c.r * scale * this.k) / P));
    const fq = frac < 1 ? Math.floor(clamp(frac, 0, 1) * 48) : 48;
    const key = `${style}|${rp}|${P}|${icon}|${enabled ? 1 : 0}|${fq}|${fracColor}|${label}|${badge}|${c.x},${c.y},${c.r}|${this.k}`;
    if (this.compBegin(r, id, key, c, c.r * 1.3 + 8)) {
      const da = held ? 0.95 : enabled ? 0.78 : 0.45;
      this.disc(r, c, c.r * scale, style, da);
      if (fq < 48) this.ring(r, c, rp, fq / 48, fracColor || C.gold, da);
      this.icon(r, icon, c, rp, enabled ? 1 : 0.5, { dy: label ? -1 : 0 });
      if (label) this.text(r, label, c.x, c.y + c.r * 0.38, 10, enabled ? C.text : C.textFaint, enabled ? 0.95 : 0.6);
      if (badge) this.text(r, badge, c.x + c.r * 0.62, c.y + c.r * 0.28, 10, enabled ? C.goldHi : C.textFaint, 1);
      this.compEnd(r);
    }
    this.compBlit(r, id, A);
    if (ready && !held) this.fullRing(r, c, rp, '#ffe09a', A * 0.35 * (0.5 + 0.5 * Math.sin(this.t * 6)));
  }

  private rimCvs = new Map<string, HTMLCanvasElement>();

  /** A complete rim ring (cached bitmap) — the pulsing "ready" highlight. */
  private fullRing(r: Renderer, c: Vec, rp: number, color: string, alpha: number): void {
    if (alpha <= 0.003) return;
    const key = `${rp}|${color}`;
    let cv = this.rimCvs.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = cv.height = rp * 2;
      const g = cv.getContext('2d')!;
      g.fillStyle = color;
      for (const p of rimPixels(rp)) g.fillRect(p.x, p.y, 1, 1);
      this.rimCvs.set(key, cv);
    }
    const k = this.k;
    const P = this.artPx();
    const d = r.dctx;
    d.globalAlpha = alpha;
    d.drawImage(cv, Math.round(c.x * k - rp * P), Math.round(c.y * k - rp * P), rp * 2 * P, rp * 2 * P);
    d.globalAlpha = 1;
  }

  /** Ease the reticle toward the current target (world coords). */
  private easeReticle(dt: number): void {
    const t = this.target;
    const R = this.ret;
    const want = t && !this.router.manualAim() ? (this.router.attackHeld() ? 1 : 0.5) : 0;
    R.a += (want - R.a) * Math.min(1, dt * 12);
    if (!t) return;
    const tx = t.x;
    const ty = t.y - t.z - Math.max(4, t.r * 0.8);
    const half = Math.max(7, t.r + 5);
    if (R.id !== t.id && R.a < 0.05) {
      R.x = tx;
      R.y = ty;
      R.half = half + 4;
    }
    R.id = t.id;
    const k = Math.min(1, dt * 18);
    R.x += (tx - R.x) * k;
    R.y += (ty - R.y) * k;
    R.half += (half - R.half) * k;
  }

  /** Corner brackets around the auto-aim target, in world-pixel steps. */
  private drawReticle(r: Renderer, A: number): void {
    const R = this.ret;
    if (R.a <= 0.03 || !this.target) return;
    const P = r.scale;
    const held = this.router.attackHeld();
    const pulse = held ? 0 : Math.round(Math.sin(this.t * 5) + 1) * 0.5;
    const half = Math.round(R.half + pulse);
    const c = r.worldToDisplay(Math.round(R.x), Math.round(R.y));
    const d = r.dctx;
    const arm = 3;
    const px = (x: number, y: number, w: number, h: number) => d.fillRect(Math.round(c.x + x * P), Math.round(c.y + y * P), Math.ceil(w * P), Math.ceil(h * P));
    for (let pass = 0; pass < 2; pass++) {
      d.globalAlpha = A * R.a * (pass ? 1 : 0.8);
      d.fillStyle = pass ? (held ? '#ffe09a' : '#f4ead8') : C.ink;
      const o = pass ? 0 : 1; // outline pass is 1px fatter
      for (let ci = 0; ci < 4; ci++) {
        const sx = ci & 1 ? 1 : -1;
        const sy = ci & 2 ? 1 : -1;
        const x0 = sx * half - (sx > 0 ? 1 : 0);
        const y0 = sy * half - (sy > 0 ? 1 : 0);
        // horizontal arm
        px(Math.min(x0, x0 - sx * (arm - 1)) - o, y0 - o, arm + 2 * o, 1 + 2 * o);
        // vertical arm
        px(x0 - o, Math.min(y0, y0 - sy * (arm - 1)) - o, 1 + 2 * o, arm + 2 * o);
      }
    }
    d.globalAlpha = 1;
  }

  /** Dotted aim guide from the player while aiming manually with the attack button. */
  private drawAimGuide(r: Renderer, w: World, A: number): void {
    const dir = this.router.manualAim();
    const p = w.player;
    if (!dir || !p) return;
    const P = Math.max(1, Math.round(r.scale));
    const d = r.dctx;
    for (let i = 0; i < 6; i++) {
      const dist = 12 + i * 7;
      const c = r.worldToDisplay(p.x + dir.x * dist, p.y - 5 + dir.y * dist * 0.8);
      d.globalAlpha = A * (0.85 - i * 0.12);
      d.fillStyle = C.ink;
      d.fillRect(Math.round(c.x - P * 1.5), Math.round(c.y - P * 1.5), P * 3, P * 3);
      d.fillStyle = '#ffe09a';
      d.fillRect(Math.round(c.x - P * 0.5), Math.round(c.y - P * 0.5), P, P);
    }
    d.globalAlpha = 1;
  }

  private drawAttack(r: Renderer, w: World, A: number): void {
    const L = this.layout;
    const c = L.attack;
    const p = w.player;
    if (!c || !p) return;
    const at = this.router.attack;
    const on = !!at;
    const wdef = Weapons.get(p.weaponId);
    const P = this.artPx();
    const rp = Math.max(5, Math.round((c.r * (on ? 0.95 : 1) * this.k) / P));
    // charge weapons: the draw progress on the rim
    const st = p.weapon;
    const drawing = wdef?.kind === 'charge' && !!st?.mem?.drawing;
    const cq = drawing ? Math.floor(clamp(st.charge, 0, 1) * 48) : -1;
    const icon = wdef?.icon ?? 'tc_attack';
    const key = `${on ? 1 : 0}|${rp}|${P}|${icon}|${cq}|${c.x},${c.y},${c.r}|${this.k}`;
    if (this.compBegin(r, 'attack', key, c, c.r * 1.2 + 6)) {
      this.disc(r, c, c.r * (on ? 0.95 : 1), on ? 'pressed' : 'button', on ? 0.95 : 0.8);
      if (cq >= 0 && cq < 48) this.ring(r, c, rp, cq / 48, '#7ad0ff', 1);
      this.icon(r, icon, c, rp, on ? 1 : 0.92, { fill: 0.5, dy: -2 });
      this.text(r, '공격', c.x, c.y + c.r * 0.42, 10, on ? C.goldHi : C.text, 0.95);
      this.compEnd(r);
    }
    this.compBlit(r, 'attack', A);
    if (cq >= 48) this.fullRing(r, c, rp, '#ffffff', A * (0.6 + 0.4 * Math.sin(this.t * 30)));
    if (!at) return;
    if (at.manual) {
      // direction pip on the button rim + the finger knob
      const pip = { x: c.x + at.dir.x * (c.r - 5 * L.u), y: c.y + at.dir.y * (c.r - 5 * L.u) };
      this.disc(r, pip, 7 * L.u, 'ready', A);
      this.disc(r, knobPosition(at.base, at.finger, c.r), L.knobR * 0.8, 'knobHot', A * 0.85);
    } else if (!at.onButton) {
      // floating attack touch (outside the button): a small ring where the finger is
      this.disc(r, at.base, L.knobR * 0.9, 'ghost', A * 0.9);
    }
  }

  private drawGame(r: Renderer, w: World): void {
    const p = w.player;
    if (!p) return;
    const L = this.layout;
    const cine = w.bossIntro ? 0.35 : 1;
    const A = this.fade * cine;
    if (A <= 0.01) return;
    const held = this.router.heldButtons();
    if (L.scheme === 'auto' && !w.bossIntro && !w.transitioning) {
      this.drawReticle(r, A);
      this.drawAimGuide(r, w, A);
    }
    this.drawStick(r, 'left', A, false);
    if (L.scheme === 'twin') this.drawStick(r, 'right', A, !!this.router.right?.engaged);
    else this.drawAttack(r, w, A);

    // dash: cooldown sweep
    const dashMax = p.stats?.dashCooldown || 1;
    const dashFrac = p.dashCD > 0 ? 1 - p.dashCD / dashMax : 1;
    this.drawBtn(r, 'dash', A, held.has('dash'), 'tc_dash', dashFrac >= 1, false, dashFrac, '#7ac8ff', '대시');
    // lantern release: ember gauge on the rim
    const ember = clamp(p.ember / EMBER_MAX, 0, 1);
    const full = ember >= 1 && p.releaseCooldown <= 0;
    this.drawBtn(r, 'special', A, held.has('special'), full ? animFrame('ui_lantern', this.t) : 'ui_lantern_0', full, full, ember, C.ember, p.releaseCooldown > 0 ? `${p.releaseCooldown.toFixed(1)}초` : '해방');
    // active item: charge (only while held)
    const adef = p.activeId ? Actives.get(p.activeId) : undefined;
    if (adef) {
      const frac = adef.charge > 0 ? clamp(p.activeCharge / adef.charge, 0, 1) : 1;
      this.drawBtn(r, 'active', A, held.has('active'), adef.icon, frac >= 1, frac >= 1, frac, '#8ee07a');
    }
    // potion
    if (p.potionId) this.drawBtn(r, 'consumable', A, held.has('consumable'), potionSpriteFor(w, p.potionId));
    // weapon swap: shows the weapon in the other slot (only with two weapons)
    const w2 = p.weapon2Id ? Weapons.get(p.weapon2Id) : undefined;
    if (w2) this.drawBtn(r, 'swap', A, held.has('swap'), w2.icon, true, false, 1, '', '교체');
    // take the focused pedestal item (shows the item; "구매" when it has a price)
    const f = w.focus;
    if (f instanceof Pedestal && f.item) {
      const ok = f.affordable(w);
      const label = f.price > 0 || f.heartPrice > 0 ? '구매' : '줍기';
      this.drawBtn(r, 'interact', A, held.has('interact'), itemInfo(f.item).icon, ok, ok, 1, '', label);
    }
    if (f instanceof Pickup && f.price > 0) {
      const ok = p.coins >= f.price && f.canCollect(w);
      const icon = f.kind === 'potion' ? potionSpriteFor(w, f.potionId) : PICKUP_SPRITE[f.kind];
      this.drawBtn(r, 'interact', A, held.has('interact'), icon, ok, ok, 1, '', '구매');
    }
    if (f?.interact && f.interactionInfo) {
      const info = f.interactionInfo(w);
      // silent targets (stone lanterns, secret sconces): a plain hand, no verb and no match check
      if (info.silent) this.drawBtn(r, 'interact', A, held.has('interact'), 'tc_pick', true, false, 1);
      else {
        const ok = info.available ?? true;
        // short verbs fit the button ('불 붙이기', '내려가기'); anything longer reads as '줍기'
        const label = info.actionLabel && info.actionLabel.length <= 6 ? info.actionLabel : '줍기';
        this.drawBtn(r, 'interact', A, held.has('interact'), info.icon, ok, ok, 1, '', label);
      }
    }
    // system
    this.drawBtn(r, 'pause', A, held.has('pause'), 'tc_pause');
    this.drawBtn(r, 'map', A, held.has('map'), 'tc_map');
    this.drawBtn(r, 'inventory', A, held.has('inventory'), 'tc_bag');
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
    d.setTransform(ui, 0, 0, ui, r.uiOffsetX, r.uiOffsetY);
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
