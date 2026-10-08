// Rules of the online speedrun leaderboard Worker (server/leaderboard/src/logic.ts).
import { describe, expect, it } from 'vitest';
import { FLOORS, MAX_NAME, TOP_SQL, cleanName, params, parseFloor, parseLimit, validate } from '../server/leaderboard/src/logic';

const ok = { season: 1, build: 'e1e1631-202610080000', device: 'dev_12345678', runId: 'run_12345678', name: '등불여우', seed: 'ABCD-1234', char: 'ria', weapon: 'lantern_bolt', floor: 2, bossMs: 51_000, splitMs: 210_000 };

describe('leaderboard server rules', () => {
  it('accepts a plausible floor clear', () => {
    const v = validate(ok);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toEqual(ok);
  });

  it('refuses implausible or malformed submissions', () => {
    const bad: [Partial<typeof ok> & Record<string, unknown>, string][] = [
      [{ floor: 0 }, 'floor'], [{ floor: FLOORS + 1 }, 'floor'], [{ floor: 1.5 }, 'floor'],
      [{ bossMs: 1000 }, 'bossMs'], [{ splitMs: 40_000 }, 'splitMs'], [{ splitMs: 50_000 }, 'splitMs'],
      [{ name: '   ' }, 'name'], [{ seed: 'bad seed!' }, 'seed'], [{ char: 'Ria' }, 'char'], [{ weapon: '' }, 'weapon'],
      [{ device: 'short' }, 'device'], [{ runId: 'x'.repeat(65) }, 'runId'], [{ season: 0 }, 'season'], [{ build: '' }, 'build'],
    ];
    for (const [patch, err] of bad) {
      const v = validate({ ...ok, ...patch });
      expect(v.ok, JSON.stringify(patch)).toBe(false);
      if (!v.ok) expect(v.error).toBe(err);
    }
    expect(validate(null).ok).toBe(false);
  });

  it('cleans nicknames: invisible and control characters go, length is capped', () => {
    expect(cleanName('  ab​ c \u0007  ')).toBe('ab c');
    expect(Array.from(cleanName('가'.repeat(30))).length).toBe(MAX_NAME);
    expect(cleanName(42)).toBe('');
  });

  it('parses query parameters defensively and ranks by the cumulative clear time', () => {
    expect(parseFloor('7')).toBe(7);
    expect(parseFloor('8')).toBeNull();
    expect(parseFloor(null)).toBeNull();
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit('500')).toBe(100);
    expect(parseLimit('0')).toBe(1);
    expect(params(2, 3)).toBe('?2, ?3, ?4');
    expect(TOP_SQL).toContain('MIN(split_ms)');
    expect(TOP_SQL).toContain('GROUP BY device');
  });
});
