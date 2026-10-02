// QA bot: plays full runs (floor 1 -> last floor -> victory) on a production build and
// records errors, soft-locks, NaN positions, entity counts and frame costs, plus
// balance metrics (damage taken, room / boss fight times, release share; printed
// as a per-floor table and written to balance.json).
//
//   node scripts/qa-run.mjs --out qa-out [--dist dist] [--build] [--suite full|quick|checks|balance]
//        [--char ria[,bern]] [--seed S] [--god 1|0] [--immortal] [--chaos] [--parallel 3] [--turbo 4] [--audio]
//
// `--immortal` (and the `balance` suite, `--seeds N`): the keeper takes real hits but
// is topped up instead of dying, so every floor gets measured ("wouldDie" counts).
//
// The bot runs inside the page (window.__bot) and drives `__lk.input.touchMove /
// touchAim / touchTap` (analog move + aim), stepping the simulation with
// `__lk.step()` for a turbo factor. It only falls back to teleport / killAll when
// it has made no progress for 20 s in a room, and records that as a soft-lock.
import { chromium } from 'playwright';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), []),
);
const out = resolve(args.out ?? 'qa-out');
const dist = resolve(args.dist ?? join(out, 'dist'));
const parallel = Number(args.parallel ?? 3);
const turbo = Number(args.turbo ?? 4);
const suite = args.suite ?? (args.char ? 'custom' : 'full');
const maxGameMin = Number(args['max-min'] ?? 45);
const maxWallMin = Number(args['wall-min'] ?? 40);
mkdirSync(out, { recursive: true });

