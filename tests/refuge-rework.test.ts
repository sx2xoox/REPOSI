import './headless';
import { describe, it, expect, vi } from 'vitest';
import { Characters, Enemies, Weapons, defineEnemy } from '../src/game/defs';
import { Projectile } from '../src/game/projectile';
import { FIXED_DT } from '../src/game/constants';
import { Tile } from '../src/game/tiles';
import { stateHash } from '../src/game/statehash';
import type { World } from '../src/game/world';
import type { Enemy } from '../src/game/enemy';
import type { HitInfo } from '../src/game/entity';
import { DUMMY_ID, measureDps } from './dpsharness';
import { runCoop } from './coopsim';
import { REFUGE_PASSIVES, REFUGE_DASHES, REFUGE_RELEASES, RefugeCharge, RefugeWeave, RefugeSupport, RefugeGuard, RefugeSeal } from '../src/content/characters/refuge-kits';
import { RefugeRelease } from '../src/content/characters/refuge-release';
import { RefugeOwned, directContribution, supportFamily } from '../src/content/characters/refuge-common';

const IDS = ['tove', 'luen', 'ves', 'ort', 'mira'];
function idle(w: World, frames: number): void {
  w.inputSource = (_w, p, o) => {
    o.mx = o.my = o.ax = o.ay = o.held = o.pressed = 0;
    o.cx = p.x + 80; o.cy = p.y - 6;
  };
  for (let i = 0; i < frames; i++) w.update(FIXED_DT);
}
function sim(id = 'tove'): { w: World; target: Enemy } {
  const result = measureDps({ character: id, weapon: Characters.must(id).weapon, seconds: 0, dist: 55 });
  const w = result.world;
  for (let y = 2; y < w.room.h - 2; y++) for (let x = 2; x < w.room.w - 2; x++) w.room.setTile(x, y, Tile.FLOOR);
  w.player.x = 80; w.player.y = 96; w.player.aim = 0;
  w.player.stats.critChance = 0;
  result.dummies[0].x = 135; result.dummies[0].y = 96;
  idle(w, 2);
  return { w, target: result.dummies[0] };
}
function deal(w: World, target: Enemy, amount = 10): void {
  w.withIds(() => w.applyHit(target, { damage: amount, kind: 'melee', attacker: w.player }));
}
function wall(w: World, tx = 7): void {
  for (let y = 2; y < w.room.h - 2; y++) w.room.setTile(tx, y, Tile.WALL);
}

