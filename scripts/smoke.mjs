// Headless smoke test: boots the game in Chromium, starts a seeded run, plays
// with a simple bot (move + shoot), visits special rooms, and captures
// screenshots + console errors. Usage:
//   node scripts/smoke.mjs [--url http://localhost:5173] [--out screenshots] [--seconds 20]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] ?? true]] : acc), []),
);
const out = args.out ?? 'screenshots';
const seconds = Number(args.seconds ?? 20);
const character = args.character ?? undefined;
const seed = args.seed ?? 'SMOKE-0001';
mkdirSync(out, { recursive: true });

let server = null;
let url = args.url;
if (!url) {
  const port = 5199 + Math.floor(Math.random() * 300);
  server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
  url = `http://localhost:${port}/`;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start')), 30000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('Local')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// the floor-start blessing choice ("등불의 축복") auto-picks the first card for the bot
await page.addInitScript(() => { window.__lkAutoBless = true; });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

const report = { ok: true, errors: [], states: [] };
try {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__lk, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/00-title.png` });
  await page.evaluate(([s, c]) => window.__lk.start(s, c), [seed, character]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/01-start-room.png` });
  report.states.push(await page.evaluate(() => window.__lk.state()));
  await page.evaluate(() => window.__lk.god(true));

  // bot: walk through doors, shoot at enemies
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const shoot = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  const end = Date.now() + seconds * 1000;
  let shot = 2;
  while (Date.now() < end) {
    const k = keys[Math.floor(Math.random() * 4)];
    const s = shoot[Math.floor(Math.random() * 4)];
    await page.keyboard.down(k);
    await page.keyboard.down(s);
    await page.waitForTimeout(400 + Math.random() * 500);
    await page.keyboard.up(k);
    await page.keyboard.up(s);
    if (Math.random() < 0.08) await page.keyboard.press('KeyE');
    if (Math.random() < 0.1) await page.keyboard.press('Space');
    if (Math.random() < 0.05) await page.keyboard.press('KeyF');
    if (Math.random() < 0.12) {
      await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-play.png` });
      report.states.push(await page.evaluate(() => window.__lk.state()));
    }
  }
  for (const kind of ['treasure', 'shop', 'boss']) {
    const ok = await page.evaluate((k) => window.__lk.gotoRoom(k), kind);
    await page.waitForTimeout(kind === 'boss' ? 2500 : 900);
    if (ok) await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-${kind}.png` });
    if (kind === 'boss') {
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(3000);
      await page.keyboard.up('ArrowUp');
      await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-boss-fight.png` });
      await page.evaluate(() => window.__lk.killAll());
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-boss-clear.png` });
    }
  }
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-status.png` });
  await page.keyboard.press('Tab');
  report.states.push(await page.evaluate(() => window.__lk.state()));
  report.errors = await page.evaluate(() => window.__lk.errors);
} catch (e) {
  report.ok = false;
  report.errors.push(String(e?.stack ?? e));
}
report.console = logs;
if (report.errors.length || logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'))) report.ok = false;
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, errors: report.errors.slice(0, 10), console: logs.slice(0, 20), last: report.states.at(-1) }, null, 2));
await browser.close();
server?.kill();
process.exit(report.ok ? 0 : 1);