// ------------------------------------------------------------------ build + static server
if (args.build || !existsSync(join(dist, 'index.html'))) {
  console.log(`[qa] building to ${dist}`);
  const r = spawnSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(1);
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(dist, p);
  if (!f.startsWith(dist) || !existsSync(f) || !statSync(f).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(Number(args.port ?? 0), '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(`[qa] serving ${dist} at ${url}`);

// ------------------------------------------------------------------ run specs
function specs() {
  if (suite === 'custom') {
    const imm = !!args.immortal;
    return String(args.char).split(',').map((c) => ({ name: `${c}-${args.seed ?? 'S1'}${args.chaos ? '-chaos' : ''}${imm ? '-immortal' : args.god === '0' ? '-mortal' : ''}`, character: c, seed: String(args.seed ?? 'QA-S1'), god: !imm && args.god !== '0', immortal: imm, chaos: !!args.chaos }));
  }
  if (suite === 'balance') {
    // balance measurement: every character, `--seeds` seeds, real hits but never dies (see botMain `immortal`)
    const list = [];
    for (let n = 1; n <= Number(args.seeds ?? 1); n++) for (const c of ['ria', 'bern', 'serin', 'niel']) list.push({ name: `${c}-bal-${n}`, character: c, seed: `QA-BAL-${c.toUpperCase()}-${n}`, god: false, immortal: true });
    return list;
  }
  if (suite === 'quick') return [{ name: 'ria-quick', character: 'ria', seed: 'QA-QUICK', god: true }];
  if (suite === 'checks' || suite === 'sweep') return [];
  const list = [];
  for (const c of ['ria', 'bern', 'serin', 'niel']) {
    for (const n of [1, 2]) list.push({ name: `${c}-god-${n}`, character: c, seed: `QA-${c.toUpperCase()}-${n}`, god: true });
  }
  const mortal = Number(args.mortal ?? 3);
  for (let n = 1; n <= mortal; n++) {
    list.push({ name: `ria-mortal-${n}`, character: 'ria', seed: `QA-MORTAL-RIA-${n}`, god: false });
    list.push({ name: `bern-mortal-${n}`, character: 'bern', seed: `QA-MORTAL-BERN-${n}`, god: false });
  }
  const chars = ['ria', 'bern', 'serin', 'niel'];
  for (let n = 1; n <= Number(args.chaos ?? 3); n++) list.push({ name: `chaos-${n}`, character: chars[(n + Math.floor(Math.random() * 4)) % 4], seed: `QA-CHAOS-${n}`, god: true, chaos: true });
  return list;
}

// ------------------------------------------------------------------ in-page bot
/* eslint-disable */
function botMain(opts) {
  const lk = window.__lk;
  const input = lk.input;
  const TILE = 16;
  const DV = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };
  const MELEE = new Set(['great_hammer', 'chain_sickle', 'twin_daggers', 'iron_spear', 'sentinel_blade']);
  const CHARGE = new Set(['hunter_bow']);
  const B = {
    opts, done: false, outcome: null, events: [], shotReq: null, paused: false, stop: false,
    floors: [], samples: [], cost: [], nan: 0, lastDir: { x: 0, y: 0 }, tickN: 0,
    tried: new Map(), failed: new Set(), roomKey: '', roomEnterT: 0, progressT: 0, progressSig: '',
    closedT: -1, wallT: -1, bombPlan: null, secretTried: new Set(), unreach: new Set(), deadT: -1, wonT: -1,
    curFloor: 0, floorStartT: 0, floorWall: 0, chargeT: 0, retreat: null, trapOffT: -1, pausedT: -1, lastSample: -99,
    fallbacks: 0,
  };
  window.__bot = B;
  const W = () => window.__world;
  const ev = (type, data = {}) => {
    const w = W();
    const e = { type, t: w ? +w.time.toFixed(1) : 0, floor: w?.run.floor, room: w?.node.kind, roomId: w?.node.id, template: w?.node.templateId, ...data };
    B.events.push(e);
    return e;
  };
  const hyp = Math.hypot;

  // ---------------------------------------------------------------- balance metrics
  // Per floor: damage taken, player power, release share of damage dealt; per
  // room: clear time vs enemy HP; per boss: fight duration. With `immortal` the
  // keeper takes real hits (invuln frames, shields, dodge) but is topped up
  // instead of dying, so later floors still get measured ("wouldDie" counts it).
  const BAL = (B.bal = { floors: [], rooms: [], bosses: [], wouldDie: 0 });
  const bal = { room: null, boss: null, lastRel: 0, relT: -99, hooked: null };
  const estDps = (s) => Math.max(0, s.damage) * Math.max(0, s.fireRate) * (1 + Math.max(0, s.critChance) * Math.max(0, s.critMult - 1))
    * (1 + Math.max(0, s.shots - 1) * 0.7) * (1 + Math.min(3, Math.max(0, s.pierce)) * 0.12);
  function balFloor(w) {
    let f = BAL.floors.find((x) => x.floor === w.run.floor);
    if (!f) {
      const p = w.player, s = p.stats;
      f = {
        floor: w.run.floor, hpMult: w.floor.hpMult, t0: +w.time.toFixed(1), dps: +estDps(s).toFixed(1), damage: +s.damage.toFixed(1),
        items: p.inv?.items?.length ?? 0, weapon: p.weaponId, maxRed: p.maxRed, red: p.red, soul: p.soul,
        taken: 0, hits: 0, wouldDie: 0, allDmg: 0, relDmg: 0, releases: 0,
      };
      BAL.floors.push(f);
    }
    return f;
  }
  function balHook(w) {
    if (bal.hooked === w) return;
    bal.hooked = w;
    const p = w.player;
    const origHit = w.applyHit.bind(w);
    w.applyHit = (t, h) => {
      const before = t.hp;
      const ok = origHit(t, h);
      if (ok && t !== p && t.team === 'enemy' && h.attacker === p) {
        const dealt = Math.max(0, before - Math.max(0, t.hp));
        const f = balFloor(w);
        const rel = h.noProc && h.kind !== 'status' && w.time - bal.relT < 3.6;
        f.allDmg += dealt;
        if (rel) f.relDmg += dealt;
        if (bal.boss) { bal.boss.allDmg += dealt; if (rel) bal.boss.relDmg += dealt; }
      }
      return ok;
    };
    const origHurt = p.hurt.bind(p);
    p.hurt = (ww, hh, src) => {
      const pre = p.red + p.soul;
      // immortal: refill only when this hit could be lethal (no floor hits for more than 4 half-hearts)
      if (opts.immortal && pre <= 4) { if (p.maxRed > 0) p.red = p.maxRed; else p.soul += 6; }
      const mid = p.red + p.soul;
      const ok = origHurt(ww, hh, src);
      const taken = mid - (p.red + p.soul);
      if (ok && taken > 0) {
        const f = balFloor(w);
        f.taken += taken; f.hits++;
        if (taken >= pre) { f.wouldDie++; BAL.wouldDie++; }
        f.minHp = Math.min(f.minHp ?? 99, Math.max(0, pre - taken));
        if (bal.room && !bal.room.done) bal.room.taken += taken;
        if (bal.boss) bal.boss.taken += taken;
      }
      return ok;
    };
  }
  function balTick(w) {
    if (!w.player) return;
    balHook(w);
    const f = balFloor(w);
    if (w.run.stats.releases !== bal.lastRel) {
      bal.lastRel = w.run.stats.releases; bal.relT = w.time; f.releases++;
      if (bal.boss) bal.boss.releases++;
    }
    const key = `${w.run.floor}:${w.node.id}`;
    if (!bal.room || bal.room.key !== key) {
      bal.room = null;
      if (!w.node.cleared && ['normal', 'challenge', 'boss', 'curse'].includes(w.node.kind)) {
        bal.room = { key, floor: w.run.floor, kind: w.node.kind, t0: w.time, hp: 0, n: 0, seen: new Set(), taken: 0, fb: B.fallbacks };
      }
    }
    const r = bal.room;
    if (r && !r.done) {
      for (const e of w.enemies) {
        if (r.seen.has(e.id)) continue;
        r.seen.add(e.id);
        if (!e.ignoreForClear) { r.hp += e.maxHp; r.n++; }
      }
      if (w.node.cleared) {
        r.done = true;
        BAL.rooms.push({ floor: r.floor, kind: r.kind, dur: +(w.time - r.t0).toFixed(1), hp: Math.round(r.hp), n: r.n, taken: r.taken, fallback: B.fallbacks !== r.fb });
      }
    }
    const bosses = w.bosses;
    if (!bal.boss && bosses.length && !w.bossIntro && bosses.every((b) => b.dormant <= 0)) {
      bal.boss = { floor: w.run.floor, id: bosses[0].def.id, hp: Math.round(bosses.reduce((s, b) => s + b.maxHp, 0)), t0: w.time, taken: 0, allDmg: 0, relDmg: 0, releases: 0, fb: B.fallbacks, red0: w.player.red + w.player.soul };
    }
    if (bal.boss && !bosses.length) {
      const b = bal.boss;
      BAL.bosses.push({ ...b, dur: +(w.time - b.t0).toFixed(1), t0: undefined, fb: undefined, fallback: B.fallbacks !== b.fb, allDmg: Math.round(b.allDmg), relDmg: Math.round(b.relDmg) });
      bal.boss = null;
    }
    f.allDmg = +f.allDmg.toFixed(1);
  }

  function hostiles(w) {
    return w.enemies.filter((e) => !e.dead && !e.ignoreForClear);
  }
  function targets(w) {
    const h = w.enemies.filter((e) => !e.dead && e.vulnerable !== false && !e.hidden && e.hp > 0);
    return h.length ? h : hostiles(w);
  }

  // BFS distance field (4-neighbour) from a goal tile over walkable tiles
  function flow(room, gx, gy, flying, avoidSpikes) {
    const W_ = room.w, H_ = room.h;
    const d = new Int32Array(W_ * H_).fill(-1);
    if (gx < 0 || gy < 0 || gx >= W_ || gy >= H_) return d;
    const q = new Int32Array(W_ * H_);
    let qh = 0, qt = 0;
    d[gy * W_ + gx] = 0;
    q[qt++] = gy * W_ + gx;
    while (qh < qt) {
      const i = q[qh++];
      const x = i % W_, y = (i / W_) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= W_ || ny >= H_) continue;
        const j = ny * W_ + nx;
        if (d[j] >= 0 || room.blocks(nx, ny, flying, false)) continue;
        if (avoidSpikes && room.tileAt(nx, ny) === 5) continue;
        d[j] = d[i] + 1;
        q[qt++] = j;
      }
    }
    return d;
  }

  /** Steering vector toward (gx, gy) following the BFS field; null if unreachable. */
  function navTo(w, gx, gy, avoidSpikes) {
    const p = w.player, room = w.room;
    const ftx = Math.floor(gx / TILE), fty = Math.floor(gy / TILE);
    let f = flow(room, ftx, fty, p.flying, avoidSpikes);
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    let here = f[ty * room.w + tx];
    if (here < 0 && avoidSpikes) {
      f = flow(room, ftx, fty, p.flying, false);
      here = f[ty * room.w + tx];
    }
    if (here === 0 || hyp(gx - p.x, gy - p.y) < 10) return norm(gx - p.x, gy - p.y);
    let best = null, bd = here < 0 ? 1e9 : here;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= room.w || ny >= room.h) continue;
        const v = f[ny * room.w + nx];
        if (v < 0) continue;
        if (dx && dy && (f[ty * room.w + nx] < 0 || f[ny * room.w + tx] < 0)) continue;
        const score = v + (dx && dy ? 0.4 : 0);
        if (score < bd) { bd = score; best = [nx, ny]; }
      }
    }
    if (!best) return here < 0 ? null : norm(gx - p.x, gy - p.y);
    // aim at the tile center, but keep moving along the corridor when already centered
    return norm(best[0] * TILE + 8 - p.x, best[1] * TILE + 8 - p.y);
  }
  function reachable(w, gx, gy) {
    const p = w.player, room = w.room;
    const f = flow(room, Math.floor(gx / TILE), Math.floor(gy / TILE), p.flying, false);
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    if (f[ty * room.w + tx] >= 0) return true;
    // player tile itself may be "blocked" (standing at a doorway edge): check neighbours
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (f[(ty + dy) * room.w + tx + dx] >= 0) return true;
    return false;
  }
  function norm(x, y) {
    const l = hyp(x, y);
    return l < 1e-6 ? { x: 0, y: 0 } : { x: x / l, y: y / l };
  }

  // ---------------------------------------------------------------- combat
  function combat(w, p) {
    const room = w.room;
    const ts = targets(w);
    // shots / beams leave from a little above the feet: need a clear line from both heights
    const losFrom = (x, y, e) => room.lineOfSight(x, y - 4, e.x, e.y) && room.lineOfSight(x, y - 12, e.x, e.y - 6);
    let tgt = null, bd = 1e9;
    const stale = w.time - (B.dmgT ?? 0);
    for (const e of ts) {
      let d = hyp(e.x - p.x, e.y - p.y) - (losFrom(p.x, p.y, e) ? 0 : 60);
      // no damage for a while: rotate through the other targets
      if (stale > 10 && ts.length > 1 && e.id % ts.length === Math.floor(w.time / 4) % ts.length) d -= 400;
      if (d < bd) { bd = d; tgt = e; }
    }
    if (!tgt) return { move: { x: 0, y: 0 }, aim: null };
    // no damage dealt for a while: walk right up to the target instead of kiting
    if (stale > 5 && hyp(tgt.x - p.x, tgt.y - p.y) > 26) {
      const v = navTo(w, tgt.x, tgt.y, !opts.god);
      if (v) return { move: v, aim: tgt, danger: 0 };
    }
    const melee = MELEE.has(p.weaponId);
    const pref = melee ? 18 : Math.max(55, Math.min(95, (p.stats?.range ?? 185) * 0.45));
    const bullets = w.projectiles.filter((b) => b.team === 'enemy' && !b.dead);
    const hazards = w.entities.filter((e) => e.enemyHazard && !e.dead && hyp(e.x - p.x, e.y - p.y) < 90);
    const enemies = w.enemies.filter((e) => !e.dead && e.harmful !== false && hyp(e.x - p.x, e.y - p.y) < 100);
    const spd = Math.max(60, p.stats?.moveSpeed ?? 92);
    const los = losFrom(p.x, p.y, tgt);
    if (!los && hyp(tgt.x - p.x, tgt.y - p.y) > 40) {
      const v = navTo(w, tgt.x, tgt.y, !opts.god);
      if (v) return { move: v, aim: tgt, danger: 0 };
    }
    let best = { x: 0, y: 0 }, bestS = -1e9, stayDanger = 0;
    for (let i = 0; i <= 16; i++) {
      const dx = i === 16 ? 0 : Math.cos((i * Math.PI) / 8), dy = i === 16 ? 0 : Math.sin((i * Math.PI) / 8);
      const cx = p.x + dx * 14, cy = p.y + dy * 14;
      if (i < 16 && (room.boxBlocked(cx, cy, p.r + 1, p.flying, false) || room.boxBlocked(p.x + dx * 7, p.y + dy * 7, p.r + 1, p.flying, false))) continue;
      let s = 0, danger = 0;
      if (!opts.god && room.tileAtPx(cx, cy) === 5) s -= 40;
      const dT = hyp(tgt.x - cx, tgt.y - cy);
      s -= Math.abs(dT - pref) * 0.5;
      for (const b of bullets) {
        if (hyp(b.x - p.x, b.y - p.y) > 120) continue;
        for (let t = 0.05; t <= 0.45; t += 0.05) {
          const px = p.x + dx * spd * t, py = p.y + dy * spd * t;
          const d = hyp(b.x + b.vx * t - px, b.y + b.vy * t - py) - (b.r ?? 3) - p.r;
          if (d < 6) { danger += (6 - d) * (1.2 - t * 2) * 6; break; }
        }
      }
      for (const h of hazards) {
        const d = hyp(h.x - cx, h.y - cy) - (h.r ?? 8) - p.r;
        if (d < 4) danger += (4 - d) * 4;
      }
      for (const e of enemies) {
        if (melee && e === tgt) continue;
        const d = hyp(e.x + (e.vx ?? 0) * 0.3 - cx, e.y + (e.vy ?? 0) * 0.3 - cy) - e.r - p.r;
        if (d < 12) danger += (12 - d) * 3;
      }
      s -= danger;
      if (!losFrom(cx, cy, tgt)) s -= 18;
      s += 4 * (dx * B.lastDir.x + dy * B.lastDir.y);
      let walls = 0;
      for (const [ox, oy] of [[16, 0], [-16, 0], [0, 16], [0, -16]]) if (room.boxBlocked(cx + ox, cy + oy, 2, p.flying, false)) walls++;
      s -= walls * 3;
      if (i === 16) stayDanger = danger;
      if (s > bestS) { bestS = s; best = { x: dx, y: dy }; }
    }
    return { move: best, aim: tgt, danger: stayDanger };
  }

  // ---------------------------------------------------------------- objectives
  function isPickup(e) { return 'potionId' in e && 'grace' in e && typeof e.canCollect === 'function'; }
  function isPedestal(e) { return 'item' in e && 'heartPrice' in e && 'waitForLeave' in e; }
  function isChest(e) { return 'opened' in e && 'locked' in e && !('item' in e); }
  function isTrapdoor(e) { return 'openT' in e && 'armed' in e; }
  function isAltar(e) { return 'wave' in e && 'state' in e && typeof e.state === 'string'; }
  function isBowl(e) { return 'used' in e && 'coolT' in e && (e.kind === 'coin' || e.kind === 'heart'); }

  function lootTargets(w, p) {
    const out = [];
    for (const e of w.entities) {
      if (e.dead || B.failed.has(e.id)) continue;
      if (isPickup(e)) {
        if (e.grace > 0.2 || !e.canCollect(w) || (e.price > 0 && p.coins < e.price)) continue;
        if (e.kind === 'potion' && p.potionId) continue;
        out.push({ e, x: e.x, y: e.y, kind: 'pickup:' + e.kind });
      } else if (isPedestal(e)) {
        if (!e.item || e.waitForLeave || (e.price > 0 && p.coins < e.price) || B.tried.get('ped' + e.id) === 'done') continue;
        if (e.heartPrice > 0 && (!opts.god || p.maxRed < e.heartPrice * 2 + 2)) continue;
        out.push({ e, x: e.x, y: e.y, kind: 'pedestal', ped: true });
      } else if (isChest(e)) {
        if (e.opened || (e.locked && p.keys <= 0)) continue;
        out.push({ e, x: e.x, y: e.y, kind: 'chest' });
      } else if (isAltar(e)) {
        if (e.state !== 'idle') continue;
        out.push({ e, x: e.x, y: e.y - 4, kind: 'altar' });
      } else if (isBowl(e)) {
        if (e.used || (e.kind === 'coin' && p.coins < 15) || (e.kind === 'heart' && !opts.god)) continue;
        out.push({ e, x: e.x, y: e.y, kind: 'bowl:' + e.kind });
      }
    }
    out.sort((a, b) => hyp(a.x - p.x, a.y - p.y) - hyp(b.x - p.x, b.y - p.y));
    return out;
  }

  function revealedDoor(w, nd) {
    return w.room.doors.some((d) => d.to === nd.to && d.dir === nd.dir && d.state !== 'hidden');
  }
  /** BFS over the floor graph: first door (NodeDoor of the current node) toward the best target node. */
  function planHop(w, p, wantBoss) {
    const nodes = w.map.nodes, cur = w.node;
    const prev = new Map([[cur.id, null]]);
    const q = [cur.id];
    const order = [];
    while (q.length) {
      const id = q.shift();
      order.push(id);
      for (const nd of nodes[id].doors) {
        if (prev.has(nd.to)) continue;
        const t = nodes[nd.to];
        if (nd.secret && !(nd.revealed || nodes[id].kind === 'secret' || (id === cur.id && revealedDoor(w, nd)))) continue;
        if (t.locked && p.keys <= 0) continue;
        if (B.failed.has('node' + t.id)) continue;
        // never path *through* the boss room
        if (nodes[id].kind === 'boss' && id !== cur.id) continue;
        prev.set(nd.to, { from: id, nd });
        q.push(nd.to);
      }
    }
    let goal = null;
    if (!wantBoss) goal = order.find((id) => id !== cur.id && !nodes[id].visited && nodes[id].kind !== 'boss');
    if (goal == null) goal = order.find((id) => id !== cur.id && nodes[id].kind !== 'boss' && !nodes[id].cleared && nodes[id].kind === 'challenge');
    if (goal == null) goal = order.find((id) => nodes[id].kind === 'boss' && id !== cur.id);
    if (goal == null) return null;
    let id = goal, step = prev.get(id);
    while (step && step.from !== cur.id) { id = step.from; step = prev.get(id); }
    return step ? { nd: step.nd, goal } : null;
  }

  function doorFor(w, nd) {
    const p = w.player;
    let best = null, bd = 1e9;
    for (const d of w.room.doors) {
      if (d.to !== nd.to || d.dir !== nd.dir) continue;
      const dd = hyp(d.x - p.x, d.y - p.y);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  // ---------------------------------------------------------------- per-tick
  function setInput(move, aim, p) {
    // like the on-screen sticks: releasing aim keeps the last direction (charge weapons loose there)
    input.aimMode = 'touch';
    input.touchMove.x = move.x;
    input.touchMove.y = move.y;
    if (move.x || move.y) B.lastDir = { x: move.x, y: move.y };
    if (aim) {
      const a = Math.atan2(aim.y - (aim.z ?? 0) - (p.y - 4), aim.x - p.x);
      let fire = true;
      if (CHARGE.has(p.weaponId)) {
        B.chargeT += 1;
        if (B.chargeT > 14) { B.chargeT = 0; fire = false; }
      }
      input.touchAim = fire ? { x: Math.cos(a), y: Math.sin(a) } : null;
    } else {
      input.touchAim = null;
    }
  }

  function progress(w) {
    const hp = Math.round(w.enemies.reduce((s, e) => s + (e.dead ? 0 : Math.max(0, e.hp)), 0));
    const p = w.player;
    let loot = 0;
    for (const e of w.entities) if (e.persistent && !e.dead && !(e.opened || e.used || ('item' in e && !e.item))) loot++;
    const sig = `${w.run.floor}|${w.node.id}|${w.enemies.length}|${p.coins}|${p.keys}|${p.bombs}|${p.inv?.items?.length}|${loot}|${p.red}|${p.soul}|${p.weaponId}|${p.activeId}`;
    if (hp < B.lastHp - 0.5 || w.enemies.length === 0) B.dmgT = w.time;
    if (sig !== B.progressSig || hp < B.lastHp - 0.5) {
      B.progressSig = sig;
      B.progressT = w.time;
    }
    B.lastHp = hp;
  }

  function sample(w) {
    const p = w.player;
    // NaN / Infinity positions
    const bad = [];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) bad.push('player');
    for (const e of w.enemies) if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || Number.isNaN(e.hp)) bad.push('enemy:' + e.def?.id);
    for (const e of w.projectiles) if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) bad.push('proj');
    for (const e of w.entities) if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) bad.push('ent:' + (e.def?.id ?? e.kind ?? '?'));
    if (bad.length && B.nan < 20) { B.nan++; ev('nan', { what: [...new Set(bad)].slice(0, 6) }); }
    if (w.time - B.lastSample >= 2) {
      B.lastSample = w.time;
      const t0 = performance.now();
      lk.step(1);
      const c = performance.now() - t0;
      B.cost.push({ f: w.run.floor, c: +c.toFixed(2) });
      B.samples.push({ t: +w.time.toFixed(0), f: w.run.floor, ent: w.entities.length, en: w.enemies.length, pr: w.projectiles.length, pa: w.particles.list.length });
    }
  }

  function floorCheck(w) {
    if (w.run.floor !== B.curFloor) {
      if (B.curFloor) closeFloor(w);
      B.curFloor = w.run.floor;
      B.floorStartT = w.time;
      B.floorWall = performance.now();
      B.secretTried.clear();
      B.failed.clear();
      ev('floor', { seed: w.run.seed });
      B.shotReq = `floor${w.run.floor}`;
    }
    // (sample() may step into the next floor later in this tick)
    B.lastMap = w.map;
  }
  function closeFloor(w, extra = {}) {
    const f = B.floors.find((x) => x.floor === B.curFloor);
    if (f) return;
    const map = B.lastMap ?? w.map;
    B.floors.push({
      floor: B.curFloor, gameSec: +(w.time - B.floorStartT).toFixed(1), wallSec: +((performance.now() - B.floorWall) / 1000).toFixed(1),
      roomsVisited: map.nodes.filter((n) => n.visited).length, rooms: map.nodes.length,
      secretFound: map.nodes.some((n) => n.kind === 'secret' && n.visited), kinds: map.nodes.map((n) => n.kind).join(','), ...extra,
    });
  }

  function watchdogs(w, p) {
    const room = w.room;
    const roomKey = `${w.run.floor}:${w.node.id}`;
    if (roomKey !== B.roomKey) {
      // oscillation: bouncing between the same rooms without progress
      (B.hist ??= []).push({ k: roomKey, t: w.time, obj: B.prevObj });
      if (B.hist.length > 40) B.hist.shift();
      const recent = B.hist.filter((h) => w.time - h.t < 90);
      if (recent.length >= 16 && new Set(recent.map((h) => h.k)).size <= 3 && !B.oscRep?.has(roomKey)) {
        (B.oscRep ??= new Set()).add(roomKey);
        ev('oscillation', {
          rooms: [...new Set(recent.map((h) => h.k))], objs: recent.slice(-6).map((h) => h.obj),
          ents: w.entities.filter((e) => !e.dead && e !== p).map((e) => `${isAltar(e) ? 'altar:' + e.state : isPedestal(e) ? 'ped' : isPickup(e) ? 'pk:' + e.kind : isChest(e) ? 'chest' : e.def?.id ?? '?'}@${Math.round(e.x)},${Math.round(e.y)}`).slice(0, 12),
          cleared: w.node.cleared, hold: w.holdClear, player: `${Math.round(p.x)},${Math.round(p.y)}`,
        });
        B.shotReq = `osc-f${w.run.floor}-r${w.node.id}`;
        B.progressT = -1e9; // let the stuck fallback handle it on the next tick
        B.osc = true;
      }
      B.roomKey = roomKey;
      B.roomEnterT = w.time;
      B.closedT = -1;
      B.bombPlan = null;
      B.retreat = null;
      B.trapOffT = -1;
    }
    // doors closed while nothing hostile is left
    const anyClosed = room.doors.some((d) => d.state === 'closed');
    if (anyClosed && hostiles(w).length === 0 && !w.transitioning && w.holdClear <= 0 && !w.descending) {
      if (B.closedT < 0) B.closedT = w.time;
      else if (w.time - B.closedT > 5 && !B.closedRep?.has(roomKey)) {
        (B.closedRep ??= new Set()).add(roomKey);
        ev('softlock-doors', { cleared: w.node.cleared, doors: room.doors.map((d) => d.state).join(','), enemies: w.enemies.map((e) => `${e.def?.id}${e.dead ? '(dead)' : ''}${e.ignoreForClear ? '(ign)' : ''}`).join(',') });
        B.shotReq = `softlock-doors-f${w.run.floor}-r${w.node.id}`;
      }
    } else B.closedT = -1;
    // player inside a wall
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    if (!w.transitioning && !w.descending && room.tileAt(tx, ty) !== 8 && room.blocks(tx, ty, p.flying, false)) {
      if (B.wallT < 0) B.wallT = w.time;
      else if (w.time - B.wallT > 1.5) {
        ev('stuck-in-wall', { x: +p.x.toFixed(1), y: +p.y.toFixed(1), tile: room.tileAt(tx, ty) });
        B.shotReq = `wall-f${w.run.floor}-r${w.node.id}`;
        B.wallT = w.time + 30;
      }
    } else if (B.wallT >= 0 && B.wallT <= w.time) B.wallT = -1;
    // paused without overlay?
    if (w.paused && !w.gameOver) {
      if (B.pausedT < 0) B.pausedT = w.time;
    } else B.pausedT = -1;
  }

  function fallback(w, p, why) {
    B.fallbacks++;
    const hs = hostiles(w);
    const e = ev('stuck', {
      why, objective: B.obj, roomTime: +(w.time - B.roomEnterT).toFixed(1),
      enemies: hs.map((e) => `${e.def?.id}@${Math.round(e.x)},${Math.round(e.y)} hp${Math.round(e.hp)}${e.vulnerable === false ? ' invuln' : ''}${e.hidden ? ' hidden' : ''}`).slice(0, 8),
      doors: w.room.doors.map((d) => `${d.dir}:${d.state}:${d.open.toFixed(2)}@${Math.round(d.x)},${Math.round(d.y)}`).join(' '), player: `${p.x.toFixed(1)},${p.y.toFixed(1)} r${p.r} v${p.vx.toFixed(0)},${p.vy.toFixed(0)}`,
      flags: `frozen=${p.frozen} trans=${w.transitioning} paused=${w.paused} hold=${w.holdClear} fly=${p.flying} dash=${p.dashT > 0} cleared=${w.node.cleared}`,
      move: `${input.touchMove.x.toFixed(2)},${input.touchMove.y.toFixed(2)}`,
      near: w.entities.filter((e) => !e.dead && hyp(e.x - p.x, e.y - p.y) < 30).map((e) => `${e.def?.id ?? e.kind ?? (e.item ? 'ped' : '?')}${e.solid ? '(solid)' : ''}@${Math.round(e.x)},${Math.round(e.y)}`).slice(0, 8),
    });
    B.shotReq = `stuck-f${w.run.floor}-r${w.node.id}-${B.fallbacks}`;
    B.after = () => {
      const w2 = W();
      if (!w2 || w2 !== w) return;
      if (B.osc && B.hopGoal != null) { B.failed.add('node' + B.hopGoal); B.osc = false; e.fix = `skip-goal-${B.hopGoal}`; }
      else if (hostiles(w2).length) { lk.killAll(); e.fix = 'killAll'; }
      else if (B.obj?.startsWith('trapdoor')) { w2.descend(); e.fix = 'descend'; }
      else if (B.obj?.startsWith('door') && B.hopGoal != null) { w2.teleportTo(w2.map.nodes[B.hopGoal]); e.fix = 'teleport'; }
      else if (B.objId != null) { B.failed.add(B.objId); e.fix = 'skip-objective'; }
      else { const n = w2.map.nodes.find((n) => n.kind === 'boss'); if (n) w2.teleportTo(n); e.fix = 'teleport-boss'; }
      B.progressT = w2.time;
    };
  }

  function tick() {
    const w = W();
    if (!w) return;
    const p = w.player;
    B.tickN++;
    floorCheck(w);
    if (!w.gameOver) balTick(w);
    if (B.tickN % 10 === 0) sample(w);
    if (w.gameOver) {
      setInput({ x: 0, y: 0 }, null, p);
      if (B.wonT < 0) {
        B.wonT = w.time;
        const won = !!w.gameOver.won;
        closeFloor(w, won ? { victory: true } : { died: true });
        B.outcome = won ? 'victory' : 'death';
        if (!won) {
          B.death = { floor: w.run.floor, room: w.node.kind, roomId: w.node.id, template: w.node.templateId, source: w.gameOver.source || w.run.lastDamageSource, gameSec: +w.time.toFixed(1), items: p.inv?.items?.length };
          ev('death', B.death);
        } else ev('victory', {});
      }
      if (performance.now() - (B.goWall ??= performance.now()) > 2500 && !B.done) {
        B.shotReq = B.outcome;
        B.done = true;
      }
      return;
    }
    watchdogs(w, p);
    progress(w);
    if (w.transitioning || w.descending || p.frozen || w.paused) { setInput({ x: 0, y: 0 }, null, p); B.progressT = Math.max(B.progressT, w.time - 15); return; }
    if (opts.god && !p.god) p.god = true;

    const hs = hostiles(w);
    let move = { x: 0, y: 0 }, aim = null;
    B.obj = null; B.objId = null;
    if (hs.length) {
      const c = combat(w, p);
      move = c.move; aim = c.aim;
      B.obj = 'combat';
      // dodge dash
      if (c.danger > 25 && Math.random() < 0.3) input.touchTap('dash');
      if (opts.god && Math.random() < 0.004) input.touchTap('dash');
      if (p.ember >= 100) input.touchTap('special');
      if (p.activeId && B.tickN % 90 === 0) input.touchTap('active');
      if (p.potionId && Math.random() < 0.002) input.touchTap('consumable');
      if (opts.god && p.bombs > 3 && Math.random() < 0.002) input.touchTap('bomb');
    } else if (B.retreat && w.time < B.retreat.until) {
      move = navTo(w, B.retreat.x, B.retreat.y, true) ?? { x: 0, y: 0 };
      B.obj = 'retreat';
    } else {
      const loot = [];
      for (const l of lootTargets(w, p)) {
        if (reachable(w, l.x, l.y)) { loot.push(l); continue; }
        if (B.unreach.has(l.e.id)) continue;
        B.unreach.add(l.e.id);
        if (l.ped || l.kind === 'altar' || l.kind === 'chest' || l.kind.startsWith('bowl')) {
          ev('unreachable', { what: l.kind, x: Math.round(l.x), y: Math.round(l.y), item: l.e.item?.id });
          B.shotReq = `unreach-f${w.run.floor}-r${w.node.id}`;
        }
      }
      const trap = w.entities.find((e) => isTrapdoor(e) && !e.dead);
      const hidden = w.room.doors.find((d) => d.state === 'hidden');
      if (loot.length) {
        const l = loot[0];
        const key = l.ped ? 'ped' + l.e.id : l.e.id;
        B.obj = 'loot:' + l.kind; B.objId = l.e.id;
        let rec = B.tried.get(key);
        if (!rec || typeof rec !== 'object') { rec = { t0: w.time, near: -1 }; B.tried.set(key, rec); }
        const d = hyp(l.x - p.x, l.y - p.y);
        if (d < 6 && rec.near < 0) rec.near = w.time;
        if ((rec.near >= 0 && w.time - rec.near > 1.0) || w.time - rec.t0 > 8) {
          if (l.ped) B.tried.set(key, 'done');
          B.failed.add(l.e.id);
          // pedestals that swap (weapon / active) hold the old item: step away
          if (l.ped) B.retreat = { x: w.room.centerX, y: w.room.centerY + 30, until: w.time + 0.8 };
        }
        move = navTo(w, l.x, l.y, !opts.god) ?? { x: 0, y: 0 };
        // pedestal items are taken with the interact action (G / touch "줍기") while standing at them
        if (l.ped && d < 12 && typeof rec === 'object' && !rec.tapped && w.focus === l.e) {
          rec.tapped = true;
          rec.itemId = l.e.item?.id;
          input.touchTap('interact');
        }
        if (l.ped && typeof rec === 'object' && rec.tapped && l.e.item?.id !== rec.itemId) {
          // taken (an artifact empties the pedestal; a weapon / active swaps in the old one)
          B.tried.set(key, 'done');
          if (l.e.item) B.retreat = { x: w.room.centerX, y: w.room.centerY + 30, until: w.time + 0.8 };
        }
        if (l.ped && d < 14 && B.tried.get(key) !== 'done' && l.e.item == null) B.tried.set(key, 'done');
      } else if (hidden && p.bombs > 0 && !B.secretTried.has(B.roomKey + hidden.dir + hidden.x)) {
        // bomb the hidden secret door
        const v = DV[hidden.dir];
        const gx = hidden.x - v.x * 10, gy = hidden.y - v.y * 10;
        B.obj = 'bomb-secret';
        if (hyp(gx - p.x, gy - p.y) < 8) {
          input.touchTap('bomb');
          B.secretTried.add(B.roomKey + hidden.dir + hidden.x);
          B.retreat = { x: w.room.centerX, y: w.room.centerY, until: w.time + 2.6 };
          ev('bomb-secret', { dir: hidden.dir });
        } else move = navTo(w, gx, gy, !opts.god) ?? (B.secretTried.add(B.roomKey + hidden.dir + hidden.x), { x: 0, y: 0 });
      } else if (trap) {
        B.obj = 'trapdoor';
        const d = hyp(trap.x - p.x, trap.y - p.y);
        if (!reachable(w, trap.x, trap.y) && !B.unreach.has(trap.id)) {
          B.unreach.add(trap.id);
          ev('unreachable', { what: 'trapdoor' });
          B.shotReq = `unreach-trapdoor-f${w.run.floor}`;
        }
        if (d < 7 && !trap.armed) {
          // standing on it when it appeared: step off once
          B.retreat = { x: trap.x, y: trap.y - 30, until: w.time + 0.6 };
        }
        move = navTo(w, trap.x, trap.y, false) ?? { x: 0, y: 0 };
        if (d < 3) move = { x: 0, y: 0 };
      } else if (w.node.kind === 'boss' && w.node.cleared && !trap) {
        // last floor: the victory cinematic is playing (other floors: the trapdoor is about to open)
        B.obj = 'final-wait';
      } else {
        const wantBoss = w.time - B.floorStartT > (opts.exploreSec ?? 300);
        const hop = planHop(w, p, wantBoss);
        if (hop) {
          const d = doorFor(w, hop.nd);
          B.hopGoal = hop.goal;
          if (d) {
            B.obj = 'door:' + d.dir + ':' + d.state; B.objId = 'node' + hop.nd.to;
            const v = DV[d.dir];
            const gx = d.x - v.x * 9, gy = d.y - v.y * 9;
            const dd = hyp(gx - p.x, gy - p.y);
            if (dd < 7 && (d.state === 'open' || d.state === 'locked')) move = { x: v.x, y: v.y };
            else move = navTo(w, gx, gy, !opts.god) ?? { x: 0, y: 0 };
          } else B.obj = 'door-missing';
        } else B.obj = 'no-hop';
      }
    }
    B.prevObj = B.obj;
    setInput(move, aim, p);
    const limit = B.obj === 'combat' ? 20 : 20;
    if (w.time - B.progressT > limit && !B.paused) fallback(w, p, B.obj);
  }

  // turbo loop: bot tick + `turbo` sim steps per macrotask
  let lastWall = performance.now();
  function loop() {
    if (B.stop) return;
    if (!B.paused && !B.done) {
      try {
        for (let i = 0; i < opts.turbo; i++) {
          tick();
          if (B.shotReq || B.done) break;
          lk.step(3);
        }
      } catch (e) {
        B.events.push({ type: 'bot-exception', msg: String(e?.stack ?? e).slice(0, 600) });
        B.botErr = (B.botErr ?? 0) + 1;
        if (B.botErr > 50) { B.done = true; B.outcome = 'bot-error'; }
      }
      if (B.shotReq) { B.paused = true; input.touchMove.x = input.touchMove.y = 0; input.touchAim = null; }
    }
    lastWall = performance.now();
    setTimeout(loop, 0);
  }
  B.resume = () => {
    B.shotReq = null;
    if (B.after) { const f = B.after; B.after = null; f(); }
    B.paused = false;
  };
  B.poll = () => {
    const w = W();
    const evs = B.events.splice(0);
    return {
      done: B.done, shotReq: B.shotReq, events: evs, floor: w?.run.floor, t: w ? +w.time.toFixed(1) : 0, obj: B.obj,
      room: w?.node.kind, hp: w ? `${w.player.red}+${w.player.soul}/${w.player.maxRed}` : '',
    };
  };
  B.summary = () => ({ outcome: B.outcome, death: B.death, floors: B.floors, samples: B.samples, cost: B.cost, fallbacks: B.fallbacks, balance: B.bal });
  loop();
}
/* eslint-enable */

