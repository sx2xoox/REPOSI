// Profiling harness: node prof.mjs <url> <label>
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5391/';
const label = process.argv[3] ?? 'run';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => !!window.__lk, null, { timeout: 30000 });
await page.waitForTimeout(500);

const out = {};

// ---- A: room background render cost (cold) per shape, floors 1..5
out.bg = await page.evaluate(async () => {
  const lk = window.__lk;
  lk.start('PROF-1', lk.list().characters[0]);
  await new Promise((r) => setTimeout(r, 600));
  const ra = await import('/src/game/roomart.ts');
  const res = {};
  for (let f = 1; f <= 5; f++) {
    const w = lk.world();
    for (const n of w.map.nodes) {
      const key = `${n.cw}x${n.ch}`;
      const room = w.buildRoom(n);
      const t0 = performance.now();
      const c = ra.renderRoomBackground(room);
      c.getContext('2d').getImageData(0, 0, 1, 1);
      const t1 = performance.now();
      (res[key] ??= []).push(t1 - t0);
    }
    if (f < 5) { w.descend(); await new Promise((r) => setTimeout(r, 1200)); }
  }
  const summ = {};
  for (const [k, v] of Object.entries(res)) {
    v.sort((a, b) => a - b);
    summ[k] = { n: v.length, mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), max: +v[v.length - 1].toFixed(2) };
  }
  return summ;
});

// frame measurement helper (runs inside page)
const measure = async (frames, setup) => page.evaluate(async ([frames, setup]) => {
  const lk = window.__lk;
  const w = lk.world();
  // eslint-disable-next-line no-new-func
  if (setup) await (new Function('lk', 'w', `return (async () => { ${setup} })()`))(lk, w);
  const W = lk.world();
  const r = W.renderer;
  const up = [], dr = [], tot = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    W.update(1 / 60);
    const t1 = performance.now();
    W.draw();
    r.presentWorld();
    r.dctx.getImageData(0, 0, 1, 1);
    const t2 = performance.now();
    up.push(t1 - t0); dr.push(t2 - t1); tot.push(t2 - t0);
    if (W.__perFrame) W.__perFrame(i);
  }
  const st = (a) => { const s = [...a].sort((x, y) => x - y); return { mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
  const s = lk.state();
  return { update: st(up), draw: st(dr), total: st(tot), enemies: s.enemies, projectiles: s.projectiles, particles: s.particles, entities: s.entities };
}, [frames, setup]);

// ---- B: 2x2 room with 20 enemies, 15 artifacts, firing
out.stress2x2 = await measure(300, `
  lk.start('PROF-2', lk.list().characters[0]);
  await new Promise((r) => setTimeout(r, 700));
  let W = lk.world();
  lk.god(true);
  const big = W.map.nodes.find((n) => n.cw === 2 && n.ch === 2 && n.kind === 'normal') || W.map.nodes.find((n) => n.cw * n.ch > 1);
  W.teleportTo(big);
  await new Promise((r) => setTimeout(r, 800));
  W = lk.world();
  const arts = lk.list().artifacts.filter((a) => !/curse|reroll/.test(a));
  for (let i = 0; i < 18; i++) lk.give(arts[(i * 7) % arts.length]);
  const ens = ['slime', 'bat', 'skeleton', 'spider'].filter((x) => lk.list().enemies.includes(x));
  const pool = ens.length ? ens : lk.list().enemies.filter((id) => !/boss|final|queen|colossus|smith|imugi|saint|commander|keeper|mother/.test(id)).slice(0, 6);
  for (let i = 0; i < 20; i++) lk.spawn(pool[i % pool.length], W.room.centerX + Math.cos(i) * 120, W.room.centerY + Math.sin(i * 1.3) * 60);
  W.player.ember = 0;
  window.__heldFire = true;
  const inp = (await import('/src/engine/input.ts')).input;
  inp.simulateDown('ArrowUp');
  for (let i = 0; i < 90; i++) W.update(1 / 60);
`);

// ---- C: max particles
out.particles = await measure(200, `
  const W = lk.world();
  W.__perFrame = (i) => { for (let k = 0; k < 6; k++) W.particles.burst(W.room.centerX + (k - 3) * 30, W.room.centerY, { count: 70, speed: [40, 200], life: [0.6, 1.4], colors: ['#ffffff', '#ffd080', '#ff6020'], size: [1, 3], additive: k % 2 === 0, light: k === 0 ? 6 : 0, gravity: k % 3 === 0 ? 200 : 0, vz: [20, 80], shape: k === 5 ? 'spark' : 'pixel' }); };
`);

// ---- D: many enemy projectiles (bullet hell)
out.bullets = await measure(200, `
  const W = lk.world();
  W.__perFrame = undefined;
  W.particles.clear();
  const P = (await import('/src/game/projectile.ts')).Projectile;
  W.__perFrame = (i) => { if (W.projectiles.length < 400) for (let k = 0; k < 12; k++) W.spawn(new P({ team: 'enemy', x: W.room.centerX, y: W.room.centerY - 40, angle: (k / 12) * 6.283 + i * 0.1, speed: 70, damage: 1 })); };
`);

// ---- E: floor 5 final boss
out.finalBoss = await measure(400, `
  const W0 = lk.world();
  W0.__perFrame = undefined;
  lk.start('PROF-3', lk.list().characters[1] ?? lk.list().characters[0]);
  await new Promise((r) => setTimeout(r, 700));
  for (let f = 0; f < 4; f++) { lk.world().descend(); await new Promise((r) => setTimeout(r, 1300)); }
  lk.god(true);
  const arts = lk.list().artifacts;
  for (let i = 0; i < 15; i++) lk.give(arts[(i * 5) % arts.length]);
  lk.gotoRoom('boss');
  await new Promise((r) => setTimeout(r, 4500));
  const inp = (await import('/src/engine/input.ts')).input;
  inp.simulateDown('ArrowUp');
`);
out.errors = errs.slice(0, 10);
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${process.argv[4] ?? '.'}/prof-${label}.json`, JSON.stringify(out, null, 1));
await browser.close();
