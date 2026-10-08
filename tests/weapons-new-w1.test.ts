// New weapons (batch w1): 공명 종, 작살총 (frontier-arms.ts), 투창 묶음, 연기 향로
// (frontier-arms-2.ts), 지뢰 등잔, 중력 구슬 (trap-arms.ts), 먹물 붓, 회전 팽이추
// (trap-arms-2.ts). Registry and art, each weapon's signature mechanic in the
// real World, the dummy DPS band, draw purity (state hash), no leftovers across
// a room change, multishot and two-keeper lockstep.

import './headless';
import { describe, expect, it } from 'vitest';
import { Enemies, Weapons, defineEnemy } from '../src/game/defs';
import { FIXED_DT } from '../src/game/constants';
import { HELD, type PlayerInput } from '../src/game/seam';
import { Projectile } from '../src/game/projectile';
import { hasSprite } from '../src/engine/sprites';
import { stateHash } from '../src/game/statehash';
import type { World } from '../src/game/world';
import type { Enemy } from '../src/game/enemy';
import { DUMMY_ID, PLAIN_ID, bestDps, measureDps } from './dpsharness';
import { World as WorldClass } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { fakeDisplay } from './headless';
import { clearInput, fixedRules } from '../src/game/seam';
import type { Player } from '../src/game/player';
import { rayLength } from '../src/content/weapons/common';
import { BELL_R0, BellRing, HARPOON_REEL_MULT, HARPOON_STICK, bellRadius } from '../src/content/weapons/frontier-arms';
import { IncenseCloud, PIN_MULT, censerReach } from '../src/content/weapons/frontier-arms-2';
import { GRAVITY_PULL_R, GRAVITY_WELL, LanternMine, MINE_ARM, MINE_LIFE } from '../src/content/weapons/trap-arms';
import { INK_LIFE, INK_REHIT, InkStroke, YOYO_HOLD } from '../src/content/weapons/trap-arms-2';

const IDS = ['resonance_bell', 'harpoon_gun', 'javelin_bundle', 'smoke_censer', 'mine_lantern', 'gravity_orb', 'ink_brush', 'spin_top_yoyo'];
const SPEC: Record<string, { rarity: string; kind: string; archetype: string; tags: string[] }> = {
  resonance_bell: { rarity: 'common', kind: 'melee', archetype: '파동', tags: ['arcane'] },
  harpoon_gun: { rarity: 'common', kind: 'ranged', archetype: '작살', tags: ['gun'] },
  javelin_bundle: { rarity: 'common', kind: 'ranged', archetype: '투창', tags: ['spear'] },
  smoke_censer: { rarity: 'common', kind: 'melee', archetype: '향로', tags: ['heavy'] },
  mine_lantern: { rarity: 'rare', kind: 'ranged', archetype: '지뢰', tags: ['explosive'] },
  gravity_orb: { rarity: 'rare', kind: 'ranged', archetype: '중력', tags: ['arcane'] },
  ink_brush: { rarity: 'rare', kind: 'ranged', archetype: '붓', tags: ['staff', 'arcane'] },
  spin_top_yoyo: { rarity: 'rare', kind: 'ranged', archetype: '요요', tags: ['quick'] },
};
const TAGS = ['blade', 'spear', 'heavy', 'quick', 'bow', 'gun', 'arcane', 'staff', 'explosive'];
const BEHAVIORS = ['harpoon', 'javelin', 'mine_lob', 'gravity_orb', 'spin_top'];

/** A light test enemy: stands still, normal mass (can be pulled / knocked), never hurts. */
const LIGHT = '__w1_light';
if (!Enemies.has(LIGHT)) {
  defineEnemy({ id: LIGHT, name: '가벼운 인형', hp: 1e6, radius: 7, speed: 0, sprite: Enemies.all()[0].sprite, contactDamage: 0, mass: 1, deathFx: 'none', shadow: 0 });
}

