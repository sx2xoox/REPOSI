import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Actives, Potions, type ItemPool } from '../src/game/defs';
import { hasSprite } from '../src/engine/sprites';
import { EMBER_MAX } from '../src/game/player';
import type { World } from '../src/game/world';

loadContent();

const SOURCES = import.meta.glob(['../src/content/items/actives.ts', '../src/content/items/potions.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const POOLS: ItemPool[] = ['treasure', 'shop', 'boss', 'secret', 'challenge', 'curse', 'shrine'];
const HANGUL = /[가-힣]/;

function declared(fn: string): string[] {
  const ids: string[] = [];
  for (const src of Object.values(SOURCES)) for (const m of src.matchAll(new RegExp(`${fn}\\(\\{\\s*id:\\s*'([^']+)'`, 'g'))) ids.push(m[1]);
  return ids;
}

/** Minimal world stand-in for effects that only touch the player / buffs / feedback. */
function fakeWorld(o: { red?: number; soul?: number; ember?: number } = {}): World & { buffs: string[] } {
  const buffs: string[] = [];
  const noop = () => {};
  return {
    time: 10,
    vars: {},
    flags: new Set<string>(),
    buffs,
    player: { x: 100, y: 100, red: o.red ?? 6, soul: o.soul ?? 0, ember: o.ember ?? 0, emberReadyFlash: 0, stats: { damage: 10 } },
    items: { addBuff: (b: { key: string }) => buffs.push(b.key) },
    particles: { burst: noop, spawn: noop },
    lights: { glow: noop, add: noop },
    renderer: { screenFlash: noop },
    sfx: noop, shake: noop, decal: noop, floatText: noop,
    spawn: <T>(e: T) => e,
  } as unknown as World & { buffs: string[] };
}

describe('active items', () => {
  const ids = declared('defineActive');

  it('declares 10 actives with unique ids', () => {
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Actives.has(id), id).toBe(true);
  });

  it('have Korean text, icons, valid pools and sane charges', () => {
    for (const id of ids) {
      const d = Actives.must(id);
      expect(d.name, id).toMatch(HANGUL);
      expect(d.desc, id).toMatch(HANGUL);
      expect(d.quote ?? '', id).toMatch(HANGUL);
      expect(hasSprite(d.icon), `${id} icon ${d.icon}`).toBe(true);
      expect(d.pools.length, id).toBeGreaterThan(0);
      for (const p of d.pools) expect(POOLS, id).toContain(p);
      if (d.timed) expect(d.charge, id).toBeGreaterThanOrEqual(3);
      else {
        expect(d.charge, id).toBeGreaterThanOrEqual(1);
        expect(d.charge, id).toBeLessThanOrEqual(6);
      }
    }
    const timed = ids.filter((id) => Actives.must(id).timed);
    expect(timed.length).toBeGreaterThanOrEqual(1);
    expect(timed.length).toBeLessThanOrEqual(2);
  });

  it('맹세의 단검 never kills and refuses when it cannot pay', () => {
    const dagger = Actives.must('oath_dagger');
    const w = fakeWorld({ red: 6 });
    expect(dagger.use(w)).not.toBe(false);
    expect(w.player.red).toBe(5);
    expect(w.buffs).toContain('oath_dagger');
    const w2 = fakeWorld({ red: 1, soul: 0 });
    expect(dagger.use(w2)).toBe(false);
    expect(w2.player.red).toBe(1);
    const w3 = fakeWorld({ red: 1, soul: 2 });
    expect(dagger.use(w3)).not.toBe(false);
    expect(w3.player.red + w3.player.soul).toBe(2);
  });

  it('풀무 가죽부대 fills the ember gauge, keeps its charge when already full', () => {
    const bellows = Actives.must('ember_bellows');
    const w = fakeWorld({ ember: 10 });
    bellows.use(w);
    expect(w.player.ember).toBe(EMBER_MAX);
    expect(bellows.use(w)).toBe(false);
  });
});

describe('potions', () => {
  const ids = declared('definePotion');

  it('declares 11 potions with unique ids and Korean text', () => {
    expect(ids.length).toBeGreaterThanOrEqual(11);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      const d = Potions.must(id);
      expect(d.name, id).toMatch(HANGUL);
      expect(d.desc, id).toMatch(HANGUL);
      expect(['good', 'bad', 'mixed'], id).toContain(d.nature);
      expect(d.color, id).toMatch(/^#[0-9a-f]{6}$/i);
    }
    const natures = new Set(ids.map((id) => Potions.must(id).nature));
    expect(natures.size).toBe(3);
  });

  it('simple potions run against a minimal world', () => {
    const w = fakeWorld();
    expect(() => Potions.must('potion_water').use(w)).not.toThrow();
    Potions.must('potion_ember').use(w);
    expect(w.player.ember).toBe(EMBER_MAX);
  });
});
