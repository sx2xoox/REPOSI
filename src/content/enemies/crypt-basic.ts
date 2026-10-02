// Floor 1 basics: 그을음 날벌레 (gloom fly) and 해골 보행자 (bone walker).

import { defineEnemy } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { fx } from '../../engine/rng';
import { frames, sphere, spinDraw } from './shared';

// ------------------------------------------------------------------ gloom fly
// A soot-black fly with a smouldering ember belly; fast erratic chaser (fodder).
const FLY_BODY = ['#120c18', '#24182c', '#3c2c48', '#64506e', '#8e7aa0'];
frames('gloomfly', 'fly', 3, 15, 12, (p, i) => {
  // wings: up / level / down
  const tip = [0, 2.5, 4.5][i];
  const wingFill = '#c8c0e0a0';
  const wingEdge = '#f0ecffd0';
  // left wing
  p.poly([6, 6, 1, tip, 0, tip + 2, 2, tip + 4.5, 6, 7.5], wingFill);
  p.line(6, 6, 1, tip, wingEdge);
  // right wing
  p.poly([9, 6, 14, tip, 15, tip + 2, 13, tip + 4.5, 9, 7.5], wingFill);
  p.line(9, 6, 14, tip, wingEdge);
  // body + head
  p.circle(7.5, 7.5, 3.9, FLY_BODY[2]);
  sphere(p, 7.5, 7.5, 3.9, 3.9, FLY_BODY);
  // Chitin plates: a lit shoulder and a dark seam above the ember sac.
  p.line(5, 6, 6, 6, FLY_BODY[4]);
  p.line(6, 8, 9, 8, FLY_BODY[1]);
  p.circle(7.5, 4.6, 2.4, FLY_BODY[2]);
  sphere(p, 7.5, 4.6, 2.4, 2.4, FLY_BODY, false);
  // ember glow in the belly
  p.px(7, 9, '#ff6a20');
  p.px(8, 9, '#ffb048');
  p.px(7, 10, '#b03010');
  p.px(8, 8, '#ff8a30');
  // glowing eyes
  p.px(6, 4, '#ff3a2a');
  p.px(9, 4, '#ff3a2a');
  p.px(6, 3, '#ffc0a8');
  p.px(9, 3, '#ffc0a8');
  // dangling legs
  p.px(6, 11, '#1a1020');
  p.px(9, 11, '#1a1020');
}, { fps: 18 });

defineEnemy({
  id: 'gloom_fly',
  name: '그을음 날벌레',
  hp: 12,
  radius: 4,
  speed: 48,
  flying: true,
  sprite: 'gloomfly_fly',
  shadow: 7,
  spriteYOffset: -7,
  cost: 0.5,
  floors: [1, 2],
  weight: 2,
  champion: true,
  deathFx: 'goo',
  bloodColor: '#4a3a52',
  light: { radius: 14, color: '#ff5a30' },
  *script(e, w) {
    while (true) {
      // erratic chase, now and then a short buzzing dart at the player
      if (w.rng.chance(0.12) && e.distToTarget(w) < 110) {
        e.telegraph(0.25);
        e.stop();
        yield 0.25;
        e.moveAngle(e.angleToTarget(w), e.speed * 2.2);
        w.sfx('whoosh', { vol: 0.2, pitch: 1.8 });
        yield 0.3;
      }
      const a = e.angleToTarget(w) + (w.rng.next() - 0.5) * 1.8;
      e.moveAngle(a, e.speed);
      yield w.rng.range(0.15, 0.35);
    }
  },
  draw(e, r) {
    e.drawDefault(r, e.frame(), -7 + Math.sin(e.age * 9 + e.id) * 1.5);
  },
});

// ------------------------------------------------------------------ bone walker
// Shambling skeleton that stops to hurl spinning bones.
const BONE = ramp('#dcd2b6', 5);
const SOCKET = '#1a0c10';

interface SkelPose {
  bob: number;
  legL: number;
  legR: number;
  /** hand offsets relative to the default hanging position */
  armL: [number, number];
  armR: [number, number];
  /** holds a bone over the head (throw windup) */
  hold?: boolean;
  jaw?: number;
}