/** A started floor-1 start room holding `weapon`, no enemies, crits off. */
function setup(weapon: string): World {
  const r = measureDps({ character: PLAIN_ID, weapon, seconds: 0, dist: 60 });
  const w = r.world;
  idle(w, 1);
  for (const e of [...r.dummies, ...w.enemies]) if (!e.dead) w.killEnemy(e);
  // past the draw delay of a freshly equipped weapon
  idle(w, 12);
  if (w.enemies.some((e) => e.alive)) throw new Error('setup: enemies left');
  w.player.stats.critChance = 0;
  return w;
}

function spawn(w: World, id: string, x: number, y: number): Enemy {
  const e = w.withIds(() => w.spawnEnemy(id, x, y))!;
  e.dormant = 0;
  return e;
}

/** Step `n` frames: fire held while `fire(i)`, cursor on `aim()`. */
function drive(w: World, n: number, fire: (i: number) => boolean, aim: () => { x: number; y: number }): void {
  let i = 0;
  w.inputSource = (_w, p, out: PlayerInput) => {
    out.mx = out.my = out.ax = out.ay = 0;
    out.pressed = 0;
    const a = aim();
    out.cx = a.x;
    out.cy = a.y;
    out.held = (fire(i) ? HELD.fire : 0) | HELD.cursorAim;
    void p;
  };
  for (; i < n; i++) w.update(FIXED_DT);
}

const idle = (w: World, n: number) => drive(w, n, () => false, () => ({ x: w.player.x + 40, y: w.player.y - 6 }));
const at = (x: number, y: number) => () => ({ x, y });
/** Damage the run recorded during `fn`. */
function dealt(w: World, fn: () => void): number {
  const before = w.run.stats.damageDealt;
  fn();
  return w.run.stats.damageDealt - before;
}
/** Count applyHit calls of a kind on `target` during `fn`. */
function countHits(w: World, target: Enemy, kind: string | null, fn: () => void): number {
  const orig = w.applyHit.bind(w);
  let n = 0;
  w.applyHit = (t, hit) => {
    const ok = orig(t, hit);
    if (ok && t === target && (!kind || hit.kind === kind)) n++;
    return ok;
  };
  try { fn(); } finally { w.applyHit = orig; }
  return n;
}
const live = <T>(w: World, C: abstract new (...a: never[]) => T) => w.entities.filter((e) => e instanceof C && !e.dead) as T[];
const shots = (w: World, id: string) => w.entities.filter((e) => e instanceof Projectile && !e.dead && e.behaviors.some((b) => b.id === id)) as Projectile[];

describe('new weapons w1: registry and art', () => {
  it('registers all eight with sprites, Korean text, archetype, tags and pools', () => {
    const names = new Set(Weapons.all().map((d) => d.name));
    expect(names.size).toBe(Weapons.all().length);
    for (const id of IDS) {
      const d = Weapons.must(id);
      const s = SPEC[id];
      expect(d.rarity, id).toBe(s.rarity);
      expect(d.kind, id).toBe(s.kind);
      expect(d.archetype, id).toBe(s.archetype);
      expect(d.tags, id).toEqual(s.tags);
      for (const t of d.tags ?? []) expect(TAGS, id).toContain(t);
      expect(d.pools, id).toEqual(['treasure', 'shop', 'boss']);
      expect(d.name, id).toMatch(/^[가-힣 ]+$/);
      expect(d.desc, id).toMatch(/[가-힣]/);
      expect(d.desc.length, id).toBeGreaterThan(10);
      expect(/\d/.test(d.desc), `${id} desc has no drifting numbers`).toBe(false);
      expect(hasSprite(d.icon), `${id} icon`).toBe(true);
      expect(hasSprite(d.heldSprite!), `${id} held`).toBe(true);
    }
    for (const s of ['w_harpoon_gun_bare', 'proj_harpoon', 'proj_javelin', 'mine_lantern_body', 'proj_gravity_orb', 'proj_spin_top_0', 'proj_spin_top_1', 'proj_spin_top_2']) expect(hasSprite(s), s).toBe(true);
  });
});

