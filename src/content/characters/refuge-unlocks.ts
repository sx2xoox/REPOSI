import { defineGlobalHooks } from '../../game/defs';
import type { World } from '../../game/world';
import { unlockCharacter } from './unlocks';

// Each refuge keeper is earned by playing the way that keeper fights (user 2026-10-08: the
// conditions still followed the keepers' first concepts):
//  토브 (시한 폭약 · 지뢰 · 연쇄 기폭)     explosion kills
//  루엔 (잇고 끌어모아 한 매듭으로 끊기)   three kills inside one second, several times
//  베스 (쌍수 · 대시로 파고들기)           kills right after a dash
//  오르트 (전방 방패 · 사선 지키기)        combat rooms cleared without a hit + a floor-3+ boss
//  미라 (결계 · 시간 정지 · 몰아치기)      combat rooms cleared quickly + a floor-3+ boss
// Evidence is run-local and per keeper (w.vars); the save flag is permanent. Seeded practice,
// remote teammates and already unlocked keepers are filtered by unlockCharacter.

export const TOVE_EXPLOSION_KILLS = 10;
export const LUEN_TRIPLE_KILLS = 5;
/** window for three kills to count as one knot (s) */
export const LUEN_KNOT_WINDOW = 1;
export const VES_DASH_KILLS = 20;
/** a kill counts for 베스 this long after a dash starts (s) */
export const VES_DASH_WINDOW = 1;
export const ORT_CLEAN_ROOMS = 8;
export const MIRA_SWIFT_ROOMS = 6;
/** a combat room cleared within this time of entering it counts for 미라 (s) */
export const MIRA_SWIFT_SECONDS = 8;

export const REFUGE_UNLOCK_HINTS = [
 '한 원정에서 폭발로 적 열 마리를 쓰러뜨리면, 폭약을 다루는 공병이 당신의 불꽃을 따라온다.',
 '한 원정에서 적 셋을 한꺼번에 쓰러뜨리기를 다섯 번 해내면, 흩어진 실을 한 매듭으로 묶는 직조사가 당신을 찾아온다.',
 '한 원정에서 대시로 파고든 직후 스무 적을 쓰러뜨리면, 지붕 사이를 달리던 쌍수 전투가가 당신의 발걸음을 따라온다.',
 '한 원정에서 여덟 방을 한 대도 맞지 않고 지켜 내고 3층 보스를 꺾으면, 사선을 막아서는 방패수가 당신 곁에 선다.',
 '한 원정에서 여섯 방을 들어서자마자 몰아쳐 정리하고 3층 보스를 꺾으면, 시간을 멈추는 결계사가 당신의 발자취를 적는다.',
];
export const REFUGE_UNLOCK_REQUIREMENTS = [
 `한 판에서 폭발(폭탄·폭발 유물·폭발 무기)로 적 ${TOVE_EXPLOSION_KILLS}마리 처치`,
 `한 판에서 ${LUEN_KNOT_WINDOW}초 안에 적 3마리 연속 처치 ${LUEN_TRIPLE_KILLS}번`,
 `한 판에서 대시 후 ${VES_DASH_WINDOW}초 안에 적 ${VES_DASH_KILLS}마리 처치`,
 `한 판에서 피해 없이 전투방 ${ORT_CLEAN_ROOMS}곳 정리 + 3층 이상 보스방 정리`,
 `한 판에서 전투방 ${MIRA_SWIFT_ROOMS}곳을 들어선 지 ${MIRA_SWIFT_SECONDS}초 안에 정리 + 3층 이상 보스방 정리`,
];

const roomKey = (w: World) => `${w.run.floor}:${w.run.stage}:${w.node.id}`;
function once(w: World, key: string): boolean {
 if (w.vars[key]) return false;
 w.vars[key] = 1;
 return true;
}
function check(w: World): void {
 if ((w.vars.rfExplosionKills ?? 0) >= TOVE_EXPLOSION_KILLS) unlockCharacter(w, 'tove');
 if ((w.vars.rfKnots ?? 0) >= LUEN_TRIPLE_KILLS) unlockCharacter(w, 'luen');
 if ((w.vars.rfDashKills ?? 0) >= VES_DASH_KILLS) unlockCharacter(w, 'ves');
 if (w.vars.rfThirdBoss && (w.vars.rfCleanRooms ?? 0) >= ORT_CLEAN_ROOMS) unlockCharacter(w, 'ort');
 if (w.vars.rfThirdBoss && (w.vars.rfSwiftRooms ?? 0) >= MIRA_SWIFT_ROOMS) unlockCharacter(w, 'mira');
}
/** Run-local, per-player evidence. Save flags remain permanent; seeded practice never awards them. */
defineGlobalHooks({
 id: 'refuge_keeper_unlocks', perPlayer: true,
 onRoomEnter(w) {
  // a combat room: World.enterRoom marks a room without enemies cleared before this hook runs
  // (its enemy list is only rebuilt on the next step, so the node is the reliable signal)
  const fight = !w.node.cleared;
  w.vars.rfFight = fight ? 1 : 0;
  w.vars.rfFightClean = fight ? 1 : 0;
  w.vars.rfFightT = w.time;
 },
 onHurt(w) {
  w.vars.rfFightClean = 0;
 },
 onDash(w) {
  w.vars.rfDashT = w.time;
 },
 onHit(w, target, hit) {
  // the explosion that brings an enemy down (each enemy once)
  if (hit.kind !== 'explosion' || target.team !== 'enemy' || target.hp > 0 || hit.attacker !== w.player) return;
  if (!once(w, 'rfBoom:' + target.id)) return;
  w.vars.rfExplosionKills = (w.vars.rfExplosionKills ?? 0) + 1;
  check(w);
 },
 onKill(w) {
  const t = w.time;
  if (t - (w.vars.rfDashT ?? -99) <= VES_DASH_WINDOW) w.vars.rfDashKills = (w.vars.rfDashKills ?? 0) + 1;
  // three kills inside the window make one knot; the next knot needs three fresh kills
  const a = w.vars.rfKillA ?? -99;
  const b = w.vars.rfKillB ?? -99;
  if (t - a <= LUEN_KNOT_WINDOW && b >= a) {
   w.vars.rfKnots = (w.vars.rfKnots ?? 0) + 1;
   w.vars.rfKillA = w.vars.rfKillB = -99;
  } else {
   w.vars.rfKillA = b;
   w.vars.rfKillB = t;
  }
  check(w);
 },
 onRoomClear(w) {
  const key = roomKey(w);
  if (!once(w, 'rfCleared:' + key)) return;
  if (w.vars.rfFight) {
   if (w.vars.rfFightClean) w.vars.rfCleanRooms = (w.vars.rfCleanRooms ?? 0) + 1;
   if (w.time - (w.vars.rfFightT ?? w.time) <= MIRA_SWIFT_SECONDS) w.vars.rfSwiftRooms = (w.vars.rfSwiftRooms ?? 0) + 1;
   w.vars.rfFight = 0;
  }
  if (w.node.kind === 'boss' && w.run.floor >= 3) w.vars.rfThirdBoss = 1;
  check(w);
 },
});