// ------------------------------------------------------------------ run one
async function runOne(browser, spec) {
  const dir = join(out, spec.name);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('lanternkeeper.progress.v1')) {
        localStorage.setItem('lanternkeeper.progress.v1', JSON.stringify({ flags: ['unlock:niel'], unlockedCharacters: ['niel'], runs: 3 }));
      }
    } catch {}
  });
  const page = await ctx.newPage();
  const consoleErrs = [];
  let curFloor = 0;
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push({ floor: curFloor, msg: m.text().slice(0, 800) }); });
  page.on('pageerror', (e) => consoleErrs.push({ floor: curFloor, msg: `[pageerror] ${e.message}\n${(e.stack ?? '').slice(0, 800)}` }));
  const t0 = Date.now();
  const res = { name: spec.name, spec, events: [], shots: [] };
  try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__lk, null, { timeout: 30000 });
    await page.evaluate(([s, c]) => window.__lk.start(s, c), [spec.seed, spec.character]);
    await page.waitForFunction(() => !!window.__world, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const given = await page.evaluate(({ god, chaos, chaosN }) => {
      const lk = window.__lk;
      if (god) lk.god(true);
      const out = [];
      if (chaos) {
        const l = lk.list();
        const arts = [...l.artifacts].sort(() => Math.random() - 0.5).slice(0, chaosN ?? 25);
        for (const a of arts) if (lk.give(a)) out.push(a);
        const wpn = l.weapons.filter((x) => !['flame_puff', 'heavy_arrow', 'lantern_bolt'].includes(x) || Math.random() < 0.2);
        const wp = wpn[Math.floor(Math.random() * wpn.length)];
        if (lk.give(wp)) out.push('weapon:' + wp);
        const act = l.actives[Math.floor(Math.random() * l.actives.length)];
        if (lk.give(act)) out.push('active:' + act);
      }
      return out;
    }, { ...spec, chaosN: Number(args['chaos-n'] ?? 25) });
    res.given = given;
    // optional: skip ahead (debug descend) to reproduce a floor
    for (let f = 1; f < Number(args['start-floor'] ?? 1); f++) {
      await page.evaluate(() => window.__lk.nextFloor());
      await page.waitForTimeout(900);
    }
    if (args.invuln) await page.evaluate(() => { window.__world.player.god = true; });
    await page.evaluate(botMain, { god: spec.god, immortal: !!spec.immortal, turbo, exploreSec: spec.god ? 300 : 240 });
    let lastLog = 0;
    for (;;) {
      await page.waitForTimeout(700);
      const st = await page.evaluate(() => window.__bot.poll());
      curFloor = st.floor ?? curFloor;
      for (const e of st.events) {
        res.events.push(e);
        if (e.type !== 'floor' && e.type !== 'bomb-secret') console.log(`[${spec.name}] ${e.type} f${e.floor} ${e.room}#${e.roomId} ${e.template ?? ''} ${JSON.stringify(e).slice(0, 300)}`);
      }
      if (st.shotReq) {
        const file = `${String(res.shots.length).padStart(2, '0')}-${st.shotReq}.png`;
        await page.screenshot({ path: join(dir, file) });
        res.shots.push(file);
        await page.evaluate(() => window.__bot.resume());
      }
      if (Date.now() - lastLog > 30000) {
        lastLog = Date.now();
        console.log(`[${spec.name}] floor ${st.floor} t=${st.t}s ${st.room} obj=${st.obj} hp=${st.hp} wall=${Math.round((Date.now() - t0) / 1000)}s`);
      }
      if (st.done) break;
      if (st.t > maxGameMin * 60 || Date.now() - t0 > maxWallMin * 60000) {
        res.timeout = true;
        await page.screenshot({ path: join(dir, 'zz-timeout.png') });
        break;
      }
    }
    Object.assign(res, await page.evaluate(() => { window.__bot.stop = true; return window.__bot.summary(); }));
    res.lkErrors = await page.evaluate(() => window.__lk.errors.slice(0, 50));
  } catch (e) {
    res.crash = String(e?.stack ?? e);
    try { await page.screenshot({ path: join(dir, 'zz-crash.png') }); } catch {}
  }
  res.consoleErrors = consoleErrs.slice(0, 50);
  res.wallSec = Math.round((Date.now() - t0) / 1000);
  // condense samples: per floor max + last of each metric
  const per = {};
  for (const s of res.samples ?? []) {
    const f = (per[s.f] ??= { n: 0, entMax: 0, paMax: 0, prMax: 0, enMax: 0, entLast: 0, paLast: 0 });
    f.n++; f.entMax = Math.max(f.entMax, s.ent); f.paMax = Math.max(f.paMax, s.pa); f.prMax = Math.max(f.prMax, s.pr); f.enMax = Math.max(f.enMax, s.en);
    f.entLast = s.ent; f.paLast = s.pa;
  }
  const costs = {};
  for (const c of res.cost ?? []) (costs[c.f] ??= []).push(c.c);
  res.frameCost = Object.fromEntries(Object.entries(costs).map(([f, a]) => {
    a.sort((x, y) => x - y);
    return [f, { n: a.length, p50: a[Math.floor(a.length * 0.5)], p95: a[Math.floor(a.length * 0.95)], max: a[a.length - 1] }];
  }));
  res.counts = per;
  writeFileSync(join(dir, 'result.json'), JSON.stringify(res, null, 1));
  await ctx.close();
  const brief = `${spec.name}: ${res.outcome ?? (res.timeout ? 'TIMEOUT' : 'CRASH')} floors=${(res.floors ?? []).map((f) => `${f.floor}:${f.gameSec}s/${f.roomsVisited}of${f.rooms}`).join(' ')} wall=${res.wallSec}s fallbacks=${res.fallbacks} errors=${res.consoleErrors.length + (res.lkErrors?.length ?? 0)}${res.death ? ` DIED f${res.death.floor} ${res.death.room} by ${res.death.source}` : ''}`;
  console.log(`[qa] ${brief}`);
  return { ...res, samples: undefined, cost: undefined, brief };
}

