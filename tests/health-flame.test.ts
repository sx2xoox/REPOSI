// Health is the keeper's lamp fire, not hearts (user 2026-10-10: "일반 체력도 등불지기에
// 어울리게"). Health pickups read as 불꽃 / 작은 불꽃 (internal kinds stay 'heart' /
// 'heart_half'), every health price shows the flame icon, and no player-facing text
// names hearts (하트 / ♥). Presentation only: the simulation is untouched.
import './headless';
import { describe, expect, it } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { hasAnim, hasSprite } from '../src/engine/sprites';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { Actives, Artifacts, Characters, Potions, Weapons } from '../src/game/defs';
import { Pedestal, Pickup, PICKUP_SPRITE, type PickupKind } from '../src/game/pickups';
import { BLUE_FLAME_ICON, FloatingText, LIFE_ICON } from '../src/game/effects';
import { LanternShrine, OfferingBowl } from '../src/content/rooms/shrine';
import { buildCard } from '../src/ui/item-tooltip';
import { FIXED_DT } from '../src/game/constants';

loadContent();

function setup() {
  const run = new RunState('HEALTH-FLAME', 'ria'); run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  w.start();
  for (const e of [...w.enemies]) w.killEnemy(e);
  const p = w.player; p.x = 70; p.y = 65;
  return w;
}

const KINDS: PickupKind[] = ['coin', 'coin_string', 'heart_half', 'heart', 'blue_flame', 'blue_flame_half', 'match', 'matchbox', 'potion'];
const HEARTISH = /하트|♥|♡|❤/;

describe('health is the lamp flame', () => {
  it('health pickups are named 불꽃 / 작은 불꽃 and keep 체력 in the description', () => {
    const w = setup();
    const card = (kind: PickupKind) => {
      const pk = new Pickup(kind, w.player.x, w.player.y); pk.price = 3;
      return buildCard(w, pk)!;
    };
    expect(card('heart').name).toBe('불꽃');
    expect(card('heart').desc).toBe('체력을 한 칸 회복한다');
    expect(card('heart_half').name).toBe('작은 불꽃');
    expect(card('heart_half').desc).toBe('체력을 반 칸 회복한다');
    expect(card('heart').icon).toBe('pk_flame');
    expect(card('heart_half').icon).toBe('pk_flame_half');
    for (const kind of KINDS) {
      const c = card(kind);
      expect(`${c.name} ${c.desc}`, kind).not.toMatch(HEARTISH);
    }
  });

  it('health pickups draw warm flames (animated like the blue ones), no heart sprites left', () => {
    expect(PICKUP_SPRITE.heart).toBe('pk_flame');
    expect(PICKUP_SPRITE.heart_half).toBe('pk_flame_half');
    for (const s of ['pk_flame', 'pk_flame_half', 'hud_flame', 'fx_life_flame', 'fx_blue_flame', 'pk_flame_0', 'pk_flame_half_2']) expect(hasSprite(s), s).toBe(true);
    expect(hasAnim('pk_flame_anim')).toBe(true);
    expect(hasAnim('pk_flame_half_anim')).toBe(true);
    for (const s of ['pk_heart', 'pk_heart_half', 'hud_heart_full', 'st_heart']) expect(hasSprite(s), s).toBe(false);
  });

  it('every health price shows the flame: 대가의 방 pedestals and the shrine pact', () => {
    const w = setup(), p = w.player;
    const ped = new Pedestal(p.x, p.y, { kind: 'artifact', id: 'prism_shard' }); ped.heartPrice = 1;
    w.spawn(ped);
    expect(buildCard(w, ped)?.price?.icon).toBe('hud_flame');
    const bowl = new OfferingBowl(p.x, p.y, 'heart', new LanternShrine(200, 100));
    const info = bowl.interactionInfo(w);
    expect(info.icon).toBe('pk_flame');
    expect(info.price?.icon).toBe('hud_flame');
  });

  it('health float texts carry a flame icon instead of a heart glyph', () => {
    const w = setup(), p = w.player;
    // spawns land once the hit-stop is over
    const texts = () => { for (let i = 0; i < 12; i++) w.update(FIXED_DT); return w.entities.filter((e) => e instanceof FloatingText && !e.dead) as FloatingText[]; };
    p.soul = 0; p.shields = 0; p.invuln = 0;
    expect(p.hurt(w, 1, 'test', true)).toBe(true);
    const red = texts().at(-1)!;
    expect(red.icon).toBe(LIFE_ICON);
    expect(red.text).not.toMatch(HEARTISH);
    p.invuln = 0; p.addSoul(4);
    expect(p.hurt(w, 1, 'test', true)).toBe(true);
    const blue = texts().at(-1)!;
    expect(blue.icon).toBe(BLUE_FLAME_ICON);
    expect(blue.text).not.toMatch(HEARTISH);
  });

  it('no item, keeper or blessing text names hearts; the max-health brazier is not a 심장', () => {
    for (const d of [...Artifacts.all(), ...Actives.all(), ...Potions.all(), ...Weapons.all()]) {
      const text = [d.name, d.desc, 'detail' in d ? d.detail : '', 'signature' in d ? d.signature : ''].join(' ');
      expect(text, d.id).not.toMatch(HEARTISH);
    }
    for (const c of Characters.all()) {
      const text = [c.name, c.desc, c.passive?.name, c.passive?.desc, c.releaseName, c.releaseDesc].join(' ');
      expect(text, c.id).not.toMatch(HEARTISH);
    }
    expect(Artifacts.must('ember_heart').name).toBe('불씨 화로');
  });
});
