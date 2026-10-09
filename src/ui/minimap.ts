// HUD minimap (등불 성좌도, top-right): a brass plate in the purse's language
// with a night-glass window onto the floor's map. The rooms, threads and sigils
// are painted once per map state into a map-space canvas (map-art.ts) and
// blitted at the camera offset; glows, the vignette and the plate are cached
// canvases too. Only the current room's breathing glow, its flame, teammate
// pips and short transitions (room enter flare, clear ring, cross-fade on any
// map change) are drawn live. Pure UI: reads the world, never writes it.

import type { Renderer } from '../engine/renderer';
import type { World } from '../game/world';
import { save } from '../engine/save';
import { slotColor } from '../game/coopfx';
import { Spring } from './anim';
import { glow } from './frame';
import { blitArt } from './hud-gear';
import { lookFor, type MapLook } from './map-look';
import { buildMapView, keeperCell, knownBounds, mapSignature, miniCamTarget, nodeKnown, type MapSource, type MapView, type ViewNode } from './map-view';
import {
  FLAME3, FLAME5, MINI_LAYOUT, MINI_PLATE, MINI_SIZE, paintFlame, paintMapPlate, paintMiniBackground, paintPip, paintRooms,
  paintVignette, plateRect, sigilKey, threadPixels, type GlowSpot, type PlateRect,
} from './map-art';
import type { PixelPainter } from '../engine/painter';
import { PX } from './theme';

export { knownBounds, nodeKnown };

// ---------------------------------------------------------------- canvas caches (DOM only)
const artCache = new Map<string, HTMLCanvasElement>();

/** A PixelPainter turned into a canvas once per key (small art: plates, flames, beads, backgrounds). */
export function artCanvas(key: string, paint: () => PixelPainter): HTMLCanvasElement {
  let cv = artCache.get(key);
  if (!cv) {
    if (artCache.size > 96) artCache.clear();
    cv = paint().toCanvas();
    artCache.set(key, cv);
  }
  return cv;
}

const hexA = (a: number): string => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

/** Soft additive glows (UI-unit spots) painted at art resolution into a `w` x `h` canvas. */
export function glowCanvas(glows: readonly GlowSpot[], w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w);
  cv.height = Math.max(1, h);
  const g = cv.getContext('2d')!;
  g.globalCompositeOperation = 'lighter';
  for (const s of glows) {
    const x = s.x / PX;
    const y = s.y / PX;
    const r = Math.max(1, s.r / PX);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, s.color + hexA(s.alpha));
    gr.addColorStop(0.4, s.color + hexA(s.alpha * 0.5));
    gr.addColorStop(1, s.color + '00');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return cv;
}

/** Blit an art canvas additively with smoothing (glow layers). */
export function blitGlow(r: Renderer, cv: HTMLCanvasElement, x: number, y: number, alpha: number): void {
  if (alpha <= 0.003) return;
  const d = r.dctx;
  const op = d.globalCompositeOperation;
  const sm = d.imageSmoothingEnabled;
  d.globalCompositeOperation = 'lighter';
  d.globalAlpha = Math.min(1, alpha);
  d.imageSmoothingEnabled = true;
  d.drawImage(cv, x, y, cv.width * PX, cv.height * PX);
  d.imageSmoothingEnabled = sm;
  d.globalCompositeOperation = op;
  d.globalAlpha = 1;
}

export function lowQuality(): boolean {
  return save.settings.graphicsQuality === 'low';
}

/** World as the map reads it. */
export function mapSource(w: World): MapSource {
  return w as unknown as MapSource;
}

function settle(sp: Spring): void {
  if (sp.value !== sp.target && Math.abs(sp.target - sp.value) < 0.002 && Math.abs(sp.vel) < 0.02) sp.set(sp.target);
}

interface MiniState {
  sig: number;
  theme: string;
  view: MapView;
  look: MapLook;
  rooms: HTMLCanvasElement | null;
  glow: HTMLCanvasElement | null;
}

const VIEW = MINI_PLATE.view;
/** minimap vignette: twice the window, centred on the current room */
const VIG_W = VIEW.w * 2;
const VIG_H = VIEW.h * 2;
const ENTER_FLARE = 0.25;
const ENTER_STREAK = 0.18;
const FADE = 0.3;

/** HUD minimap with smooth recentering. */
export class MinimapView {
  /** camera target (map cells at the window's centre) */
  private sx = new Spring(0, 140, 22);
  private sy = new Spring(0, 140, 22);
  private init = false;
  /** room-clear flash 1 -> 0 (set by the HUD) */
  flash = 0;
  private cur: MiniState | null = null;
  private prev: MiniState | null = null;
  private fadeT = FADE;
  private enterT = 9;
  private nodeId = -1;
  private fromId = -1;
  private sigSeen = 0;

