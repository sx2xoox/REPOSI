// 회오리 · 검기 artifacts (melee II + cross-type): whirl_grip, skysplit_sheath, craftsman_file,
// cross_crest, steel_pulse. Each works on the weapon types it names, does nothing on a plain
// ranged weapon, stacks sanely, and sits in its rarity's late-build band on its target weapons.

import './headless';
import { fakeDisplay } from './headless';
import { describe, expect, it, vi } from 'vitest';

// the band checks run real fights: give them room on a busy machine
vi.setConfig({ testTimeout: 60_000 });
import { Artifacts, RARITY_WEIGHT, Weapons } from '../src/game/defs';
import { RNG } from '../src/engine/rng';
import { Renderer } from '../src/engine/renderer';
import { World, type WorldHost } from '../src/game/world';
import { RunState } from '../src/game/run';
import { FIXED_DT } from '../src/game/constants';
import { HELD, PRESS, fixedRules, type PlayerInput } from '../src/game/seam';
import { MeleeSwing } from '../src/game/melee';
import { newWeaponState } from '../src/game/player';
import { Projectile } from '../src/game/projectile';
import type { Enemy } from '../src/game/enemy';
import type { HitInfo } from '../src/game/entity';
import { hasSprite } from '../src/engine/sprites';
import { lookIsVisible } from '../src/game/look';
import { stateHash } from '../src/game/statehash';
import { DUMMY_ID, PLAIN_ID, measureDps } from './dpsharness';
import { CROSS_CD, CROSS_DMG, PULSE_DMG, PULSE_GAP, PULSE_MAX, SKYSPLIT_DMG, WHIRL_AMP, whirlNeed } from '../src/content/items/whirl-arts';

const IDS = ['whirl_grip', 'skysplit_sheath', 'craftsman_file', 'cross_crest', 'steel_pulse'] as const;
const HANGUL = /[가-힣]/;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** `n` late builds of `k` distinct visible artifacts drawn with the loot weights (like tests/item-audit). */
function builds(seed: string, n: number, k: number): string[][] {
  const pool = Artifacts.all().filter((a) => !a.hidden && !a.blessing && !(IDS as readonly string[]).includes(a.id));
  const rng = new RNG(seed);
  const out: string[][] = [];
  for (let b = 0; b < n; b++) {
    const left = [...pool];
    const pick: string[] = [];
    for (let i = 0; i < k && left.length; i++) {
      const c = rng.weighted(left, (a) => RARITY_WEIGHT[a.rarity]);
      if (!c) break;
      pick.push(c.id);
      left.splice(left.indexOf(c), 1);
    }
    out.push(pick);
  }
  return out;
}
const LATE = builds('WHIRL-LATE', 8, 10);

// ---------------------------------------------------------------- a small bot world
interface HitRec { kind: HitInfo['kind']; damage: number; wave: boolean; traveled: number; procs: string[] }
interface BotOpts {
  weapons: string[];
  artifacts?: string[];
  seconds?: number;
  seed?: string;
  /** dummy offsets from the keeper's start (the first one is aimed at) */
  dummies?: [number, number][];
  /** stand still at the start instead of walking in */
  stay?: boolean;
  swapEvery?: number;
  dashEvery?: number;
}
const host: WorldHost = { openInventory() {}, onGameOver() {} };
let renderer: Renderer | null = null;

