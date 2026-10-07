// Boss skills, floors 5–7 (see resolve.ts) — the deep bosses' skills are harsher and
// stay up longer; each asks for a riskier answer:
//  무명         어둠의 실체 — it only has a body inside a keeper's lantern light: from
//                            afar it takes a sliver of the damage. The light it needs
//                            shrinks at every phase change (come closer and closer)
//  대서기관     봉인 문장   — seals itself with glyphs written on the floor; it cannot be
//                            hurt until a keeper has stood on every glyph
//  가라앉은 등대 해무        — sea fog rolls in: the tower only shows when its lamp flares
//                            (a short window every few seconds); in the dark, shots are lost
//  시계장인     되감기       — winds its key and turns its own clock back (heals what it
//                            lost in the last seconds) unless struck hard during the wind-up
//  태엽 무희    왈츠         — dances to the music box: only blows that land on the beat
//                            truly hurt, off-beat ones glance off

import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import { fx } from '../../engine/rng';
import { BEAT } from '../enemies/clock-shared';
import { announceWard, blockedFx, daze, defineBossWard, freeSpot, keepers } from './resolve';

const bodyY = (e: Enemy): number => e.y - e.z - e.r * 0.8;

// ================================================================== 무명: 어둠의 실체
/** Lantern light the keeper must bring (px beyond its body), by gates passed; damage through from the dark. */
export const LIGHT_REACH = [96, 80, 66];
export const DARK_THROUGH = 0.15;

export function mumyeongLit(w: World, e: Enemy): boolean {
  const reach = LIGHT_REACH[Math.min(LIGHT_REACH.length - 1, e.mem.rsGate ?? 0)];
  return keepers(w).some((p) => Math.hypot(p.x - e.x, p.y - e.y) - e.r <= reach);
}

defineBossWard('mumyeong', {
  name: '어둠의 실체',
  hint: '등불 빛이 닿는 거리 안에서만 실체가 드러납니다 · 단계가 오를수록 더 가까이 가야 합니다',
  color: '#c8a8ff',
  begin(e, w) {
    e.mem.wdSeen = 0;
    void w;
  },
  update(e, w) {
    // the banner the first time it hides in the dark
    if (!e.mem.wdSeen && e.dormant <= 0 && !mumyeongLit(w, e)) {
      e.mem.wdSeen = 1;
      announceWard(e, w);
    }
  },
  phase(e, w) {
    w.sfx('beam_charge', { vol: 0.4, pitch: 0.5 });
    void e;
  },
  filter(e, w, hit, dmg) {
    if (mumyeongLit(w, e)) return dmg;
    if (hit.kind !== 'status' && fx.chance(0.5)) w.particles.burst(e.x + fx.range(-10, 10), bodyY(e) + fx.range(-8, 8), { count: 3, speed: [10, 40], life: [0.2, 0.4], colors: ['#2a1a3a', '#4a2a6a', '#120a1c'], size: [1, 2] });
    return dmg * DARK_THROUGH;
  },
  active: (e, w) => !mumyeongLit(w, e),
  draw(r, w, e, t) {
    const lit = mumyeongLit(w, e);
    const reach = LIGHT_REACH[Math.min(LIGHT_REACH.length - 1, e.mem.rsGate ?? 0)];
    const rad = reach + e.r;
    // the edge of the light it needs, dashed on the floor
    const n = 40;
    for (let i = 0; i < n; i += 2) {
      const a = -t * 0.15 + (i / n) * Math.PI * 2;
      const x = Math.round(e.x + Math.cos(a) * rad);
      const y = Math.round(e.y + Math.sin(a) * rad * 0.8);
      r.rect(x - 1, y, 4, 1, '#06030a', 0.6);
      r.rect(x, y, 2, 1, lit ? '#ffe8a0' : '#b08aff', lit ? 0.8 : 0.65);
    }
    if (lit) return;
    // out of the light: smoke swallows its body, only the eye glints through
    const cy = bodyY(e);
    r.pixelDisc(e.x, cy, e.r * 1.15, '#06030a', 0.5);
    for (let i = 0; i < 12; i++) {
      const a = t * 0.7 + i * 0.55;
      const k = (i % 3) / 3;
      r.pixelDisc(e.x + Math.cos(a) * e.r * (0.4 + k * 0.6), cy + Math.sin(a * 1.3) * e.r * 0.6, 6 + (i % 4), '#0c0614', 0.4);
    }
  },
});

