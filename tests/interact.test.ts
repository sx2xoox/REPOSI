import { describe, expect, it, vi } from 'vitest';
import { loadContent } from '../src/content';
import { Artifacts, Characters } from '../src/game/defs';
import { closestWithin, discardArtifact, discardBlock, discardBlockFor, findFocus, PREVIEW_RANGE } from '../src/game/interact';
import { Pedestal, Pickup } from '../src/game/pickups';
import { World } from '../src/game/world';
import { DEFAULT_BINDINGS, GAMEPLAY_ACTIONS, PAD_BUTTONS, type Action } from '../src/engine/input';
import { CONTROL_ROWS, PAD_NAMES, TOUCH_CONTROL_ROWS } from '../src/ui/keys';
import { floorHintKeys } from '../src/content/rooms/handlers';
import { GAME_BUTTONS } from '../src/ui/touch-logic';

loadContent();

const anyArtifact = () => Artifacts.all().find((a) => !a.hidden && !a.blessing)!;

describe('item focus (preview card target)', () => {
  it('picks the closest candidate strictly inside the range', () => {
    const a = { x: 10, y: 0, n: 'a' };
    const b = { x: 0, y: 6, n: 'b' };
    const far = { x: 40, y: 0, n: 'far' };
    expect(closestWithin(0, 0, [a, b, far], 28)?.n).toBe('b');
    expect(closestWithin(0, 0, [far], 28)).toBe(null);
    expect(closestWithin(0, 0, [{ x: 28, y: 0 }], 28)).toBe(null);
    expect(closestWithin(0, 0, [a, b], 28, (e) => e.n !== 'b')?.n).toBe('a');
    // ties: the earlier one wins
    expect(closestWithin(0, 0, [{ x: 5, y: 0, n: 1 }, { x: -5, y: 0, n: 2 }], 28)?.n).toBe(1);
  });

  it('only previewable entities (items with something to read) are focused', () => {
    const id = anyArtifact().id;
    const near = new Pedestal(12, 0, { kind: 'artifact', id });
    const nearer = new Pedestal(0, 8, null); // empty pedestal: nothing to read
    const coin = new Pickup('coin', 0, 3); // free coins are not previewed
    const shopMatch = new Pickup('match', -14, 0);
    shopMatch.price = 5;
    const p = { x: 0, y: 0, dead: false, alive: true, previewable: () => false };
    const w = { player: p, entities: [p, near, nearer, coin, shopMatch], transitioning: false, descending: null } as unknown as World;
    expect(findFocus(w)).toBe(near);
    near.x = 20;
    expect(findFocus(w)).toBe(shopMatch);
    shopMatch.dead = true;
    near.x = PREVIEW_RANGE + 1;
    expect(findFocus(w)).toBe(null);
    const potion = new Pickup('potion', 0, -10);
    (w.entities as unknown[]).push(potion);
    expect(findFocus(w)).toBe(potion);
    (w as unknown as { transitioning: boolean }).transitioning = true;
    expect(findFocus(w)).toBe(null);
  });

  it('pedestals are no longer taken on touch, only through interact', () => {
    const id = anyArtifact().id;
    const ped = new Pedestal(0, 0, { kind: 'artifact', id });
    const takePedestal = vi.fn();
    const p = { x: 0, y: 0, r: 5, coins: 99, dead: false, alive: true, maxRed: 6, soul: 0 };
    const w = { player: p, focus: ped, time: 1, takePedestal, sfx: vi.fn(), floatText: vi.fn(), paused: false, transitioning: false } as unknown as World;
    for (let i = 0; i < 30; i++) ped.update(w, 1 / 60);
    expect(takePedestal).not.toHaveBeenCalled();
    // interact takes the focused pedestal
    const proto = World.prototype as unknown as { interact(this: World): boolean; tryTakePedestal(this: World, ped: Pedestal): boolean };
    (w as unknown as { tryTakePedestal: unknown }).tryTakePedestal = proto.tryTakePedestal;
    expect(proto.interact.call(w)).toBe(true);
    expect(takePedestal).toHaveBeenCalledWith(ped);
    // a price that cannot be paid is refused (with feedback), nothing is taken
    takePedestal.mockClear();
    ped.price = 200;
    expect(proto.interact.call(w)).toBe(false);
    expect(takePedestal).not.toHaveBeenCalled();
    expect((w as unknown as { floatText: ReturnType<typeof vi.fn> }).floatText).toHaveBeenCalled();
  });
});

