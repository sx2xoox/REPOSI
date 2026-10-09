// 등불 도둑 사냥 (hunt, 보통): the fourth mission room, and the only offensive one.
// A masked lantern weasel has robbed the room's iron lamp tree of its three embers.
// Using the tree releases it: chase it down, knock it over (each tumble drops an
// ember) and pick the embers up before it grabs them back. Every so often it runs
// for one of three shadow cracks at the wall base: hit it hard or touch it while it
// squeezes in to drag it out and board the crack up; if it gets through, the mission
// fails (embers already claimed have paid their coins). Board all three and it is
// cornered. Its flee AI, art and tumbling live in hunt-weasel.ts.
//
// Everything that steers the hunt is hashed primitive state on the device (root mem)
// and the weasel's mem; drawing and lights only read it.

import { MISSION_DIFFICULTY } from '../../game/mission-difficulty';
import { participants, partySize, encounterCount, encounterHP, encounterWave, encounterRewards, endEncounter, roomLabel, type EncounterRoot, type WavePlacer } from './encounter-kit';
import { defineRoom } from '../../game/defs';
import { defineDrawnSprite, definePixelSprite } from '../../engine/sprites';
import { registerRoomHandler } from '../../game/roomkinds';
import { Entity } from '../../game/entity';
import { Enemy } from '../../game/enemy';
import { Pickup } from '../../game/pickups';
import { RingFx } from '../../game/effects';
import { fx, RNG } from '../../engine/rng';
import { save } from '../../engine/save';
import { TAU } from '../../engine/math';
import { Prop } from '../props/prop';
import { withDecals, ap } from './decor';
import type { PixelPainter } from '../../engine/painter';
import type { Room } from '../../game/room';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { DRAG_OUT, ESCAPE_COLOR, HUNT_BAND, HUNT_COLOR, ST, WEASEL_ID, callout, huntBand, hunters, weaselBar, type HuntLink } from './hunt-weasel';

export const HUNT_TITLE = '등불 도둑 사냥';
const LABEL = MISSION_DIFFICULTY.hunt.label;
const INK = '#120a12';
const EMBER = '#ffd36a';
const EMBER_HI = '#fff4c0';
/** most caltrops on the floor at once (the oldest goes) */
export const CALTROP_MAX = 10;
export const CALTROP_ARM = 0.5;
export const CALTROP_LIFE = 7;
/** ember flight from the tumbling weasel to its landing spot */
export const EMBER_FLIGHT = 0.45;
/** keeper ember gauge for a claimed ember */
export const CLAIM_EMBER = 15;
/** tree light that the weasel stays out of, by embers returned */
const LIGHT_R = [0, 36, 52];
/**
 * Minion waves per hunt (opening, knockdowns and trickle together). A normal hunt (under a
 * minute) never reaches it; it stops a stalled hunt (thief cornered, embers left lying, or
 * every escape cancelled with a tumble) from becoming an endless kill / drop farm.
 */
export const MAX_WAVES = 10;

// ================================================================== rooms
defineRoom({ id: 'hunt_den', shape: '1x1', kinds: ['hunt'], rows: ['p...............p', '.................', '...XX.......XX...', '.................', '.................', '.................', '...XX.......XX...', '.................', 'p...............p'] });
defineRoom({ id: 'hunt_yard', shape: '1x1', kinds: ['hunt'], rows: ['p...............p', '.................', '.....X.....X.....', '.....X.....X.....', '.................', '.....X.....X.....', '.....X.....X.....', '.................', 'p...............p'] });

// ================================================================== cracks
/** A crack's channel point (where the weasel squeezes in) and the wall it sits in: 0 top, 1 bottom, 2 left, 3 right. */
export interface CrackSpot { x: number; y: number; face: number }
const CRACK_SPOTS: CrackSpot[] = [
  ...[56, 124, 212, 280].map((x) => ({ x, y: 40, face: 0 })),
  ...[56, 124, 212, 280].map((x) => ({ x, y: 168, face: 1 })),
  { x: 40, y: 60, face: 2 }, { x: 40, y: 148, face: 2 },
  { x: 296, y: 60, face: 3 }, { x: 296, y: 148, face: 3 },
];

/** Three crack spots for a hunt room: on open floor, clear of the doors, spread apart (room rng only). */
export function huntCracks(room: Room, rng: RNG): CrackSpot[] {
  const valid = CRACK_SPOTS.filter((c) => room.isFree(c.x, c.y, 8) && room.doors.every((d) => Math.hypot(d.x - c.x, d.y - c.y) >= 40));
  const picks: CrackSpot[] = [];
  for (const c of rng.shuffle([...valid])) {
    if (picks.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= 96)) picks.push(c);
    if (picks.length === 3) return picks;
  }
  const out = valid.slice(0, 3);
  for (const c of CRACK_SPOTS) if (out.length < 3 && !out.includes(c)) out.push(c);
  return out;
}

/** Where a crack is drawn: in the wall base next to its channel point. */
function crackDrawPos(x: number, y: number, face: number): { x: number; y: number } {
  return face === 0 ? { x, y: y - 3 } : face === 1 ? { x, y: y + 3 } : face === 2 ? { x: x - 3, y } : { x: x + 3, y };
}

// ================================================================== the device
type HuntMem = {
  phase: number; used: boolean; pending: number; members: number; clock: number; progress: number; held: number;
  weasel: number; wx: number; wy: number; nextEscape: number; escCrack: number; escState: number; chanT: number; chanHp: number;
  sealed: number; cornered: number; nextTrickle: number; nextWave: number; waves: number; lightR: number; band: number; interval: number;
  c0x: number; c0y: number; c1x: number; c1y: number; c2x: number; c2y: number; c0f: number; c1f: number; c2f: number;
};

/** Coins that pop from the tree for each claimed ember: 2, +1 per extra hunter. */
export const claimCoins = (members: number): number => 2 + (partySize(members) - 1);

/** The iron lamp tree: start, ember claims, escapes, minion waves and the outcome. */
export class HuntDevice extends Prop implements EncounterRoot, HuntLink {
  mem: HuntMem = {
    phase: 0, used: false, pending: 0, members: 1, clock: 0, progress: 0, held: 3, weasel: 0, wx: 0, wy: 0,
    nextEscape: 15, escCrack: -1, escState: 0, chanT: 0, chanHp: 0, sealed: 0, cornered: 0, nextTrickle: 12, nextWave: 0.5, waves: 0, lightR: 0, band: 0, interval: 16,
    c0x: 0, c0y: 0, c1x: 0, c1y: 0, c2x: 0, c2y: 0, c0f: 0, c1f: 0, c2f: 0,
  };

