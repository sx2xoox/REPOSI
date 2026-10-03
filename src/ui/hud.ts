// In-game HUD (UI space 768x432), Isaac-clean layout:
//   top-left   active item box (segmented charge, ready glow) · hearts (pop on
//              gain/loss, heartbeat at low HP) · temporary buffs
//   left       coins / bombs / keys (pop + floating delta) · stat column with
//              green/red change indicators
//   top-right  minimap (smooth recentering) · floor name · seed
//   bottom     ember gauge with flare when full (left) · boss bar with name and
//              damage trail (center) · weapon + potion slots (right)
// plus banners, floor / boss cards, room-clear feedback and first-run hints.
// The UI space widens with the screen (UI_W = 2 * VIEW_W); corner elements are
// anchored to the edges of the device safe area (`Renderer.uiSafe`). With the
// touch controls shown, the ember gauge lives on the release button and the
// weapon / potion slots on the attack / potion buttons (no overlap at the bottom).

import type { Renderer } from '../engine/renderer';
import { UI_H, UI_W } from '../engine/renderer';
import type { World } from '../game/world';
import { Actives, Potions, Weapons } from '../game/defs';
import { clamp, ease } from '../engine/math';
import { animFrame } from '../engine/sprites';
import { save } from '../engine/save';
import { storyObjective } from '../game/story';
import { potionSpriteFor } from '../game/pickups';
import { EMBER_MAX } from '../game/player';
import { input } from '../engine/input';
import { ChangeTracker, envelope, heartbeat, popScale } from './anim';
import { MinimapView } from './minimap';
import { drawBanners, drawBossIntro, drawFloorCard, drawRoomClear } from './cards';
import { HintSystem } from './hints';
import { fitScale, frame, gauge, glow, keycap, spriteCentered } from './frame';
import { C, splitFloorName } from './theme';
import { formatDelta, heartSlots, hudStats, type HeartKind } from './logic';
import { actionLabel } from './keys';
import { touchUiActive } from './touch-mode';
import { ItemTooltip } from './item-tooltip';
import { UiLayer } from './layer-cache';
import { ArtifactBar } from './artifact-bar';
import type { HudStat } from './logic';
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

const HEART_SPRITE: Record<HeartKind, string> = {
  full: 'hud_heart_full',
  half: 'hud_heart_half',
  empty: 'hud_heart_empty',
  soul: 'hud_soul_full',
  soulHalf: 'hud_soul_half',
};
const HEART_VALUE: Record<HeartKind, number> = { full: 2, half: 1, empty: 0, soul: 2, soulHalf: 1 };

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
}

/** A counter is animating (pop / floating delta) */
function counterBusy(tr: ChangeTracker): boolean {
  return tr.pop > 0 || (tr.age < 1.1 && tr.delta !== 0);
}

