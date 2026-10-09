// Full floor map (M) — 등불 성좌도: the floor's rooms as panes of night glass on
// a bezelled board, joined by threads of light, the current room burning
// brightest. Header: floor medallion, stage + floor name, stage beads (x-1..x-3,
// the boss bead horned). Side column: a record plaque (visited / cleared, a
// lantern bar, seed) and the legend. Opening, the lantern light spreads out
// from the current room. Static layers are cached per map state (map-art.ts);
// only the flame, glows, motes and pulses are drawn live. Pure UI.

import type { Scene } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_W } from '../engine/renderer';
import type { GameScene } from './game-scene';
import { input } from '../engine/input';
import { sfx } from '../audio/audio';
import { save } from '../engine/save';
import { clamp, ease, mixColor } from '../engine/math';
import { slotColor } from '../game/coopfx';
import { C, PX, splitFloorName } from './theme';
import { dimScreen, divider, frame, glow, keyHintRow } from './frame';
import { appear } from './anim';
import { actionLabel } from './keys';
import { touchUiActive } from './touch-mode';
import { UiLayer } from './layer-cache';
import { blitArt } from './hud-gear';
import { lookFor, type MapLook } from './map-look';
import { MAP_PANEL, boardLayout, buildMapView, h32, keeperCell, legendLayout, mapPanelRect, mapSignature, type BoardLayout, type LegendState, type MapView } from './map-view';
import {
  BOARD_IN_H, BOARD_IN_W, FLAME3, FLAME5, FLAME7, FLAME_PAL, HATCH5, INK, UNFOUND, cellCentre, glyphPal, paintBoardStatic,
  paintCompass, paintEmblemMedallion, paintFlame, paintPip, paintRoomPlate, paintRooms, paintSigil, paintStageBead, paintVignette, plateColor,
  plateRect, sigilKey, sigilPal, stampMask, threadPixels, type BeadState, type SigilKey,
} from './map-art';
import { artCanvas, blitGlow, glowCanvas, lowQuality, mapSource } from './minimap';
import { PixelPainter } from '../engine/painter';

// ---- layout (UI units, relative to the panel's top-left)
const W = MAP_PANEL.w;
const H = MAP_PANEL.h;
const BOARD_X = 16;
const BOARD_Y = 64;
/** board interior: art (4, 4) of the bezel */
const IN_X = BOARD_X + 8;
const IN_Y = BOARD_Y + 8;
const IN_W = BOARD_IN_W * PX;
const IN_H = BOARD_IN_H * PX;
const SIDE_X = 468;
const SIDE_W = 172;
const PLAQUE_H = 78;
const LEGEND_Y = BOARD_Y + 86;
const LEGEND_H = 230;
const CLOSE_T = 0.14;
const LIVE_UNTIL = 0.42;

interface Board {
  key: string;
  view: MapView;
  look: MapLook;
  L: BoardLayout;
  rooms: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  vignette: HTMLCanvasElement;
  /** current room plate centre (UI, relative to the board interior) */
  cx: number;
  cy: number;
  /** reveal radius reaching every known plate (UI) */
  far: number;
  /** visited plate centres for the reveal front (UI, interior-relative) */
  lit: { x: number; y: number; r: number; color: string }[];
}

/** Stage x-y label of a view (or the floor number of a legacy run). */
function stageLabel(v: MapView, floorName: string): string {
  return v.staged ? `${v.floorIndex}-${v.stage}` : splitFloorName(floorName)[0];
}

export class MapOverlay implements Scene {
  transparent = true;
  touchBack = 'close' as const;
  private game: GameScene;
  private t = 0;
  private closing = -1;
  private board: Board | null = null;
  private readonly lyText = new UiLayer();

  constructor(game: GameScene) {
    this.game = game;
  }