// ================================================================== 대서기관: 봉인 문장
/** Glyphs per sealing (by gates passed), seconds a keeper must stand on one, longest a seal holds. */
export const SEALS = [3, 4];
export const SEAL_STAND = 0.5;
export const SEAL_TIME = 16;
const GLYPH = ['#1a3a9a', '#56e8ff', '#f0ffff'];
const INK = '#0a0e1c';

function seal(e: Enemy, w: World): void {
  const m = e.mem;
  const n = SEALS[Math.min(SEALS.length - 1, m.rsGate ?? 0)];
  const spots: { x: number; y: number }[] = [];
  for (let i = 0; i < 4; i++) {
    if (i < n) {
      const at = freeSpot(w, e, 64, spots);
      spots.push(at);
      m[`wdS${i}x`] = at.x;
      m[`wdS${i}y`] = at.y;
      m[`wdS${i}p`] = 0;
    } else m[`wdS${i}p`] = -1;
  }
  m.wdSeal = 1;
  m.wdSealT = SEAL_TIME;
  w.sfx('quill_write', { vol: 0.6, pitch: 0.8 });
  w.sfx('page_rip', { vol: 0.4, pitch: 0.7 });
  announceWard(e, w);
}

function unseal(e: Enemy, w: World, broken: boolean): void {
  e.mem.wdSeal = 0;
  e.mem.wdNext = 24;
  if (broken) {
    daze(e, w, 2);
    w.sfx('ink_burst', { vol: 0.6, pitch: 1.1 });
    w.particles.burst(e.x, bodyY(e), { count: 20, speed: [40, 140], life: [0.3, 0.6], colors: [GLYPH[2], GLYPH[1], GLYPH[0]], size: [1, 2], shape: 'spark', additive: true });
  }
}

export function sealsLeft(e: Enemy): number {
  let n = 0;
  for (let i = 0; i < 4; i++) if ((e.mem[`wdS${i}p`] ?? -1) >= 0) n++;
  return n;
}

