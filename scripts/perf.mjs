// Repeatable performance harness: builds the game (vite build into a temp dir,
// or uses --url / --dist), serves it with `vite preview`, and plays a set of
// heavy scenarios in headless Chromium through `window.__lk`, recording per
// frame CPU time of the simulation (update) and of drawing separately
// (`window.__lkPerf`, see src/engine/perfmon.ts), long frames, JS heap growth
// and GC (heap-size drops sampled every frame + V8 GC trace events).
//
// Headless Chromium here has no GPU, so absolute numbers are pessimistic:
// compare runs (before / after) rather than reading them as device timings.
//
// Usage:
//   node scripts/perf.mjs [--out dir] [--label name] [--seconds 6]
//        [--only room25,boss] [--dist prebuilt-dir | --url http://...]
//        [--port 4950] [--flush] [--fps 120] [--compare other-results.json]
//   --flush   also time a forced raster flush (1px readback) after each draw
//   --fps N   frame-rate cap setting for the run (60 / 120 / 0 = display max)
//   --hz N    emulate an N Hz display: frames are driven at exact N Hz slot
//             times (headless rAF is 60 Hz); needs a build with __lkLoop
//   --profile unminified build + CPU profile and allocation sampling per
//             scenario (top self-time functions / allocation sites written to
//             <out>/<label>-<scenario>-profile.txt)
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), []),
);
const label = args.label ?? 'run';
const out = resolve(args.out ?? join(tmpdir(), 'lk-perf'));
const seconds = Number(args.seconds ?? 6);
const only = args.only ? String(args.only).split(',') : null;
const flush = !!args.flush;
const fpsCap = args.fps !== undefined ? Number(args.fps) : undefined;
const profile = !!args.profile;
const hz = args.hz ? Number(args.hz) : 0;
mkdirSync(out, { recursive: true });

// ------------------------------------------------------------------ build + serve
let server = null;
let url = args.url;
if (!url) {
  let dist = args.dist ? resolve(args.dist) : null;
  if (!dist) {
    dist = join(out, `dist-${label}`);
    console.log(`[perf] building into ${dist}`);
    const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error', ...(profile ? ['--minify', 'false'] : [])], { stdio: 'inherit' });
    if (b.status !== 0) process.exit(1);
  }
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`no build in ${dist}`);
  const port = Number(args.port ?? 4900 + Math.floor(Math.random() * 100));
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { stdio: 'pipe' });
  url = `http://localhost:${port}/`;
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite preview did not start')), 30000);
    const on = (d) => {
      if (String(d).includes('Local')) {
        clearTimeout(t);
        res();
      }
    };
    server.stdout.on('data', on);
    server.stderr.on('data', (d) => process.stderr.write(d));
  });
}

// ------------------------------------------------------------------ scenarios
const DESKTOP = { viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 }; // MacBook Pro 14" class
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }; // iPhone 14 class, landscape

const CHARS = ['bern', 'niel', 'ria', 'serin'];

