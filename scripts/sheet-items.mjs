// Renders a sheet PNG of every artifact icon + resonance sets. Usage: node scripts/sheet-items.mjs out.png
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const port = 6500 + Math.floor(Math.random() * 300);
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
    const order = { legendary: 0, epic: 1, rare: 2, common: 3 };
    const arts = defs.Artifacts.all().filter((a) => !a.hidden).sort((a, b) => order[a.rarity] - order[b.rarity] || a.name.localeCompare(b.name));
    const sets = defs.Sets.all();
    const cols = 6, cellW = 205, cellH = 118;
    const rows = Math.ceil(arts.length / cols);
    const W = 1280;
    const setRows = Math.ceil(sets.length / 4);
    const H = 80 + rows * cellH + 60 + setRows * 50 + 30;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#14111b'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#ffe0a0'; c.font = "bold 30px 'Galmuri11'";
    c.fillText(`등불지기 — 유물 (${arts.length}종)`, 24, 48);
    const RC = defs.RARITY_COLOR, RN = defs.RARITY_NAME;
    const wrap = (txt, maxW) => {
      const out = []; let line = '';
      for (const ch of txt) { if (c.measureText(line + ch).width > maxW) { out.push(line); line = ch; } else line += ch; }
      if (line) out.push(line); return out;
    };
    arts.forEach((a, i) => {
      const x = 14 + (i % cols) * (cellW + 6);
      const y = 70 + Math.floor(i / cols) * cellH;
      c.fillStyle = '#ffffff0b'; c.fillRect(x, y, cellW, cellH - 8);
      c.fillStyle = RC[a.rarity]; c.fillRect(x, y, 3, cellH - 8);
      if (sp.hasSprite(a.icon)) {
        const s = sp.getSprite(a.icon);
        const sc = 3;
        c.fillStyle = RC[a.rarity] + '22';
        c.beginPath(); c.arc(x + 34, y + 36, 28, 0, Math.PI * 2); c.fill();
        c.drawImage(s.canvas, Math.round(x + 34 - (s.w * sc) / 2), Math.round(y + 36 - (s.h * sc) / 2), s.w * sc, s.h * sc);
      }
      c.fillStyle = RC[a.rarity]; c.font = "bold 13px 'Galmuri11'";
      c.fillText(a.name, x + 70, y + 22);
      c.fillStyle = '#8a7f9a'; c.font = "10px 'Galmuri11'";
      c.fillText(RN[a.rarity] + (a.tags.length ? ' · ' + a.tags.map((t) => defs.Sets.get(t)?.name ?? t).join('·') : ''), x + 70, y + 38);
      c.fillStyle = '#d8d0c8'; c.font = "10px 'Galmuri11'";
      wrap(a.desc, cellW - 16).slice(0, 4).forEach((l, k) => c.fillText(l, x + 10, y + 70 + k * 12));
    });
    let y0 = 70 + rows * cellH + 20;
    c.fillStyle = '#ffd080'; c.font = "bold 24px 'Galmuri11'"; c.fillText(`등불 공명 (${sets.length})`, 24, y0 + 20);
    y0 += 40;
    sets.forEach((s, i) => {
      const x = 14 + (i % 4) * 314;
      const y = y0 + Math.floor(i / 4) * 50;
      c.fillStyle = '#ffffff0b'; c.fillRect(x, y, 306, 42);
      if (sp.hasSprite(s.icon)) { const sp2 = sp.getSprite(s.icon); c.drawImage(sp2.canvas, x + 10, y + 21 - sp2.h * 1.5, sp2.w * 3, sp2.h * 3); }
      c.fillStyle = s.color; c.font = "bold 15px 'Galmuri11'"; c.fillText(s.name, x + 50, y + 18);
      c.fillStyle = '#8a7f9a'; c.font = "10px 'Galmuri11'";
      const n = arts.filter((a) => a.tags.includes(s.tag)).length;
      c.fillText(`유물 ${n}개 · 단계 ${s.tiers.map((t) => t.count).join('/')}`, x + 50, y + 34);
    });
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