describe('공명 종: an expanding ring', () => {
  it('hits near enemies before far ones, each once, nothing past its radius, and erases bullets', () => {
    const w = setup('resonance_bell');
    const p = w.player;
    const r1 = bellRadius(p.stats.range);
    const near = spawn(w, LIGHT, p.x + 18, p.y - 3);
    const mid = spawn(w, LIGHT, p.x - (r1 - 4), p.y - 3);
    const far = spawn(w, LIGHT, p.x, p.y - 3 + r1 + 22);
    const bullet = w.withIds(() => w.spawn(new Projectile({ team: 'enemy', x: p.x + 28, y: p.y - 3, angle: 0, speed: 20, damage: 1, range: 300 })));
    idle(w, 1);
    const hp = [near.hp, mid.hp, far.hp];
    const first: number[] = [-1, -1];
    const hits = countHits(w, mid, null, () => drive(w, 30, (i) => i === 0, at(p.x + 40, p.y - 6)));
    expect(near.hp).toBeLessThan(hp[0]);
    expect(mid.hp).toBeLessThan(hp[1]);
    expect(far.hp).toBe(hp[2]);
    expect(hits).toBe(1);
    expect(bullet.dead).toBe(true);
    expect(live(w, BellRing).length).toBe(0);
    // timing: the front passes the near enemy first
    const w2 = setup('resonance_bell');
    const q = w2.player;
    const a = spawn(w2, LIGHT, q.x + BELL_R0 + 2, q.y - 3);
    const b = spawn(w2, LIGHT, q.x - (r1 - 4), q.y - 3);
    idle(w2, 1);
    const ha = a.hp, hb = b.hp;
    for (let i = 0; i < 20; i++) {
      drive(w2, 1, () => i === 0, at(q.x + 40, q.y - 6));
      if (first[0] < 0 && a.hp < ha) first[0] = i;
      if (first[1] < 0 && b.hp < hb) first[1] = i;
    }
    expect(first[0]).toBeGreaterThanOrEqual(0);
    expect(first[1]).toBeGreaterThan(first[0] + 3);
    // the wave weakens as it spreads
    expect(ha - a.hp).toBeGreaterThan(hb - b.hp);
  });
});

describe('작살총: stick, then reel', () => {
  it('a light enemy is held for a moment, then dragged toward the keeper and hit again', () => {
    const w = setup('harpoon_gun');
    const p = w.player;
    const e = spawn(w, LIGHT, p.x + 80, p.y - 4);
    idle(w, 1);
    const x0 = e.x;
    const hp0 = e.hp;
    drive(w, 1, () => true, at(e.x, e.y));
    let hitT = -1;
    for (let i = 0; i < 40 && hitT < 0; i++) {
      idle(w, 1);
      if (e.hp < hp0) hitT = i;
    }
    expect(hitT).toBeGreaterThanOrEqual(0);
    const first = hp0 - e.hp;
    const hp1 = e.hp;
    // stuck: no pull yet, and no second harpoon while holding the trigger
    drive(w, Math.round((HARPOON_STICK - 0.1) / FIXED_DT), () => true, at(e.x, e.y));
    expect(Math.abs(e.x - x0)).toBeLessThan(6);
    expect(shots(w, 'harpoon').length).toBe(1);
    idle(w, 30);
    expect(x0 - e.x).toBeGreaterThan(25);
    expect(hp1 - e.hp).toBeCloseTo(first * HARPOON_REEL_MULT, 3);
    idle(w, 40);
    expect(shots(w, 'harpoon').length).toBe(0);
  });

  it('an immovable target is not dragged but still takes the reel hit', () => {
    const w = setup('harpoon_gun');
    const p = w.player;
    const e = spawn(w, DUMMY_ID, p.x + 70, p.y - 4);
    idle(w, 1);
    const x0 = e.x;
    const n = countHits(w, e, null, () => drive(w, 90, (i) => i === 0, at(e.x, e.y)));
    expect(n).toBe(2);
    expect(e.x).toBe(x0);
  });
});