defineBossWard('grand_archivist', {
  name: '봉인 문장',
  hint: '바닥에 쓰인 봉인 문장을 모두 밟아 지워야 대서기관에게 피해가 들어갑니다',
  color: '#56e8ff',
  begin(e) {
    e.mem.wdSeal = 0;
    e.mem.wdNext = 9;
  },
  phase(e, w) {
    seal(e, w);
  },
  update(e, w, dt) {
    const m = e.mem;
    if (!m.wdSeal) {
      if (!m.rsHold && (m.wdNext -= dt) <= 0) seal(e, w);
      return;
    }
    m.wdSealT -= dt;
    for (let i = 0; i < 4; i++) {
      const pk = `wdS${i}p`;
      if (m[pk] < 0) continue;
      const x = m[`wdS${i}x`];
      const y = m[`wdS${i}y`];
      const on = keepers(w).some((p) => Math.hypot(p.x - x, p.y - y) <= 11);
      m[pk] = on ? m[pk] + dt / SEAL_STAND : Math.max(0, m[pk] - dt / (SEAL_STAND * 2));
      if (m[pk] >= 1) {
        m[pk] = -1;
        w.sfx('page_rip', { vol: 0.5, pitch: 1.3 });
        w.particles.burst(x, y - 2, { count: 12, speed: [30, 100], life: [0.25, 0.5], colors: [GLYPH[2], GLYPH[1]], size: [1, 2], shape: 'spark', additive: true });
      }
    }
    if (sealsLeft(e) === 0) unseal(e, w, true);
    else if (m.wdSealT <= 0) unseal(e, w, false);
  },
  filter(e, w, hit) {
    if (!e.mem.wdSeal) return hit.damage;
    blockedFx(e, w, hit, ['#ffffff', GLYPH[1], GLYPH[0]]);
    return 0;
  },
  active: (e) => !!e.mem.wdSeal,
  draw(r, _w, e, t) {
    const m = e.mem;
    if (!m.wdSeal) return;
    const cy = bodyY(e);
    // a ring of written script around it
    r.pixelRing(e.x, cy, e.r + 10, GLYPH[1], 1, 0.55 + 0.2 * Math.sin(t * 5));
    for (let i = 0; i < 4; i++) {
      const p = m[`wdS${i}p`] ?? -1;
      if (p < 0) continue;
      const x = m[`wdS${i}x`];
      const y = m[`wdS${i}y`];
      // an ink thread from the glyph to the scribe
      r.pixelLine(x, y - 2, e.x, cy, INK, 1, 0.6);
      const k = (t * 0.7 + i * 0.25) % 1;
      r.rect(Math.round(x + (e.x - x) * k), Math.round(y - 2 + (cy - y + 2) * k), 1, 1, GLYPH[1], 0.9);
      // the glyph itself: a circle with a rune, the standing progress around it
      r.pixelDisc(x, y, 9, INK, 0.5);
      r.pixelRing(x, y, 9, GLYPH[1], 1, 0.9);
      const pulse = Math.floor(t * 6 + i) % 2;
      r.pixelLine(x - 4, y - 3, x + 4, y - 3, GLYPH[pulse ? 2 : 1], 1, 0.95);
      r.pixelLine(x, y - 5, x, y + 4, GLYPH[pulse ? 2 : 1], 1, 0.95);
      r.pixelLine(x - 4, y + 3, x + 3, y - 1, GLYPH[1], 1, 0.9);
      if (p > 0) {
        const steps = Math.ceil(p * 16);
        for (let s = 0; s < steps; s++) {
          const a = -Math.PI / 2 + (s / 16) * Math.PI * 2;
          r.rect(Math.round(x + Math.cos(a) * 12), Math.round(y + Math.sin(a) * 12), 1, 1, '#ffffff', 1);
        }
      }
    }
    // seconds left before it lets the seal go on its own
    if (m.wdSealT < 4 && Math.floor(t * 8) % 2) r.pixelRing(e.x, cy, e.r + 13, GLYPH[2], 1, 0.4);
  },
  light(w, e) {
    const m = e.mem;
    if (!m.wdSeal) return;
    for (let i = 0; i < 4; i++) if ((m[`wdS${i}p`] ?? -1) >= 0) w.lights.add(m[`wdS${i}x`], m[`wdS${i}y`], 30, GLYPH[1], { intensity: 0.5 });
  },
});

// ================================================================== 가라앉은 등대: 해무
/** Fog: seconds it lasts, the lamp's cycle and how long it flares in each, damage through in the dark. */
export const FOG_TIME = 10;
export const FOG_CYCLE = 2.6;
export const FOG_FLARE = 0.9;
export const FOG_THROUGH = 0.15;

export function lampFlaring(w: World, e: Enemy): boolean {
  if (!e.mem.wdFog) return true;
  return ((w.time - e.mem.wdFogAt) % FOG_CYCLE) >= FOG_CYCLE - FOG_FLARE;
}

function fogIn(e: Enemy, w: World): void {
  e.mem.wdFog = 1;
  e.mem.wdFogT = FOG_TIME;
  e.mem.wdFogAt = w.time;
  w.sfx('foghorn', { vol: 0.6, pitch: 0.8 });
  w.sfx('water_surge', { vol: 0.4, pitch: 0.7 });
  announceWard(e, w);
}