/** in-page helpers (stringified into the page) */
const PAGE_HELPERS = () => {
  const lk = window.__lk;
  const w = () => lk.world();
  window.__perfBot = {
    timers: [],
    stop() {
      for (const t of this.timers) clearInterval(t);
      this.timers = [];
      lk.input.releaseAll?.();
    },
    /** hold fire, rotating the direction; occasionally dash / sway */
    shoot() {
      const dirs = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
      let i = 0;
      lk.input.simulateDown(dirs[0]);
      this.timers.push(setInterval(() => {
        lk.input.simulateUp(dirs[i % 4]);
        i++;
        lk.input.simulateDown(dirs[i % 4]);
      }, 450));
      const moves = ['KeyA', 'KeyD'];
      let m = 0;
      this.timers.push(setInterval(() => {
        const k = moves[m++ % 2];
        lk.input.simulateDown(k);
        setTimeout(() => lk.input.simulateUp(k), 180);
        // keep the keeper near the room center (never walks through a door)
        const p = w()?.player;
        const r = w()?.room;
        if (p && r && Math.hypot(p.x - r.centerX, p.y - r.centerY) > 60) {
          p.x = r.centerX;
          p.y = r.centerY;
        }
      }, 700));
    },
    /** keep `n` floor-pool enemies alive in the room */
    keepEnemies(n, pool) {
      const top = () => {
        const W = w();
        if (!W) return;
        const ids = pool ?? Object.keys(W.enemyPool());
        let k = 0;
        while (W.enemies.length + k < n) {
          const id = ids[(Math.random() * ids.length) | 0];
          const a = Math.random() * Math.PI * 2;
          const d = 50 + Math.random() * 70;
          lk.spawn(id, W.room.centerX + Math.cos(a) * d * 1.4, W.room.centerY + Math.sin(a) * d * 0.6);
          k++;
        }
      };
      top();
      this.timers.push(setInterval(top, 400));
    },
    /** fill the ember gauge and release (F) every `every` seconds */
    releases(every) {
      const go = () => {
        const W = w();
        if (!W) return;
        W.player.ember = 100;
        lk.press('KeyF', 2);
      };
      setTimeout(go, 300);
      this.timers.push(setInterval(go, every * 1000));
    },
    /** stop the rAF driver and run frames at exact `hz` slot times (an N Hz display) */
    drive(hz) {
      const loop = window.__lkLoop;
      if (!loop) return false;
      loop.manual = true;
      const iv = 1000 / hz;
      let next = performance.now() + iv;
      loop.pacer.reset(next - iv);
      const tick = () => {
        const now = performance.now();
        if (now >= next) {
          // late: skip the missed refreshes like a real display (one frame, at the latest slot)
          const k = Math.floor((now - next) / iv);
          next += k * iv;
          loop.frame(next);
          next += iv;
        }
        setTimeout(tick, Math.max(0, Math.min(4, next - performance.now() - 0.5)));
      };
      setTimeout(tick, 0);
      return true;
    },
    /** explosions + bursts all over the room */
    explosions(everyMs) {
      this.timers.push(setInterval(() => {
        const W = w();
        if (!W) return;
        const x = W.room.centerX + (Math.random() - 0.5) * 220;
        const y = W.room.centerY + (Math.random() - 0.5) * 100;
        W.explode(x, y, 30, 0, { byPlayer: true, noTiles: true });
        W.particles.burst(x, y, { count: 40, speed: [30, 160], life: [0.4, 1.2], colors: ['#fff6c0', '#ffb040', '#c04018'], size: [1, 3], additive: true, light: 6, gravity: 200, vz: [40, 140], shape: 'square', vrot: 6 });
      }, everyMs));
    },
  };
};

const scenarios = [
  { name: 'room25', ctx: DESKTOP, char: 'bern', setup: `__perfBot.keepEnemies(25); __perfBot.shoot();` },
  { name: 'boss', ctx: DESKTOP, char: 'bern', room: 'boss', setup: `__perfBot.shoot();` },
  { name: 'boss-void', ctx: DESKTOP, char: 'bern', setup: `__lk.spawn('void_moth'); __perfBot.shoot();` },
  ...CHARS.map((c) => ({ name: `release-${c}`, ctx: DESKTOP, char: c, setup: `__perfBot.keepEnemies(18); __perfBot.shoot(); __perfBot.releases(3.2);` })),
  { name: 'particles', ctx: DESKTOP, char: 'bern', setup: `__perfBot.keepEnemies(8); __perfBot.shoot(); __perfBot.explosions(110);` },
  { name: 'phone-room25-high', ctx: PHONE, char: 'bern', quality: 'high', setup: `__perfBot.keepEnemies(25); __perfBot.shoot();` },
  { name: 'phone-release-high', ctx: PHONE, char: 'ria', quality: 'high', setup: `__perfBot.keepEnemies(18); __perfBot.shoot(); __perfBot.releases(3.2);` },
  { name: 'phone-room25-medium', ctx: PHONE, char: 'bern', quality: 'medium', setup: `__perfBot.keepEnemies(25); __perfBot.shoot();` },
].filter((s) => !only || only.includes(s.name));