describe('투창 묶음: pins and wall pins', () => {
  it('stuns a hit enemy; one standing against a wall takes the bonus pin hit', () => {
    const open = setup('javelin_bundle');
    const p = open.player;
    const e = spawn(open, LIGHT, p.x + 60, p.y - 4);
    idle(open, 1);
    const d0 = dealt(open, () => drive(open, 1, () => true, at(e.x, e.y)));
    let d = d0;
    let stunned = false;
    for (let i = 0; i < 30; i++) {
      d += dealt(open, () => idle(open, 1));
      stunned ||= e.hasStatus('stun');
    }
    expect(stunned).toBe(true);
    const plain = d;
    expect(plain).toBeGreaterThan(0);

    const wall = setup('javelin_bundle');
    const q = wall.player;
    const toWall = rayLength(wall, q.x, q.y - 4, 0, 400);
    const f = spawn(wall, LIGHT, q.x + toWall - 8, q.y - 4);
    idle(wall, 1);
    const pinned = dealt(wall, () => drive(wall, 40, (i) => i === 0, at(f.x, f.y)));
    expect(pinned).toBeCloseTo(plain * (1 + PIN_MULT), 1);
  });
});

describe('연기 향로: incense clouds', () => {
  it('a swing leaves a cloud at its far end that ticks an enemy inside; clouds never stack; at most three', () => {
    const w = setup('smoke_censer');
    const p = w.player;
    const reach = censerReach(p.stats.range);
    const e = spawn(w, LIGHT, p.x + reach * 0.85, p.y - 3);
    idle(w, 1);
    drive(w, 1, () => true, at(e.x, e.y));
    const clouds = live(w, IncenseCloud);
    expect(clouds.length).toBe(1);
    expect(Math.hypot(clouds[0].x - e.x, clouds[0].y - e.y)).toBeLessThan(6);
    // more swings: three clouds over the same enemy, still one tick per 0.4 s
    drive(w, 150, () => true, at(e.x, e.y));
    expect(live(w, IncenseCloud).filter((c) => c.fading < 0).length).toBeLessThanOrEqual(3);
    const ticks = countHits(w, e, 'status', () => drive(w, 120, () => true, at(e.x, e.y)));
    expect(ticks).toBeGreaterThanOrEqual(4);
    expect(ticks).toBeLessThanOrEqual(6);
    // clouds fade away when the swinging stops
    idle(w, 120);
    expect(live(w, IncenseCloud).length).toBe(0);
  });
});

describe('지뢰 등잔: lantern mines', () => {
  it('lands, arms, waits, bursts on proximity without hurting the keeper; the fourth pops the oldest; self-detonates', () => {
    const w = setup('mine_lantern');
    const p = w.player;
    p.god = false;
    const red = p.red;
    drive(w, 1, () => true, at(p.x + 30, p.y - 6));
    idle(w, Math.round(0.3 / FIXED_DT));
    const mines = live(w, LanternMine);
    expect(mines.length).toBe(1);
    const m = mines[0];
    expect(m.armed).toBe(false);
    idle(w, Math.round(MINE_ARM / FIXED_DT) + 2);
    expect(m.armed).toBe(true);
    const e = spawn(w, LIGHT, m.x + 70, m.y);
    idle(w, 20);
    expect(m.dead).toBe(false);
    const hp = e.hp;
    e.x = m.x + 18;
    idle(w, 2);
    expect(m.dead).toBe(true);
    expect(e.hp).toBeLessThan(hp);
    expect(p.red).toBe(red);
    w.killEnemy(e);
    // four throws at empty floor: three stay, the oldest popped
    for (let k = 0; k < 4; k++) drive(w, 45, (i) => i === 0, at(p.x + 30 + k * 12, p.y - 40 + k * 26));
    idle(w, 10);
    expect(live(w, LanternMine).length).toBe(3);
    idle(w, Math.round(MINE_LIFE / FIXED_DT) + 5);
    expect(live(w, LanternMine).length).toBe(0);
    expect(p.red).toBe(red);
  });
});

