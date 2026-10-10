import './headless';
import { describe, expect, it, vi } from 'vitest';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Renderer } from '../src/engine/renderer';
import { fakeDisplay } from './headless';
import { fixedRules, clearInput } from '../src/game/seam';
import { FIXED_DT } from '../src/game/constants';
import { applyCoopCommand } from '../src/game/coop';
import { blessingChoices } from '../src/game/blessings';
import { Pickup, Pedestal } from '../src/game/pickups';
import { familiarsOf, syncFamiliars, Familiar } from '../src/content/items/lib';
import { stateHash } from '../src/game/statehash';
import { Projectile } from '../src/game/projectile';
import { save } from '../src/engine/save';
import { ClockHand } from '../src/content/bosses/kit7';
loadContent();
function party(chars = ['bori', 'ria'], local = 1) {
  const w = new World(new Renderer(fakeDisplay(1280, 720)), new RunState('COOP-RULES', chars[0]), { openInventory() {}, onGameOver() {} });
  w.rules = fixedRules({ hitStop: false });
  w.startParty(chars.map((characterId, slot) => ({ slot, characterId, name: `P${slot}` })), local);
  w.inputSource = (_w, _p, out) => clearInput(out);
  return w;
}
const step = (w: World, n = 1) => { for (let i = 0; i < n; i++) w.update(FIXED_DT); };
const advance = (w: World, seconds: number) => {
  const until = w.time + seconds;
  for (let i = 0; w.time < until && i < 1000; i++) step(w);
};
function down(w: World, slot: number) {
  const p = w.players[slot]; p.invuln = 0; p.shields = 0; p.soul = 0; p.red = 1; p.stats.dodge = 0;
  p.hurt(w, 20, 'test', true);
  return p;
}
describe('co-op ownership and rules', () => {
  it('teammate opacity scopes sprites and light without changing simulation state', () => {
    const w = party(['ria', 'ria']); const r = w.renderer;
    const teammate = new Projectile({ team: 'player', owner: w.players[0], x: 100, y: 100, angle: 0, speed: 100, damage: 5, light: 30 });
    const own = new Projectile({ team: 'player', owner: w.local, x: 110, y: 100, angle: 0, speed: 100, damage: 5 });
    const enemy = new Projectile({ team: 'enemy', x: 120, y: 100, angle: 0, speed: 100, damage: 1 });
    w.spawn(teammate); w.spawn(own); w.spawn(enemy); step(w);
    const before = stateHash(w); const previous = save.settings.teammateProjectileOpacity;
    const drawn: number[] = [];
    const originalDraw = r.ctx.drawImage;
    r.ctx.drawImage = () => { drawn.push(r.ctx.globalAlpha); };
    const light = vi.spyOn(w.lights, 'add');
    try {
      save.settings.teammateProjectileOpacity = 1;
      own.draw(r, w); enemy.draw(r, w); const baseline = [...drawn]; drawn.length = 0;
      save.settings.teammateProjectileOpacity = 0.3;
      teammate.draw(r, w); expect(drawn).toContain(0.3); expect(r.worldOpacity).toBe(1);
      drawn.length = 0; own.draw(r, w); enemy.draw(r, w); expect(drawn).toEqual(baseline);
      teammate.light(w); expect(light.mock.calls.at(-1)?.[4]?.intensity).toBeCloseTo(0.24);
      save.settings.teammateProjectileOpacity = 0;
      drawn.length = 0; light.mockClear(); teammate.draw(r, w); teammate.light(w);
      expect(drawn).toEqual([]); expect(light).not.toHaveBeenCalled();
      expect(stateHash(w)).toBe(before);
      w.coop = false; expect(teammate.visualOpacity(w)).toBe(1); w.coop = true;
    } finally { save.settings.teammateProjectileOpacity = previous; r.ctx.drawImage = originalDraw; light.mockRestore(); }
  });
  it('floor 7 sweeping clock hands hit both keepers, with independent cooldowns', () => {
    const w = party(['ria', 'ria']);
    const e = w.withIds(() => w.spawnEnemy('clockmaker', w.room.centerX - 50, w.room.centerY))!;
    const hand = new ClockHand(e, 0, { source: '시계장인', warn: 0, duration: 5, omega: 0 });
    for (const p of w.players) { p.x = e.x + 50; p.y = e.y + 4; p.stats.dodge = 0; }
    hand.update(w, FIXED_DT);
    expect(w.players.map(p => p.red)).toEqual(w.players.map(p => p.maxRed - 1));
    for (const p of w.players) p.invuln = 0;
    hand.update(w, FIXED_DT);
    expect(w.players.map(p => p.red)).toEqual(w.players.map(p => p.maxRed - 1));
  });
  it('a remote hurt downs its owner; Bori revives with two hearts in one second', () => {
    const w = party(); const [helper, p] = w.players; helper.x = p.x; helper.y = p.y;
    down(w, 1); expect(p.downed).toBe(true); expect(helper.downed).toBe(false);
    advance(w, 0.95); expect(p.downed).toBe(true);
    advance(w, 0.1); expect(p.downed).toBe(false); expect(p.red).toBe(4); expect(w.player).toBe(w.local);
  });
  it('normal revive takes two seconds and all-down ends the party', () => {
    const w = party(['ria', 'serin']); const [a, b] = w.players; a.x = b.x; a.y = b.y;
    down(w, 1); advance(w, 1.1); expect(b.downed).toBe(true);
    advance(w, 1); expect(b.downed).toBe(false); expect(b.red).toBe(2);
    down(w, 0); down(w, 1); step(w, 110); expect(w.gameOver?.won).toBe(false);
  });
  it('coins are shared, hearts go to an injured keeper, and keeper blasts spare teammates', () => {
    const w = party(['ria', 'ria']); const [a, b] = w.players;
    b.coins += 5; expect(a.coins).toBe(5); b.red -= 2;
    a.x = b.x; a.y = b.y;
    w.spawn(new Pickup('heart', b.x, b.y)); step(w, 100);
    expect(b.red).toBe(b.maxRed); expect(a.red).toBe(a.maxRed);
    w.asPlayer(a, () => w.explode(a.x, a.y, 40, 1, { noTiles: true, byPlayer: true }));
    expect(a.red).toBe(a.maxRed - 2); expect(b.red).toBe(b.maxRed);
  });
  it('blessing commands apply only to the sender and reject duplicate/stale/invalid choices', () => {
    const w = party(); const p = w.players[0];
    const id = w.asPlayer(p, () => blessingChoices(w)[0]);
    expect(applyCoopCommand(w, 0, { type: 'bless', floor: 1, id })).toBe(true);
    expect(p.items.hasArtifact(id)).toBe(true); expect(w.players[1].items.hasArtifact(id)).toBe(false);
    expect(applyCoopCommand(w, 0, { type: 'bless', floor: 1, id })).toBe(false);
    expect(applyCoopCommand(w, 1, { type: 'bless', floor: 2, id })).toBe(false);
    expect(applyCoopCommand(w, 1, { type: 'bless', floor: 1, id: 'fake' })).toBe(false);
    expect(applyCoopCommand(w, 1, { type: 'end' })).toBe(false);
  });
  it('four Moris own separate flocks, keep them across rooms, and retire them on leave', () => {
    const w = party(['mori', 'mori', 'mori', 'mori']); step(w, 3);
    for (const p of w.players) w.asPlayer(p, () => {
      const sheep = familiarsOf(w, 'mori_sheep'); expect(sheep.length).toBeGreaterThanOrEqual(3);
      expect(sheep.every(e => e.ctxP === p)).toBe(true);
    });
    const treasure = w.map.nodes.find(n => n.kind === 'treasure')!;
    w.withIds(() => w.enterRoom(treasure, null)); step(w, 3);
    expect(w.entities.filter(e => e instanceof Pedestal && e.item).length).toBeGreaterThanOrEqual(4);
    const leaver = w.players[3]; const owned = w.entities.filter(e => e.ctxP === leaver);
    expect(owned.length).toBeGreaterThan(0); w.removePlayer(3); expect(owned.every(e => e.dead)).toBe(true);
  });
  it('summon limits are per keeper and drawing does not mutate co-op state', () => {
    class TestPet extends Familiar {}
    const w = party(['ria', 'ria']);
    for (const p of w.players) w.asPlayer(p, () => expect(syncFamiliars(w, 'test', 12, ww => new TestPet(ww))).toHaveLength(12));
    step(w, 2); const h = stateHash(w); w.draw(0.5); expect(stateHash(w)).toBe(h);
  });
});
