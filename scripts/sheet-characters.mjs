// Renders a sprite sheet PNG of every playable character (all poses, 6x). Usage: node scripts/sheet-characters.mjs out.png
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const port = 5600 + Math.floor(Math.random() * 300);
const server = spawn('node_modules/.bin/vite', ['--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite timeout')), 30000); server.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message)); page.on('console', (m) => console.log('console', m.type(), m.text().slice(0,200))); console.log('vite up', port);
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__lk, null, { timeout: 30000 });
await page.waitForTimeout(500);
await page.evaluate(async () => {
  const sp = await import('/src/engine/sprites.ts');
  const defs = await import('/src/game/defs.ts');
  const chars = defs.Characters.all();
  const S = 6; // scale
  const colW = 150, rowH = 200;
  const cv = document.createElement('canvas');
  cv.width = 1280; cv.height = 140 + chars.length * rowH;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  const g = c.createLinearGradient(0, 0, 0, cv.height);
  g.addColorStop(0, '#1b1724'); g.addColorStop(1, '#0d0a12');
  c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#ffe0a0'; c.font = "bold 34px 'Galmuri11'"; c.fillText('등불지기 — 플레이어 캐릭터', 30, 52);
  c.fillStyle = '#8a7f9a'; c.font = "16px 'Galmuri11'";
  const cols = ['idle_down', 'walk_down', 'idle_side', 'walk_side', 'idle_up', 'walk_up', 'dash', 'hurt'];
  const labels = ['정면', '정면 걷기', '측면', '측면 걷기', '뒷면', '뒷면 걷기', '대시', '피격'];
  labels.forEach((l, i) => c.fillText(l, 300 + i * 120 - 10, 100));
  const draw = (name, cx, cy) => {
    const frame = sp.hasAnim(name) ? sp.animFrame(name, 0.15) : name;
    if (!sp.hasSprite(frame)) return false;
    const s = sp.getSprite(frame);
    c.drawImage(s.canvas, Math.round(cx - s.ox * S), Math.round(cy - s.oy * S), s.w * S, s.h * S);
    return true;
  };
  chars.forEach((ch, r) => {
    const y = 140 + r * rowH;
    c.fillStyle = '#ffffff10'; c.fillRect(20, y, 1240, rowH - 16);
    c.fillStyle = ch.color; c.font = "bold 24px 'Galmuri11'"; c.fillText(ch.name, 40, y + 40);
    c.fillStyle = '#c8bcd8'; c.font = "15px 'Galmuri11'"; c.fillText(ch.title, 40, y + 66);
    c.fillStyle = '#8a7f9a'; c.fillText(ch.unlocked ? '기본 해금' : '해금 필요', 40, y + 90);
    const wdef = defs.Weapons.get(ch.weapon);
    if (wdef) { c.fillStyle = '#ffd080'; c.fillText('무기: ' + wdef.name, 40, y + 114); }
    c.fillText('체력 ' + '♥'.repeat(ch.hearts), 40, y + 138);
    // portrait
    draw(ch.portrait, 230, y + 120);
    cols.forEach((k, i) => draw(`${ch.spritePrefix}_${k}`, 300 + i * 120 + 40, y + 160));
  });
  document.body.innerHTML = '';
  document.body.style.background = '#000';
  cv.style.display = 'block';
  document.body.appendChild(cv);
});
await page.setViewportSize({ width: 1280, height: await page.evaluate(() => document.querySelector('canvas').height) });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
server.kill('SIGTERM');
process.exit(0);
