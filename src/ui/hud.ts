// In-game HUD (UI space 768x432), laid out as the keeper's own gear:
//   top-left   the life gauge (hud-fire.ts): one cell of fire per heart in a slim
//              brass frame, no numbers; soul hearts as translucent blue fire over
//              it, one-hit wards as light-grey plates; temporary buffs hang below
//   bottom-left  the PixelLab release lantern (ember gauge: ember rises in its
//              glass, glows with the release key beside it when 등불 해방 is
//              ready, shutters while it recovers); hidden with touch controls,
//              which have their own release button
//   top-right  minimap · floor name · objective / seed · purse (coins / bombs / keys)
//   bottom-right  equipment slots (no backing): secondary + swap key, primary
//              (rarity rim + gem), active item + charge wick, potion
//   bottom     boss bar with name and damage trail (center)
// plus banners, floor / boss cards, room-clear feedback and first-run hints.
// Speedrun mode adds a timer plate in the left column under the life gauge and
// the buff row (run clock, the running floor segment or boss fight, the live
// delta to this device's best) and a split card under it for every floor boss.
// The UI space widens with the screen (UI_W = 2 * VIEW_W); corner elements are
// anchored to the edges of the device safe area (`Renderer.uiSafe`). With the
// touch controls shown, the weapon / active / potion live on their buttons, so
// the equipment slots and the release lantern are hidden (the life gauge stays).

import type { SplitNotice } from './speedrun-feed';
import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { World } from '../game/world';
import { Actives, Potions, RARITY_COLOR, Weapons } from '../game/defs';
import { clamp, ease, mixColor } from '../engine/math';
import { animFrame } from '../engine/sprites';
import { save } from '../engine/save';
import { storyObjective } from '../game/story';
import { potionSpriteFor } from '../game/pickups';
import { EMBER_MAX } from '../game/player';
import { input } from '../engine/input';
import { ChangeTracker, envelope, follow, heartbeat, popScale } from './anim';
import { MinimapView } from './minimap';
import { clockText, clockWidth, deltaColor, drawBanners, drawBossIntro, drawFloorCard, drawRoomClear, drawSplitCard, formatDelta } from './cards';
import { HintSystem } from './hints';
import { fitScale, frame, gauge, glow, keycap, spriteCentered } from './frame';
import { blitArt, drawLantern, lanternSpec, plateCanvas, rarityAccent } from './hud-gear';
import { FireGaugeFx, drawFireGauge, fireGaugeLayout } from './hud-fire';
import { C, PX, formatSplit, splitFloorName } from './theme';
import { ticksToMs, type SpeedrunRun } from '../game/speedrun';
import { lastFloorIndex } from '../game/defs';
import { speedrunStore } from '../engine/speedrun-store';
import { actionLabel } from './keys';
import { touchUiActive } from './touch-mode';
import { ItemTooltip } from './item-tooltip';
import { UiLayer } from './layer-cache';
import { ArtifactBar } from './artifact-bar';
import { CoopHud } from './coop';

/** HUD minimap size and margin (UI units). */
export const MINIMAP_W = 124;
export const MINIMAP_H = 86;
const MINIMAP_MARGIN = 8;

/**
 * UI-space rect of the minimap block (map + floor name + seed lines) for a UI
 * space `uiW` wide with the given safe-area insets (used by the touch layout).
 */
export function minimapBlockRect(uiW: number, safe: { l: number; r: number; t: number; b: number }): { x: number; y: number; w: number; h: number } {
  return { x: uiW - safe.r - MINIMAP_W - MINIMAP_MARGIN, y: safe.t + MINIMAP_MARGIN, w: MINIMAP_W, h: MINIMAP_H + 30 };
}

// ---- life gauge and release lantern (UI units, from the safe-area corners; even = on the art grid)
/** the life gauge's top-left */
const GAUGE_X = 8;
const GAUGE_Y = 8;
/** the release lantern stands in the bottom-left corner (desktop; touch has its own release button) */
const LANTERN_X = 8;
const LANTERN_BOTTOM = 10;

// ---- speedrun panel (left column, UI units inside the safe area)
/** timer plate: fixed y under the life gauge (8..32) and the buff row (40..69), so it never jumps */
const SR_X = GAUGE_X;
const SR_Y = 76;
const SR_W = 164;
const SR_H = 46;
/** a split card shows at least this long (s); longer while the online answer is still coming */
const SPLIT_LIFE = 4.2;
const SPLIT_MAX = 9;

/** A floor split as the HUD keeps it: the notice (online fields fill in later) and its card's clock. */
export interface SplitEntry {
  n: SplitNotice;
  /** HUD time since the split (s) */
  t: number;
  /** best clear time of the floor before this split (ms), for the delta */
  cmp?: number;
  /** card age when the online answer arrived (-1: still pending) */
  settled: number;
  /** card height shown / its layout height (UI; eased when an online line arrives) */
  h: number;
  hTarget: number;
}

/** Purse (coins / bombs / keys) row under the minimap block: its height (UI). */
const PURSE_H = 20;

// ---- gear rack (bottom-right, desktop)
const RACK_PAD = 6;
const RACK_H = 56;
const MAIN_S = 44;
const SUB_S = 32;
const ACT_S = 36;
const POT_S = 30;

interface RackLayout {
  x: number;
  y: number;
  w: number;
  main: { x: number; y: number };
  sub: { x: number; y: number };
  act: { x: number; y: number } | null;
  pot: { x: number; y: number } | null;
  /** x of the divider between the weapons and the active / potion (or -1) */
  div: number;
}

/** A counter is animating (pop / floating delta) */
function counterBusy(tr: ChangeTracker): boolean {
  return tr.pop > 0 || (tr.age < 1.1 && tr.delta !== 0);
}