function runBot(o: BotOpts): { w: World; dps: number; hits: HitRec[]; maxPulse: number; attacks: number; pulseAt: number[] } {
  if (!renderer) renderer = new Renderer(fakeDisplay(1280, 720));
  const run = new RunState(o.seed ?? 'WHIRL-BOT', PLAIN_ID);
  run.seeded = true;
  const w = new World(renderer, run, host);
  w.setQuality({ lighting: false, particles: 0 });
  w.rules = fixedRules({ hitStop: false });
  let dummies: Enemy[] = [];
  let swapT = o.swapEvery ?? 0;
  let dashT = o.dashEvery ?? 0;
  const close = (id: string) => { const d = Weapons.get(id); return !!d && (d.kind === 'melee' || id === 'titan_greatsword'); };
  w.inputSource = (ww: World, _p: unknown, out: PlayerInput) => {
    const p = ww.player;
    out.mx = out.my = out.ax = out.ay = 0;
    out.held = 0;
    out.pressed = 0;
    const t = dummies[0];
    out.cx = t ? t.x : p.x + 40;
    out.cy = t ? t.y : p.y;
    if (!t) return;
    const dx = t.x - p.x;
    const dy = t.y - (p.y - 4);
    const d = Math.hypot(dx, dy) || 1;
    const want = close(p.weaponId) ? 16 : 40;
    if (!o.stay && d > want + 4) {
      out.mx = dx / d;
      out.my = dy / d;
    }
    const charge = Weapons.get(p.weaponId)?.kind === 'charge';
    out.held = ((charge ? ww.time % 1.1 < 0.95 : true) ? HELD.fire : 0) | HELD.cursorAim;
    if (o.swapEvery) {
      swapT -= FIXED_DT;
      if (swapT <= 0) { swapT = o.swapEvery; out.pressed |= PRESS.swap; }
    }
    if (o.dashEvery) {
      dashT -= FIXED_DT;
      if (dashT <= 0) { dashT = o.dashEvery; out.pressed |= PRESS.dash; out.mx = dx / d; out.my = dy / d; }
    }
  };
  w.start();
  const p = w.player;
  for (const e of [...w.enemies]) w.killEnemy(e);
  // exactly these weapons: the first in hand, the second (if any) in the other slot
  if (p.weaponId !== o.weapons[0]) p.equipWeapon(w, o.weapons[0]);
  p.weapon2Id = o.weapons[1] ?? null;
  p.weapon2 = newWeaponState();
  expect([p.weaponId, p.weapon2Id]).toEqual([o.weapons[0], o.weapons[1] ?? null]);
  for (const id of o.artifacts ?? []) w.items.give(id);
  p.god = true;
  for (const [ox, oy] of o.dummies ?? [[40, 0]]) {
    const e = w.spawnEnemy(DUMMY_ID, p.x + ox, p.y + oy);
    if (e) { e.dormant = 0; dummies.push(e); }
  }
  const hits: HitRec[] = [];
  const orig = w.applyHit.bind(w);
  w.applyHit = (target, hit) => {
    const src = hit.source;
    const wave = src instanceof Projectile && !!src.mem.skysplit;
    const before = (target as { hp: number }).hp;
    const ok = orig(target, hit);
    if (ok && target !== w.player) hits.push({ kind: hit.kind, damage: before - (target as { hp: number }).hp, wave, traveled: wave ? (src as Projectile).traveled : 0, procs: hit.procs ?? [] });
    return ok;
  };
  let attacks = 0;
  const onAttack = w.items.onAttack.bind(w.items);
  w.items.onAttack = (a) => { attacks++; onAttack(a); };
  let maxPulse = 0;
  const pulseAt: number[] = [];
  const T = o.seconds ?? 10;
  for (let i = 0; i < Math.round(T / FIXED_DT); i++) {
    const n0 = w.vars.__spN ?? 0;
    w.update(FIXED_DT);
    dummies = dummies.filter((e) => e.alive);
    if ((w.vars.__spN ?? 0) > n0) pulseAt.push(w.time);
    maxPulse = Math.max(maxPulse, w.vars.__spN ?? 0);
  }
  return { w, dps: w.run.stats.damageDealt / T, hits, maxPulse, attacks, pulseAt };
}

