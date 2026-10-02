// Generates the PWA / home-screen icons (pixel-art lantern) into public/icons.
// Usage: node scripts/gen-icons.mjs   (needs Playwright's Chromium)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

// [file, size px, grid (logical pixels), transparent corners?]
const TARGETS = [
  ['icon-192.png', 192, 32, true],
  ['icon-512.png', 512, 32, true],
  ['icon-maskable-512.png', 512, 40, false],
  ['apple-touch-icon.png', 180, 36, false],
  ['favicon-32.png', 32, 32, true],
];

function draw(grid, rounded) {
  const c = document.createElement('canvas');
  c.width = c.height = grid;
  const g = c.getContext('2d');
  const px = (x, y, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  };
  const cx = grid / 2;
  const off = Math.round((grid - 32) / 2);
  // background: deep night with a quantized warm glow
  const bgR = rounded ? grid / 2 - 0.5 : grid;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - (cx + 1);
      const d = Math.hypot(dx, dy);
      if (rounded) {
        // rounded square (squircle-ish) with a 1px rim
        const ax = Math.abs(x + 0.5 - cx);
        const ay = Math.abs(y + 0.5 - cx);
        const k = Math.pow(Math.pow(ax / bgR, 5) + Math.pow(ay / bgR, 5), 1 / 5);
        if (k > 1) continue;
        if (k > 0.94) {
          px(x, y, '#2a1f36');
          continue;
        }
      }
      const glow = d < grid * 0.22 ? '#5a2a18' : d < grid * 0.3 ? '#3a1a16' : d < grid * 0.39 ? '#22121a' : '#0e0914';
      px(x, y, glow);
    }
  }
  // lantern silhouette (32x32 design space, offset into the grid)
  const shape = [];
  const add = (x, y, col) => shape.push([x + off, y + off, col]);
  const iron = ['#1e1828', '#3a3046', '#5e5070', '#8a7c9c'];
  // hanging ring
  for (const [x, y] of [[15, 3], [16, 3], [14, 4], [17, 4], [14, 5], [17, 5], [15, 6], [16, 6]]) add(x, y, y < 5 ? iron[3] : iron[2]);
  // cap
  for (let x = 12; x <= 19; x++) add(x, 7, iron[2]);
  for (let x = 11; x <= 20; x++) add(x, 8, x < 14 ? iron[3] : iron[1]);
  for (let x = 10; x <= 21; x++) add(x, 9, x < 13 ? iron[2] : iron[1]);
  // body: frame + glass
  for (let y = 10; y <= 21; y++) {
    for (let x = 10; x <= 21; x++) {
      const edge = x === 10 || x === 21;
      const bar = x === 15 || x === 16;
      if (edge) add(x, y, x === 10 ? iron[2] : iron[0]);
      else {
        const dx = x - 15.5;
        const dy = y - 16;
        const d = Math.hypot(dx, dy * 0.8);
        let col = d < 2 ? '#fff6d0' : d < 3.2 ? '#ffe080' : d < 4.6 ? '#ffb050' : '#e0702a';
        if (bar && d >= 3.2) col = '#a0401a';
        add(x, y, col);
      }
    }
  }
  // flame tongue
  for (const [x, y, col] of [[15, 13, '#ffe080'], [16, 12, '#ffe080'], [16, 13, '#fff6d0'], [15, 14, '#fff6d0']]) add(x, y, col);
  // glass shine
  for (const [x, y] of [[12, 11], [12, 12], [12, 13], [13, 11]]) add(x, y, '#fff0c8');
  // base
  for (let x = 10; x <= 21; x++) add(x, 22, x < 13 ? iron[3] : iron[1]);
  for (let x = 11; x <= 20; x++) add(x, 23, iron[1]);
  for (let x = 12; x <= 19; x++) add(x, 24, iron[0]);
  // 1px ink outline around the silhouette
  const filled = new Set(shape.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of shape) {
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + ox},${y + oy}`;
      if (!filled.has(k)) {
        filled.add(k);
        px(x + ox, y + oy, '#0c0810');
      }
    }
  }
  for (const [x, y, col] of shape) px(x, y, col);
  // floor glow under the lantern
  for (let x = 9; x <= 22; x++) if (!filled.has(`${x + off},${26 + off}`)) px(x + off, 26 + off, x > 11 && x < 20 ? '#7a3a1a' : '#4a2218');
  return c.toDataURL('image/png');
}

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, grid, rounded] of TARGETS) {
  const dataUrl = await page.evaluate(
    ([grid, rounded, size, src]) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return (${src})`)();
      const small = new Image();
      small.src = fn(grid, rounded);
      return new Promise((res) => {
        small.onload = () => {
          const big = document.createElement('canvas');
          big.width = big.height = size;
          const g = big.getContext('2d');
          g.imageSmoothingEnabled = false;
          g.drawImage(small, 0, 0, size, size);
          res(big.toDataURL('image/png'));
        };
      });
    },
    [grid, rounded, size, draw.toString()],
  );
  writeFileSync(new URL(file, OUT), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', file);
}
await browser.close();