  update(w: World, dt: number): void {
    const src = mapSource(w);
    const sig = mapSignature(src);
    const theme = w.map.floor.theme;
    if (!this.cur || sig !== this.sigSeen || theme !== this.cur.theme) {
      const fresh = this.state(w, sig);
      if (this.init && this.cur && this.cur !== fresh) {
        this.prev = this.cur;
        this.fadeT = 0;
      }
      this.cur = fresh;
      this.sigSeen = sig;
    }
    const n = w.node;
    if (n.id !== this.nodeId) {
      if (this.init && this.nodeId >= 0) {
        this.fromId = this.nodeId;
        this.enterT = 0;
      }
      this.nodeId = n.id;
    }
    const tg = miniCamTarget(this.cur.view.bounds, n, VIEW.w, VIEW.h, MINI_LAYOUT.cell);
    if (!this.init) {
      this.sx.set(tg.x);
      this.sy.set(tg.y);
      this.init = true;
      this.prev = null;
      this.fadeT = FADE;
      this.enterT = 9;
    }
    this.sx.target = tg.x;
    this.sy.target = tg.y;
    this.sx.update(dt);
    this.sy.update(dt);
    // snap once visually at rest (lets the HUD cache the minimap)
    settle(this.sx);
    settle(this.sy);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.fadeT = Math.min(FADE, this.fadeT + dt);
    if (this.fadeT >= FADE) this.prev = null;
    this.enterT = Math.min(9, this.enterT + dt);
  }

  /** Not recentering, no flash, cross-fade or enter flare: the map image only changes with the floor state. */
  get settled(): boolean {
    return this.init && this.flash <= 0 && this.sx.value === this.sx.target && this.sy.value === this.sy.target && this.fadeT >= FADE && this.enterT >= ENTER_FLARE;
  }

  /** Cache key of the static minimap: map state, floor look, camera (art px) and quality. */
  signature(w: World): string {
    const cam = this.camArt();
    const low = lowQuality();
    // low quality bakes the flame into the cache: it moves with the keeper's cell in a big room
    const kc = low ? keeperCell(mapSource(w)) : null;
    return `${mapSignature(mapSource(w))}|${w.map.floor.theme}|${cam.x},${cam.y}|${low ? `L${kc!.cx},${kc!.cy}` : 'H'}`;
  }

  /** Snap to the current room (new floor). */
  reset(): void {
    this.init = false;
    this.cur = null;
    this.prev = null;
    this.nodeId = -1;
    this.fromId = -1;
  }

  /** Map state for the current signature (canvases are made lazily when drawn). */
  private state(w: World, sig: number): MiniState {
    const theme = w.map.floor.theme;
    if (this.cur && this.cur.sig === sig && this.cur.theme === theme) return this.cur;
    const view = buildMapView(mapSource(w));
    return { sig, theme, view, look: lookFor(theme), rooms: null, glow: null };
  }

  private canvases(s: MiniState): { rooms: HTMLCanvasElement; glow: HTMLCanvasElement } {
    if (!s.rooms || !s.glow) {
      const out = paintRooms(s.view, s.look, MINI_LAYOUT, 'mini', { w: MINI_SIZE, h: MINI_SIZE });
      s.rooms = out.painter.toCanvas();
      s.glow = glowCanvas(out.glows, MINI_SIZE, MINI_SIZE);
    }
    return { rooms: s.rooms, glow: s.glow };
  }

  /** Map-space art px at the window's centre (whole art px at rest). */
  private camArt(): { x: number; y: number } {
    const x = MINI_LAYOUT.ox + this.sx.value * MINI_LAYOUT.cell;
    const y = MINI_LAYOUT.oy + this.sy.value * MINI_LAYOUT.cell;
    const rest = this.sx.value === this.sx.target && this.sy.value === this.sy.target;
    return rest ? { x: Math.round(x), y: Math.round(y) } : { x: Math.round(x * PX) / PX, y: Math.round(y * PX) / PX };
  }

  /** UI position of map-space art (0, 0) for a minimap drawn at (x, y). */
  private origin(x: number, y: number): { ox: number; oy: number; wx: number; wy: number } {
    const cam = this.camArt();
    const wx = x + VIEW.x * PX;
    const wy = y + VIEW.y * PX;
    return { ox: wx + (VIEW.w / 2 - cam.x) * PX, oy: wy + (VIEW.h / 2 - cam.y) * PX, wx, wy };
  }

