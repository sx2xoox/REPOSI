// Floor 1 boss: 해골 거상 — slams, bone rings, summons walkers.

import { defineBoss } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { GroundWarning } from '../../game/effects';

defineDrawnSprite('bone_colossus', 36, 36, (p) => {
  const b = ramp('#d8ccb0', 5);
  // shoulders / ribcage
  p.ellipse(18, 24, 14, 10, b[2]);
  p.shadeSphere(18, 22, 15, 12, b);
  for (let i = 0; i < 4; i++) p.line(8, 20 + i * 3, 28, 20 + i * 3, b[0]);
  p.line(18, 16, 18, 33, b[1]);
  // skull
  p.circle(18, 11, 9, b[3]);
  p.shadeSphere(18, 11, 9, 9, b);
  p.ellipse(14, 11, 2.5, 3, '#14080a');
  p.ellipse(22, 11, 2.5, 3, '#14080a');
  p.px(14, 11, '#ff3020');
  p.px(22, 11, '#ff3020');
  p.rect(14, 16, 9, 2, '#2a1a18');
  for (let i = 0; i < 4; i++) p.px(15 + i * 2, 16, b[4]);
  // crown of spikes
  p.poly([10, 5, 12, -1, 14, 4], b[1]);
  p.poly([22, 4, 24, -1, 26, 5], b[1]);
}, { outline: '#0c0810' });

defineBoss({
  id: 'bone_colossus',
  name: '해골 거상',
  bossTitle: '지하묘지의 문지기',
  bossFloors: [1],
  hp: 520,
  radius: 14,
  speed: 28,
  mass: 6,
  sprite: 'bone_colossus',
  spriteYOffset: -8,
  deathFx: 'bone',
  contactDamage: 1,
  *script(e, w) {
    while (true) {
      const enraged = e.hp < e.maxHp * 0.5;
      // 1) slow chase
      yield* e.chaseFor(w, 1.6, e.speed * (enraged ? 1.4 : 1));
      e.stop();
      // 2) jump slam at the player
      const t = e.target(w);
      w.spawn(new GroundWarning(t.x, t.y, 30, 0.7));
      e.telegraph(0.4);
      yield 0.3;
      yield* e.jumpTo(w, t.x, t.y, 0.7, 50);
      w.shake(0.5);
      w.sfx('slam');
      e.shootRing(w, enraged ? 14 : 10, { speed: 90, offset: w.rng.angle() });
      yield 0.6;
      // 3) aimed bone fan
      e.telegraph(0.4);
      yield 0.4;
      for (let k = 0; k < (enraged ? 3 : 2); k++) {
        e.shootAt(w, null, { count: 5, spread: 0.22, speed: 130 });
        yield 0.35;
      }
      // 4) summon
      if (w.enemies.length < 4 && w.rng.chance(0.6)) {
        e.summon(w, 'bone_walker', e.x - 24, e.y + 10);
        e.summon(w, 'bone_walker', e.x + 24, e.y + 10);
        w.sfx('summon');
      }
      yield 0.8;
    }
  },
});