export class Hud {
  /**
   * Speedrun: every split of this run, in order (HUD-local, aged with the HUD's own dt, so a
   * card waits while a menu is open); the newest shows as a card for a few seconds. The game
   * over screen reads them for its per-floor table.
   */
  readonly splitNotices: SplitEntry[] = [];
  /** speedrun: this device's best clear time per floor (ms, null = none), read once per floor */
  private srBest = new Map<number, number | null>();
  private readonly lySr = new UiLayer();
  /** speedrun plate inputs of this frame (for the cached paint) */
  private srLabel = '';
  private srTarget = 0;
  private srBoss = false;
  /** speedrun panel opacity: it fades while a keeper, an enemy or an enemy shot is under it */
  private srFade = 1;
  private srFadeT = 0;

  /** Speedrun: a floor boss fell (GameScene.onBossSplit). */
  speedrunSplit(n: SplitNotice): void {
    // the comparison: the best before this split (a practice run is not in the store)
    const cmp = n.ranked ? n.previousBestMs : this.bestMs(n.floor) ?? undefined;
    this.splitNotices.push({ n, t: 0, cmp, settled: n.online === 'pending' ? -1 : 0, h: 0, hTarget: 0 });
    this.srBest.clear();
  }

  /** This device's best clear time of floors 1..`floor` (ms), or null. */
  private bestMs(floor: number): number | null {
    let v = this.srBest.get(floor);
    if (v === undefined) {
      v = speedrunStore.best(floor)?.splitMs ?? null;
      this.srBest.set(floor, v);
    }
    return v;
  }

  /** How long a split card stays (s): its answer from the online board gets a moment of its own. */
  private splitLife(e: SplitEntry): number {
    return Math.min(SPLIT_MAX, Math.max(SPLIT_LIFE, e.settled < 0 ? Infinity : e.settled + 1.8));
  }

  /** The split card on screen now (the newest one, while it lasts). */
  private activeSplit(): SplitEntry | null {
    const e = this.splitNotices[this.splitNotices.length - 1];
    return e && e.t < this.splitLife(e) ? e : null;
  }

  t = 0;
  private coins = new ChangeTracker(0, 2.5);
  private bombs = new ChangeTracker(0, 2.5);
  private keys = new ChangeTracker(0, 2.5);
  private emberShown = 0;
  private emberFull = false;
  private emberFlash = 0;
  private releaseFlash = 0;
  private activeReady = false;
  private activeFlash = 0;
  private activeId: string | null = null;
  private activePop = 0;
  private activeUse = 0;
  private weaponId = '';
  private weapon2Id: string | null = null;
  private weaponPop = 0;
  /** 1 -> 0 while the two weapon slots trade places after a swap */
  private swapAnim = 0;
  private potionId: string | null = null;
  private potionPop = 0;
  private bossShown = 0;
  private bossFrac = 1;
  private bossTrail = 1;
  private bossHitT = 9;
  private bossFlash = 0;
  private bossName = '';
  private bossTitle = '';
  private buffMax = new Map<string, number>();
  private buffSeen = new Map<string, number>();
  private lastNode = -1;
  private lastCleared = true;
  private lastFloor = -1;
  private clearT = -1;
  readonly minimap = new MinimapView();
  readonly hints = new HintSystem();
  /** collected artifacts / blessings row + power readout + proc pops */
  readonly artifacts = new ArtifactBar();
  /** preview card of the item the keeper stands next to */
  readonly tooltip = new ItemTooltip();
  /** online co-op: teammate panels, name tags, off-screen arrows, toasts */
  readonly coop = new CoopHud();
  /** HUD area inside the safe insets (UI units); corner elements are drawn translated to its top-left */
  private W = UI_W;
  private H = UI_H;
  // ---- cached layers (static HUD parts are painted once and blitted until their inputs change)
  private readonly lyPurse = new UiLayer();
  private readonly lyMap = new UiLayer();
  private readonly lySlots = new UiLayer();
  /** life gauge: turns losses / gains into fire going out / flaring up */
  private fire = new FireGaugeFx();
  /** left edge of the gear rack this frame (UI units inside the safe area; W when hidden) */
  private rackLeft = UI_W;
  /** world / renderer of the current draw call (for the prebound paint callbacks) */
  private cw: World | null = null;
  private cr: Renderer | null = null;
  private readonly paintPurse = () => this.drawConsumables(this.cr!, this.cw!, 1);
  private readonly paintMap = () => this.drawMinimap(this.cr!, this.cw!, 1, true);
  private readonly paintSlots = () => this.drawRack(this.cr!, this.cw!, 1, false);
  private readonly lyBoss = new UiLayer();
  private bossBy = 0;
  private readonly paintBossName = () => {
    const r = this.cr!;
    const by = this.bossBy;
    r.uiText(this.bossName, this.W / 2, by - 18, { size: 12, bold: true, align: 'center', color: '#ffd8d8', outline: '#2a0408' });
    if (this.bossTitle) {
      const nw = r.measureText(this.bossName, 12, true);
      r.uiText(this.bossTitle, this.W / 2 - nw / 2 - 8, by - 16, { size: 10, font: 'small', align: 'right', color: '#b06068', alpha: 0.9, outline: '#2a0408' });
    }
  };

