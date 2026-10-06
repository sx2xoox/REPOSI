import { defineGlobalHooks } from '../../game/defs';
import type { World } from '../../game/world';
import { isPrimary } from '../items/lib';
import { unlockCharacter } from './unlocks';

export const REFUGE_UNLOCK_HINTS = [
 '한 원정에서 도전방 세 곳을 돌파하면, 공병이 당신의 진지를 찾아온다.',
 '한 원정에서 독과 불꽃에 휩싸인 스무 적을 맞히면, 약방의 연구가가 문을 연다.',
 '한 원정에서 열 방을 근접과 원거리로 싸워 정리하면, 전령이 당신의 박자를 따라온다.',
 '한 원정에서 비밀방 세 곳을 찾고 3층 보스를 꺾으면, 길잡이가 지워진 지도를 펼친다.',
 '한 원정에서 여섯 방의 전투에 해방을 쓰고 3층 보스를 꺾으면, 기록사가 당신의 발자취를 적는다.',
];
export const REFUGE_UNLOCK_REQUIREMENTS = [
 '한 판에서 서로 다른 도전방 3곳 정리',
 '한 판에서 독·화상이 동시에 걸린 서로 다른 적 20마리 직접 적중',
 '한 판에서 근접·원거리 직접 적중을 모두 기록한 전투방 10곳 정리',
 '한 판에서 비밀방 3곳 발견 + 3층 이상 보스방 정리',
 '한 판에서 해방을 사용한 전투방 6곳 정리 + 3층 이상 보스방 정리',
];
const roomKey = (w: World) => `${w.run.floor}:${w.run.stage}:${w.node.id}`;
function once(w: World, key: string): boolean {
 if (w.vars[key]) return false;
 w.vars[key] = 1;
 return true;
}
function check(w: World): void {
 if ((w.vars.rfChallengeRooms ?? 0) >= 3) unlockCharacter(w, 'tove');
 if ((w.vars.rfReactionTargets ?? 0) >= 20) unlockCharacter(w, 'luen');
 if ((w.vars.rfMixedRooms ?? 0) >= 10) unlockCharacter(w, 'ves');
 if (w.vars.rfThirdBoss && (w.vars.rfSecretRooms ?? 0) >= 3) unlockCharacter(w, 'ort');
 if (w.vars.rfThirdBoss && (w.vars.rfReleaseRooms ?? 0) >= 6) unlockCharacter(w, 'mira');
}
/** Run-local, per-player evidence. Save flags remain permanent; seeded practice never awards them. */
defineGlobalHooks({
 id: 'refuge_keeper_unlocks', perPlayer: true,
 onRoomEnter(w) {
  if (w.node.kind === 'secret' && once(w, 'rfSecret:' + roomKey(w))) {
   w.vars.rfSecretRooms = (w.vars.rfSecretRooms ?? 0) + 1;
   check(w);
  }
 },
 onHit(w, target, hit) {
  if (!isPrimary(hit) || target.team !== 'enemy') return;
  const key = roomKey(w);
  if (hit.kind === 'melee') w.vars['rfMelee:' + key] = 1;
  if (hit.kind === 'projectile' || hit.kind === 'laser') w.vars['rfRanged:' + key] = 1;
  // A target counts once, regardless of pellet count or poison/burn refreshes.
  if (target.hasStatus('burn') && target.hasStatus('poison') && once(w, 'rfReaction:' + target.id)) {
   w.vars.rfReactionTargets = (w.vars.rfReactionTargets ?? 0) + 1;
   check(w);
  }
 },
 onRelease(w) {
  if (!w.node.cleared && w.enemies.some(e => e.alive && !e.hidden)) w.vars['rfRelease:' + roomKey(w)] = 1;
 },
 onRoomClear(w) {
  const key = roomKey(w);
  if (!once(w, 'rfCleared:' + key)) return;
  if (w.node.kind === 'challenge') w.vars.rfChallengeRooms = (w.vars.rfChallengeRooms ?? 0) + 1;
  if (w.vars['rfMelee:' + key] && w.vars['rfRanged:' + key]) w.vars.rfMixedRooms = (w.vars.rfMixedRooms ?? 0) + 1;
  if (w.vars['rfRelease:' + key]) w.vars.rfReleaseRooms = (w.vars.rfReleaseRooms ?? 0) + 1;
  if (w.node.kind === 'boss' && w.run.floor >= 3) w.vars.rfThirdBoss = 1;
  check(w);
 },
});