defineBossWard('sunken_lighthouse', {
  name: '해무',
  hint: '짙은 안개 속에서는 등불이 번쩍이는 순간에만 탑이 드러납니다 · 번쩍일 때 공격하세요',
  color: '#ffd978',
  begin(e) {
    e.mem.wdFog = 0;
    e.mem.wdFogT = 0;
    e.mem.wdFogAt = 0;
    e.mem.wdNext = 7;
  },
  phase(e, w) {
    fogIn(e, w);
  },
  update(e, w, dt) {
    const m = e.mem;
    if (m.wdFog) {
      const was = lampFlaring(w, e);
      m.wdFogT -= dt;
      if (m.wdFogT <= 0) {
        m.wdFog = 0;
        // after its phase change the fog comes back sooner
        m.wdNext = (m.rsGate ?? 0) >= 1 ? 10 : 16;
        return;
      }
      const now = lampFlaring(w, e);
      if (now && !was) w.sfx('lamp_hum', { vol: 0.35, pitch: 1.4 });
    } else if (!m.rsHold && (m.wdNext -= dt) <= 0) fogIn(e, w);
  },
  filter(e, w, hit, dmg) {
    if (lampFlaring(w, e)) return dmg;
    if (hit.kind !== 'status' && fx.chance(0.4)) w.particles.burst(e.x + fx.range(-10, 10), bodyY(e) + fx.range(-10, 10), { count: 2, speed: [10, 30], life: [0.3, 0.5], colors: ['#8aa8b0', '#5a7880'], size: [1, 2] });
    return dmg * FOG_THROUGH;
  },
  active: (e, w) => !!e.mem.wdFog && !lampFlaring(w, e),
  draw(r, w, e, t) {
    const m = e.mem;
    if (!m.wdFog) return;
    const flare = lampFlaring(w, e);
    const fade = Math.min(1, (FOG_TIME - m.wdFogT) / 0.8, m.wdFogT / 0.8);
    // banks of fog drifting round the tower
    for (let i = 0; i < 14; i++) {
      const a = t * (0.12 + (i % 3) * 0.04) + i * 0.45;
      const d = e.r + 6 + (i % 4) * 9;
      r.pixelDisc(e.x + Math.cos(a) * d, e.y - 10 + Math.sin(a) * d * 0.6, 8 + (i % 3) * 3, '#8aa8b0', (flare ? 0.08 : 0.2) * fade);
    }
    // the lamp: dark, then a flare that shows the tower
    const ly = e.y - e.z - e.r * 1.6;
    const k = ((w.time - m.wdFogAt) % FOG_CYCLE) / FOG_CYCLE;
    if (flare) {
      r.pixelRing(e.x, ly, 10 + (1 - k) * 8, '#fff4c0', 1, 0.8 * fade);
      r.pixelRing(e.x, bodyY(e), e.r + 8, '#ffd978', 1, 0.6 * fade);
    } else if (k > 0.5) {
      // it gathers before it flares
      r.pixelRing(e.x, ly, 4 + (k - 0.5) * 12, '#ffd978', 1, 0.35 * fade);
    }
  },
  light(w, e) {
    if (e.mem.wdFog && lampFlaring(w, e)) w.lights.add(e.x, e.y - 20, 90, '#ffe8a0', { intensity: 0.7 });
  },
});

// ================================================================== 시계장인: 되감기
/** Wind-up seconds, damage (share of max HP) that breaks it, seconds turned back, most it can heal. */
export const REWIND_WIND = 1.4;
export const REWIND_BREAK = 0.03;
export const REWIND_BACK = 5;
export const REWIND_CAP = 0.12;
const AMBER = ['#5a3008', '#a8641a', '#ffb04a', '#ffe8b0'];

function windUp(e: Enemy, w: World): void {
  e.mem.wdWind = 1;
  e.mem.wdWindT = REWIND_WIND;
  e.mem.wdWindDmg = 0;
  w.sfx('clockboss_wind', { vol: 0.6, pitch: 1 });
  announceWard(e, w);
}