// ------------------------------------------------------------------ checks (UI flows)
// Fresh profile: title / collection / settings / credits screens, character
// select with 니엘 locked, an unseeded run that unlocks 니엘 on the floor-3
// boss, game over -> retry, and 니엘 selectable after a reload.
async function runChecks(browser) {
  const r = { checks: [] };
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
  const dir = join(out, 'checks');
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const shot = async (name) => page.screenshot({ path: join(dir, `${String(n++).padStart(2, '0')}-${name}.png`) });
  const check = (name, ok, info = '') => { r.checks.push({ name, ok: !!ok, info }); console.log(`[check] ${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`); };
  const key = async (k, times = 1, wait = 180) => { for (let i = 0; i < times; i++) { await page.keyboard.press(k); await page.waitForTimeout(wait); } };
  const noErr = (name) => { check(`${name}: no console errors`, errs.length === 0, errs.splice(0).join(' | ').slice(0, 400)); };
  const flags = () => page.evaluate(() => JSON.parse(localStorage.getItem('lanternkeeper.progress.v1') ?? '{}').flags ?? []);
  try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__lk, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot('title');
    noErr('title');
    // 도감 (collection): title index 3 (after 새 게임 / 함께하기 / 시드 입력)
    await key('ArrowDown', 3);
    await key('Enter', 1, 600);
    await shot('collection');
    await key('ArrowRight', 3);
    await key('ArrowDown', 3);
    await key('Tab', 1, 300);
    await shot('collection-2');
    await key('Escape', 1, 500);
    noErr('collection');
    // 설정 (settings): index 4
    await key('ArrowDown', 1);
    await key('Enter', 1, 600);
    await shot('settings');
    await key('ArrowDown', 6);
    await key('ArrowLeft', 1);
    await key('ArrowRight', 1);
    await shot('settings-2');
    await key('Escape', 1, 500);
    noErr('settings');
    // 크레딧 (credits): index 5
    await key('ArrowDown', 1);
    await key('Enter', 1, 800);
    await shot('credits');
    await key('Escape', 1, 500);
    noErr('credits');
    // character select: 니엘 locked
    await key('ArrowUp', 5);
    await key('Enter', 1, 800);
    await shot('charselect');
    check('fresh profile: niel locked', !(await flags()).includes('unlock:niel'));
    await key('ArrowRight', 3, 250);
    await shot('charselect-niel-locked');
    await key('Enter', 1, 600);
    check('locked niel cannot start a run', await page.evaluate(() => !window.__world));
    await key('ArrowLeft', 3, 250);
    await key('Enter', 1, 1500);
    const run0 = await page.evaluate(() => { const w = window.__world; return w ? { seeded: w.run.seeded, ch: w.run.characterId, seed: w.run.seed } : null; });
    check('character select starts an unseeded run', run0 && run0.seeded === false, JSON.stringify(run0));
    noErr('run start');
    // reach the floor-3 boss and beat it -> 니엘 unlocks
    await page.evaluate(() => { __lk.god(true); __lk.nextFloor(); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => __lk.nextFloor());
    await page.waitForTimeout(1500);
    await page.evaluate(() => __lk.gotoRoom('boss'));
    await page.waitForTimeout(3000);
    await page.evaluate(() => __lk.killAll());
    await page.waitForTimeout(600);
    await page.evaluate(() => __lk.killAll());
    await page.waitForTimeout(400);
    await shot('niel-unlock-banner');
    check('floor-3 boss kill unlocks niel', (await flags()).includes('unlock:niel'), `floor=${await page.evaluate(() => window.__world.run.floor)}`);
    noErr('floor 3 boss');
    // game over -> retry
    const before = await page.evaluate(() => { const w = window.__world; w.player.god = false; w.player.invuln = 0; w.player.soul = 0; w.player.red = 1; w.player.hurt(w, 4, 'QA'); return w.run.seed; });
    await page.waitForTimeout(3500);
    await shot('gameover');
    check('game over overlay shown', await page.evaluate(() => !!window.__world.gameOver && !window.__world.gameOver.won));
    await key('Enter', 1, 1500);
    const after = await page.evaluate(() => { const w = window.__world; return { seed: w.run.seed, over: !!w.gameOver, floor: w.run.floor, ch: w.run.characterId, hp: w.player.red }; });
    await shot('retry');
    check('retry starts a fresh run', after.seed !== before && !after.over && after.floor === 1 && after.ch === run0?.ch, JSON.stringify(after));
    await page.waitForTimeout(1000);
    noErr('game over / retry');
    // reload: 니엘 now selectable
    await page.reload();
    await page.waitForFunction(() => !!window.__lk, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await key('Enter', 1, 800);
    await key('ArrowRight', 3, 250);
    await shot('charselect-niel-open');
    await key('Enter', 1, 1500);
    const nr = await page.evaluate(() => window.__world?.run.characterId);
    check('niel selectable after unlock', nr === 'niel', String(nr));
    await page.waitForTimeout(1000);
    await shot('niel-run');
    noErr('niel run');
    // mobile: touch UI on a landscape phone, taps through title -> character select -> run
    const mctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const mp = await mctx.newPage();
    const merrs = [];
    mp.on('console', (m) => { if (m.type() === 'error') merrs.push(m.text()); });
    mp.on('pageerror', (e) => merrs.push(`[pageerror] ${e.message}`));
    await mp.goto(url);
    await mp.waitForFunction(() => !!window.__lk, null, { timeout: 30000 });
    await mp.waitForTimeout(1200);
    await mp.screenshot({ path: join(dir, `${String(n++).padStart(2, '0')}-mobile-title.png`) });
    await mp.evaluate(() => window.__lk.start('QA-MOBILE', 'serin'));
    await mp.waitForTimeout(500);
    await mp.touchscreen.tap(700, 300);
    await mp.evaluate(botMain, { god: true, turbo: 1 });
    await mp.waitForTimeout(8000);
    await mp.evaluate(() => { window.__bot.stop = true; });
    await mp.screenshot({ path: join(dir, `${String(n++).padStart(2, '0')}-mobile-game.png`) });
    check('mobile touch UI: no console errors', merrs.length === 0, merrs.join(' | ').slice(0, 400));
    await mctx.close();
  } catch (e) {
    check('checks crashed', false, String(e?.stack ?? e).slice(0, 500));
    try { await shot('crash'); } catch {}
  }
  await ctx.close();
  return r;
}

// ------------------------------------------------------------------ content sweep
// Every weapon fires, every active / potion is used, every enemy and boss is
// spawned on its floor and fought for a few seconds (god mode, auto-aim).
async function runSweep(browser) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  let tag = '';
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`[${tag}] ${m.text().slice(0, 500)}`); });
  page.on('pageerror', (e) => errs.push(`[${tag}] [pageerror] ${e.message} ${(e.stack ?? '').slice(0, 400)}`));
  const dir = join(out, 'sweep');
  mkdirSync(dir, { recursive: true });
  await page.goto(url);
  await page.waitForFunction(() => !!window.__lk, null, { timeout: 30000 });
  await page.evaluate(() => { window.__lk.start('QA-SWEEP', 'ria'); });
  await page.waitForTimeout(500);
  const list = await page.evaluate(() => window.__lk.list());
  // helper in page: fight for `frames` with auto-aim at the nearest enemy, report NaN
  await page.evaluate(() => {
    window.__fight = (frames) => {
      const lk = window.__lk, inp = lk.input, w = window.__world, p = w.player;
      inp.aimMode = 'touch';
      p.god = true;
      let nan = 0, idle = 0;
      for (let i = 0; i < frames; i++) {
        // done when the room is empty (and don't wander onto a boss trapdoor)
        if (w.enemies.length === 0 && ++idle > 60) break;
        const e = w.nearestEnemy(p.x, p.y);
        if (e) { const a = Math.atan2(e.y - p.y + 4, e.x - p.x); inp.touchAim = { x: Math.cos(a), y: Math.sin(a) }; } else inp.touchAim = null;
        const m = w.enemies.length ? 0.6 : 0;
        inp.touchMove.x = Math.sin(i / 40) * m; inp.touchMove.y = Math.cos(i / 55) * m;
        for (const t of w.entities) if ('openT' in t && 'armed' in t) t.dead = true; // no trapdoor rides
        lk.step(1);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || w.enemies.some((x) => !Number.isFinite(x.x) || !Number.isFinite(x.y) || Number.isNaN(x.hp))) nan++;
      }
      inp.touchAim = null; inp.touchMove.x = inp.touchMove.y = 0;
      return nan;
    };
    window.__home = () => { const w = window.__world; const n = w.map.nodes[w.map.startId]; if (w.node !== n) w.teleportTo(n); window.__lk.step(40); window.__lk.killAll(); w.clearEnemyBullets(0, 0, Infinity, false); window.__lk.step(5); };
  });
  const res = { nan: [], tested: 0 };
  const run = async (name, fn, arg) => { tag = name; const n = await page.evaluate(fn, arg); res.tested++; if (n) res.nan.push(name); };
  for (const id of list.weapons) await run(`weapon:${id}`, (id) => { window.__home(); window.__lk.give(id); window.__lk.spawn('crypt_bat') ; return window.__fight(150); }, id);
  await page.evaluate(() => window.__lk.give('lantern_bolt'));
  for (const id of list.actives) await run(`active:${id}`, (id) => { window.__home(); const w = window.__world; window.__lk.give(id); w.player.activeCharge = 99; window.__lk.spawn('crypt_bat'); window.__lk.input.touchTap('active'); return window.__fight(150); }, id);
  for (const id of list.potions) await run(`potion:${id}`, (id) => { window.__home(); window.__world.player.potionId = id; window.__lk.input.touchTap('consumable'); return window.__fight(120); }, id);
  // enemies & bosses on their own floors
  const defs = await page.evaluate((ids) => ids.map((id) => { const w = window.__world; const e = w.spawnEnemy(id, w.room.centerX, w.room.centerY - 40); const d = e ? { id, boss: !!e.def.boss, floors: e.def.bossFloors ?? e.def.floors ?? [1] } : { id, floors: [1] }; if (e) w.killEnemy(e); return d; }), list.enemies);
  await page.evaluate(() => { window.__lk.step(30); });
  for (let f = 1; f <= 5; f++) {
    if (f > 1) { tag = `descend ${f}`; await page.evaluate(() => { window.__lk.nextFloor(); window.__lk.step(90); }); }
    // regular enemies first: the floor-5 boss ends the run (victory)
    for (const d of defs.filter((d) => (d.floors[0] ?? 1) === f || (f === 1 && !d.floors.length)).sort((a, b) => +a.boss - +b.boss)) {
      await run(`${d.boss ? 'boss' : 'enemy'}:${d.id}@f${f}`, ({ id, boss }) => {
        window.__home();
        const w = window.__world;
        if (boss) { const n = w.map.nodes.find((x) => x.kind === 'boss'); w.teleportTo(n); window.__lk.step(60); window.__lk.killAll(); window.__lk.step(30); }
        for (let k = 0; k < (boss ? 1 : 3); k++) window.__lk.spawn(id, w.room.centerX + (k - 1) * 50, w.room.centerY - 40);
        const before = w.run.floor;
        const nan = window.__fight(boss ? 1500 : 420);
        if (w.run.floor !== before || (w.gameOver && !(boss && w.gameOver.won && before === 5))) console.error(`sweep: ${id} changed floor ${before} -> ${w.run.floor} (gameOver=${!!w.gameOver})`);
        return nan;
      }, d);
      if (d.boss) await page.screenshot({ path: join(dir, `boss-${d.id}.png`) });
    }
  }
  res.lkErrors = await page.evaluate(() => window.__lk.errors.slice(0, 30));
  res.errors = errs.slice(0, 40);
  await ctx.close();
  console.log(`[sweep] tested ${res.tested} items/enemies; NaN in: ${res.nan.join(', ') || 'none'}; errors: ${errs.length + res.lkErrors.length}`);
  for (const e of [...errs, ...res.lkErrors].slice(0, 20)) console.log('  ', e.slice(0, 300));
  return res;
}