describe('중력 구슬: pull then implode', () => {
  it('stops on its target, drags nearby enemies inward, then implodes on all of them', () => {
    const w = setup('gravity_orb');
    const p = w.player;
    const a = spawn(w, LIGHT, p.x + 60, p.y - 4);
    const b = spawn(w, LIGHT, p.x + 60, p.y - 4 + 40);
    const c = spawn(w, DUMMY_ID, p.x + 60 + 30, p.y - 4);
    idle(w, 1);
    const hb = b.hp, hc = c.hp;
    const bd0 = Math.hypot(b.x - a.x, b.y - a.y);
    const c0 = c.x;
    drive(w, 1, () => true, at(a.x, a.y));
    idle(w, 15);
    const orb = shots(w, 'gravity_orb')[0];
    expect(orb).toBeDefined();
    expect(orb.mem.phase).toBe(1);
    // one orb at a time
    drive(w, 5, () => true, at(a.x, a.y));
    expect(shots(w, 'gravity_orb').length).toBe(1);
    const left = GRAVITY_WELL - (orb.mem.t ?? 0);
    idle(w, Math.round((left - 0.08) / FIXED_DT));
    expect(orb.dead).toBe(false);
    expect(Math.hypot(b.x - orb.x, b.y - orb.y)).toBeLessThan(bd0 - 12);
    expect(c.x).toBe(c0);
    idle(w, 20);
    expect(orb.dead).toBe(true);
    expect(b.hp).toBeLessThan(hb);
    expect(c.hp).toBeLessThan(hc);
    expect(GRAVITY_PULL_R).toBeGreaterThan(40);
  });
});

describe('먹물 붓: ink strokes', () => {
  it('paints toward the cursor; wet ink ticks enemies on it at a shared cadence; off the line is safe; strokes dry', () => {
    const w = setup('ink_brush');
    const p = w.player;
    const on = spawn(w, LIGHT, p.x + 50, p.y - 5);
    const off = spawn(w, LIGHT, p.x + 50, p.y - 5 + 22);
    idle(w, 1);
    const hOff = off.hp;
    drive(w, 1, () => true, at(p.x + 60, p.y - 6));
    expect(live(w, InkStroke).length).toBe(1);
    const ticks = countHits(w, on, 'status', () => idle(w, Math.round(INK_LIFE / FIXED_DT)));
    expect(ticks).toBeGreaterThanOrEqual(3);
    expect(ticks).toBeLessThanOrEqual(Math.ceil(INK_LIFE / INK_REHIT) + 1);
    expect(off.hp).toBe(hOff);
    idle(w, 5);
    expect(live(w, InkStroke).length).toBe(0);
    // many strokes over one enemy: still one ink tick per INK_REHIT; at most five strokes
    const many = countHits(w, on, 'status', () => drive(w, 108, () => true, at(p.x + 60, p.y - 6)));
    expect(live(w, InkStroke).filter((s) => s.dry < 0).length).toBeLessThanOrEqual(5);
    expect(many).toBeLessThanOrEqual(Math.ceil(1.8 / INK_REHIT) + 1);
  });
});

