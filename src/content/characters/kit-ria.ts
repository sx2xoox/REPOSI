// 리아's kit — the lantern keeper, built around 등불 해방 and embers.
//   passive 불씨 심지: the ember gauge fills 40% faster; every hit leaves an ember
//     mark on the enemy and the 4th mark ignites (small burst + burn, +ember)
//   dash 불씨 질주: a short rush that leaves a burning trail
//   release 등불 개화 (releases.ts), a larger lantern light (CharacterDef.lightRadius)
//   affinity 등불 무기: with a lantern weapon the marks ignite on the 3rd hit and the
//     spark bursts and burns 85% harder (the ember refund per hit stays the same)

import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { AffinityDef, DashDef, PassiveDef } from '../../game/defs';
import { Enemy } from '../../game/enemy';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
import type { HitInfo } from '../../game/entity';
import { clamp } from '../../engine/math';
import { WEAPON_DAMAGE_SCALE } from '../../game/stats';
import { HazardZone, enemiesNear, hitWeight, isAttack, itemHit, proc } from '../items/lib';
import { EnemyOverlay, O, ensureOverlay, trailReset, trailStep } from './kit';

/** Extra ember gained per hit (fraction of the base gain). */
export const RIA_EMBER_BONUS = 0.4;
/** Hits on one enemy that ignite its ember marks (laser ticks count half). */
export const RIA_SPARK_HITS = 4;
/** Marks fade when the enemy was not hit for this long (s). */
export const RIA_MARK_TIME = 5;
export const RIA_SPARK_RADIUS = 20;
/** Spark burst damage / burn damage per second, as fractions of player damage. */
export const RIA_SPARK_DMG = 0.5;
export const RIA_SPARK_BURN = 0.3;
/** Ember refunded by a spark. */
export const RIA_SPARK_EMBER = 5;
/** Burning trail of the dash: damage per tick (fraction of player damage) and zone life (s). */
export const RIA_TRAIL_DMG = 0.25;
export const RIA_TRAIL_LIFE = 1.3;
/**
 * 등불 무기 (affinity): marks ignite on this many hits, and the spark's burst / burn
 * (fractions of player damage) with a favoured lantern weapon.
 */
export const RIA_SPARK_HITS_AFFINITY = 3;
export const RIA_SPARK_DMG_AFFINITY = 0.925;
export const RIA_SPARK_BURN_AFFINITY = 0.555;
/**
 * Lantern weapons (the affinity matches these ids): the hand lantern, the twin-wick lamp gun,
 * the wandering lamp spirit, the first keeper's dawn lantern and the rescue-lantern flail.
 * 지뢰 등잔 stays out while its mine blasts do not count as attacks (no marks, no sparks).
 */
export const RIA_LANTERN_WEAPONS = ['lantern_bolt', 'twin_lamp', 'wandering_lamp', 'dawn_lantern', 'lantern_flail'];

const EMBER_COLORS = ['#ffffff', '#ffe080', '#ff9a30', '#c04010'];

// ------------------------------------------------------------------ icons
defineDrawnSprite('icon_ria_passive', 16, 16, (p) => {
  // a candle wick carrying a bright ember, sparks around it
  p.rect(6, 9, 4, 6, '#e8e0c8');
  p.rect(6, 9, 1, 6, '#b8a888');
  p.line(8, 6, 8, 9, '#3a2a1a');
  p.ellipse(8, 4.5, 2.5, 3.5, '#ff9a30');
  p.ellipse(8, 5, 1.4, 2.2, '#ffe080');
  p.px(8, 5, '#ffffff');
  p.px(3, 3, '#ffd060');
  p.px(13, 2, '#ff9a30');
  p.px(2, 8, '#ff9a30');
  p.px(13, 7, '#ffd060');
}, { outline: O });