describe('refuge keeper rework: usable without stopping or weapon swapping', () => {
  for (const id of ['tove', 'luen', 'ves', 'mira']) it(id + ' works on its first ordinary hit and its extra damage cannot refill ember', () => {
    const { w, target } = sim(id), before = target.hp;
    deal(w, target);
    w.player.ember = 0;
    idle(w, 90);
    expect(target.hp).toBeLessThan(before - 10);
    expect(w.player.ember).toBe(0);
    expect(w.player.weapon2Id).toBeNull();
  });

  it('tove attaches a single delayed charge to a moving target, with no hit-count prerequisite', () => {
    const { w, target } = sim();
    deal(w, target);
    for (let i = 0; i < 20; i++) deal(w, target, 1);
    idle(w, 1);
    const charges = w.entities.filter(e => e instanceof RefugeCharge) as RefugeCharge[];
    expect(charges).toHaveLength(1);
    target.x += 20;
    idle(w, 10);
    expect(charges[0].x).toBe(target.x);
    const hp = target.hp;
    idle(w, 45);
    expect(target.hp).toBeLessThan(hp);
    expect(charges[0].mem.fired).toBe(1);
  });

  it('tove mines arm after 0.2 s, cap at two and do not explode through walls', () => {
    const { w, target } = sim();
    for (let i = 0; i < 3; i++) { w.withIds(() => REFUGE_DASHES[0].start!(w, w.player)); idle(w, 14); }
    const mines = w.entities.filter(e => e instanceof RefugeCharge && e.mem.mine && !e.dead) as RefugeCharge[];
    expect(mines).toHaveLength(2);
    const mine = mines[0]; target.x = mine.x + 8; target.y = mine.y;
    const hp = target.hp; idle(w, 2); expect(target.hp).toBeLessThan(hp);
    const a = w.withIds(() => w.spawn(new RefugeCharge(w, w.player, 106, 96, 100)));
    target.x = 132; wall(w);
    const blockedHp = target.hp; idle(w, 50);
    expect(a.mem.fired).toBe(1); expect(target.hp).toBe(blockedHp);
  });

  it('luen shares one damage budget across other linked targets without multiplying it by edge count', () => {
    const { w, target } = sim('luen');
    const others = [w.spawnEnemy(DUMMY_ID, 152, 96)!, w.spawnEnemy(DUMMY_ID, 135, 116)!];
    for (const e of others) e.dormant = 0;
    idle(w, 1);
    const before = others.map(e => e.hp);
    deal(w, target, 100); idle(w, 2);
    const transfer = others.reduce((sum, e, i) => sum + before[i] - e.hp, 0);
    expect(transfer).toBeCloseTo(Math.min(w.player.stats.damage * 2, 28), 5);
    expect(others[0].hp).toBeLessThan(before[0]); expect(others[1].hp).toBeLessThan(before[1]);
    expect(w.entities.filter(e => e instanceof RefugeWeave)).toHaveLength(1);
  });

  it('luen’s next ordinary hit after a dash moves the weave and gains one knot, without repeated-dash stacking', () => {
    const { w, target } = sim('luen');
    REFUGE_DASHES[1].start!(w, w.player);
    REFUGE_DASHES[1].start!(w, w.player);
    const hp = target.hp, damage = w.player.stats.damage;
    deal(w, target, 10); idle(w, 2);
    expect(hp - target.hp).toBeCloseTo(10 + 2.8 + damage * .4, 5);
    expect(w.vars.rfLuenRetie).toBe(0);
  });

  it('direct beam, charge, pellet, summon and weapon-blast families all feed the same contribution rule', () => {
    for (const weapon of ['lantern_bolt', 'twin_lamp', 'scatter_horn', 'titan_greatsword', 'hunter_bow', 'void_gaze', 'dragon_breath', 'thunder_mortar', 'meteor_staff', 'firefly_tome']) {
      const result = measureDps({ character: 'luen', weapon, seconds: 4, dist: weapon === 'titan_greatsword' ? 20 : 60 });
      expect(result.damage, weapon + ' must actually connect in the fixture').toBeGreaterThan(0);
      expect(result.world.player.vars.rfLuenWeave, weapon).toBeGreaterThan(0);
    }
  });

  it('rebuilds restored device references that point to the wrong class or room', () => {
    for (const [id, key, Class] of [['luen', 'rfLuenWeave', RefugeWeave], ['ort', 'rfOrtGuard', RefugeGuard], ['mira', 'rfMiraSeal', RefugeSeal]] as const) {
      const { w, target } = sim(id);
      w.vars[key] = target.id;
      deal(w, target); idle(w, 2);
      const first = w.entityById(w.vars[key]) as RefugeOwned;
      expect(first, id).toBeInstanceOf(Class); expect(first.owner).toBe(w.player);
      first.mem.room--;
      idle(w, 110); deal(w, target); idle(w, 2);
      const second = w.entityById(w.vars[key]) as RefugeOwned;
      expect(second, id).toBeInstanceOf(Class); expect(second).not.toBe(first);
      expect(first.dead).toBe(true);
      expect(second.mem.room).toBe(w.node.id);
    }
  });

  it('never reuses a restored device reference belonging to another player', () => {
    for (const [id, key, Class] of [['luen', 'rfLuenWeave', RefugeWeave], ['ort', 'rfOrtGuard', RefugeGuard], ['mira', 'rfMiraSeal', RefugeSeal]] as const) {
      const { w } = sim(id);
      w.startParty([{ slot: 0, characterId: id, name: '' }, { slot: 1, characterId: id, name: '' }], 7);
      idle(w, 2);
      const [owner, other] = w.players;
      const foreign = w.withIds(() => w.spawn(id === 'luen' ? new RefugeWeave(w, other) : id === 'ort' ? new RefugeGuard(w, other) : new RefugeSeal(w, other, other.x, other.y)));
      if (foreign instanceof RefugeWeave) foreign.mem.last = w.time;
      owner.vars[key] = foreign.id;
      const target = w.spawnEnemy(DUMMY_ID, owner.x + 30, owner.y)!; target.dormant = 0;
      idle(w, 1);
      w.asPlayer(owner, () => deal(w, target)); idle(w, 2);
      const own = w.entityById(owner.vars[key]) as RefugeOwned;
      expect(own, id).toBeInstanceOf(Class); expect(own.owner).toBe(owner); expect(own).not.toBe(foreign);
      expect(foreign.dead).toBe(false);
    }
  });

  it('continuous direct-hit traffic cannot make each keeper emit extra damage faster than its cadence', () => {
    for (const id of ['tove', 'luen', 'ves', 'mira']) {
      const { w, target } = sim(id), times: number[] = [], original = w.applyHit.bind(w);
      w.applyHit = (enemy, hit) => {
        if (hit.source instanceof RefugeOwned && hit.noProc) times.push(w.time);
        return original(enemy, hit);
      };
      for (let i = 0; i < 180; i++) { deal(w, target, 1); idle(w, 1); }
      expect(times.length, id).toBeGreaterThan(1);
      const activations = [...new Set(times)];
      for (let i = 1; i < activations.length; i++) expect(activations[i] - activations[i - 1], id).toBeGreaterThanOrEqual(.2 - 1e-8);
    }
  });

  it('ves has an explicit support family for every weapon and a useful empty-slot fallback', () => {
    expect(supportFamily(null)).toBe(0);
    expect(supportFamily('titan_greatsword')).toBe(0);
    expect(supportFamily('brass_revolver')).toBe(1);
    expect(supportFamily('thunder_mortar')).toBe(2);
    expect(supportFamily('void_gaze')).toBe(3);
    for (const weapon of Weapons.all()) expect([0, 1, 2, 3], weapon.id).toContain(supportFamily(weapon.id));
    const { w, target } = sim('ves');
    deal(w, target); idle(w, 1);
    const support = w.entities.find(e => e instanceof RefugeSupport) as RefugeSupport;
    expect(support.mem.family).toBe(0);
    const ready = w.vars.rfVesNext;
    REFUGE_DASHES[2].start!(w, w.player);
    expect(w.vars.rfVesNext).toBeCloseTo(ready - .5, 8);
    for (let i = 0; i < 20; i++) { REFUGE_DASHES[2].start!(w, w.player); deal(w, target); }
    expect(w.vars.rfVesNext).toBeGreaterThanOrEqual(w.vars.rfVesLast + .2 - 1e-8);
  });

  it('ort blocks from the front with finite shared durability; a dash does not duplicate or refill its shield', () => {
    const { w } = sim('ort');
    const guard = w.entityById(w.vars.rfOrtGuard) as RefugeGuard;
    expect(guard).toBeInstanceOf(RefugeGuard);
    const shot = () => w.withIds(() => w.spawn(new Projectile({ team: 'enemy', x: guard.x + 4, y: guard.y, angle: Math.PI, speed: 100, damage: 1 })));
    const first = shot(); idle(w, 1); expect(first.dead).toBe(true); expect(w.vars.rfOrtCharges).toBe(1);
    idle(w, 13); const second = shot(); idle(w, 1); expect(second.dead).toBe(true); expect(w.vars.rfOrtCharges).toBe(0);
    REFUGE_DASHES[3].start!(w, w.player); REFUGE_PASSIVES[3].onUpdate!(w, FIXED_DT, 1); idle(w, 1);
    expect(w.entities.filter(e => e instanceof RefugeGuard)).toHaveLength(1);
    expect(w.vars.rfOrtCharges).toBe(0);
    const oldX = guard.x; w.player.x -= 30; idle(w, 8); expect(guard.x).toBe(oldX);
    idle(w, 170); expect(w.vars.rfOrtCharges).toBeGreaterThan(0); expect(guard.x).not.toBe(oldX);
  });

  it('ort lets a rear projectile pass rather than turning its barrier into omnidirectional immunity', () => {
    const { w } = sim('ort');
    const guard = w.entityById(w.vars.rfOrtGuard) as RefugeGuard;
    const back = w.withIds(() => w.spawn(new Projectile({ team: 'enemy', x: guard.x - 4, y: guard.y, angle: 0, speed: 100, damage: 1 })));
    idle(w, 2);
    expect(back.dead).toBe(false); expect(w.vars.rfOrtCharges).toBe(2);
  });

  it('mira slows movement without stopping boss scripts, and statuses cannot refresh faster than 0.5 s', () => {
    const { w, target } = sim('mira');
    if (!Enemies.has('__refuge_boss')) defineEnemy({ ...Enemies.must(DUMMY_ID), id: '__refuge_boss', boss: true });
    const boss = w.spawnEnemy('__refuge_boss', target.x, target.y + 18)!; boss.dormant = 0;
    idle(w, 1);
    const statusTimes: number[] = [];
    const apply = target.applyStatus.bind(target);
    vi.spyOn(target, 'applyStatus').mockImplementation((s, rng) => { if (s.kind === 'slow') statusTimes.push(w.time); return apply(s, rng); });
    deal(w, target); idle(w, 110);
    expect(target.speedMult()).toBeCloseTo(.7, 6);
    expect(boss.speedMult()).toBeCloseTo(.88, 6);
    expect(boss.hasStatus('stun')).toBe(false); expect(boss.hasStatus('freeze')).toBe(false);
    for (let i = 1; i < statusTimes.length; i++) expect(statusTimes[i] - statusTimes[i - 1]).toBeGreaterThanOrEqual(.5 - 1e-8);
  });

  it('mira bullet slowing ends outside the field and never permanently changes speed or stacks twice', () => {
    const { w, target } = sim('mira'); deal(w, target); idle(w, 2);
    const seal = w.entityById(w.vars.rfMiraSeal) as RefugeSeal;
    const bullet = w.withIds(() => w.spawn(new Projectile({ team: 'enemy', x: seal.x, y: seal.y + 10, angle: 0, speed: 100, damage: 1, range: 999 })));
    w.withIds(() => w.spawn(new RefugeSeal(w, w.player, seal.x, seal.y)));
    idle(w, 4); expect(bullet.speed).toBe(100); expect(bullet.vx).toBeCloseTo(70, 5);
    bullet.x = seal.x + 75; idle(w, 3); expect(bullet.vx).toBeCloseTo(100, 5);
  });

  it('mira can dash-place a seal before attacking and simultaneous placement stays a singleton', () => {
    const { w, target } = sim('mira');
    w.withIds(() => { REFUGE_DASHES[4].end!(w, w.player); deal(w, target); });
    idle(w, 1);
    expect(w.entities.filter(e => e instanceof RefugeSeal)).toHaveLength(1);
    expect(w.vars.rfMiraSeal).toBeGreaterThan(0);
  });

  for (const [mode, id] of IDS.entries()) it(id + ' release deals 11× damage, crosses no walls and generates no ember', () => {
    const { w, target } = sim(id), hp = target.hp, damage = w.player.stats.damage;
    w.player.ember = 0;
    w.withIds(() => REFUGE_RELEASES[mode](w, w.player)); idle(w, 170);
    expect((hp - target.hp) / damage).toBeCloseTo(11, 4);
    expect(w.player.ember).toBe(0);
    const other = sim(id); wall(other.w); const blocked = other.target.hp;
    other.w.withIds(() => REFUGE_RELEASES[mode](other.w, other.w.player)); idle(other.w, 170);
    expect(other.target.hp).toBe(blocked);
  });

  it('all supplementary damage rejects itself, overkill credit, releases and another keeper', () => {
    const { w } = sim();
    expect(directContribution(w, { damage: 100, dealtDamage: 3, kind: 'melee', attacker: w.player })).toBe(3);
    for (const h of [{ kind: 'status' }, { kind: 'melee', noProc: true }, { kind: 'melee', release: true }])
      expect(directContribution(w, { damage: 100, attacker: w.player, ...h } as HitInfo)).toBe(0);
    const shot = new Projectile({ team: 'player', x: 0, y: 0, angle: 0, speed: 1, damage: 10 }); shot.generation = 1;
    expect(directContribution(w, { damage: 10, kind: 'projectile', source: shot, attacker: w.player })).toBe(0);
  });

  it('four owners have separate proc budgets and downing retires only that owner’s pending charge', () => {
    const { w } = sim();
    w.startParty([0, 1, 2, 3].map(slot => ({ slot, characterId: 'tove', name: '' })), 3);
    idle(w, 1);
    const target = w.spawnEnemy(DUMMY_ID, w.players[0].x + 40, w.players[0].y)!; target.dormant = 0;
    idle(w, 1);
    w.withIds(() => { for (const owner of w.players) w.asPlayer(owner, () => deal(w, target)); });
    w.players[1].downed = true;
    idle(w, 1);
    const charges = w.entities.filter(e => e instanceof RefugeCharge) as RefugeCharge[];
    expect(charges.filter(e => !e.dead)).toHaveLength(3);
    const owners = new Set(charges.filter(e => !e.dead).map(e => e.owner.slot));
    expect(owners).toEqual(new Set([0, 2, 3]));
    expect(w.players.every(p => p.vars.rfToveEnergy === 0)).toBe(true);
  });

  it('draws do not alter any owned gameplay state and effects expire at a stage boundary', () => {
    for (const [mode, id] of IDS.entries()) {
      const { w, target } = sim(id); deal(w, target);
      w.withIds(() => REFUGE_RELEASES[mode](w, w.player)); idle(w, 2);
      const before = stateHash(w);
      for (const entity of w.entities) if (entity instanceof RefugeOwned) entity.draw(w.renderer, w);
      expect(stateHash(w), id).toBe(before);
      const effects = w.entities.filter(e => e instanceof RefugeOwned) as RefugeOwned[];
      w.run.stage++;
      for (const effect of effects) { effect.update(w, FIXED_DT); expect(effect.dead, id).toBe(true); }
    }
  });

  for (const chars of [['tove', 'luen', 'ves', 'ort'], ['mira', 'mira', 'ort', 'ves']]) it('four-player lockstep: ' + chars.join('/'), () => {
    const r = runCoop({ name: 'refuge-rework', seed: 'REFUGE-REWORK', chars, ms: 11000, link: { latencyMs: 40, jitterMs: 15, drop: .04 }, bossAt: 350, downAt: 0, leaveAt: 0, discardAt: 0 });
    const first = r.peers[0].hashes;
    for (const peer of r.peers) {
      expect(peer.desyncs).toEqual([]);
      for (let i = 0; i < Math.min(first.length, peer.hashes.length); i++) if (first[i] !== undefined && peer.hashes[i] !== undefined) expect(peer.hashes[i], `slot ${peer.slot} tick ${i}`).toBe(first[i]);
    }
  }, 30000);
});