describe('회전 팽이추: hold to spin, release to recall', () => {
  it('hovers on the target grinding it while held, comes back on release, and on its own after a while', () => {
    const w = setup('spin_top_yoyo');
    const p = w.player;
    const e = spawn(w, LIGHT, p.x + 70, p.y - 5);
    idle(w, 1);
    const n = countHits(w, e, null, () => drive(w, 90, () => true, at(e.x, e.y)));
    expect(n).toBeGreaterThanOrEqual(5);
    const top = shots(w, 'spin_top')[0];
    expect(top.mem.phase).toBe(1);
    expect(Math.hypot(top.x - e.x, top.y - e.y)).toBeLessThan(10);
    idle(w, 30);
    expect(shots(w, 'spin_top').length).toBe(0);
    // held: back after YOYO_HOLD even without letting go, then thrown again
    drive(w, Math.round((YOYO_HOLD + 0.1) / FIXED_DT), () => true, at(e.x, e.y));
    const s = shots(w, 'spin_top');
    expect(s.length === 0 || s[0].mem.phase === 2 || s[0].age < 0.3).toBe(true);
  });
});

describe('new weapons w1: balance, purity, room changes', () => {
  it('dummy band: 0.85..1.35x the lantern single target, crowd <= 6.5x', () => {
    const base = bestDps(PLAIN_ID, 'lantern_bolt');
    const baseC = bestDps(PLAIN_ID, 'lantern_bolt', true);
    const rows: string[] = [];
    for (const id of IDS) {
      const k = bestDps(PLAIN_ID, id) / base;
      const c = bestDps(PLAIN_ID, id, true) / baseC;
      rows.push(`${id.padEnd(16)} ${k.toFixed(2)} crowd ${c.toFixed(2)}`);
      expect(k, id).toBeGreaterThanOrEqual(0.85);
      expect(k, id).toBeLessThanOrEqual(1.35);
      expect(c, id).toBeLessThanOrEqual(6.5);
    }
    console.log(rows.join('\n'));
  }, 120_000);

  it('drawing never changes the simulation', () => {
    for (const id of IDS) {
      const r = measureDps({ character: PLAIN_ID, weapon: id, seconds: 0, crowd: true, dist: 60 });
      const w = r.world;
      const t = r.dummies[0];
      const aim = at(t.x, t.y);
      for (let i = 0; i < 150; i++) {
        drive(w, 1, () => i % 50 < 40, aim);
        const before = stateHash(w);
        w.draw(1);
        expect(stateHash(w), `${id} ${i}`).toBe(before);
      }
    }
  }, 60_000);

  it('nothing the weapons place survives a room change, and the weapon works right away in the new room', () => {
    for (const id of IDS) {
      const w = setup(id);
      const p = w.player;
      const e = spawn(w, LIGHT, p.x + 50, p.y - 5);
      drive(w, 50, () => true, at(e.x, e.y));
      const next = w.map.nodes.find((n) => n !== w.node && n.kind === 'normal')!;
      w.withIds(() => w.teleportTo(next));
      idle(w, 40);
      for (const e2 of [...w.enemies]) w.killEnemy(e2);
      const mine = w.entities.filter((x) => !x.dead && (x instanceof LanternMine || x instanceof InkStroke || x instanceof IncenseCloud || x instanceof BellRing
        || (x instanceof Projectile && x.behaviors.some((b) => BEHAVIORS.includes(b.id ?? '')))));
      expect(mine.length, id).toBe(0);
      const st = p.weapon;
      drive(w, 2, () => false, at(p.x + 40, p.y));
      expect(st.mem.out ?? 0, id).toBe(0);
      // the weapon attacks again at once
      let before = 0;
      const orig = w.items.onAttack.bind(w.items);
      w.items.onAttack = (a: number) => { before++; orig(a); };
      drive(w, 30, () => true, at(p.x + 40, p.y - 6));
      w.items.onAttack = orig;
      expect(before, id).toBeGreaterThanOrEqual(1);
    }
  }, 60_000);
});