/** dps(with) / dps(without) on the standard harness (single dummy, or a crowd of 5). */
function gain(weapon: string, add: string[], o: { base?: string[]; crowd?: boolean; seed?: string; seconds?: number; dash?: number } = {}): number {
  const m = (arts: string[]) => measureDps({ character: PLAIN_ID, weapon, artifacts: arts, crowd: o.crowd, seconds: o.seconds ?? 10, seed: o.seed ?? `W-${weapon}`, dash: o.dash }).dps;
  return m([...(o.base ?? []), ...add]) / m(o.base ?? []);
}
/** Median late-build gain of `id` on `weapon`. */
function lateGain(weapon: string, id: string, dash?: number): number {
  return median(LATE.map((b, i) => gain(weapon, [id], { base: b, seed: `L${i}-${weapon}`, dash })));
}

// ---------------------------------------------------------------- definitions
describe('whirl-arts: definitions', () => {
  // `names`: the weapon types (or the swap) the one-sentence desc must still name
  const want: Record<string, { rarity: string; tag: string; names: string }> = {
    whirl_grip: { rarity: 'epic', tag: 'storm', names: '근접 무기' },
    skysplit_sheath: { rarity: 'legendary', tag: 'star', names: '근접 무기' },
    craftsman_file: { rarity: 'rare', tag: 'clockwork', names: '근접·광선·충전 무기' },
    cross_crest: { rarity: 'epic', tag: 'blood', names: '무기를 바꿔' },
    steel_pulse: { rarity: 'epic', tag: 'storm', names: '근접·충전 무기' },
  };
  it('declares the five artifacts with Korean texts, icons, looks and pools', () => {
    for (const id of IDS) {
      const a = Artifacts.must(id);
      const wnt = want[id];
      expect(a.rarity, id).toBe(wnt.rarity);
      expect(a.tags, id).toEqual([wnt.tag]);
      expect(a.desc.includes(wnt.names), `${id}: ${a.desc}`).toBe(true);
      expect(a.desc.length, id).toBeLessThanOrEqual(36);
      for (const t of [a.name, a.desc, a.quote ?? '']) expect(t, id).toMatch(HANGUL);
      if (a.detail) expect(a.detail, id).toMatch(HANGUL);
      expect(hasSprite(a.icon), id).toBe(true);
      expect(lookIsVisible(a.look), id).toBe(true);
      expect(a.pools.length, id).toBeGreaterThan(0);
    }
    // like every other epic / legendary artifact, these are never sold in shops
    for (const id of IDS) if (Artifacts.must(id).rarity === 'epic' || Artifacts.must(id).rarity === 'legendary') expect(Artifacts.must(id).pools, id).not.toContain('shop');
    const sheath = Artifacts.must('skysplit_sheath');
    expect(sheath.unique).toBe(true);
    expect(sheath.pools).not.toContain('shop');
    expect(hasSprite('proj_skysplit_wave')).toBe(true);
  });
});

