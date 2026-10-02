import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Enemies } from '../src/game/defs';
import { getAnim, hasAnim, hasSprite } from '../src/engine/sprites';
import { MUSIC_IDS } from '../src/audio/audio';
import { eyeSprite } from '../src/content/bosses/final-art';
import { FinalDawn } from '../src/content/bosses/final';

loadContent();

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

describe('final boss 무명', () => {
  it('is the only boss registered for floor 5, with intro data', () => {
    const finals = Enemies.all().filter((e) => e.boss && e.bossFloors?.includes(5));
    expect(finals.map((e) => e.id)).toEqual(['mumyeong']);
    const d = finals[0];
    expect(d.name).toBe('무명');
    expect(d.bossTitle).toMatch(/[가-힣]/);
    expect(d.bossMusic).toBe('boss_final');
    expect(MUSIC_IDS).toContain('boss_final');
    expect(d.deathFx).toBe('void');
    expect(d.hp).toBeGreaterThanOrEqual(900);
    expect(d.hp).toBeLessThanOrEqual(1100);
    expect(d.script).toBeTypeOf('function');
    expect(d.draw).toBeTypeOf('function');
    expect(d.portrait && hasSprite(d.portrait)).toBe(true);
  });

  it('defines every sprite the fight draws', () => {
    const names = [
      'mmy_body', 'mmy_body2', 'mmy_strain_0', 'mmy_strain_1', 'mmy_strain_2', 'mmy_core', 'mmy_crown',
      'mmy_hand_open', 'mmy_hand_fist', 'mmy_hand_claw', 'mmy_shard_0', 'mmy_shard_3', 'mmy_link_a', 'mmy_link_b',
      'mmy_seg', 'mmy_seg_tip', 'mmy_brazier', 'mmy_brazier_off', 'mmy_flame', 'vmoth_fly', 'mmy_star', 'mmy_portrait',
    ];
    for (const n of names) expect(spriteDefined(n), n).toBe(true);
    for (const st of ['open', 'wide', 'half', 'closed'] as const) expect(hasSprite(eyeSprite(st, 3, -1, true))).toBe(true);
  });

  it('registers its minions (summons only existing floor-5 enemies or its own moth)', () => {
    for (const id of ['void_eye', 'abyss_larva', 'void_moth']) expect(Enemies.get(id), id).toBeTruthy();
    const moth = Enemies.get('void_moth')!;
    expect(moth.floors ?? []).not.toContain(5);
    expect(spriteDefined(moth.sprite)).toBe(true);
  });

  it('victory cinematic lasts a couple of seconds', () => {
    expect(FinalDawn.DURATION).toBeGreaterThanOrEqual(2);
    expect(FinalDawn.DURATION).toBeLessThanOrEqual(3.5);
  });
});
