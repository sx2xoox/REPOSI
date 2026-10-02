// Online co-op end-to-end test: opens 2–4 game pages, creates a room on the
// first (through the title menu), joins the others with the share link
// (?room=CODE → prefilled code box → Enter), picks characters, readies, starts,
// and asserts every page reached the run with the same seed and its own pick.
// Then it drives the lockstep layer over the real transport for a few seconds
// (window.__lknet.probe) and checks every peer saw the identical frame stream.
// Also checks: clipboard copy of the code, a 5th player is rejected ("full"),
// a join after the start is rejected ("started").
//
// Transports:
//   bc      ?net=bc — BroadcastChannel between tabs of one browser context
//   peerjs  WebRTC through PeerJS against a local PeerServer (`peer` devDependency,
//           started here), each player in its own browser context
//
// Usage: node scripts/net-e2e.mjs [--players 3] [--mode bc|peerjs|all] [--out dir] [--url http://localhost:5173/]
// Exit code 1 on any failed check. Ports: 5150–5189 (dev server), 5190–5198 (PeerServer).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] ?? true]] : acc), []),
);
const players = Math.min(4, Math.max(2, Number(args.players ?? 3)));
const mode = String(args.mode ?? 'all');
const out = String(args.out ?? 'screenshots/net-e2e');
mkdirSync(out, { recursive: true });

const report = { ok: true, checks: [], errors: [] };
const check = (name, ok, info = '') => {
  report.checks.push({ name, ok: !!ok, info });
  if (!ok) report.ok = false;
  console.log(`[check] ${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- servers
let vite = null;
let url = args.url;
if (!url) {
  // dev server without HMR / file watching (edits elsewhere must not reload the pages)
  const { createServer } = await import('vite');
  const port = 5150 + Math.floor(Math.random() * 40);
  vite = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'warn' });
  await vite.listen();
  url = `http://localhost:${port}/`;
}

let peerServer = null;
let peerPort = 0;
async function startPeerServer() {
  const { PeerServer } = await import('peer');
  peerPort = 5190 + Math.floor(Math.random() * 9);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('PeerServer did not start')), 10000);
    peerServer = PeerServer({ host: '127.0.0.1', port: peerPort, path: '/lk', allow_discovery: false }, (srv) => {
      clearTimeout(t);
      peerServer.http = srv;
      resolve();
    });
  });
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? undefined,
  // raw host candidates (no mDNS .local names) so WebRTC connects inside the container
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'],
});

// ---------------------------------------------------------------- page helpers
async function newPlayer(ctx, label, nick, query) {
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(`[${label}] ${m.text()}`);
  });
  page.on('pageerror', (e) => report.errors.push(`[${label}] ${e.message}`));
  await page.addInitScript(([n]) => {
    window.__lkAutoBless = true;
    try {
      const s = JSON.parse(localStorage.getItem('lanternkeeper.settings.v1') ?? '{}');
      localStorage.setItem('lanternkeeper.settings.v1', JSON.stringify({ ...s, nickname: n }));
    } catch {
      // ignore
    }
  }, [nick]);
  await page.goto(url + query);
  await page.waitForFunction(() => !!window.__lknet && !!window.__lk, null, { timeout: 30000 });
  await page.waitForTimeout(700);
  return { page, label, nick };
}

const state = (p) => p.page.evaluate(() => window.__lknet.state());
async function until(p, fn, what, timeout = 15000) {
  const end = Date.now() + timeout;
  let s = null;
  while (Date.now() < end) {
    s = await state(p);
    if (fn(s)) return s;
    await wait(100);
  }
  throw new Error(`${p.label}: timed out waiting for ${what} (state ${JSON.stringify(s).slice(0, 300)})`);
}
async function key(p, k, times = 1) {
  for (let i = 0; i < times; i++) {
    await p.page.keyboard.press(k);
    await wait(120);
  }
}

