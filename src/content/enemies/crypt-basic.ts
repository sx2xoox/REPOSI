// Floor 1 basics: 그을음 날벌레 (gloom fly) and 해골 보행자 (bone walker).

import { defineEnemy } from '../../game/defs';
import { defineAnim, defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';

// ---- gloom fly
for (let i = 0; i < 2; i++) {
  defineDrawnSprite(`gloomfly_${i}`, 12, 10, (p) => {
    // wings
    const wy = i === 0 ? 1 : 3;
    p.ellipse(3, wy + 1, 3, 2, '#c8c0d8a0');
    p.ellipse(9, wy + 1, 3, 2, '#c8c0d8a0');
    // body
    p.circle(6, 6, 3.6, '#3a2a3a');
    p.shadeSphere(6, 6, 3.6, 3.6, ['#1a1020', '#2a1a2a', '#4a3a4a', '#6a5a6a']);
    p.px(5, 5, '#ff4040');
    p.px(7, 5, '#ff4040');
  }, { outline: '#0c0810' });
}
defineAnim('gloomfly', ['gloomfly_0', 'gloomfly_1'], 14);

defineEnemy({
  id: 'gloom_fly',
  name: '그을음 날벌레',
  hp: 14,
  radius: 4,
  speed: 46,
  flying: true,
  sprite: 'gloomfly',
  shadow: 6,
  spriteYOffset: -6,
  cost: 0.5,
  floors: [1, 2],
  weight: 2,
  deathFx: 'goo',
  bloodColor: '#4a3a4a',
  *script(e, w) {
    while (true) {
      // erratic chase
      const a = e.angleToTarget(w) + (w.rng.next() - 0.5) * 1.6;
      e.moveAngle(a, e.speed);
      yield w.rng.range(0.15, 0.35);
    }
  },
});

// ---- bone walker
function boneWalker(name: string, step: number): void {
  defineDrawnSprite(name, 12, 16, (p) => {
    const b = ramp('#d8d0b8', 4);
    // legs
    p.rect(3 + (step ? 1 : 0), 12, 2, 4, b[1]);
    p.rect(7 - (step ? 1 : 0), 12, 2, 4, b[1]);
    // ribcage
    p.ellipse(6, 9, 4, 3.5, b[2]);
    p.line(3, 8, 9, 8, b[0]);
    p.line(3, 10, 9, 10, b[0]);
    // skull
    p.circle(6, 4, 4, b[3]);
    p.shadeSphere(6, 4, 4, 4, b, { dither: false });
    p.rect(4, 4, 2, 2, '#1a1010');
    p.rect(7, 4, 2, 2, '#1a1010');
    p.px(4, 4, '#ff5040');
    p.px(7, 4, '#ff5040');
    p.rect(5, 7, 3, 1, '#3a3028');
  }, { outline: '#0c0810', anchor: 'bottom' });
}
boneWalker('bonewalker_0', 0);
boneWalker('bonewalker_1', 1);
defineAnim('bonewalker', ['bonewalker_0', 'bonewalker_1'], 5);

defineEnemy({
  id: 'bone_walker',
  name: '해골 보행자',
  hp: 32,
  radius: 5,
  speed: 30,
  sprite: 'bonewalker',
  spriteYOffset: 6,
  cost: 1,
  floors: [1, 2],
  weight: 2,
  deathFx: 'bone',
  *script(e, w) {
    while (true) {
      yield* e.chaseFor(w, w.rng.range(1.4, 2.4));
      if (e.distToTarget(w) < 140 && w.room.lineOfSight(e.x, e.y, w.player.x, w.player.y)) {
        e.stop();
        e.telegraph(0.35);
        yield 0.35;
        e.shootAt(w, null, { speed: 110 });
        yield 0.4;
      }
    }
  },
});
