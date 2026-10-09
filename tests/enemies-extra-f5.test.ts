// One more regular enemy for floor 5 (공허의 심장): 별그물 거미 (star_weaver) and its web
// (별그물, StarWeb). Definition and sprites, the pure web helpers, a 20 s headless run in the
// real World on floor 5, one focused test per rule of the web (harmless tracing, one hit at
// base strength thrown outward, the opening, breaking with the weaver, one web per room,
// champion turn, bullet-clear), the hop back, draw purity and lockstep determinism.

import './headless';
import { fakeDisplay } from './headless';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Enemies, Floors, RoomTemplates, Themes } from '../src/game/defs';
import { Enemy } from '../src/game/enemy';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { FIXED_DT } from '../src/game/constants';
import { clearInput, fixedRules } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import { getAnim, getSprite, hasAnim, hasSprite } from '../src/engine/sprites';
import { RNG, fx } from '../src/engine/rng';
import { angleDiff } from '../src/engine/math';
import { laneClear, onWeb, pickGap, StarWeb, WEB, webKnots, webRadius } from '../src/content/enemies/abyss-extra';
import { Room } from '../src/game/room';
import { Tile } from '../src/game/tiles';
import { TILE } from '../src/game/constants';
import { timeStop } from '../src/content/items/lib';
import type { RoomNode } from '../src/game/dungeon';

loadContent();

const ID = 'star_weaver';

// ---------------------------------------------------------------- real World harness
let renderer: Renderer | null = null;

/** A fresh run standing in the start room of floor 5, no enemies, the keeper idle. */
function world(seed: string, floor = 5): World {
  renderer ??= new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(seed, 'ria');
  run.seeded = true;
  const w = new World(renderer, run, { openInventory() {}, onGameOver() {} });
  w.rules = fixedRules({ hitStop: false });
  w.inputSource = (_w, _p, o) => clearInput(o);
  w.start();
  if (w.run.floor !== floor) w.startFloor(floor);
  steps(w, 30);
  for (const e of [...w.enemies]) w.killEnemy(e);
  const p = w.player;
  p.x = w.room.centerX;
  p.y = w.room.centerY;
  p.soul = 60;
  steps(w, 2);
  return w;
}

function steps(w: World, n: number, each?: (i: number) => void): void {
  for (let i = 0; i < n; i++) {
    w.update(FIXED_DT);
    each?.(i);
  }
}
const secs = (s: number) => Math.round(s / FIXED_DT);

function spawn(w: World, id = ID, dx = 80, dy = -20): Enemy {
  const p = w.player;
  const e = w.spawnEnemy(id, p.x + dx, p.y + dy)!;
  expect(e, id).toBeTruthy();
  return e;
}

const webs = (w: World) => w.entities.filter((x): x is StarWeb => x instanceof StarWeb && !x.dead);
/** Webs still whole (not broken / snapped and fading out). */
const liveWebs = (w: World) => webs(w).filter((s) => s.brokenT <= 0);
const weavers = (w: World) => w.enemies.filter((e) => e.alive && e.def.id === ID);
const enemyShots = (w: World) => w.projectiles.filter((p) => p.team === 'enemy' && !p.dead);

/** Step until the first web appears (null if none within `max` seconds). */
function untilWeb(w: World, max = 8, each?: () => void): StarWeb | null {
  for (let i = 0; i < secs(max); i++) {
    each?.();
    w.update(FIXED_DT);
    const s = webs(w)[0];
    if (s) return s;
  }
  return null;
}

/** Record every Player.hurt call (half hearts asked, raw flag, whether it landed, from the web or not). */
function spyHurt(w: World): { hh: number; raw: boolean; applied: boolean; web: boolean }[] {
  const p = w.player;
  const calls: { hh: number; raw: boolean; applied: boolean; web: boolean }[] = [];
  const orig = p.hurt.bind(p);
  p.hurt = ((ww: World, hh: number, src?: string, raw?: boolean, origin?: { x: number; y: number }) => {
    const applied = orig(ww, hh, src, raw, origin);
    calls.push({ hh, raw: !!raw, applied, web: origin instanceof StarWeb });
    return applied;
  }) as typeof p.hurt;
  return calls;
}