// ------------------------------------------------------------------ main
const browser = await chromium.launch({ args: args.audio ? ['--autoplay-policy=no-user-gesture-required'] : [] });
// the floor-start blessing choice ("등불의 축복") auto-picks the first card for the bots
{
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (o) => {
    const c = await newContext(o);
    await c.addInitScript(() => { window.__lkAutoBless = true; });
    return c;
  };
}
const all = [];
const queue = specs();
const t0 = Date.now();
async function worker() {
  while (queue.length) {
    const s = queue.shift();
    console.log(`[qa] start ${s.name} (${s.character}, seed ${s.seed}, god=${s.god}${s.chaos ? ', chaos' : ''})`);
    all.push(await runOne(browser, s));
  }
}
await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
if (suite === 'checks' || args.checks) all.push({ checks: await runChecks(browser) });
if (suite === 'sweep' || args.sweep) { const sw = await runSweep(browser); all.push({ sweep: sw, consoleErrors: sw.errors, lkErrors: sw.lkErrors }); }
await browser.close();
server.close();
writeFileSync(join(out, 'summary.json'), JSON.stringify({ wallSec: Math.round((Date.now() - t0) / 1000), runs: all }, null, 1));
console.log('\n[qa] SUMMARY');
for (const r of all) if (r.brief) console.log(' ', r.brief);
balanceReport(all.filter((r) => r.balance));