export class Hud {
  t = 0;
  private slots: HeartKind[] = [];
  private slotPop: number[] = [];
  private slotDir: number[] = [];
  private shards: Shard[] = [];
  private coins = new ChangeTracker(0, 2.5);
  private bombs = new ChangeTracker(0, 2.5);
  private keys = new ChangeTracker(0, 2.5);
  private stats = new Map<string, ChangeTracker>();
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
  private hurtFlash = 0;
  private lastHp = -1;
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
  private statRows: HudStat[] = [];
  private statVals = [NaN, NaN, NaN, NaN, NaN, NaN];
  private statKey = '';
  private statTrackers: ChangeTracker[] = [];
  private heartsKey = '';
  private readonly lyHearts = new UiLayer();
  private readonly lyLeft = new UiLayer();
  private readonly lyActive = new UiLayer();
  private readonly lyMap = new UiLayer();
  private readonly lyEmber = new UiLayer();
  private readonly lySlots = new UiLayer();
  /** world / renderer of the current draw call (for the prebound paint callbacks) */
  private cw: World | null = null;
  private cr: Renderer | null = null;
  private readonly paintHearts = () => this.drawHearts(this.cr!, this.cw!, 1);
  private readonly paintLeft = () => {
    this.drawConsumables(this.cr!, this.cw!, 1);
    this.drawStats(this.cr!, this.cw!, 1);
  };
  private readonly paintActive = () => this.drawActive(this.cr!, this.cw!, 1, false);
  private readonly paintMap = () => this.drawMinimap(this.cr!, this.cw!, 1, true);
  private readonly paintEmber = () => this.drawEmber(this.cr!, this.cw!, 1);
  private readonly paintSlots = () => this.drawSlots(this.cr!, this.cw!, 1);
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
    const p = w.player;
    if (!p) return;
    // ---- hearts
    const slots = heartSlots(p.red, p.maxRed, p.soul);
    for (let i = 0; i < Math.max(slots.length, this.slots.length); i++) {
      const before = this.slots[i];
      const now = slots[i];
      this.slotPop[i] = Math.max(0, (this.slotPop[i] ?? 0) - dt * 2.6);
      if (before === now || this.t < 0.05) continue;
      const bv = before ? HEART_VALUE[before] : -1;
      const nv = now ? HEART_VALUE[now] : -1;
      this.slotPop[i] = 1;
      this.slotDir[i] = nv >= bv ? 1 : -1;
      if (nv < bv) this.spawnShards(i, before === 'soul' || before === 'soulHalf' ? C.soul : C.heart);
    }
    if (slots.length !== this.slots.length || slots.some((k, i) => k !== this.slots[i])) this.heartsKey = slots.join(',');
    this.slots = slots;
    const hp = p.red + p.soul;
    if (this.lastHp >= 0 && hp < this.lastHp) this.hurtFlash = 1;
    this.lastHp = hp;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    for (const s of this.shards) {
      s.age += dt;
      s.vy += 420 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    if (this.shards.length) this.shards = this.shards.filter((s) => s.age < s.life);
    // ---- counters
    this.coins.update(p.coins, dt);
    this.bombs.update(p.bombs, dt);
    this.keys.update(p.keys, dt);
    const ps = p.stats;
    const sv = this.statVals;
    if (sv[0] !== ps.moveSpeed || sv[1] !== ps.fireRate || sv[2] !== ps.damage || sv[3] !== ps.range || sv[4] !== ps.shotSpeed || sv[5] !== ps.luck) {
      sv[0] = ps.moveSpeed;
      sv[1] = ps.fireRate;
      sv[2] = ps.damage;
      sv[3] = ps.range;
      sv[4] = ps.shotSpeed;
      sv[5] = ps.luck;
      this.statRows = hudStats(ps);
      this.statKey = this.statRows.map((st) => st.text).join('|');
    }
    for (const st of this.statRows) {
      const v = Math.round(st.value * 100) / 100;
      let tr = this.stats.get(st.key);
      if (!tr) {
        tr = new ChangeTracker(v, 0.45);
        tr.reset(v);
        this.stats.set(st.key, tr);
        this.statTrackers.push(tr);
      }
      tr.update(v, dt);
    }
    // ---- ember
    const ef = clamp(p.ember / EMBER_MAX, 0, 1);
    if (this.emberFull && ef < 0.5) this.releaseFlash = 1;
    const full = ef >= 1;
    if (full && !this.emberFull) this.emberFlash = 1;
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

  private spawnShards(slot: number, color: string): void {
    const { x, y } = this.heartPos(slot);
    for (let i = 0; i < 6; i++) {
      this.shards.push({
        x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 90,
        age: 0, life: 0.45 + Math.random() * 0.3, color: i % 3 === 0 ? '#ffffff' : color,
      });
    }
  }

  private heartPos(i: number): { x: number; y: number } {
    return { x: 80 + (i % 6) * 19, y: 20 + Math.floor(i / 6) * 18 };
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
    if (A > 0.01) this.drawCorners(r, w, A, sa.l, sa.t, touchUi);
    this.drawBoss(r, A);
    d.restore();
    this.cr = null;
    this.cw = null;
    if (w.coop) this.coop.draw(r, w, A, sa.l, sa.t, this.W, this.H, MINIMAP_MARGIN + MINIMAP_H + 34);
    this.artifacts.draw(r, w, A, sa.l, sa.t, 196, this.W - MINIMAP_W - MINIMAP_MARGIN - 10);
    this.tooltip.draw(r, w, A);
    drawBanners(r, w);
    if (this.clearT >= 0) drawRoomClear(r, this.clearT, w.banners.length === 0 && !w.floorCard);
    if (w.floorCard) drawFloorCard(r, w.floorCard);
    if (w.bossIntro) drawBossIntro(r, w, w.bossIntro);
    if (!w.bossIntro) this.hints.draw(r, w, (this.bossShown > 0.05 ? UI_H - 56 : UI_H - 18) - sa.b);
    if (save.settings.showFps) r.uiText(`${Math.round(fps)} FPS`, UI_W / 2, 4, { size: 10, font: 'small', align: 'center', color: '#80ff80' });
  }

  /** Corner HUD: cached layers while nothing animates, live drawing during animations. */
  private drawCorners(r: Renderer, w: World, A: number, ox: number, oy: number, touchUi: boolean): void {
    const p = w.player;
    // active item box (the ready glow pulses live under the cached box)
    if (p.activeId) {
      const def = Actives.get(p.activeId);
      if (def && (this.activeFlash > 0 || this.activeUse > 0 || this.activePop > 0)) this.drawActive(r, w, A);
      else if (def) {
        const ready = p.activeCharge >= def.charge;
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
        if (ready) glow(r, 10 + 22, 10 + 22, 40, '#ffd060', (0.18 + 0.12 * pulse) * A);
        const fh = Math.round(36 * clamp(p.activeCharge / def.charge, 0, 1));
        const key = `${def.icon}|${ready ? (pulse > 0.5 ? 2 : 1) : 0}|${fh}|${def.charge}|${input.aimMode === 'pad' ? 1 : 0}`;
        this.lyActive.draw(r, key, ox, oy, 0, 0, 72, 64, A, this.paintActive);
      }
    }
    // hearts
    const low = p.red + p.soul <= 2 && p.alive;
    let heartsBusy = low || this.hurtFlash > 0 || this.shards.length > 0 || p.shields > 0;
    for (let i = 0; i < this.slots.length && !heartsBusy; i++) if ((this.slotPop[i] ?? 0) > 0) heartsBusy = true;
    if (heartsBusy) this.drawHearts(r, w, A);
    else this.lyHearts.draw(r, this.heartsKey, ox, oy, 68, 8, 122, 6 + Math.ceil(this.slots.length / 6) * 18, A, this.paintHearts);
    this.drawBuffs(r, w, A);
    // counters + stats column
    let leftBusy = counterBusy(this.coins) || counterBusy(this.bombs) || counterBusy(this.keys);
    for (let i = 0; i < this.statTrackers.length && !leftBusy; i++) {
      const tr = this.statTrackers[i];
      if (tr.age < 2.5 && tr.delta !== 0) leftBusy = true;
    }
    if (leftBusy) {
      this.drawConsumables(r, w, A);
      this.drawStats(r, w, A);
    } else {
      const key = `${p.coins}|${p.bombs}|${p.keys}|${p.activeId ? 1 : 0}|${this.statKey}`;
      this.lyLeft.draw(r, key, ox, oy, 4, 40, 92, 186, A, this.paintLeft);
    }
    // minimap (+ floor name, seed); the current-room pulse is drawn live on top
    if (!this.minimap.settled) this.drawMinimap(r, w, A);
    else {
      const key = `${this.minimap.signature(w)}|${w.floor.name}|${w.run.stage}|${w.run.seed}|${save.progress.campaign?.seen.length ?? 0}|${this.W}`;
      this.lyMap.draw(r, key, ox, oy, this.W - MINIMAP_W - MINIMAP_MARGIN - 40, MINIMAP_MARGIN - 2, MINIMAP_W + MINIMAP_MARGIN + 40, MINIMAP_H + 32, A, this.paintMap);
      this.minimap.drawPulse(r, w, this.W - MINIMAP_W - MINIMAP_MARGIN, MINIMAP_MARGIN, MINIMAP_W, MINIMAP_H, this.t, A);
    }
    if (touchUi) return; // the touch buttons carry the ember gauge, weapon and potion
    if (this.emberFull || this.emberFlash > 0 || this.releaseFlash > 0 || w.player.releaseCooldown > 0) this.drawEmber(r, w, A);
    else this.lyEmber.draw(r, `${Math.round(108 * clamp(this.emberShown, 0, 1))}`, ox, oy, 0, this.H - 44, 160, 44, A, this.paintEmber);
    if (this.potionPop > 0 || this.weaponPop > 0 || this.swapAnim > 0) this.drawSlots(r, w, A);
    else {
      const known = p.potionId ? w.run.identified.has(p.potionId) : false;
      const key = `${p.potionId ?? ''}|${known ? 1 : 0}|${p.weaponId}|${p.weapon2Id ?? ''}|${input.aimMode === 'pad' ? 1 : 0}|${actionLabel(input.bindings, 'swap', input.aimMode === 'pad')}|${p.potionId ? potionSpriteFor(w, p.potionId) : ''}`;
      this.lySlots.draw(r, key, ox, oy, this.W - 190, this.H - 70, 190, 70, A, this.paintSlots);
    }
  }

  private drawActive(r: Renderer, w: World, A: number, withGlow = true): void {
    const p = w.player;
    if (!p.activeId) return;
    const def = Actives.get(p.activeId);
    if (!def) return;
    const x = 10;
    const y = 10;
    const s = 44;
    const ready = p.activeCharge >= def.charge;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
    if (ready && withGlow) glow(r, x + s / 2, y + s / 2, 40, '#ffd060', (0.18 + 0.12 * pulse) * A);
    frame(r, x, y, s, s, ready ? 'slotHi' : 'slot', { alpha: A });
    const sc = popScale(this.activePop, 0.4);
    spriteCentered(r, def.icon, x + s / 2, y + s / 2, fitScale(def.icon, 34, 2) * sc, {
      alpha: A * (ready ? 1 : 0.55),
      flash: this.activeFlash > 0 ? this.activeFlash * 0.8 : 0,
    });
    // charge bar (segments for room charge, smooth for timed)
    const bx = x + s + 2;
    const bh = s - 4;
    const fill = clamp(p.activeCharge / def.charge, 0, 1);
    r.uiRect(bx, y + 2, 8, bh, C.ink, A);
    r.uiRect(bx + 2, y + 4, 4, bh - 4, '#1a1020', A);
    const fh = Math.round((bh - 4) * fill);
    const col = ready ? (pulse > 0.5 ? '#ffe880' : '#ffd040') : '#5ab0ff';
    r.uiRect(bx + 2, y + 4 + (bh - 4) - fh, 4, fh, col, A);
    r.uiRect(bx + 2, y + 4 + (bh - 4) - fh, 2, fh, ready ? '#fff8d0' : '#a0d8ff', A * 0.7);
    if (!def.timed && def.charge > 1) {
      for (let i = 1; i < def.charge; i++) r.uiRect(bx + 2, y + 4 + Math.round(((bh - 4) * i) / def.charge) - 1, 4, 2, C.ink, A);
    }
    if (this.activeFlash > 0) r.uiRect(x + 2, y + 2, s - 4, s - 4, '#fff4c0', this.activeFlash * 0.4 * A);
    if (this.activeUse > 0) {
      // used: a ring bursts out of the box
      const k = 1 - this.activeUse;
      const d = r.dctx;
      d.save();
      d.globalAlpha = this.activeUse * A;
      d.strokeStyle = '#ffe080';
      d.lineWidth = 3 * this.activeUse + 1;
      d.strokeRect(x - k * 14, y - k * 14, s + k * 28, s + k * 28);
      d.restore();
      glow(r, x + s / 2, y + s / 2, 30 + k * 40, '#ffd060', 0.4 * this.activeUse * A);
    }
    keycap(r, actionLabel(input.bindings, 'active', input.aimMode === 'pad'), x + 1, y + s - 2, { align: 'left', alpha: A * 0.95, pad: input.aimMode === 'pad' });
  }

  private drawHearts(r: Renderer, w: World, A: number): void {
    const p = w.player;
    const total = p.red + p.soul;
    const low = total <= 2 && p.alive;
    const beat = low ? heartbeat(this.t, 0.85) : 0;
    if (low) glow(r, 98, 22, 60, '#ff2030', 0.25 * beat * A);
    this.slots.forEach((k, i) => {
      const { x, y } = this.heartPos(i);
      const pop = this.slotPop[i] ?? 0;
      const dir = this.slotDir[i] ?? 1;
      let sc = popScale(pop, dir > 0 ? 0.5 : 0.28);
      if (low && (k === 'full' || k === 'half' || k === 'soul' || k === 'soulHalf')) sc *= 1 + 0.22 * beat;
      const shakeX = dir < 0 && pop > 0 ? Math.sin(pop * 50) * 2.5 * pop : 0;
      r.uiSprite(HEART_SPRITE[k], x + shakeX, y, 2 * sc, {
        alpha: A,
        flash: (dir < 0 ? pop * 0.9 : pop * 0.5) + (this.hurtFlash > 0 ? this.hurtFlash * 0.3 : 0),
      });
    });
    // one-hit shields
    for (let i = 0; i < p.shields; i++) {
      const { x, y } = this.heartPos(this.slots.length + i);
      r.uiSprite('st_shield', x, y, 2, { alpha: A * (0.8 + 0.2 * Math.sin(this.t * 4 + i)) });
    }
    for (const s of this.shards) {
      const a = 1 - s.age / s.life;
      r.uiRect(s.x - 1.5, s.y - 1.5, 3, 3, s.color, a * A);
    }
  }

  private drawBuffs(r: Renderer, w: World, A: number): void {
    const buffs = w.items.buffs;
    if (!buffs.length) return;
    const rows = Math.ceil(this.slots.length / 6);
    const y = 20 + rows * 18 + 6;
    let x = 70;
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

  private drawConsumables(r: Renderer, w: World, A: number): void {
    const p = w.player;
    const items: [string, ChangeTracker, number][] = [['hud_coin', this.coins, p.coins], ['hud_bomb', this.bombs, p.bombs], ['hud_key', this.keys, p.keys]];
    const y0 = p.activeId ? 64 : 48;
    items.forEach(([icon, tr, n], i) => {
      const y = y0 + i * 18;
      const sc = popScale(tr.pop, 0.45);
      r.uiSprite(icon, 20, y + 7, 2, { alpha: A });
      const col = tr.pop > 0.2 ? (tr.dir > 0 ? '#fff0a0' : '#ff9a9a') : C.text;
      const d = r.dctx;
      d.save();
      d.translate(32, y + 7);
      d.scale(sc, sc);
      r.uiText(String(n).padStart(2, '0'), 0, -7, { size: 12, color: col, alpha: A, outline: C.ink });
      d.restore();
      if (tr.age < 1.1 && tr.delta !== 0) {
        const a = clamp(1 - tr.age / 1.1, 0, 1) * A;
        r.uiText(`${tr.delta > 0 ? '+' : ''}${tr.delta}`, 58, y - tr.age * 10, { size: 10, font: 'small', color: tr.delta > 0 ? C.good : C.bad, alpha: a });
      }
    });
  }

  private drawStats(r: Renderer, w: World, A: number): void {
    const p = w.player;
    const y0 = (p.activeId ? 64 : 48) + 3 * 18 + 8;
    this.statRows.forEach((st, i) => {
      const y = y0 + i * 15;
      const tr = this.stats.get(st.key);
      r.uiSprite(st.icon, 18, y + 6, 1.5, { alpha: A * 0.85 });
      const hot = tr && tr.age < 2.5 && tr.delta !== 0;
      const better = tr ? (tr.delta > 0) === st.higherBetter : true;
      r.uiText(st.text, 30, y, { size: 10, font: 'small', color: hot ? (better ? C.good : C.bad) : '#d8d0c4', alpha: A * 0.9, outline: C.ink });
      if (hot && tr) {
        const a = clamp((2.5 - tr.age) / 0.6, 0, 1) * A;
        const dtxt = formatDelta(tr.delta, st.text);
        if (dtxt) r.uiText(dtxt, 30 + r.measureText(st.text, 10, false, 'small') + 4, y, { size: 10, font: 'small', color: better ? C.good : C.bad, alpha: a, outline: C.ink });
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

  private drawEmber(r: Renderer, w: World, A: number): void {
    const x = 12;
    const y = this.H - 30;
    const gw = 112;
    const f = this.emberShown;
    const full = this.emberFull && w.player.releaseCooldown <= 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 7);
    if (full) glow(r, x + 10, y + 8, 34 + 6 * pulse, '#ff9a3a', (0.3 + 0.2 * pulse) * A);
    if (this.releaseFlash > 0) glow(r, x + 60, y + 8, 120 * (1.4 - this.releaseFlash * 0.4), '#ffe080', this.releaseFlash * 0.7 * A);
    r.uiSprite(animFrame(full ? 'ui_lantern' : 'ui_lantern_0', this.t), x + 10, y + 6, 1.5, { alpha: A, flash: this.emberFlash * 0.8 });
    const gx = x + 24;
    gauge(r, gx, y + 2, gw, 12, f, {
      fill: full ? '#ffb030' : '#e0602a', hi: full ? '#fff0a0' : '#ffa060', lo: full ? '#c06010' : '#8a2a10',
      segments: 4, alpha: A, flash: this.emberFlash,
    });
    if (w.player.releaseCooldown > 0) r.uiText(`해방 재사용 ${w.player.releaseCooldown.toFixed(1)}초`, gx + gw + 8, y + 3, { size: 10, font: 'small', color: C.textDim, alpha: A });
    if (full) {
      // flame licks on the gauge's top edge
      for (let i = 0; i < 9; i++) {
        const fx = gx + 6 + i * 12 + Math.sin(this.t * 6 + i) * 2;
        const fh = 3 + 3 * (0.5 + 0.5 * Math.sin(this.t * 11 + i * 1.7));
        r.uiRect(fx, y + 2 - fh, 2, fh, i % 2 ? '#ffd060' : '#ff8a30', A * 0.85);
      }
      const key = actionLabel(input.bindings, 'special', input.aimMode === 'pad');
      const kx = gx + gw + 6;
      keycap(r, key, kx, y + 8, { align: 'left', alpha: A, down: pulse > 0.5, pad: input.aimMode === 'pad' });
      r.uiText('등불 해방', kx + Math.max(16, r.measureText(key, 10, false, 'small') + 10) + 4, y + 2, { size: 12, bold: true, color: C.emberHi, alpha: A * (0.7 + 0.3 * pulse), outline: C.ink });
    }
  }

  private drawSlots(r: Renderer, w: World, A: number): void {
    const p = w.player;
    const s = 36;
    // potion (rightmost)
    const px = this.W - s - 10;
    const py = this.H - s - 10;
    if (p.potionId) {
      const def = Potions.get(p.potionId);
      const known = w.run.identified.has(p.potionId);
      frame(r, px, py, s, s, 'slot', { alpha: A });
      spriteCentered(r, potionSpriteFor(w, p.potionId), px + s / 2, py + s / 2, 2 * popScale(this.potionPop, 0.4), { alpha: A });
      keycap(r, actionLabel(input.bindings, 'consumable', input.aimMode === 'pad'), px - 2, py + s - 2, { align: 'left', alpha: A * 0.95, pad: input.aimMode === 'pad' });
      r.uiText(known && def ? def.name : '정체불명', px + s, py - 13, { size: 10, font: 'small', align: 'right', color: known ? C.text : C.textFaint, alpha: A, outline: C.ink });
    }
    // weapons (Soul Knight style): the held weapon in a big highlighted box, the
    // second slot smaller and dimmed beside it (with the swap key); a swap makes
    // the two icons trade places
    const M = 40;
    const S = 30;
    const mx = p.potionId ? px - M - 8 : this.W - M - 10;
    const my = this.H - M - 8;
    const sx = mx - S - 6;
    const sy = my + M - S;
    const wdef = Weapons.get(p.weaponId);
    const w2 = p.weapon2Id ? Weapons.get(p.weapon2Id) : undefined;
    const k = ease.outCubic(1 - this.swapAnim);
    const mcx = mx + M / 2;
    const mcy = my + M / 2;
    const scx = sx + S / 2;
    const scy = sy + S / 2;
    frame(r, sx, sy, S, S, 'slot', { alpha: A * (w2 ? 0.95 : 0.4) });
    frame(r, mx, my, M, M, 'slotHi', { alpha: A * 0.92 });
    if (w2) {
      const cx = scx + (mcx - scx) * (1 - k);
      const cy = scy + (mcy - scy) * (1 - k);
      const box = 20 + 10 * (1 - k);
      spriteCentered(r, w2.icon, cx, cy, fitScale(w2.icon, box, 2), { alpha: A * (0.75 + 0.25 * (1 - k)), tint: '#140c1c', tintAmount: 0.22 * k });
    }
    if (wdef) {
      const cx = mcx + (scx - mcx) * (1 - k);
      const cy = mcy + (scy - mcy) * (1 - k);
      const box = 30 - 10 * (1 - k);
      spriteCentered(r, wdef.icon, cx, cy, fitScale(wdef.icon, box, 2) * popScale(this.weaponPop, 0.4), { alpha: A, flash: this.swapAnim * 0.6 });
    }
    if (this.swapAnim > 0) glow(r, mcx, mcy, 30, '#ffe8a0', this.swapAnim * 0.35 * A);
    if (w2) keycap(r, actionLabel(input.bindings, 'swap', input.aimMode === 'pad'), sx - 3, sy + S / 2, { align: 'right', alpha: A * 0.9, pad: input.aimMode === 'pad' });
  }

  private drawBoss(r: Renderer, A: number): void {
    if (this.bossShown <= 0.01 || A <= 0.01) return;
    const k = ease.outCubic(this.bossShown) * A;
    const bw = 280;
    const bx = (this.W - bw) / 2;
    const by = this.H - 24 + (1 - k) * 30;
    this.bossBy = by;
    const a = k;
    // name + title
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