  constructor(x: number, y: number) {
    super(x, y, 1);
  }

  override previewable(): boolean {
    return !this.mem.used && this.mem.phase === 0;
  }

  override interactionInfo() {
    if (this.mem.phase > 0) return { name: HUNT_TITLE, icon: 'map_hunt', desc: '', compactHint: '사냥 중' };
    return { name: `${HUNT_TITLE} · ${LABEL}`, icon: 'map_hunt', desc: '족제비를 쓰러뜨려 떨군 불씨 3개를 되찾으세요. 틈으로 숨어들 때 붙잡거나 세게 치면 틈이 막힙니다. 빠져나가면 실패 · 한 번만 도전할 수 있습니다.' };
  }

  override interact(w: World): boolean {
    const s = this.mem;
    const p = w.player;
    if (s.used || s.phase !== 0 || !p.alive || p.downed || Math.hypot(p.x - this.x, p.y - this.y) > 30) return false;
    s.members = participants(w);
    s.phase = 1;
    s.clock = 0;
    s.band = huntBand(w.floor.index);
    s.interval = Math.max(10, HUNT_BAND.interval[s.band] - (partySize(s.members) - 1));
    s.nextEscape = 15;
    s.nextWave = 0.5;
    s.nextTrickle = 12;
    s.waves = 0;
    s.held = 3;
    s.progress = 0;
    w.room.setDoorsClosed(true);
    w.sfx('door_close');
    w.banner(HUNT_TITLE, '쓰러뜨리고 떨군 불씨를 먼저 주우세요', { small: true, color: HUNT_COLOR });
    const e = w.spawnEnemy(WEASEL_ID, this.x, this.y);
    if (e) {
      e.ctxP = null;
      e.dormant = 0.8;
      e.encounterId = this.id;
      e.mem.encounter = this.id;
      e.mem.root = this.id;
      // replace the normal co-op HP scaling with the mission's (as EncounterSummon does)
      const base = w.coop ? 1 + 0.5 * (w.players.length - 1) : 1;
      e.mem.bb = (e.maxHp / base) * encounterHP(partySize(s.members));
      e.maxHp = e.hp = weaselBar(e, 3);
      e.mem.held = 3;
      // it bursts out of the tree away from whoever woke it
      const a = Math.atan2(this.y - p.y, this.x - p.x);
      const t = w.room.nearestFree(this.x + Math.cos(a) * 60, this.y + Math.sin(a) * 60, 7);
      e.mem.state = ST.leap;
      e.mem.jump = 1;
      e.vulnerable = false;
      e.script.set(e.jumpTo(w, t.x, t.y, 0.5, 18));
      s.weasel = e.id;
      s.wx = e.x;
      s.wy = e.y;
    }
    return true;
  }

  // ---------------------------------------------------------------- HuntLink
  crack(i: number): { x: number; y: number } {
    const s = this.mem;
    return i === 0 ? { x: s.c0x, y: s.c0y } : i === 1 ? { x: s.c1x, y: s.c1y } : { x: s.c2x, y: s.c2y };
  }

  channelTime(): number {
    return HUNT_BAND.channel[this.mem.band];
  }

  /** Landed embers of this hunt, in insertion order. */
  private embers(w: World): HuntEmber[] {
    const out: HuntEmber[] = [];
    for (const e of w.entities) if (e instanceof HuntEmber && !e.dead && e.mem.root === this.id && e.mem.air <= 0) out.push(e);
    return out;
  }