  private clipWindow(r: Renderer, wx: number, wy: number): void {
    const d = r.dctx;
    d.beginPath();
    d.rect(wx, wy, VIEW.w * PX, VIEW.h * PX);
    d.clip();
  }

  /** The current room's plate (UI) for a minimap drawn at (x, y). */
  private curPlate(w: World, x: number, y: number): { r: PlateRect; ux: number; uy: number; node: ViewNode | undefined } {
    const { ox, oy } = this.origin(x, y);
    const n = w.node;
    const r = plateRect(n, MINI_LAYOUT);
    const node = this.cur?.view.nodes.find((v) => v.id === n.id);
    return { r, ux: ox + r.x * PX, uy: oy + r.y * PX, node };
  }

  /** `staticOnly`: without the live current-room glow / flame / transitions (for the HUD's cached layer). */
  draw(r: Renderer, w: World, x: number, y: number, mw: number, mh: number, t: number, alpha = 1, staticOnly = false): void {
    void mw;
    void mh;
    if (!this.cur) this.update(w, 0);
    const s = this.cur!;
    const look = s.look;
    const d = r.dctx;
    const { ox, oy, wx, wy } = this.origin(x, y);
    blitArt(r, artCanvas(`mmbg|${look.id}`, () => paintMiniBackground(look)), wx, wy, alpha);
    d.save();
    this.clipWindow(r, wx, wy);
    const now = this.canvases(s);
    const f = this.prev ? Math.min(1, this.fadeT / FADE) : 1;
    if (this.prev && f < 1) {
      const old = this.canvases(this.prev);
      blitArt(r, old.rooms, ox, oy, alpha);
      blitArt(r, now.rooms, ox, oy, alpha * f);
      blitGlow(r, old.glow, ox, oy, alpha * (1 - f));
      blitGlow(r, now.glow, ox, oy, alpha * f);
    } else {
      blitArt(r, now.rooms, ox, oy, alpha);
      blitGlow(r, now.glow, ox, oy, alpha);
    }
    // vignette round the current room
    const cp = this.curPlate(w, x, y);
    const vcx = cp.ux + (cp.r.w * PX) / 2;
    const vcy = cp.uy + (cp.r.h * PX) / 2;
    const vmax = look.vignette >= 0.7 ? 0.7 : 0.63;
    const vig = artCanvas(`mmvig|${vmax}`, () => paintVignette(look, VIG_W, VIG_H, VIG_W / 2, VIG_H / 2, 11, 40, vmax));
    blitArt(r, vig, Math.round((vcx - (VIG_W * PX) / 2) / PX) * PX, Math.round((vcy - (VIG_H * PX) / 2) / PX) * PX, alpha);
    if (lowQuality()) this.paintCurrent(r, w, x, y, t, alpha, true);
    else if (!staticOnly) this.paintCurrent(r, w, x, y, t, alpha, false);
    d.restore();
    blitArt(r, artCanvas('mmplate', () => paintMapPlate()), x, y, alpha);
  }

  /** The live parts over a cached minimap: breathing glow, flame, pips, transitions. */
  drawLive(r: Renderer, w: World, x: number, y: number, mw: number, mh: number, t: number, alpha = 1): void {
    void mw;
    void mh;
    if (!this.cur) return;
    const d = r.dctx;
    d.save();
    const { wx, wy } = this.origin(x, y);
    this.clipWindow(r, wx, wy);
    if (lowQuality()) this.paintPips(r, w, x, y, t, alpha);
    else this.paintCurrent(r, w, x, y, t, alpha, false);
    d.restore();
  }

  /** Back-compat name of drawLive. */
  drawPulse(r: Renderer, w: World, x: number, y: number, mw: number, mh: number, t: number, alpha = 1): void {
    this.drawLive(r, w, x, y, mw, mh, t, alpha);
  }

