import './headless';
import { describe, expect, it, vi } from 'vitest';
import { measureDps, PLAIN_ID } from './dpsharness';
import { Projectile } from '../src/game/projectile';
import { lobBehavior } from '../src/content/weapons/kit';
import { FIXED_DT } from '../src/game/constants';
import { HELD } from '../src/game/seam';

describe('lobbed weapon landing regression', () => {
  it.each([60, 180, 1200])('a short shell lands once at speed %i even when one step crosses both flight and range', speed => {
    const { world: w } = measureDps({ character: PLAIN_ID, weapon: 'lantern_bolt', seconds: 0 });
    const land = vi.fn(), behavior = lobBehavior(20, 26, land);
    const projectile = new Projectile({ team: 'player', owner: w.player, x: w.player.x, y: w.player.y,
      angle: 0, speed, range: 22, damage: 1, style: 'none', behaviors: [behavior] });
    for (let i = 0; i < 120 && !projectile.dead; i++) projectile.update(w, FIXED_DT);
    expect(projectile.dead).toBe(true); expect(land).toHaveBeenCalledTimes(1);
    expect(projectile.mem.landed).toBe(1);
    // Wall handling and expiration can occur in the same update. Neither is
    // allowed to repeat an already completed landing callback.
    behavior.onWall!(projectile, w); behavior.onExpire!(projectile, w); projectile.expire(w, false);
    expect(land).toHaveBeenCalledTimes(1);
  });

  it.each([[40, 1], [60, 1], [60, 3], [100, 3]])('one mortar shot at %ipx and speed scale %i produces exactly one damaging explosion', (distance, scale) => {
    const { world: w, dummies } = measureDps({ character: PLAIN_ID, weapon: 'thunder_mortar', seconds: 0, dist: distance });
    const p = w.player, target = dummies[0], hp = target.hp;
    p.stats.critChance = 0;
    let fired = false;
    w.inputSource = (_w, _p, out) => { out.mx = out.my = out.ax = out.ay = out.pressed = 0;
      out.held = HELD.cursorAim | (!fired ? HELD.fire : 0); out.cx = target.x; out.cy = target.y; };
    const spawned = vi.spyOn(w, 'spawn'), sound = vi.spyOn(w, 'sfx');
    const emitted = () => spawned.mock.calls.map(([e]) => e).filter((e): e is Projectile => e instanceof Projectile && e.behaviors.some(b => b.id === 'mortar_shell'));
    // Equipping has its ordinary ready delay; release fire as soon as its first
    // shot actually exists, rather than assuming the first simulation frame.
    for (let i = 0; i < 120 && !emitted().length; i++) w.update(FIXED_DT);
    fired = true;
    const shells = emitted();
    expect(shells).toHaveLength(1);
    shells[0].speed *= scale;
    for (let i = 0; i < 120; i++) w.update(FIXED_DT);
    expect(sound.mock.calls.filter(([name]) => name === 'slam')).toHaveLength(1);
    expect(hp - target.hp).toBeCloseTo(shells[0].mem.weaponDamage * 2, 6);
    expect(shells[0].mem.landed).toBe(1); expect(shells[0].dead).toBe(true);
    expect(spawned.mock.calls.filter(([e]) => e instanceof Projectile && e.behaviors.some(b => b.id === 'mortar_shell'))).toHaveLength(1);
  });
});