  nearestEmber(w: World, x: number, y: number, max: number): { x: number; y: number } | null {
    let best: HuntEmber | null = null;
    let bd = max;
    for (const em of this.embers(w)) {
      const d = Math.hypot(em.x - x, em.y - y);
      if (d <= bd) {
        if (best && d === bd) continue;
        best = em;
        bd = d;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  regrab(w: World, e: Enemy): boolean {
    for (const em of this.embers(w)) {
      if (Math.hypot(em.x - e.x, em.y - e.y) > e.r + 6) continue;
      em.dead = true;
      this.setHeld(w, this.mem.held + 1);
      return true;
    }
    return false;
  }

  knockdown(w: World, e: Enemy): void {
    const s = this.mem;
    if (s.escState) this.cancelEscape();
    w.sfx('slam', { vol: 0.4 });
    w.shake(0.12);
    if (s.held <= 0) return;
    this.setHeld(w, s.held - 1);
    // the ember spills toward the tree, a little off line
    const a = Math.atan2(this.y - e.y, this.x - e.x) + w.rng.range(-0.6, 0.6);
    const d = w.rng.range(40, 60);
    const t = w.room.nearestFree(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, 6);
    const em = w.spawn(new HuntEmber(this.id, e.x, e.y, t.x, t.y, EMBER_FLIGHT));
    em.encounterId = this.id;
    em.ctxP = null;
    w.sfx('orb', { vol: 0.6 });
    this.wave(w);
  }

  beginChannel(w: World, e: Enemy): void {
    const s = this.mem;
    s.escState = 2;
    s.chanT = 0;
    s.chanHp = e.hp;
    w.sfx('whoosh', { vol: 0.3, pitch: 0.6 });
  }

  caltrop(w: World, e: Enemy): void {
    const live: HuntCaltrop[] = [];
    for (const c of w.entities) if (c instanceof HuntCaltrop && !c.dead && c.mem.root === this.id) live.push(c);
    if (live.length >= CALTROP_MAX) live[0].dead = true;
    const c = w.spawn(new HuntCaltrop(e.x, e.y + 2, this.id));
    c.encounterId = this.id;
    c.ctxP = null;
    w.sfx('spike', { vol: 0.15 });
  }

  // ---------------------------------------------------------------- internals
  private setHeld(w: World, v: number): void {
    this.mem.held = Math.max(0, Math.min(3, v));
    const e = this.weasel(w);
    if (e) e.mem.held = this.mem.held;
  }

  private weasel(w: World): Enemy | null {
    if (!this.mem.weasel) return null;
    const e = w.entityById(this.mem.weasel);
    return e instanceof Enemy && !e.dead ? e : null;
  }

  private cap(): number {
    return Math.ceil(8 * encounterCount(partySize(this.mem.members)));
  }

  private minions(w: World): number {
    let n = 0;
    for (const e of w.enemies) if (e.alive && e.encounterId === this.id && e.def.id !== WEASEL_ID) n++;
    return n;
  }

  /** One wave of the floor's own enemies, placed away from the hunters and the tree. */
  private wave(w: World): void {
    const s = this.mem;
    if (s.waves >= MAX_WAVES || this.minions(w) + s.pending >= this.cap()) return;
    s.waves++;
    const room = w.room;
    const place: WavePlacer = () => {
      const hs = hunters(w, s.members);
      const pts: { x: number; y: number }[] = [];
      for (let x = 56; x <= room.pxW - 56; x += 32) for (let y = 56; y <= room.pxH - 56; y += 32) {
        if (!room.isFree(x, y, 8) || Math.hypot(x - this.x, y - this.y) < 40) continue;
        if (hs.some((p) => Math.hypot(p.x - x, p.y - y) < 72)) continue;
        pts.push({ x, y });
      }
      return pts.length ? w.rng.pick(pts) : null;
    };
    encounterWave(w, this, HUNT_BAND.wave[s.band], false, false, place);
  }

  private cancelEscape(): void {
    const s = this.mem;
    s.escState = 0;
    s.escCrack = -1;
    s.chanT = 0;
    s.nextEscape = s.clock + s.interval;
  }

  private claims(w: World): void {
    const s = this.mem;
    for (const p of hunters(w, s.members)) {
      for (const em of this.embers(w)) {
        if (em.dead || Math.hypot(em.x - p.x, em.y - p.y) > p.r + 6) continue;
        em.dead = true;
        s.progress++;
        w.spawn(new EmberFlight(em.x, em.y, this.x, this.y - 30));
        callout(w, this.x, this.y - 46, `불씨 ${s.progress}/3`, EMBER);
        w.sfx('clock_chime', { vol: 0.55, pitch: 1.2 });
        w.sfx('coin', { vol: 0.4 });
        w.asPlayer(p, () => p.addEmber(CLAIM_EMBER));
        // the partial credit: coins per ember, more for a bigger party (as the rewards are)
        for (let i = 0; i < claimCoins(s.members); i++) {
          const c = w.spawn(new Pickup('coin', this.x, this.y - 10)).pop();
          c.encounterId = this.id;
        }
      }
    }
  }

  /** The weasel is gone without escaping (removed some other way in this room, e.g. a kill-all): its embers spill out. */
  private lostWeasel(w: World): void {
    const s = this.mem;
    s.weasel = 0;
    s.escState = 0;
    s.escCrack = -1;
    s.chanT = 0;
    for (let i = 0; i < s.held; i++) {
      const a = (i * TAU) / 3 + Math.atan2(this.y - s.wy, this.x - s.wx);
      const t = w.room.nearestFree(s.wx + Math.cos(a) * 14, s.wy + Math.sin(a) * 14, 6);
      const em = w.spawn(new HuntEmber(this.id, t.x, t.y, t.x, t.y, 0));
      em.encounterId = this.id;
      em.ctxP = null;
    }
    s.held = 0;
  }

  private seal(w: World, e: Enemy): void {
    const s = this.mem;
    const i = s.escCrack;
    const c = this.crack(i);
    s.sealed |= 1 << i;
    s.escState = 0;
    s.escCrack = -1;
    s.chanT = 0;
    s.nextEscape = s.clock + s.interval;
    callout(w, c.x, c.y + (c.y < w.room.centerY ? 22 : -8), '틈 봉쇄', HUNT_COLOR);
    w.sfx('hit_metal', { vol: 0.6 });
    w.spawn(new RingFx(c.x, c.y, 14, 0.3, HUNT_COLOR, 2));
    // yanked out and flung toward the middle of the room, dazed (still hittable)
    const dx = w.room.centerX - e.x;
    const dy = w.room.centerY - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const t = w.room.nearestFree(e.x + (dx / d) * 20, e.y + (dy / d) * 20, 7);
    e.mem.state = ST.yank;
    e.mem.t = 0.8;
    e.mem.jump = 1;
    e.script.set(e.jumpTo(w, t.x, t.y, 0.25, 6));
    if (s.sealed === 7) {
      s.cornered = 1;
      w.banner('궁지에 몰렸습니다', '이제 달아날 곳이 없습니다', { small: true, color: HUNT_COLOR });
    }
  }

  /**
   * Back in the room while the hunt was on (the thief is not kept when the room is left):
   * it got away meanwhile. Spilling its embers instead would hand out a free win.
   */
  abandoned(w: World): void {
    const s = this.mem;
    if (s.used || s.phase !== 1 || this.weasel(w)) return;
    s.weasel = 0;
    this.finish(w, false);
  }

  private escaped(w: World, e: Enemy): void {
    w.particles.burst(e.x, e.y - 3, { count: 18, speed: [10, 50], life: [0.4, 0.9], colors: ['#c9a0ff', ESCAPE_COLOR, '#3a1c58'], size: [1, 3], sizeEnd: 4, gravity: -40, fade: true });
    w.sfx('teleport', { vol: 0.6, pitch: 0.8 });
    e.dead = true;
    this.mem.weasel = 0;
    this.finish(w, false);
  }

  private escapeTick(w: World, e: Enemy, dt: number): void {
    const s = this.mem;
    if (s.escState === 0) {
      if (s.cornered || s.clock < s.nextEscape || e.mem.state !== ST.flee || !e.script.done) return;
      // the open crack farthest from its nearest hunter
      const hs = hunters(w, s.members);
      let best = -1;
      let bd = -Infinity;
      for (let i = 0; i < 3; i++) {
        if (s.sealed & (1 << i)) continue;
        const c = this.crack(i);
        let d = 999;
        for (const p of hs) d = Math.min(d, Math.hypot(p.x - c.x, p.y - c.y));
        if (d > bd) { bd = d; best = i; }
      }
      if (best < 0) return;
      s.escCrack = best;
      s.escState = 1;
      e.mem.state = ST.escape;
      e.mem.stuck = 0;
      callout(w, e.x, e.y - 30, '틈으로 달아납니다!', '#c9a0ff');
      w.sfx('warn', { vol: 0.5 });
      return;
    }
    if (s.escState !== 2) return;
    // dragged out by a big enough hit or a hand on it
    const touched = hunters(w, s.members).some((p) => Math.hypot(p.x - e.x, p.y - e.y) <= p.r + e.r + 2);
    if (touched || s.chanHp - e.hp >= DRAG_OUT * e.maxHp) {
      this.seal(w, e);
      return;
    }
    // the squeeze is the thief's own doing: a keeper's time stop / slow holds it too
    s.chanT += dt * w.enemyTimeScale;
    if (s.chanT >= this.channelTime()) this.escaped(w, e);
  }

  private finish(w: World, success: boolean): void {
    const s = this.mem;
    if (s.used) return;
    if (success) {
      const e = this.weasel(w);
      if (e) {
        w.particles.burst(e.x, e.y - 4, { count: 16, speed: [20, 60], life: [0.3, 0.7], colors: ['#d8c8d0', '#8a7a8a', '#4a3a4a'], size: [1, 3], sizeEnd: 4, gravity: -30, fade: true });
        w.spawn(new DroppedLantern(e.x, e.y));
        e.dead = true;
      }
      w.sfx('teleport', { vol: 0.5, pitch: 1.2 });
      encounterRewards(w, s.members, 'hunt');
    }
    s.weasel = 0;
    // the bestiary records it after a hunt (it never dies there, so no kill would)
    save.markSeenEnemy(WEASEL_ID);
    endEncounter(w, this, success);
    w.banner(success ? '임무 완료' : '임무 실패', success ? '보상을 확인하세요' : '도둑이 달아났습니다 · 이 장치는 다시 가동할 수 없습니다', { small: true, color: success ? HUNT_COLOR : '#e9988d' });
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const s = this.mem;
    if (s.used) return;
    w.holdClear = Math.max(w.holdClear, 1);
    if (s.phase !== 1) return;
    s.clock += dt;
    const e = this.weasel(w);
    if (e) {
      s.wx = e.x;
      s.wy = e.y;
    } else if (s.weasel) this.lostWeasel(w);
    this.claims(w);
    s.lightR = LIGHT_R[Math.min(2, s.progress)];
    if (s.progress >= 3) {
      this.finish(w, true);
      return;
    }
    if (e) this.escapeTick(w, e, dt);
    if (s.used) return;
    if (s.nextWave > 0 && s.clock >= s.nextWave) {
      s.nextWave = 0;
      this.wave(w);
    }
    if (s.clock >= s.nextTrickle) {
      s.nextTrickle += 12;
      if (this.minions(w) < Math.ceil(this.cap() / 2)) this.wave(w);
    }
  }

  override draw(r: Renderer, w: World): void {
    const s = this.mem;
    r.shadow(this.x, this.y, 30, 7, 0.35);
    r.sprite('device_hunt', this.x, this.y);
    for (let i = 0; i < Math.min(3, s.progress); i++) {
      const [lx, ly] = TREE_LAMPS[i];
      r.sprite('hunt_lamp_lit', this.x - 21 + lx, this.y - 42 + ly);
    }
    if (s.phase === 1 && !s.used) {
      // the bar drains toward the next escape attempt (full and lime once it is cornered)
      const left = s.escState ? 0 : Math.max(0, s.nextEscape - s.clock);
      const escaping = s.escState > 0;
      const k = s.cornered || !s.weasel ? 1 : escaping ? 1 : Math.min(1, left / s.interval);
      const col = s.cornered || !s.weasel ? HUNT_COLOR : escaping || left < 4 ? ESCAPE_COLOR : '#d9c7ff';
      r.rect(this.x - 22, this.y - 53, 44, 4, '#211b2e');
      r.rect(this.x - 22, this.y - 53, Math.round(44 * k), 4, col, escaping ? 0.55 + 0.45 * Math.sin(w.time * 14) : 1);
      const text = s.cornered || escaping || !s.weasel ? `${s.progress}/3` : `${s.progress}/3 · ${Math.ceil(left)}s`;
      r.pixelText(text, this.x, this.y - 61, HUNT_COLOR, { align: 'center', outline: '#110c1b' });
    }
    if (s.used) roomLabel(r, s.phase === 4 ? '완료' : '실패', this.x, this.y - 48, s.phase === 4 ? HUNT_COLOR : '#db8a87');
  }

  override light(w: World): void {
    const s = this.mem;
    w.lights.add(this.x, this.y - 22, 24 + s.lightR, EMBER, { intensity: s.used ? 0.35 : 0.55 + 0.1 * s.progress });
    if (s.phase !== 1 || s.used || !s.weasel) return;
    // the stolen lantern on the thief's tail
    w.lights.add(s.wx, s.wy - 8, 20 + 8 * s.held, EMBER, { intensity: 0.45 });
  }
}

// ================================================================== props
/** A shadow crack at the wall base (persistent: the boards stay after the hunt). */
export class HuntCrack extends Prop {
  constructor(x: number, y: number, readonly face: number, readonly index: number, readonly rootId: number) {
    super(x, y, 0);
  }

  private root(w: World): HuntDevice | null {
    const r = w.entityById(this.rootId);
    return r instanceof HuntDevice ? r : null;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const root = this.root(w);
    if (!root || root.mem.sealed & (1 << this.index)) return;
    const target = root.mem.escCrack === this.index && root.mem.escState > 0 && !root.mem.used;
    // wisps of shadow seeping out (cosmetic)
    if (fx.chance(dt * (target ? 9 : 1.6))) {
      const p = crackDrawPos(this.x, this.y, this.face);
      w.particles.spawn({ x: p.x + fx.range(-5, 5), y: p.y + fx.range(-2, 2), vx: fx.range(-4, 4), vy: -fx.range(4, 12), life: fx.range(0.6, 1.2), colors: target ? ['#c9a0ff', ESCAPE_COLOR] : ['#5a3a7a', '#2a1a3a'], size: fx.range(1, 2), sizeEnd: 2.5, fade: true });
    }
  }

  override draw(r: Renderer, w: World): void {
    const root = this.root(w);
    const sealed = !!root && (root.mem.sealed & (1 << this.index)) !== 0;
    const side = this.face >= 2;
    const p = crackDrawPos(this.x, this.y, this.face);
    const name = (side ? 'hunt_crack_side' : 'hunt_crack') + (sealed ? '_sealed' : '');
    r.sprite(name, p.x, p.y, { flipY: this.face === 1, flipX: this.face === 3 });
  }

  override light(w: World): void {
    const root = this.root(w);
    if (!root || root.mem.sealed & (1 << this.index)) return;
    const target = root.mem.escCrack === this.index && root.mem.escState > 0 && !root.mem.used;
    const p = crackDrawPos(this.x, this.y, this.face);
    w.lights.add(p.x, p.y, target ? 34 : 16, ESCAPE_COLOR, { intensity: target ? 0.6 : 0.25 });
  }
}

/**
 * Purely visual, drawn after the lighting: the crack the thief is running for pulses violet
 * and a marching dotted path leads to it from the thief (read from the device's mem).
 */
class HuntEscapeFx extends Entity {
  static override readonly cosmetic = true;
  constructor(readonly rootId: number) {
    super();
    this.layer = 3;
    this.persistent = true;
    this.tileCollide = false;
  }
  override draw(r: Renderer, w: World): void {
    const root = w.entityById(this.rootId);
    if (!(root instanceof HuntDevice)) return;
    const s = root.mem;
    if (s.phase !== 1 || s.used || s.escState === 0 || s.escCrack < 0) return;
    const c = root.crack(s.escCrack);
    const pulse = 0.5 + 0.5 * Math.sin(w.time * 12);
    r.pixelRing(c.x, c.y, 11 + pulse * 2, ESCAPE_COLOR, 1, 0.55 + 0.45 * pulse);
    r.pixelRing(c.x, c.y, 6, '#c9a0ff', 1, 0.6);
    if (s.escState !== 1) return;
    const d = Math.hypot(c.x - s.wx, c.y - s.wy);
    const n = Math.max(1, Math.floor(d / 6));
    const off = Math.floor(w.time * 12) % 3;
    for (let i = 1; i < n; i++) {
      if ((i + off) % 3 === 0) continue;
      const x = s.wx + ((c.x - s.wx) * i) / n;
      const y = s.wy - 2 + ((c.y - s.wy + 2) * i) / n;
      r.rect(x - 1, y - 1, 2, 2, '#1a0c24', 0.6);
      r.rect(x, y, 1, 1, '#c9a0ff', 0.95);
    }
  }
}

/** A dropped ember: flies in an arc from the tumbling weasel, claimable once it lands. */
export class HuntEmber extends Prop {
  mem: { root: number; sx: number; sy: number; tx: number; ty: number; air: number };
  constructor(root: number, sx: number, sy: number, tx: number, ty: number, air: number) {
    super(air > 0 ? sx : tx, air > 0 ? sy : ty, 1);
    this.mem = { root, sx, sy, tx, ty, air };
    this.age = 0;
  }

  get landed(): boolean {
    return this.mem.air <= 0;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    const m = this.mem;
    if (m.air <= 0) return;
    m.air = Math.max(0, m.air - dt);
    const t = 1 - m.air / EMBER_FLIGHT;
    this.x = m.sx + (m.tx - m.sx) * t;
    this.y = m.sy + (m.ty - m.sy) * t;
    this.z = Math.sin(t * Math.PI) * 16;
    if (m.air <= 0) {
      this.x = m.tx;
      this.y = m.ty;
      this.z = 0;
      w.spawn(new RingFx(this.x, this.y, 12, 0.35, EMBER, 1));
      w.particles.burst(this.x, this.y - 2, { count: 8, speed: [20, 60], life: [0.2, 0.5], colors: [EMBER_HI, EMBER, '#ff9a3a'], size: [1, 2], shape: 'spark', additive: true });
    }
  }

  override draw(r: Renderer, w: World): void {
    const m = this.mem;
    const bob = m.air > 0 ? 0 : Math.round(Math.sin(this.age * 4) * 0.6);
    if (m.air > 0) {
      // the gold landing ring marks the spot
      r.pixelRing(m.tx, m.ty, 6, EMBER, 1, 0.75);
      r.shadow(this.x, this.y + 1, 6, 2, 0.25);
    } else {
      const k = 0.5 + 0.5 * Math.sin(this.age * 6);
      r.pixelRing(this.x, this.y, 7 + k * 2, EMBER, 1, 0.35 + 0.35 * k);
      r.shadow(this.x, this.y + 1, 7, 3, 0.3);
      // a short shaft of light above it
      r.rect(this.x, this.y - 14 - bob, 1, 6, EMBER_HI, 0.25 + 0.15 * k);
    }
    r.sprite('hunt_ember', this.x, this.y - 4 - this.z + bob);
    if (m.air <= 0 && Math.floor(w.time * 3) % 3 === 0) r.rect(this.x - 1, this.y - 7 + bob, 1, 1, '#ffffff', 0.8);
  }

  override light(w: World): void {
    w.lights.add(this.x, this.y - 4 - this.z, 30, EMBER, { intensity: 0.7 });
  }
}

/** 마름쇠: an iron caltrop the thief scatters behind it. Harmless while it settles, then pricks once. */
export class HuntCaltrop extends Entity {
  mem: { root: number };
  constructor(x: number, y: number, root: number) {
    super();
    this.x = x;
    this.y = y;
    this.mem = { root };
    this.team = 'enemy';
    this.layer = 0;
    this.r = 3;
    this.tileCollide = false;
    this.enemyHazard = true;
  }

  get armed(): boolean {
    return this.age >= CALTROP_ARM;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= CALTROP_LIFE) {
      this.dead = true;
      return;
    }
    if (!this.armed) return;
    for (const p of w.targets()) {
      if (!p.alive || p.z > 4 || Math.hypot(p.x - this.x, p.y - this.y) > p.r + this.r) continue;
      if (p.hurt(w, 1, '마름쇠', false, this)) {
        this.dead = true;
        w.particles.burst(this.x, this.y, { count: 5, speed: [20, 60], life: [0.15, 0.3], colors: ['#ffffff', '#ffb040', '#8a8a9a'], size: [1, 1], shape: 'spark' });
        return;
      }
    }
  }

  override draw(r: Renderer, w: World): void {
    const left = CALTROP_LIFE - this.age;
    if (left < 0.6 && Math.floor(w.time * 14) % 2) return;
    r.sprite(this.armed ? 'hunt_caltrop_1' : 'hunt_caltrop_0', this.x, this.y);
  }
}

/** Equipment on the wall above the room: net, snare and a wanted poster. */
class HuntRack extends Prop {
  constructor(x: number, y: number) {
    super(x, y, 1);
  }
  override draw(r: Renderer): void {
    r.sprite('equipment_hunt', this.x, this.y);
  }
}

/** Purely visual: an ember flying from where it was picked up to the tree. */
class EmberFlight extends Entity {
  static override readonly cosmetic = true;
  constructor(readonly sx: number, readonly sy: number, readonly tx: number, readonly ty: number) {
    super();
    this.x = sx;
    this.y = sy;
    this.layer = 3;
    this.tileCollide = false;
  }
  override update(w: World, dt: number): void {
    this.age += dt;
    const t = Math.min(1, this.age / 0.4);
    this.x = this.sx + (this.tx - this.sx) * t;
    this.y = this.sy + (this.ty - this.sy) * t - Math.sin(t * Math.PI) * 18;
    if (fx.chance(0.7)) w.particles.spawn({ x: this.x, y: this.y, vx: fx.range(-8, 8), vy: fx.range(-8, 8), life: fx.range(0.2, 0.4), colors: [EMBER_HI, EMBER], size: 1, additive: true });
    if (t >= 1) {
      this.dead = true;
      w.particles.burst(this.tx, this.ty, { count: 12, speed: [20, 70], life: [0.2, 0.5], colors: ['#ffffff', EMBER_HI, EMBER], size: [1, 2], shape: 'spark', additive: true });
    }
  }
  override draw(r: Renderer): void {
    r.sprite('hunt_ember', this.x, this.y);
  }
  override light(w: World): void {
    w.lights.add(this.x, this.y, 24, EMBER, { intensity: 0.8 });
  }
}

/** Purely visual: the empty lantern the thief drops when it gives up. */
class DroppedLantern extends Prop {
  static override readonly cosmetic = true;
  override draw(r: Renderer): void {
    r.shadow(this.x, this.y + 1, 9, 3, 0.3);
    r.sprite('hunt_lantern_dropped', this.x, this.y - 2);
  }
}

// ================================================================== art
const IRON = ['#141019', '#2a2433', '#454056', '#6e6a80', '#a8a4b8'];
const BRASS = ['#4a2e16', '#7a5530', '#c39c65', '#efd9a4'];
const VIOLET = ['#1a0c24', '#3a1c58', '#7a4aa8', '#c9a0ff'];

/** Cracked lantern 7x10 whose glass (5x4) is centred near (x, gy): peaked cap, brass frame, empty dark panes. */
function paintTreeLantern(p: PixelPainter, x: number, gy: number, crackSide: number): void {
  const top = gy - 6;
  p.px(x, top, IRON[3]);
  p.px(x, top + 1, BRASS[3]);
  p.rect(x - 1, top + 2, 3, 1, BRASS[2]);
  p.px(x - 1, top + 2, BRASS[3]);
  p.rect(x - 3, top + 3, 7, 1, BRASS[2]);
  p.px(x - 3, top + 3, BRASS[3]);
  p.px(x + 3, top + 3, BRASS[1]);
  // frame posts and panes
  p.rect(x - 3, top + 4, 7, 4, BRASS[1]);
  p.line(x - 3, top + 4, x - 3, top + 7, BRASS[2]);
  p.rect(x - 2, top + 4, 5, 4, '#221822');
  p.px(x - 2, top + 4, '#5e4e5c');
  p.px(x - 1, top + 4, '#3e3240');
  p.line(x, top + 4, x, top + 7, '#4a3a2a');
  // a crack across the glass
  p.px(x + crackSide, top + 5, '#b0a0b0');
  p.px(x + crackSide * 2, top + 6, '#8a7a8a');
  p.px(x - crackSide, top + 6, '#8a7a8a');
  p.rect(x - 2, top + 8, 5, 1, BRASS[1]);
  p.px(x - 2, top + 8, BRASS[2]);
  p.px(x, top + 9, BRASS[0]);
}

/** A 2 px wrought-iron stroke: lit upper edge, shaded lower edge. */
function ironStroke(p: PixelPainter, pts: number[][]): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    p.line(ax, ay + 1, bx, by + 1, IRON[1]);
    p.line(ax, ay, bx, by, IRON[3]);
  }
  for (let i = 1; i < pts.length - 1; i++) p.px(pts[i][0], pts[i][1], IRON[4]);
}

