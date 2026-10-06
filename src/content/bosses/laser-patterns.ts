import { defineEnemy } from '../../game/defs';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Script } from '../../engine/script';
import { RingFx } from '../../game/effects';
import { Beam, inRoom, summonMinion } from './final-kit';

/** A real beam, canceled immediately by its emitter's destruction or a boss phase change. */
export class BossBeam extends Beam {
  private phase: number;
  constructor(readonly emitter: Enemy, readonly controller: Enemy, x: number, y: number, angle: number,
    options: ConstructorParameters<typeof Beam>[3]) {
    super(x, y, angle, options);
    this.phase = controller.phase;
  }
  override update(w: World, dt: number): void {
    if (!this.emitter.alive || !this.controller.alive || this.controller.phase !== this.phase) {
      this.dead = true;
      return;
    }
    super.update(w, dt);
  }
}

defineEnemy({
  id: 'frost_prism', name: '얼음 공명정', hp: 18, radius: 7, speed: 0, mass: 8,
  sprite: 'fsaint_lance', shadow: 15, contactDamage: 0, deathFx: 'ice',
  bloodColor: '#91d8ff', hurtSfx: 'hit_metal', light: { radius: 28, color: '#91d8ff' },
  init(e) { e.harmful = false; },
  *script(e, w) {
    const owner = e.mem.owner as Enemy | undefined;
    if (!owner?.alive) { e.dead = true; return; }
    const phase = owner.phase;
    // The entire charging line is shown while the keeper can destroy the emitter.
    const t = owner.target(w);
    const a = Math.atan2(t.y - 4 - e.y, t.x - e.x);
    const beam = w.spawn(new BossBeam(e, owner, e.x, e.y, a, {
      aim: 1.1, lock: 0.65, fire: 0.65, width: 9, color: '#76dfff', source: owner.def.name,
    }));
    e.mem.beam = beam;
    while (!beam.dead && owner.alive && owner.phase === phase) yield;
    e.dead = true;
  },
  update(e) {
    const owner = e.mem.owner as Enemy | undefined;
    if (owner && !owner.alive) e.dead = true;
  },
  onDeath(e, w) {
    const beam = e.mem.beam as BossBeam | undefined;
    if (beam) beam.dead = true;
    w.spawn(new RingFx(e.x, e.y, 20, 0.3, '#bceaff', 2));
  },
  draw(e, r) {
    r.shadow(e.x, e.y + 4, 17, 6, 0.3);
    for (const side of [-1, 1]) r.sprite('fsaint_lance', e.x + side * 4, e.y, { rot: side * 0.42, flash: e.flash > 0 ? 1 : 0 });
    r.sprite('fsaint_lance', e.x, e.y - 4, { flash: e.flash > 0 ? 1 : 0 });
    r.rect(e.x - 8, e.y + 9, 16, 2, '#122239');
    r.rect(e.x - 8, e.y + 9, 16 * Math.max(0, e.hp / e.maxHp), 2, '#a8eaff');
  },
});

/** The smith vents a locked furnace lane, then must cool while exposed. */
export function* furnaceDischarge(e: Enemy, w: World): Script {
  e.mem.lastLaserAt = e.age;
  e.halt();
  e.setAnim(`${e.mem.p2 ? 'csmith2' : 'csmith'}_vent`, true);
  e.telegraph(1.05);
  const t = e.target(w), x = e.x, y = e.y - 6;
  const a = Math.atan2(t.y - 4 - y, t.x - x);
  const beam = w.spawn(new BossBeam(e, e, x, y, a, {
    aim: 0.5, lock: 0.55, fire: e.mem.p2 ? 0.95 : 0.75, width: 13,
    color: '#ff9838', source: e.def.name,
  }));
  w.sfx('enemy_charge', { vol: 0.65, pitch: 0.55 });
  while (!beam.dead) yield;
  e.setAnim(`${e.mem.p2 ? 'csmith2' : 'csmith'}_hurt`, true);
  yield 0.85;
}

/** Two breakable crystals charge independent fixed lanes. Killing one opens that lane. */
export function* prismLattice(e: Enemy, w: World): Script {
  e.mem.lastLaserAt = e.age;
  if (!e.mem.prismHint) {
    e.mem.prismHint = 1;
    w.banner('얼음 공명정', '공명정을 부수면 해당 레이저가 끊깁니다.', { small: true, color: '#91d8ff' });
  }
  e.halt();
  e.setAnim(`${e.mem.p2 ? 'fsaint2' : 'fsaint'}_cast`, true);
  e.telegraph(0.6);
  const points = [-1, 1].map(side => inRoom(w, e.x + side * 62, e.y + 24, 18));
  for (const point of points) w.spawn(new RingFx(point.x, point.y, 15, 0.6, '#8ce1ff', 2));
  w.sfx('freeze', { vol: 0.65, pitch: 0.7 });
  yield 0.6;
  const prisms = points.map(point => summonMinion(e, w, 'frost_prism', point.x, point.y, ['#ffffff', '#8ce1ff']));
  yield 0.1; // let pending emitters enter the world before observing their lifetime
  while (prisms.some(prism => prism?.alive) && e.alive) yield;
  e.setAnim(`${e.mem.p2 ? 'fsaint2' : 'fsaint'}_idle`, true);
  yield 0.85;
}

/** The clock marks four rays, locks, strikes, then announces a second shifted cross. */
export function* clockChime(e: Enemy, w: World): Script {
  e.mem.lastLaserAt = e.age;
  e.halt();
  e.setAnim(`${e.mem.p2 ? 'ck2' : 'ck'}_wind`, true);
  const t = e.target(w);
  const start = Math.atan2(t.y - 4 - e.y, t.x - e.x);
  const rounds = e.mem.p2 ? 2 : 1;
  for (let round = 0; round < rounds; round++) {
    e.telegraph(1.05);
    const beams = Array.from({ length: 4 }, (_, i) => w.spawn(new BossBeam(e, e, e.x, e.y, start + round * Math.PI / 4 + i * Math.PI / 2, {
      aim: 0.45, lock: 0.6, fire: 0.55, width: 8, color: '#ffd06b', source: e.def.name,
    })));
    w.sfx('clockboss_tick', { vol: 0.8, pitch: 0.75 + round * 0.2 });
    while (beams.some(beam => !beam.dead)) yield;
    if (round + 1 < rounds) yield 0.35;
  }
  e.setAnim(`${e.mem.p2 ? 'ck2' : 'ck'}_idle`, true);
  yield 0.8;
}