function spriteDefined(name: string): boolean {
  if (hasAnim(name)) {
    const a = getAnim(name)!;
    return a.frames.length > 0 && a.frames.every((f) => hasSprite(f));
  }
  return hasSprite(name);
}

// ---------------------------------------------------------------- definition
describe('star weaver definition', () => {
  it('is a floor-5 regular with the house stats (floor-1 HP units, speed under the keeper)', () => {
    const d = Enemies.must(ID);
    expect(d.floors).toEqual([5]);
    expect(d.boss).toBeFalsy();
    expect(d.name).toBe('별그물 거미');
    expect(d.champion).toBe(true);
    expect(d.deathFx).toBeDefined();
    expect(d.bloodColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(d.light?.radius).toBeGreaterThan(0);
    expect(d.script).toBeTypeOf('function');
    // a regular: 25–45 HP
    expect(d.hp).toBeGreaterThanOrEqual(25);
    expect(d.hp).toBeLessThanOrEqual(45);
    const f5 = Floors.all().find((f) => f.index === 5)!;
    expect((d.speed ?? 40) * (f5.enemySpeed ?? 1)).toBeLessThan(92);
    expect(d.contactDamage ?? 1).toBe(1);
    expect(d.radius).toBeGreaterThan(2);
    expect(d.flying).toBeFalsy();
  });

  it('sits in floor 5 spawn pool with a weight / cost in line with its neighbours', () => {
    const pool = Enemies.all().filter((d) => !d.boss && d.floors?.includes(5));
    expect(pool.map((d) => d.id)).toContain(ID);
    const d = Enemies.must(ID);
    const others = pool.filter((o) => o.id !== ID);
    const ws = others.map((o) => o.weight ?? 1);
    const cs = others.map((o) => o.cost ?? 1);
    expect(d.weight ?? 1).toBeGreaterThanOrEqual(Math.min(...ws));
    expect(d.weight ?? 1).toBeLessThanOrEqual(Math.max(...ws));
    expect(d.cost ?? 1).toBeGreaterThanOrEqual(Math.min(...cs));
    expect(d.cost ?? 1).toBeLessThanOrEqual(Math.max(...cs));
    const total = pool.reduce((s, o) => s + (o.weight ?? 1), 0);
    const share = (d.weight ?? 1) / total;
    expect(share).toBeGreaterThan(0.04);
    expect(share).toBeLessThan(0.12);
  });

  it('has idle / skitter / weave (wind-up) / hold (attack) / crouch / leap / hurt frames, all defined, readable size', () => {
    const d = Enemies.must(ID);
    expect(spriteDefined(d.sprite)).toBe(true);
    for (const st of ['idle', 'skitter', 'weave', 'hold', 'crouch', 'leap', 'hurt']) expect(spriteDefined(`sweaver_${st}`), st).toBe(true);
    expect(getAnim('sweaver_skitter')!.frames.length).toBe(4);
    expect(getAnim('sweaver_weave')!.frames.length).toBeGreaterThanOrEqual(2);
    expect(getAnim('sweaver_hold')!.frames.length).toBeGreaterThanOrEqual(2);
    // a big-ish regular: legs span ≤ 28 px (+ outline), body well under that
    const s = getSprite('sweaver_idle_0')!;
    expect(s.w).toBeLessThanOrEqual(28 + 2);
    expect(s.h).toBeLessThanOrEqual(28 + 2);
  });
});

// ---------------------------------------------------------------- pure helpers
describe('web helpers', () => {
  it('webRadius tightens at WEB.close px/s from r0 down to rEnd', () => {
    expect(webRadius(0)).toBe(WEB.r0);
    expect(webRadius(-1)).toBe(WEB.r0);
    expect(webRadius(1)).toBeCloseTo(WEB.r0 - WEB.close, 6);
    expect(webRadius(100)).toBe(WEB.rEnd);
    // the whole tightening takes ~1.8 s: enough to walk out, short enough to matter
    const t = (WEB.r0 - WEB.rEnd) / WEB.close;
    expect(t).toBeGreaterThan(1.4);
    expect(t).toBeLessThan(2.2);
  });

  it('webKnots spread over the circle except the opening, which is centred on gapDir', () => {
    const ks = webKnots(100, 50, 40, 0, 10);
    expect(ks).toHaveLength(10);
    for (const k of ks) expect(Math.hypot(k.x - 100, k.y - 50)).toBeCloseTo(40, 6);
    // the two end knots flank the opening symmetrically
    const a0 = Math.atan2(ks[0].y - 50, ks[0].x - 100);
    const a1 = Math.atan2(ks[9].y - 50, ks[9].x - 100);
    expect(a0).toBeCloseTo(WEB.gap / 2, 6);
    expect(a1).toBeCloseTo(-WEB.gap / 2, 6);
    // no knot inside the opening
    for (const k of ks) expect(Math.abs(Math.atan2(k.y - 50, k.x - 100))).toBeGreaterThanOrEqual(WEB.gap / 2 - 1e-9);
  });

  it('onWeb: touching a thread hits, the opening and the middle do not', () => {
    const ks = webKnots(0, 0, 50, 0, 10);
    // on the thread opposite the opening (the chord between knots 4 and 5), and just clear of it
    const mid = { x: (ks[4].x + ks[5].x) / 2, y: (ks[4].y + ks[5].y) / 2 };
    const l = Math.hypot(mid.x, mid.y);
    expect(onWeb(mid.x, mid.y, 5, ks)).toBe(true);
    expect(onWeb(mid.x * (1 - (5 + WEB.half - 0.5) / l), mid.y, 5, ks)).toBe(true);
    expect(onWeb(mid.x * (1 - (5 + WEB.half + 0.5) / l), mid.y, 5, ks)).toBe(false);
    // right in the opening
    expect(onWeb(50, 0, 5, ks)).toBe(false);
    // the middle of the web
    expect(onWeb(0, 0, 5, ks)).toBe(false);
    // a keeper standing still at the centre is caught before the web snaps
    expect(onWeb(0, 0, 5, webKnots(0, 0, WEB.rEnd + 0.5, 0, WEB.knots))).toBe(true);
    expect(onWeb(0, 0, 5, webKnots(0, 0, WEB.rEnd + 0.5, 0, WEB.knotsChamp))).toBe(true);
  });
});

// ---------------------------------------------------------------- headless run
describe('star weaver in the real World (floor 5)', () => {
  it('20 s: stays in the room, telegraphs before every web burns, never shoots, dies cleanly', () => {
    const w = world('f5x-run');
    const room = w.room;
    const p = w.player;
    // keep the keeper strafing around the room centre
    const cx = room.centerX;
    const cy = room.centerY;
    w.inputSource = (ww, pl, o) => {
      clearInput(o);
      const gx = cx + Math.cos(ww.time * 0.9) * 50;
      const gy = cy + Math.sin(ww.time * 1.3) * 26;
      const dx = gx - pl.x;
      const dy = gy - pl.y;
      const l = Math.hypot(dx, dy);
      if (l > 3) {
        o.mx = dx / l;
        o.my = dy / l;
      }
    };
    const e = spawn(w);
    const seen = new Set<StarWeb>();
    let armedBeforeTel = 0;
    let shots = 0;
    let maxWebs = 0;
    let telMax = 0;
    steps(w, secs(20), () => {
      for (const o of w.enemies) {
        expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true);
        expect(o.x).toBeGreaterThan(room.interiorX - 4);
        expect(o.y).toBeGreaterThan(room.interiorY - 4);
        expect(o.x).toBeLessThan(room.interiorX + room.interiorW + 4);
        expect(o.y).toBeLessThan(room.interiorY + room.interiorH + 4);
      }
      telMax = Math.max(telMax, e.telegraphMax);
      for (const s of webs(w)) {
        if (!seen.has(s)) {
          seen.add(s);
          // a web is born harmless, with the weaver flashing its warning
          expect(s.armed).toBe(false);
          expect(e.telegraphT).toBeGreaterThan(0);
        }
        if (s.armed && s.age < WEB.mark) armedBeforeTel++;
      }
      maxWebs = Math.max(maxWebs, liveWebs(w).length);
      shots += enemyShots(w).length;
      p.soul = Math.max(p.soul, 40);
    });
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(armedBeforeTel).toBe(0);
    expect(maxWebs).toBe(1);
    expect(shots).toBe(0);
    expect(telMax).toBeGreaterThanOrEqual(0.3);
    expect(e.mem.weaving === 0 || e.mem.weaving === 1).toBe(true);
    // death: the weaver and its web go, nothing is left behind
    e.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, secs(0.6));
    expect(e.dead).toBe(true);
    expect(weavers(w)).toHaveLength(0);
    expect(webs(w)).toHaveLength(0);
    expect(w.entities.some((x) => x instanceof StarWeb)).toBe(false);
    expect(enemyShots(w)).toHaveLength(0);
  }, 30000);

  it('traces the web harmlessly for ≥ 0.3 s, then a keeper who never moves takes exactly one base-strength hit and is thrown out', () => {
    const w = world('f5x-still');
    const p = w.player;
    const calls = spyHurt(w);
    const e = spawn(w);
    const web = untilWeb(w)!;
    expect(web).toBeTruthy();
    // centred on the keeper, opening toward the weaver
    expect(Math.hypot(web.x - p.x, web.y - p.y)).toBeLessThan(1);
    expect(Math.abs(angleDiff(web.gapDir, Math.atan2(e.y - web.y, e.x - web.x)))).toBeLessThan(0.6);
    expect(e.telegraphMax).toBeGreaterThanOrEqual(0.3);
    expect(e.anim).toBe('sweaver_weave');
    // tracing: a keeper standing right where a thread will burn is not hurt
    const k = web.knots();
    const onThread = { x: (k[3].x + k[4].x) / 2, y: (k[3].y + k[4].y) / 2 };
    const home = { x: p.x, y: p.y };
    let traced = 0;
    // (the threads ignite on the step the web turns WEB.mark old)
    while (web.age + FIXED_DT < WEB.mark - 1e-9 && !web.dead) {
      p.x = onThread.x;
      p.y = onThread.y;
      w.update(FIXED_DT);
      traced++;
      expect(web.armed).toBe(false);
    }
    expect(traced * FIXED_DT).toBeGreaterThanOrEqual(0.3);
    expect(calls.filter((c) => c.web)).toHaveLength(0);
    // burning: back in the middle, standing still until it snaps
    p.x = home.x;
    p.y = home.y;
    let kb = 0;
    while (!web.dead && web.brokenT <= 0) {
      const n = calls.length;
      w.update(FIXED_DT);
      if (calls.length > n && calls[calls.length - 1].web && calls[calls.length - 1].applied) {
        kb = (p.x - web.x) * p.kbx + (p.y - web.y) * p.kby;
        // a keeper at the very centre is thrown out through the opening
        if (Math.hypot(p.x - web.x, p.y - web.y) < 0.5) kb = Math.cos(web.gapDir) * p.kbx + Math.sin(web.gapDir) * p.kby;
      }
    }
    // the weaver lets go (it sees the snap on its next step)
    steps(w, 2);
    expect(e.anim).toBe('sweaver_idle');
    expect(e.mem.weaving).toBe(0);
    const hits = calls.filter((c) => c.web && c.applied);
    expect(hits).toHaveLength(1);
    expect(hits[0].hh).toBe(1);
    expect(hits[0].raw).toBe(false);
    expect(kb).toBeGreaterThan(0);
  });

  it('a keeper who walks out through the opening is never hurt by the web', () => {
    const w = world('f5x-gap');
    const p = w.player;
    const calls = spyHurt(w);
    spawn(w, ID, 80, -20);
    const web = untilWeb(w)!;
    expect(web).toBeTruthy();
    const dir = web.gapDir;
    const speed = 80;
    while (!web.dead && web.brokenT <= 0) {
      const d = Math.hypot(p.x - web.x, p.y - web.y);
      if (d < WEB.r0 + 12) {
        p.x += Math.cos(dir) * speed * FIXED_DT;
        p.y += Math.sin(dir) * speed * FIXED_DT;
      }
      w.update(FIXED_DT);
    }
    expect(calls.filter((c) => c.web)).toHaveLength(0);
  });

  it('a keeper outside the ring is never hurt; one inside the ring but off the threads is not hurt until they meet', () => {
    const w = world('f5x-out');
    const p = w.player;
    const calls = spyHurt(w);
    spawn(w, ID, 80, -20);
    const web = untilWeb(w)!;
    const away = web.gapDir + Math.PI;
    let firstHitR = -1;
    let dist0 = 0;
    // stand 30 px inside the ring on the side away from the opening
    while (!web.dead && web.brokenT <= 0) {
      p.x = web.x + Math.cos(away) * 30;
      p.y = web.y + Math.sin(away) * 30;
      p.kbx = p.kby = 0;
      dist0 = 30;
      w.update(FIXED_DT);
      if (firstHitR < 0 && calls.some((c) => c.web && c.applied)) firstHitR = web.radius;
    }
    // the ring met the keeper (radius ≈ 30 + keeper radius + thread half width), not earlier
    expect(firstHitR).toBeGreaterThan(dist0);
    expect(firstHitR).toBeLessThan(dist0 + p.r + WEB.half + 3);

    // a second web; this time the keeper waits well outside it
    const w2 = world('f5x-out2');
    const p2 = w2.player;
    const calls2 = spyHurt(w2);
    spawn(w2, ID, 80, -20);
    const web2 = untilWeb(w2)!;
    const far = web2.gapDir + Math.PI;
    while (!web2.dead && web2.brokenT <= 0) {
      p2.x = web2.x + Math.cos(far) * (WEB.r0 + 14);
      p2.y = web2.y + Math.sin(far) * (WEB.r0 + 14) * 0.6;
      w2.update(FIXED_DT);
    }
    expect(calls2.filter((c) => c.web)).toHaveLength(0);
  });

  it('killing the weaver breaks its web at once (harmless, gone within 0.4 s)', () => {
    const w = world('f5x-kill');
    const p = w.player;
    const calls = spyHurt(w);
    const e = spawn(w);
    const web = untilWeb(w)!;
    steps(w, secs(WEB.mark + 0.3));
    expect(web.armed).toBe(true);
    e.takeHit(w, { damage: 1e6, kind: 'projectile', dirX: 1, dirY: 0 });
    steps(w, 2);
    expect(web.armed).toBe(false);
    // the keeper steps onto a (slack) thread: nothing
    const k = web.knots();
    p.x = (k[2].x + k[3].x) / 2;
    p.y = (k[2].y + k[3].y) / 2;
    steps(w, secs(0.4));
    expect(web.dead).toBe(true);
    expect(calls.filter((c) => c.web)).toHaveLength(0);
    expect(w.entities.some((x) => x instanceof StarWeb)).toBe(false);
  });

  it('a stunned or frozen weaver drops its web', () => {
    for (const kind of ['stun', 'freeze'] as const) {
      const w = world(`f5x-${kind}`);
      const e = spawn(w);
      const web = untilWeb(w)!;
      steps(w, secs(WEB.mark + 0.2));
      expect(web.armed).toBe(true);
      e.applyStatus({ kind, duration: 1 }, () => 0);
      steps(w, 2);
      expect(web.armed, kind).toBe(false);
      steps(w, secs(0.4));
      expect(web.dead, kind).toBe(true);
    }
  });

  it('a bullet-clear erases the web', () => {
    const w = world('f5x-clear');
    spawn(w);
    const web = untilWeb(w)!;
    steps(w, secs(WEB.mark + 0.2));
    expect(w.clearEnemyBullets(web.x, web.y)).toBeGreaterThanOrEqual(1);
    steps(w, 1);
    expect(web.armed).toBe(false);
    steps(w, secs(0.4));
    expect(web.dead).toBe(true);
  });

  it('two weavers never hang two webs at once', () => {
    const w = world('f5x-two');
    w.player.god = true;
    spawn(w, ID, 80, -20);
    spawn(w, ID, -80, 20);
    let most = 0;
    let total = 0;
    const seen = new Set<StarWeb>();
    steps(w, secs(14), () => {
      const ws = liveWebs(w);
      most = Math.max(most, ws.length);
      for (const s of ws) seen.add(s);
      total = seen.size;
    });
    expect(most).toBe(1);
    // both still get to weave in turn
    expect(total).toBeGreaterThanOrEqual(4);
    const owners = new Set([...seen].map((s) => s.owner));
    expect(owners.size).toBe(2);
  }, 30000);

  it('a champion weaves more knots and its web turns while it closes', () => {
    const w = world('f5x-champ');
    w.player.god = true;
    const e = spawn(w);
    e.champion = true;
    e.championColor = '#ff4040';
    const web = untilWeb(w)!;
    expect(web.n).toBe(WEB.knotsChamp);
    expect(Math.abs(web.spin)).toBeCloseTo(WEB.spinChamp, 6);
    const g0 = web.gapDir;
    steps(w, secs(WEB.mark + 1));
    expect(Math.abs(angleDiff(web.gapDir, g0))).toBeGreaterThan(0.3);
  });

  it('an elite weaver’s web hits with the elite damage scale (heavier, never raw)', () => {
    const w = world('f5x-elite');
    const p = w.player;
    const calls = spyHurt(w);
    const e = spawn(w);
    e.enemyDamageScale = 1.5;
    const web = untilWeb(w)!;
    expect(web.enemyDamageScale).toBe(1.5);
    const before = p.red + p.soul;
    while (!web.dead && web.brokenT <= 0) w.update(FIXED_DT);
    const hit = calls.find((c) => c.web && c.applied)!;
    expect(hit).toBeDefined();
    expect(hit.hh).toBe(1);
    expect(before - (p.red + p.soul)).toBe(2);
  });

  it('a keeper who rushes it is dodged: it leaps back (harmless in the air)', () => {
    const w = world('f5x-hop');
    const p = w.player;
    w.player.god = true;
    const e = spawn(w, ID, 60, 0);
    let leapt = false;
    let harmlessAir = true;
    for (let i = 0; i < secs(8) && !leapt; i++) {
      // stick to the weaver
      p.x = e.x - 20;
      p.y = e.y;
      w.update(FIXED_DT);
      if (e.z > 2) {
        leapt = true;
        if (e.harmful) harmlessAir = false;
      }
    }
    expect(leapt).toBe(true);
    expect(harmlessAir).toBe(true);
    // it lands further away than it took off
    while (e.z > 0) w.update(FIXED_DT);
    expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------- review fixes
/** A floor-5 room built from a room template (no doors), to swap into a test World. */
function templateRoom(w: World, id: string): Room {
  const t = RoomTemplates.must(id);
  const [cw, ch] = t.shape.split('x').map(Number);
  const node = { id: 900, gx: 0, gy: 0, cw, ch, kind: 'normal', templateId: id, seed: 7, depth: 1, visited: true, cleared: false, discovered: true, locked: false, doors: [] } as unknown as RoomNode;
  return new Room(node, Themes.get(w.floor.theme) ?? Themes.all()[0], t);
}

/** Every floor-5 template, a keeper who reacts after 0.25 s and walks out through the opening. */
function dodgeRun(w: World, kx: number, ky: number, sx: number, sy: number, champion: boolean): { webs: number; hits: number } {
  const p = w.player;
  p.x = kx;
  p.y = ky;
  const e = w.spawnEnemy(ID, sx, sy)!;
  if (champion) {
    e.champion = true;
    e.championColor = '#ff4040';
  }
  const calls = spyHurt(w);
  let react = 0;
  w.inputSource = (ww, pl, o) => {
    clearInput(o);
    const web = liveWebs(ww)[0];
    if (!web) {
      react = 0;
      return;
    }
    react += FIXED_DT;
    if (react < 0.25 || Math.hypot(pl.x - web.x, pl.y - web.y) > web.radius + 9) return;
    const dx = web.x + Math.cos(web.gapDir) * (WEB.r0 + 18) - pl.x;
    const dy = web.y + Math.sin(web.gapDir) * (WEB.r0 + 18) - pl.y;
    const l = Math.hypot(dx, dy);
    if (l > 2) {
      o.mx = dx / l;
      o.my = dy / l;
    }
  };
  const seen = new Set<StarWeb>();
  steps(w, secs(12), () => {
    for (const s of webs(w)) seen.add(s);
    p.soul = Math.max(p.soul, 40);
  });
  return { webs: seen.size, hits: calls.filter((c) => c.web && c.applied).length };
}

describe('star weaver review fixes', () => {
  it('the opening always leads to open floor: laneClear / pickGap refuse rocks, pits and walls', () => {
    const w = world('f5x-lane');
    const room = w.room;
    const cx = room.centerX;
    const cy = room.centerY;
    // open floor: the weaver's own direction is kept
    expect(laneClear(room, cx, cy, 0, cx, cy)).toBe(true);
    expect(pickGap(w, cx, cy, 0, cx, cy)).toBe(0);
    // a rock 3 tiles out along the opening (between the two points the old check sampled) blocks it
    const tx = Math.floor((cx + 48) / TILE);
    const ty = Math.floor(cy / TILE);
    room.setTile(tx, ty, Tile.ROCK);
    expect(laneClear(room, cx, cy, 0, cx, cy)).toBe(false);
    const g = pickGap(w, cx, cy, 0, cx, cy)!;
    expect(g).not.toBeNull();
    expect(Math.abs(angleDiff(g, 0))).toBeGreaterThan(0.2);
    expect(laneClear(room, cx, cy, g, cx, cy)).toBe(true);
    // a keeper boxed in by pits: no way out, so no web at all
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) room.setTile(Math.floor(cx / TILE) + dx, Math.floor(cy / TILE) + dy, Tile.PIT);
    }
    expect(pickGap(w, cx, cy, 0, cx, cy)).toBeNull();
    // ... and a weaver facing that keeper never spins one
    const e = spawn(w, ID, 90, 0);
    let seen = 0;
    steps(w, secs(6), () => {
      seen += webs(w).length;
    });
    expect(e.alive).toBe(true);
    expect(seen).toBe(0);
  });

  it('it only weaves around a keeper it can see (no web through a wall of rocks)', () => {
    const w = world('f5x-los');
    const room = w.room;
    const p = w.player;
    const tx = Math.floor((p.x + 40) / TILE);
    for (let ty = Math.floor(room.interiorY / TILE); ty < Math.floor((room.interiorY + room.interiorH) / TILE); ty++) room.setTile(tx, ty, Tile.BLOCK);
    w.player.god = true;
    spawn(w, ID, 90, 0);
    let seen = 0;
    steps(w, secs(6), () => {
      seen += webs(w).length;
    });
    expect(seen).toBe(0);
  });

  it('a keeper who walks out through the opening is never hurt, in every floor-5 room template (champion too)', () => {
    const ids = RoomTemplates.all().filter((t) => t.kinds.includes('normal') && (!t.floors || t.floors.includes(5))).map((t) => t.id);
    expect(ids.length).toBeGreaterThan(20);
    let total = 0;
    for (const id of ids) {
      for (const champion of [false, true]) {
        const w = world(`f5x-tpl-${id}`);
        w.room = templateRoom(w, id);
        const rng = new RNG(`${id}:${champion}`);
        const k = w.room.randomFreePos(rng, 6);
        const s = w.room.randomFreePos(rng, 8, { x: k.x, y: k.y, dist: 80 });
        const r = dodgeRun(w, k.x, k.y, s.x, s.y, champion);
        expect(r.hits, `${id} champion=${champion}`).toBe(0);
        total += r.webs;
      }
    }
    // it still weaves in most rooms
    expect(total).toBeGreaterThan(ids.length * 2);
  }, 60000);

  it('a time stop holds the web with its weaver', () => {
    const w = world('f5x-stop');
    w.player.god = true;
    const e = spawn(w);
    const web = untilWeb(w)!;
    steps(w, secs(WEB.mark + 0.3));
    expect(web.armed).toBe(true);
    const r0 = web.radius;
    const ex = e.x;
    timeStop(w, 1);
    steps(w, secs(0.6));
    expect(r0 - web.radius).toBeLessThan(1.5);
    expect(Math.abs(e.x - ex)).toBeLessThan(1);
    steps(w, secs(1));
    // time runs again: it tightens again
    const r1 = web.radius;
    steps(w, secs(0.2));
    expect(r1 - web.radius).toBeGreaterThan(3);
  });

  it('a web broken while being traced ends the weaver’s warning and pose at once', () => {
    const w = world('f5x-stuntrace');
    w.player.god = true;
    const e = spawn(w);
    const web = untilWeb(w)!;
    steps(w, 6);
    expect(e.telegraphT).toBeGreaterThan(0.3);
    e.applyStatus({ kind: 'stun', duration: 0.1 }, () => 0);
    steps(w, 2);
    expect(web.armed).toBe(false);
    expect(e.telegraphT).toBeLessThanOrEqual(0);
    steps(w, secs(0.15));
    expect(e.anim).toBe('sweaver_idle');
    expect(e.mem.weaving).toBe(0);
  });
});

// ---------------------------------------------------------------- draw purity / lockstep
describe('star weaver draw purity and determinism', () => {
  function strafe(w: World): void {
    const cx = w.room.centerX;
    const cy = w.room.centerY;
    w.inputSource = (ww, p, o) => {
      clearInput(o);
      const gx = cx + Math.cos(ww.time * 0.9) * 50;
      const gy = cy + Math.sin(ww.time * 1.3) * 26;
      const dx = gx - p.x;
      const dy = gy - p.y;
      const l = Math.hypot(dx, dy);
      if (l > 3) {
        o.mx = dx / l;
        o.my = dy / l;
      }
    };
  }

  it('drawing never changes the simulation state', () => {
    const w = world('f5x-pure');
    w.player.god = true;
    strafe(w);
    spawn(w, ID, 70, -10);
    spawn(w, ID, -70, 10).champion = true;
    for (let i = 0; i < 600; i++) {
      w.update(FIXED_DT);
      if (i % 3 !== 0) continue;
      const before = stateHash(w);
      w.draw(1);
      expect(stateHash(w), `step ${i}`).toBe(before);
    }
  }, 60000);

  it('the simulation does not depend on the cosmetic rng or on drawing', () => {
    const run = (fxSeed: number, draw: boolean): number[] => {
      fx.setState(new RNG(fxSeed).getState());
      const w = world('f5x-det');
      w.player.god = true;
      strafe(w);
      spawn(w, ID, 70, -10);
      spawn(w, ID, -60, 30).champion = true;
      spawn(w, 'void_eye', -70, -20);
      const hs: number[] = [];
      for (let i = 0; i < 720; i++) {
        w.update(FIXED_DT);
        if (draw && i % 2) w.draw(1);
        hs.push(stateHash(w));
      }
      return hs;
    };
    const a = run(1, false);
    const b = run(0x9e3779b9, true);
    const first = a.findIndex((h, i) => h !== b[i]);
    expect(first, `diverged at step ${first}`).toBe(-1);
  }, 60000);
});
