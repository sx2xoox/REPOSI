// Online co-op browser end-to-end test: 2–4 game pages over BroadcastChannel
// (`?net=bc`). The first page creates a room through the title menu, the
// others join with the share link, pick characters and ready up, the host
// starts. Then every page's bot plays its own keeper (moves, shoots, dashes,
// walks through doors) for ~60 s while the script takes screenshots of each
// page (HUD + teammate panels + name tags, a downed ghost being revived, the
// "연결 대기 중…" overlay while the host stalls, the co-op pause menu, a phone
// layout) and finally checks: no desync on any page, identical state hashes
// at every tick all pages reported, every page still running, no console errors.
//
// Usage: node scripts/coop-e2e.mjs [--players 3] [--seconds 60] [--out dir] [--url http://localhost:5173/]
// Exit code 1 on any failed check. Ports: 5550–5599 (dev server).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] ?? true]] : acc), []),
);
const players = Math.min(4, Math.max(2, Number(args.players ?? 3)));
const mode = String(args.mode ?? 'bc');
const seconds = Math.max(20, Number(args.seconds ?? 60));
const out = String(args.out ?? 'screenshots/coop-e2e');
mkdirSync(out, { recursive: true });

const report = { ok: true, checks: [], errors: [], pages: [] };
const check = (name, ok, info = '') => {
  report.checks.push({ name, ok: !!ok, info });
  if (!ok) report.ok = false;
  console.log(`[check] ${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- dev server
let vite = null;
let url = args.url;
if (!url) {
  const { createServer } = await import('vite');
  const port = 5550 + Math.floor(Math.random() * 40);
  vite = await createServer({ server: { port, strictPort: true, hmr: false }, logLevel: 'warn' });
  await vite.listen();
  url = `http://localhost:${port}/`;
}

let peerServer = null;
let query = '?net=bc';
if (mode === 'peerjs') {
  const { PeerServer } = await import('peer');
  const port = 5550 + Math.floor(Math.random() * 40);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PeerServer timeout')), 10000);
    peerServer = PeerServer({ host: '127.0.0.1', port, path: '/lk' }, (srv) => {
      peerServer.http = srv; clearTimeout(timer); resolve();
    });
  });
  query = '?net=peerjs&peerHost=127.0.0.1&peerPort=' + port + '&peerPath=/lk&peerSecure=0&ice=none';
} else if (mode === 'public') query = '?net=peerjs';

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? undefined, args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
// BroadcastChannel only reaches pages of one storage partition: one context for everyone
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

async function newPlayer(label, nick, query, o = {}) {
  const partition = mode === 'bc' ? ctx : await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await partition.newPage();
  if (o.viewport) await page.setViewportSize(o.viewport);
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(`[${label}] ${m.text()}`);
  });
  page.on('pageerror', (e) => report.errors.push(`[${label}] ${e.message}`));
  // per-page settings (the context shares localStorage: written right before this page boots)
  await page.addInitScript(([n, touch]) => {
    window.__lkAutoBless = true;
    try {
      const s = JSON.parse(localStorage.getItem('lanternkeeper.settings.v1') ?? '{}');
      localStorage.setItem('lanternkeeper.settings.v1', JSON.stringify({ ...s, nickname: n, touchControls: touch ? 'on' : 'off' }));
    } catch {
      // ignore
    }
  }, [nick, !!o.touch]);
  await page.goto(url + query);
  await page.waitForFunction(() => !!window.__lknet && !!window.__lk, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  return { page, label, nick, phone: !!o.touch };
}

const lobbyState = (p) => p.page.evaluate(() => window.__lknet.state());
const coopState = (p) => p.page.evaluate(() => window.__lk.coop.state());
async function until(p, fn, what, timeout = 20000, get = lobbyState) {
  const end = Date.now() + timeout;
  let s = null;
  while (Date.now() < end) {
    s = await get(p);
    if (fn(s)) return s;
    await wait(100);
  }
  throw new Error(`${p.label}: timed out waiting for ${what} (state ${JSON.stringify(s).slice(0, 300)})`);
}
async function key(p, k, times = 1) {
  for (let i = 0; i < times; i++) {
    await p.page.keyboard.press(k, { delay: 100 });
    await wait(120);
  }
}
const shot = async (p, name) => {
  const path = join(out, `${p.label}-${name}.png`);
  await p.page.screenshot({ path });
  return path;
};

