// Renders a sheet PNG of every enemy and boss. Usage: node scripts/sheet-enemies.mjs out.png
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const port = 6100 + Math.floor(Math.random() * 300);
const server = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite timeout')), 30000); server.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => !!window.__lk, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const h = await page.evaluate(async () => {
    const sp = await import('/src/engine/sprites.ts');
    const defs = await import('/src/game/defs.ts');
    const all = defs.Enemies.all();
    const regular = all.filter((e) => !e.boss).sort((a, b) => (Math.min(...(a.floors ?? [9])) - Math.min(...(b.floors ?? [9]))));
    const bosses = all.filter((e) => e.boss);
    const S = 4;
    const cols = 6, cellW = 200, cellH = 170;
    const rowsR = Math.ceil(regular.length / cols);
    const bossCellW = 300, bossCellH = 290;
    const rowsB = Math.ceil(bosses.length / 4);
    const W = 1280;
    const H = 90 + rowsR * cellH + (bosses.length ? 70 + rowsB * bossCellH : 0) + 20;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#14111b'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#ffe0a0'; c.font = "bold 32px 'Galmuri11'";
    c.fillText(`등불지기 — 적 (${regular.length}종)`, 30, 50);
    const floorCol = { 1: '#9aa0c8', 2: '#7ad08a', 3: '#ff9a50', 4: '#8ae0ff', 5: '#c08aff' };
    const draw = (e, cx, cy, scale) => {
      const name = e.sprite;
      const frame = sp.hasAnim(name) ? sp.animFrame(name, 0.1) : name;
      if (!sp.hasSprite(frame)) return;
      const s = sp.getSprite(frame);
      let sc = scale;
      while (sc > 1 && (s.w * sc > cellW - 20 || s.h * sc > cellH - 50)) sc--;
      c.drawImage(s.canvas, Math.round(cx - (s.w * sc) / 2), Math.round(cy - (s.h * sc) / 2), s.w * sc, s.h * sc);
    };
    regular.forEach((e, i) => {
      const x = 20 + (i % cols) * (cellW + 7);
      const y = 75 + Math.floor(i / cols) * cellH;
      const f = Math.min(...(e.floors ?? [0]));
      c.fillStyle = '#ffffff0c'; c.fillRect(x, y, cellW, cellH - 10);
      c.fillStyle = (floorCol[f] ?? '#888') + '30'; c.fillRect(x, y, cellW, 4);
      draw(e, x + cellW / 2, y + 70, S);
      c.fillStyle = '#f0e8d8'; c.font = "bold 15px 'Galmuri11'"; c.textAlign = 'center';
      c.fillText(e.name, x + cellW / 2, y + cellH - 38);
      c.fillStyle = floorCol[f] ?? '#888'; c.font = "12px 'Galmuri11'";
      c.fillText(`${(e.floors ?? []).join('·')}층 · HP ${e.hp}`, x + cellW / 2, y + cellH - 20);
      c.textAlign = 'left';
    });
    if (bosses.length) {
      let y0 = 75 + rowsR * cellH + 20;
      c.fillStyle = '#ff9090'; c.font = "bold 28px 'Galmuri11'"; c.fillText(`보스 (${bosses.length})`, 30, y0 + 30);
      y0 += 50;
      bosses.forEach((e, i) => {
        const x = 20 + (i % 4) * (bossCellW + 10);
        const y = y0 + Math.floor(i / 4) * bossCellH;
        c.fillStyle = '#ff40400c'; c.fillRect(x, y, bossCellW, bossCellH - 10);
        const name = e.portrait ?? e.sprite;
        const frame = sp.hasAnim(name) ? sp.animFrame(name, 0.1) : name;
        if (sp.hasSprite(frame)) {
          const s = sp.getSprite(frame);
          let sc = 6;
          while (sc > 1 && (s.w * sc > bossCellW - 30 || s.h * sc > bossCellH - 80)) sc--;
          c.drawImage(s.canvas, Math.round(x + bossCellW / 2 - (s.w * sc) / 2), Math.round(y + 110 - (s.h * sc) / 2), s.w * sc, s.h * sc);
        }
        c.textAlign = 'center';
        c.fillStyle = '#ffd0d0'; c.font = "bold 18px 'Galmuri11'"; c.fillText(e.name, x + bossCellW / 2, y + bossCellH - 50);
        c.fillStyle = '#c08080'; c.font = "12px 'Galmuri11'"; c.fillText(`${e.bossTitle ?? ''} · ${(e.bossFloors ?? []).join('·')}층`, x + bossCellW / 2, y + bossCellH - 28);
        c.textAlign = 'left';
      });
    }
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    cv.style.display = 'block';
    document.body.appendChild(cv);
    return H;
  });
  await page.setViewportSize({ width: 1280, height: h });
  await page.screenshot({ path: out });
} finally {
  await browser.close();
  server.kill('SIGTERM');
  process.exit(0);
}
