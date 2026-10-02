// Debug / automation hooks exposed on `window.__lk` (used by Playwright smoke
// tests and handy in the browser console).

import { app } from './game/app';
import { Actives, Artifacts, Characters, Enemies, Weapons, Potions } from './game/defs';
import type { World } from './game/world';
import { input } from './engine/input';
import { FIXED_DT } from './game/constants';

function world(): World | undefined {
  return (window as unknown as { __world?: World }).__world;
}

export interface DebugApi {
  start(seed?: string, character?: string): void;
  world(): World | undefined;
  state(): Record<string, unknown>;
  god(on?: boolean): void;
  give(id: string): boolean;
  spawn(id: string, x?: number, y?: number): boolean;
  killAll(): void;
  gotoRoom(kind: string): boolean;
  nextFloor(): void;
  step(frames: number): void;
  press(code: string, frames?: number): void;
  list(): Record<string, string[]>;
  errors: string[];
  /** the live input state (bots drive `touchMove` / `touchAim` / `touchTap`) */
  input: typeof input;
}

export function installDebug(): void {
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' '));
    origError(...args);
  };
  const api: DebugApi = {
    errors,
    input,
    start(seed = 'TEST-SEED', character) {
      const ch = character ?? Characters.all()[0]?.id;
      app.startRun(seed, ch, true);
    },
    world,
    state() {
      const w = world();
      if (!w) return { scene: 'menu' };
      const p = w.player;
      return {
        floor: w.run.floor,
        room: w.node.kind,
        roomId: w.node.id,
        cleared: w.node.cleared,
        hp: p.red,
        soul: p.soul,
        maxRed: p.maxRed,
        coins: p.coins,
        bombs: p.bombs,
        keys: p.keys,
        enemies: w.enemies.length,
        entities: w.entities.length,
        projectiles: w.projectiles.length,
        particles: w.particles.list.length,
        items: p.inv.items.map((i) => i.id),
        gameOver: w.gameOver,
        time: w.time,
        x: p.x,
        y: p.y,
      };
    },
    god(on = true) {
      const w = world();
      if (w) w.player.god = on;
    },
    give(id) {
      const w = world();
      if (!w) return false;
      if (Artifacts.has(id)) w.items.give(id);
      else if (Actives.has(id)) w.player.setActive(id, w);
      else if (Weapons.has(id)) { w.player.weaponId = id; w.items.recompute(); }
      else if (Potions.has(id)) w.player.potionId = id;
      else return false;
      return true;
    },
    spawn(id, x, y) {
      const w = world();
      if (!w || !Enemies.has(id)) return false;
      w.spawnEnemy(id, x ?? w.room.centerX, y ?? w.room.centerY - 30);
      return true;
    },
    killAll() {
      const w = world();
      if (!w) return;
      for (const e of [...w.enemies]) w.killEnemy(e);
    },
    gotoRoom(kind) {
      const w = world();
      if (!w) return false;
      const n = w.map.nodes.find((x) => x.kind === kind);
      if (!n) return false;
      w.teleportTo(n);
      return true;
    },
    nextFloor() {
      world()?.descend();
    },
    step(frames) {
      for (let i = 0; i < frames; i++) {
        input.update();
        app.scenes.update(FIXED_DT);
      }
      app.scenes.draw();
    },
    press(code, frames = 1) {
      input.simulateDown(code);
      setTimeout(() => input.simulateUp(code), frames * 16);
    },
    list() {
      return {
        characters: Characters.all().map((c) => c.id),
        enemies: Enemies.all().map((e) => e.id),
        artifacts: Artifacts.all().map((a) => a.id),
        actives: Actives.all().map((a) => a.id),
        weapons: Weapons.all().map((a) => a.id),
        potions: Potions.all().map((a) => a.id),
      };
    },
  };
  (window as unknown as { __lk: DebugApi }).__lk = api;
}
