import type { Scene, TouchButtonSpec } from './scene';
import type { Renderer } from '../engine/renderer';
import { UI_W, UI_H, VIEW_W, VIEW_H } from '../engine/renderer';
import { input } from '../engine/input';
import { save } from '../engine/save';
import { app } from '../game/app';
import { Characters } from '../game/defs';
import { randomSeedString } from '../engine/rng';
import { animFrame } from '../engine/sprites';
import { audio } from '../audio/audio';
import { Menu } from './widgets';
import { frame } from './frame';
import { C } from './theme';
import { Lighting } from '../engine/lighting';
import { townArt, residentArt } from './town-art';
import { StoryOverlay } from './story';
import { storyObjective, INTRO, RETURNS, BOSS_STORIES } from '../game/story';
import { CharacterSelectScene } from './charselect';
import { CollectionScene } from './collection';
import { LobbyScene } from './lobby';

import { TOWN_W, TOWN_H, TOWN_ZONES as ZONES, TOWN_RESIDENTS, townWalkable, townPath } from '../game/town-layout';
import { characterStats } from './logic';

export class TownScene implements Scene {
  private x = 384; private y = 270; private t = 0;
  private menu: Menu | null = null;
  private lights = new Lighting();
  private facing: 'down' | 'up' | 'side' = 'down';
  private moving = false;
  private flip = false;
  private checked = false;
  private path: {x:number;y:number}[] = [];
  private destination: {kind:'resident'|'zone';index:number}|null = null;
  private cameraX = 192; private cameraY = 162;
  get touchMovement(): boolean { return !this.menu; }
  private get character() { return Characters.get(this.c.checkpoint?.character ?? this.c.character) ?? Characters.all()[0]; }
  touchBack = 'back' as const;
  constructor(private join?: string) {}
  enter(): void { audio.playMusic('title'); input.releaseAll(); }
  private uiPoint(x: number, y: number): { x: number; y: number } {
    const r=app.renderer, p=r.worldToDisplay(x,y); return r.displayToUI(p.x,p.y);
  }
  private get c() { return save.progress.campaign!; }
  private story(): boolean {
    const id = !this.c.seen.includes('intro') ? 'intro' : this.c.pending ? `return:${this.c.pending}` : '';
    if (!id) return false;
    const floor = this.c.pending;
    app.scenes.push(new StoryOverlay(id === 'intro' ? INTRO : RETURNS[floor], () => {
      if (!this.c.seen.includes(id)) this.c.seen.push(id);
      if (id !== 'intro') this.c.pending = 0;
      save.saveProgress();
    })); return true;
  }
  private launch(): void {
    const cp = this.c.checkpoint;
    app.startRun(cp?.seed ?? randomSeedString(), cp?.character ?? this.c.character);
  }
  private resident(i: number): void {
    this.path=[];this.destination=null;this.moving=false;
    if(i===0&&this.story())return;
    const names = ['루메', '브릭', '오린'];
    const memories = this.c.cleared >= 7
      ? ['불빛이 늘었다고 밤이 모두 같아지는 건 아니더라. 네가 돌아올 자리만은 비워 둘게.', '다리 경첩을 두 번 손봤어. 이번에는 어느 종에 돌아오든 열리도록.', '두 권의 장부를 나란히 두었어. 빈집의 문패 주인을 찾으면, 양쪽에 이름을 써 줄 거야.']
      : this.c.cleared >= 4
        ? ['난 분명 브릭의 말을 듣고 문을 닫았어. 그런데 그가 내민 열쇠에는 열라고 적혀 있더라.', '루메가 건너오는 걸 봤어. 그런데 루메는 내가 먼저 돌아갔다고 해. 기억 속 손이 너무 선명해서 더 무섭다.', '두 사람이 같은 말을 하게 만드는 건 해답이 아니야. 다른 말을 하게 된 이유를 찾아야지.']
        : ['여기 등불은 돌아오는 발소리에 밝아져. 심지를 찾으면 어떤 길이 이어지는지 알 수 있을 거야.', '출발 전엔 손에 익는 무기를 골라. 길에서 발견한 유물 때문에 쓰는 방식이 바뀔 수도 있어.', '같은 이야기를 두 사람이 다르게 하면, 나는 둘 다 적어 둬. 어느 쪽이 빠진 조각인지 아직 모르니까.'];
    app.scenes.push(new StoryOverlay({ title: '등불터의 사람들', lines: [{ who: names[i], text: memories[i] }, { who: '등불지기', text: '지금은 어디부터 확인하면 좋을까?' }, { who: names[i], text: storyObjective(this.c).detail }] }, () => {}));
  }
  private zone(i: number): void {
    this.path=[];this.destination=null;this.moving=false;
    if (!this.c.seen.includes('intro') || this.c.pending) { this.walkTo('resident',0); return; }
    input.releaseAll();
    if (i === 0) {
      const cp = this.c.checkpoint;
      this.menu = new Menu([
        { label: cp ? `${cp.floor}-${cp.stage} 원정 이어가기` : `1-1부터 ${Math.min(7, Math.max(4, this.c.cleared + 1))}-4까지 출발`, action: () => this.launch(), hint: cp ? '중단한 원정만 보관한 장비로 스테이지 입구에서 이어갑니다.' : '새 장비로 출발합니다. 목표 층 보스를 잡으면 마을로 귀환합니다.' },
        { label: '마을 둘러보기', action: () => { this.menu = null; } },
      ], UI_W / 2, 330, { width: 440, lineH: 27, hintY: 401 });
    } else if (i === 1) {
      if (this.c.checkpoint) {
        this.menu = new Menu([{ label: '현재 원정의 등불지기는 장비와 함께 보관됩니다', disabled: true }, { label: '돌아가기', action: () => { this.menu = null; } }], UI_W / 2, 335, { width: 520, size: 12 });
      } else app.scenes.set(new CharacterSelectScene(undefined, id => { this.c.character = id; save.saveProgress(); app.goTown(); }));
    } else if (i === 2) {
      this.menu = new Menu([
        { label: '유물 · 무기 도감', action: () => app.scenes.push(new CollectionScene()) },
        { label: '되찾은 기억 읽기', action: () => {
          this.menu = new Menu(this.c.seen.map(id => ({ label: id === 'intro' ? INTRO.title : (id.startsWith('return:') ? RETURNS : BOSS_STORIES)[Number(id.split(':')[1])]?.title ?? id, action: () => {
            const e = id === 'intro' ? INTRO : (id.startsWith('return:') ? RETURNS : BOSS_STORIES)[Number(id.split(':')[1])];
            if (e) app.scenes.push(new StoryOverlay(e, () => {}));
          } })), UI_W / 2, 316, { width: 440, maxRows: 3, lineH: 26, size: 12 });
        } },
        { label: '돌아가기', action: () => { this.menu = null; } },
      ], UI_W / 2, 316, { width: 440, lineH: 26 });
    } else app.scenes.set(new LobbyScene());
  }
  private walkTo(kind:'resident'|'zone',index:number): void {
    const target=kind==='resident'?TOWN_RESIDENTS[index]:ZONES[index];
    if(Math.hypot(target.x-this.x,target.y-this.y)<34){kind==='resident'?this.resident(index):this.zone(index);return;}
    this.path=townPath(this.x,this.y,target.x,target.y+12);this.destination={kind,index};
  }
  private interact(): void {
    const npc=TOWN_RESIDENTS.map((n,i)=>({i,d:Math.hypot(n.x-this.x,n.y-this.y)})).sort((a,b)=>a.d-b.d)[0];
    if(npc.d<35){this.resident(npc.i);return;}
    const zone=ZONES.map((z,i)=>({i,d:Math.hypot(z.x-this.x,z.y-this.y)})).sort((a,b)=>a.d-b.d)[0];
    if(zone.d<38)this.zone(zone.i);
  }
  update(dt: number): void {
    this.t+=dt;
    if(!this.checked){this.checked=true;if(this.join){app.scenes.set(new LobbyScene({join:this.join}));return;}}
    if(input.pressed('cancel')){if(this.menu)this.menu=null;else app.goTitle();return;}
    if(this.menu){this.menu.update(app.renderer,dt);return;}
    let mv=input.moveVector();
    if(!mv.x&&!mv.y){let x=Number(input.held('uiRight'))-Number(input.held('uiLeft')),y=Number(input.held('uiDown'))-Number(input.held('uiUp'));const l=Math.hypot(x,y)||1;mv={x:x/l,y:y/l};}
    if(mv.x||mv.y){this.path=[];this.destination=null;}
    else if(this.path.length){
      const goal=this.path[0],dx=goal.x-this.x,dy=goal.y-this.y,dist=Math.hypot(dx,dy);
      if(dist<3)this.path.shift();else mv={x:dx/dist,y:dy/dist};
    }
    this.moving=!!(mv.x||mv.y);
    if(mv.x){this.facing='side';this.flip=mv.x<0;}else if(mv.y){this.facing=mv.y<0?'up':'down';this.flip=false;}
    const speed=characterStats(this.character).moveSpeed;
    const nx=this.x+mv.x*speed*dt,ny=this.y+mv.y*speed*dt;
    if(townWalkable(nx,this.y))this.x=nx;if(townWalkable(this.x,ny))this.y=ny;
    if(this.destination){
      const target=this.destination.kind==='resident'?TOWN_RESIDENTS[this.destination.index]:ZONES[this.destination.index];
      if(Math.hypot(target.x-this.x,target.y-this.y)<30){const dest=this.destination;this.destination=null;this.path=[];dest.kind==='resident'?this.resident(dest.index):this.zone(dest.index);return;}
    }
    if(input.pressed('confirm')||input.pressed('interact')){this.interact();return;}
    if(input.pressed('fire')){
      const p=app.renderer.displayToWorld(input.mouseX,input.mouseY);
      const npc=TOWN_RESIDENTS.findIndex(n=>Math.abs(n.x-p.x)<15&&p.y>n.y-26&&p.y<n.y+8);
      if(npc>=0){this.walkTo('resident',npc);return;}
      const zone=ZONES.findIndex(z=>Math.abs(z.x-p.x)<32&&Math.abs(z.y-p.y)<22);
      if(zone>=0){this.walkTo('zone',zone);return;}
      this.destination=null;this.path=townPath(this.x,this.y,p.x,p.y);
    }
  }
  touchButtons(): TouchButtonSpec[] {
    if(this.menu)return [];
    const near=[...TOWN_RESIDENTS,...ZONES].some(n=>Math.hypot(n.x-this.x,n.y-this.y)<38);
    return near?[{x:UI_W-112,y:UI_H-100,w:76,h:58,label:'대화 / 이용',tap:()=>this.interact()}]:[];
  }
  draw(r: Renderer): void {
    const light=Math.min(1,Math.max(0,this.c.cleared-3)/4);
    const wantX=Math.max(0,Math.min(TOWN_W-VIEW_W,this.x-VIEW_W/2));
    const wantY=Math.max(0,Math.min(TOWN_H-VIEW_H,this.y-VIEW_H/2));
    this.cameraX+=(wantX-this.cameraX)*.14;this.cameraY+=(wantY-this.cameraY)*.14;
    r.camX=this.cameraX;r.camY=this.cameraY;r.shakeX=0;r.shakeY=0;
    r.beginWorld('#090711');const ctx=r.ctx;
    ctx.drawImage(townArt(),-r.viewX,-r.viewY);
    const ch=this.character;
    for(const [x,y] of [[107,174],[232,175],[519,166],[662,169],[272,95],[410,95]]){r.sprite('prop_sconce',x,y);r.anim('prop_flame',this.t+x,x,y);}
    r.sprite('shop_counter',165,243);r.sprite('shop_wares',165,231);
    r.anim('ui_lantern',this.t,384,188);
    const people=[...TOWN_RESIDENTS.map((n,i)=>({...n,i})),{i:-1,x:this.x,y:this.y,name:''}].sort((a,b)=>a.y-b.y);
    for(const person of people){
      r.shadow(person.x,person.y+4,person.i<0?11:9,4,.35);
      if(person.i<0)r.anim(ch.spritePrefix+'_'+(this.moving?'walk':'idle')+'_'+this.facing,this.t,person.x,person.y+5,{flipX:this.flip});
      else ctx.drawImage(residentArt(person.i),Math.round(person.x-r.viewX-12),Math.round(person.y-r.viewY-23));
    }
    this.lights.enabled=save.settings.graphicsQuality!=='low';
    this.lights.begin(r,light>.5?'#8a84a6':'#716c8f');
    this.lights.add(this.x,this.y-6,ch.lightRadius??95,ch.lightColor??'#ffd8a0',{intensity:.95});
    this.lights.add(this.x,this.y-6,30,'#ffffff',{intensity:.35});
    const flicker=1+Math.sin(this.t*9)*.025;
    this.lights.add(384,194,98*flicker,'#ffd8a0',{intensity:1});this.lights.glow(384,188,15,'#ffad48',.15);
    for(const [x,y] of [[107,174],[232,175],[519,166],[662,169],[272,95],[410,95]])this.lights.add(x,y,44*flicker,'#ffc884',{intensity:.6});
    for(const [x,y] of [[130,187],[310,114],[555,175],[605,175]])this.lights.add(x,y,28,'#ffd7a0',{intensity:.55});
    for(const [i,[x,y]] of [[265,244],[485,234],[346,334],[577,365]].entries()){
      if(i<Math.max(0,this.c.cleared-3)){r.anim('ui_lantern',this.t+i,x,y);this.lights.add(x,y,63,'#ffd8a0',{intensity:.8});}
    }
    this.lights.apply();r.presentWorld();r.beginUI();
    for(const npc of TOWN_RESIDENTS){if(Math.hypot(npc.x-this.x,npc.y-this.y)<40){const q=this.uiPoint(npc.x,npc.y+13);r.uiText(npc.name,q.x,q.y,{size:10,align:'center',color:C.text,outline:C.ink});}}
    for(const z of ZONES){if(Math.hypot(z.x-this.x,z.y-this.y)<48){const q=this.uiPoint(z.x,z.y+16);r.uiText(z.title+' · '+z.sub,q.x,q.y,{size:10,align:'center',color:C.goldHi,outline:C.ink});}}
    const needTalk=!this.c.seen.includes('intro')||this.c.pending>0;
    const chapter=Math.min(4,Math.max(1,this.c.cleared-2));
    const objective=storyObjective(this.c);
    const task=!this.c.seen.includes('intro')?'루메와 대화하기':this.c.pending?'루메에게 기록 전하기':objective.title;
    r.uiRect(18,16,Math.min(500,UI_W-90),54,'#0b0813',.74);
    r.uiRect(18,16,2,54,C.goldDark);
    r.uiText('Chapter '+chapter+'. '+task,30,24,{size:15,color:C.goldHi,outline:C.ink});
    const detail=needTalk?'등불 옆, 머리 위에 표시가 있는 고양이를 찾아가자.':this.c.checkpoint?'보관한 원정을 중앙 등불에서 이어갈 수 있다.':'중앙 등불에서 원정을 시작해 단서를 찾자.';
    r.uiText(detail,30,48,{size:10,color:C.textDim});
    const target=needTalk?TOWN_RESIDENTS[0]:ZONES[0],mark=this.uiPoint(target.x,target.y-(needTalk?35:18));
    if(mark.x>12&&mark.x<UI_W-12&&mark.y>75&&mark.y<UI_H-12)r.uiText('!',mark.x,mark.y+Math.round(Math.sin(this.t*3)*2),{size:18,align:'center',color:C.goldHi,outline:C.ink});
    else {const angle=Math.atan2(target.y-this.y,target.x-this.x),cx=UI_W/2,cy=UI_H/2;const dx=Math.cos(angle),dy=Math.sin(angle);const dist=Math.min((cx-25)/Math.max(.001,Math.abs(dx)),(cy-80)/Math.max(.001,Math.abs(dy)));r.uiText('◆',cx+dx*dist,cy+dy*dist,{size:13,align:'center',color:C.goldHi,outline:C.ink});}
    if(this.menu){frame(r,UI_W/2-284,297,568,116,'panel');this.menu.draw(r);}
  }
}
