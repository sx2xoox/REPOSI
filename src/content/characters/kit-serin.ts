// 세린's kit — the beagle tracker, built around scent and marking.
//   passive 사냥 감각: every hit leaves a scent mark (4s): marked enemies take
//     +12% damage and are revealed (paw print + glow, even when burrowed); the
//     first hit on an untouched enemy is a guaranteed critical (선제 사격)
//   dash 도약: a long vault; the first hit within 1.2s afterwards is a critical
//   affinity 활·쇠뇌: +1 pierce, +15% shot speed, +10% range

import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import type { AffinityDef, DashDef, PassiveDef } from '../../game/defs';
import { Enemy } from '../../game/enemy';
import { defineDrawnSprite } from '../../engine/sprites';
import { glowSprite } from '../weapons/common';
import { isAttack, proc } from '../items/lib';
import { EnemyOverlay, O, ensureOverlay } from './kit';

export const SERIN_MARK_TIME = 4;
export const SERIN_MARK_BONUS = 0.12;
/** window (s) after a vault in which the first hit is a critical */
export const SERIN_VAULT_WINDOW = 1.2;

// ------------------------------------------------------------------ icons
defineDrawnSprite('icon_serin_passive', 16, 16, (p) => {
  // a beagle nose catching a scent: dark muzzle, green scent waves, a paw mark
  p.ellipse(5, 10, 3.5, 3, '#3a2c30');
  p.ellipse(4.5, 9.5, 2, 1.5, '#5a444a');
  p.px(3, 9, '#ffffff');
  p.line(5, 12, 5, 13, '#1e161c');
  for (let i = 0; i < 3; i++) {
    const x = 9 + i * 2.5;
    p.px(x, 7 - (i % 2), '#90cc5c');
    p.px(x, 5 - (i % 2), '#46943c');
    p.px(x, 9 - (i % 2), '#46943c');
  }
  p.ellipse(12, 13, 1.8, 1.4, '#ffe08a');
  p.px(10, 11, '#ffe08a');
  p.px(12, 10, '#ffe08a');
  p.px(14, 11, '#ffe08a');
}, { outline: O });

defineDrawnSprite('icon_serin_dash', 16, 16, (p) => {
  // a vault arc ending in a bright crit star
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = 1 + t * 10;
    const y = 13 - Math.sin(t * Math.PI) * 9;
    p.px(x, y, t > 0.8 ? '#d8f0b0' : '#90cc5c');
  }
  p.poly([12.5, 3, 13.5, 6.5, 16, 7.5, 13.5, 8.5, 12.5, 12, 11.5, 8.5, 9, 7.5, 11.5, 6.5], '#ffe08a');
  p.px(12, 7, '#ffffff');
  p.px(2, 14, '#46943c');
}, { outline: O });

// ------------------------------------------------------------------ scent marks
export function isScented(w: World, e: Enemy): boolean {
  return (e.mem.__scentUntil ?? -1) > w.time;
}

/** Paw print above scented enemies + a faint glow that reveals them (cosmetic). */
class ScentMarks extends EnemyOverlay {
  drawMark(r: Renderer, w: World, e: Enemy): void {
    if (!isScented(w, e)) return;
    const left = (e.mem.__scentUntil ?? 0) - w.time;
    const a = Math.min(1, left / 0.6);
    const top = e.y - e.z - e.r * 2 - 9;
    r.sprite('fx_paw_mark', e.x, top + Math.sin(this.age * 5) * 1.2, { alpha: a, rot: Math.sin(this.age * 2.5) * 0.25 });
    // revealed: an outline ring at the feet shows even a burrowed enemy's position
    r.ring(e.x, e.y + 1, e.r + 2, '#ffe08a', 1, 0.35 * a * (e.hidden ? 1.6 : 1));
  }

  override lightMark(w: World, e: Enemy): void {
    if (!isScented(w, e)) return;
    w.lights.add(e.x, e.y - e.z - 4, 22, '#ffe08a', { intensity: 0.35 });
  }