  update(w: World, dt: number): void {
    this.t += dt;
    for (const e of this.splitNotices) {
      e.t += dt;
      if (e.settled < 0 && e.n.online !== 'pending') e.settled = e.t;
      e.h = e.h > 0 ? (e.h < e.hTarget ? Math.min(e.hTarget, e.h + dt * 160) : e.hTarget) : e.hTarget;
    }
    const p = w.player;
    if (!p) return;
    // ---- life gauge
    this.fire.update(p.red, p.soul, p.shields, dt);
    // ---- counters
    this.coins.update(p.coins, dt);
    this.bombs.update(p.bombs, dt);
    this.keys.update(p.keys, dt);
    // ---- ember
    const ef = clamp(p.ember / EMBER_MAX, 0, 1);
    if (this.emberFull && ef < 0.5) this.releaseFlash = 1;
    const full = ef >= 1;
    if (full && !this.emberFull) {
      this.emberFlash = 1;
    }
    this.emberFull = full;
    this.emberShown += (ef - this.emberShown) * Math.min(1, dt * 10);
    this.emberFlash = Math.max(0, this.emberFlash - dt * 1.8);
    this.releaseFlash = Math.max(0, this.releaseFlash - dt * 2.2);
    // ---- active / weapon / potion
    if (p.activeId !== this.activeId) {
      this.activeId = p.activeId;
      this.activePop = 1;
    }
    this.activePop = Math.max(0, this.activePop - dt * 2.5);
    const act = p.activeId ? Actives.get(p.activeId) : undefined;
    const ready = !!act && p.activeCharge >= act.charge;
    if (ready && !this.activeReady) this.activeFlash = 1;
    if (!ready && this.activeReady && p.activeId === this.activeId) this.activeUse = 1;
    this.activeReady = ready;
    this.activeUse = Math.max(0, this.activeUse - dt * 2.2);
    this.activeFlash = Math.max(0, this.activeFlash - dt * 2);
    if (p.weaponId !== this.weaponId || p.weapon2Id !== this.weapon2Id) {
      const swapped = !!this.weaponId && p.weaponId === this.weapon2Id && p.weapon2Id === this.weaponId;
      if (swapped) this.swapAnim = 1;
      else if (this.weaponId) this.weaponPop = 1;
      this.weaponId = p.weaponId;
      this.weapon2Id = p.weapon2Id;
    }
    this.weaponPop = Math.max(0, this.weaponPop - dt * 2.5);
    this.swapAnim = Math.max(0, this.swapAnim - dt * 5);
    if (p.potionId !== this.potionId) {
      if (p.potionId) this.potionPop = 1;
      this.potionId = p.potionId;
    }
    this.potionPop = Math.max(0, this.potionPop - dt * 2.5);
    // ---- boss bar
    const bosses = w.bosses;
    if (bosses.length) {
      const hpB = bosses.reduce((s, b) => s + Math.max(0, b.hp), 0);
      const max = bosses.reduce((s, b) => s + b.maxHp, 0);
      const f = clamp(hpB / Math.max(1, max), 0, 1);
      if (this.bossShown <= 0.01) {
        this.bossFrac = this.bossTrail = f;
      }
      if (f < this.bossFrac - 1e-4) {
        this.bossHitT = 0;
        this.bossFlash = 1;
      }
      this.bossFrac = f;
      this.bossName = bosses[0].def.name;
      this.bossTitle = bosses[0].def.bossTitle ?? '';
      this.bossShown = Math.min(1, this.bossShown + dt * 2.5);
    } else {
      if (this.bossShown > 0) this.bossFrac = 0;
      this.bossShown = Math.max(0, this.bossShown - dt * (this.bossTrail > 0.01 ? 0.8 : 2));
    }
    this.bossHitT += dt;
    this.bossFlash = Math.max(0, this.bossFlash - dt * 5);
    if (this.bossTrail > this.bossFrac) {
      if (this.bossHitT > 0.45) this.bossTrail = Math.max(this.bossFrac, this.bossTrail - dt * 0.6);
    } else this.bossTrail = this.bossFrac;
    // ---- buffs
    for (const b of w.items.buffs) {
      if (!this.buffSeen.has(b.key)) this.buffSeen.set(b.key, this.t);
      if (b.time !== Infinity) this.buffMax.set(b.key, Math.max(this.buffMax.get(b.key) ?? 0, b.time));
    }
    for (const k of [...this.buffSeen.keys()]) if (!w.items.buffs.some((b) => b.key === k)) {
      this.buffSeen.delete(k);
      this.buffMax.delete(k);
    }
    // ---- room clear / floor change
    if (w.run.floor !== this.lastFloor) {
      this.lastFloor = w.run.floor;
      this.minimap.reset();
    }
    if (w.node.id === this.lastNode && !this.lastCleared && w.node.cleared) {
      this.clearT = 0;
      this.minimap.flash = 1;
    }
    this.lastNode = w.node.id;
    this.lastCleared = w.node.cleared;
    if (this.clearT >= 0) {
      this.clearT += dt;
      if (this.clearT > 2) this.clearT = -1;
    }
    this.minimap.update(w, dt);
    this.hints.update(w, dt);
    this.artifacts.update(w, dt);
    this.tooltip.update(w, dt);
    if (w.coop) this.coop.update(w, dt);
  }

  /** Top-left of the release lantern (UI units inside the safe area): bottom-left corner. */
  private lanternPos(): { x: number; y: number } {
    return { x: LANTERN_X, y: this.H - LANTERN_BOTTOM - lanternSpec('release').h * PX };
  }

  /** Top-left of the life gauge (UI units inside the safe area). */
  private gaugePos(): { x: number; y: number } {
    return { x: GAUGE_X, y: GAUGE_Y };
  }

  /** Bottom edge of the life gauge (UI units inside the safe area). */
  private plateBottom(w: World): number {
    return GAUGE_Y + fireGaugeLayout(w.player).h * PX;
  }