// ------------------------------------------------------------------ stats
const q = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};
const r2 = (v) => Math.round(v * 100) / 100;
const dist = (arr) => ({ p50: r2(q(arr, 0.5)), p95: r2(q(arr, 0.95)), p99: r2(q(arr, 0.99)), max: r2(arr.length ? Math.max(...arr) : 0), mean: r2(arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length)) });

function analyse(rec, gcEvents, heapBefore, heapAfter, secs) {
  const n = rec.upd.length;
  const updPerStep = [];
  const frame = [];
  for (let i = 0; i < n; i++) {
    if (rec.steps[i] > 0) updPerStep.push(rec.upd[i] / rec.steps[i]);
    frame.push(rec.upd[i] + rec.drw[i] + rec.fls[i]);
  }
  // heap sampled per frame: drops are collections, rises are allocations
  let alloc = 0;
  let drops = 0;
  for (let i = 1; i < n; i++) {
    const d = rec.heap[i] - rec.heap[i - 1];
    if (d > 0) alloc += d;
    else if (d < -32 * 1024) drops++;
  }
  const gaps = rec.gap.slice(1);
  const minor = gcEvents.filter((e) => e.kind === 'minor');
  const major = gcEvents.filter((e) => e.kind === 'major');
  return {
    frames: n,
    fps: r2(n / secs),
    steps: rec.steps.reduce((a, b) => a + b, 0),
    update: dist(rec.upd),
    updatePerStep: dist(updPerStep),
    draw: dist(rec.drw),
    flush: flush ? dist(rec.fls) : undefined,
    frame: dist(frame),
    long8: frame.filter((v) => v > 8.33).length,
    long16: frame.filter((v) => v > 16.7).length,
    hitches: gaps.filter((g) => g > 40).length,
    allocMBps: r2(alloc / 1048576 / secs),
    allocKBperFrame: r2(alloc / 1024 / Math.max(1, n)),
    heapDrops: drops,
    gcMinor: minor.length,
    gcMinorMs: r2(minor.reduce((a, e) => a + e.ms, 0)),
    gcMajor: major.length,
    gcMajorMs: r2(major.reduce((a, e) => a + e.ms, 0)),
    gcMaxMs: r2(Math.max(0, ...gcEvents.map((e) => e.ms))),
    heapGrowthKB: r2((heapAfter - heapBefore) / 1024),
  };
}

function gcFromTrace(buf) {
  const out = [];
  try {
    const j = JSON.parse(buf.toString());
    const evs = j.traceEvents ?? j;
    for (const e of evs) {
      if (e.ph !== 'X' && e.ph !== 'B') continue;
      if (e.name === 'MinorGC' || e.name === 'MinorGCs' || e.name === 'V8.GC_SCAVENGER' || e.name === 'V8.GC_MINOR_MARK_SWEEPER') out.push({ kind: 'minor', ms: (e.dur ?? 0) / 1000, name: e.name });
      else if (e.name === 'MajorGC' || e.name === 'V8.GC_MARK_COMPACTOR') out.push({ kind: 'major', ms: (e.dur ?? 0) / 1000, name: e.name });
    }
  } catch {
    // no trace
  }
  // the same collection can show up under two names: keep one family
  const fam = out.some((e) => e.name === 'MinorGC' || e.name === 'MajorGC') ? new Set(['MinorGC', 'MajorGC']) : null;
  return fam ? out.filter((e) => fam.has(e.name)) : out;
}