  enter(): void {
    sfx('ui_open', { vol: 0.5 });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.closing >= 0) {
      this.closing += dt;
      if (this.closing > CLOSE_T) this.game.closeOverlay(this);
      return;
    }
    if (input.pressed('map') || input.pressed('cancel') || input.pressed('pause') || input.pressed('inventory')) {
      sfx('ui_close', { vol: 0.5 });
      this.closing = 0;
    }
  }

  /** The board's cached layers for the current map state (rebuilt in place when it changes). */
  private boardFor(): Board {
    const w = this.game.world;
    const src = mapSource(w);
    const key = `${mapSignature(src)}|${w.map.floor.theme}|${w.run.stage}`;
    if (this.board && this.board.key === key) return this.board;
    const view = buildMapView(src);
    const look = lookFor(view.themeId);
    const L = boardLayout(view.bounds, BOARD_IN_W - 12, BOARD_IN_H - 12, { x: 6, y: 6 });
    const out = paintRooms(view, look, L, 'board', { w: BOARD_IN_W, h: BOARD_IN_H });
    const cur = view.nodes.find((n) => n.id === view.curId) ?? view.nodes[0];
    const cr = plateRect(cur, L);
    const ccx = cr.x + cr.w / 2;
    const ccy = cr.y + cr.h / 2;
    const diag = Math.hypot(BOARD_IN_W, BOARD_IN_H);
    const vig = paintVignette(look, BOARD_IN_W, BOARD_IN_H, ccx, ccy, 2.5 * L.cell, Math.max(9 * L.cell, 0.6 * diag));
    let far = 0;
    const lit: Board['lit'] = [];
    for (const n of view.nodes) {
      const r = plateRect(n, L);
      for (const [px, py] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) far = Math.max(far, Math.hypot(px - ccx, py - ccy));
      if (n.state === 'visited' || n.state === 'uncleared') {
        const k = sigilKey(n);
        lit.push({ x: (r.x + r.w / 2) * PX, y: (r.y + r.h / 2) * PX, r: Math.max(r.w, r.h) * PX, color: n.state === 'uncleared' ? '#ff4050' : k ? plateColor(k, look) : look.light });
      }
    }
    this.board = {
      key, view, look, L,
      rooms: out.painter.toCanvas(),
      glow: glowCanvas(out.glows, BOARD_IN_W, BOARD_IN_H),
      vignette: vig.toCanvas(),
      cx: ccx * PX,
      cy: ccy * PX,
      far: (far + L.cell) * PX,
      lit,
    };
    return this.board;
  }

  draw(r: Renderer): void {
    r.beginUI();
    const w = this.game.world;
    const closing = this.closing >= 0;
    const k = closing ? 1 - clamp(this.closing / CLOSE_T, 0, 1) : appear(this.t, 0.22);
    dimScreen(r, 0.78 * k);
    const panel = mapPanelRect(UI_W);
    const x = panel.x;
    const y = Math.round(panel.y + (closing ? 6 * (1 - k) : (1 - k) * 10));
    frame(r, x, y, W, H, 'ornate', { alpha: k });
    const b = this.boardFor();
    const low = lowQuality();
    // ---- live glows of the header (medallion, current stage bead)
    glow(r, x + 18 + 16, y + 12 + 16, 26, b.look.light, 0.22 * k);
    if (b.view.staged) {
      const i = b.view.stage - 1;
      const pulse = low ? 0 : 0.08 * Math.sin(this.t * Math.PI * 2);
      glow(r, x + W - 206 + i * 30, y + 26, 14, '#ffb050', (0.35 + pulse) * k);
    }
    // ---- board
    this.drawBoard(r, b, x, y, k, low);
    // ---- header + side column: live while they animate, then one cached blit
    const touch = touchUiActive();
    const pad = input.aimMode === 'pad';
    const keyLabel = touch ? '' : actionLabel(input.bindings, 'map', pad);
    if (this.t < LIVE_UNTIL || closing) {
      this.drawHeader(r, b, w.floor.name, w.floor.subtitle, x, y, k, keyLabel, pad);
      const s = appear(this.t, 0.18, 0.12);
      const prog = appear(this.t, 0.3, 0.12, ease.outQuad);
      this.drawSide(r, b, x + (1 - s) * 6, y, k * s, prog);
    } else {
      const v = b.view;
      const key = [w.floor.name, v.stage, v.staged ? 1 : 0, v.seed, v.counts.visited, v.counts.total, v.counts.cleared, v.states.join(','),
        v.legend.map((l) => `${l.key}${l.found ? 1 : 0}`).join(','), v.party.map((q) => q.slot).join(','), keyLabel, pad ? 1 : 0, UI_W, b.look.id, b.key].join('|');
      this.lyText.draw(r, key, 0, 0, x, y, W, H, k, () => {
        this.drawHeader(r, b, w.floor.name, w.floor.subtitle, x, y, 1, keyLabel, pad);
        this.drawSide(r, b, x, y, 1, 1);
      });
    }
  }

  // ================================================================ board
  private drawBoard(r: Renderer, b: Board, x: number, y: number, k: number, low: boolean): void {
    const d = r.dctx;
    const look = b.look;
    blitArt(r, artCanvas(`mapboard|${look.id}`, () => paintBoardStatic(look)), x + BOARD_X, y + BOARD_Y, k);
    const ix = x + IN_X;
    const iy = y + IN_Y;
    const t = this.t;
    d.save();
    d.beginPath();
    d.rect(ix, iy, IN_W, IN_H);
    d.clip();
    // light spreads from the current room (low quality: a short fade)
    const spread = low ? 1 : appear(t, 0.45, 0.08, ease.outCubic);
    const R = spread * b.far;
    const revealing = !low && spread < 1;
    const fadeA = low ? appear(t, 0.2) : 1;
    if (revealing) {
      d.save();
      d.beginPath();
      d.arc(ix + b.cx, iy + b.cy, Math.max(0.5, R), 0, Math.PI * 2);
      d.clip();
    }
    blitArt(r, b.rooms, ix, iy, k * fadeA);
    blitGlow(r, b.glow, ix, iy, k * fadeA);
    if (revealing) d.restore();
    blitArt(r, b.vignette, ix, iy, k);
    if (revealing && R > 1) {
      d.globalAlpha = 0.35 * k;
      d.strokeStyle = look.light;
      d.lineWidth = 2;
      d.beginPath();
      d.arc(ix + b.cx, iy + b.cy, R, 0, Math.PI * 2);
      d.stroke();
      d.globalAlpha = 1;
      const cellU = b.L.cell * PX;
      for (const p of b.lit) {
        const dist = Math.hypot(p.x - b.cx, p.y - b.cy);
        const lead = R - dist;
        if (lead >= 0 && lead < cellU) glow(r, ix + p.x, iy + p.y, p.r, p.color, 0.6 * (1 - lead / cellU) * k);
      }
    }
    if (!low) this.drawAmbient(r, b, ix, iy, k);
    this.drawCurrent(r, b, ix, iy, k, low);
    if (!low) this.drawPulses(r, b, ix, iy, k);
    blitArt(r, artCanvas('mapglint', paintGlint), ix + 4, iy + 4, k);
    d.restore();
  }

  /** The current room: breathing glow, flame (badge on a special room), sparks, teammate pips. */
  private drawCurrent(r: Renderer, b: Board, ix: number, iy: number, k: number, low: boolean): void {
    const t = this.t;
    const v = b.view;
    const L = b.L;
    const cur = v.nodes.find((n) => n.id === v.curId);
    if (!cur) return;
    const pr = plateRect(cur, L);
    const cellU = L.cell * PX;
    const plateU = Math.max(pr.w, pr.h) * PX;
    const breathe = low ? 0 : 0.04 * Math.sin(t * Math.PI * 2 * 2.1);
    glow(r, ix + b.cx, iy + b.cy, 3.2 * cellU, '#ff9a3a', 0.16 * k);
    glow(r, ix + b.cx, iy + b.cy, 1.4 * plateU, '#ffb050', (0.3 + breathe) * k);
    if (!low && t < 0.7) {
      const wa = t < 0.4 ? 0.5 - 0.2 * (t / 0.4) : Math.max(0, 0.3 - (t - 0.4) * 1);
      glow(r, ix + b.cx, iy + b.cy, 3 * cellU, '#ffb050', wa * k);
    }
    const key = sigilKey(cur);
    const big = Math.min(pr.w, pr.h) >= 13;
    const frameNo = low ? 0 : Math.floor(t * 8) % 3;
    if (!key) {
      const mask = big ? FLAME7[frameNo] : FLAME5[frameNo % 2];
      const fl = artCanvas(`flame|${big ? 7 : 5}|${frameNo % (big ? 3 : 2)}`, () => paintFlame(mask));
      const kc = keeperCell(mapSource(this.game.world));
      const c = cellCentre(kc.cx, kc.cy, L);
      const bob = !low && Math.sin(t * Math.PI * 2 * 1.2) > 0 ? 1 : 0;
      const fx = c.x + 1 - Math.ceil(fl.width / 2);
      const fy = c.y + 1 - Math.ceil(fl.height / 2) - bob;
      blitArt(r, fl, ix + fx * PX, iy + fy * PX, k);
      if (!low) {
        const sx = ix + (c.x + 1) * PX;
        const top = iy + pr.y * PX;
        for (let i = 0; i < 3; i++) {
          const ph = (t * 0.9 + i / 3) % 1;
          const sway = Math.sin(t * 3 + i * 2) > 0 ? PX : 0;
          r.uiRect(sx + (i - 1) * 4 + sway - 1, Math.round(top - ph * 16), PX, PX, i === 1 ? '#ffd060' : '#ff8a30', (1 - ph) * 0.9 * k);
        }
      }
    } else {
      const fl = artCanvas(`flame|5|${frameNo % 2}`, () => paintFlame(FLAME5[frameNo % 2]));
      const fx = pr.x + pr.w - 1 + 2 - Math.floor(fl.width / 2);
      const fy = pr.y - 2 - Math.floor(fl.height / 2);
      blitArt(r, fl, ix + fx * PX, iy + fy * PX, k);
    }
    // teammates in this room
    const party = this.game.world.players.filter((q) => q.slot !== this.game.world.local.slot).sort((a, c) => a.slot - c.slot);
    if (party.length) {
      const total = party.length * 4 + (party.length - 1);
      const px0 = pr.x + Math.floor((pr.w - total) / 2);
      const py0 = L.gap >= 5 ? pr.y + pr.h + 1 : pr.y + pr.h - 5;
      party.forEach((q, i) => {
        if (q.downed && Math.floor(t * 4) % 2 === 1) return;
        const cv = artCanvas(`pip|${slotColor(q.slot)}|${q.downed ? 1 : 0}`, () => paintPip(slotColor(q.slot), q.downed));
        blitArt(r, cv, ix + (px0 + i * 5) * PX, iy + py0 * PX, k);
      });
    }
  }

  /** Every 2.4 s a light dot runs out along the lit threads from the current room (two steps). */
  private drawPulses(r: Renderer, b: Board, ix: number, iy: number, k: number): void {
    const ph = this.t % 2.4;
    if (ph >= 0.3) return;
    const step = ph < 0.15 ? 0 : 1;
    const f = (ph % 0.15) / 0.15;
    const v = b.view;
    let front = new Set([v.curId]);
    const seen = new Set([v.curId]);
    for (let s = 0; s <= step; s++) {
      const next = new Set<number>();
      for (const d of v.doors) {
        if (d.type !== 'lit') continue;
        const fromA = front.has(d.a) && !seen.has(d.b);
        const fromB = front.has(d.b) && !seen.has(d.a);
        if (!fromA && !fromB) continue;
        next.add(fromA ? d.b : d.a);
        if (s !== step) continue;
        const { pts, horizontal } = threadPixels(d, b.L);
        const seq = fromA ? pts : [...pts].reverse();
        const i = Math.min(seq.length - 1, Math.floor(f * seq.length));
        const [px, py] = seq[i];
        r.uiRect(ix + px * PX - (horizontal ? PX / 2 : 0), iy + py * PX - (horizontal ? 0 : PX / 2), horizontal ? 2 * PX : PX, horizontal ? PX : 2 * PX, mixColor(b.look.thread, '#ffffff', 0.6), (1 - f * 0.4) * k);
      }
      for (const n of next) seen.add(n);
      front = next;
    }
  }

  /** Floor motes, fog wisps and per-floor ambience over the board (cosmetic, UI time only). */
  private drawAmbient(r: Renderer, b: Board, ix: number, iy: number, k: number): void {
    const t = this.t;
    const look = b.look;
    const v = b.view;
    const BW = BOARD_IN_W;
    const BH = BOARD_IN_H;
    // fog wisps
    const d = r.dctx;
    for (let i = 0; i < 3; i++) {
      const h = h32(v.floorIndex, v.stage, 900 + i);
      const span = IN_W + 240;
      const wx = ((h % span) + t * 6 * (i % 2 ? -1 : 1)) % span;
      const cx = ix - 120 + (wx < 0 ? wx + span : wx);
      const cy = iy + 40 + ((h >>> 8) % Math.max(1, IN_H - 80));
      d.save();
      d.translate(cx, cy);
      d.scale(2.4, 1);
      glow(r, 0, 0, 50, look.light, 0.06 * k);
      d.restore();
    }
    if (look.motes === 'ember') for (let i = 0; i < 4; i++) glow(r, ix + IN_W * (0.125 + i * 0.25), iy + IN_H, 70, '#ff6a20', 0.07 * k);
    if (look.motes === 'bubble') {
      for (let yy = 0; yy < IN_H; yy += 24) r.uiRect(ix, iy + Math.round((yy + t * 4) % IN_H), IN_W, PX / 2, look.light, 0.05 * k);
    }
    const n = Math.round(48 * clamp(save.settings.particles, 0, 1));
    const curX = b.cx / PX;
    const curY = b.cy / PX;
    for (let i = 0; i < n; i++) {
      const h = h32(v.floorIndex, v.stage, i);
      const x0 = h % BW;
      const y0 = (h >>> 9) % BH;
      const ph = ((h >>> 18) % 628) / 100;
      let mx = x0;
      let my = y0;
      let a = 0.35 + ((h >>> 4) % 30) / 100;
      switch (look.motes) {
        case 'dust':
          my = y0 + t * 2.2;
          mx = x0 + Math.sin(t * 0.6 * Math.PI * 2 * 0.25 + ph) * 1.5;
          break;
        case 'spore':
          my = y0 - t * 3;
          mx = x0 + Math.sin(t * 0.8 + ph) * 3;
          break;
        case 'ember':
          my = y0 - t * 6;
          mx = x0 + Math.sin(t * 1.3 + ph) * 1.5;
          a *= Math.sin(t * 9 + ph * 3) > -0.2 ? 1 : 0.3;
          break;
        case 'snow':
          my = y0 + t * 4;
          mx = x0 + t * 1.5 + Math.sin(t * 0.9 + ph) * 2;
          break;
        case 'spark': {
          const f = (t * 0.12 + ph / 6.28) % 1;
          mx = x0 + (curX - x0) * f * 0.85;
          my = y0 + (curY - y0) * f * 0.85;
          a *= 1 - f;
          break;
        }
        case 'bubble':
          my = y0 - t * 5;
          mx = x0 + Math.sin(t * 1.1 + ph) * 1;
          break;
        case 'tick': {
          const s = Math.floor(t + ph);
          mx = x0 + ((s * 7 + i) % 5) - 2;
          my = y0 + ((s * 3) % 4) - 1.5;
          break;
        }
        default:
          mx = x0 + t * 1.2;
          my = y0 + Math.sin(t * 0.5 + ph) * 2;
      }
      mx = ((mx % BW) + BW) % BW;
      my = ((my % BH) + BH) % BH;
      r.uiRect(ix + Math.floor(mx) * PX, iy + Math.floor(my) * PX, PX, PX, look.mote, a * k);
    }
  }

  // ================================================================ header
  private drawHeader(r: Renderer, b: Board, floorName: string, subtitle: string, x: number, y: number, a: number, keyLabel: string, pad: boolean): void {
    const v = b.view;
    const look = b.look;
    blitArt(r, artCanvas(`medal|${look.id}`, () => paintEmblemMedallion(look)), x + 18, y + 12, a);
    const no = stageLabel(v, floorName);
    const name = splitFloorName(floorName)[1];
    r.uiText(no, x + 58, y + 18, { size: 12, color: C.gold, alpha: a });
    r.uiText(name, x + 58 + r.measureText(no, 12) + 8, y + 12, { size: 24, bold: true, color: C.text, outline: C.ink, alpha: a });
    r.uiText(subtitle, x + 58, y + 42, { size: 10, font: 'small', color: C.textFaint, alpha: a });
    if (v.staged) {
      for (let i = 0; i < 3; i++) {
        const st: BeadState = i + 1 < v.stage ? 'past' : i + 1 === v.stage ? 'current' : 'future';
        const cx = x + W - 206 + i * 30;
        const cy = y + 26;
        if (i < 2) r.uiRect(cx + 10, cy - 1, 10, 2, i + 1 < v.stage ? look.thread : '#2a2236', a);
        blitArt(r, artCanvas(`bead|${look.id}|${st}|${i === 2 ? 1 : 0}`, () => paintStageBead(look, st, i === 2)), cx - 8, cy - 9, a);
        const col = st === 'current' ? C.goldHi : st === 'past' ? C.textDim : C.textMute;
        r.uiText(`${v.floorIndex}-${i + 1}`, cx, y + 40, { size: 10, font: 'small', align: 'center', color: col, alpha: a });
      }
    }
    if (keyLabel) keyHintRow(r, [[keyLabel, '닫기']], x + W - 50, y + 24, { alpha: a * 0.85, pad });
    divider(r, x + W / 2, y + 58, W - 32, look.metal[1], 0.6 * a);
  }

  // ================================================================ side column
  private drawSide(r: Renderer, b: Board, x: number, y: number, a: number, prog: number): void {
    if (a <= 0.01) return;
    const v = b.view;
    const look = b.look;
    const sx = x + SIDE_X;
    const by = y + BOARD_Y;
    // ---- record plaque
    frame(r, sx, by, SIDE_W, PLAQUE_H, 'panel', { alpha: a });
    r.uiRect(sx + 6, by + 4, SIDE_W - 12, PX, look.metal[1], 0.45 * a);
    const c = v.counts;
    const row = (label: string, n: number, total: number | null, yy: number) => {
      r.uiText(label, sx + 12, yy + 2, { size: 10, font: 'small', color: C.textFaint, alpha: a });
      r.uiText(String(Math.round(n * prog)), sx + 72, yy, { size: 12, bold: true, align: 'right', color: C.text, alpha: a });
      if (total !== null) r.uiText(`/ ${total}`, sx + 76, yy + 2, { size: 10, font: 'small', color: C.textFaint, alpha: a });
    };
    row('방문', c.visited, c.total, by + 10);
    row('정화', c.cleared, null, by + 26);
    // lantern bar: one segment per room (secret rooms aside)
    const segs = Math.max(1, c.total);
    const bx = sx + 12;
    const bw = 148;
    const gy = by + 44;
    r.uiRect(bx - 2, gy - 2, bw + 4, 12, C.ink, a);
    const nodes = this.game.world.map.nodes.filter((n) => n.kind !== 'secret');
    const order = [...nodes].sort((p, q) => Number(q.visited) - Number(p.visited) || Number(q.cleared) - Number(p.cleared));
    const lit = Math.round(prog * segs);
    for (let i = 0; i < segs; i++) {
      const x0 = bx + Math.round((i * (bw + 2)) / segs);
      const x1 = bx + Math.round(((i + 1) * (bw + 2)) / segs) - 2;
      const n = order[i];
      const col = !n || !n.visited || i >= lit ? '#2a2236' : n.cleared ? look.thread : '#e05060';
      r.uiRect(x0, gy, Math.max(1, x1 - x0), 8, col, a);
      if (col !== '#2a2236') r.uiRect(x0, gy, Math.max(1, x1 - x0), 2, mixColor(col, '#ffffff', 0.4), a);
    }
    r.uiText(`시드 ${v.seed}`, sx + 12, by + 60, { size: 10, font: 'small', color: C.textMute, alpha: a });
    // ---- legend
    const ly = y + LEGEND_Y;
    frame(r, sx, ly, SIDE_W, LEGEND_H, 'panel', { alpha: a });
    r.uiText('범례', sx + 12, ly + 10, { size: 10, font: 'small', color: C.gold, alpha: a });
    const STATE_LABEL: Record<LegendState, string> = { current: '현재 위치', visited: '방문', uncleared: '정화 전', exit: '출구', seen: '발견' };
    // grid order: current, visited / third, seen (seen last when there are 4)
    const states = v.states.length === 4 ? v.states : [v.states[0], v.states[1], v.states[2]];
    states.forEach((s, i) => {
      const gx = sx + 12 + (i % 2) * 74;
      const gyy = ly + 28 + Math.floor(i / 2) * 18;
      blitArt(r, artCanvas(`swatch|${look.id}|${s}`, () => paintSwatch(look, s)), gx, gyy - 3, a);
      r.uiText(STATE_LABEL[s], gx + 24, gyy, { size: 10, font: 'small', color: s === 'current' ? C.text : C.textDim, alpha: a });
    });
    r.uiRect(sx + 10, ly + 68, SIDE_W - 20, 2, '#2a2236', a);
    const lay = legendLayout(v.legend);
    lay.rows.forEach((row, i) => {
      const col = Math.floor(i / lay.perCol);
      const ri = i % lay.perCol;
      const rx = sx + 12 + col * 74;
      const ry = ly + 76 + ri * 15;
      if (row.key === 'party') {
        v.party.forEach((q, j) => {
          const cv = artCanvas(`pip|${slotColor(q.slot)}|0`, () => paintPip(slotColor(q.slot), false));
          blitArt(r, cv, rx + j * 6, ry + 1, a);
        });
      } else {
        const key = row.key as SigilKey;
        const pal = row.found ? glyphPal(key, look) : UNFOUND;
        const cv = artCanvas(`lsig|${look.id}|${key}|${row.found ? 1 : 0}`, () => {
          const p = new PixelPainter(9, 9);
          paintSigil(p, key, 1, 1, 7, pal, true);
          return p;
        });
        blitArt(r, cv, rx - 2, ry - 4, a * (row.found ? 1 : 0.6));
      }
      const lx = row.key === 'party' ? rx + Math.max(18, v.party.length * 6 + 4) : rx + 18;
      r.uiText(row.label, lx, ry, { size: 10, font: 'small', color: row.found ? C.text : C.textMute, alpha: a });
    });
    // a compass rose in the free space under a short legend
    const rowsEnd = ly + 76 + Math.max(0, lay.perCol - 1) * 15 + 12;
    const cv = artCanvas(`compass|${look.id}`, () => paintCompass(look));
    const cy = ly + LEGEND_H - 8 - cv.height * PX;
    if (rowsEnd + 6 <= cy) blitArt(r, cv, sx + Math.round((SIDE_W - cv.width * PX) / 2), cy, a * 0.8);
  }
}

