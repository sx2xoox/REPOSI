import { defineRoom } from '../../game/defs';
import { defineDrawnSprite, definePixelSprite } from '../../engine/sprites';
import { registerRoomHandler } from '../../game/roomkinds';
import { Prop } from '../props/prop';
import { Pickup, Pedestal } from '../../game/pickups';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { roundRug, withDecals } from './decor';

type MechanismKind = 'relay' | 'workshop' | 'vault';
const COLORS = { relay: '#8de4dc', workshop: '#f6cf88', vault: '#bf9dea' };
for (const kind of ['relay', 'workshop', 'vault'] as const) {
  defineRoom({ id: `${kind}_alcove`, shape: '1x1', kinds: [kind], rows: [
    '.................', '.p.............p.', '.................',
    '.................', '.................', '.................',
    '.................', '.p.............p.', '.................',
  ] });
  defineDrawnSprite(`device_${kind}`, 26, 30, p => {
    const c = COLORS[kind];
    p.rect(1,24,24,6,'#252335'); p.rect(2,24,22,1,'#858096');
    p.rect(4,19,18,5,'#494455'); p.rect(4,19,18,1,'#a3a0a5');
    if (kind === 'relay') {
      p.rect(10,11,6,9,'#605b78'); p.rect(7,3,12,11,'#37354c');
      p.rect(9,5,8,7,'#132531'); p.rect(10,6,5,5,c);
      p.poly([5,4,13,0,21,4],'#9790b5'); p.rect(12,5,1,8,'#ddd5b9');
    } else if (kind === 'workshop') {
      p.rect(3,10,20,11,'#603e30'); p.rect(3,10,20,2,'#b68b59');
      p.rect(6,13,14,7,'#292636'); p.rect(8,15,4,4,c);
      p.line(16,7,20,16,'#b59a72'); p.rect(14,6,7,4,'#a5a8ab');
    } else {
      p.rect(4,6,18,16,'#4d3f68'); p.rect(5,6,16,2,'#a290b3');
      p.rect(7,9,12,10,'#221d35'); p.line(6,8,20,20,'#97969d');
      p.line(20,8,6,20,'#97969d'); p.rect(10,12,6,6,c); p.rect(12,14,2,3,'#332846');
    }
  }, { outline: '#0c0810', origin: [13,29] });
}
definePixelSprite('map_relay', { p:'#8de4dc' }, ['..p..','.ppp.','.p.p.','.ppp.','..p..'], { outline:'#0c0810' });
definePixelSprite('map_workshop', { p:'#f6cf88' }, ['p...p','pp.pp','.ppp.','..p..','..p..'], { outline:'#0c0810' });
definePixelSprite('map_vault', { p:'#bf9dea' }, ['.ppp.','p...p','ppppp','p.p.p','ppppp'], { outline:'#0c0810' });