describe('discarding artifacts', () => {
  it('blessings and innate traits cannot be discarded', () => {
    const bless = Artifacts.all().find((a) => a.blessing)!;
    expect(discardBlock(bless)).toMatch(/축복/);
    // hidden (innate) artifacts are blocked too; character kits are passives now, so there may be none
    const trait = Artifacts.all().find((a) => a.hidden && !a.blessing);
    if (trait) expect(discardBlock(trait)).toBeTruthy();
    const art = anyArtifact();
    expect(discardBlock(art)).toBe(null);
    expect(discardBlock(art, [art.id])).toBeTruthy();
    // every character's starting artifacts are innate
    for (const ch of Characters.all()) {
      for (const id of ch.artifacts ?? []) {
        const w = { player: { character: ch } } as unknown as World;
        expect(discardBlockFor(w, id), `${ch.id}:${id}`).toBeTruthy();
      }
    }
  });

  function fakeWorld(held: string[]) {
    const inv = [...held];
    const dropped: { item: { kind: string; id: string }; x: number; y: number }[] = [];
    const w = {
      player: { x: 100, y: 100, aim: 0, character: Characters.all()[0] },
      entities: [] as unknown[],
      room: { isFree: (x: number) => x < 115 }, // the aim side (right) is blocked by a wall
      items: { take: (id: string) => { const i = inv.indexOf(id); if (i < 0) return false; inv.splice(i, 1); return true; } },
      dropItemPedestal(item: { kind: string; id: string }, x: number, y: number) {
        dropped.push({ item, x, y });
        const ped = new Pedestal(x, y, item as never);
        ped.waitForLeave = true;
        return ped;
      },
    };
    return { w: w as unknown as World, inv, dropped };
  }

  it('removes one copy and drops it on a pedestal next to the keeper', () => {
    const id = anyArtifact().id;
    const { w, inv, dropped } = fakeWorld([id, id, 'x']);
    const ped = discardArtifact(w, id);
    expect(ped).toBeTruthy();
    expect(inv.filter((i) => i === id).length).toBe(1);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].item).toEqual({ kind: 'artifact', id });
    const d = Math.hypot(dropped[0].x - 100, dropped[0].y - 100);
    expect(d).toBeGreaterThan(15);
    expect(dropped[0].x).toBeLessThan(115); // not inside the blocked side
    // it can be picked up again (an item pedestal that is previewable)
    expect(ped!.item).toEqual({ kind: 'artifact', id });
    expect(ped!.previewable()).toBe(true);
  });

  it('refuses blessings / innate artifacts and items not held', () => {
    const bless = Artifacts.all().find((a) => a.blessing)!.id;
    const innate = Characters.all()[0].artifacts?.[0];
    const { w, inv, dropped } = fakeWorld([bless, ...(innate ? [innate] : [])]);
    expect(discardArtifact(w, bless)).toBe(null);
    if (innate) expect(discardArtifact(w, innate)).toBe(null);
    expect(discardArtifact(w, anyArtifact().id)).toBe(null);
    expect(inv.length).toBe(innate ? 2 : 1);
    expect(dropped).toHaveLength(0);
  });
});

describe('input bindings', () => {
  it('gameplay actions never share a key or a gamepad button', () => {
    const seen = new Map<string, Action>();
    for (const a of GAMEPLAY_ACTIONS) {
      for (const code of DEFAULT_BINDINGS[a]) {
        expect(seen.get(code), `${code}: ${seen.get(code)} / ${a}`).toBeUndefined();
        seen.set(code, a);
      }
    }
    const pads = new Map<number, Action>();
    for (const a of GAMEPLAY_ACTIONS) {
      for (const b of PAD_BUTTONS[a] ?? []) {
        // A doubles as dash and confirm; dash itself is bound to A and RB
        expect(pads.get(b), `pad ${b}: ${pads.get(b)} / ${a}`).toBeUndefined();
        pads.set(b, a);
      }
    }
  });

  it('interact has a key, a pad button and a touch button, and is listed in the controls', () => {
    expect(DEFAULT_BINDINGS.interact).toContain('KeyG');
    expect(PAD_BUTTONS.interact?.length).toBeGreaterThan(0);
    expect(PAD_NAMES.interact).toBeTruthy();
    expect(GAME_BUTTONS).toContain('interact');
    expect(CONTROL_ROWS.some((r) => r.actions.includes('interact'))).toBe(true);
    expect(TOUCH_CONTROL_ROWS.some((r) => r[1].startsWith('줍기'))).toBe(true);
  });

  it('the first-room floor hints read their key caps from the bindings (pick-up / matches on G)', () => {
    expect(floorHintKeys({ keys: ['?'], action: 'interact' }, DEFAULT_BINDINGS)).toEqual(['G']);
    expect(floorHintKeys({ keys: ['?'], action: 'dash' }, DEFAULT_BINDINGS)).toEqual(['Space']);
    expect(floorHintKeys({ keys: ['?'], action: 'swap' }, DEFAULT_BINDINGS)).toEqual(['C']);
    expect(floorHintKeys({ keys: ['W', 'A', 'S', 'D'] }, DEFAULT_BINDINGS)).toEqual(['W', 'A', 'S', 'D']);
    expect(floorHintKeys({ keys: ['G'], action: 'interact' }, { ...DEFAULT_BINDINGS, interact: ['KeyH'] })).toEqual(['H']);
  });

  it('Tab-screen actions (tabs, discard) use distinct keys and pad buttons', () => {
    const ui: Action[] = ['tabPrev', 'tabNext', 'discard', 'inventory', 'cancel'];
    const codes = ui.flatMap((a) => DEFAULT_BINDINGS[a]);
    expect(new Set(codes).size).toBe(codes.length);
    const pads = ['tabPrev', 'tabNext', 'discard'].flatMap((a) => PAD_BUTTONS[a as Action] ?? []);
    expect(new Set(pads).size).toBe(pads.length);
    expect(pads.length).toBe(3);
  });
});