/** Per-floor balance table over every run that recorded metrics (see botMain BAL). */
function balanceReport(runs) {
  if (!runs.length) return;
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const med = (a) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
  const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
  const floors = [...new Set(runs.flatMap((r) => r.balance.floors.map((f) => f.floor)))].sort((a, b) => a - b);
  const rows = floors.map((fl) => {
    const fs = runs.map((r) => r.balance.floors.find((f) => f.floor === fl)).filter(Boolean);
    const rooms = runs.flatMap((r) => r.balance.rooms.filter((x) => x.floor === fl && x.kind === 'normal' && !x.fallback && x.n > 0));
    const bosses = runs.flatMap((r) => r.balance.bosses.filter((x) => x.floor === fl && !x.fallback));
    const all = fs.reduce((s, f) => s + f.allDmg, 0);
    const rel = fs.reduce((s, f) => s + f.relDmg, 0);
    return {
      floor: fl, runs: fs.length, hpMult: fs[0]?.hpMult, dpsEst: +f1(avg(fs.map((f) => f.dps))), items: +f1(avg(fs.map((f) => f.items))),
      hearts: +f1(avg(fs.map((f) => f.maxRed / 2))), roomSec: +f1(med(rooms.map((x) => x.dur))), roomHp: Math.round(avg(rooms.map((x) => x.hp))),
      roomTaken: +f1(avg(rooms.map((x) => x.taken))), bossSec: +f1(med(bosses.map((x) => x.dur))), bossAvg: +f1(avg(bosses.map((x) => x.dur))), bossHp: Math.round(avg(bosses.map((x) => x.hp))),
      bossTaken: +f1(avg(bosses.map((x) => x.taken))), bossRelPct: Math.round((100 * bosses.reduce((s, b) => s + b.relDmg, 0)) / Math.max(1, bosses.reduce((s, b) => s + b.allDmg, 0))),
      taken: +f1(avg(fs.map((f) => f.taken))), wouldDie: +f1(avg(fs.map((f) => f.wouldDie))), relPct: Math.round((100 * rel) / Math.max(1, all)),
    };
  });
  console.log('\n[qa] BALANCE (median room / boss seconds, without fallbacks; taken in half-hearts)');
  console.table(rows);
  for (const r of runs) {
    const b = r.balance.bosses.map((x) => `f${x.floor} ${x.id} ${x.dur}s hp${x.hp} rel${Math.round((100 * x.relDmg) / Math.max(1, x.allDmg))}% taken${x.taken}${x.fallback ? ' (fallback)' : ''}`).join(' | ');
    console.log(`  ${r.name}: ${b}`);
  }
  writeFileSync(join(out, 'balance.json'), JSON.stringify({ rows, runs: runs.map((r) => ({ name: r.name, balance: r.balance })) }, null, 1));
}
const bad = all.some((r) => r.crash || (r.consoleErrors?.length ?? 0) > 0 || (r.lkErrors?.length ?? 0) > 0 || r.checks?.checks?.some((c) => !c.ok));
process.exit(bad ? 1 : 0);
