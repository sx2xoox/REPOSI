// Foundry weapons share the game's native scale, but not a generic hit flash.
// Everything here is cosmetic: no damage, RNG decisions or simulation state.
import { Entity } from '../../game/entity';
import { Weapons, type WeaponState } from '../../game/defs';
import type { Player } from '../../game/player';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { ProjBehavior } from '../../game/projectile';
import { save } from '../../engine/save';
import { getSprite } from '../../engine/sprites';
import { visualHandPos } from '../../game/weapon-pose';
import { heldLocalPoint } from '../../game/weapon-presentation';
import { PIXELLAB_WEAPON_LAYOUT } from '../../ui/pixellab-weapon-layout';
import { drawArsenal } from './arsenal-presentation';
import { drawHeld, glowSprite, pixLine } from './common';
import type { ArsenalSpec } from './refuge-arsenal';

type ImpactKind = 'rifle' | 'shotgun' | 'pike' | 'pike-finisher' | 'maul' | 'bow' | 'bow-full';
const FALLBACK: Record<string, string> = {
  sunset_rifle: 'ember_musket', gatekeeper_shotgun: 'bell_blunderbuss',
  dawn_pike: 'comet_pike', gatebreaker_maul: 'cathedral_mace', silvermoon_longbow: 'crescent_bow',
};
const cosmeticTimes = new WeakMap<Player, Partial<Record<ImpactKind, number>>>();
function opacity(w: World, p: Player): number {
  if (!w.coop || p === w.local) return 1;
  const value = save.settings.teammateProjectileOpacity ?? .5;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .5;
}

/** Short directional metal/wood strikes. Cosmetic IDs cannot shift lockstep IDs. */
class FoundryHit extends Entity {
  static override readonly cosmetic = true;
  constructor(readonly owner: Player, x: number, y: number, readonly angle: number, readonly kind: ImpactKind) {
    super(); this.x = x; this.y = y; this.ctxP = owner; this.layer = 2; this.tileCollide = false;
  }
  override update(_w: World, dt: number): void { this.age += dt; if (this.age >= .27) this.dead = true; }
  override draw(r: Renderer, w: World): void {
    const a = Math.max(0, 1 - this.age / .27) * opacity(w, this.owner);
    if (a <= 0) return;
    const t = this.age / .27, c = Math.cos(this.angle), s = Math.sin(this.angle);
    const point = (along: number, across: number) => ({ x: this.x + c * along - s * across, y: this.y + s * along + c * across });
    const line = (u: number, v: number, u2: number, v2: number, color: string, alpha = a) => {
      const p = point(u, v), q = point(u2, v2); pixLine(r, p.x, p.y, q.x, q.y, color, alpha);
    };
    const heavy = this.kind === 'maul', finish = this.kind === 'pike-finisher', moon = this.kind === 'bow-full';
    const color = heavy ? '#b4a4c9' : moon || this.kind === 'bow' ? '#b8cbea' : '#d9b37e';
    const extent = heavy ? 18 : finish ? 15 : moon ? 13 : 8;
    // Brief bright contact; trailing chips expand in the direction of the blow.
    if (t < .27) {
      line(-2, 0, 5, 0, '#fff4d8', a);
      line(0, -3, 0, 3, '#fff4d8', a * .8);
    }
    for (let i = -1; i <= 1; i++) {
      const u = 3 + t * extent, v = i * (2 + t * (heavy ? 10 : 5));
      line(u - 4 * a, v - i * a * 2, u, v, color, a * .85);
    }
    if (heavy) {
      // Broad, flattened dust catches the weight without painting over enemies.
      for (let i = 0; i < 5; i++) {
        const p = point(4 + i * 2 + t * 6, (i - 2) * (3 + t * 3));
        r.rect(p.x, p.y + 3 + t * 3, 3 - i % 2, 1, '#8f8396', a * .6);
      }
      line(-3, -7 - t * 7, 1, -3 - t * 4, '#e8d9e7', a * .6);
      line(-3, 7 + t * 7, 1, 3 + t * 4, '#e8d9e7', a * .6);
    } else if (moon) {
      const tip = 4 + t * 8;
      line(-tip, 0, 0, -tip * .55, color, a * .7);
      line(0, -tip * .55, tip, 0, '#eff5ff', a * .8);
      line(tip, 0, 0, tip * .55, color, a * .7);
      line(0, tip * .55, -tip, 0, color, a * .4);
    } else if (finish) {
      line(-11 + t * 9, -3, 7 + t * 8, -3, '#f5e5b3', a * .6);
      line(-11 + t * 9, 3, 7 + t * 8, 3, '#ba995f', a * .6);
    }
  }
}

export function foundryImpact(w: World, p: Player, x: number, y: number, aim: number, kind: ImpactKind): void {
  // A pellet fan or wide swing is one visual beat, not six stacked starbursts.
  const times = cosmeticTimes.get(p) ?? {};
  if (w.time - (times[kind] ?? -Infinity) < .035) return;
  times[kind] = w.time; cosmeticTimes.set(p, times);
  w.spawn(new FoundryHit(p, x, y - 3, aim, kind));
}

