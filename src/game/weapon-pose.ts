import type { Player } from './player';

/** Draw-only grip. Ballistic origins and lockstep simulation keep handPos unchanged. */
export function visualHandPos(p: Player, angle: number, dist: number): { x: number; y: number } {
  if (!p.character.spritePrefix.startsWith('pl_')) {
    return { x: p.x + Math.cos(angle) * dist, y: p.y - 5 + Math.sin(angle) * dist * 0.8 };
  }
  // The paw stays beside the torso while the blade rotates around it.
  // Front/rear views reserve the other paw for the character's own lantern.
  const reach = dist - 5;
  return {
    x: p.x + Math.cos(p.aim) * 6 - Math.abs(Math.sin(p.aim)) * 4 + Math.cos(angle) * reach,
    y: p.y - 6 + Math.sin(p.aim) * 2 + Math.sin(angle) * reach * 0.8,
  };
}