  // ================================================================ draw
  draw(r: Renderer, w: World, fps = 60): void {
    const p = w.player;
    r.beginUI();
    if (!p) return;
    const cinematic = w.bossIntro ? clamp(1 - w.bossIntro.t / 0.3, 0, 1) + (w.bossIntro.t > 1.8 ? clamp((w.bossIntro.t - 1.8) / 0.4, 0, 1) : 0) : 1;
    const A = clamp(cinematic, 0, 1);
    const sa = r.uiSafe;
    this.W = UI_W - sa.l - sa.r;
    this.H = UI_H - sa.t - sa.b;
    const touchUi = touchUiActive();
    const d = r.dctx;
    this.cr = r;
    this.cw = w;
    d.save();
    d.translate(sa.l, sa.t);
    this.rackLeft = this.W;
    if (A > 0.01) this.drawCorners(r, w, A, sa.l, sa.t, touchUi);
    this.drawBoss(r, A);
    d.restore();
    this.cr = null;
    this.cw = null;
    if (w.coop) this.coop.draw(r, w, A, sa.l, sa.t, this.W, this.H, MINIMAP_MARGIN + MINIMAP_H + 34 + PURSE_H + 4);
    this.artifacts.draw(r, w, A, sa.l, sa.t, 196, this.W - MINIMAP_W - MINIMAP_MARGIN - 10);
    // speedrun timer + split card (left column): under the item tooltip, but above the floor
    // card's band and the boss intro, which must not dim it
    const sr = w.run.speedrun;
    const split = sr ? this.activeSplit() : null;
    const srLate = !!(w.floorCard || w.bossIntro);
    if (sr && !srLate) this.drawSpeedrunLayer(r, w, sr, split);
    this.tooltip.draw(r, w, A);
    drawBanners(r, w);
    if (this.clearT >= 0) drawRoomClear(r, this.clearT, w.banners.length === 0 && !w.floorCard && !split);
    if (w.floorCard) drawFloorCard(r, w.floorCard);
    if (w.bossIntro) drawBossIntro(r, w, w.bossIntro);
    if (sr && srLate) this.drawSpeedrunLayer(r, w, sr, split);
    if (!w.bossIntro && !this.tooltip.hasCompactHint(w)) this.hints.draw(r, w, (this.bossShown > 0.05 ? UI_H - 56 : UI_H - 18) - sa.b);
    if (save.settings.showFps) r.uiText(`${Math.round(fps)} FPS`, UI_W / 2, 4, { size: 10, font: 'small', align: 'center', color: '#80ff80' });
  }

  /** Corner HUD: cached layers while nothing animates, live drawing during animations. */
  private drawCorners(r: Renderer, w: World, A: number, ox: number, oy: number, touchUi: boolean): void {
    const p = w.player;
    // ---- life gauge and release lantern (drawn live: their flames flicker)
    this.drawHealth(r, w, A);
    if (!touchUi) this.drawLanternGauge(r, w, A);
    const pb = this.plateBottom(w);
    this.drawBuffs(r, w, A, pb + 8);
    // purse under the minimap block
    if (counterBusy(this.coins) || counterBusy(this.bombs) || counterBusy(this.keys)) this.drawConsumables(r, w, A);
    else this.lyPurse.draw(r, `${p.coins}|${p.bombs}|${p.keys}|${this.W}`, ox, oy, this.W - 150, this.purseY() - 4, 150, PURSE_H + 18, A, this.paintPurse);
    // minimap (+ floor name, seed); the current-room pulse is drawn live on top
    if (!this.minimap.settled) this.drawMinimap(r, w, A);
    else {
      const key = `${this.minimap.signature(w)}|${w.floor.name}|${w.run.stage}|${w.run.seed}|${save.progress.campaign?.seen.length ?? 0}|${this.W}`;
      this.lyMap.draw(r, key, ox, oy, this.W - MINIMAP_W - MINIMAP_MARGIN - 40, MINIMAP_MARGIN - 2, MINIMAP_W + MINIMAP_MARGIN + 40, MINIMAP_H + 32, A, this.paintMap);
      this.minimap.drawPulse(r, w, this.W - MINIMAP_W - MINIMAP_MARGIN, MINIMAP_MARGIN, MINIMAP_W, MINIMAP_H, this.t, A);
    }
    if (touchUi) return; // the touch buttons carry the weapon, active item and potion
    // ---- equipment slots
    const L = this.rackLayout(w);
    this.rackLeft = L.x;
    const def = p.activeId ? Actives.get(p.activeId) : undefined;
    const ready = !!def && p.activeCharge >= def.charge;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
    if (ready && L.act) glow(r, L.act.x + ACT_S / 2, L.act.y + ACT_S / 2, 34, '#ffd060', (0.16 + 0.12 * pulse) * A);
    if (this.potionPop > 0 || this.weaponPop > 0 || this.swapAnim > 0 || this.activeFlash > 0 || this.activeUse > 0 || this.activePop > 0) this.drawRack(r, w, A, true);
    else {
      const known = p.potionId ? w.run.identified.has(p.potionId) : false;
      const pad = input.aimMode === 'pad';
      const charge = def ? `${Math.round(ACT_S * clamp(p.activeCharge / def.charge, 0, 1))}|${ready ? (pulse > 0.5 ? 2 : 1) : 0}` : '';
      const key = `${p.potionId ?? ''}|${known ? 1 : 0}|${p.weaponId}|${p.weapon2Id ?? ''}|${p.activeId ?? ''}|${charge}|${pad ? 1 : 0}|${actionLabel(input.bindings, 'swap', pad)}|${actionLabel(input.bindings, 'active', pad)}|${actionLabel(input.bindings, 'consumable', pad)}|${p.potionId ? potionSpriteFor(w, p.potionId) : ''}|${this.W}|${this.H}`;
      this.lySlots.draw(r, key, ox, oy, L.x - 8, L.y - 18, L.w + 16, RACK_H + 26, A, this.paintSlots);
    }
  }

  /** The life gauge (no numbers: cells, half cells and empty glass tell what is left) and a glow that throbs at low health. */
  private drawHealth(r: Renderer, w: World, A: number): void {
    const p = w.player;
    const { x, y } = this.gaugePos();
    const L = fireGaugeLayout(p);
    const low = p.red + p.soul <= 2 && p.alive;
    if (low) glow(r, x + 16, y + (L.h * PX) / 2, 40, '#ff2030', (0.16 + 0.26 * heartbeat(this.t, 0.85)) * A);
    drawFireGauge(r, x, y, { red: p.red, maxRed: p.maxRed, soul: p.soul, shields: p.shields, t: this.t, low }, this.fire, A);
  }