defineBossWard('clockmaker', {
  name: '되감기',
  hint: '태엽을 감아 몇 초 전의 체력으로 되돌아갑니다 · 감는 동안 크게 때려 끊어내세요',
  color: '#ffb04a',
  begin(e) {
    const m = e.mem;
    m.wdWind = 0;
    m.wdNext = 9;
    m.wdHT = 0;
    m.wdHi = 0;
    for (let i = 0; i < REWIND_BACK; i++) m[`wdH${i}`] = e.hp;
  },
  phase(e) {
    e.mem.wdNext = Math.min(e.mem.wdNext, 2.4);
  },
  update(e, w, dt) {
    const m = e.mem;
    // one HP sample a second, the last REWIND_BACK seconds
    m.wdHT += dt;
    if (m.wdHT >= 1) {
      m.wdHT -= 1;
      m[`wdH${m.wdHi}`] = e.hp;
      m.wdHi = (m.wdHi + 1) % REWIND_BACK;
    }
    if (!m.wdWind) {
      if (!m.rsHold && (m.wdNext -= dt) <= 0) windUp(e, w);
      return;
    }
    const again = (m.rsGate ?? 0) >= 1 ? 9 : 12;
    if (m.wdWindDmg >= REWIND_BREAK * e.maxHp) {
      // struck hard enough: the spring jumps out
      m.wdWind = 0;
      m.wdNext = again;
      daze(e, w, 2);
      w.sfx('clock_snap', { vol: 0.7, pitch: 0.9 });
      w.particles.burst(e.x, bodyY(e), { count: 16, speed: [50, 150], life: [0.25, 0.5], colors: ['#ffffff', AMBER[3], AMBER[2]], size: [1, 2], shape: 'spark' });
      return;
    }
    m.wdWindT -= dt;
    if (m.wdWindT > 0) return;
    // the oldest sample is where the clock goes back to
    const back = m[`wdH${m.wdHi}`] ?? e.hp;
    const heal = Math.max(0, Math.min(back - e.hp, REWIND_CAP * e.maxHp));
    e.hp += heal;
    m.wdWind = 0;
    m.wdNext = again;
    w.sfx('clockboss_rewind', { vol: 0.7, pitch: 1 });
    if (heal > 0) w.particles.burst(e.x, bodyY(e), { count: 18, speed: [20, 80], life: [0.4, 0.8], colors: [AMBER[3], AMBER[2], '#6af0d4'], size: [1, 2], shape: 'spark', additive: true });
  },
  filter(e, _w, _hit, dmg) {
    if (e.mem.wdWind) e.mem.wdWindDmg += dmg;
    return dmg;
  },
  active: (e) => !!e.mem.wdWind,
  draw(r, _w, e, t) {
    const m = e.mem;
    if (!m.wdWind) return;
    const cx = e.x;
    const cy = bodyY(e);
    const rad = e.r + 10;
    // a dial over it, the hand running backwards
    r.pixelRing(cx, cy, rad, AMBER[2], 1, 0.8);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      r.rect(Math.round(cx + Math.cos(a) * (rad - 2)), Math.round(cy + Math.sin(a) * (rad - 2)), 1, 1, AMBER[3], 0.9);
    }
    const a = -Math.PI / 2 - t * 9;
    r.pixelLine(cx, cy, cx + Math.cos(a) * (rad - 3), cy + Math.sin(a) * (rad - 3), AMBER[3], 1, 0.95);
    // how close the keeper is to breaking it: a bright arc that fills
    const k = Math.min(1, m.wdWindDmg / (REWIND_BREAK * e.maxHp));
    const steps = Math.ceil(k * 24);
    for (let i = 0; i < steps; i++) {
      const b = -Math.PI / 2 + (i / 24) * Math.PI * 2;
      r.rect(Math.round(cx + Math.cos(b) * (rad + 3)), Math.round(cy + Math.sin(b) * (rad + 3)), 2, 2, '#ffffff', 0.95);
    }
    // the wind-up running out
    const left = Math.max(0, m.wdWindT / REWIND_WIND);
    r.rect(Math.round(cx - 10), Math.round(cy + rad + 6), Math.round(20 * left), 1, AMBER[2], 0.9);
  },
  light(w, e) {
    if (e.mem.wdWind) w.lights.add(e.x, e.y - 14, 60, '#ffb04a', { intensity: 0.5 });
  },
});

// ================================================================== 태엽 무희: 왈츠
/** The waltz: seconds it lasts, the beat window (s after each beat), damage on / off the beat. */
export const WALTZ_TIME = 9;
export const WALTZ_WINDOW = 0.2;
export const WALTZ_ON = 1.3;
export const WALTZ_OFF = 0.15;
const ROSE = ['#6a1a3a', '#c84a7a', '#ff9ac0', '#ffe0ec'];

