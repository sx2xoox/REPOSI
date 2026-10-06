import './headless';
import { describe, expect, it } from 'vitest';
import { measureDps, PLAIN_ID } from './dpsharness';
import { blessingChoices, blessingCompatibility, blessingPool, blessingRole, canRerollBlessing, markBlessed, prepareBlessingOffer, rerollBlessings, rollBlessings } from '../src/game/blessings';
import { captureCheckpoint, restoreCheckpoint } from '../src/game/checkpoint';
import { applyCoopCommand, isCoopCommand } from '../src/game/coop';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { fakeDisplay } from './headless';
import { fixedRules } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import { Artifacts } from '../src/game/defs';
import { Projectile } from '../src/game/projectile';

const solo = () => measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', seconds: 0 }).world;
function party(local = 0) {
  const w = new World(new Renderer(fakeDisplay(1280, 720)), new RunState('BLESS-REWORK', 'ria'), { openInventory() {}, onGameOver() {} });
  w.rules = fixedRules({ hitStop: false });
  w.startParty(['ria', 'bern', 'serin', 'niel'].map((characterId, slot) => ({ slot, characterId, name: `P${slot}` })), local);
  return w;
}

describe('blessing offers and one expedition reroll', () => {
  it('excludes owned and the previous two offers during seven-floor runs, preserving role diversity', () => {
    for (let seed = 0; seed < 40; seed++) {
      const owned = new Set<string>(), history: string[][] = [];
      for (let floor = 1; floor <= 7; floor++) {
        const recent = history.slice(-2).flat();
        const context = { recent, weapons: ['lantern_bolt'] };
        const ids = rollBlessings(`HISTORY-${seed}`, floor, id => owned.has(id), 3, context);
        expect(ids).toEqual(rollBlessings(`HISTORY-${seed}`, floor, id => owned.has(id), 3, context));
        expect(ids).toHaveLength(3); expect(new Set(ids).size).toBe(3);
        expect(new Set(ids.map(blessingRole)).size).toBe(3);
        for (const id of ids) { expect(owned.has(id)).toBe(false); expect(recent.includes(id), `${seed}/${floor}/${id}`).toBe(false); }
        history.push(ids); owned.add(ids[(seed + floor) % 3]);
      }
    }
  });

  it('offers return after two later offers and an exhausted pool safely falls back without owned duplicates', () => {
    const w = solo();
    const first = blessingChoices(w);
    for (let floor = 2; floor <= 3; floor++) { w.run.floor = floor; prepareBlessingOffer(w); expect(blessingChoices(w).some(id => first.includes(id))).toBe(false); }
    // Deterministically leave one old candidate available in each role. The
    // candidate from offer 1 is now outside the two-offer memory window.
    const keep = new Set(first);
    expect(rollBlessings('EXPIRED', 4, id => !keep.has(id), 3, { recent: [] }).sort()).toEqual([...first].sort());
    expect(rollBlessings('LAST', 7, id => id !== first[0], 3, { recent: first })).toEqual([first[0]]);
    expect(rollBlessings('EMPTY', 7, () => true, 3, { recent: blessingPool().map(b => b.id) })).toEqual([]);
  });

  it('UI reads are pure before and after preparing; cached offers survive equipment changes and checkpoint restore', () => {
    const w = solo();
    delete w.vars.__blessOfferFloor;
    const beforeVars = structuredClone(w.vars), beforeRng = w.rng.snapshot(), beforeHash = stateHash(w);
    const preview = blessingChoices(w);
    expect(blessingChoices(w)).toEqual(preview); expect(w.vars).toEqual(beforeVars); expect(w.rng.snapshot()).toEqual(beforeRng); expect(stateHash(w)).toBe(beforeHash);
    prepareBlessingOffer(w); const frozen = blessingChoices(w), vars = structuredClone(w.vars);
    w.player.equipWeapon(w, 'titan_greatsword'); prepareBlessingOffer(w);
    expect(blessingChoices(w)).toEqual(frozen); expect(w.vars).toEqual(vars);
    const checkpoint = JSON.parse(JSON.stringify(captureCheckpoint(w)));
    w.player.vars = {}; restoreCheckpoint(w, checkpoint);
    expect(blessingChoices(w)).toEqual(frozen); expect(w.vars).toEqual(vars);
    const hash = stateHash(w); for (let i = 0; i < 20; i++) blessingChoices(w); expect(stateHash(w)).toBe(hash);
  });

  it('rerolls once per expedition, excludes the declined offer, rejects stale/duplicate requests and persists consumption', () => {
    const w = solo(), initial = blessingChoices(w), serial = w.vars.__blessOfferSerial;
    expect(rerollBlessings(w, 2, serial)).toBe(false); expect(rerollBlessings(w, 1, serial + 1)).toBe(false);
    expect(canRerollBlessing(w)).toBe(true); expect(rerollBlessings(w, 1, serial)).toBe(true);
    expect(blessingChoices(w).some(id => initial.includes(id))).toBe(false); expect(w.vars.__blessOfferSerial).toBe(serial + 1);
    const checkpoint = captureCheckpoint(w); w.player.vars = {}; restoreCheckpoint(w, checkpoint);
    expect(canRerollBlessing(w)).toBe(false); expect(rerollBlessings(w, 1, serial + 1)).toBe(false);
    markBlessed(w); w.run.floor = 2; prepareBlessingOffer(w); expect(canRerollBlessing(w)).toBe(false);
    expect(canRerollBlessing(solo())).toBe(true);
  });

  it('does not reroll after choosing or during transitions, and validates command integers', () => {
    const w = solo(), serial = w.vars.__blessOfferSerial;
    w.transitioning = true; expect(rerollBlessings(w, 1, serial)).toBe(false); w.transitioning = false;
    markBlessed(w); expect(rerollBlessings(w, 1, serial)).toBe(false);
    for (const value of [NaN, Infinity, 1.5, '1']) expect(isCoopCommand({ type: 'bless_reroll', floor: 1, serial: value })).toBe(false);
    expect(isCoopCommand({ type: 'bless_reroll', floor: 1, serial: 1 })).toBe(true);
  });

  it('four keepers reroll and choose independently, identically on peers with different local players', () => {
    const a = party(0), b = party(3);
    expect(stateHash(a)).toBe(stateHash(b));
    for (let slot = 0; slot < 4; slot++) {
      const untouched = a.players.map(p => structuredClone(p.vars)), p = a.players[slot];
      const old = a.asPlayer(p, () => blessingChoices(a));
      const cmd = { type: 'bless_reroll' as const, floor: 1, serial: p.vars.__blessOfferSerial };
      for (const w of [a, b]) expect(applyCoopCommand(w, slot, cmd)).toBe(true);
      for (let other = 0; other < 4; other++) if (slot !== other) expect(a.players[other].vars).toEqual(untouched[other]);
      expect(stateHash(a)).toBe(stateHash(b)); expect(applyCoopCommand(a, slot, cmd)).toBe(false);
      expect(applyCoopCommand(a, slot, { type: 'bless', floor: 1, id: old[0] })).toBe(false);
      const choice = a.asPlayer(p, () => blessingChoices(a)[0]);
      for (const w of [a, b]) expect(applyCoopCommand(w, slot, { type: 'bless', floor: 1, id: choice })).toBe(true);
      expect(p.items.hasArtifact(choice)).toBe(true); expect(stateHash(a)).toBe(stateHash(b));
    }
    expect(a.players.every(p => p.vars.__blessRerollUsed === 1 && p.vars.__blessedFloor === 1)).toBe(true);
  });

  it('conditional choices describe present/future compatibility instead of promising an inactive bonus', () => {
    expect(blessingCompatibility('bless_patient', ['lantern_bolt'])).toContain('바꾸면');
    expect(blessingCompatibility('bless_patient', ['titan_greatsword'])).toContain('보유한');
    expect(blessingCompatibility('bless_crossstep', ['lantern_bolt'])).toContain('얻으면');
    expect(blessingCompatibility('bless_crossstep', ['lantern_bolt', 'hunter_bow'])).toContain('교체');
  });

  it('standing still activates after 0.6s and lasts only 0.3s after movement; the fired shot keeps its snapshot', () => {
    const w = solo(), blessing = Artifacts.must('bless_footing');
    const shoot = () => { const p = new Projectile({ team: 'player', x: 0, y: 0, angle: 0, speed: 100, damage: 10 }); blessing.onShoot!(w, p, 1); return p; };
    blessing.onRoomEnter!(w, 1); w.time = .59; blessing.onUpdate!(w, .59, 1); expect(shoot().damage).toBe(10);
    w.time = .6; blessing.onUpdate!(w, .01, 1); const enhanced = shoot(); expect(enhanced.damage).toBe(13);
    w.player.x += 2; w.time = .89; blessing.onUpdate!(w, .29, 1); expect(shoot().damage).toBe(13);
    w.time = .91; blessing.onUpdate!(w, .02, 1); expect(shoot().damage).toBe(10); expect(enhanced.damage).toBe(13);
  });
});
