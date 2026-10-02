import { it } from 'vitest';
import './detsim';
import { Actives, Artifacts, Enemies, Weapons } from '../src/game/defs';
it('counts', () => {
  console.log('COUNTS artifacts', Artifacts.all().filter((a) => !a.hidden && !a.blessing).length, 'actives', Actives.all().length, 'weapons', Weapons.all().length, 'enemies', Enemies.all().filter((e) => !e.boss).length, 'regular', Enemies.all().filter((e) => !e.boss && e.floors?.length).length);
});