/** One shared reward per room, including in co-op. Mutable state is hashed in mem. */
export class RoomDevice extends Prop {
  mem = { progress: 0, used: false, index: 0 };
  root: RoomDevice = this;
  constructor(x: number, y: number, readonly kind: MechanismKind, index = 0) {
    super(x,y,1); this.mem.index = index;
  }
  override previewable(): boolean { return !this.root.mem.used; }
  override interactionInfo() {
    if (this.kind === 'relay') return { name: `등불 회랑 · ${this.mem.index + 1}번 등불`, icon:'map_relay', desc:`1 → 2 → 3 순서로 켜세요. 잘못 누르면 순서만 초기화됩니다. 현재 ${this.root.mem.progress}/3. 완성 보상: 동전 5개와 영혼 반 하트. 방당 1회.` };
    if (this.kind === 'workshop') return { name:'정비실 · 보급 선택', icon:'map_workshop', desc:`${['열쇠 2개','폭탄 2개','빨간 하트 2칸 회복'][this.mem.index]}를 받습니다. 세 보급 중 하나만 선택할 수 있습니다. 동료와 공유하며 남은 보급은 사라집니다.` };
    return { name:'봉인 창고', icon:'map_vault', desc:'폭탄 2개를 소모하여 봉인을 해체하고 유물 1개를 꺼냅니다. 폭발 피해는 없습니다. 부족하면 사용되지 않습니다. 방당 1회, 동료와 공유.' };
  }
  override interact(w: World): boolean {
    const p = w.player, state = this.root.mem;
    if (state.used || !p.alive || Math.hypot(p.x-this.x,p.y-this.y) >= 28) return false;
    if (this.kind === 'relay') {
      if (state.progress !== this.mem.index) {
        state.progress = 0; w.floatText(this.x,this.y-34,'다시 1번부터','#ffc088'); w.sfx('ui_error'); return true;
      }
      state.progress++; w.sfx('power_up');
      if (state.progress < 3) return true;
      state.used = true;
      w.spawn(new Pickup('nickel',this.root.x,this.root.y+24));
      w.spawn(new Pickup('soul_half',this.root.x+20,this.root.y+24));
      w.banner('회랑의 불이 이어졌다','동전 5개 · 영혼 반 하트', { small:true, color:COLORS.relay });
    } else if (this.kind === 'workshop') {
      if (this.mem.index === 2 && p.red >= p.maxRed) { w.floatText(this.x,this.y-32,'체력이 가득합니다','#ffc088'); return false; }
      state.used = true;
      if (this.mem.index === 0) p.keys = Math.min(99,p.keys+2);
      else if (this.mem.index === 1) p.bombs = Math.min(99,p.bombs+2);
      else p.heal(4);
      w.sfx('heal'); w.banner('정비 완료',['열쇠 2개 획득','폭탄 2개 획득','빨간 하트 2칸 회복'][this.mem.index],{ small:true,color:COLORS.workshop });
    } else {
      if (p.bombs < 2) { w.floatText(this.x,this.y-34,'폭탄 2개 필요','#ffc088'); w.sfx('ui_error'); return false; }
      const item = w.loot.rollItem('treasure',w.run.lootRng);
      if (!item) return false;
      p.bombs -= 2; state.used = true;
      w.spawn(new Pedestal(this.x,this.y+26,item)); w.sfx('door_open');
      w.banner('봉인이 풀렸다','폭탄 2개 소모 · 유물을 확인하세요',{small:true,color:COLORS.vault});
    }
    return true;
  }
  override draw(r: Renderer): void {
    r.shadow(this.x,this.y,27,7,.35); r.sprite(`device_${this.kind}`,this.x,this.y);
    const active = this.root.mem.used || (this.kind === 'relay' && this.mem.index < this.root.mem.progress);
    r.pixelText(this.kind === 'relay' ? `${this.mem.index+1}` : this.kind === 'vault' ? '2' : ['열쇠','폭탄','회복'][this.mem.index],this.x,this.y-35,active ? '#8a8290' : COLORS[this.kind],{align:'center',outline:'#0c0810'});
    if (active) r.sprite('shrine_flame_0',this.x,this.y-19);
  }
  override light(w: World): void { w.lights.add(this.x,this.y-20,45,COLORS[this.kind],{intensity:this.root.mem.used ? .3 : .7}); }
}
for (const kind of ['relay','workshop','vault'] as const) registerRoomHandler(kind, {
  populate(w,room,rng) {
    const cx=room.centerX, cy=room.centerY-8;
    withDecals(room,p=>roundRug(p,cx,cy+8,84,28,['#1e2030','#303246','#44465b','#68677a'],COLORS[kind]));
    const indices=kind === 'vault' ? [0] : kind === 'relay' ? rng.shuffle([0,1,2]) : [0,1,2];
    let root: RoomDevice | undefined;
    indices.forEach((index,i)=>{
      const device=w.spawn(new RoomDevice(cx+(i-(indices.length-1)/2)*64,cy,kind,index));
      root ??= device; device.root=root;
    });
  },
  spawnEnemies(){return false;},
  onEnter(w){
    w.banner({relay:'등불 회랑',workshop:'정비실',vault:'봉인 창고'}[w.node.kind as MechanismKind],
      {relay:'등불 가까이에서 순서를 확인하고 사용하세요',workshop:'세 보급 중 하나만 선택할 수 있습니다',vault:'폭탄 2개로 봉인을 해체할 수 있습니다'}[w.node.kind as MechanismKind],{small:true});
  },
});