describe('new weapons w1: multishot', () => {
  it('extra shots add echoes / harpoons / clouds / mines / strokes / tops and keep the caps', () => {
    for (const id of IDS) {
      const w = setup(id);
      const p = w.player;
      p.stats.shots = 3;
      const e = spawn(w, LIGHT, p.x + (Weapons.must(id).kind === 'melee' ? 28 : 55), p.y - 5);
      const d = dealt(w, () => drive(w, 150, (i) => i % 60 < 45, at(e.x, e.y)));
      expect(d, id).toBeGreaterThan(0);
      expect(live(w, LanternMine).length, id).toBeLessThanOrEqual(5);
      expect(live(w, InkStroke).filter((x) => x.dry < 0).length, id).toBeLessThanOrEqual(7);
      expect(live(w, IncenseCloud).filter((x) => x.fading < 0).length, id).toBeLessThanOrEqual(5);
    }
  }, 60_000);
});

describe('new weapons w1: co-op', () => {
  /** Two keepers with weapons a / b; `local` = this peer's slot. Both aim at a light enemy and fire on the same schedule. */
  function party(a: string, b: string, local: number): { w: World; e: Enemy } {
    const w = new WorldClass(new Renderer(fakeDisplay(1280, 720)), new RunState('W1-COOP', 'ria'), { openInventory() {}, onGameOver() {} });
    w.rules = fixedRules({ hitStop: false });
    w.startParty([0, 1].map((slot) => ({ slot, characterId: 'ria', name: `P${slot}` })), local);
    w.inputSource = (_w, _p, out) => clearInput(out);
    for (let i = 0; i < 2; i++) w.update(FIXED_DT);
    for (const e of [...w.enemies]) w.killEnemy(e);
    const [p0, p1] = w.players;
    w.withIds(() => {
      w.asPlayer(p0, () => p0.equipWeapon(w, a));
      w.asPlayer(p1, () => p1.equipWeapon(w, b));
    });
    for (const q of w.players) q.god = true;
    p1.x = p0.x;
    p1.y = p0.y + 26;
    const e = w.withIds(() => w.spawnEnemy(LIGHT, p0.x + 60, p0.y + 12))!;
    e.dormant = 0;
    w.inputSource = (ww, pl, out) => {
      clearInput(out);
      out.cx = e.x;
      out.cy = e.y - 4;
      out.held = (Math.floor(ww.time * 2) % 3 < 2 ? HELD.fire : 0) | HELD.cursorAim;
      // melee keepers walk in
      const dx = e.x - pl.x;
      const dy = e.y - pl.y;
      const d = Math.hypot(dx, dy) || 1;
      if (Weapons.must(pl.weaponId).kind === 'melee' && d > 24) {
        out.mx = dx / d;
        out.my = dy / d;
      }
    };
    return { w, e };
  }

  for (const [a, b] of [['resonance_bell', 'harpoon_gun'], ['javelin_bundle', 'smoke_censer'], ['mine_lantern', 'gravity_orb'], ['ink_brush', 'spin_top_yoyo']]) {
    it(`${a} + ${b}: each keeper's hits are its own, peers stay in lockstep, drawing is pure`, () => {
      const A = party(a, b, 0);
      const B = party(a, b, 1);
      const credit = new Map<Player, number>();
      const orig = A.w.applyHit.bind(A.w);
      A.w.applyHit = (target, hit) => {
        const ok = orig(target, hit);
        if (ok && hit.attacker && target === A.e) credit.set(hit.attacker as Player, (credit.get(hit.attacker as Player) ?? 0) + 1);
        return ok;
      };
      for (let i = 0; i < 240; i++) {
        A.w.update(FIXED_DT);
        B.w.update(FIXED_DT);
        if (i % 20 === 0) {
          expect(stateHash(B.w), `${a}/${b} tick ${i}`).toBe(stateHash(A.w));
          const h = stateHash(A.w);
          A.w.draw(1);
          expect(stateHash(A.w)).toBe(h);
        }
      }
      expect(credit.get(A.w.players[0]) ?? 0, a).toBeGreaterThan(0);
      expect(credit.get(A.w.players[1]) ?? 0, b).toBeGreaterThan(0);
    }, 60_000);
  }
});