function topSelf(prof, n = 30) {
  const self = new Map();
  const byId = new Map(prof.nodes.map((nd) => [nd.id, nd]));
  const dt = new Map();
  for (let i = 0; i < prof.samples.length; i++) dt.set(prof.samples[i], (dt.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i] ?? 0));
  let total = 0;
  for (const [id, us] of dt) {
    const nd = byId.get(id);
    const cf = nd.callFrame;
    const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + us);
    total += us;
  }
  // inclusive time per function (a function counted once per sample even when recursive)
  const parent = new Map();
  for (const nd of prof.nodes) for (const c of nd.children ?? []) parent.set(c, nd.id);
  const keyOf = (nd) => `${nd.callFrame.functionName || '(anon)'} ${nd.callFrame.url.split('/').pop()}:${nd.callFrame.lineNumber + 1}`;
  const incl = new Map();
  for (const [id, us] of dt) {
    const seen = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const k = keyOf(byId.get(cur));
      if (seen.has(k)) continue;
      seen.add(k);
      incl.set(k, (incl.get(k) ?? 0) + us);
    }
  }
  const fmt = ([k, us]) => `${(us / 1000).toFixed(1).padStart(8)} ms  ${((us / total) * 100).toFixed(1).padStart(5)}%  ${k}`;
  return {
    total: total / 1000,
    rows: [...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(fmt),
    incl: [...incl].filter(([k]) => !k.startsWith('(')).sort((a, b) => b[1] - a[1]).slice(0, 45).map(fmt),
  };
}

function topAlloc(prof, n = 25) {
  const m = new Map();
  let total = 0;
  const walk = (nd, stack) => {
    const cf = nd.callFrame;
    const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
    const parent = stack;
    if (nd.selfSize) {
      const k = `${key}  <- ${parent}`;
      m.set(k, (m.get(k) ?? 0) + nd.selfSize);
      total += nd.selfSize;
    }
    for (const c of nd.children ?? []) walk(c, key);
  };
  walk(prof.head, '');
  return { total, rows: [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, b]) => `${(b / 1024).toFixed(0).padStart(8)} KB  ${((b / total) * 100).toFixed(1).padStart(5)}%  ${k}`) };
}

