// Real-browser pattern soak: both phases of every boss, finite state and clean
// death, with screenshots. God mode checks mechanics, not human dodgeability.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'test-results/boss-audit';
mkdirSync(out, { recursive: true });
const bosses = [['bone_colossus',1],['bell_keeper',1],['spore_mother',2],['slime_queen',2],['chain_smith',3],['slag_imugi',3],['frost_commander',4],['frost_saint',4],['mumyeong',5],['grand_archivist',6],['sunken_lighthouse',6],['clockmaker',7],['clockwork_dancer',7]];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const report = { errors: [], bosses: [] };
page.on('pageerror', e => report.errors.push(e.message));
await page.addInitScript(() => { window.__lkAutoBless = true; });
try {
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.__lk && window.__lkLoop);
  await page.evaluate(() => { window.__lkLoop.manual = true; });
  for (const [id, floor] of bosses) {
    await page.evaluate(([id, floor]) => {
      const api = window.__lk;
      api.start(`PATTERN-${id}`, 'ria'); api.god(true); api.gotoFloor(floor); api.gotoRoom('boss'); api.step(300);
      const w = api.world();
      for (const e of w.entities) if (e !== w.player) e.dead = true;
      w.spawnEnemy(id, w.room.centerX, w.room.centerY - 24);
      w.player.x = w.room.centerX; w.player.y = w.room.centerY + 48;
      api.step(1);
    }, [id, floor]);
    const phases = [];
    for (const stage of [0, 1]) {
      phases.push(await page.evaluate(([id, stage]) => {
        const api = window.__lk, w = api.world();
        const boss = w.enemies.find(e => e.def.id === id && e.alive);
        if (!boss) throw new Error(`Missing boss ${id}`);
        boss.hp = boss.maxHp * (stage ? 0.24 : 1);
        const startPhase = boss.phase;
        const states = new Set(); let maxEntities = 0, maxProjectiles = 0;
        for (let frame = 0; frame < 1800; frame++) {
          w.update(1 / 60);
          states.add(boss.anim);
          maxEntities = Math.max(maxEntities, w.entities.length);
          maxProjectiles = Math.max(maxProjectiles, w.projectiles.length);
          for (const e of w.entities) if (![e.x, e.y, e.z].every(Number.isFinite)) throw new Error(`${id}: nonfinite position`);
          if (w.entities.length > 1500) throw new Error(`${id}: entity runaway`);
        }
        api.step(1);
        return { stage, startPhase, phase: boss.phase, states: [...states], maxEntities, maxProjectiles, errors: api.errors.slice() };
      }, [id, stage]));
      await page.screenshot({ path: `${out}/${id}-${stage}.png` });
    }
    const died = await page.evaluate(id => {
      const api = window.__lk, w = api.world(), boss = w.enemies.find(e => e.def.id === id && e.alive);
      if (!boss) return false;
      w.killEnemy(boss); api.step(240);
      return !w.enemies.some(e => e.def.id === id && e.alive);
    }, id);
    const ok = died && phases[1].phase > phases[0].phase && phases.every(p => p.errors.length === 0);
    report.bosses.push({ id, floor, phases, died, ok });
    console.log(id, ok ? 'OK' : 'FAIL', JSON.stringify(phases.map(p => ({ phase: p.phase, entities: p.maxEntities, bullets: p.maxProjectiles }))));
  }
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
if (report.errors.length || report.bosses.some(b => !b.ok)) process.exitCode = 1;