// ---------------------------------------------------------------- 회오리 손잡이
describe('whirl_grip', () => {
  it('turns every 4th connecting swing into a 360° whirl with its bonus', () => {
    const whirls: MeleeSwing[] = [];
    const proto = World.prototype as unknown as { spawn: (e: unknown) => unknown };
    const orig = proto.spawn;
    proto.spawn = function (this: World, e: unknown) {
      // a whirl is a full-turn arc (a thrust's `arc` is its width in px)
      if (e instanceof MeleeSwing && !e.o.thrust && Math.abs(e.o.arc - Math.PI * 2) < 1e-6) whirls.push(e);
      return orig.call(this, e);
    };
    try {
      const r = runBot({ weapons: ['sentinel_blade'], artifacts: ['whirl_grip'], seconds: 10, dummies: [[40, 0]] });
      expect(whirls.length).toBeGreaterThanOrEqual(3);
      for (const s of whirls) expect(s.o.amp).toBeGreaterThanOrEqual(WHIRL_AMP - 1e-9);
      expect(r.w.items.lastProc('whirl_grip')).toBeGreaterThan(-Infinity);
      // a thrust weapon whirls too (a full turn at 70 % reach instead of a line)
      whirls.length = 0;
      runBot({ weapons: ['iron_spear'], seconds: 8 });
      expect(whirls.length).toBe(0);
      runBot({ weapons: ['iron_spear'], artifacts: ['whirl_grip'], seconds: 8 });
      expect(whirls.length).toBeGreaterThan(0);
    } finally {
      proto.spawn = orig;
    }
    expect(whirlNeed(1)).toBe(4);
    expect(whirlNeed(2)).toBe(3);
    expect(whirlNeed(3)).toBe(2);
  });

  it('does nothing with a ranged weapon; copies stack at most linearly', () => {
    expect(gain('lantern_bolt', ['whirl_grip'])).toBeCloseTo(1, 9);
    const one = gain('sentinel_blade', ['whirl_grip']) - 1;
    const three = gain('sentinel_blade', ['whirl_grip', 'whirl_grip', 'whirl_grip']) - 1;
    expect(one).toBeGreaterThan(0.06);
    expect(three).toBeGreaterThan(one);
    expect(three).toBeLessThanOrEqual(one * 3.2);
  });

  it('sits in the epic band on swing weapons (crowd under its cap)', () => {
    const late = median(['sentinel_blade', 'copper_sabre', 'titan_greatsword'].map((wid) => lateGain(wid, 'whirl_grip')));
    expect(late).toBeGreaterThanOrEqual(1.08);
    expect(late).toBeLessThanOrEqual(1.24);
    for (const wid of ['sentinel_blade', 'iron_spear', 'twin_daggers']) expect(gain(wid, ['whirl_grip'], { crowd: true }), wid).toBeLessThanOrEqual(2.0);
  });
});

// ---------------------------------------------------------------- 하늘 가르는 칼집
describe('skysplit_sheath', () => {
  it('throws a piercing wave per swing: half inside the blade, full beyond, at the keeper cadence', () => {
    // a keeper standing still, aiming down a line: one dummy far away, one inside the blade's reach
    const r = runBot({ weapons: ['copper_sabre'], artifacts: ['skysplit_sheath'], seconds: 8, stay: true, dummies: [[70, 0], [18, 0]] });
    const waves = r.hits.filter((h) => h.wave);
    const near = waves.filter((h) => h.traveled < 25);
    const far = waves.filter((h) => h.traveled > 45);
    expect(near.length).toBeGreaterThan(3);
    expect(far.length).toBeGreaterThan(3);
    const dmg = r.w.player.stats.damage * SKYSPLIT_DMG;
    // non-crit hits: the near ones deal half the far ones
    expect(Math.min(...near.map((h) => h.damage))).toBeCloseTo(dmg * 0.5, 4);
    expect(Math.min(...far.map((h) => h.damage))).toBeCloseTo(dmg, 4);
    // never more waves than the keeper's own attack rate allows
    expect(far.length).toBeLessThanOrEqual(Math.ceil(8 * r.w.player.stats.fireRate) + 1);
    expect(r.w.items.lastProc('skysplit_sheath')).toBeGreaterThan(-Infinity);
    // reach without the swing landing: the far dummy alone still takes damage
    const reach = runBot({ weapons: ['copper_sabre'], artifacts: ['skysplit_sheath'], seconds: 4, stay: true, dummies: [[70, 0]] });
    expect(reach.dps).toBeGreaterThan(0);
    expect(runBot({ weapons: ['copper_sabre'], seconds: 4, stay: true, dummies: [[70, 0]] }).dps).toBe(0);
  });

  it('does nothing with a ranged weapon and stays below a ranged weapon at range', () => {
    expect(gain('lantern_bolt', ['skysplit_sheath'])).toBeCloseTo(1, 9);
    const waveOnly = runBot({ weapons: ['copper_sabre'], artifacts: ['skysplit_sheath'], seconds: 8, stay: true, dummies: [[70, 0]] }).dps;
    const gun = runBot({ weapons: ['lantern_bolt'], seconds: 8, stay: true, dummies: [[70, 0]] }).dps;
    expect(waveOnly).toBeLessThan(gun * 0.8);
  });

  it('sits in the legendary band on melee weapons', () => {
    const late = median(['sentinel_blade', 'copper_sabre', 'iron_spear'].map((wid) => lateGain(wid, 'skysplit_sheath')));
    expect(late).toBeGreaterThanOrEqual(1.1);
    expect(late).toBeLessThanOrEqual(1.28);
    for (const wid of ['sentinel_blade', 'twin_daggers']) expect(gain(wid, ['skysplit_sheath'], { crowd: true }), wid).toBeLessThanOrEqual(2.3);
  });
});

