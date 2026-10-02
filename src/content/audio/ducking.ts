// Which sounds briefly duck the music (depth = fraction removed, hold = seconds).
// Jingles and big moments get the stage to themselves for a beat; everyday
// combat sounds never duck.

import { setSfxDuck } from '../../audio/audio';

setSfxDuck('item_get', 0.5, 0.9);
setSfxDuck('item_get_rare', 0.7, 1.5);
setSfxDuck('secret_found', 0.55, 1.3);
setSfxDuck('power_up', 0.35, 0.7);
setSfxDuck('chest_open', 0.25, 0.6);
setSfxDuck('floor_start', 0.45, 1.2);
setSfxDuck('room_clear', 0.2, 0.5);
setSfxDuck('boss_roar', 0.35, 1.1);
setSfxDuck('boss_phase', 0.4, 1.2);
setSfxDuck('boss_die', 0.65, 2.0);
setSfxDuck('player_die', 0.8, 1.8);
setSfxDuck('teleport', 0.2, 0.5);
