import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Artifacts, Sets, type ItemPool, type Rarity } from '../src/game/defs';
import { hasSprite } from '../src/engine/sprites';
import { BASE_STATS, StatMods, computeStats } from '../src/game/stats';
import { grantPerCopy, procChance, stackMul } from '../src/content/items/lib';
import type { World } from '../src/game/world';

loadContent();

// raw sources of the passive item files (scanned to catch duplicate ids, which the registry would hide)
const SOURCES = import.meta.glob(['../src/content/items/*.ts', '!../src/content/items/actives*.ts', '!../src/content/items/potions*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const TAGS = ['flame', 'frost', 'venom', 'storm', 'blood', 'star', 'shadow', 'clockwork'];
const POOLS: ItemPool[] = ['treasure', 'shop', 'boss', 'secret', 'challenge', 'curse', 'shrine'];
const HANGUL = /[가-힣]/;

/** ids declared with defineArtifact in the passive item files (scanned from source to catch duplicates). */
function declaredIds(): string[] {
  const ids: string[] = [];
  for (const src of Object.values(SOURCES)) {
    for (const m of src.matchAll(/defineArtifact\(\{\s*id:\s*'([^']+)'/g)) ids.push(m[1]);
  }
  return ids;
}

/** Minimal world stand-in: enough for stats() and the small helpers (no DOM). */
function fakeWorld(): World {
  return {
    time: 10,
    vars: {},
    player: { coins: 37, matches: 5, lastHurtAt: -999, red: 6, maxRed: 6, soul: 0, stats: { ...BASE_STATS }, flags: new Set<string>() },
    items: { recomputeStats() {} },
  } as unknown as World;
}

describe('passive artifacts', () => {
  const ids = declaredIds();
  const arts = Artifacts.all();

  it('declares at least 48 new passive artifacts with unique ids', () => {
    expect(ids.length).toBeGreaterThanOrEqual(51);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dup).toEqual([]);
    for (const id of ids) expect(Artifacts.has(id), id).toBe(true);
  });

  it('have Korean names, descriptions, quotes, valid rarity / pools / icons', () => {
    for (const id of ids) {
      const a = Artifacts.must(id);
      expect(a.name, id).toMatch(HANGUL);
      expect(a.desc, id).toMatch(HANGUL);
      expect(a.quote ?? '', id).toMatch(HANGUL);
      // the pickup banner shows desc on a single line (~26 Hangul at 12px)
      expect(a.desc.length, id).toBeLessThanOrEqual(36);
      expect(['common', 'rare', 'epic', 'legendary']).toContain(a.rarity);
      expect(a.pools.length, id).toBeGreaterThan(0);
      for (const p of a.pools) expect(POOLS, id).toContain(p);
      expect(hasSprite(a.icon), `${id} icon ${a.icon}`).toBe(true);
      for (const t of a.tags) expect(Sets.get(t), `${id} tag ${t}`).toBeTruthy();
    }
  });

  it('texts stay glance-readable (user 2026-10-08: "그냥 대충 보고 알아먹을 정도로만")', () => {
    // the UI shows desc + ' ' + detail; the exact numbers / timings are left for the player to discover
    for (const a of arts) {
      if (a.hidden || a.blessing) continue;
      const detail = a.detail ?? '';
      expect(detail.length, `${a.id} detail: ${detail}`).toBeLessThanOrEqual(40);
      const shown = detail ? `${a.desc} ${detail}` : a.desc;
      expect(shown.length, `${a.id}: ${shown}`).toBeLessThanOrEqual(80);
    }
  });

  it('names are unique', () => {
    const names = arts.map((a) => a.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('has a sensible rarity mix', () => {
    const count = (r: Rarity) => ids.filter((id) => Artifacts.must(id).rarity === r).length / ids.length;
    expect(count('common')).toBeGreaterThan(0.35);
    expect(count('common')).toBeLessThan(0.55);
    expect(count('rare')).toBeGreaterThan(0.22);
    expect(count('rare')).toBeLessThan(0.38);
    expect(count('epic')).toBeGreaterThan(0.1);
    expect(count('epic')).toBeLessThan(0.25);
    expect(count('legendary')).toBeGreaterThan(0.04);
    expect(count('legendary')).toBeLessThan(0.12);
  });

  it('every pool can roll something', () => {
    for (const p of POOLS) expect(arts.filter((a) => a.pools.includes(p)).length, p).toBeGreaterThanOrEqual(4);
  });

  it('stats() hooks never throw and keep stats finite (1-3 copies)', () => {
    const w = fakeWorld();
    for (const a of arts) {
      if (!a.stats) continue;
      for (let power = 1; power <= 3; power++) {
        const m = new StatMods();
        expect(() => a.stats!(m, power, w), a.id).not.toThrow();
        const s = computeStats(BASE_STATS, m);
        for (const [k, v] of Object.entries(s)) expect(Number.isFinite(v), `${a.id} ${k}`).toBe(true);
      }
    }
  });
});

describe('등불 공명 (resonance)', () => {
  it('defines the eight tags with 2-3 ascending tiers and an icon', () => {
    for (const tag of TAGS) {
      const s = Sets.get(tag);
      expect(s, tag).toBeTruthy();
      expect(s!.name).toMatch(HANGUL);
      expect(hasSprite(s!.icon), `${tag} icon`).toBe(true);
      expect(s!.tiers.length).toBeGreaterThanOrEqual(2);
      expect(s!.tiers.length).toBeLessThanOrEqual(3);
      const counts = s!.tiers.map((t) => t.count);
      expect([...counts].sort((a, b) => a - b)).toEqual(counts);
      for (const t of s!.tiers) expect(t.desc).toMatch(HANGUL);
    }
  });

  it('every tag is carried by at least 4 artifacts and its top tier is reachable', () => {
    for (const tag of TAGS) {
      const n = Artifacts.all().filter((a) => a.tags.includes(tag) && !a.hidden).length;
      expect(n, tag).toBeGreaterThanOrEqual(4);
      const top = Math.max(...Sets.get(tag)!.tiers.map((t) => t.count));
      expect(top, tag).toBeLessThanOrEqual(n);
    }
  });

  it('tier stats() hooks never throw', () => {
    const w = fakeWorld();
    for (const s of Sets.all()) for (const t of s.tiers) {
      const m = new StatMods();
      expect(() => t.hooks.stats?.(m, 1, w), s.tag).not.toThrow();
    }
  });
});

describe('item helpers', () => {
  it('procChance grows with copies, luck, and stays capped', () => {
    const w = fakeWorld();
    const a = procChance(w, 0.15, 1);
    const b = procChance(w, 0.15, 2);
    expect(a).toBeCloseTo(0.15, 5);
    expect(b).toBeGreaterThan(a);
    expect(procChance(w, 0.9, 10)).toBeLessThanOrEqual(0.95);
    (w.player.stats as { luck: number }).luck = 5;
    expect(procChance(w, 0.15, 1)).toBeGreaterThan(a);
  });

  it('stackMul diminishes', () => {
    expect(stackMul(1)).toBe(1);
    expect(stackMul(2)).toBeGreaterThan(1);
    expect(stackMul(4) - stackMul(2)).toBeLessThan(stackMul(2));
  });

  it('grantPerCopy grants once per copy, including duplicates picked up later', () => {
    const w = fakeWorld();
    let n = 0;
    grantPerCopy(w, 'x', 1, () => n++);
    grantPerCopy(w, 'x', 1, () => n++);
    expect(n).toBe(1);
    grantPerCopy(w, 'x', 3, () => n++);
    expect(n).toBe(3);
  });
});
