import { defineCharacter, defineGlobalHooks, Weapons } from '../../game/defs';
import { defineCharacter2D, type CharSpec } from './look';
import { REFUGE_COLORS, REFUGE_DASHES, REFUGE_PASSIVES, REFUGE_RELEASES } from './refuge-kits';
import { unlockCharacter } from './unlocks';
import { isPrimary } from '../items/lib';
// Preserve the existing roster order when this module is eagerly imported.
import './ria'; import './bern'; import './serin'; import './niel'; import './bori'; import './baekgu'; import './mori';
const rows=(a:string[])=>a.map(r=>{if(r.length>16)throw Error('refuge sprite row too wide: '+r);const left=Math.floor((16-r.length)/2);return '.'.repeat(left)+r+'.'.repeat(16-left-r.length);});
// Full native-width poses keep the new cast at the same pixel density as the original keepers.
const fullHeads=[
 ['......tttt......','....kttttttk....','..kkffffFFggkk..','.kkkffffFFFFkkk.','.kkkweFFFFwekkk.','.kkkeeFFFFeekkk.','.kkkmmFnnFmmkkk.','.kkkgmmmmmmgkkk.','..kk.gFmmFg.kk..','...k..gFFg..k...'],
 ['.....fffff......','...fffffffFF....','..fFffffffffFf..','.kkffffffffFFkk.','.kkFweFFFFweFkk.','.kkFeeffffeeFkk.','.kkFmmFnnFmmFkk.','..ffgmmmmmmgff..','...f.gFmmFg.f...','......gFFg......'],
 ['....k......k....','....kk....kk....','...kkffffffkk...','...kffffffFFk...','...fweFFFFweF...','...FeeffffeeF...','...FmmFnnFmmF...','...ggmmmmmmgg...','....ggFFFFgg....','.....ggFFgg.....'],
 ['...k........k...','...kk......kk...','..kkkffffffkkk..','..kffffffffFFk..','..FFweFFFFweFF..','..FFeeffffeeFF..','..FFmmFnnFmmFF..','...ggmmmmmmgg...','....ggFFFFgg....','.....ggFFgg.....'],
 ['..k..........k..','..kk........kk..','.kkkffffffffkkk.','.kkkffffffFFkkk.','.kkFweFFFFweFkk.','.kkFeeffffeeFkk.','.kkkmmFnnFmmkkk.','..kkgmmmmmmgkk..','...k.gFmmFg.k...','......gFFg......'],
];
const heads=fullHeads;
const backHeads=fullHeads.map(head=>head.map((r,y)=>y<4?r:r.replaceAll('w','f').replaceAll('e','F').replaceAll('m','F').replaceAll('n','F')));
const fullBody=[
 '....33443333....','...2333333321...','..f233t223222g..','..g1222222211g..','...1232221221...','...1222222221...','...1111111111...','....11....11....','....ff....ff....','....gg....gg....',
];
const bodies=fullHeads.map((_,i)=>i===2?fullBody.map(r=>r.slice(0,4)+'.'+r.slice(5,11)+'.'+r.slice(12)):fullBody);
const nativeSide=rows(['....kk..........','...kkkk.........','..kkfffff.......','..kkffffffF.....','..kkkfffweFF....','..kkkkFFeeFFmmn.','..kkkggFFFmmmmn.','...kk.ggFMMMM...','...kk...gg......','......gFFg......'].map(r=>r.replaceAll('M','m')));
const nativeSideBody=['....333333......','...233333321....','...233332221....','...122222f21....','....12222g1.....','....1222221.....','....1111111.....','.....11..11.....','.....ff..ff.....','.....gg..gg.....'];
const names=['토브','루엔','베스','오르트','미라'];
const ids=['tove','luen','ves','ort','mira'];
const fur=[['#efd4a2','#bd854b','#765033','#654336'],['#fff1da','#e5cdb8','#b39b9e','#d8c4b9'],['#f1d6bf','#be9e93','#806a70','#695665'],['#ffe7b2','#e4b274','#ad7645','#b57c44'],['#fff3d9','#e6caa8','#a17f6c','#8a624e']];
export const REFUGE_SPECS:CharSpec[]=ids.map((id,i)=>{
 const [f,F,g,k]=fur[i];const color=REFUGE_COLORS[i];
 const spec:CharSpec={prefix:id,palette:{f,F,g,k,e:'#282033',w:'#fffbe7',m:'#fff1d5',n:'#493143','1':['#433039','#3d314f','#523042','#283f3e','#303c55'][i],'2':['#74503b','#695280','#874858','#466d5b','#526a92'][i],'3':color,'4':'#f1e5c9',t:'#e9c66f'},front:[...rows(heads[i]),...rows(bodies[i])],back:[...rows(backHeads[i]),...rows(bodies[i].map(r=>r.replaceAll('t','2')))],side:[...nativeSide,...nativeSideBody],headRows:10,feetRows:2,feet:[f,F,g],feetX:i===2?[5,9]:[4,10],sideFeetX:[6,9],paws:true,ears:{keys:'k',flop:i===0||i===1},hurtFill:f,
 overlay(p,pose,frame){const dy=frame.bob;
  if(pose==='side'&&(i===2||i===3||i===4)){p.poly([4,4,4,0,7,4],k);if(i===4)p.poly([3,5,2,1,6,4],F);}
  if(i===1&&pose==='side'){p.ellipse(5,3,3,3,f);}
  if(i===0){if(pose==='back'){p.rect(4,11+dy,8,6,'#58412f');p.rect(5,11+dy,6,4,'#a27b51');p.line(10,11+dy,10,16+dy,'#d9d9c8');}else{p.rect(6,1,5,2,'#c1a062');p.px(8,1,'#fff4cb');p.rect(5,14+dy,2,3,'#dcc99d');}}
  if(i===1){p.rect(pose==='side'?11:4,13+dy,2,3,'#8cc9a4');p.px(pose==='side'?11:4,13+dy,'#f6e6cf');p.rect(10,14+dy,2,3,'#bb97d6');}
  if(i===2){p.line(6,10+dy,10,11+dy,'#e9c7a0');if(pose==='back')p.line(9,11+dy,11,15+dy,'#cf6679');}
  if(i===3){if(pose==='back'){p.rect(4,11+dy,8,6,'#8c6847');p.rect(5,12+dy,6,4,'#ddc899');p.line(6,13+dy,9,15+dy,'#738264');}else{p.rect(9,13+dy,3,4,'#dcc799');p.px(10,14+dy,'#687d69');}}
  if(i===4){p.rect(pose==='side'?11:3,13+dy,3,5,'#e4d4b2');p.line(pose==='side'?12:4,14+dy,pose==='side'?12:4,16+dy,'#7b7997');p.px(8,11+dy,'#f8e6a9');}
 },
 portrait(p){p.rect(19,12,3,5,color);p.px(20,13,'#fff6db');},
 };defineCharacter2D(spec);return spec;
});
const weapons=['nail_carbine','cinder_sceptre','copper_sabre','crescent_bow','brass_revolver'];
const descriptions=[
 '끊어진 길에서 도구를 주워 살아남은 닥스훈트 공병. 싸움이 시작되면 작은 포탑부터 세우고, 돌아올 길의 나사까지 챙긴다.',
 '빛을 잃은 약방을 지키던 푸들 연금술사. 서로 다른 시약이 만날 때 생기는 반응으로 어두운 길을 밝힌다.',
 '지붕 사이로 편지를 전하던 휘핏 곡예사. 한 손이 쉬는 동안 다른 손을 쓰는 것이 오래 달리는 비결이라고 한다.',
 '지도에서 지워진 골목을 기억하는 코기 길잡이. 멀리 가더라도 자신이 남긴 표식으로 돌아오는 법을 잊지 않는다.',
 '잊힌 증언을 모으는 파피용 기록사. 공격이 멈춘 짧은 침묵 사이로 방금 전 전투의 흔적을 다시 펼친다.',
];
const releases=['이동식 진지','시약 대폭발','교차 난무','빛의 귀환로','기록 펼치기'];
const releaseDescs=['3초간 동행 포탑이 가까운 적에게 최대 10회 사격한다. 벽에 막힌다.','주변에 큰 시약 폭발을 일으킨다.','정면을 넓게 크게 베고 탄환을 되받아친다.','정면에 빛의 길을 만들고 1.6초간 5회 타격한다.','정면을 긴 부채꼴로 벤다. 저장한 기록은 소모한다.'];
export const REFUGE_UNLOCK_HINTS=['한 판에서 방 8개 정리','한 판에서 화상과 독을 모두 직접 적용','한 판에서 공격 무기 전환 6회','한 판에서 방 12개 정리','한 판에서 등불 해방 3회 사용'];
for(let i=0;i<ids.length;i++)defineCharacter({id:ids[i],name:names[i],title:['야전 공병','시약 연구가','곡예 전령','골목 길잡이','증언 기록사'][i],desc:descriptions[i],spritePrefix:ids[i],portrait:ids[i]+'_portrait',color:REFUGE_COLORS[i],hearts:i===2?2:3,weapon:weapons[i],keys:1,bombs:1,unlocked:false,unlockHint:REFUGE_UNLOCK_HINTS[i],baseStats:{moveSpeed:[86,91,106,96,90][i],dashCooldown:i===2?.65:.9},passive:REFUGE_PASSIVES[i],dash:REFUGE_DASHES[i],release:REFUGE_RELEASES[i],releaseName:releases[i],releaseDesc:releaseDescs[i],lightColor:REFUGE_COLORS[i],playstyle:[['설치','사격','진지'],['상태이상','반응','마법'],['교체','기동','근접'],['표식','왕복','사격'],['기록','축적','회피']][i],difficulty:i===0?1:2,pitch:['포탑을 세우고 유리한 위치에서 함께 싸운다.','독과 화상을 함께 묻혀 시약 반응을 일으킨다.','두 무기를 번갈아 쓰면서 싸움의 박자를 바꾼다.','남긴 표식으로 돌아와 강화 공격을 준비한다.','공격을 쌓고, 잠시 쉬거나 피하면서 기록탄을 쏜다.'][i]});
/** Run-scoped numeric goals; seeded practice never unlocks characters. */
defineGlobalHooks({id:'refuge_keeper_unlocks',perPlayer:true,
 onRoomClear(w){w.vars.rfClearCount=(w.vars.rfClearCount??0)+1;if(w.vars.rfClearCount>=8)unlockCharacter(w,'tove');if(w.vars.rfClearCount>=12)unlockCharacter(w,'ort');},
 onHit(w,_t,h){if(!isPrimary(h))return;for(const s of h.statuses??[]){if(s.kind==='burn'&&_t.hasStatus('burn'))w.vars.rfUsedBurn=1;if(s.kind==='poison'&&_t.hasStatus('poison'))w.vars.rfUsedPoison=1;}if(w.vars.rfUsedBurn&&w.vars.rfUsedPoison)unlockCharacter(w,'luen');},
 onAttack(w){const index=Weapons.all().findIndex(d=>d.id===w.player.weaponId);if(w.vars.rfUnlockWeapon!==undefined&&w.vars.rfUnlockWeapon!==index)w.vars.rfSwapCount=(w.vars.rfSwapCount??0)+1;w.vars.rfUnlockWeapon=index;if((w.vars.rfSwapCount??0)>=6)unlockCharacter(w,'ves');},
 onRelease(w){w.vars.rfReleaseCount=(w.vars.rfReleaseCount??0)+1;if(w.vars.rfReleaseCount>=3)unlockCharacter(w,'mira');},
});
