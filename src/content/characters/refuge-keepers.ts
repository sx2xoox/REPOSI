import { defineCharacter } from '../../game/defs';
export { REFUGE_SPECS } from './refuge-looks';
import { REFUGE_COLORS, REFUGE_DASHES, REFUGE_PASSIVES, REFUGE_RELEASES } from './refuge-kits';
import { REFUGE_UNLOCK_HINTS, REFUGE_UNLOCK_REQUIREMENTS } from './refuge-unlocks';
// Preserve the existing roster order when this module is eagerly imported.
import './ria'; import './bern'; import './serin'; import './niel'; import './bori'; import './baekgu'; import './mori';
const names=['토브','루엔','베스','오르트','미라'];
const ids=['tove','luen','ves','ort','mira'];
const weapons=['nail_carbine','cinder_sceptre','copper_sabre','crescent_bow','brass_revolver'];
const descriptions=[
 '끊어진 길에서 도구를 주워 살아남은 닥스훈트 공병. 싸움이 시작되면 작은 포탑부터 세우고, 돌아올 길의 나사까지 챙긴다.',
 '빛을 잃은 약방을 지키던 푸들 연금술사. 서로 다른 시약이 만날 때 생기는 반응으로 어두운 길을 밝힌다.',
 '지붕 사이로 편지를 전하던 휘핏 곡예사. 한 손이 쉬는 동안 다른 손을 쓰는 것이 오래 달리는 비결이라고 한다.',
 '지도에서 지워진 골목을 기억하는 코기 길잡이. 멀리 가더라도 자신이 남긴 표식으로 돌아오는 법을 잊지 않는다.',
 '잊힌 증언을 모으는 파피용 기록사. 공격이 멈춘 짧은 침묵 사이로 방금 전 전투의 흔적을 다시 펼친다.',
];
const releases=['이동식 진지','시약 대폭발','교차 난무','빛의 귀환로','기록 펼치기'];
const releaseDescs=['3초간 동행 포탑이 가까운 적에게 최대 10회 사격한다. 벽에 막힌다.','두 시약을 합쳐 잠시 후 주변에 큰 반응 폭발을 일으킨다.','정면을 세 번 교차로 베며 탄환을 되받아친다.','정면에 빛의 길을 놓아 0.3초마다 5회 타격한다.','저장한 피해를 더해 정면 부채꼴 범위로 기록을 펼친다. 추가 피해는 기본 피해의 최대 3배.'];
for(let i=0;i<ids.length;i++)defineCharacter({id:ids[i],name:names[i],title:['야전 공병','시약 연구가','곡예 전령','골목 길잡이','증언 기록사'][i],desc:descriptions[i],spritePrefix:ids[i],portrait:ids[i]+'_portrait',color:REFUGE_COLORS[i],hearts:i===2?2:3,weapon:weapons[i],keys:1,bombs:1,unlocked:false,unlockHint:REFUGE_UNLOCK_HINTS[i],unlockRequirement:REFUGE_UNLOCK_REQUIREMENTS[i],baseStats:{moveSpeed:[86,91,106,96,90][i],dashCooldown:i===2?.65:.9},passive:REFUGE_PASSIVES[i],dash:REFUGE_DASHES[i],release:REFUGE_RELEASES[i],releaseName:releases[i],releaseDesc:releaseDescs[i],lightColor:REFUGE_COLORS[i],playstyle:[['설치','사격','진지'],['상태이상','반응','마법'],['교체','기동','근접'],['표식','왕복','사격'],['기록','축적','회피']][i],difficulty:i===0?1:2,pitch:['포탑을 세우고 유리한 위치에서 함께 싸운다.','독과 화상을 함께 묻혀 시약 반응을 일으킨다.','두 무기를 번갈아 쓰면서 싸움의 박자를 바꾼다.','남긴 표식으로 돌아와 강화 공격을 준비한다.','공격을 쌓고, 잠시 쉬거나 피하면서 기록탄을 쏜다.'][i]});
