// The items rebuilt around matches when bombs and keys left the game:
// 태엽 성냥갑 (damage per match held), 성냥 주머니 (ember on every strike),
// 째깍 멈춤쇠 (a dash stops nearby foes, on a cooldown) and 상자 감별사
// (an extra match or coin from every chest).

import './headless';
import { describe, expect, it, vi } from 'vitest';
import { measureDps, PLAIN_ID } from './dpsharness';
import { Artifacts } from '../src/game/defs';
import { Chest, Pickup } from '../src/game/pickups';
import { MATCH_CAP, spendMatch } from '../src/game/matches';
import { EMBER_MAX } from '../src/game/player';
import type { Entity } from '../src/game/entity';

const DT = 1 / 60;
const solo = () => measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', seconds: 0 });

describe('match items', () => {
  it('태엽 성냥갑: +2 matches, +1 damage per 3 matches held, +3 at the purse cap', () => {
    const { world: w } = solo();
    const p = w.player;
    p.matches = 0;
    const base = p.stats.damage;
    w.items.give('wind_up_matchbox');
    w.update(DT);
    expect(p.matches).toBe(2);
    p.matches = MATCH_CAP;
    w.update(DT);
    expect(p.stats.damage - base).toBeCloseTo(3, 5);
    p.matches = 3;
    w.update(DT);
    expect(p.stats.damage - base).toBeCloseTo(1, 5);
    expect(Artifacts.must('wind_up_matchbox').desc.length).toBeLessThanOrEqual(36);
  });

  it('성냥 주머니: +3 matches, and every strike fills the ember gauge by about a third', () => {
    const { world: w } = solo();
    const p = w.player;
    p.matches = 0;
    w.items.give('bless_match_pouch');
    w.update(DT);
    expect(p.matches).toBe(3);
    p.ember = 0;
    expect(spendMatch(w, p.x + 10, p.y)).toBe(true);
    expect(p.matches).toBe(2);
    expect(p.ember).toBeGreaterThanOrEqual(EMBER_MAX * 0.35 - 1e-9);
    expect(p.ember).toBeLessThan(EMBER_MAX * 0.5);
    p.ember = EMBER_MAX * 0.9;
    spendMatch(w, p.x + 10, p.y);
    expect(p.ember).toBe(EMBER_MAX);
    // no match, no ember
    p.matches = 0;
    p.ember = 0;
    expect(spendMatch(w, p.x + 10, p.y)).toBe(false);
    expect(p.ember).toBe(0);
  });

  it('째깍 멈춤쇠: a dash stuns foes in reach, then waits out its cooldown; an empty dash keeps it ready', () => {
    const r = solo();
    const w = r.world;
    const p = w.player;
    const e = r.dummies[0];
    w.items.give('tick_stopper');
    w.update(DT);
    const stunned = () => e.hasStatus('stun');
    // nothing in reach: no stun and no cooldown spent
    e.x = p.x + 200;
    e.y = p.y;
    w.items.onDash();
    expect(stunned()).toBe(false);
    expect(w.vars.__tickStopT ?? -99).toBeLessThan(w.time);
    // in reach: stunned, cooldown 6 s for one copy (7 - power)
    e.x = p.x + 30;
    w.items.onDash();
    expect(stunned()).toBe(true);
    expect(w.vars.__tickStopT).toBeCloseTo(w.time + 6, 5);
    e.statuses.delete('stun');
    const t0 = w.time;
    w.time = t0 + 3;
    w.items.onDash();
    expect(stunned()).toBe(false);
    w.time = t0 + 6.01;
    w.items.onDash();
    expect(stunned()).toBe(true);
    // a second copy: 5 s, and a wider reach
    w.items.give('tick_stopper');
    e.statuses.delete('stun');
    w.time += 10;
    e.x = p.x + 70;
    w.items.onDash();
    expect(stunned()).toBe(true);
    expect(w.vars.__tickStopT).toBeCloseTo(w.time + 5, 5);
  });

  it('상자 감별사: every chest opened gives one more match or coin', () => {
    const { world: w } = solo();
    const p = w.player;
    w.items.give('bless_locksmith');
    const kinds = new Set<string>();
    const spawned: Entity[] = [];
    const spy = vi.spyOn(w, 'spawn').mockImplementation(<T extends Entity>(e: T): T => { spawned.push(e); return e; });
    for (let i = 0; i < 24; i++) {
      const c = new Chest(p.x + 30, p.y, false);
      w.entities.push(c);
      w.update(DT); // seen closed
      spawned.length = 0;
      c.opened = true;
      w.update(DT);
      const extra = spawned.filter((x): x is Pickup => x instanceof Pickup);
      expect(extra.length, `chest ${i}`).toBe(1);
      kinds.add(extra[0].kind);
      w.entities.splice(w.entities.indexOf(c), 1);
    }
    spy.mockRestore();
    expect([...kinds].sort()).toEqual(['coin', 'match']);
  });
});