// ---------------------------------------------------------------- 장인의 줄
describe('craftsman_file', () => {
  it('whets melee, beam and charge weapons by 10 % per copy and leaves plain shots alone', () => {
    for (const wid of ['sentinel_blade', 'void_gaze', 'hunter_bow', 'titan_greatsword']) {
      expect(gain(wid, ['craftsman_file']), wid).toBeCloseTo(1.1, 2);
      expect(gain(wid, ['craftsman_file', 'craftsman_file', 'craftsman_file']), wid).toBeCloseTo(1.3, 2);
    }
    for (const wid of ['lantern_bolt', 'nail_carbine']) expect(gain(wid, ['craftsman_file']), wid).toBeCloseTo(1, 9);
    const r = runBot({ weapons: ['void_gaze'], artifacts: ['craftsman_file'], seconds: 3 });
    expect(r.w.items.lastProc('craftsman_file')).toBeGreaterThan(-Infinity);
  });

  it('sits in the rare band on its weapons', () => {
    const late = median(['sentinel_blade', 'void_gaze', 'hunter_bow'].map((wid) => lateGain(wid, 'craftsman_file')));
    expect(late).toBeGreaterThanOrEqual(1.06);
    expect(late).toBeLessThanOrEqual(1.18);
  });
});

// ---------------------------------------------------------------- 교차 문장
describe('cross_crest', () => {
  const swapGain = (weapons: string[], add: string[], o: { base?: string[]; seed?: string; swapEvery?: number; crowd?: boolean } = {}) => {
    const dummies: [number, number][] = o.crowd ? [[40, 0], [58, 0], [22, 0], [40, 18], [40, -18]] : [[40, 0]];
    const m = (arts: string[]) => runBot({ weapons, artifacts: arts, seconds: 12, seed: o.seed ?? `X-${weapons.join('-')}`, swapEvery: o.swapEvery, dummies }).dps;
    return m([...(o.base ?? []), ...add]) / m(o.base ?? []);
  };

  it('bursts marked enemies hit by the other weapon after a swap', () => {
    const r = runBot({ weapons: ['sentinel_blade', 'lantern_bolt'], artifacts: ['cross_crest'], seconds: 12, swapEvery: 1.5 });
    const bursts = r.hits.filter((h) => h.procs.includes('cross_crest'));
    expect(bursts.length).toBeGreaterThan(1);
    // one burst per enemy per 3 s at most
    expect(bursts.length).toBeLessThanOrEqual(Math.ceil(12 / 3) + 1);
    const d = r.w.player.stats.damage * CROSS_DMG;
    expect(Math.min(...bursts.map((h) => h.damage))).toBeCloseTo(d, 4);
    expect(r.w.items.lastProc('cross_crest')).toBeGreaterThan(-Infinity);
    expect(swapGain(['sentinel_blade', 'lantern_bolt'], ['cross_crest'], { swapEvery: 1.5 })).toBeGreaterThan(1.08);
  });

  it('a lit crest the proc interval held back keeps its mark for the next hit', () => {
    // three dummies marked by the gun, the keeper just swapped to the sabre: one swing strikes all three
    const { w } = runBot({ weapons: ['copper_sabre', 'lantern_bolt'], artifacts: ['cross_crest'], seconds: 0, stay: true, dummies: [[14, -9], [16, 0], [14, 9]] });
    w.inputSource = (_w, _p, out) => { out.mx = out.my = out.ax = out.ay = 0; out.held = 0; out.pressed = 0; };
    w.update(FIXED_DT);
    const p = w.player;
    const es = w.enemies.filter((e) => e.def.id === DUMMY_ID);
    expect(es.length).toBe(3);
    const K = `__xcK${p.slot}`;
    const C = `__xcCd${p.slot}`;
    const strike = () => {
      for (const e of es) {
        if (e.mem[K]) continue;
        e.mem[K] = 1;
        e.mem[`__xcT${p.slot}`] = w.time;
      }
      p.swapAt = w.time;
      p.swing(w, { angle: 0, arc: Math.PI * 2, reach: 30, damage: 1, knockback: 0 });
      for (let i = 0; i < 3; i++) w.update(FIXED_DT);
    };
    const burst = () => es.filter((e) => Number(e.mem[C] ?? -99) > w.time).length;
    strike();
    // only one burst per proc interval, but the other two crests are still there (lit, not used up)
    expect(burst()).toBe(1);
    expect(es.filter((e) => e.mem[K] === 1).length).toBe(2);
    for (let i = 0; i < Math.round(0.25 / FIXED_DT); i++) w.update(FIXED_DT);
    strike();
    expect(burst()).toBe(2);
    for (let i = 0; i < Math.round(0.25 / FIXED_DT); i++) w.update(FIXED_DT);
    strike();
    expect(burst()).toBe(3);
    expect(CROSS_CD).toBeGreaterThan(1);
  });

  it('does nothing without a swap, with a single weapon or with two weapons of one kind', () => {
    expect(swapGain(['sentinel_blade', 'lantern_bolt'], ['cross_crest'])).toBeCloseTo(1, 9);
    expect(swapGain(['lantern_bolt'], ['cross_crest'], { swapEvery: 1.5 })).toBeCloseTo(1, 9);
    expect(swapGain(['sentinel_blade', 'copper_sabre'], ['cross_crest'], { swapEvery: 1.5 })).toBeCloseTo(1, 9);
  });

  it('stacks sublinearly and sits in the epic band while swapping', () => {
    const one = swapGain(['iron_spear', 'nail_carbine'], ['cross_crest'], { swapEvery: 1.5 }) - 1;
    const three = swapGain(['iron_spear', 'nail_carbine'], ['cross_crest', 'cross_crest', 'cross_crest'], { swapEvery: 1.5 }) - 1;
    expect(three).toBeGreaterThan(one);
    expect(three).toBeLessThanOrEqual(one * 3);
    expect(swapGain(['iron_spear', 'nail_carbine'], ['cross_crest'], { swapEvery: 1.5, crowd: true })).toBeLessThanOrEqual(2.0);
    const late = median(LATE.slice(0, 6).map((b, i) => swapGain(['sentinel_blade', 'lantern_bolt'], ['cross_crest'], { base: b, seed: `XL${i}`, swapEvery: 1.5 })));
    expect(late).toBeGreaterThanOrEqual(1.08);
    expect(late).toBeLessThanOrEqual(1.26);
  });
});