defineDrawnSprite('icon_ria_dash', 16, 16, (p) => {
  // a diagonal streak of flame tongues trailing to the lower left
  p.poly([1, 14, 4, 11, 6, 13, 3, 15], '#c04010');
  p.poly([4, 11, 8, 7, 10, 10, 6, 13], '#ff7a20');
  p.poly([8, 7, 12, 3, 14, 6, 10, 10], '#ffb040');
  p.line(5, 10, 12, 3, '#ffe080');
  p.px(13, 2, '#ffffff');
  p.px(14, 4, '#ffffff');
  p.px(2, 9, '#ffd060');
  p.px(11, 12, '#ff9a30');
}, { outline: O });

// ------------------------------------------------------------------ ember marks
/** Is a favoured lantern weapon in hand (CharacterDef.affinity)? */
function lanternHeld(w: World): boolean {
  return w.player.flags.has('affinity');
}

/** Marks that ignite a spark: 4, or 3 with a lantern weapon. */
export function sparkHits(w: World): number {
  return lanternHeld(w) ? RIA_SPARK_HITS_AFFINITY : RIA_SPARK_HITS;
}

/**
 * Marks a hit leaves: its size next to one plain weapon shot (the keeper's damage x
 * WEAPON_DAMAGE_SCALE), 0.25..2, laser ticks half. A plain shot leaves exactly one mark, so
 * "the 4th hit" (3rd with a lantern) holds however the damage is split, and the weapon
 * damage scale does not slow the sparks down (kits keep the keeper's cadence).
 */
export function markWeight(w: World, hit: HitInfo): number {
  const plain = Math.max(1, w.player.stats.damage * WEAPON_DAMAGE_SCALE);
  return hitWeight(hit) * clamp(hit.damage / plain, 0.25, 2);
}

/** Ember marks orbiting the enemies that carry them (cosmetic). */
class EmberMarks extends EnemyOverlay {
  drawMark(r: Renderer, w: World, e: Enemy): void {
    const n = e.mem.__riaMarks ?? 0;
    if (n <= 0 || w.time - (e.mem.__riaAt ?? -99) > RIA_MARK_TIME) return;
    const top = e.y - e.z - e.r - 4;
    const count = Math.ceil(n);
    for (let i = 0; i < count; i++) {
      const a = this.age * 4 + (i / count) * Math.PI * 2;
      const x = e.x + Math.cos(a) * (e.r + 2);
      const y = top + 2 + Math.sin(a) * 2;
      const hot = Math.floor(this.age * 10 + i) % 2 === 0;
      r.rect(x - 1, y - 1, 2, 2, hot ? '#ffe080' : '#ff9a30', 0.95);
      r.rect(x - 1, y - 1, 1, 1, '#ffffff', hot ? 0.9 : 0.4);
    }
  }

  override lightMark(w: World, e: Enemy): void {
    const n = e.mem.__riaMarks ?? 0;
    if (n <= 0 || w.time - (e.mem.__riaAt ?? -99) > RIA_MARK_TIME) return;
    w.lights.add(e.x, e.y - e.z - 4, 14 + 4 * n, '#ff9a30', { intensity: 0.25 + 0.1 * n });
  }
}

/**
 * The 4th ember mark (3rd with a lantern weapon) ignites: a small burst that burns
 * nearby enemies and refunds ember. The lantern spark hits 85% harder; the refund
 * follows the marks, so the gauge fills per hit exactly as fast either way.
 */
