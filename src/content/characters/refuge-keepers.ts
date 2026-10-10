import { defineCharacter } from '../../game/defs';
export { REFUGE_SPECS } from './refuge-looks';
import { REFUGE_AFFINITIES, REFUGE_COLORS, REFUGE_DASHES, REFUGE_PASSIVES, REFUGE_RELEASES } from './refuge-kits';
import { REFUGE_UNLOCK_HINTS, REFUGE_UNLOCK_REQUIREMENTS } from './refuge-unlocks';
// Preserve the existing roster order when this module is eagerly imported.
import './ria'; import './bern'; import './serin'; import './niel'; import './bori'; import './baekgu'; import './mori';
const names=['토브','루엔','베스','오르트','미라'];
const ids=['tove','luen','ves','ort','mira'];
const weapons=['nail_carbine','amber_wand','copper_sabre','javelin_bundle','brass_revolver'];
const descriptions=[
 '끊어진 길에서 도구를 주워 살아남은 닥스훈트 공병. 적의 발걸음과 폭약의 심지를 읽고, 깔아 둔 폭약을 한꺼번에 터뜨려 막힌 전선을 연다.',
 '빛의 실로 흩어진 인연을 잇는 푸들 직조사. 멀어진 적들을 한 가닥으로 엮어 한 매듭으로 끌어모으고, 그 매듭을 끊어 싸움을 끝낸다.',
 '지붕 사이로 편지를 전하던 휘핏 쌍수 전투가. 두 손의 박자로 빈틈을 메우고, 적과 적 사이를 바람처럼 가로지른다.',
 '지도에서 지워진 골목을 기억하는 코기 방패수. 날아든 탄환을 방패로 되받아쳐, 모두가 나아갈 사선을 연다.',
 '잊힌 증언을 모으는 파피용 결계사. 책장을 펼친 곳에서는 적의 발걸음과 탄환이 느려지고, 마지막 장에서는 시간마저 멈춘다.',
];
const releases=['연쇄 기폭','매듭 끌어당기기','교차 습격','되받아치는 방패','멈춘 책장'];
const releaseSummaries=[
 '보이는 적 최대 6명에게 폭약을 던져 연쇄 폭발(한 명 11배, 여럿은 합계 40배). 깔아 둔 폭약·지뢰는 먼저 2배로 터진다.',
 '최대 6명을 한곳으로 끌어당겨 묶고 3번 끊는다(한 명 11배, 여럿은 합계 40배).',
 '적 뒤로 세 번 순간이동하며 벤다(총 기본 피해 11배). 그동안 무적.',
 '방패로 밀치고(3배) 적탄 최대 10발을 되돌린 뒤(발당 1.2배) 돌진(8배).',
 '2초간 결계 안 적과 적탄을 멈춘다. 한 명 11배(여럿은 합계 40배) + 그동안 넣은 피해의 30%.',
];
const releaseDescs=[
 '주변에 보이는 적 최대 6명에게 폭약을 던져 차례로 터뜨린다. 한 명이면 기본 피해의 11배, 여럿이면 합계 40배를 나눠 받는다(한 명당 최대 11배, 옆 폭발 포함). 이미 깔아 둔 시한 폭약과 지뢰는 먼저 2배 위력으로 터진다. 적이 없으면 조준 지점에 던지며, 폭발은 벽을 넘지 않는다.',
 '조준 지점 주변 최대 6명을 실로 엮어 한곳으로 끌어당기고 0.9초 묶은 뒤 세 번 끊는다. 한 명이면 기본 피해의 11배, 여럿이면 합계 40배를 나눠 받는다. 보스는 끌려오지 않고 잠깐만 묶인다.',
 '가까운 적 뒤로 순간이동하며 세 번 벤다(기본 피해 3·3·5배, 바로 옆 적도 함께). 아직 안 벤 적을 먼저 노리고, 해방 동안 피해를 받지 않는다. 적이 없으면 조준 방향으로 짧게 돌진한다.',
 '큰 방패를 앞에 세워 적을 밀쳐 낸다(기본 피해 3배). 1.5초 동안 정면에 날아온 일반 적탄을 최대 10발 앞쪽 적에게 되돌려 보내고(발당 1.2배), 마지막에 방패로 돌진한다(8배).',
 '조준 지점에 2초 결계를 펼친다. 안의 적은 얼어붙고(보스는 잠깐 멈춘 뒤 감속) 일반 적탄은 멈춘다. 네 번의 맥동과 폐쇄로 한 명이면 기본 피해의 11배(여럿이면 합계 40배를 나눠 받음), 그동안 미라가 직접 넣은 피해의 30%를 폐쇄 때 더한다(적 하나당 최대 기본 피해 6배).',
];
for(let i=0;i<ids.length;i++)defineCharacter({id:ids[i],name:names[i],title:['공성 공병','빛의 직조사','쌍수 전투가','전선의 방패수','인장 결계사'][i],desc:descriptions[i],spritePrefix:ids[i],portrait:ids[i]+'_portrait',color:REFUGE_COLORS[i],hearts:i===2?2:3,weapon:weapons[i],matches:2,unlocked:false,unlockHint:REFUGE_UNLOCK_HINTS[i],unlockRequirement:REFUGE_UNLOCK_REQUIREMENTS[i],baseStats:{moveSpeed:[86,91,106,96,90][i],dashCooldown:i===2?.65:.9},passive:REFUGE_PASSIVES[i],dash:REFUGE_DASHES[i],affinity:REFUGE_AFFINITIES[i],release:REFUGE_RELEASES[i],releaseName:releases[i],releaseDesc:releaseDescs[i],releaseSummary:releaseSummaries[i],lightColor:REFUGE_COLORS[i],playstyle:[['폭약','설치','연쇄 폭발'],['연결','끌어모으기','속박'],['쌍수','기동','무적 돌파'],['전방 방어','반사','돌진'],['결계','시간 정지','몰아치기']][i],difficulty:i===0?1:2,pitch:['공격으로 폭약을 붙이고 지뢰를 깔아 두었다가, 해방으로 한꺼번에 터뜨린다.','떨어진 적들을 실로 잇고, 해방으로 한데 끌어모아 다른 공격에 몰아넣는다.','지원 기술로 두 손의 호흡을 맞추고, 대시와 해방으로 적 사이를 파고든다.','전방의 탄환을 방패로 막아 해방을 모으고, 해방으로 탄막을 되돌려준다.','공격한 곳에 책장 결계를 펼치고, 해방으로 시간을 멈춰 몰아친다.'][i]});