/** In-page bot: aim + shoot at the nearest enemy, strafe, dash now and then; when the room is clear, walk to a door. */
async function startBot(p, seed) {
  await p.page.evaluate((seed) => {
    let r = seed >>> 0;
    const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    let strafe = 1;
    let strafeT = 0;
    let door = null;
    let doorRoom = -1;
    window.__coopBot = setInterval(() => {
      const w = window.__lk.world();
      const inp = window.__lk.input;
      if (!w || !w.local || window.__coopBotOff) return;
      const p = w.local;
      strafeT -= 0.05;
      if (strafeT <= 0) {
        strafe = rand() < 0.5 ? -1 : 1;
        strafeT = 0.5 + rand();
      }
      let best = null;
      let bd = Infinity;
      for (const e of w.enemies) {
        if (!e.alive || e.hidden) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (best) {
        const ux = (best.x - p.x) / (bd || 1);
        const uy = (best.y - p.y) / (bd || 1);
        const want = bd < 50 ? -1 : bd > 110 ? 1 : 0;
        let mx = ux * want - uy * strafe;
        let my = uy * want + ux * strafe;
        const l = Math.hypot(mx, my) || 1;
        inp.touchMove = { x: mx / l, y: my / l };
        inp.touchAim = { x: ux, y: uy };
        if (rand() < 0.02) inp.touchTap('dash');
        return;
      }
      inp.touchAim = null;
      if (!w.node.cleared) {
        inp.touchMove = { x: Math.cos(w.time), y: Math.sin(w.time * 0.7) };
        return;
      }
      if (doorRoom !== w.node.id || !door || door.state !== 'open') {
        const open = w.room.doors.filter((d) => d.state === 'open');
        const fresh = open.filter((d) => !w.map.nodes[d.to].visited);
        const pool = fresh.length ? fresh : open;
        door = pool.length ? pool[Math.floor(rand() * pool.length)] : null;
        doorRoom = w.node.id;
      }
      if (!door) return;
      const dx = door.x - p.x;
      const dy = door.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      inp.touchMove = { x: dx / d, y: dy / d };
    }, 50);
  }, seed);
}

// ---------------------------------------------------------------- scenario
const names = ['방장', '둘째', '셋째', '넷째'];
let pages = [];
const hold = (on) => Promise.all(pages.map((p) => p.page.evaluate((on) => {
    window.__coopBotOff = on;
    if (on) {
      window.__lk.input.touchMove = { x: 0, y: 0 };
      window.__lk.input.touchAim = null;
    }
  }, on)));
try {
  const host = await newPlayer('p0', names[0], query);
  await key(host, 'ArrowDown');
  await key(host, 'Enter');
  await until(host, (s) => s.scene === 'lobby' && s.screen === 'main', 'lobby main');
  await wait(300);
  await key(host, 'Enter');
  const hs = await until(host, (s) => s.screen === 'room' && !!s.code, 'room created');
  const code = hs.code;
  check(`host created room ${code}`, /^[A-HJKMNP-Z2-9]{4}$/.test(code));
  const guests = [];
  for (let i = 1; i < players; i++) {
    // the last guest plays on a phone-sized touch layout
    const phone = i === players - 1;
    const g = await newPlayer(`p${i}`, names[i], `${query}&room=${code}`, phone ? { viewport: { width: 844, height: 390 }, touch: true } : {});
    await until(g, (s) => s.scene === 'lobby' && s.modal === 'code', 'prefilled code box');
    await key(g, 'Enter');
    await until(g, (s) => s.screen === 'room' && s.localSlot === i, `joined as slot ${i}`, 25000);
    guests.push(g);
  }
  pages = [host, ...guests];
  await until(host, (s) => s.roster.length === players, `${players} players in the roster`);
  for (const [i, g] of guests.entries()) {
    await key(g, 'ArrowRight', i + 1);
    await key(g, 'Enter');
  }
  await until(host, (s) => s.canStart, 'everyone ready');
  await shot(host, 'lobby');
  await key(host, 'Enter');
  for (const p of pages) await until(p, (s) => !!s && s.state === 'running', 'co-op run started', 25000, coopState);
  const s0 = await Promise.all(pages.map(coopState));
  check('every page runs the same party', s0.every((s) => JSON.stringify(s.players.map((q) => [q.slot, q.ch])) === JSON.stringify(s0[0].players.map((q) => [q.slot, q.ch]))), JSON.stringify(s0[0].players.map((q) => q.ch)));
  check('each page controls its own keeper', s0.every((s, i) => s.local === i), s0.map((s) => s.local).join(','));
  // bots are invulnerable (a lockstep debug command, so it is the same on every peer) and start playing
  for (const p of pages) await p.page.evaluate(() => window.__lk.coop.cmd({ type: 'debug', op: 'god' }));
  for (const [i, p] of pages.entries()) await startBot(p, 1234 + i * 77);

  const t0 = Date.now();
  const at = async (sec) => {
    const ms = t0 + sec * 1000 - Date.now();
    if (ms > 0) await wait(ms);
  };
  // ---- HUD, teammate panels, name tags
  await at(6);
  for (const p of pages) await shot(p, 'hud');
  // ---- a downed ghost: slot 1 goes down (debug command), its teammates see the ghost + toast
  await hold(true);
  await pages[0].page.waitForFunction(() => !window.__lk.world().transitioning);
  await pages[0].page.evaluate(() => window.__lk.coop.cmd({ type: 'debug', op: 'room', kind: 'start' }));
  await wait(1200);
  await pages[0].page.waitForFunction(() => !window.__lk.world().transitioning);
  await pages[1].page.evaluate(() => window.__lk.coop.cmd({ type: 'debug', op: 'down' }));
  const ds = await until(pages[0], (s) => s.players.find(q => q.slot === 1)?.downed, 'downed keeper', 10000, coopState);
  for (const p of pages) await shot(p, 'downed');
  check('slot 1 is downed on the host', ds.players.find((q) => q.slot === 1)?.downed === true, JSON.stringify(ds.players.map((q) => q.downed)));
  // the host walks over to revive (its bot pauses; the teammates keep fighting)
  await pages[0].page.evaluate(() => { window.__coopBotOff = true; });
  const reviveEnd = Date.now() + 9000;
  let revived = false;
  while (Date.now() < reviveEnd && !revived) {
    revived = await pages[0].page.evaluate(() => {
      const w = window.__lk.world();
      const me = w.local;
      const v = w.players.find((q) => q.slot === 1);
      const inp = window.__lk.input;
      inp.touchAim = null;
      if (!v || !v.downed) {
        inp.touchMove = { x: 0, y: 0 };
        return true;
      }
      const dx = v.x - me.x;
      const dy = v.y - me.y;
      const d = Math.hypot(dx, dy);
      inp.touchMove = d > 8 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
      return false;
    });
    if (!revived && Date.now() > reviveEnd - 7000 && !report.reviveShot) {
      report.reviveShot = await shot(pages[0], 'reviving');
    }
    await wait(100);
  }
  check('downed keeper revived by a teammate standing close', revived);
  await hold(false);
  for (const p of pages) await shot(p, 'revived');
  // ---- the co-op pause menu (the world keeps running behind it)
  const g1 = pages[1];
  const tickBefore = (await coopState(g1)).tick;
  await g1.page.keyboard.press('Escape');
  await wait(1200);
  await shot(g1, 'pause');
  const tickAfter = (await coopState(g1)).tick;
  check('the world keeps running under the pause menu', tickAfter > tickBefore + 30, `${tickBefore} -> ${tickAfter}`);
  await g1.page.keyboard.press('Escape');
  await wait(400);
  // ---- the host stalls: clients show "연결 대기 중…"
  await pages[0].page.evaluate(() => { window.__lkLoop.manual = true; });
  await wait(1500);
  const waiting = await coopState(pages[1]);
  await shot(pages[1], 'waiting');
  if (players > 2) await shot(pages[players - 1], 'waiting');
  check('clients wait for a stalled host', waiting.waiting === true);
  await pages[0].page.evaluate(() => { window.__lkLoop.manual = false; });
  await wait(1500);
  // ---- a treasure room: one pedestal per keeper (bots hold still meanwhile)
  await hold(true);
  await pages[0].page.evaluate(() => window.__lk.coop.cmd({ type: 'debug', op: 'room', kind: 'treasure' }));
  await wait(1600);
  const tr = await pages[0].page.evaluate(() => {
    const w = window.__lk.world();
    return { room: w.node.kind, peds: w.entities.filter((e) => e.item && typeof e.group === 'number').length };
  });
  for (const p of pages) await shot(p, 'treasure');
  check('a treasure room offers a pedestal per keeper', tr.room === 'treasure' && tr.peds >= players, `${tr.room}: ${tr.peds} pedestals`);
  await hold(false);
  // ---- play on
  await at(seconds);
  for (const p of pages) await shot(p, 'end');
  for (const p of pages) await p.page.evaluate(() => clearInterval(window.__coopBot));
  await wait(1500);

  // ---- verdict: no desync, identical hashes on every tick all pages reported
  const states = await Promise.all(pages.map(coopState));
  const hashes = await Promise.all(pages.map((p) => p.page.evaluate(() => window.__lk.coop.hashes())));
  report.pages = states;
  check('no desync on any page', states.every((s) => s.state === 'running' && !s.desync), states.map((s) => `${s.state}${s.desync ? ` @${s.desync.tick}` : ''}`).join(' '));
  const maps = hashes.map((h) => new Map(h));
  const ticks = [...maps[0].keys()].filter((t) => maps.every((m) => m.has(t)));
  const same = ticks.filter((t) => maps.every((m) => m.get(t) === maps[0].get(t)));
  check('state hashes identical on every page', states[0].tick >= 1200 && ticks.length >= Math.floor(Math.min(...states.map((s) => s.tick)) / 60) - 1 && same.length === ticks.length, `${same.length}/${ticks.length} common hashed ticks equal (last tick ${Math.max(...ticks)})`);
  check('every page simulated about the same number of frames', states.every((s) => s.tick > states[0].tick * 0.95), states.map((s) => s.tick).join(' '));
  report.hashTicks = ticks.length;
  report.lastTick = Math.max(...ticks);

  // ---- the host ends the descent from the pause menu (하강 종료: a command), everyone sees the party summary
  await hold(true);
  await host.page.waitForFunction(() => !window.__lk.world().transitioning);
  await key(host, 'Escape');
  await wait(500);
  await key(host, 'ArrowDown', 2);
  await key(host, 'Enter', 2);
  for (const p of pages) await until(p, (s) => !!s?.gameOver, 'party summary', 10000, coopState);
  await wait(2200);
  for (const p of pages) await shot(p, 'summary');
  check('the host ended the run for everyone', true);
  // ---- back to the lobby together (same room, same code, everyone rejoins)
  await key(host, 'Enter');
  for (const p of pages) await until(p, (s) => s.scene === 'lobby' && s.screen === 'room' && s.code === code, 'back in the lobby room', 20000);
  const back = await until(host, (s) => s.roster.length === players, 'everyone back in the roster', 20000);
  await shot(host, 'lobby-again');
  if (players > 2) await shot(pages[players - 1], 'lobby-again');
  check('the whole party is back in the same lobby room', back.code === code && back.roster.length === players, `${back.code} ${back.roster.length} players`);
  // Start a second run on the retained connections, then test disconnects.
  for (const g of guests) await key(g, 'Enter');
  await until(host, (s) => s.canStart, 'ready for a second run');
  await key(host, 'Enter');
  for (const p of pages) await until(p, (s) => s?.state === 'running', 'second co-op run', 25000, coopState);
  check('same connections start a second co-op run', true);
  if (players > 2) {
    await pages[players - 1].page.close();
    for (const p of pages.slice(0, -1)) await until(p, (s) => s.players.length === players - 1, 'guest leaves party', 20000, coopState);
    await wait(1600);
    const remaining = await Promise.all(pages.slice(0, -1).map(coopState));
    check('remaining players continue after a guest leaves', remaining.every(s => s.state === 'running' && !s.desync));
  }
  await host.page.close();
  await until(pages[1], (s) => s.state === 'ended', 'host disconnect notice', 20000, coopState);
  await shot(pages[1], 'host-disconnected');
  check('host disconnect ends the session with notice', true);

} catch (e) {
  report.ok = false;
  report.errors.push(String(e?.stack ?? e));
  console.error(e);
  for (const p of pages) await shot(p, 'failure').catch(() => undefined);
}

const ignorable = (s) => /WebSocket|ERR_CONNECTION_REFUSED|favicon/i.test(s);
const errs = report.errors.filter((e) => !ignorable(e));
check('no console errors', errs.length === 0, errs.slice(0, 5).join(' | ').slice(0, 600));
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
if (vite) await vite.close();
if (peerServer?.http) await new Promise((resolve) => peerServer.http.close(resolve));
console.log(report.ok ? 'coop e2e: ok' : 'coop e2e: FAILED');
process.exit(report.ok ? 0 : 1);
