// Phase timing of World.draw with forced flushes: node phase.mjs <url>
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5391/';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(url);
await page.waitForFunction(() => !!window.__lk, null, { timeout: 30000 });
await page.waitForTimeout(500);
const res = await page.evaluate(async () => {
  const lk = window.__lk;
  lk.start('PROF-2', lk.list().characters[0]);
  await new Promise((r) => setTimeout(r, 700));
  const W = lk.world();
  lk.god(true);
  const P = (await import('/src/game/projectile.ts')).Projectile;
  const pool = ['slime', 'bat', 'skeleton', 'spider'].filter((x) => lk.list().enemies.includes(x));
  const ens = pool.length ? pool : lk.list().enemies.slice(0, 5);
  for (let i = 0; i < 20; i++) lk.spawn(ens[i % ens.length], W.room.centerX + Math.cos(i) * 120, W.room.centerY + Math.sin(i * 1.3) * 60);
  for (let i = 0; i < 60; i++) W.update(1 / 60);
  const scen = {};
  const run = (name, perFrame) => {
    const r = W.renderer;
    const flush = () => r.ctx.getImageData(0, 0, 1, 1);
    const ph = {};
    const add = (k, v) => { ph[k] = (ph[k] ?? 0) + v; };
    const N = 120;
    for (let i = 0; i < N; i++) {
      perFrame?.(i);
      W.update(1 / 60);
      let t = performance.now();
      const lap = (k) => { flush(); const n = performance.now(); add(k, n - t); t = n; };
      r.beginWorld('#06040a');
      W.room.drawBackground(r); lap('bg');
      W.particles.draw(r, true); lap('pGround');
      const sorted = W.entities.filter((e) => !e.dead || e === W.player);
      for (const e of sorted) if (e.layer === 0) e.draw(r, W);
      W.room.drawDoors(r, W.time); lap('l0+doors');
      const mid = sorted.filter((e) => e.layer === 1).sort((a, b) => a.sortY - b.sortY);
      for (const e of mid) e.draw(r, W); lap('l1');
      W.particles.draw(r, false); lap('particles');
      for (const e of sorted) if (e.layer === 2) e.draw(r, W); lap('l2');
      W.lights.begin(r, W.room.theme.ambient);
      for (const e of sorted) e.light(W);
      W.drawParticleLights();
      W.lights.ctx.getImageData(0, 0, 1, 1); lap('lightmap');
      W.lights.apply(); lap('lightApply');
      for (const e of sorted) if (e.layer === 3) e.draw(r, W);
      W.drawVignette(); lap('l3+vignette');
      r.presentWorld(); r.dctx.getImageData(0, 0, 1, 1); lap('present');
    }
    for (const k in ph) ph[k] = +(ph[k] / N).toFixed(2);
    ph.total = +Object.values(ph).reduce((a, b) => a + b, 0).toFixed(2);
    const s = lk.state();
    ph.counts = `${s.entities}e ${s.projectiles}pr ${s.particles}pa`;
    scen[name] = ph;
  };
  run('normal');
  run('bullets', (i) => { if (W.projectiles.length < 400) for (let k = 0; k < 12; k++) W.spawn(new P({ team: 'enemy', x: W.room.centerX, y: W.room.centerY - 40, angle: (k / 12) * 6.283 + i * 0.1, speed: 70, damage: 1 })); });
  for (const p of W.projectiles) p.dead = true;
  run('particles', () => { for (let k = 0; k < 6; k++) W.particles.burst(W.room.centerX + (k - 3) * 30, W.room.centerY, { count: 70, speed: [40, 200], life: [0.6, 1.4], colors: ['#ffffff', '#ffd080', '#ff6020'], size: [1, 3], additive: k % 2 === 0, light: k === 0 ? 6 : 0, gravity: k % 3 === 0 ? 200 : 0, vz: [20, 80], shape: k === 5 ? 'spark' : 'pixel' }); });
  return scen;
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
