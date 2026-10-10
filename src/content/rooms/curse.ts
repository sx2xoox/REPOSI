// Price room "대가의 방" (kind 'curse'): stepping in costs half a heart. Inside wait items
// paid with maximum health (Pedestal.heartPrice) and a couple of chests.

import { registerRoomHandler } from '../../game/roomkinds';
import { Entity } from '../../game/entity';
import { Chest, Pedestal } from '../../game/pickups';
import type { World } from '../../game/world';
import { fx } from '../../engine/rng';
import { Candles } from '../props/lights';
import { ritualCircle, darkRing, withDecals } from './decor';
import { HintLabel } from './label';

/** Takes the entry toll once the room transition has finished. */
class CurseToll extends Entity {
  constructor() {
    super();
    this.tileCollide = false;
    this.layer = 0;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (w.transitioning || this.age < 0.15) return;
    this.dead = true;
    // every keeper who walked in pays (co-op)
    for (const p of w.targets()) {
      if (!p.alive || p.red + p.soul <= 1) continue; // never lethal
      if (p.hurt(w, 1, '대가의 문', true)) {
        w.floatText(p.x, p.y - 20, '대가를 치렀다', '#ff6080');
        w.particles.burst(p.x, p.y - 8, { count: 16, speed: [20, 60], life: [0.5, 1], colors: ['#ff70c0', '#a02070', '#300820'], size: [1, 2], additive: true });
      }
    }
  }
}

registerRoomHandler('curse', {
  populate(w, room, rng) {
    const m = room.markers.find((k) => k.ch === '@');
    const cx = m ? m.x : room.centerX;
    const cy = m ? m.y : room.centerY;
    withDecals(room, (p) => {
      darkRing(p, cx, cy, 52, 0.45);
      ritualCircle(p, cx, cy + 2, 64, '#c0306a', 0.55);
    });
    for (const [dx, dy] of [[-70, -34], [70, -34], [-70, 38], [70, 38]] as [number, number][]) {
      if (room.isFree(cx + dx, cy + dy, 5)) w.spawn(new Candles(cx + dx, cy + dy, 3, 'blood'));
    }
    const a = w.loot.rollItem('curse', w.run.lootRng) ?? w.loot.rollItem('boss', w.run.lootRng) ?? w.loot.rollItem('treasure', w.run.lootRng);
    const b = w.loot.rollItem('curse', w.run.lootRng, { minRarity: 'rare' }) ?? w.loot.rollItem('treasure', w.run.lootRng, { minRarity: 'rare' });
    if (a) {
      const ped = w.spawn(new Pedestal(cx - 30, cy - 4, a));
      ped.heartPrice = 1;
    }
    if (b) {
      const ped = w.spawn(new Pedestal(cx + 30, cy - 4, b));
      ped.heartPrice = 2;
    }
    w.spawn(new Chest(cx - 54, cy + 30, false));
    w.spawn(new Chest(cx + 54, cy + 30, rng.chance(0.5)));
    w.spawn(new HintLabel(cx, cy - 36, '체력으로 값을 치른다', () => true, '#ff90c0', 70));
  },
  spawnEnemies() {
    return false;
  },
  onEnter(w) {
    w.spawn(new CurseToll());
    if (fx.chance(0.5)) w.sfx('warn', { vol: 0.4, pitch: 0.6 });
  },
});