export function emberSpark(w: World, e: Enemy): void {
  const d = w.player.stats.damage;
  const lantern = lanternHeld(w);
  const y = e.y - e.z - 3;
  w.sfx('ember_burst', { vol: lantern ? 0.8 : 0.7, pitch: lantern ? 1.12 : 1, x: e.x });
  w.spawn(new RingFx(e.x, y, RIA_SPARK_RADIUS + 2, 0.28, '#ffb040', 2));
  if (lantern) w.spawn(new RingFx(e.x, y, RIA_SPARK_RADIUS - 6, 0.2, '#fff2b0', 1));
  w.particles.burst(e.x, y, { count: lantern ? 24 : 16, speed: [40, lantern ? 160 : 130], life: [0.2, 0.45], colors: EMBER_COLORS, size: [1, 2], additive: true, light: 5, lightColor: '#ff9a30' });
  w.lights.glow(e.x, y, lantern ? 56 : 44, '#ff9a30', lantern ? 0.75 : 0.6);
  const burst = lantern ? RIA_SPARK_DMG_AFFINITY : RIA_SPARK_DMG;
  const burn = lantern ? RIA_SPARK_BURN_AFFINITY : RIA_SPARK_BURN;
  for (const t of enemiesNear(w, e.x, e.y, RIA_SPARK_RADIUS)) {
    itemHit(w, t, d * burst, { from: { x: e.x, y: e.y + 0.01 }, knockback: 60, kind: 'explosion', procs: ['ria_spark'], statuses: [{ kind: 'burn', duration: 2, power: d * burn }] });
  }
  w.player.addEmber((RIA_SPARK_EMBER * sparkHits(w)) / RIA_SPARK_HITS);
  proc(w, 'passive:ria');
}

export const RIA_PASSIVE: PassiveDef = {
  name: '불씨 심지',
  desc: '등불이 40% 빨리 차고, 같은 적을 네 번 때리면 불씨가 터져 주변을 태운다.',
  icon: 'icon_ria_passive',
  look: { aura: '#ffd8a0', hit: '#ffb040', step: '#ff9a3a' },
  onHit(w, t, hit) {
    if (!isAttack(hit)) return;
    const p = w.player;
    // the same charge the hit already gave (hit size, boss and beam rules, no secondary shots)
    p.addEmber(RIA_EMBER_BONUS * (hit.emberCharge ?? 0));
    if (!(t instanceof Enemy) || !t.alive) return;
    const stale = w.time - (t.mem.__riaAt ?? -99) > RIA_MARK_TIME;
    // marks follow hit size: four plain shots' worth of damage, however it is split
    const n = (stale ? 0 : t.mem.__riaMarks ?? 0) + markWeight(w, hit);
    t.mem.__riaAt = w.time;
    if (n >= sparkHits(w)) {
      t.mem.__riaMarks = 0;
      emberSpark(w, t);
    } else {
      t.mem.__riaMarks = n;
      ensureOverlay(w, 'ria_marks', (ww) => new EmberMarks(ww));
    }
  },
};

export const RIA_DASH: DashDef = {
  name: '불씨 질주',
  desc: '짧게 질주하며 지나간 자리에 불길을 남긴다.',
  icon: 'icon_ria_dash',
  color: '#ffb040',
  start(w, p) {
    trailReset(w, 'ria');
    w.particles.burst(p.x, p.y + 2, { count: 10, speed: [20, 70], angle: Math.atan2(-p.dashDY, -p.dashDX), spread: 1.1, life: [0.2, 0.4], colors: EMBER_COLORS, size: [1, 2], additive: true });
    w.sfx('fire', { vol: 0.3, pitch: 1.4 });
  },
  update(w, p) {
    if (!trailStep(w, 'ria', p.x, p.y, 9)) return;
    const d = p.stats.damage;
    HazardZone.add(w, new HazardZone(w, p.x, p.y + 3, 'fire', { radius: 8, life: RIA_TRAIL_LIFE, tick: 0.3, damage: d * RIA_TRAIL_DMG, statuses: [{ kind: 'burn', duration: 1.5, power: d * 0.2 }] }), 12);
  },
};

export const RIA_AFFINITY: AffinityDef = {
  name: '등불 무기',
  desc: '등불 무기를 들면 불씨가 세 번째 적중에 터지고 폭발·화상이 85% 세진다.',
  ids: RIA_LANTERN_WEAPONS,
};
