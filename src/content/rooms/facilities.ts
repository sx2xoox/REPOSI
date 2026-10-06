import { roomLabel } from './encounter-kit';
import { defineRoom } from '../../game/defs';
import { definePixelSprite } from '../../engine/sprites';
import { registerRoomHandler } from '../../game/roomkinds';
import { Prop } from '../props/prop';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { FacilityKind } from '../../game/facilities';
import { facilityCost } from '../../game/facilities';
import { sceneSprite } from '../../ui/pixellab-scenery';
import { withDecals } from './decor';

export const FACILITY_NAME={refinery:'제련방',well:'우물방',fusion:'합성방'};
const colors={refinery:'#edb672',well:'#83d6df',fusion:'#c9a6e8'};
const icons={refinery:['ppppp','.ppp.','..p..','.ppp.','ppppp'],well:['.ppp.','p...p','p.p.p','ppppp','.ppp.'],fusion:['p...p','.p.p.','..p..','.ppp.','ppppp'],elite:['p.p.p','ppppp','.ppp.','..p..','.p.p.']};
for(const [id,rows] of Object.entries(icons))definePixelSprite('map_'+id,{p:id==='elite'?'#efac7e':colors[id as FacilityKind]},rows,{outline:'#100c18'});
export class ForgeFacility extends Prop {
 mem:Record<string,number|string|boolean>={};
 constructor(x:number,y:number,readonly kind:FacilityKind){super(x,y,1);this.mem.kind=kind;}
 override previewable(w:World){return !this.mem['used:'+w.player.slot];}
 override interactionInfo(){return {name:FACILITY_NAME[this.kind],icon:'map_'+this.kind,desc:this.kind==='refinery'?'현재 무기를 제련합니다. -3~+3 중 0을 제외한 단계로 바뀌며 무기 피해가 70~130%가 됩니다. 기존 제련은 새 결과로 교체됩니다. 비용과 확률을 확인한 뒤 결정하세요.':this.kind==='well'?'현재 무기를 같은 등급의 다른 무기로 바꿉니다. 10% 확률로 한 등급 상승합니다. 전설은 같은 등급으로만 교환하며 제련은 사라집니다.':'같은 종류·같은 등급의 무기 2개 또는 유물 2개를 한 등급 높은 장비 1개로 합성합니다. 전설·축복·타고난 유물은 합성할 수 없습니다. 참가자마다 1회.'};}
 override interact(w:World){if(!this.previewable(w)||!w.player.alive||w.player.downed||Math.hypot(w.player.x-this.x,w.player.y-this.y)>30)return false;if(!w.coop||w.player===w.local)w.host.openFacility?.(this.id);return true;}
 override draw(r:Renderer,w:World){const c=colors[this.kind];r.shadow(this.x,this.y,32,7,.35);r.sprite(sceneSprite(this.kind==='refinery'?'device_anvil':'device_'+this.kind,'device_anvil'),this.x,this.y);const used=this.mem['used:'+w.local.slot];roomLabel(r,used?'사용 완료':facilityCost(this.kind,w.floor.index)?facilityCost(this.kind,w.floor.index)+' G':'재료 2 → 1',this.x,this.y+15,used?'#928797':c);}
 override light(w:World){w.lights.add(this.x,this.y-18,55,colors[this.kind],{intensity:.55});}
}
for(const kind of ['refinery','well','fusion'] as const){
 defineRoom({id:kind+'_sanctuary',shape:'1x1',kinds:[kind],rows:['.pp...........pp.','...X.........X...',...Array(5).fill('.................'),'...X.........X...','.pp...........pp.']});
 registerRoomHandler(kind,{populate(w,room){const x=room.centerX,y=room.centerY;withDecals(room,p=>{p.rectOutline(x-44,y-32,88,64,'#695264');p.rectOutline(x-41,y-29,82,58,'#392e40');for(const dx of [-37,37])for(const dy of [-25,25])p.rect(x+dx-1,y+dy-1,3,3,colors[kind]);});w.spawn(new ForgeFacility(x,y,kind));},spawnEnemies(){return false;}});
}