/** Glass centres of the three lamps on the tree sprite (42x44, origin 21,42): left, right, top. */
const TREE_LAMPS: [number, number][] = [[8, 25], [34, 21], [13, 11]];

// The iron lamp tree: a riveted plinth gouged by claws, a twisted trunk with brass collars,
// two scrolled arms and a crook top, each hook holding a cracked, empty lantern; moss in the
// joints and a tipped oil can bleeding into the floor.
defineDrawnSprite('device_hunt', 42, 44, (p) => {
  // oil spill and the plinth's footprint
  p.ellipse(33, 41.5, 7, 1.6, '#1a1218');
  p.ellipse(20, 41, 13, 2.4, '#141019');
  // plinth: top face, front face, rim, rivets, claw gouges
  p.ellipse(20, 34.5, 10.5, 2.6, IRON[3]);
  p.ellipse(20, 34.2, 8.5, 1.7, IRON[4]);
  p.rect(10, 35, 21, 5, IRON[2]);
  p.rect(10, 35, 2, 5, IRON[3]);
  p.rect(28, 35, 3, 5, IRON[1]);
  p.rect(9, 40, 23, 2, IRON[1]);
  p.line(9, 40, 31, 40, IRON[3]);
  for (const x of [12, 28]) p.px(x, 37, '#c8c4d4');
  for (const x of [15, 19, 23]) { p.line(x, 36, x + 2, 39, '#120c16'); p.line(x + 1, 36, x + 3, 39, '#9a96ac'); }
  // trunk: a twisted bar with a brass collar at the foot and the waist
  p.rect(18, 12, 5, 23, IRON[2]);
  p.line(18, 12, 18, 34, IRON[3]);
  p.line(22, 12, 22, 34, IRON[1]);
  for (let y = 13; y < 33; y += 4) { p.line(19, y + 2, 21, y, IRON[4]); p.px(21, y + 2, IRON[1]); }
  p.rect(17, 31, 7, 3, BRASS[1]);
  p.line(17, 31, 23, 31, BRASS[3]);
  p.px(23, 33, BRASS[0]);
  p.rect(17, 20, 7, 2, BRASS[1]);
  p.line(17, 20, 23, 20, BRASS[2]);
  // left arm: scrolls out low and down into a hook
  ironStroke(p, [[18, 23], [14, 21], [10, 19], [7, 18], [5, 18], [4, 19]]);
  p.px(4, 20, IRON[3]);
  p.px(5, 21, IRON[2]);
  p.line(8, 19, 8, 18, IRON[3]);
  // right arm: higher, sweeping up and out
  ironStroke(p, [[22, 19], [26, 16], [30, 14], [33, 13], [35, 13], [36, 14]]);
  p.px(37, 15, IRON[3]);
  p.px(36, 16, IRON[2]);
  // crook top: the trunk rises and curls back over to the left
  ironStroke(p, [[20, 12], [20, 7], [19, 4], [17, 2], [14, 2], [12, 3]]);
  p.px(12, 4, IRON[3]);
  p.px(19, 1, IRON[2]);
  p.px(21, 9, IRON[4]);
  // hooks down to the lanterns
  p.line(5, 21, 8, 18, IRON[2]);
  // the three empty lanterns
  paintTreeLantern(p, TREE_LAMPS[0][0], TREE_LAMPS[0][1], 1);
  paintTreeLantern(p, TREE_LAMPS[1][0], TREE_LAMPS[1][1], -1);
  paintTreeLantern(p, TREE_LAMPS[2][0], TREE_LAMPS[2][1], 1);
  // moss tufts in the joints (the room's lime-moss mark)
  for (const [x, y] of [[11, 34], [12, 33], [26, 34], [27, 33], [17, 30], [23, 22]]) p.px(x, y, '#5c8a30');
  for (const [x, y] of [[12, 34], [26, 33], [17, 29]]) p.px(x, y, '#b6e36e');
  // tipped oil can: body, rim, spout, a drip
  p.poly([28, 36, 36, 34, 38, 39, 30, 41], '#4e5e46');
  p.line(28, 36, 36, 34, '#8a9a70');
  p.line(29, 37, 35, 35.5, '#6a7a58');
  p.line(30, 41, 38, 39, '#2a3426');
  p.rect(36, 34, 2, 4, '#3a4834');
  p.px(36, 34, '#a8b88a');
  p.rect(38, 36, 2, 2, BRASS[2]);
  p.px(39, 36, BRASS[3]);
  p.px(40, 39, '#2a2026');
  p.px(39, 40, '#2a2026');
}, { outline: '#0c0810', origin: [21, 42] });

