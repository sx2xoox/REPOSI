// Headless co-op lockstep harness: 2–4 real Worlds in one process, each driven
// by its own NetRun over the in-memory network (latency, jitter, loss) — the
// same code path as the browser, minus the scene / renderer. Each peer's bot
// (tests/detsim.ts botInput) reads only its own world, from its own keeper's
// point of view, and talks to the simulation through the lockstep input; the
// few scripted world changes (gifts, heals, a forced downing, moving on to the
// boss) happen in NetRun.beforeStep, keyed by tick and world state only, so
// every peer applies them identically. Every simulated frame records
// stateHash(world).

import './headless';
import { fakeDisplay } from './headless';
import { loadContent } from '../src/content';
import { Renderer } from '../src/engine/renderer';
import { RNG } from '../src/engine/rng';
import { MemoryNetwork, type LinkOptions, type MemoryTransport } from '../src/net/transport-memory';
import { LockstepClient, LockstepHost, STEP_MS, type DesyncEvent } from '../src/net/lockstep';
import type { NetSession } from '../src/net/session';
import { NetRun } from '../src/net/netrun';
import { World, type WorldHost, type PartyMember } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Artifacts, Actives } from '../src/game/defs';
import { emptyInput, fixedRules } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import { blessingChoices, blessingDue } from '../src/game/blessings';
import { discardBlockFor } from '../src/game/interact';
import { botInput, newBot, type BotState } from './detsim';
import type { Frame } from '../src/net/wire';

loadContent();

export interface CoopScenario {
  name: string;
  seed: string;
  /** characters by slot (2..4 keepers) */
  chars: string[];
  floor?: number;
  /** virtual milliseconds to run */
  ms: number;
  link: LinkOptions;
  /** host tick at which the party is sent to the boss room */
  bossAt: number;
  /** tick at which slot 1 is forced down (0 = never) */
  downAt: number;
  /** client local step at which the last slot leaves the session (0 = never) */
  leaveAt: number;
  /** client local step at which slot 1 discards an artifact (0 = never) */
  discardAt: number;
  /** clock drift per client (fraction) */
  drift?: number[];
  /** test only: nudge the last keeper by 1e-9 px on one peer at this tick (desync detection) */
  inject?: { slot: number; tick: number };
}

export interface CoopPeer {
  slot: number;
  world: World;
  net: NetRun;
  bot: BotState;
  /** stateHash after every simulated frame, by tick */
  hashes: number[];
  nextAt: number;
  period: number;
  steps: number;
  gone: boolean;
  blessed: number;
  desyncs: DesyncEvent[];
  /** scripted happenings seen (identical on every peer) */
  log: string[];
}

export interface CoopResult {
  peers: CoopPeer[];
  net: MemoryNetwork;
  host: LockstepHost;
}

const stubHost: WorldHost = { openInventory() {}, onGameOver() {} };
let renderer: Renderer | null = null;

/** Run a scenario; returns every peer (hash sequences, worlds, logs). */
export function runCoop(sc: CoopScenario): CoopResult {
  if (!renderer) renderer = new Renderer(fakeDisplay(1280, 720));
  const n = sc.chars.length;
  const net = new MemoryNetwork({ seed: sc.seed.length * 7919 + n, ...sc.link });
  const ht = net.hostSync('COOP');
  const cts: MemoryTransport[] = [];
  for (let i = 1; i < n; i++) cts.push(net.joinSync('COOP'));
  net.advance(400);
  const members: PartyMember[] = sc.chars.map((c, slot) => ({ slot, characterId: c, name: ['방장', '둘째', '셋째', '넷째'][slot] }));
  const players = [{ slot: 0, peer: ht.localId }, ...cts.map((t, i) => ({ slot: i + 1, peer: t.localId }))];
  const host = new LockstepHost(ht, players, 0, { now: net.now });
  const clients = cts.map((t, i) => new LockstepClient(t, i + 1, { now: net.now, initialBuffer: 2 }));
  const phase = new RNG(`${sc.seed}:phase`);

  const peers: CoopPeer[] = [];
  for (let slot = 0; slot < n; slot++) {
    const client = slot === 0 ? null : clients[slot - 1];
    const session = {
      role: slot === 0 ? 'host' : 'client', host: slot === 0 ? host : null, client, localSlot: slot, closed: false, game: null,
      transport: slot === 0 ? ht : cts[slot - 1], code: 'COOP', roster: [], start: null, rtt: () => 0,
      close() {}, detach() { return slot === 0 ? ht : cts[slot - 1]; },
    } as unknown as NetSession;
    const run = new RunState(sc.seed, sc.chars[slot]);
    run.seeded = true;
    const world = new World(renderer, run, stubHost);
    world.rules = fixedRules({ hitStop: true });
    world.startParty(members, slot);
    if (sc.floor && sc.floor > 1) world.withIds(() => world.startFloor(sc.floor!));
    const nr = new NetRun(session, { seed: sc.seed, roster: [], buildId: 'test', inputDelayHint: 2 }, world);
    const peer: CoopPeer = {
      slot, world, net: nr, bot: newBot(`${sc.seed}:${slot}`), hashes: [], nextAt: net.time + (slot === 0 ? 0 : 1 + phase.next() * STEP_MS),
      period: STEP_MS * (1 + (slot === 0 ? 0 : sc.drift?.[slot - 1] ?? 0)), steps: 0, gone: false, blessed: 0, desyncs: [], log: [],
    };
    session.game?.observe((f: Frame) => {
      peer.hashes[f.tick] = stateHash(world);
    });
    nr.beforeStep = (w, tick) => script(sc, peer, w, tick);
    const ls = slot === 0 ? host : client!;
    const netHandler = ls.onDesync;
    ls.onDesync = (e) => {
      peer.desyncs.push(e);
      netHandler?.(e);
    };
    peers.push(peer);
  }

  const sample = emptyInput();
  const stepPeer = (p: CoopPeer) => {
    if (p.gone) return;
    p.steps++;
    if (p.slot === 0) host.poll();
    else clients[p.slot - 1].poll();
    const w = p.world;
    // the keeper's own decisions: blessing picks and a discard go out as commands
    if (blessingDue(w) && p.blessed !== w.run.floor) {
      p.blessed = w.run.floor;
      const choices = blessingChoices(w);
      p.net.sendCommand({ type: 'bless', floor: w.run.floor, id: choices.length ? choices[p.slot % choices.length] : null });
    }
    if (p.slot === 1 && p.steps === sc.discardAt) {
      const it = w.local.inv.items.find((x) => !discardBlockFor(w, x.id));
      if (it) p.net.sendCommand({ type: 'discard', id: it.id });
    }
    if (p.slot === n - 1 && p.slot > 0 && p.steps === sc.leaveAt) {
      clients[p.slot - 1].leave();
      p.gone = true;
      return;
    }
    if (w.local.alive) botInput(w, p.bot, sample);
    else {
      // downed: drift toward the nearest teammate
      const mate = w.players.find((q) => q !== w.local && q.alive);
      sample.mx = sample.my = sample.ax = sample.ay = 0;
      sample.held = sample.pressed = 0;
      if (mate) {
        const d = Math.hypot(mate.x - w.local.x, mate.y - w.local.y) || 1;
        sample.mx = (mate.x - w.local.x) / d;
        sample.my = (mate.y - w.local.y) / d;
      }
    }
    p.net.step(sample);
  };

  const end = net.time + sc.ms;
  while (net.time < end) {
    net.advance(1);
    for (const p of peers) {
      while (p.nextAt <= net.time) {
        stepPeer(p);
        p.nextAt += p.period;
      }
    }
  }
  return { peers, net, host };
}