function paintSkeleton(p: import('../../engine/painter').PixelPainter, s: SkelPose): void {
  const by = s.bob;
  // legs (behind): thigh from pelvis, shin to foot
  const leg = (hx: number, off: number) => {
    p.line(hx, 14 + by, hx + off * 0.5, 16, BONE[1]);
    p.line(hx + off * 0.5, 16, hx + off, 17, BONE[2]);
    p.rect(hx + off - (off < 0 ? 1 : 0), 17, 2, 1, BONE[2]);
  };
  leg(5, s.legL);
  leg(9, s.legR);
  // pelvis
  p.rect(5, 13 + by, 5, 2, BONE[2]);
  p.px(7, 14 + by, SOCKET);
  // spine + ribcage
  p.ellipse(7.5, 10.5 + by, 3.4, 2.6, BONE[3]);
  sphere(p, 7.5, 10.5 + by, 3.4, 2.6, BONE, false);
  p.line(5, 10 + by, 10, 10 + by, BONE[0]);
  p.line(5, 12 + by, 10, 12 + by, BONE[0]);
  p.line(7, 9 + by, 7, 13 + by, BONE[1]);
  // back arm
  const ax = 4 + s.armL[0];
  const ay = 12 + by + s.armL[1];
  p.line(5, 9 + by, ax, ay, BONE[1]);
  p.px(ax, ay + 1, BONE[2]);
  // skull
  p.circle(7.5, 4.5 + by, 4.2, BONE[3]);
  sphere(p, 7.5, 4.5 + by, 4.2, 4.2, BONE, false);
  // A chipped brow, short fracture and shaded cheek give the skull a face.
  p.line(5, 2 + by, 7, 1 + by, BONE[4]);
  p.px(9, 1 + by, BONE[1]);
  p.px(8, 2 + by, BONE[1]);
  p.px(9, 3 + by, BONE[2]);
  p.rect(5, 7 + by, 6, 2, BONE[2]);
  // eye sockets with ember pupils
  p.rect(6, 4 + by, 2, 2, SOCKET);
  p.rect(9, 4 + by, 2, 2, SOCKET);
  p.px(7, 4 + by, '#ff4a32');
  p.px(10, 4 + by, '#ff4a32');
  p.px(8, 6 + by, SOCKET);
  p.px(5, 6 + by, BONE[4]);
  p.px(11, 6 + by, BONE[1]);
  // jaw / teeth
  const jaw = s.jaw ?? 0;
  p.rect(6, 8 + by, 5, 1 + jaw, SOCKET);
  p.px(6, 8 + by, BONE[4]);
  p.px(8, 8 + by, BONE[4]);
  p.px(10, 8 + by, BONE[4]);
  // front arm
  const fx2 = 11 + s.armR[0];
  const fy2 = 12 + by + s.armR[1];
  p.line(10, 9 + by, fx2, fy2, BONE[3]);
  p.px(fx2, fy2 + (s.armR[1] < -4 ? -1 : 1), BONE[4]);
  if (s.hold) {
    // bone held over the head
    p.line(fx2 - 3, fy2 - 1, fx2 + 2, fy2 - 2, BONE[4]);
    p.px(fx2 - 3, fy2 - 2, BONE[4]);
    p.px(fx2 + 2, fy2 - 3, BONE[4]);
  }
}

const WALK: SkelPose[] = [
  { bob: 0, legL: -1, legR: 1, armL: [1, 0], armR: [-1, 0] },
  { bob: -1, legL: 0, legR: 0, armL: [0, 0], armR: [0, 0] },
  { bob: 0, legL: 1, legR: -1, armL: [-1, 0], armR: [1, 0] },
  { bob: -1, legL: 0, legR: 0, armL: [0, 0], armR: [0, 0] },
];
frames('bonewalker', 'walk', 4, 15, 19, (p, i) => paintSkeleton(p, WALK[i]), { anchor: 'bottom', fps: 6 });
frames('bonewalker', 'throw', 2, 15, 19, (p, i) =>
  paintSkeleton(p, i === 0
    ? { bob: 0, legL: -1, legR: 1, armL: [1, -1], armR: [-3, -10], hold: true, jaw: 1 }
    : { bob: 1, legL: -1, legR: 2, armL: [-1, 0], armR: [3, -3], jaw: 0 }), { anchor: 'bottom', fps: 6, loop: false });

defineDrawnSprite('bonewalker_bone', 8, 4, (p) => {
  p.line(1, 2, 6, 1, BONE[3]);
  p.rect(0, 1, 2, 2, BONE[4]);
  p.rect(6, 0, 2, 2, BONE[4]);
  p.px(0, 2, BONE[2]);
  p.px(7, 1, BONE[2]);
}, { outline: '#24100c' });

defineEnemy({
  id: 'bone_walker',
  name: '해골 보행자',
  hp: 30,
  radius: 5,
  speed: 30,
  sprite: 'bonewalker_walk',
  spriteYOffset: 5,
  cost: 1,
  floors: [1],
  weight: 2,
  champion: true,
  deathFx: 'bone',
  bloodColor: '#e0d6bc',
  hurtSfx: 'hit',
  *script(e, w) {
    while (true) {
      e.setAnim('bonewalker_walk');
      yield* e.chaseFor(w, w.rng.range(1.4, 2.4));
      if (e.distToTarget(w) < 150 && w.room.lineOfSight(e.x, e.y, w.player.x, w.player.y)) {
        e.halt();
        e.facing = w.player.x >= e.x ? 1 : -1;
        e.setAnim('bonewalker_throw_0');
        e.telegraph(0.45);
        yield 0.45;
        e.setAnim('bonewalker_throw_1');
        const pr = e.shoot(w, e.angleToTarget(w), { speed: 115, radius: 3, color: '#e8dcc0', style: 'none', light: 0 });
        pr.mem.spinDir = e.facing;
        pr.addBehavior(spinDraw('bonewalker_bone', 16));
        w.sfx('whoosh', { vol: 0.35, pitch: fx.range(1.2, 1.4) });
        yield 0.45;
      }
    }
  },
});
