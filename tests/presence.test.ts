// Artifact presence: every artifact leaves a visible trace (composed shot look,
// motes, aura ...), stat-only artifacts carry a signature effect, the floor
// blessing pool, the flattened enemy HP curve and the power readout.

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Artifacts, Floors, type ArtifactDef } from '../src/game/defs';
import { hasSprite } from '../src/engine/sprites';
import { LookSystem, lookIsVisible, paintShot, type LookSource, type ShotShape } from '../src/game/look';
import { PixelPainter } from '../src/engine/painter';
import { blessingPool, rollBlessings } from '../src/game/blessings';
import { estimateDps, itemPoints, powerScore } from '../src/game/power';
import { BASE_STATS, StatMods, computeStats } from '../src/game/stats';
import { artifactBarLayout } from '../src/ui/artifact-bar';
import type { InvComputed } from '../src/game/inventory';

loadContent();

const HANGUL = /[가-힣]/;
const HOOKS = ['stats', 'onAcquire', 'onRemove', 'onUpdate', 'onShoot', 'onAttack', 'modifyHit', 'onHit', 'onKill', 'onHurt', 'onDash', 'onRoomEnter', 'onRoomClear', 'onFloorStart', 'onBomb', 'onPickup', 'onRelease', 'onDeflect', 'draw'] as const;
/** stat-only artifacts whose stat change is itself plainly visible on screen */
const VISIBLE_STATS = new Set(['star_chart', 'jade_marble', 'paper_fan', 'void_body']);

function hooksOf(a: ArtifactDef): string[] {
  return HOOKS.filter((h) => typeof (a as unknown as Record<string, unknown>)[h] === 'function');
}

const src = (def: ArtifactDef, power = 1, order = 0): LookSource => ({ def, power, order });

describe('artifact presence', () => {
  it('every artifact declares a visible trace', () => {
    const missing = Artifacts.all().filter((a) => !lookIsVisible(a.look)).map((a) => a.id);
    expect(missing).toEqual([]);
    expect(Artifacts.all().length).toBeGreaterThanOrEqual(73);
  });

  it('artifacts that only change stats have a signature side effect', () => {
    const bad: string[] = [];
    for (const a of Artifacts.all()) {
      if (a.blessing) continue;
      const hooks = hooksOf(a);
      if (hooks.length === 1 && hooks[0] === 'stats' && !VISIBLE_STATS.has(a.id) && !a.signature) bad.push(a.id);
      if (a.signature) expect(a.signature, a.id).toMatch(HANGUL);
    }
    expect(bad).toEqual([]);
  });

  it('looks combine: shot layers by rarity, stacking size, capped trails, motes per copy', () => {
    const L = new LookSystem();
    const wick = Artifacts.must('long_wick');
    const fang = Artifacts.must('viper_fang');
    const moon = Artifacts.must('blood_moon');
    L.compose([src(wick, 1, 0)]);
    expect(L.shot?.body).toBe(wick.look!.shot);
    expect(L.shot?.shape).toBe('flame');
    L.compose([src(wick, 1, 0), src(fang, 1, 1), src(moon, 1, 2)]);
    // legendary blood moon colors the body; the commons become rim / core layers
    expect(L.shot?.body).toBe(moon.look!.shot);
    expect([L.shot?.rim, L.shot?.core].sort()).toEqual([wick.look!.shot, fang.look!.shot].sort());
    expect(L.shot?.shape).toBe('crescent');
    expect(L.shot?.glow).toBe(true);
    expect(L.shot!.trails.length).toBeLessThanOrEqual(3);
    // composed sprites are defined lazily and cached by name
    const n1 = L.shot!.sprite(7, L.shot!.body!);
    expect(hasSprite(n1)).toBe(true);
    expect(L.shot!.sprite(7, L.shot!.body!)).toBe(n1);
    // duplicates add motes (2 per artifact max)
    const sat = Artifacts.must('ember_heart');
    L.compose([src(sat, 1)]);
    const one = L.player.motes.length;
    L.compose([src(sat, 3)]);
    expect(L.player.motes.length).toBe(one * 2);
    // many artifacts: capped motes, lit glow
    L.compose(Artifacts.all().slice(0, 30).map((a, i) => src(a, 1, i)));
    expect(L.player.motes.length).toBeLessThanOrEqual(10);
    expect(L.player.aura.length).toBeLessThanOrEqual(4);
    expect(L.player.glow).not.toBeNull();
    L.compose([]);
    expect(L.shot).toBeNull();
    expect(L.player.motes.length).toBe(0);
  });

  it('every shot shape paints at every size without errors', () => {
    const L = new LookSystem();
    const shapes = new Set(Artifacts.all().map((a) => a.look?.shape).filter(Boolean));
    expect(shapes.size).toBeGreaterThanOrEqual(6);
    for (const a of Artifacts.all()) {
      if (!a.look?.shape) continue;
      L.compose([src(a)]);
      for (const d of [3, 5, 7, 11, 18, 30]) expect(hasSprite(L.shot!.sprite(d, '#ff8040'))).toBe(true);
    }
    for (const shape of [...shapes, 'orb'] as ShotShape[]) {
      for (const d of [3, 5, 8, 13, 30]) {
        const W = Math.round(d * 1.9);
        const p = new PixelPainter(W, d);
        expect(() => paintShot(p, shape, W, d, '#ff8040', '#80ff40', '#ffffff'), `${shape} ${d}`).not.toThrow();
        let n = 0;
        for (let y = 0; y < d; y++) for (let x = 0; x < W; x++) if (p.isSet(x, y)) n++;
        expect(n, `${shape} ${d}`).toBeGreaterThan(2);
      }
    }
  });
});

