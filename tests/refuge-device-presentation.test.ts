import './headless';
import { expect, it } from 'vitest';
import { measureDps } from './dpsharness';
import { stateHash } from '../src/game/statehash';
import { save } from '../src/engine/save';
import { RefugeFootwork } from '../src/content/characters/refuge-devices';
import { refugeVisualOpacity } from '../src/content/characters/refuge-common';

it('dash flourishes allocate cosmetic ids and never enter lockstep state', () => {
  for (const [id, mode] of [['luen', 1], ['ves', 2]] as const) {
    const { world: w } = measureDps({ character: id, weapon: 'lantern_bolt', seconds: 0 });
    const p = w.player;
    p.dashX0 = p.x - 20; p.dashY0 = p.y;
    const before = stateHash(w);
    const effect = w.withIds(() => w.spawn(new RefugeFootwork(w, p, mode)));
    expect(effect.id).toBeLessThan(0);
    expect(stateHash(w)).toBe(before);
    for (let i = 0; i < 24; i++) {
      effect.update(w, 1 / 60);
      w.renderer.worldOpacity = .37;
      effect.draw(w.renderer, w);
      effect.light(w);
      expect(stateHash(w)).toBe(before);
      expect(w.renderer.worldOpacity).toBe(.37);
    }
    expect(effect.dead).toBe(true);
  }
});

it('invalid teammate-opacity settings cannot introduce NaN into device art or lighting', () => {
  const { world: w } = measureDps({ character: 'luen', weapon: 'lantern_bolt', seconds: 0 });
  w.startParty([{ slot: 0, characterId: 'luen', name: '' }, { slot: 1, characterId: 'ort', name: '' }], 0);
  const previous = save.settings.teammateProjectileOpacity;
  try {
    for (const [input, expected] of [[NaN, .5], [Infinity, .5], [-Infinity, .5], [-1, 0], [0, 0], [.3, .3], [1, 1], [2, 1]]) {
      save.settings.teammateProjectileOpacity = input;
      expect(refugeVisualOpacity(w, w.players[1])).toBe(expected);
      expect(refugeVisualOpacity(w, w.local)).toBe(1);
    }
  } finally { save.settings.teammateProjectileOpacity = previous; }
});