export const foundryTrail: ProjBehavior = {
  id: 'foundry_ballistic_trace',
  draw(pr, r) {
    const kind = pr.mem.foundryKind ?? 1, full = kind === 4;
    const len = Math.min(pr.traveled, full ? 18 : kind === 2 ? 5 : 11);
    const c = Math.cos(pr.angle), s = Math.sin(pr.angle), x = pr.x, y = pr.y - pr.z;
    pixLine(r, x - c * len, y - s * len, x - c * 3, y - s * 3, pr.color, full ? .7 : .45);
    if (full && len > 8) {
      // Two silver barbs echo the bow's limbs; no halo over the target.
      for (const side of [-1, 1]) {
        pixLine(r, x - c * 13 - s * side * 3, y - s * 13 + c * side * 3,
          x - c * 6, y - s * 6, '#f0f2ff', .55);
      }
    }
  },
};

export function drawFoundryWeapon(d: ArsenalSpec, w: World, p: Player, r: Renderer, st: WeaponState): void {
  const sprite = Weapons.must(d.id).heldSprite!;
  const since = w.time - (st.mem.shotAt ?? -9);
  const reload = d.id === 'gatekeeper_shotgun' && st.mem.shotIndex === 2 && st.cooldown > 0;
  if (d.id === 'gatebreaker_maul' && st.mem.winding) {
    const total = Math.max(.01, st.mem.impactAt - st.mem.windStart);
    const q = Math.max(0, Math.min(1, 1 - (st.mem.impactAt - w.time) / total));
    const side = Math.cos(st.mem.windAim) < 0 ? -1 : 1;
    drawHeld(r, p, sprite, st.mem.windAim - side * (1.15 + q * .45), 4 - q * 2, { flash: q > .78 ? .14 : 0 });
  } else if (reload) {
    const q = 1 - Math.max(0, st.cooldown) / Math.max(.01, st.mem.interval);
    const side = Math.cos(p.aim) < 0 ? -1 : 1;
    drawHeld(r, p, sprite, p.aim + side * Math.sin(q * Math.PI) * .27, 5 - Math.sin(q * Math.PI) * 2);
    // Two spent brass cases drop from the breech at the start of a reload.
    if (q < .38) {
      const h = visualHandPos(p, p.aim, 6), t = q / .38;
      for (let i = 0; i < 2; i++) {
        r.rect(h.x - side * (2 + t * (6 + i * 3)), h.y + 3 - Math.sin(t * Math.PI) * 4 + t * 6 + i * 2, 2, 1, '#cea76b', 1 - t);
      }
    }
  } else drawArsenal(d, w, p, r, st, sprite, `shot_${FALLBACK[d.id]}`);

  if (d.id === 'gatekeeper_shotgun' && (p.firing || reload || since < 1.1)) {
    const q = reload ? 1 - st.cooldown / Math.max(.01, st.mem.interval) : 1;
    const loaded = reload ? 0 : st.mem.shells === 1 ? 1 : 2;
    // A compact two-shell indicator replaces the generic floating progress bar.
    for (let i = 0; i < 2; i++) {
      const x = p.x - 4 + i * 5, y = p.y - 23;
      r.rect(x - 1, y - 1, 4, 5, '#201926', .85);
      r.rect(x, y, 2, 3, i < loaded ? '#f2ca83' : '#54455b', .95);
      if (reload) r.rect(x, y + 2, 2 * Math.max(0, Math.min(1, q)), 1, '#b39060', .8);
    }
  }
  if (d.id === 'dawn_pike' && st.combo % 3 === 2 && st.comboTimer > 0 && since > .15) {
    const h = visualHandPos(p, p.aim, 8), c = Math.cos(p.aim), s = Math.sin(p.aim);
    for (let i = 0; i < 2; i++) {
      const x = h.x + c * (9 + i * 4), y = h.y + s * (9 + i * 4);
      pixLine(r, x - s * 2, y + c * 2, x + s * 2, y - c * 2, '#fff0b1', .82);
    }
  }
  if (d.id === 'silvermoon_longbow' && st.charge > 0) {
    const q = st.charge, h = visualHandPos(p, p.aim, 6), sp = getSprite(sprite);
    const layout = PIXELLAB_WEAPON_LAYOUT[d.id];
    const native = sprite.startsWith('pl_');
    const tip = (top: boolean) => {
      const pt = layout.bowTips![top ? 0 : 1];
      return heldLocalPoint(h.x, h.y, p.aim, native ? pt[0] - sp.ox : 3, native ? pt[1] - sp.oy : top ? -8 : 8);
    };
    const nock = heldLocalPoint(h.x, h.y, p.aim, -4 - q * 4, 0);
    for (const upper of [true, false]) {
      const t = tip(upper), slide = Math.min(1, q * 1.2);
      const x = t.x + (nock.x - t.x) * slide, y = t.y + (nock.y - t.y) * slide;
      r.rect(x, y, q > .7 ? 2 : 1, 1, '#e9eeff', .4 + .5 * q);
    }
    if (q > .6) {
      r.sprite(glowSprite(4 + q * 3, '#b1c6e8'), nock.x, nock.y, { alpha: (q - .6) * .65, additive: true });
      const c = Math.cos(p.aim), s = Math.sin(p.aim);
      pixLine(r, nock.x - c * 2, nock.y - s * 2, nock.x + c * 8, nock.y + s * 8, '#eef5ff', (q - .6) * 1.8);
    }
  }
}