// ---------------------------------------------------------------- scenario
async function scenario(kind) {
  const q = kind === 'bc' ? '?net=bc' : `?peerHost=127.0.0.1&peerPort=${peerPort}&peerPath=/lk&ice=none`;
  // bc: one context (BroadcastChannel is per storage partition); peerjs: one context per player
  const shared = kind === 'bc' ? await browser.newContext({ viewport: { width: 1280, height: 720 } }) : null;
  const ctxs = [];
  const ctxFor = async () => {
    if (shared) return shared;
    const c = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    ctxs.push(c);
    return c;
  };
  const names = ['방장', '둘째', '셋째', '넷째', '다섯째'];
  const host = await newPlayer(await ctxFor(), `${kind}-p0`, names[0], q);
  try {
    await (shared ?? ctxs[0]).grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  } catch {
    // clipboard permissions are optional
  }
  // title → 함께하기 → 방 만들기 (keyboard, like a player)
  await key(host, 'ArrowDown');
  await key(host, 'Enter');
  await until(host, (s) => s.scene === 'lobby' && s.screen === 'main', 'lobby main');
  await wait(400);
  await key(host, 'Enter');
  const hs = await until(host, (s) => s.screen === 'room' && !!s.code, 'room created', 20000);
  const code = hs.code;
  check(`${kind}: host created room ${code}`, /^[A-HJKMNP-Z2-9]{4}$/.test(code));
  await host.page.screenshot({ path: join(out, `${kind}-host-room.png`) });

  // copy button (mouse click → clipboard)
  if (kind === 'bc') {
    await host.page.mouse.click(905, 62); // the 복사 button at 1280x720
    await wait(300);
    const clip = await host.page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check(`${kind}: copy button puts the code on the clipboard`, clip === code, `clipboard "${clip}"`);
  }

  // friends join through the share link (?room=CODE → code box → Enter)
  const guests = [];
  for (let i = 1; i < players; i++) {
    const g = await newPlayer(await ctxFor(), `${kind}-p${i}`, names[i], `${q}&room=${code}`);
    await until(g, (s) => s.scene === 'lobby' && s.modal === 'code', 'prefilled code box');
    await key(g, 'Enter');
    await until(g, (s) => s.screen === 'room' && s.localSlot === i, `joined as slot ${i}`, 25000);
    guests.push(g);
  }
  await until(host, (s) => s.roster.length === players, `${players} players in the roster`);
  check(`${kind}: ${players} players in the room`, true);

  // a fifth player is turned away when the room is full
  if (players === 4) {
    const extra = await newPlayer(await ctxFor(), `${kind}-p4`, names[4], q);
    await extra.page.evaluate((c) => { window.__lknet.open(); return window.__lknet.join(c); }, code);
    const es = await until(extra, (s) => s.screen === 'error', 'rejection', 25000);
    check(`${kind}: fifth player rejected as full`, es.error?.code === 'full', es.error?.title);
    await extra.page.screenshot({ path: join(out, `${kind}-full.png`) });
    await extra.page.close();
  }

  // pick characters (→ on odd slots) and ready up (Enter)
  for (const [i, g] of guests.entries()) {
    if (i % 2 === 0) await key(g, 'ArrowRight');
    await wait(150);
    await key(g, 'Enter');
  }
  const ready = await until(host, (s) => s.canStart, 'everyone ready', 15000);
  const picks = Object.fromEntries(ready.roster.map((p) => [p.slot, p.characterId]));
  check(`${kind}: guests picked characters`, new Set(Object.values(picks)).size >= Math.min(2, players), JSON.stringify(picks));
  await host.page.screenshot({ path: join(out, `${kind}-all-ready.png`) });
  for (const g of guests) await g.page.screenshot({ path: join(out, `${kind}-${g.label}-room.png`) });

  // host starts
  await key(host, 'Enter');
  const everyone = [host, ...guests];
  for (const p of everyone) {
    await p.page.waitForFunction(() => !!window.__lk.world?.(), null, { timeout: 20000 });
  }
  await wait(800);
  const runs = [];
  for (const p of everyone) {
    runs.push(await p.page.evaluate(() => ({ start: window.__lknet.lastStart(), seed: window.__lk.world()?.run?.seed, ch: window.__lk.world()?.run?.characterId })));
  }
  const seed = runs[0].start?.seed;
  check(`${kind}: every page got the same StartInfo seed`, !!seed && runs.every((r) => r.start?.seed === seed), runs.map((r) => r.start?.seed).join(' '));
  check(`${kind}: every page reached the run with that seed`, runs.every((r) => r.seed === seed), runs.map((r) => r.seed).join(' '));
  check(`${kind}: each page runs its own pick`, runs.every((r, i) => r.ch === picks[i]), runs.map((r) => r.ch).join(' '));
  for (const p of everyone) await p.page.screenshot({ path: join(out, `${kind}-${p.label}-run.png`) });

  // late joiner → "started"
  const late = await newPlayer(await ctxFor(), `${kind}-late`, '지각생', q);
  await late.page.evaluate((c) => { window.__lknet.open(); return window.__lknet.join(c); }, code);
  const ls = await until(late, (s) => s.screen === 'error', 'late rejection', 25000);
  check(`${kind}: join after start rejected`, ls.error?.code === 'started', ls.error?.title);
  await late.page.close();

  // lockstep over the real transport: identical frame streams on every peer
  const probes = await Promise.all(everyone.map((p) => p.page.evaluate(() => window.__lknet.probe(240))));
  const d0 = probes[0].digest;
  check(`${kind}: lockstep frames identical on all peers`, probes.every((r) => r.frames === 240 && r.digest === d0), probes.map((r) => `${r.role}:${r.digest.toString(16)}`).join(' '));
  const cmds = JSON.stringify(probes[0].commands);
  check(`${kind}: commands applied on the same ticks everywhere`, probes[0].commands.length === players && probes.every((r) => JSON.stringify(r.commands) === cmds), cmds);
  const clientStats = probes.filter((r) => r.role === 'client').map((r) => `underruns ${r.underruns} catchUps ${r.catchUps} buffer ${r.target} rtt ${r.rtt}`);
  console.log(`[info] ${kind}: ${clientStats.join(' | ')}`);
  report[kind] = { code, seed, picks, probes };

  for (const c of ctxs) await c.close();
  if (shared) await shared.close();
}

// ---------------------------------------------------------------- run
try {
  if (mode === 'bc' || mode === 'all') await scenario('bc');
  if (mode === 'peerjs' || mode === 'all') {
    await startPeerServer();
    await scenario('peerjs');
  }
} catch (e) {
  report.ok = false;
  report.errors.push(String(e?.stack ?? e));
  console.error(e);
}
const ignorable = (s) => /WebSocket|ERR_CONNECTION_REFUSED|favicon/i.test(s);
const errs = report.errors.filter((e) => !ignorable(e));
check('no console errors', errs.length === 0, errs.slice(0, 5).join(' | ').slice(0, 600));
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
if (vite) await vite.close();
if (peerServer?.http) peerServer.http.close();
console.log(report.ok ? 'net e2e: ok' : 'net e2e: FAILED');
process.exit(report.ok ? 0 : 1);