// ------------------------------------------------------------------ run
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
const results = { label, url, date: new Date().toISOString(), seconds, flush, fpsCap, hz, scenarios: {} };
let failed = false;
for (const sc of scenarios) {
  const context = await browser.newContext({ ...sc.ctx, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(([quality, cap]) => {
    window.__lkAutoBless = true;
    try {
      const k = 'lanternkeeper.settings.v1';
      const s = JSON.parse(localStorage.getItem(k) || '{}');
      if (quality) s.graphicsQuality = quality;
      if (cap !== undefined && cap !== null) s.maxFps = cap;
      s.musicVolume = 0;
      s.sfxVolume = 0;
      localStorage.setItem(k, JSON.stringify(s));
    } catch {}
  }, [sc.quality ?? 'high', fpsCap ?? null]);
  try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__lk && !!window.__lkPerf, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.evaluate(PAGE_HELPERS);
    if (hz && !(await page.evaluate((h) => window.__perfBot.drive(h), hz))) console.warn('[perf] --hz needs a build with __lkLoop: using rAF');
    await page.evaluate(([c]) => window.__lk.start('PERF-0001', c), [sc.char]);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__lk.god(true));
    if (sc.room) {
      await page.evaluate((k) => window.__lk.gotoRoom(k), sc.room);
      await page.waitForTimeout(2600);
    }
    await page.evaluate(sc.setup);
    await page.waitForTimeout(1000); // warm-up
    const cdp = await context.newCDPSession(page);
    await page.evaluate(() => { window.__lkPerf.start(30000); window.__lkPerf.stop(); }); // allocate the buffers first
    await cdp.send('HeapProfiler.collectGarbage');
    const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    if (profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    } else await browser.startTracing(page, { categories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.gc'] });
    await page.evaluate((f) => window.__lkPerf.start(30000, f), flush);
    const t0 = Date.now();
    await page.waitForTimeout(seconds * 1000);
    const rec = await page.evaluate(() => window.__lkPerf.stop());
    const secs = (Date.now() - t0) / 1000;
    let trace = Buffer.from('{}');
    if (profile) {
      const { profile: cpu } = await cdp.send('Profiler.stop');
      const { profile: heap } = await cdp.send('HeapProfiler.stopSampling');
      const a = topSelf(cpu);
      const b = topAlloc(heap);
      writeFileSync(join(out, `${label}-${sc.name}-profile.txt`), `CPU self time (total ${a.total.toFixed(0)} ms)\n${a.rows.join('\n')}\n\nCPU inclusive time\n${a.incl.join('\n')}\n\nAllocations (total ${(b.total / 1048576).toFixed(1)} MB)\n${b.rows.join('\n')}\n`);
    } else trace = await browser.stopTracing();
    await page.evaluate(() => window.__perfBot.stop());
    const info = await page.evaluate(() => {
      const w = window.__lk.world();
      return { enemies: w.enemies.length, particles: w.particles.list.length, entities: w.entities.length, room: w.node.kind, canvas: [document.getElementById('game').width, document.getElementById('game').height] };
    });
    await cdp.send('HeapProfiler.collectGarbage');
    const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const res = analyse(rec, gcFromTrace(trace), heapBefore, heapAfter, secs);
    res.info = info;
    res.errors = errors.slice(0, 5);
    await page.screenshot({ path: join(out, `${label}-${sc.name}.png`) });
    results.scenarios[sc.name] = res;
    console.log(`[perf] ${sc.name.padEnd(20)} fps ${String(res.fps).padStart(6)}  upd/step p50 ${res.updatePerStep.p50} p95 ${res.updatePerStep.p95}  draw p50 ${res.draw.p50} p95 ${res.draw.p95} p99 ${res.draw.p99} max ${res.draw.max}${flush ? `  flush p50 ${res.flush.p50} p95 ${res.flush.p95}` : ''}  frame p95 ${res.frame.p95}  >8ms ${res.long8}  alloc ${res.allocMBps} MB/s  gc ${res.gcMinor}/${res.gcMajor} (${res.gcMinorMs + res.gcMajorMs} ms)  heap +${res.heapGrowthKB} KB${errors.length ? `  ERRORS ${errors.length}` : ''}`);
    if (errors.length) failed = true;
  } catch (e) {
    console.error(`[perf] ${sc.name} failed`, e);
    results.scenarios[sc.name] = { error: String(e?.stack ?? e) };
    failed = true;
  }
  await context.close();
}
await browser.close();
if (server) server.kill();

const file = join(out, `perf-${label}.json`);
writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`[perf] wrote ${file}`);

// ------------------------------------------------------------------ compare
if (args.compare && existsSync(args.compare)) {
  const before = JSON.parse(readFileSync(args.compare, 'utf8'));
  const rows = [['scenario', 'upd/step p50', 'upd/step p95', 'draw p50', 'draw p95', 'draw p99', 'frame p95', '>8.3ms', 'alloc MB/s', 'GC (minor/major)']];
  const f = (a, b) => `${a} -> ${b}`;
  for (const [name, b] of Object.entries(results.scenarios)) {
    const a = before.scenarios?.[name];
    if (!a || a.error || b.error) continue;
    rows.push([name, f(a.updatePerStep.p50, b.updatePerStep.p50), f(a.updatePerStep.p95, b.updatePerStep.p95), f(a.draw.p50, b.draw.p50), f(a.draw.p95, b.draw.p95), f(a.draw.p99, b.draw.p99), f(a.frame.p95, b.frame.p95), f(`${a.long8}/${a.frames}`, `${b.long8}/${b.frames}`), f(a.allocMBps, b.allocMBps), f(`${a.gcMinor}/${a.gcMajor}`, `${b.gcMinor}/${b.gcMajor}`)]);
  }
  console.log(rows.map((r) => `| ${r.join(' | ')} |`).join('\n'));
}
process.exit(failed ? 1 : 0);