// a lit lamp: drawn over a lantern's panes once its ember is back
defineDrawnSprite('hunt_lamp_lit', 5, 4, (p) => {
  p.rect(0, 0, 5, 4, '#ffb347');
  p.rect(1, 0, 3, 4, EMBER);
  p.rect(1, 1, 3, 2, EMBER_HI);
  p.px(2, 1, '#ffffff');
  p.line(2, 0, 2, 3, '#fff8e0');
}, { origin: [2, 2] });

// a stolen ember: gold flame, white heart, dark rim
defineDrawnSprite('hunt_ember', 7, 9, (p) => {
  p.poly([3.5, 0, 6.5, 5, 5.5, 8.5, 1.5, 8.5, 0.5, 5], '#e07a1e');
  p.poly([3.5, 1.5, 5.5, 5.5, 4.8, 7.8, 2.2, 7.8, 1.5, 5.5], EMBER);
  p.poly([3.5, 3.5, 4.6, 6, 4, 7.6, 3, 7.6, 2.4, 6], EMBER_HI);
  p.px(3, 6, '#ffffff');
  p.px(3, 7, '#ffffff');
}, { outline: '#3a1206', origin: [3, 8] });

// shadow crack in the floor at the wall base (top wall; the others are drawn flipped / turned):
// a dark gap under the wall with a violet-lit lip, splits running into the floor
function paintCrack(p: PixelPainter, w: number, h: number, sealed: boolean, side: boolean): void {
  const L = side ? h : w;
  const put = (a: number, b: number, c: string) => (side ? p.px(b, a, c) : p.px(a, b, c));
  const mid = (L - 1) / 2;
  for (let a = 1; a < L - 1; a++) {
    const k = 1 - Math.abs(a - mid) / (mid + 0.5);
    const depth = Math.max(1, Math.round(k * 4.4 + (a % 3 === 1 ? 0.6 : 0)));
    for (let b = 0; b < depth; b++) put(a, b, b < depth - 1 ? (b === 0 ? '#06030a' : VIOLET[0]) : VIOLET[2]);
    if (depth >= 3) put(a, depth - 2, VIOLET[1]);
  }
  // splits into the floor
  for (const [a0, b0, a1, b1] of [[2, 1, 0, 4], [L - 3, 1, L - 1, 5], [Math.round(mid) - 1, 4, Math.round(mid) - 2, 7], [Math.round(mid) + 2, 4, Math.round(mid) + 4, 6]]) {
    const n = Math.max(Math.abs(a1 - a0), Math.abs(b1 - b0));
    for (let i = 0; i <= n; i++) put(Math.round(a0 + ((a1 - a0) * i) / n), Math.round(b0 + ((b1 - b0) * i) / n), i === n ? VIOLET[1] : VIOLET[0]);
  }
  if (!sealed) {
    put(Math.round(mid), 1, VIOLET[3]);
    put(Math.round(mid) - 3, 1, VIOLET[2]);
    return;
  }
  // a nailed plank over it with a chalk X
  for (let a = 1; a < L - 1; a++) for (let b = 1; b < 6; b++) put(a, b, b === 1 ? '#d0a070' : b === 5 ? '#5a3a20' : (a + b * 3) % 7 === 0 ? '#6a4428' : '#8a5e34');
  put(2, 3, '#e0e0e8');
  put(L - 3, 3, '#e0e0e8');
  const c = Math.round(mid);
  for (const [a, b] of [[c - 2, 2], [c - 1, 3], [c, 4], [c, 2], [c - 2, 4]]) put(a, b, '#f4f0e4');
}
defineDrawnSprite('hunt_crack', 16, 10, (p) => paintCrack(p, 16, 10, false, false), { outline: '#0c0810', origin: [8, 4] });
defineDrawnSprite('hunt_crack_sealed', 16, 10, (p) => paintCrack(p, 16, 10, true, false), { outline: '#0c0810', origin: [8, 4] });
defineDrawnSprite('hunt_crack_side', 10, 16, (p) => paintCrack(p, 10, 16, false, true), { outline: '#0c0810', origin: [4, 8] });
defineDrawnSprite('hunt_crack_side_sealed', 10, 16, (p) => paintCrack(p, 10, 16, true, true), { outline: '#0c0810', origin: [4, 8] });

