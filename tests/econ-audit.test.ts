// Match economy audit (opt-in): a headless explorer plays staged runs floor by
// floor (clears every room it can walk into, loots every free pickup and chest,
// strikes matches by a fixed priority) and prints, per floor, the matches held at
// each stage start, gained and spent, seals opened / seen, stone lanterns lit /
// seen and secret rooms found.
//
//   ECON_AUDIT=1 [ECON_SEEDS=8] [ECON_CHARS=ria,niel,bern] npx vitest run tests/econ-audit
//
// Policy: seal doors first (any match), then sealed chests (any match), then
// stone lanterns (2+ matches held), then cold sconces (2+ held, or a release when
// the gauge is full). Shops: buys matches while holding fewer than 2.

import './headless';
import { describe, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Chest, Pickup } from '../src/game/pickups';
import { SealLamp } from '../src/game/seal-lamp';
import { StoneLantern } from '../src/game/stone-lantern';
import { ColdSconce } from '../src/game/cold-sconce';
import { Enemy } from '../src/game/enemy';
import type { RoomNode } from '../src/game/dungeon';
import type { Entity } from '../src/game/entity';

const ON = !!process.env.ECON_AUDIT;
const SEEDS = Number(process.env.ECON_SEEDS ?? 8);
const CHARS = (process.env.ECON_CHARS ?? 'ria,niel,bern').split(',');
const DT = 1 / 60;

interface StageRow { floor: number; stage: number; held: number; gained: number; spent: number; sealsSeen: number; sealsOpened: number; lanternsSeen: number; lanternsLit: number; secrets: number; secretRooms: number }

function step(w: World, n = 1): void {
  for (let i = 0; i < n; i++) w.update(DT);
}

function standNear(w: World, e: Entity): void {
  const spot = w.room.nearestFree(e.x, e.y + 12, 6);
  const p = w.player;
  p.x = spot.x;
  p.y = spot.y;
  p.vx = p.vy = 0;
}

function clearRoom(w: World): void {
  for (let t = 0; t < 900 && !w.node.cleared; t++) {
    if (t % 6 === 0) for (const e of [...w.enemies]) if (!e.dead) w.killEnemy(e);
    step(w);
  }
  step(w, 30);
}

function loot(w: World): void {
  for (let round = 0; round < 6; round++) {
    step(w, 50);
    let any = false;
    for (const e of [...w.entities]) {
      if (e.dead) continue;
      if (e instanceof Pickup && e.price === 0 && e.kind !== 'potion') {
        if (e.tryCollect(w)) any = true;
      } else if (e instanceof Chest && !e.opened && !e.locked) {
        e.opened = true;
        w.openChest(e);
        any = true;
      } else if (e instanceof Chest && !e.opened && e.locked && w.player.matches >= 1) {
        standNear(w, e);
        if (e.interact(w)) any = true;
      }
    }
    if (!any) break;
  }
}

function shop(w: World): void {
  for (const e of [...w.entities]) {
    if (e instanceof Pickup && e.price > 0 && e.kind === 'match' && w.player.matches < 2 && w.player.coins >= e.price) {
      e.grace = 0;
      e.tryCollect(w);
    }
  }
}

