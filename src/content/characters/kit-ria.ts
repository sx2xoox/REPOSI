// 리아's kit — the lantern keeper, built around 등불 해방 and embers.
//   passive 불씨 심지: the ember gauge fills 40% faster; every hit leaves an ember
//     mark on the enemy and the 4th mark ignites (small burst + burn, +ember)
//   dash 불씨 질주: a short rush that leaves a burning trail
//   release 등불 개화 (releases.ts), a larger lantern light (CharacterDef.lightRadius)

import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { DashDef, PassiveDef } from '../../game/defs';
import { Enemy } from '../../game/enemy';
import { RingFx } from '../../game/effects';
import { defineDrawnSprite } from '../../engine/sprites';
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

/** The 4th ember mark ignites: a small burst that burns nearby enemies and refunds ember. */
export function emberSpark(w: World, e: Enemy): void {
  const d = w.player.stats.damage;
  const y = e.y - e.z - 3;
  w.sfx('ember_burst', { vol: 0.7, x: e.x });
  w.spawn(new RingFx(e.x, y, RIA_SPARK_RADIUS + 2, 0.28, '#ffb040', 2));
  w.particles.burst(e.x, y, { count: 16, speed: [40, 130], life: [0.2, 0.45], colors: EMBER_COLORS, size: [1, 2], additive: true, light: 5, lightColor: '#ff9a30' });
  w.lights.glow(e.x, y, 44, '#ff9a30', 0.6);
  for (const t of enemiesNear(w, e.x, e.y, RIA_SPARK_RADIUS)) {
    itemHit(w, t, d * RIA_SPARK_DMG, { from: { x: e.x, y: e.y + 0.01 }, knockback: 60, kind: 'explosion', procs: ['ria_spark'], statuses: [{ kind: 'burn', duration: 2, power: d * RIA_SPARK_BURN }] });
  }
  w.player.addEmber(RIA_SPARK_EMBER);
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
    p.addEmber(RIA_EMBER_BONUS * Math.min(6, 1.2 + (hit.damage / Math.max(1, p.stats.damage)) * 1.3));
    if (!(t instanceof Enemy) || !t.alive) return;
    const stale = w.time - (t.mem.__riaAt ?? -99) > RIA_MARK_TIME;
    const n = (stale ? 0 : t.mem.__riaMarks ?? 0) + hitWeight(hit);
    t.mem.__riaAt = w.time;
    if (n >= RIA_SPARK_HITS) {
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
