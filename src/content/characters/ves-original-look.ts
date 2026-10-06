import type { CharSpec } from './look';
const rows=(a:string[])=>a.map(r=>'.'.repeat(Math.floor((16-r.length)/2))+r+'.'.repeat(Math.ceil((16-r.length)/2)));
const head=['....k......k....','....kk....kk....','...kkffffffkk...','...kffffffFFk...','...fweFFFFweF...','...FeeffffeeF...','...FmmFnnFmmF...','...ggmmmmmmgg...','....ggFFFFgg....','.....ggFFgg.....'];
const body=rows(['334433','2334332','f234332g','g123322g','123t321','1232321','112211','11..11','ff..ff','gg..gg']);
/** User-selected before version, preserved exactly, including overlays and foot placement. */
export const VES_ORIGINAL: CharSpec={
 prefix:'ves',palette:{f:'#f1d6bf',F:'#be9e93',g:'#806a70',k:'#695665',e:'#282033',w:'#fffbe7',m:'#fff1d5',n:'#493143','1':'#523042','2':'#874858','3':'#ed9fa4','4':'#f1e5c9',t:'#e9c66f'},
 front:[...head,...body],back:[...head.map((r,y)=>y<4?r:r.replaceAll('w','f').replaceAll('e','F').replaceAll('m','F').replaceAll('n','F')),...body.map(r=>r.replaceAll('t','2'))],
 side:[...rows(['....kk..........','...kkkk.........','..kkfffff.......','..kkffffffF.....','..kkkfffweFF....','..kkkkFFeeFFmmn.','..kkkggFFFmmmmn.','...kk.ggFmmmm...','...kk...gg......','......gFFg......']),...rows(['.....33433......','....233433......','....233432......','.....23f32......','.....12g21......','.....12321......','.....11211......','.....11..11.....','.....ff..ff.....','.....gg..gg.....'])],
 headRows:10,feetRows:2,feet:['#f1d6bf','#be9e93','#806a70'],feetX:[5,9],sideFeetX:[6,9],paws:true,ears:{keys:'k',flop:false},hurtFill:'#f1d6bf',
 overlay(p,pose,frame){const dy=frame.bob;if(pose==='side')p.poly([4,4,4,0,7,4],'#695665');p.line(6,10+dy,10,11+dy,'#e9c7a0');if(pose==='back')p.line(9,11+dy,11,15+dy,'#cf6679');},
 portrait(p){p.rect(19,12,3,5,'#ed9fa4');p.px(20,13,'#fff6db');},
};