  /** The release lantern: ember gauge, ready glow + key, release burst, cooldown shutters. */
  private drawLanternGauge(r: Renderer, w: World, A: number): void {
    const p = w.player;
    const { x, y } = this.lanternPos();
    const sp = lanternSpec('release');
    const ready = this.emberFull && p.releaseCooldown <= 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 7);
    const cx = x + (sp.w * PX) / 2;
    const cy = y + (sp.h * PX) / 2 + 2;
    if (ready) glow(r, cx, cy, 30 + 6 * pulse, '#ff9a3a', (0.32 + 0.2 * pulse) * A);
    if (this.releaseFlash > 0) glow(r, cx, cy, 100 * (1.4 - this.releaseFlash * 0.4), '#ffe080', this.releaseFlash * 0.7 * A);
    drawLantern(r, x, y, { fill: this.emberShown, ready, cooldown: p.releaseCooldown, t: this.t, flash: this.emberFlash }, A);
    if (ready) {
      // sparks drifting off the cap (time-driven, no RNG)
      for (let i = 0; i < 3; i++) {
        const k = (this.t * 0.9 + i / 3) % 1;
        const sx = cx - 4 + Math.sin(this.t * 3 + i * 2.1) * 6;
        r.uiRect(Math.round(sx), Math.round(y + 8 - k * 14), PX, PX, i % 2 ? '#ffd060' : '#ff8a30', A * (1 - k));
      }
      const pad = input.aimMode === 'pad';
      // the key beside the lantern's base (there is no room under it in the corner)
      keycap(r, actionLabel(input.bindings, 'special', pad), x + sp.w * PX + 6, y + sp.h * PX - 22, { alpha: A, down: pulse > 0.5, pad });
    }
    if (p.releaseCooldown > 0) {
      r.uiText(p.releaseCooldown.toFixed(1), cx, cy - 6, { size: 10, font: 'small', align: 'center', color: '#ffe8c0', alpha: A, outline: C.ink });
    }
  }

  private drawBuffs(r: Renderer, w: World, A: number, y: number): void {
    const buffs = w.items.buffs;
    if (!buffs.length) return;
    let x = GAUGE_X;
    let newest: { label: string; t: number } | null = null;
    for (const b of buffs) {
      const seen = this.buffSeen.get(b.key) ?? this.t;
      const age = this.t - seen;
      const sc = popScale(clamp(1 - age * 2.5, 0, 1), 0.5);
      frame(r, x, y, 24, 24, 'slot', { alpha: A });
      const icon = b.icon ?? 'ui_flame';
      spriteCentered(r, icon, x + 12, y + 12, fitScale(icon, 20, 1) * sc, { alpha: A });
      if (b.time !== Infinity) {
        const max = this.buffMax.get(b.key) ?? b.time;
        const f = clamp(b.time / Math.max(0.01, max), 0, 1);
        r.uiRect(x + 2, y + 25, 20, 4, C.ink, A);
        r.uiRect(x + 3, y + 26, 18 * f, 2, f < 0.25 && Math.sin(this.t * 14) > 0 ? '#ffffff' : C.emberHi, A);
      } else if (b.until) {
        r.uiText(b.until === 'room' ? '방' : '층', x + 12, y + 24, { size: 10, font: 'small', align: 'center', color: C.goldHi, alpha: A, outline: C.ink });
      }
      if (b.label && (!newest || seen > newest.t)) newest = { label: b.label, t: seen };
      x += 27;
    }
    if (newest && this.t - newest.t < 2.6) {
      const a = envelope(this.t - newest.t, 2.6, 0.15, 0.5) * A;
      r.uiText(newest.label, x + 4, y + 6, { size: 12, bold: true, color: C.emberHi, alpha: a, outline: C.ink });
    }
  }

  /** Top of the purse row under the minimap block (UI units inside the safe area). */
  private purseY(): number {
    return MINIMAP_MARGIN + MINIMAP_H + 30;
  }

  /** The purse: a slim plate under the minimap with coins / bombs / keys, right-aligned. */
  private drawConsumables(r: Renderer, w: World, A: number): void {
    const p = w.player;
    const items: [string, ChangeTracker, number][] = [['hud_coin', this.coins, p.coins], ['hud_bomb', this.bombs, p.bombs], ['hud_key', this.keys, p.keys]];
    const y = this.purseY();
    const cy = y + PURSE_H / 2;
    const cellW = 34;
    const pw = items.length * cellW + 8;
    const px = this.W - 8 - pw;
    blitArt(r, plateCanvas(pw / PX, PURSE_H / PX), px, y, A);
    items.forEach(([icon, tr, n], i) => {
      const ix = px + 10 + i * cellW;
      const sc = popScale(tr.pop, 0.45);
      r.uiSprite(icon, ix, cy, 1.5, { alpha: A });
      const col = tr.pop > 0.2 ? (tr.dir > 0 ? '#fff0a0' : '#ff9a9a') : C.text;
      const d = r.dctx;
      d.save();
      d.translate(ix + 8, cy);
      d.scale(sc, sc);
      r.uiText(String(n).padStart(2, '0'), 0, -6, { size: 10, font: 'small', color: col, alpha: A, outline: C.ink });
      d.restore();
      if (tr.age < 1.1 && tr.delta !== 0) {
        const a = clamp(1 - tr.age / 1.1, 0, 1) * A;
        r.uiText(`${tr.delta > 0 ? '+' : ''}${tr.delta}`, ix + 10, y + PURSE_H + 1 + tr.age * 6, { size: 10, font: 'small', color: tr.delta > 0 ? C.good : C.bad, alpha: a, outline: C.ink });
      }
    });
  }

  private drawMinimap(r: Renderer, w: World, A: number, staticOnly = false): void {
    const mw = MINIMAP_W;
    const mh = MINIMAP_H;
    const RW = this.W;
    const x = RW - mw - MINIMAP_MARGIN;
    const y = MINIMAP_MARGIN;
    this.minimap.draw(r, w, x, y, mw, mh, this.t, A, staticOnly);
    const [no, name] = splitFloorName(w.floor.name);
    r.uiText(name, RW - 10, y + mh + 4, { size: 10, font: 'small', align: 'right', color: C.textDim, alpha: A, outline: C.ink });
    if (no) r.uiText(w.run.staged ? `${w.run.floor}-${w.run.stage}` : no, RW - 12 - r.measureText(name, 10, false, 'small') - 6, y + mh + 4, { size: 10, font: 'small', align: 'right', color: C.gold, alpha: A, outline: C.ink });
    r.uiText(w.run.campaign && save.progress.campaign ? storyObjective(save.progress.campaign).title : w.run.seed, RW - 10, y + mh + 17, { size: 10, font: 'small', align: 'right', color: C.textMute, alpha: A * 0.9, outline: C.ink });
  }

  /** Gear rack slots, right to left: potion, active item (+ charge wick), primary, secondary weapon. */
  private rackLayout(w: World): RackLayout {
    const p = w.player;
    const right = this.W - 8;
    const y = this.H - 8 - RACK_H;
    let x = right - RACK_PAD;
    let pot: RackLayout['pot'] = null;
    let act: RackLayout['act'] = null;
    if (p.potionId) {
      pot = { x: x - POT_S, y: y + (RACK_H - POT_S) / 2 };
      x = pot.x - 8;
    }
    if (p.activeId) {
      act = { x: x - 8 - ACT_S, y: y + (RACK_H - ACT_S) / 2 };
      x = act.x - 8;
    }
    let div = -1;
    if (pot || act) {
      div = x + 2;
      x -= 8;
    }
    const main = { x: x - MAIN_S, y: y + (RACK_H - MAIN_S) / 2 };
    x = main.x - 14;
    const sub = { x: x - SUB_S, y: main.y + (MAIN_S - SUB_S) / 2 };
    x = sub.x - RACK_PAD;
    return { x, y, w: right - x, main, sub, act, pot, div };
  }

  private drawRack(r: Renderer, w: World, A: number, live: boolean): void {
    const p = w.player;
    const L = this.rackLayout(w);
    const pad = input.aimMode === 'pad';
    // ---- weapons: the held one big with its rarity, the other smaller; a swap trades the icons
    const wdef = Weapons.get(p.weaponId);
    const w2 = p.weapon2Id ? Weapons.get(p.weapon2Id) : undefined;
    const k = ease.outCubic(1 - this.swapAnim);
    const mcx = L.main.x + MAIN_S / 2;
    const mcy = L.main.y + MAIN_S / 2;
    const scx = L.sub.x + SUB_S / 2;
    const scy = L.sub.y + SUB_S / 2;
    frame(r, L.sub.x, L.sub.y, SUB_S, SUB_S, 'slot', { alpha: A * (w2 ? 0.95 : 0.45) });
    frame(r, L.main.x, L.main.y, MAIN_S, MAIN_S, 'slotHi', { alpha: A });
    if (wdef) rarityAccent(r, L.main.x, L.main.y, MAIN_S, RARITY_COLOR[wdef.rarity], A);
    if (w2) {
      const cx = scx + (mcx - scx) * (1 - k);
      const cy = scy + (mcy - scy) * (1 - k);
      const box = 22 + 10 * (1 - k);
      spriteCentered(r, w2.icon, cx, cy, fitScale(w2.icon, box, 2), { alpha: A * (0.72 + 0.28 * (1 - k)), tint: '#140c1c', tintAmount: 0.25 * k });
      keycap(r, actionLabel(input.bindings, 'swap', pad), L.sub.x + SUB_S + 7, mcy, { align: 'center', alpha: A * 0.95, pad });
    }
    if (wdef) {
      const cx = mcx + (scx - mcx) * (1 - k);
      const cy = mcy + (scy - mcy) * (1 - k);
      const box = 32 - 10 * (1 - k);
      spriteCentered(r, wdef.icon, cx, cy, fitScale(wdef.icon, box, 2) * (live ? popScale(this.weaponPop, 0.4) : 1), { alpha: A, flash: this.swapAnim * 0.6 });
    }
    if (this.swapAnim > 0) glow(r, mcx, mcy, 30, '#ffe8a0', this.swapAnim * 0.35 * A);
    // ---- active item + its charge wick
    if (L.act && p.activeId) {
      const def = Actives.get(p.activeId);
      if (def) {
        const { x, y } = L.act;
        const ready = p.activeCharge >= def.charge;
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
        frame(r, x, y, ACT_S, ACT_S, ready ? 'slotHi' : 'slot', { alpha: A });
        spriteCentered(r, def.icon, x + ACT_S / 2, y + ACT_S / 2, fitScale(def.icon, 26, 2) * (live ? popScale(this.activePop, 0.4) : 1), {
          alpha: A * (ready ? 1 : 0.55),
          flash: live && this.activeFlash > 0 ? this.activeFlash * 0.8 : 0,
        });
        const bx = x + ACT_S + 2;
        const bh = ACT_S;
        const fill = clamp(p.activeCharge / def.charge, 0, 1);
        r.uiRect(bx, y, 6, bh, C.ink, A);
        r.uiRect(bx + 2, y + 2, 2, bh - 4, '#1a1020', A);
        const fh = Math.round((bh - 4) * fill);
        r.uiRect(bx + 2, y + 2 + (bh - 4) - fh, 2, fh, ready ? (pulse > 0.5 ? '#ffe880' : '#ffd040') : '#5ab0ff', A);
        if (!def.timed && def.charge > 1) {
          for (let i = 1; i < def.charge; i++) r.uiRect(bx + 2, y + 2 + Math.round(((bh - 4) * i) / def.charge) - 1, 2, 2, C.ink, A);
        }
        if (live && this.activeFlash > 0) r.uiRect(x + 2, y + 2, ACT_S - 4, ACT_S - 4, '#fff4c0', this.activeFlash * 0.4 * A);
        if (live && this.activeUse > 0) {
          const u = 1 - this.activeUse;
          const d = r.dctx;
          d.save();
          d.globalAlpha = this.activeUse * A;
          d.strokeStyle = '#ffe080';
          d.lineWidth = 3 * this.activeUse + 1;
          d.strokeRect(x - u * 14, y - u * 14, ACT_S + u * 28, ACT_S + u * 28);
          d.restore();
          glow(r, x + ACT_S / 2, y + ACT_S / 2, 30 + u * 40, '#ffd060', 0.4 * this.activeUse * A);
        }
        keycap(r, actionLabel(input.bindings, 'active', pad), x + 1, y + ACT_S - 2, { align: 'left', alpha: A * 0.95, pad });
      }
    }
    // ---- potion
    if (L.pot && p.potionId) {
      const { x, y } = L.pot;
      const known = w.run.identified.has(p.potionId);
      frame(r, x, y, POT_S, POT_S, 'slot', { alpha: A });
      spriteCentered(r, potionSpriteFor(w, p.potionId), x + POT_S / 2, y + POT_S / 2, 2 * (live ? popScale(this.potionPop, 0.4) : 1), { alpha: A });
      if (!known) r.uiText('?', x + POT_S - 7, y + 1, { size: 10, font: 'small', align: 'center', color: C.goldHi, alpha: A, outline: C.ink });
      keycap(r, actionLabel(input.bindings, 'consumable', pad), x - 2, y + POT_S - 2, { align: 'left', alpha: A * 0.95, pad });
    }
  }

  // ================================================================ speedrun
  /** The speedrun panel inside the safe-area translate (binds the renderer for the cached paint). */
  private drawSpeedrunLayer(r: Renderer, w: World, sr: SpeedrunRun, split: SplitEntry | null): void {
    const sa = r.uiSafe;
    const d = r.dctx;
    d.save();
    d.translate(sa.l, sa.t);
    this.cr = r;
    this.cw = w;
    this.drawSpeedrun(r, w, sr, split, sa.l, sa.t);
    this.cr = null;
    this.cw = null;
    d.restore();
  }

  /** Timer plate (static parts cached, digits live) and the current split card under it. */
  private drawSpeedrun(r: Renderer, w: World, sr: SpeedrunRun, split: SplitEntry | null, ox: number, oy: number): void {
    const last = lastFloorIndex();
    const done = sr.splits.find((s) => s.floor === last);
    const floor = w.run.floor;
    const boss = sr.bossStartTick >= 0 && !done;
    // the floor whose split the clock is running toward (the next one once this floor's boss fell)
    const target = done ? 0 : boss ? floor : sr.has(floor) ? Math.min(last, floor + 1) : floor;
    const nowMs = ticksToMs(done ? done.splitTicks : sr.ticks);
    const prev = sr.splits[sr.splits.length - 1];
    const segTicks = boss ? sr.ticks - sr.bossStartTick : sr.ticks - (prev?.splitTicks ?? 0);
    const label = done ? '완주 기록' : boss ? `${floor}층 보스` : `${target}층`;
    const taint = !!sr.taint;
    const x = SR_X;
    const y = SR_Y;
    // the plate, its labels and the floor pips change rarely: cached
    this.srLabel = label;
    this.srTarget = target;
    this.srBoss = boss;
    const key = `${label}|${taint ? 1 : 0}|${sr.splits.length}|${target}|${boss ? 1 : 0}`;
    const cardH = split ? split.h + (taint ? 18 : 6) : taint ? 14 : 0;
    const A = this.speedrunFade(r, w, ox + x, oy + y, SR_W, SR_H + cardH);
    this.lySr.draw(r, key, ox, oy, x - 2, y - 2, SR_W + 4, SR_H + (taint ? 18 : 4), A, this.paintSpeedrun);
    // ---- live: the run clock (fixed-advance digits; the hundredths smaller)
    const sk = split ? clamp(1 - split.t / 0.9, 0, 1) : 0;
    const clockCol = done ? C.goldHi : sk > 0 ? mixColor(C.text, C.goldHi, sk) : C.text;
    const main = formatSplit(nowMs);
    const dot = main.lastIndexOf('.');
    const hw = clockText(r, main.slice(0, dot), x + 10, y + 7, { size: 16, bold: true, color: clockCol, outline: C.ink, alpha: A });
    clockText(r, main.slice(dot), x + 10 + hw, y + 11, { size: 12, bold: true, color: done ? C.gold : C.textDim, outline: C.ink, alpha: A });
    // a split sweeps the plate gold
    if (sk > 0) r.uiRect(x + 4, y + 4, SR_W - 8, SR_H - 8, '#ffe8a0', 0.16 * sk * A);
    // ---- line 2: this floor's segment (or the boss fight) and the delta
    const lw = r.measureText(label, 10, false, 'small');
    const segEnd = x + 10 + lw + (done ? 0 : 5 + clockText(r, formatSplit(ticksToMs(segTicks)), x + 10 + lw + 5, y + 30, { size: 10, font: 'small', color: boss ? '#ffc8cc' : C.text, alpha: A }));
    const delta = this.speedrunDelta(nowMs, target);
    if (delta !== null) {
      const ds = formatDelta(delta);
      // (an hour-long gap would not fit beside an hour-long segment: then the segment wins)
      if (x + SR_W - 14 - clockWidth(r, ds, { size: 10, font: 'small' }) > segEnd + 6) clockText(r, ds, x + SR_W - 14, y + 30, { size: 10, font: 'small', align: 'right', color: deltaColor(delta), alpha: A });
    }
    // ---- the split card under the plate
    if (split) {
      const life = this.splitLife(split);
      const inK = ease.outCubic(clamp(split.t / 0.35, 0, 1));
      const outK = clamp((life - split.t) / 0.35, 0, 1);
      const a = Math.min(inK, outK) * A;
      if (a > 0.01) {
        const slide = (1 - inK) * -24 + (1 - outK) * -12;
        split.hTarget = drawSplitCard(r, split, x + slide, y + SR_H + (taint ? 18 : 6), SR_W, split.t, a, split.h);
      }
    }
  }

  /**
   * Opacity of the speedrun panel (UI rect, safe-area included): it sits over the room's
   * top-left corner, so it fades while a keeper, an enemy or an enemy shot is under it.
   * Reads the world only.
   */
  private speedrunFade(r: Renderer, w: World, ux: number, uy: number, uw: number, uh: number): number {
    const toWorld = (u: number, v: number) => r.displayToWorld(r.uiOffsetX + u * r.uiScale, r.uiOffsetY + v * r.uiScale);
    const a = toWorld(ux, uy);
    const b = toWorld(ux + uw, uy + uh);
    const under = (x: number, y: number, pad: number) => x > a.x - pad && x < b.x + pad && y > a.y - pad && y < b.y + pad;
    let cover = false;
    for (const p of w.players) if (p.alive && under(p.x, p.y, 10)) cover = true;
    if (!cover) for (const e of w.enemies) if (!e.dead && under(e.x, e.y, 8)) { cover = true; break; }
    if (!cover) for (const q of w.projectiles) if (!q.dead && q.team === 'enemy' && under(q.x, q.y, 4)) { cover = true; break; }
    const dt = clamp(this.t - this.srFadeT, 0, 0.1);
    this.srFadeT = this.t;
    this.srFade = follow(this.srFade, cover ? 0.28 : 1, 12, dt);
    return this.srFade;
  }

  /**
   * The pace shown on the timer (LiveSplit style): once the clock has passed this device's best
   * clear time of the target floor, the live loss (red, growing); before that, how the last
   * split compared with the best of its floor; null when there is nothing to compare.
   */
  private speedrunDelta(nowMs: number, target: number): number | null {
    const best = target ? this.bestMs(target) : null;
    if (best !== null && nowMs > best) return nowMs - best;
    const e = this.splitNotices[this.splitNotices.length - 1];
    return e && e.cmp !== undefined ? e.n.splitMs - e.cmp : null;
  }

  /** Static part of the timer plate (cached by lySr): plate, labels, floor pips, practice note. */
  private readonly paintSpeedrun = () => {
    const r = this.cr;
    const sr = this.cw?.run.speedrun;
    if (!r || !sr) return;
    const x = SR_X;
    const y = SR_Y;
    blitArt(r, plateCanvas(SR_W / PX, SR_H / PX, 13), x, y);
    // "스피드런" over the floor pips (right): one pip per floor, gold once its boss fell
    r.uiText('스피드런', x + SR_W - 15, y + 6, { size: 10, font: 'small', align: 'right', color: C.gold });
    const last = lastFloorIndex();
    const pw = 6;
    const px0 = x + SR_W - 15 - last * pw + 2;
    for (let f = 1; f <= last; f++) {
      const px = px0 + (f - 1) * pw;
      const done = sr.has(f);
      const cur = !done && f === this.srTarget;
      r.uiRect(px - 1, y + 18, 6, 6, C.ink);
      r.uiRect(px, y + 19, 4, 4, done ? C.gold : cur ? (this.srBoss ? '#ff6a70' : C.ember) : '#2e2340');
      if (done || cur) r.uiRect(px, y + 19, 2, 1, done ? C.goldHi : '#ffe0b0');
    }
    r.uiText(this.srLabel, x + 10, y + 30, { size: 10, font: 'small', color: this.srBoss ? '#ff9aa0' : this.srLabel === '완주 기록' ? C.goldHi : C.textFaint });
    if (sr.taint) r.uiText('연습 · 랭킹 미반영', x + 4, y + SR_H + 2, { size: 10, font: 'small', color: C.textFaint, outline: C.ink });
  };

  private drawBoss(r: Renderer, A: number): void {
    if (this.bossShown <= 0.01 || A <= 0.01) return;
    const k = ease.outCubic(this.bossShown) * A;
    // centered, but never under the gear rack
    const room = 2 * (this.rackLeft - 18) - this.W;
    const bw = Math.max(140, Math.min(280, room));
    const bx = (this.W - bw) / 2;
    const by = this.H - 24 + (1 - k) * 30;
    this.bossBy = by;
    const a = k;
    r.uiSprite('ui_skull', bx - 12, by + 6, 2, { alpha: a, flash: this.bossFlash * 0.6 });
    // name + title: cached bitmap (outlined text is not re-stroked every frame)
    const sa = r.uiSafe;
    this.lyBoss.draw(r, `${this.bossName}|${this.bossTitle}|${this.W}|${Math.round(by * 4)}`, sa.l, sa.t, 0, by - 22, this.W, 22, a, this.paintBossName);
    const shake = this.bossFlash > 0 ? (Math.random() - 0.5) * 2 * this.bossFlash : 0;
    gauge(r, bx + shake, by, bw, 13, this.bossFrac, {
      fill: '#d02838', hi: '#ff6a70', lo: '#7a0a18', back: '#2a0810',
      trail: this.bossTrail, trailColor: '#ffd8a0', segments: 4, alpha: a, flash: this.bossFlash * 0.5,
    });
  }
}

/** Readable name color on the dark tag: lift the rarity color toward white. */
function mixHi(color: string): string {
  return mixColor(color, '#ffffff', 0.35);
}