// caltrop: settling (dim) and armed (iron star, hot tips, a glint)
defineDrawnSprite('hunt_caltrop_0', 5, 5, (p) => {
  p.px(2, 1, '#4a4a58'); p.px(1, 2, '#4a4a58'); p.px(3, 2, '#4a4a58'); p.px(2, 3, '#4a4a58'); p.px(2, 2, '#6a6a7a');
}, { outline: '#0c0810', origin: [2, 2] });
defineDrawnSprite('hunt_caltrop_1', 5, 5, (p) => {
  p.line(2, 0, 2, 4, '#8a8a9a'); p.line(0, 2, 4, 2, '#8a8a9a');
  p.px(2, 0, '#ffb040'); p.px(0, 2, '#ffb040'); p.px(4, 2, '#ffb040'); p.px(2, 4, '#ffb040');
  p.px(2, 2, '#ffffff'); p.px(1, 1, '#5a5a6a'); p.px(3, 3, '#5a5a6a');
}, { outline: '#0c0810', origin: [2, 2] });

defineDrawnSprite('hunt_lantern_dropped', 9, 6, (p) => {
  // lying on its side: cap left, base right
  p.rect(0, 1, 1, 4, BRASS[2]);
  p.rect(1, 0, 6, 6, BRASS[1]);
  p.rect(1, 1, 6, 4, '#241a22');
  p.line(1, 1, 6, 1, '#5a4a58');
  p.rect(7, 0, 1, 6, BRASS[2]);
  p.px(8, 2, BRASS[1]);
  p.px(4, 2, '#9a8a98'); p.px(5, 3, '#9a8a98');
}, { outline: '#0c0810', origin: [4, 5] });