describe('등불의 축복 (floor blessings)', () => {
  const pool = blessingPool();

  it('has at least 18 unique blessings with icons, Korean text and a visible trace', () => {
    expect(pool.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(pool.map((b) => b.id));
    const names = new Set(pool.map((b) => b.name));
    expect(ids.size).toBe(pool.length);
    expect(names.size).toBe(pool.length);
    for (const b of pool) {
      expect(b.hidden, b.id).toBe(true);
      expect(b.pools, b.id).toEqual([]);
      expect(b.name, b.id).toMatch(HANGUL);
      expect(b.desc, b.id).toMatch(HANGUL);
      expect(hasSprite(b.icon), b.id).toBe(true);
      expect(lookIsVisible(b.look), b.id).toBe(true);
    }
  });

  it('blessing stats() hooks keep stats finite', () => {
    for (const b of pool) {
      if (!b.stats) continue;
      const m = new StatMods();
      b.stats(m, 1, undefined as never);
      for (const [k, v] of Object.entries(computeStats(BASE_STATS, m))) expect(Number.isFinite(v), `${b.id} ${k}`).toBe(true);
    }
  });

  it('choices are seeded per run and floor, distinct, and skip owned blessings', () => {
    const none = () => false;
    const a = rollBlessings('SEED-A', 1, none);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(rollBlessings('SEED-A', 1, none)).toEqual(a);
    expect(rollBlessings('SEED-A', 2, none)).not.toEqual(a);
    expect(rollBlessings('SEED-B', 1, none)).not.toEqual(a);
    const owned = new Set(a);
    const b = rollBlessings('SEED-A', 1, (id) => owned.has(id));
    for (const id of b) expect(owned.has(id)).toBe(false);
    // the pool lasts a whole run (5 floors x 1 pick) with full choices
    const taken = new Set<string>();
    for (let f = 1; f <= 5; f++) {
      const c = rollBlessings('RUN', f, (id) => taken.has(id));
      expect(c).toHaveLength(3);
      taken.add(c[0]);
    }
  });
});

describe('getting stronger', () => {
  it('enemy hp grows gently per floor (items outpace it)', () => {
    const m = Floors.all().sort((x, y) => x.index - y.index).map((f) => f.hpMult);
    expect(m[0]).toBe(1);
    for (let i = 1; i < m.length; i++) {
      expect(m[i]).toBeGreaterThan(m[i - 1]);
      expect(m[i] / m[i - 1]).toBeLessThanOrEqual(1.32);
    }
    expect(m[m.length - 1]).toBeLessThanOrEqual(2.8);
  });

  it('the power number rises with damage and with every artifact', () => {
    const base = estimateDps(BASE_STATS);
    expect(base).toBeGreaterThan(20);
    expect(estimateDps({ ...BASE_STATS, damage: 12 })).toBeGreaterThan(base);
    const comp = (ids: string[]): InvComputed => ({
      artifacts: ids.map((id, i) => ({ def: Artifacts.must(id), power: 1, order: i })), tagCounts: {}, sets: [],
    });
    const p0 = powerScore(BASE_STATS, comp([]));
    const p1 = powerScore(BASE_STATS, comp(['lantern_sun']));
    const p2 = powerScore(BASE_STATS, comp(['lantern_sun', 'bless_vigor']));
    expect(p1).toBeGreaterThan(p0);
    expect(p2).toBeGreaterThan(p1);
    expect(itemPoints(null)).toBe(0);
  });

  it('common stat artifacts are noticeable (>= +15% of a base stat)', () => {
    for (const id of ['long_wick', 'quick_feather', 'cracked_hourglass', 'black_candle', 'leech_tooth']) {
      const m = new StatMods();
      Artifacts.must(id).stats!(m, 1, undefined as never);
      const s = computeStats(BASE_STATS, m);
      const gain = Math.max(s.damage / BASE_STATS.damage, s.fireRate / BASE_STATS.fireRate);
      expect(gain, id).toBeGreaterThanOrEqual(id === 'leech_tooth' ? 1.1 : 1.15);
    }
  });
});

describe('HUD artifact row layout', () => {
  it('wraps into at most two rows and summarizes the overflow', () => {
    const a = artifactBarLayout(5, 196, 626);
    expect(a.rows).toBe(1);
    expect(a.shown).toBe(5);
    const b = artifactBarLayout(30, 196, 626);
    expect(b.rows).toBe(2);
    expect(b.shown).toBe(30);
    const c = artifactBarLayout(80, 196, 626);
    expect(c.rows).toBe(2);
    expect(c.shown).toBe(c.cols * 2 - 1);
  });
});
