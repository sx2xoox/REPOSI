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
  const art = p.toCanvas(); residents.set(i, art); return art;
}
/** Village backdrop at the game's native pixel scale. No simulation RNG. */
export function townArt(): HTMLCanvasElement {
  if (cached) return cached;
  const p = new PixelPainter(384, 216);
  p.rect(0, 0, 384, 216, '#0c1921');
  const noise = (x: number, y: number) => ((x * 31 + y * 17 + x * y * 3) >>> 0) % 23;
  // Mossy earth under the village and its winding stone paving.
  for (let y = 44; y < 201; y++) for (let x = 15; x < 370; x++) {
    if (noise(x, y) < 3) p.px(x, y, y % 2 ? '#1b3330' : '#213c35');
  }
  for (let y = 72; y < 190; y += 7) for (let x = 26; x < 358; x += 10) {
    const path = Math.abs(x - 190) < 25 || y > 114 && y < 143 || y > 160 && x > 174;
    if (!path && noise(x, y) > 3) continue;
    const xx = x + (y % 2 ? 4 : 0), k = noise(x, y);
    p.rect(xx, y, 8, 5, k < 9 ? '#33464a' : '#2b3c41');
    p.line(xx + 1, y, xx + 6, y, '#485759');
    p.line(xx + 1, y + 5, xx + 7, y + 5, '#152830');
    if (k < 4) p.px(xx + 3, y + 2, '#66716a');
  }
  const house = (x: number, y: number, w: number, roof: string[]) => {
    p.ellipse(x + w / 2 + 4, y + 39, w / 2 + 7, 7, '#0a141c');
    p.rect(x, y, w, 36, '#635653');
    for (let yy = y; yy < y + 35; yy += 5) {
      p.line(x, yy, x + w - 1, yy, '#403b3b');
      for (let xx = x + ((yy % 2) * 4); xx < x + w; xx += 10) p.line(xx, yy, xx, yy + 4, '#494747');
    }
    p.rect(x + 2, y, 3, 35, '#393331'); p.rect(x + w - 5, y, 3, 35, '#332d30');
    p.poly([x - 6, y + 4, x + w / 2, y - 19, x + w + 6, y + 4], roof[0]);
    for (let row = 0; row < 5; row++) {
      const yy = y - 14 + row * 4, half = (row + 1) * (w + 8) / 10;
      p.line(x + w / 2 - half, yy, x + w / 2 + half, yy, roof[1]);
      for (let xx = x + w / 2 - half + 2; xx < x + w / 2 + half; xx += 7) p.px(xx, yy + 1, roof[2]);
    }
    p.line(x - 5, y + 5, x + w + 5, y + 5, '#1b2029');
    p.rect(x + w - 13, y - 23, 7, 14, '#3f444b'); p.rect(x + w - 14, y - 24, 9, 3, '#697071');
    p.rect(x + w / 2 - 7, y + 14, 15, 23, '#24272e');
    for (let xx = 0; xx < 3; xx++) p.line(x + w / 2 - 5 + xx * 4, y + 16, x + w / 2 - 5 + xx * 4, y + 35, '#59473c');
    p.px(x + w / 2 + 4, y + 27, '#c89c61');
    p.rect(x + w / 2 - 10, y + 37, 22, 3, '#7b7970');
    for (const dx of [10, w - 17]) {
      p.rect(x + dx - 1, y + 13, 9, 12, '#171e28');
      p.rect(x + dx, y + 14, 7, 9, '#9c7951');
      p.line(x + dx + 3, y + 14, x + dx + 3, y + 23, '#39302e');
      p.line(x + dx, y + 18, x + dx + 6, y + 18, '#39302e');
      p.rect(x + dx - 2, y + 25, 11, 2, '#828275');
    }
  };
  house(48, 71, 59, ['#59464a', '#81635c', '#a38168']);
  house(127, 54, 51, ['#394b57', '#536979', '#80918f']);
  house(279, 60, 62, ['#435550', '#6c7b66', '#9a9b77']);
  // Central round plinth and the hanging lamp's iron arch.
  p.ellipse(192, 103, 24, 10, '#101e26'); p.ellipse(192, 99, 22, 8, '#4c5756');
  p.ellipse(192, 96, 20, 7, '#68746b'); p.ellipse(192, 95, 15, 5, '#354947');
  p.rect(187, 82, 10, 13, '#39434a'); p.rect(184, 92, 16, 4, '#798077');
  for (const x of [175, 209]) { p.rect(x, 67, 3, 30, '#1a2530'); p.line(x, 67, x, 93, '#708081'); }
  p.line(177, 67, 207, 67, '#7c867f'); p.line(192, 67, 192, 80, '#8c8469');
  // Reed-lined water and a wooden cooperative pier.
  p.rect(17, 187, 352, 21, '#0e2939');
  for (let y = 188; y < 206; y += 4) for (let x = 18; x < 366; x += 13) {
    const n = noise(x, y); p.line(x + n % 3, y, x + 5 + n % 5, y, '#285064');
  }
  for (let x = 252; x < 307; x += 5) { p.rect(x, 163, 4, 36, '#6a5645'); p.line(x, 164, x, 197, '#997b58'); }
  for (const x of [250, 309]) for (const y of [167, 190]) { p.rect(x, y, 4, 12, '#362d29'); p.rect(x, y, 4, 2, '#ac9270'); }
  p.line(252, 171, 309, 171, '#b3a184');
  // Barrels, fence, shrubs and old trees make the square feel inhabited.
  for (const [x, y] of [[47, 113], [111, 103], [272, 110], [339, 101], [253, 177]]) {
    p.ellipse(x, y, 5, 3, '#a27e50'); p.rect(x - 5, y, 10, 9, '#685038'); p.ellipse(x, y + 9, 5, 2, '#493f32');
    p.line(x - 4, y + 3, x + 4, y + 3, '#a6a395'); p.line(x - 4, y + 7, x + 4, y + 7, '#292e32');
  }
  for (const [x, y] of [[25, 65], [360, 80], [31, 163], [351, 156], [224, 58]]) {
    p.rect(x - 2, y, 4, 21, '#524b38'); p.line(x, y + 6, x - 9, y - 2, '#5c5942');
    for (const [dx, dy, radius] of [[-7, -5, 11], [6, -9, 12], [0, -17, 10]]) {
      p.circle(x + dx, y + dy, radius, '#19372f'); p.circle(x + dx - 2, y + dy - 2, radius - 3, '#2b4c3b');
      p.line(x + dx - 5, y + dy - 5, x + dx + 2, y + dy - 7, '#45624a');
    }
  }
  return cached = p.toCanvas();
}
