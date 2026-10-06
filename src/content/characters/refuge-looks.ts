import designs from '../../assets/native-keepers/refuge-breeds.json';
import { defineCharacter2D, type CharSpec } from './look';
import { VES_ORIGINAL } from './ves-original-look';

/** Native-grid breed artwork; gameplay definitions live in refuge-keepers.ts. */
export const REFUGE_SPECS: CharSpec[] = designs.map((design, index) => {
  if(design.id === 'ves') { defineCharacter2D(VES_ORIGINAL); return VES_ORIGINAL; }
  const spec: CharSpec = {
    prefix: design.id, palette: design.palette,
    front: design.front, side: design.side, back: design.back,
    headRows: design.headRows, feetRows: 2, paws: true,
    feet: [design.palette.f, design.palette.F, design.palette.g],
    feetX: design.feetX as [number, number], sideFeetX: design.sideFeetX as [number, number],
    ears: { keys: 'k', flop: index === 0 },
    // The poodle's pom-pom and papillon's plume differ from a corgi's short tail.
    tail: index === 1 ? {side:{x:0,y:12,frames:[['.ff.','fFff','.gg.','..g.'],['..ff','.fFf','..gg','..g.']]}}
      : index === 4 ? {side:{x:0,y:13,frames:[['.f..','fFf.','.FFg','..gg'],['..f.','.fFf','..Fg','..gg']]}}
      : index === 3 ? {side:{x:1,y:15,frames:[['ffg','gg.'],['.ff','.gg']]}}
      : index === 2 ? {side:{x:2,y:14,frames:[['g..','Fg.','.Fg','..g'],['...','Fg.','.Fg','..g']]}} : undefined,
    overlay(p, pose, frame) {
      const y = frame.bob;
      if(index === 0) {
        if(pose === 'back') {p.rect(5,12+y,6,5,'#705039');p.rect(6,12+y,4,3,'#b7925c');p.line(10,12+y,10,16+y,'#c7c7b9');}
        else {p.px(6,2+y,'#e0b85d');p.px(9,2+y,'#f6dd8c');p.rect(pose==='side'?6:5,15+y,2,2,'#d2c1a1');}
      }
      if(index === 1) {const x=pose==='side'?10:4;p.rect(x,14+y,2,3,'#70bc9c');p.px(x,14+y,'#f2f0da');p.px(10,14+y,'#eee0a5');}
      if(index === 2) {p.line(pose==='side'?6:5,11+y,pose==='side'?9:10,12+y,'#efd4b5');if(pose==='back')p.line(9,12+y,10,15+y,'#923f65');}
      if(index === 3) {
        if(pose==='back'){p.rect(5,12+y,7,5,'#846544');p.rect(6,13+y,5,3,'#e2cea2');p.line(7,13+y,9,15+y,'#8b9c7a');}
        else {p.rect(pose==='side'?10:10,14+y,2,3,'#e2cf9d');p.px(10,15+y,'#697e60');}
      }
      if(index === 4) {const x=pose==='side'?11:3;p.rect(x,13+y,3,5,'#e4d6b7');p.line(x+1,14+y,x+1,16+y,'#8995ab');p.px(8,11+y,'#e9c572');}
    },
    portrait(p) {p.rect(19,12,3,5,design.palette['3']);p.px(20,13,design.palette['4']);},
  };
  defineCharacter2D(spec);
  return spec;
});