function runStages(seed: string, char: string): StageRow[] {
  const run = new RunState(seed, char);
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(640, 360)), run, { openInventory() {}, onGameOver() {} });
  w.start();
  for (const p of w.players) p.god = true;
  const rows: StageRow[] = [];
  for (let floor = 1; floor <= 7; floor++) {
    for (let stage = 1; stage <= 3; stage++) {
      w.run.stage = stage;
      w.startFloor(floor);
      step(w, 30);
      const row: StageRow = { floor, stage, held: w.player.matches, gained: 0, spent: 0, sealsSeen: 0, sealsOpened: 0, lanternsSeen: 0, lanternsLit: 0, secrets: 0, secretRooms: w.map.nodes.filter((n) => n.kind === 'secret').length };
      const used0 = w.run.stats.matchesUsed;
      const secrets0 = w.run.stats.secretsFound;
      const start = w.player.matches;
      const done = new Set<number>();
      const seenSeal = new Set<SealLamp>();
      const seenLantern = new Set<StoneLantern>();
      const visit = (node: RoomNode): void => {
        if (done.has(node.id)) return;
        done.add(node.id);
        w.teleportTo(node);
        step(w, 30);
        clearRoom(w);
        if (node.kind === 'shop') shop(w);
        loot(w);
        for (const e of w.entities) {
          if (e instanceof SealLamp) seenSeal.add(e);
          if (e instanceof StoneLantern) seenLantern.add(e);
        }
      };
      // walk everything open, then strike matches by priority and walk on
      for (let pass = 0; pass < 6; pass++) {
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of w.map.nodes) {
            if (done.has(n.id) || n.locked || n.kind === 'secret') continue;
            if (!n.doors.some((d) => done.has(d.to) && !d.secret) && n.id !== w.map.startId) continue;
            visit(n);
            grew = true;
          }
        }
        let acted = false;
        // seals
        for (const n of w.map.nodes) {
          if (!done.has(n.id) || w.player.matches < 1) continue;
          if (!n.doors.some((d) => !d.secret && w.map.nodes[d.to].locked)) continue;
          w.teleportTo(n);
          step(w, 30);
          for (const lamp of w.entities.filter((e): e is SealLamp => e instanceof SealLamp && !e.lit)) {
            if (w.player.matches < 1) break;
            standNear(w, lamp);
            if (lamp.interact(w)) acted = true;
          }
        }
        // a sealed room just opened: walk into it
        for (const n of w.map.nodes) if (!done.has(n.id) && !n.locked && n.kind !== 'secret' && n.doors.some((d) => done.has(d.to) && !d.secret)) { visit(n); acted = true; }
        // lanterns, then sconces
        for (const n of w.map.nodes) {
          if (!done.has(n.id)) continue;
          w.teleportTo(n);
          step(w, 20);
          for (const l of w.entities.filter((e): e is StoneLantern => e instanceof StoneLantern && !e.lit)) {
            if (w.player.matches < 2) break;
            standNear(w, l);
            if (l.interact(w)) { acted = true; loot(w); }
          }
          for (const s of w.entities.filter((e): e is ColdSconce => e instanceof ColdSconce && !e.lit)) {
            if (w.player.matches >= 2) {
              standNear(w, s);
              const p = w.player;
              p.x = s.x;
              p.y = s.y + 4;
              if (s.interact(w)) acted = true;
            }
          }
        }
        for (const n of w.map.nodes) if (!done.has(n.id) && n.kind === 'secret' && n.doors.some((d) => done.has(d.to) && (d as { revealed?: boolean }).revealed)) { visit(n); acted = true; }
        if (!acted) break;
      }
      row.spent = w.run.stats.matchesUsed - used0;
      row.gained = w.player.matches - start + row.spent;
      row.sealsSeen = seenSeal.size;
      row.sealsOpened = [...seenSeal].filter((s) => s.lit).length;
      row.lanternsSeen = seenLantern.size;
      row.lanternsLit = [...seenLantern].filter((s) => s.lit).length;
      row.secrets = w.run.stats.secretsFound - secrets0;
      rows.push(row);
      // leave enemies of the boss room dead so the next stage starts cleanly
      for (const e of w.entities) if (e instanceof Enemy) e.dead = true;
    }
  }
  return rows;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

describe.skipIf(!ON)('match economy audit', () => {
  it('prints per floor: matches held / gained / spent, seals, lanterns, secrets', () => {
    loadContent();
    const all: StageRow[] = [];
    for (const char of CHARS) for (let s = 0; s < SEEDS; s++) all.push(...runStages(`ECON-${s}`, char));
    const lines = ['floor | held@stage start (median / min) | gained/stage | spent/stage | seals opened/seen | lanterns lit/seen | secrets found/rooms'];
    for (let f = 1; f <= 7; f++) {
      const r = all.filter((x) => x.floor === f);
      const sum = (k: keyof StageRow) => r.reduce((a, x) => a + (x[k] as number), 0);
      lines.push(`${f} | ${median(r.map((x) => x.held))} / ${Math.min(...r.map((x) => x.held))} | ${(sum('gained') / r.length).toFixed(2)} | ${(sum('spent') / r.length).toFixed(2)} | ${sum('sealsOpened')}/${sum('sealsSeen')} | ${sum('lanternsLit')}/${sum('lanternsSeen')} | ${sum('secrets')}/${sum('secretRooms')}`);
    }
    const zeroStarts = all.filter((x) => x.floor >= 2 && x.held === 0).length;
    lines.push(`stage starts on floors 2-7 with 0 matches: ${zeroStarts}/${all.filter((x) => x.floor >= 2).length}`);
    console.log(lines.join('\n'));
  }, 3_600_000);
});
