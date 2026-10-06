import { defineCharacter } from '../../game/defs';
export { REFUGE_SPECS } from './refuge-looks';
import { REFUGE_COLORS, REFUGE_DASHES, REFUGE_PASSIVES, REFUGE_RELEASES } from './refuge-kits';
import { REFUGE_UNLOCK_HINTS, REFUGE_UNLOCK_REQUIREMENTS } from './refuge-unlocks';
// Preserve the existing roster order when this module is eagerly imported.
import './ria'; import './bern'; import './serin'; import './niel'; import './bori'; import './baekgu'; import './mori';
const names=['토브','루엔','베스','오르트','미라'];
const ids=['tove','luen','ves','ort','mira'];
const weapons=['nail_carbine','amber_wand','copper_sabre','crescent_bow','brass_revolver'];
const descriptions=[
 '끊어진 길에서 도구를 주워 살아남은 닥스훈트 공병. 적의 발걸음과 폭약의 심지를 읽고, 막힌 전선을 포격으로 연다.',
 '빛의 실로 흩어진 인연을 잇는 푸들 직조사. 멀어진 적들을 한 가닥으로 엮고, 팽팽해진 매듭을 풀어 싸움을 끝낸다.',
 '지붕 사이로 편지를 전하던 휘핏 쌍수 전투가. 두 손에 든 무기가 달라도 서로의 빈틈을 메우는 박자를 안다.',
 '지도에서 지워진 골목을 기억하는 코기 방패수. 앞을 지키던 방패를 동료에게 잠시 맡기고, 모두가 나아갈 사선을 연다.',
 '잊힌 증언을 모으는 파피용 결계사. 책장을 펼친 곳에서는 적의 발걸음과 탄환이 느려지고, 다음 한 수를 놓을 여유가 생긴다.',
];
const releases=['공성 개시','달빛 실절단','양손 협공','전선을 여는 방패','책장 회랑'];
const releaseSummaries=[
 '조준 지점에 3연속 포격. 총 기본 피해 11배, 벽에 막힘.',
 '1~6명을 3번 절단. 대상마다 총 기본 피해 11배.',
 '두 무기 기술 후 전방 베기. 총 기본 피해 11배.',
 '방패 왕복에 각 기본 피해 5.5배. 일반 적탄 최대 9발 차단.',
 '2초간 적·탄환 감속 후 폐쇄. 총 기본 피해 11배.',
];
const releaseDescs=[
 '조준 지점을 세 번 집중 포격한다. 직격 총합은 기본 피해의 11배이며 폭발은 벽을 넘지 않는다.',
 '조준 지점 주변 최대 6명을 엮어 실을 세 번 끊는다. 대상마다 총 기본 피해의 11배. 적이 하나여도 위력이 줄지 않는다.',
 '주무기·보조무기 계열 기술로 한 번씩 협공한 뒤 정면을 크게 벤다. 총 기본 피해의 11배. 보조무기가 없으면 단검 기술을 쓴다.',
 '큰 방패가 정면으로 전진하고 돌아오며 각각 기본 피해의 5.5배를 준다. 일반 적탄은 최대 9발 차단하며 벽에 막힌다.',
 '정면에 2초 책장 회랑을 펼친다. 일반 적탄은 45%, 적 이동은 30%(보스 12%) 감속. 네 번의 맥동과 책장 폐쇄로 총 기본 피해의 11배.',
];
for(let i=0;i<ids.length;i++)defineCharacter({id:ids[i],name:names[i],title:['공성 공병','빛의 직조사','쌍수 전투가','전선의 방패수','인장 결계사'][i],desc:descriptions[i],spritePrefix:ids[i],portrait:ids[i]+'_portrait',color:REFUGE_COLORS[i],hearts:i===2?2:3,weapon:weapons[i],keys:1,bombs:1,unlocked:false,unlockHint:REFUGE_UNLOCK_HINTS[i],unlockRequirement:REFUGE_UNLOCK_REQUIREMENTS[i],baseStats:{moveSpeed:[86,91,106,96,90][i],dashCooldown:i===2?.65:.9},passive:REFUGE_PASSIVES[i],dash:REFUGE_DASHES[i],release:REFUGE_RELEASES[i],releaseName:releases[i],releaseDesc:releaseDescs[i],releaseSummary:releaseSummaries[i],lightColor:REFUGE_COLORS[i],playstyle:[['폭약','범위','포격'],['연결','분산','매듭'],['쌍수','지원','기동'],['전방 방어','사선','차단'],['결계','감속','공격 기회']][i],difficulty:i===0?1:2,pitch:['공격으로 폭약을 붙이고, 지뢰와 집중 포격으로 전선을 연다.','떨어진 적들을 실로 잇고, 혼자 남은 적은 매듭으로 공략한다.','보조무기 계열의 지원 기술로 두 손의 호흡을 맞춘다.','전방의 탄환을 방패로 막고, 비켜서며 공격할 틈을 만든다.','공격한 곳에 책장 결계를 펼치고 이동하며 전투의 속도를 바꾼다.'][i]});
