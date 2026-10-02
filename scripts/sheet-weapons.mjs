// Renders a sheet PNG of every weapon (icon + held sprite, rarity, archetype, description).
// Usage: node scripts/sheet-weapons.mjs out.png
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const out = process.argv[2] ?? 'weapons.png';
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
    const KIND = { ranged: '원거리', melee: '근접', charge: '차지', beam: '광선' };
    const order = { legendary: 0, epic: 1, rare: 2, common: 3 };
    const list = defs.Weapons.all().sort((a, b) => order[a.rarity] - order[b.rarity] || a.name.localeCompare(b.name));
    const cols = 4, cellW = 309, cellH = 128;
    const rows = Math.ceil(list.length / cols);
    const W = 1280;
    const H = 80 + rows * cellH + 20;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#14111b'; c.fillRect(0, 0, W, H);
    const counts = list.reduce((m, d) => ((m[d.rarity] = (m[d.rarity] ?? 0) + 1), m), {});
    c.fillStyle = '#ffe0a0'; c.font = "bold 30px 'Galmuri11'";
    c.fillText(`등불지기 — 무기 (${list.length}종)`, 24, 48);
    c.fillStyle = '#8a7f9a'; c.font = "12px 'Galmuri11'";
    c.fillText(['legendary', 'epic', 'rare', 'common'].map((r) => `${defs.RARITY_NAME[r]} ${counts[r] ?? 0}`).join('  ·  '), 420, 46);
    const RC = defs.RARITY_COLOR, RN = defs.RARITY_NAME;
    const wrap = (txt, maxW) => {
      const out = []; let line = '';
      for (const ch of txt) { if (c.measureText(line + ch).width > maxW) { out.push(line); line = ch; } else line += ch; }
      if (line) out.push(line); return out;
    };
    const draw = (name, cx, cy, sc) => {
      if (!sp.hasSprite(name)) return;
      const s = sp.getSprite(name);
      c.drawImage(s.canvas, Math.round(cx - (s.w * sc) / 2), Math.round(cy - (s.h * sc) / 2), s.w * sc, s.h * sc);
    };
    list.forEach((d, i) => {
      const x = 14 + (i % cols) * (cellW + 4);
      const y = 70 + Math.floor(i / cols) * cellH;
      c.fillStyle = '#ffffff0b'; c.fillRect(x, y, cellW, cellH - 8);
      c.fillStyle = RC[d.rarity]; c.fillRect(x, y, 3, cellH - 8);
      c.fillStyle = RC[d.rarity] + '22';
      c.beginPath(); c.arc(x + 34, y + 34, 27, 0, Math.PI * 2); c.fill();
      draw(d.icon, x + 34, y + 34, 3);
      if (d.heldSprite) {
        const s = sp.getSprite(d.heldSprite);
        const sc = Math.min(3, Math.floor(56 / Math.max(s.w, s.h)) || 1);
        c.fillStyle = '#00000040'; c.fillRect(x + cellW - 74, y + 6, 68, 56);
        draw(d.heldSprite, x + cellW - 40, y + 34, Math.max(1, sc));
      }
      c.fillStyle = RC[d.rarity]; c.font = "bold 14px 'Galmuri11'";
      c.fillText(d.name, x + 70, y + 22);
      c.fillStyle = '#8a7f9a'; c.font = "10px 'Galmuri11'";
      c.fillText(`${RN[d.rarity]} · ${d.archetype ?? KIND[d.kind] ?? d.kind}`, x + 70, y + 38);
      c.fillStyle = '#5a5070';
      c.fillText(d.id, x + 70, y + 52);
      c.fillStyle = '#d8d0c8'; c.font = "10px 'Galmuri11'";
      wrap(d.desc, cellW - 16).slice(0, 4).forEach((l, k) => c.fillText(l, x + 10, y + 76 + k * 12));
    });
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    cv.style.display = 'block';
    document.body.appendChild(cv);
    return H;
  });
  await page.setViewportSize({ width: 1280, height: h });
  await page.screenshot({ path: out });
  console.log('wrote', out);
} finally {
  await browser.close();
  server.kill();
}