/** Scripted world changes before each frame (tick + world state only: identical on every peer). */
function script(sc: CoopScenario, peer: CoopPeer, w: World, tick: number): void {
  const log = (s: string) => peer.log.push(`${tick}:${s}`);
  if (sc.inject && sc.inject.slot === peer.slot && sc.inject.tick === tick) w.players[w.players.length - 1].x += 1e-9;
  if (tick === 3) {
    // every keeper starts with a couple of artifacts and an active (something to discard / use)
    const arts = Artifacts.all().filter((a) => !a.hidden && !a.blessing).map((a) => a.id);
    const acts = Actives.all().map((a) => a.id);
    const r = new RNG(`${sc.seed}:gifts`);
    for (const p of w.players) {
      for (let i = 0; i < 3; i++) p.items.give(r.pick(arts));
      w.asPlayer(p, () => p.setActive(r.pick(acts), w));
    }
    w.players[0].coins = Math.max(w.players[0].coins, 20);
    log('gifts');
  }
  if (w.gameOver || w.transitioning || w.descending) return;
  // keep the party alive (the scripted downing below excepted)
  for (const p of w.players) {
    if (!p.alive || p.downed) continue;
    if (p.red + p.soul <= 2) {
      p.heal(6);
      p.addSoul(2);
    }
  }
  // a downing and a revive by standing next to the ghost
  if (sc.downAt > 0 && tick >= sc.downAt) {
    const v = w.players.find((p) => p.slot === 1);
    const helper = w.players.find((p) => p.slot === 0);
    if (v && helper && !peer.log.some((s) => s.endsWith(':downed'))) {
      v.invuln = 0;
      v.shields = 0;
      v.god = false;
      v.stats.dodge = 0;
      if (v.hurt(w, 40, '시험', true) && v.downed) log('downed');
    } else if (v?.downed && helper?.alive && tick > sc.downAt + 30) {
      const f = w.room.nearestFree(v.x + 8, v.y, helper.r);
      helper.x = f.x;
      helper.y = f.y;
    }
    if (v && !v.downed && peer.log.some((s) => s.endsWith(':downed')) && !peer.log.some((s) => s.endsWith(':revived'))) log('revived');
  }
  // move on: to the boss, out of stuck fights, on from long-cleared rooms
  if (sc.bossAt > 0 && tick >= sc.bossAt && w.run.floor === (sc.floor ?? 1) && !peer.log.some((s) => s.endsWith(':boss'))) {
    const boss = w.map.nodes.find((x) => x.kind === 'boss');
    if (boss && boss !== w.node) w.teleportTo(boss);
    log('boss');
    return;
  }
  if (!w.node.cleared && w.roomTime > (w.node.kind === 'boss' ? 30 : 25)) {
    for (const e of [...w.enemies]) w.killEnemy(e);
    log(`kill-stuck r${w.node.id}`);
  }
  if (w.node.cleared && w.roomTime > 14 && w.node.kind !== 'boss') {
    const next = w.map.nodes.find((x) => !x.visited && x.kind !== 'boss');
    if (next) {
      w.teleportTo(next);
      log(`tp r${next.id}`);
    }
  }
  if (w.node.kind === 'boss' && w.node.cleared && w.roomTime > 16) {
    w.descend();
    log('descend');
  }
}
