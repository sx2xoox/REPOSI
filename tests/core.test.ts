import { describe, expect, it } from 'vitest';
import { RNG } from '../src/engine/rng';
import { loadContent } from '../src/content';
import { Floors, RoomTemplates, Artifacts, Enemies, Characters, Weapons } from '../src/game/defs';
import { generateFloor } from '../src/game/dungeon';
import { CELL_H, CELL_W, SHAPE_CELLS } from '../src/game/constants';
import { Inventory, makeItem } from '../src/game/inventory';
import { BASE_STATS, StatMods, computeStats } from '../src/game/stats';

loadContent();

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new RNG('ABCD-1234');
    const b = new RNG('ABCD-1234');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('int stays in range', () => {
    const r = new RNG(5);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe('content', () => {
  it('has contiguous floors starting at 1 (act 1 = 1–5, act 2 below)', () => {
    const idx = Floors.all().map((f) => f.index).sort((a, b) => a - b);
    expect(idx.length).toBeGreaterThanOrEqual(5);
    expect(idx).toEqual(idx.map((_, i) => i + 1));
    expect(idx.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('every character references a real weapon', () => {
    for (const c of Characters.all()) expect(Weapons.has(c.weapon)).toBe(true);
  });
  it('room templates have the right size', () => {
    for (const t of RoomTemplates.all()) {
      const [cw, ch] = SHAPE_CELLS[t.shape];
      expect(t.rows.length, t.id).toBe(CELL_H * ch);
      for (const row of t.rows) expect(row.length, `${t.id}: "${row}"`).toBe(CELL_W * cw);
    }
  });
  it('enemies have sane stats', () => {
    for (const e of Enemies.all()) {
      expect(e.hp, e.id).toBeGreaterThan(0);
      expect(e.radius, e.id).toBeGreaterThan(0);
    }
  });
  it('artifacts have names and descriptions', () => {
    for (const a of Artifacts.all()) {
      expect(a.name.length, a.id).toBeGreaterThan(0);
      expect(a.desc.length, a.id).toBeGreaterThan(0);
    }
  });
});

describe('dungeon generation', () => {
  it('generates connected floors with special rooms for many seeds', () => {
    for (const floor of Floors.all()) {
      for (let s = 0; s < 40; s++) {
        const map = generateFloor(floor, new RNG(`seed-${floor.index}-${s}`));
        const kinds = map.nodes.map((n) => n.kind);
        expect(kinds).toContain('start');
        expect(kinds).toContain('boss');
        expect(kinds).toContain('treasure');
        expect(kinds).toContain('shop');
        // connectivity (ignoring secret doors)
        const seen = new Set([map.startId]);
        const q = [map.startId];
        while (q.length) {
          const id = q.pop()!;
          for (const d of map.nodes[id].doors) if (!d.secret && !seen.has(d.to)) { seen.add(d.to); q.push(d.to); }
        }
        for (const n of map.nodes) if (n.kind !== 'secret') expect(seen.has(n.id), `floor ${floor.index} seed ${s} node ${n.id}`).toBe(true);
        // doors are symmetric
        for (const n of map.nodes) for (const d of n.doors) expect(map.nodes[d.to].doors.some((b) => b.to === n.id)).toBe(true);
      }
    }
  });
  it('boss room is a dead end', () => {
    const map = generateFloor(Floors.all()[0], new RNG('dead-end'));
    const boss = map.nodes[map.bossId];
    expect(new Set(boss.doors.filter((d) => !d.secret).map((d) => d.to)).size).toBe(1);
  });
});

describe('inventory & stats', () => {
  it('stacks duplicate artifacts as power', () => {
    const inv = new Inventory();
    const id = Artifacts.all()[0].id;
    inv.add(makeItem(id));
    inv.add(makeItem(id));
    const c = inv.compute();
    expect(c.artifacts[0].power).toBe(2);
  });
  it('computes stats with add then mul and clamps', () => {
    const m = new StatMods().addStat('damage', 5).mulStat('damage', 2).addStat('fireRate', -100);
    const s = computeStats(BASE_STATS, m);
    expect(s.damage).toBe((BASE_STATS.damage + 5) * 2);
    expect(s.fireRate).toBeGreaterThan(0);
  });
});