// wall equipment: a coiled net, a snare loop and a wanted poster (mask + three flames)
defineDrawnSprite('equipment_hunt', 38, 27, (p) => {
  p.rect(1, 1, 36, 25, '#242131');
  p.rect(2, 2, 34, 2, '#827680');
  p.rect(3, 24, 32, 2, '#13121d');
  for (const x of [3, 34]) { p.line(x, 4, x, 23, '#574b5b'); p.px(x, 3, '#baaa95'); }
  // coiled net on a peg
  p.px(9, 5, '#baaa95');
  p.ellipse(9, 14, 5, 7, '#6a5a44');
  for (let y = 9; y < 21; y += 2) p.line(5, y, 13, y + 1, '#a08a64');
  for (let x = 6; x < 13; x += 3) p.line(x, 8, x - 1, 20, '#8a7452');
  p.line(9, 5, 9, 8, '#a08a64');
  // snare loop
  p.line(18, 5, 18, 10, '#c0a878');
  p.ring(18, 14, 4, 1, '#c0a878');
  p.px(18, 18, '#7a6a50');
  // wanted poster
  p.rect(23, 5, 11, 15, '#d8c8a0');
  p.rect(23, 5, 11, 1, '#f0e4c4');
  p.rect(24, 19, 10, 1, '#9a8a68');
  p.ellipse(28, 10, 3.5, 2.5, '#3a2a30');
  p.rect(25, 9, 7, 2, INK);
  p.px(26, 9, '#ffe27a');
  p.px(30, 9, '#ffe27a');
  for (const x of [25, 28, 31]) { p.px(x, 16, EMBER); p.px(x, 15, '#ff9a3a'); }
  p.px(28, 4, '#8a8a9a');
}, { outline: '#100c18', origin: [19, 27] });

