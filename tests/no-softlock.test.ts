// Without bombs nothing may need one: on every floor and stage, every room but the
// sealed / secret ones is reachable from the start through plain doors; every sealed
// room has a plain door from a reachable room (its seal lamp can be lit with a match);
// every secret room borders a reachable plain room (its cold sconce can be lit).
// Inside rooms, tests/rooms.test.ts keeps doors, enemies and pickups reachable without
// breaking anything, and tests/stone-lantern.test.ts the lanterns.

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Floors, lastFloorIndex } from '../src/game/defs';
import { generateStage } from '../src/game/dungeon';
import { STAGES_PER_FLOOR } from '../src/game/stage-plan';
import { RNG } from '../src/engine/rng';

loadContent();

const SEALED_OR_HIDDEN = new Set(['treasure', 'shop', 'secret']);

describe('no room needs a bomb', () => {
  it('60 seeds x every floor x every stage: plain doors reach every room but the sealed / secret ones', () => {
    const problems: string[] = [];
    let sealed = 0;
    let secrets = 0;
    for (const floor of Floors.all().filter((f) => f.index <= lastFloorIndex())) {
      for (let stage = 1; stage <= STAGES_PER_FLOOR; stage++) {
        for (let s = 0; s < 60; s++) {
          const key = `SOFTLOCK-${floor.index}-${stage}-${s}`;
          const map = generateStage(floor, stage, new RNG(key));
          const seen = new Set<number>([map.startId]);
          const q = [map.startId];
          while (q.length) {
            const n = map.nodes[q.pop()!];
            for (const d of n.doors) {
              const to = map.nodes[d.to];
              if (d.secret || to.locked || seen.has(to.id)) continue;
              seen.add(to.id);
              q.push(to.id);
            }
          }
          for (const n of map.nodes) {
            if (!SEALED_OR_HIDDEN.has(n.kind) && !seen.has(n.id)) problems.push(`${key}: ${n.kind} #${n.id} unreachable`);
            if (n.locked) {
              sealed++;
              // a seal lamp on a plain door of a reachable room
              if (!n.doors.some((d) => !d.secret && seen.has(d.to))) problems.push(`${key}: sealed ${n.kind} #${n.id} has no reachable door`);
            }
            if (n.kind === 'secret') {
              secrets++;
              if (!n.doors.some((d) => seen.has(d.to) && map.nodes[d.to].kind !== 'secret')) problems.push(`${key}: secret #${n.id} borders no reachable room`);
            }
            if (n.lantern && !seen.has(n.id)) problems.push(`${key}: lantern room #${n.id} unreachable`);
          }
          // the way on: the boss room (stage 3) or the exit at the start
          if (stage === STAGES_PER_FLOOR) {
            const boss = map.nodes.find((n) => n.kind === 'boss');
            if (!boss || !seen.has(boss.id)) problems.push(`${key}: boss unreachable`);
          } else if (map.exitId === undefined || !seen.has(map.exitId)) problems.push(`${key}: no exit`);
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
    expect(sealed).toBeGreaterThan(0);
    expect(secrets).toBeGreaterThan(0);
  });
});