/** A 10x8 art legend swatch: a tiny plate of each state. */
function paintSwatch(look: MapLook, s: LegendState): PixelPainter {
  const p = new PixelPainter(10, 8);
  if (s === 'current') {
    paintRoomPlate(p, 0, 0, 10, 8, { state: 'current', special: null, look, lod: 'board', centre: false });
    stampMask(p, FLAME3, 4, 2, FLAME_PAL, INK);
  } else if (s === 'exit') {
    paintRoomPlate(p, 0, 0, 10, 8, { state: 'visited', special: look.thread, look, lod: 'mini' });
    stampMask(p, HATCH5, 3, 1, sigilPal(look.thread) as unknown as Record<string, string>, INK);
  } else if (s === 'uncleared') {
    paintRoomPlate(p, 0, 0, 10, 8, { state: 'uncleared', special: null, look, lod: 'board', cx: 4, cy: 3 });
  } else if (s === 'visited') {
    paintRoomPlate(p, 0, 0, 10, 8, { state: 'visited', special: null, look, lod: 'board', motif: false, cx: 4, cy: 3 });
  } else {
    paintRoomPlate(p, 0, 0, 10, 8, { state: 'seen', special: null, look, lod: 'board', cx: 4, cy: 3 });
  }
  return p;
}

/** Glass glint: two faint 1 px diagonals near the board's top-left inner corner. */
function paintGlint(): PixelPainter {
  const p = new PixelPainter(40, 40);
  for (let i = 0; i < 26; i++) p.px(4 + i, 30 - i, '#ffffff12');
  for (let i = 0; i < 16; i++) p.px(10 + i, 34 - i, '#ffffff0d');
  return p;
}

