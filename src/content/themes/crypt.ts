// Floor 1 theme: cold blue-grey crypt with bones and wall torches.

import { defineTheme } from '../../game/defs';
import { Torch } from '../../game/effects';
import { TILE, WALL } from '../../game/constants';
import { fx } from '../../engine/rng';

defineTheme({
  id: 'crypt',
  name: '지하묘지',
  palette: {
    floor: ['#1e1a26', '#2c2734', '#383242', '#463f52'],
    wall: ['#16121c', '#2a2433', '#4a4256', '#5e5470'],
    rock: ['#2a2630', '#4a4452', '#6a6274', '#8e8698', '#b8b0c0'],
    pit: '#05030a',
    accent: ['#6a5f50', '#a89880', '#d8ccb8'],
    dark: '#0c0810',
  },
  ambient: '#7a7090',
  decorate(w, rng) {
    const room = w.room;
    // torches on the top wall between doors
    const n = room.node.cw * 2;
    for (let i = 0; i < n; i++) {
      const x = WALL * TILE + ((i + 0.5) / n) * room.interiorW + (rng.next() - 0.5) * 20;
      if (room.doors.some((d) => d.dir === 'N' && Math.abs(d.x - x) < 24)) continue;
      w.spawn(new Torch(x, WALL * TILE - 8, '#ffb060'));
    }
  },
  ambientFx(w, dt) {
    if (fx.chance(dt * 3)) {
      const r = w.room;
      w.particles.spawn({
        x: r.interiorX + fx.next() * r.interiorW, y: r.interiorY + fx.next() * r.interiorH,
        vx: fx.range(-4, 4), vy: fx.range(-6, -2), life: fx.range(2, 4), colors: ['#8a809a'], size: 1, alpha: 0.5,
      });
    }
  },
});