// ---------------------------------------------------------------- 강철 맥박
describe('steel_pulse', () => {
  it('stores up to three pulses from connecting attacks and spends them on a dash', () => {
    const r = runBot({ weapons: ['sentinel_blade'], artifacts: ['steel_pulse'], seconds: 10, dashEvery: 2 });
    expect(r.maxPulse).toBe(PULSE_MAX);
    const shocks = r.hits.filter((h) => h.procs.includes('steel_pulse'));
    expect(shocks.length).toBeGreaterThan(2);
    expect(r.w.items.lastProc('steel_pulse')).toBeGreaterThan(-Infinity);
    // every shock is a whole number of pulses (crits aside), never more than the cap
    const unit = r.w.player.stats.damage * PULSE_DMG;
    for (const s of shocks) expect(s.damage).toBeLessThanOrEqual(unit * PULSE_MAX * r.w.player.stats.critMult + 1e-6);
    // no dash, no discharge
    const still = runBot({ weapons: ['sentinel_blade'], artifacts: ['steel_pulse'], seconds: 6 });
    expect(still.maxPulse).toBe(PULSE_MAX);
    expect(still.hits.some((h) => h.procs.includes('steel_pulse'))).toBe(false);
  });

  it('gains at most one pulse per heartbeat, so fast weapons and dash spam stay in the epic band', () => {
    const r = runBot({ weapons: ['twin_daggers'], artifacts: ['steel_pulse'], seconds: 10, dashEvery: 0.9 });
    expect(r.pulseAt.length).toBeGreaterThan(5);
    for (let i = 1; i < r.pulseAt.length; i++) expect(r.pulseAt[i] - r.pulseAt[i - 1]).toBeGreaterThanOrEqual(PULSE_GAP - 1e-6);
    // the fastest weapons with a dash at every cooldown: still an epic, crowd under its cap
    const late = median(['twin_daggers', 'fang_blade'].map((wid) => lateGain(wid, 'steel_pulse', 0.9)));
    expect(late).toBeLessThanOrEqual(1.24);
    expect(gain('twin_daggers', ['steel_pulse'], { crowd: true, dash: 0.9 })).toBeLessThanOrEqual(2.0);
  });

  it('dash spam cannot discharge more pulses than attacks landed', () => {
    const r = runBot({ weapons: ['sentinel_blade'], artifacts: ['steel_pulse'], seconds: 10, dashEvery: 0.9 });
    const unit = r.w.player.stats.damage * PULSE_DMG;
    const spent = r.hits.filter((h) => h.procs.includes('steel_pulse')).reduce((s, h) => s + h.damage / unit, 0);
    expect(spent).toBeLessThanOrEqual(r.attacks * r.w.player.stats.critMult + 1e-6);
  });

  it('does nothing with a ranged or beam weapon; copies stack sublinearly', () => {
    expect(gain('nail_carbine', ['steel_pulse'], { dash: 2 })).toBeCloseTo(1, 9);
    expect(gain('void_gaze', ['steel_pulse'], { dash: 2 })).toBeCloseTo(1, 9);
    const one = gain('sentinel_blade', ['steel_pulse'], { dash: 2 }) - 1;
    const three = gain('sentinel_blade', ['steel_pulse', 'steel_pulse', 'steel_pulse'], { dash: 2 }) - 1;
    expect(one).toBeGreaterThan(0.05);
    expect(three).toBeLessThanOrEqual(one * 2.2);
  });

  it('sits in the epic band on melee and charge weapons (dash every 2 s)', () => {
    const late = median(['sentinel_blade', 'iron_spear', 'hunter_bow'].map((wid) => lateGain(wid, 'steel_pulse', 2)));
    expect(late).toBeGreaterThanOrEqual(1.08);
    expect(late).toBeLessThanOrEqual(1.24);
    for (const wid of ['iron_spear', 'twin_daggers']) expect(gain(wid, ['steel_pulse'], { crowd: true, dash: 2 }), wid).toBeLessThanOrEqual(2.0);
  });
});

// ---------------------------------------------------------------- lockstep
describe('whirl-arts: determinism', () => {
  it('the same seed replays bit-identically with all five held', () => {
    const go = () => runBot({ weapons: ['iron_spear', 'void_gaze'], artifacts: [...IDS], seconds: 6, swapEvery: 1.3, dashEvery: 1.7, dummies: [[40, 0], [60, 14], [24, -16]] });
    const a = go();
    const b = go();
    expect(a.w.run.stats.damageDealt).toBe(b.w.run.stats.damageDealt);
    expect(stateHash(a.w)).toBe(stateHash(b.w));
  });
});
