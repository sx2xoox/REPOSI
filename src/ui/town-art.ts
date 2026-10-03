import { PixelPainter } from '../engine/painter';

let cached: HTMLCanvasElement | null = null;
const residents = new Map<number, HTMLCanvasElement>();
export function residentArt(i: number): HTMLCanvasElement {
  const old = residents.get(i); if (old) return old;
  const p = new PixelPainter(16, 24);
  const coats = [['#463754', '#88759f', '#bca2bb'], ['#49342e', '#99724f', '#c3a177'], ['#24464f', '#588d91', '#91b7ad']][i];
  p.ellipse(8, 22, 6, 1, '#09131b');
  p.rect(4, 18, 3, 4, '#2a303b'); p.rect(9, 18, 3, 4, '#252937');
  p.rect(3, 22, 4, 1, '#a19883'); p.rect(9, 22, 4, 1, '#807b70');
  p.poly([4, 10, 11, 10, 14, 19, 2, 19], coats[0]);
  p.poly([4, 11, 10, 11, 11, 18, 3, 18], coats[1]);
  p.line(5, 12, 4, 17, coats[2]); p.rect(3, 17, 10, 2, '#40383a'); p.px(7, 17, '#c4ae76');
  p.rect(1, 12, 2, 5, coats[1]); p.rect(12, 12, 2, 5, coats[0]); p.px(2, 17, '#d1af8e'); p.px(12, 17, '#b89b83');
  p.ellipse(8, 6, 4, 5, '#a5816e'); p.rect(5, 4, 6, 6, '#dabda0'); p.line(5, 5, 5, 8, '#f0d2ab');
  p.px(6, 6, '#292634'); p.px(10, 6, '#292634'); p.px(8, 9, '#9e6a67');
  p.poly([3, 6, 4, 2, 8, 0, 12, 3, 12, 5, 7, 3, 5, 7], i === 1 ? '#665446' : i === 2 ? '#7a8190' : '#3e374b');
  p.line(5, 2, 9, 1, i === 1 ? '#ae946a' : '#aaa0b2');
  if (i === 2) { p.line(5, 6, 11, 6, '#aaad96'); p.px(7, 7, '#222939'); p.px(10, 7, '#222939'); }
  if (i === 0) { p.rect(10, 12, 4, 6, '#5c4a31'); p.rect(11, 13, 2, 3, '#f1c573'); }
  // Distinct occupations, cloth edges and small carried objects.
  if (i === 0) {
    p.poly([3, 4, 4, 1, 9, 0, 12, 3, 11, 4, 7, 2, 5, 5], '#504765');
    p.line(4, 2, 8, 1, '#afa0ba'); p.px(11, 3, '#d6b777');
    p.rect(5, 10, 6, 2, '#c3a99b'); p.rect(8, 11, 2, 4, '#b08782');
    p.line(4, 18, 9, 18, '#cab8be'); p.rect(11, 12, 3, 1, '#c3a068');
    p.px(12, 14, '#fff0b9'); p.px(12, 17, '#bd8753');
  } else if (i === 1) {
    p.rect(4, 11, 7, 8, '#654735'); p.line(5, 11, 5, 17, '#b69263');
    p.rect(5, 15, 5, 3, '#8c6644'); p.px(6, 16, '#c2a278');
    p.line(10, 13, 12, 18, '#b9b7a1'); p.rect(9, 12, 4, 2, '#6d8791');
    p.rect(4, 3, 8, 2, '#997a50'); p.line(4, 3, 10, 3, '#cfb47b');
  } else {
    p.rect(4, 10, 2, 8, '#aeb6a2'); p.rect(9, 11, 4, 7, '#3b393c');
    p.rect(9, 11, 3, 6, '#b99a6d'); p.line(10, 12, 11, 12, '#e4d8ad');
    p.line(10, 14, 11, 14, '#6c7568'); p.px(8, 6, '#d4caa5');
    p.line(4, 18, 8, 18, '#9ab8b2'); p.px(5, 2, '#d2d0bd');
  }
  const art = p.toCanvas(); residents.set(i, art); return art;
}
/** Static scenery is rasterized once; animated light stays in the scene. */
export function townArt(): HTMLCanvasElement {
  if (cached) return cached;
  const p = new PixelPainter(384, 216);
  const n = (x: number, y: number, salt = 0) => {
    let v = Math.imul(x + salt * 71, 374761393) ^ Math.imul(y + 97, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177); return (v ^ (v >>> 16)) >>> 0;
  };
  p.rect(0, 0, 384, 216, '#101e29');
  // Far silhouettes, retaining wall and a valley beyond the settlement.
  for (let x = 0; x < 384; x += 7) {
    const h = 8 + n(x, 0) % 25;
    p.poly([x - 12, 58, x + 3, h, x + 19, 58], '#182d35');
    p.poly([x - 9, 63, x + 9, h + 13, x + 23, 63], '#21383c');
  }
  p.rect(0, 61, 384, 135, '#283833');
  for (let y = 62; y < 196; y++) for (let x = 0; x < 384; x++) {
    const k = n(x, y);
    if (k % 19 < 3) p.px(x, y, ['#344337', '#1f302e', '#3b493b'][k % 3]);
  }
  for (let y = 56; y < 73; y += 5) for (let x = -8; x < 384; x += 13) {
    const xx = x + (y % 2) * 6;
    p.rect(xx, y, 12, 4, '#39484a'); p.line(xx + 1, y, xx + 10, y, '#53605c');
    p.px(xx + 9, y + 3, '#293b3b');
  }
  p.line(0, 55, 383, 55, '#7a8070');
  // Broad, irregular plaza stones; restrained texture between readable silhouettes.
  for (let y = 79; y < 190; y += 6) for (let x = 18; x < 370; x += 9) {
    const xx = x + (Math.floor(y / 6) % 2) * 4, k = n(x, y);
    const path = (y > 108 && y < 154) || Math.abs(xx - 188) < 28 || y > 145 && xx > 230 && xx < 316;
    if (!path && k % 7) continue;
    const colors = ['#445251', '#4d5956', '#3b4c4d', '#53605a'];
    p.poly([xx + 1, y, xx + 7, y, xx + 8, y + 2, xx + 7, y + 5, xx, y + 4, xx, y + 1], '#182b2d');
    p.rect(xx + 1, y + 1, 6, 3, colors[k % 4]);
    p.line(xx + 2, y, xx + 6, y, '#697169');
    if (k % 5 === 0) p.line(xx + 4, y + 1, xx + 3, y + 3, '#303f40');
    if (k % 9 === 0) p.px(xx, y + 5, '#68734a');
  }
  const window = (x: number, y: number, w = 8) => {
    p.rect(x - 2, y - 2, w + 4, 15, '#24252b'); p.rect(x - 1, y - 1, w + 2, 13, '#95775a');
    p.rect(x, y, w, 10, '#ce9a59'); p.rect(x + 1, y + 1, w - 2, 4, '#f0c681');
    p.line(x + w / 2, y, x + w / 2, y + 10, '#58483b'); p.line(x, y + 5, x + w, y + 5, '#58483b');
    p.rect(x - 3, y + 12, w + 6, 2, '#aaa08a'); p.rect(x - 3, y + 14, w + 6, 2, '#393d3b');
  };
  const house = (x: number, y: number, w: number, roof: string[], kind: number) => {
    const h = kind === 1 ? 34 : 37;
    p.poly([x - 3, y + 27, x + w, y + 25, x + w + 18, y + h + 12, x + 4, y + h + 13], '#17272a');
    p.rect(x, y, w, h, '#827561'); p.rect(x + w - 10, y, 10, h, '#4b4b46');
    for (let yy = y + 3; yy < y + h; yy += 4) for (let xx = x + 2; xx < x + w - 11; xx += 6) {
      if (n(xx, yy) % 4 === 0) p.line(xx, yy, xx + 3, yy, '#9a8b70');
    }
    for (const dx of [1, w - 12]) { p.rect(x + dx, y, 3, h, '#39383a'); p.line(x + dx, y + 2, x + dx, y + h - 2, '#a38762'); }
    p.rect(x, y + h - 6, w, 7, '#4a514d');
    for (let xx = x; xx < x + w; xx += 7) { p.line(xx, y + h - 6, xx + 5, y + h - 6, '#8a8b75'); p.line(xx, y + h - 5, xx, y + h, '#28373a'); }
    // A pitched roof with a separate shaded hip, individual staggered shingles and ridge caps.
    const peak = x + w * .42, top = y - 23;
    p.poly([x - 7, y + 4, peak, top, x + w + 4, y - 1, x + w + 7, y + 7], '#20272e');
    p.poly([x - 5, y + 2, peak, top + 1, x + w - 9, y + 2], roof[0]);
    p.poly([peak, top + 1, x + w + 3, y - 1, x + w + 5, y + 4, x + w - 9, y + 2], roof[3]);
    for (let row = 0; row < 6; row++) {
      const yy = top + 4 + row * 4, t = (yy - top) / 25;
      const left = peak + (x - 5 - peak) * t, right = peak + (x + w - 9 - peak) * t;
      for (let xx = Math.ceil(left); xx < right - 2; xx += 6) {
        const k = n(xx, yy), width = Math.min(5, right - xx);
        p.rect(xx, yy, width, 3, k % 3 ? roof[0] : roof[1]);
        p.line(xx, yy, xx + width - 1, yy, roof[2]); p.line(xx, yy + 3, xx + width - 1, yy + 3, roof[3]);
        if (k % 5 === 0) p.px(xx + 1, yy + 1, roof[1]);
      }
    }
    p.line(x - 6, y + 4, x + w - 8, y + 4, roof[2]);
    p.line(x + w - 8, y + 4, x + w + 5, y + 6, roof[1]);
    p.line(peak, top, x + w + 4, y - 2, roof[2]);
    p.rect(x + w - 19, top - 4, 8, 15, '#5c5951');
    for (let yy = top - 3; yy < top + 10; yy += 4) { p.line(x + w - 18, yy, x + w - 12, yy, '#9b8f78'); p.px(x + w - 15, yy + 1, '#353d40'); }
    p.rect(x + w - 21, top - 6, 12, 3, '#a09b83'); p.rect(x + w - 19, top - 6, 8, 1, '#292e34');
    const door = x + Math.floor(w * .47);
    p.rect(door - 7, y + 12, 16, h - 12, '#24292e'); p.rect(door - 5, y + 14, 12, h - 14, '#574639');
    for (let j = 0; j < 3; j++) p.line(door - 4 + j * 4, y + 15, door - 4 + j * 4, y + h - 2, '#927253');
    p.rect(door - 5, y + 20, 12, 2, '#342f30'); p.px(door + 4, y + 27, '#e2bd70');
    p.rect(door - 10, y + h, 23, 3, '#9b9982'); p.rect(door - 12, y + h + 3, 27, 3, '#626d65'); p.line(door - 11, y + h + 3, door + 13, y + h + 3, '#afb097');
    window(x + 8, y + 13);
    if (kind !== 1) window(x + w - 25, y + 13, 7);
    // Each service building has its own silhouette and craft props.
    if (kind === 0) {
      p.rect(x - 8, y + 16, 21, 3, '#544337');
      p.poly([x - 11, y + 16, x - 7, y + 6, x + 13, y + 6, x + 17, y + 16], '#604650');
      for (let xx = x - 7; xx < x + 14; xx += 6) p.poly([xx, y + 7, xx + 3, y + 7, xx + 4, y + 16, xx, y + 16], '#a07b6b');
      p.rect(x - 8, y + 19, 2, 23, '#836849'); p.rect(x + 13, y + 19, 2, 23, '#463d35');
      p.rect(x - 6, y + 34, 20, 3, '#ac8960'); p.rect(x - 4, y + 29, 5, 5, '#465d63');
      p.line(x + 4, y + 26, x + 7, y + 33, '#bec0a0'); p.rect(x + 5, y + 26, 7, 2, '#687d80');
    }
    if (kind === 2) {
      p.rect(x + w + 1, y + 12, 2, 25, '#90785a'); p.line(x + w - 5, y + 12, x + w + 8, y + 12, '#b49464');
      p.rect(x + w + 3, y + 15, 9, 13, '#304e53'); p.rect(x + w + 4, y + 16, 7, 9, '#72918b');
      p.line(x + w + 6, y + 18, x + w + 6, y + 22, '#e0cf9a');
      p.rect(x - 5, y + h + 3, 18, 6, '#463b37');
      for (let j = 0; j < 5; j++) p.rect(x - 4 + j * 3, y + h, 2, 7, ['#758c83', '#9e6f59', '#c1a273'][j % 3]);
    }
  };
  house(46, 72, 65, ['#744d48', '#93614e', '#b18464', '#48373d'], 0);
  house(125, 52, 51, ['#41586a', '#597182', '#87978d', '#293e50'], 1);
  house(273, 60, 66, ['#4c6562', '#688277', '#9aab8b', '#31484c'], 2);
  // Engraved, stepped lantern monument with iron scrollwork.
  p.ellipse(192, 104, 26, 10, '#17292b'); p.ellipse(192, 101, 24, 9, '#59645b');
  p.ellipse(192, 98, 23, 8, '#9a9c7e'); p.ellipse(192, 97, 19, 6, '#445856');
  for (let a = 0; a < 12; a++) { const t = a * Math.PI / 6; p.line(192 + Math.cos(t) * 19, 97 + Math.sin(t) * 6, 192 + Math.cos(t) * 23, 98 + Math.sin(t) * 8, '#606f65'); }
  p.rect(184, 92, 16, 5, '#a3a487'); p.rect(188, 80, 8, 12, '#64766d'); p.line(188, 81, 188, 91, '#c5b891');
  for (const x of [176, 207]) { p.rect(x, 68, 3, 29, '#243c43'); p.line(x, 69, x, 95, '#859b8d'); p.rect(x - 2, 94, 7, 3, '#788778'); }
  p.poly([177, 69, 181, 60, 191, 56, 204, 60, 209, 69, 204, 64, 192, 60, 182, 64], '#a5aa88');
  p.line(192, 60, 192, 80, '#9d8d63'); p.circle(192, 57, 2, '#e3c480');
  // Small practical objects give the square scale and evidence of daily use.
  const barrel = (x: number, y: number) => {
    p.ellipse(x + 2, y + 10, 7, 3, '#192c2d'); p.rect(x - 5, y, 10, 9, '#715439');
    p.ellipse(x, y, 5, 3, '#a98655'); p.ellipse(x, y, 3, 1, '#685139');
    for (let j = -3; j < 5; j += 3) p.line(x + j, y + 2, x + j, y + 9, '#b18c5a');
    for (const dy of [3, 8]) { p.line(x - 5, y + dy, x + 4, y + dy, '#34434a'); p.line(x - 4, y + dy, x - 1, y + dy, '#95a194'); }
  };
  for (const [x,y] of [[42,113],[114,103],[263,110],[346,108],[247,172]]) barrel(x,y);
  for (const [x,y] of [[120,139],[224,124],[315,151]]) {
    p.rect(x, y + 3, 19, 3, '#967851'); p.rect(x + 1, y, 17, 2, '#b19a6c');
    p.rect(x + 2, y + 6, 2, 5, '#3c3d34'); p.rect(x + 15, y + 6, 2, 5, '#3c3d34');
  }
  // Canal bank, reeds, mooring ropes and a little boat alongside the pier.
  p.rect(0, 190, 384, 26, '#142c3c');
  for (let y = 193; y < 216; y += 3) for (let x = 0; x < 384; x += 11) {
    const k = n(x,y); if (k % 3) p.line(x, y, x + 2 + k % 8, y, ['#254555','#355767','#1b3749'][k % 3]);
  }
  for (let x = 0; x < 384; x += 9) {
    p.rect(x, 187, 8, 6, '#4e605b'); p.line(x, 187, x + 7, 187, '#8a9580'); p.line(x, 193, x + 7, 193, '#0c2331');
    if (n(x, 9) % 3 === 0) { p.line(x + 2, 185, x, 178, '#69825b'); p.line(x + 3, 186, x + 5, 177, '#879262'); }
  }
  p.poly([319, 197, 335, 189, 350, 197, 344, 207, 326, 207], '#0b2330');
  p.poly([321, 195, 335, 188, 348, 195, 342, 203, 327, 203], '#9b7850');
  p.poly([325, 195, 335, 191, 344, 195, 340, 201, 329, 201], '#3b3c36');
  p.line(328, 195, 341, 198, '#c0a375'); p.line(338, 191, 330, 206, '#c7b48b');
  p.rect(249, 165, 63, 37, '#1d2a2c');
  for (let y = 165; y < 201; y += 4) {
    p.rect(250, y, 60, 3, '#79634b'); p.line(251, y, 309, y, '#b29567');
    for (let x = 253; x < 308; x += 14) { p.px(x, y + 1, '#4b4439'); p.line(x + 3, y + 2, x + 8, y + 2, '#8e7755'); }
  }
  for (const x of [248,310]) for (const y of [168,190]) { p.rect(x, y, 4, 12, '#4f4538'); p.ellipse(x + 2,y,3,2,'#c0ab7a'); p.line(x + 1,y + 3,x + 1,y + 10,'#9b8056'); }
  p.line(313, 192, 326, 198, '#a79771');
  // Layered foliage clusters and bark; irregular edges avoid geometric tree blobs.
  const tree = (x: number, y: number, size = 1) => {
    p.ellipse(x + 4, y + 22, 14 * size, 5, '#1a2d2b');
    p.poly([x - 3,y + 23,x - 2,y - 4,x + 3,y - 7,x + 4,y + 20,x + 8,y + 24], '#4f4c3b');
    p.line(x - 1,y + 3,x - 1,y + 21,'#8a7c52'); p.line(x + 1,y + 11,x + 8,y + 3,'#766d47');
    for (const [dx,dy,r] of [[0,-18,12],[-10,-8,12],[9,-9,13],[0,0,13]]) {
      const cx=x+dx*size,cy=y+dy*size;
      p.circle(cx,cy,r*size,'#142e2c'); p.circle(cx-2,cy-2,(r-2)*size,'#2a4939');
      for (let yy=-r;yy<r;yy+=2) for(let xx=-r;xx<r;xx+=2) {
        const k=n(x+xx,y+yy,dx+dy);
        if (xx*xx+yy*yy>(r-2)*(r-2)||k%3) continue;
        p.rect(cx+xx*size,cy+yy*size,2,1, yy < 1 ? (k%2?'#5b7450':'#436348'):'#345640');
      }
      p.line(cx-5,cy-r+3,cx,cy-r+2,'#7b865a');
    }
  };
  tree(20,89); tree(365,91); tree(228,66,.8); tree(20,168,1.15); tree(368,174,1.1);
  for (let x=34;x<351;x+=5) {
    const y=177+n(x,8)%7;
    if(x>234&&x<315)continue;
    p.line(x,y,x-2,y-4,'#546c43');p.line(x,y,x+2,y-6,'#758150');
    if(n(x,3)%4===0) {p.px(x+2,y-7,'#baaa75');p.px(x+3,y-7,'#8c8285');}
  }
  return cached = p.toCanvas();
}