  /** Current room: glow, flame (badge on a special room), transitions and pips. `baked`: low quality, static. */
  private paintCurrent(r: Renderer, w: World, x: number, y: number, t: number, alpha: number, baked: boolean): void {
    const cp = this.curPlate(w, x, y);
    const pw = cp.r.w * PX;
    const ph = cp.r.h * PX;
    const cx = cp.ux + pw / 2;
    const cy = cp.uy + ph / 2;
    const breathe = baked ? 0.3 : 0.3 + 0.04 * Math.sin(t * Math.PI * 2 * 2.1);
    glow(r, cx, cy, 21, '#ffb050', breathe * alpha);
    const special = !!cp.node && sigilKey(cp.node) !== null;
    if (!baked) {
      // room enter: the plate flares, a streak runs in along the entry thread
      if (this.enterT < ENTER_FLARE) r.uiRect(cp.ux, cp.uy, pw, ph, '#ffffff', 0.5 * (1 - this.enterT / ENTER_FLARE) * alpha);
      if (this.enterT < ENTER_STREAK && this.fromId >= 0) this.paintStreak(r, w, x, y, alpha);
      // room clear: warm fill + a ring of thread light opening out
      if (this.flash > 0) {
        const k = this.flash * (save.settings.screenFlash ?? 1);
        r.uiRect(cp.ux, cp.uy, pw, ph, '#fff4c0', k * alpha);
        const g = Math.round((1 - this.flash) * 6) * PX;
        const col = this.cur!.look.thread;
        const a = this.flash * alpha;
        r.uiRect(cp.ux - g, cp.uy - g, pw + 2 * g, PX, col, a);
        r.uiRect(cp.ux - g, cp.uy + ph + g - PX, pw + 2 * g, PX, col, a);
        r.uiRect(cp.ux - g, cp.uy - g, PX, ph + 2 * g, col, a);
        r.uiRect(cp.ux + pw + g - PX, cp.uy - g, PX, ph + 2 * g, col, a);
      }
    }
    const frame = baked ? 0 : Math.floor(t * 8) % 2;
    if (!special) {
      // the flame covers the plate of the cell the keeper stands in
      const fl = artCanvas(`fl5|${frame}`, () => paintFlame(FLAME5[frame]));
      const kc = keeperCell(mapSource(w));
      const cell = plateRect({ gx: kc.cx, gy: kc.cy, cw: 1, ch: 1 }, MINI_LAYOUT);
      const { ox, oy } = this.origin(x, y);
      blitArt(r, fl, ox + (cell.x + Math.floor((cell.w - fl.width) / 2)) * PX, oy + (cell.y + Math.floor((cell.h - fl.height) / 2)) * PX, alpha);
    } else {
      const fl = artCanvas('fl3', () => paintFlame(FLAME3));
      blitArt(r, fl, cp.ux + pw - PX - Math.floor(fl.width / 2) * PX, cp.uy - 3 * PX, alpha);
    }
    this.paintPips(r, w, x, y, t, alpha);
  }

  private paintStreak(r: Renderer, w: World, x: number, y: number, alpha: number): void {
    const s = this.cur!;
    const door = s.view.doors.find((dd) => (dd.a === this.fromId && dd.b === w.node.id) || (dd.b === this.fromId && dd.a === w.node.id));
    const from = s.view.nodes.find((n) => n.id === this.fromId);
    if (!door || !from) return;
    const { ox, oy } = this.origin(x, y);
    const a = plateRect(from, MINI_LAYOUT);
    const b = plateRect(w.node, MINI_LAYOUT);
    const { pts } = threadPixels(door, MINI_LAYOUT);
    const m = pts[0];
    // straight run: centre of the old room -> through the door -> centre of the new one, along the door's axis
    const horiz = door.dir === 'E' || door.dir === 'W';
    const p0 = horiz ? { x: a.x + a.w / 2, y: m[1] } : { x: m[0], y: a.y + a.h / 2 };
    const p1 = horiz ? { x: b.x + b.w / 2, y: m[1] } : { x: m[0], y: b.y + b.h / 2 };
    const k = this.enterT / ENTER_STREAK;
    const px = p0.x + (p1.x - p0.x) * k;
    const py = p0.y + (p1.y - p0.y) * k;
    const sw = horiz ? 2 : 1;
    const sh = horiz ? 1 : 2;
    r.uiRect(ox + Math.round(px - sw / 2) * PX, oy + Math.round(py - sh / 2) * PX, sw * PX, sh * PX, '#fffef0', (1 - k * 0.5) * alpha);
  }

  private paintPips(r: Renderer, w: World, x: number, y: number, t: number, alpha: number): void {
    if (w.players.length < 2) return;
    // read live (downed changes without a map change); co-op keepers share the current room
    const party = w.players.filter((q) => q.slot !== w.local.slot).sort((a, b) => a.slot - b.slot);
    if (!party.length) return;
    const cp = this.curPlate(w, x, y);
    const n = party.length;
    const total = n * 4 + (n - 1);
    const px0 = cp.r.x + Math.floor((cp.r.w - total) / 2);
    const py0 = cp.r.y + cp.r.h - 3;
    const { ox, oy } = this.origin(x, y);
    party.forEach((q, i) => {
      if (q.downed && Math.floor(t * 4) % 2 === 1) return;
      const cv = artCanvas(`pip|${slotColor(q.slot)}|${q.downed ? 1 : 0}`, () => paintPip(slotColor(q.slot), q.downed));
      blitArt(r, cv, ox + (px0 + i * 5) * PX, oy + py0 * PX, alpha);
    });
  }
}