  override draw(r: Renderer, w: World): void {
    // hidden enemies are skipped by the base class; the scent still shows them
    for (const e of w.enemies) if (e.alive && (!e.hidden || isScented(w, e))) this.drawMark(r, w, e);
  }
}

export const SERIN_PASSIVE: PassiveDef = {
  name: '사냥 감각',
  desc: '적중한 적을 냄새로 표식해 드러내고 피해 +12%. 멀쩡한 적의 첫 타는 반드시 치명타.',
  icon: 'icon_serin_passive',
  look: { orbit: '#ffe08a', hit: '#ffe08a', step: '#a8e070' },
  modifyHit(w, t, hit) {
    if (!isAttack(hit) || !(t instanceof Enemy)) return;
    const p = w.player;
    // 선제 사격: the first hit on an untouched enemy is a critical
    if (!hit.crit && t.hp >= t.maxHp && !t.mem.__serinOpened) {
      t.mem.__serinOpened = 1;
      hit.crit = true;
      hit.damage *= p.stats.critMult;
      w.sfx('hit_crit', { vol: 0.4, pitch: 1.2, x: t.x });
      proc(w, 'passive:serin', true);
    } else if (!hit.crit && (w.vars.__serinVaultUntil ?? -1) > w.time) {
      // the first hit after a vault
      w.vars.__serinVaultUntil = -1;
      hit.crit = true;
      hit.damage *= p.stats.critMult;
      w.sfx('hit_crit', { vol: 0.5, pitch: 1.3, x: t.x });
      proc(w, 'passive:serin');
    }
    if (isScented(w, t)) hit.damage *= 1 + SERIN_MARK_BONUS;
  },
  onHit(w, t, hit) {
    if (!isAttack(hit) || !(t instanceof Enemy) || !t.alive) return;
    const fresh = !isScented(w, t);
    t.mem.__scentUntil = w.time + SERIN_MARK_TIME;
    ensureOverlay(w, 'serin_marks', (ww) => new ScentMarks(ww));
    if (fresh) {
      w.sfx('scent', { vol: 0.45, x: t.x });
      w.particles.burst(t.x, t.y - t.z - t.r - 4, { count: 5, speed: [15, 45], life: [0.25, 0.5], colors: ['#ffffff', '#ffe08a', '#a8e070'], size: [1, 2], vz: [10, 40], gravity: -20 });
      proc(w, 'passive:serin', true);
    }
  },
  onDash(w) {
    w.vars.__serinVaultUntil = w.time + SERIN_VAULT_WINDOW;
  },
  draw(w, r) {
    if ((w.vars.__serinVaultUntil ?? -1) < w.time) return;
    const p = w.player;
    r.sprite(glowSprite(7, '#ffe08a'), p.x + 6, p.y - 17 - p.z, { alpha: 0.6 + 0.4 * Math.sin(w.time * 20), additive: true });
  },
};

export const SERIN_DASH: DashDef = {
  name: '도약',
  desc: '멀리 뛰어넘는다. 착지 후 첫 적중은 치명타.',
  icon: 'icon_serin_dash',
  color: '#d8f0b0',
  sfx: 'vault',
  iframes: 0.1,
  update(w, p) {
    // hop: the keeper rises over the middle of the vault
    const k = 1 - Math.max(0, p.dashT) / Math.max(0.05, p.stats.dashTime);
    p.z = Math.sin(k * Math.PI) * 9;
  },
  end(w, p) {
    p.z = 0;
    w.particles.burst(p.x, p.y + 4, { count: 8, speed: [15, 50], life: [0.2, 0.4], colors: ['#d0c8c0', '#a8e070', '#908070'], size: [1, 2], ground: true });
  },
};

export const SERIN_AFFINITY: AffinityDef = {
  name: '활·쇠뇌',
  desc: '활과 쇠뇌를 들면 관통 +1, 탄속 +15%, 사거리 +10%.',
  tags: ['bow'],
  stats(m) {
    m.addStat('pierce', 1);
    m.mulStat('shotSpeed', 1.15);
    m.mulStat('range', 1.1);
  },
};