export function onTheBeat(w: World, e: Enemy): boolean {
  if (!e.mem.wdWaltz) return true;
  return ((w.time - e.mem.wdWaltzAt) % BEAT) < WALTZ_WINDOW;
}

function waltz(e: Enemy, w: World): void {
  e.mem.wdWaltz = 1;
  e.mem.wdWaltzT = WALTZ_TIME;
  // the first beat falls a beat from now
  e.mem.wdWaltzAt = w.time + BEAT;
  w.sfx('clockboss_box', { vol: 0.6, pitch: 1 });
  announceWard(e, w);
}

defineBossWard('clockwork_dancer', {
  name: '왈츠',
  hint: '음악상자 박자에 맞춰 춤춥니다 · 박자에 맞춘 공격만 제대로 들어갑니다',
  color: '#ff9ac0',
  begin(e) {
    e.mem.wdWaltz = 0;
    e.mem.wdWaltzT = 0;
    e.mem.wdWaltzAt = 0;
    e.mem.wdNext = 6;
  },
  phase(e, w) {
    waltz(e, w);
  },
  update(e, w, dt) {
    const m = e.mem;
    if (m.wdWaltz) {
      const before = Math.floor((w.time - dt - m.wdWaltzAt) / BEAT);
      const now = Math.floor((w.time - m.wdWaltzAt) / BEAT);
      if (now > before && w.time >= m.wdWaltzAt) w.sfx('clock_tick', { vol: 0.35, pitch: 1.6 });
      m.wdWaltzT -= dt;
      if (m.wdWaltzT <= 0) {
        m.wdWaltz = 0;
        m.wdNext = (m.rsGate ?? 0) >= 1 ? 9 : 14;
      }
    } else if (!m.rsHold && (m.wdNext -= dt) <= 0) waltz(e, w);
  },
  filter(e, w, hit, dmg) {
    if (!e.mem.wdWaltz || w.time < e.mem.wdWaltzAt) return e.mem.wdWaltz ? dmg * WALTZ_OFF : dmg;
    if (onTheBeat(w, e)) {
      if (hit.kind !== 'status' && fx.chance(0.6)) w.particles.burst(e.x, bodyY(e), { count: 4, speed: [40, 110], life: [0.12, 0.3], colors: ['#ffffff', ROSE[3], ROSE[2]], size: [1, 2], shape: 'spark', additive: true });
      return dmg * WALTZ_ON;
    }
    blockedFx(e, w, hit, ['#ffffff', ROSE[2], ROSE[1]]);
    return dmg * WALTZ_OFF;
  },
  active: (e, w) => !!e.mem.wdWaltz && !onTheBeat(w, e),
  draw(r, w, e, t) {
    const m = e.mem;
    if (!m.wdWaltz) return;
    const cx = e.x;
    const cy = bodyY(e);
    const since = w.time - m.wdWaltzAt;
    const ph = ((since % BEAT) + BEAT) % BEAT;
    // a ring closes in on her and meets her on the beat (rhythm cue)
    const toBeat = (BEAT - ph) / BEAT;
    const rad = e.r + 6 + toBeat * 34;
    r.pixelRing(cx, cy, rad, ROSE[2], 1, 0.35 + 0.5 * (1 - toBeat));
    if (since >= 0 && ph < WALTZ_WINDOW) {
      r.pixelRing(cx, cy, e.r + 6, '#ffffff', 2, 0.9);
      r.pixelRing(cx, cy, e.r + 10, ROSE[3], 1, 0.7);
    }
    // little notes drifting off the box
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.6 + i / 3) % 1;
      const x = Math.round(cx + Math.sin(t * 2 + i * 2) * (e.r + 8));
      const y = Math.round(cy - 8 - k * 18);
      r.rect(x, y, 2, 2, ROSE[3], 1 - k);
      r.rect(x + 1, y - 3, 1, 3, ROSE[3], 1 - k);
    }
  },
});
