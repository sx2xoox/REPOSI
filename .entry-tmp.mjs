// Room-entry hitch benchmark: node entry.mjs <url>
// Walks through every door of several rooms (first visits) and measures the
// time of goThroughDoor + the first rendered frame (= the slide's first frame).
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5391/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(url);
await page.waitForFunction(() => !!window.__lk, null, { timeout: 30000 });
await page.waitForTimeout(400);
const res = await page.evaluate(async () => {
  const lk = window.__lk;
  const out = { '1x1': [], '2x1': [], '1x2': [], '2x2': [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const seed of ['ENTRY-1', 'ENTRY-2', 'ENTRY-3', 'ENTRY-4']) {
    lk.start(seed, lk.list().characters[0]);
    await wait(500);
    for (let floor = 1; floor <= 3; floor++) {
      const W = lk.world();
      lk.god(true);
      // walk a chain of first visits: from the current room through its first unvisited door
      for (let hop = 0; hop < 6; hop++) {
        const d = W.room.doors.find((x) => x.state !== 'hidden' && !W.map.nodes[x.to].visited && W.map.nodes[x.to].kind !== 'secret');
        if (!d) break;
        lk.killAll();
        W.node.cleared = true;
        W.room.setDoorsClosed(false);
        for (const dd of W.room.doors) if (dd.state === 'locked') dd.state = 'open';
        // idle: let the game run (and pre-render) as a player standing in the room would
        await wait(1200);
        const target = W.map.nodes[d.to];
        const key = `${target.cw}x${target.ch}`;
        const t0 = performance.now();
        W.goThroughDoor(d);
        W.draw();
        W.renderer.presentWorld();
        W.renderer.dctx.getImageData(0, 0, 1, 1);
        const t1 = performance.now();
        out[key]?.push(+(t1 - t0).toFixed(2));
        await wait(400);
      }
      W.descend();
      await wait(1300);
    }
  }
  const summ = {};
  for (const [k, v] of Object.entries(out)) {
    if (!v.length) continue;
    const s = [...v].sort((a, b) => a - b);
    summ[k] = { n: v.length, mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), p50: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
  }
  return summ;
});
console.log(JSON.stringify(res));
await browser.close();