definePixelSprite('map_hunt', { p: HUNT_COLOR }, ['p.p.p', '.....', '.ppp.', 'ppppp', '.p.p.'], { outline: '#0c0810' });

// ================================================================== floor dressing
function pawPair(p: PixelPainter, x: number, y: number, a: number): void {
  const nx = -Math.sin(a) * 2;
  const ny = Math.cos(a) * 2;
  for (const s of [-1, 1]) {
    const px = Math.round(x + nx * s);
    const py = Math.round(y + ny * s);
    ap(p, px, py, '#1a1018', 0.55);
    ap(p, px + 1, py, '#1a1018', 0.4);
    ap(p, px, py - 1, '#1a1018', 0.3);
  }
}

function dressHunt(p: PixelPainter, room: Room, cracks: CrackSpot[], rng: RNG): void {
  const cx = room.centerX;
  const cy = room.centerY;
  // oil stain and broken glass under the tree
  for (let y = -9; y <= 9; y++) for (let x = -20; x <= 20; x++) {
    const d = (x * x) / 400 + (y * y) / 81;
    if (d < 1) ap(p, cx + x, cy + 4 + y, '#140c10', 0.32 * (1 - d) + 0.08);
  }
  for (let i = 0; i < 14; i++) {
    const x = Math.round(cx + rng.range(-22, 22));
    const y = Math.round(cy + 2 + rng.range(-8, 10));
    ap(p, x, y, i % 3 ? '#a8b8c8' : '#e8f0ff', 0.55);
  }
  // chalk tally: three strokes, one per stolen ember
  for (let i = 0; i < 3; i++) p.line(cx + 26 + i * 3, cy + 6, cx + 25 + i * 3, cy + 12, '#cfc8b8');
  p.line(cx + 24, cy + 10, cx + 34, cy + 7, '#9a9488');
  // paw prints leading into each crack
  for (const c of cracks) {
    const a = Math.atan2(c.y - cy, c.x - cx);
    for (let k = 1; k <= 4; k++) {
      const t = 10 + k * 9;
      pawPair(p, c.x - Math.cos(a) * t, c.y - Math.sin(a) * t, a);
    }
  }
}

// ================================================================== handler
registerRoomHandler('hunt', {
  clearOnEnter: false,
  populate(w, room, rng) {
    const cx = room.centerX;
    const cy = room.centerY;
    const cracks = huntCracks(room, rng);
    // decals draw only in the browser: their randomness must not come from the room rng
    withDecals(room, (p) => dressHunt(p, room, cracks, new RNG(room.node.seed ^ 0x4b17)));
    const root = w.spawn(new HuntDevice(cx, cy));
    w.spawn(new HuntEscapeFx(root.id));
    const m = root.mem as Record<string, number | boolean>;
    cracks.forEach((c, i) => {
      m[`c${i}x`] = c.x;
      m[`c${i}y`] = c.y;
      m[`c${i}f`] = c.face;
      w.spawn(new HuntCrack(c.x, c.y, c.face, i, root.id));
    });
    // hang above the floor lanes, leaving doors and spawn space readable (same slots as the other missions)
    for (const x of [cx - 74, cx + 74]) w.spawn(new HuntRack(x, cy - 65));
  },
  spawnEnemies() {
    return false;
  },
  onEnter(w) {
    if (w.node.cleared) return;
    const d = w.entities.find((e) => e instanceof HuntDevice) as HuntDevice | undefined;
    if (d && d.mem.phase === 1 && !d.mem.used) {
      d.abandoned(w);
      return;
    }
    w.holdClear = Math.max(w.holdClear, 1);
    w.banner(`${HUNT_TITLE} · ${LABEL}`, '장치 가까이에서 진행 방법을 확인하세요 · 시작 전에는 자유롭게 나갈 수 있습니다', { small: true });
  },
});
