// Shrine room "등불 제단": a great stone lantern with two offering bowls.
//  - 동전 15개: "등불의 온기" — fully restores red hearts and grants a soul heart.
//  - 심장 1개: "등불의 맹약" — a permanent blessing (random stat buff, never expires).
// Each bowl accepts one offering.

import { registerRoomHandler } from '../../game/roomkinds';
import type { StatKey } from '../../game/stats';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { defineDrawnSprite } from '../../engine/sprites';
import { fx } from '../../engine/rng';
import { dist } from '../../engine/math';
import { RingFx } from '../../game/effects';
import { Prop } from '../props/prop';
import { roundRug, withDecals } from './decor';
import { HintLabel } from './label';
import { heartCostKind, heartCostText, payHeartCost } from '../../game/heart-cost';

defineDrawnSprite('shrine_lantern', 24, 40, (p) => {
  const S = ['#1e2440', '#2e3860', '#46548a', '#6a7cb8', '#9aaae0'];
  // base steps
  p.rect(1, 34, 22, 6, S[1]);
  p.rect(1, 34, 22, 1, S[3]);
  p.rect(4, 30, 16, 5, S[2]);
  p.rect(4, 30, 16, 1, S[4]);
  // pillar
  p.rect(9, 20, 6, 10, S[2]);
  p.rect(9, 20, 1, 10, S[3]);
  p.rect(14, 20, 1, 10, S[1]);
  // fire box
  p.rect(5, 10, 14, 11, S[2]);
  p.rect(5, 10, 14, 1, S[4]);
  p.rect(5, 20, 14, 1, S[0]);
  p.rect(8, 12, 8, 7, '#0a0e22');
  // roof
  p.poly([0, 10, 12, 2, 24, 10], S[3]);
  p.rect(1, 9, 22, 2, S[2]);
  p.rect(0, 10, 24, 1, S[1]);
  p.rect(11, 0, 2, 3, S[4]);
  // engraved lantern motif on the pillar
  p.px(11, 23, '#a8c0ff');
  p.px(12, 23, '#a8c0ff');
  p.rect(11, 24, 2, 3, '#7a90d8');
}, { outline: '#0a0c1c', origin: [12, 39] });

defineDrawnSprite('shrine_bowl', 16, 7, (p) => {
  p.ellipse(8, 3, 8, 3.5, '#4a5070');
  p.ellipse(8, 2.5, 6, 2, '#1a1e30');
  p.rect(5, 5, 6, 2, '#3a4058');
  p.rect(1, 2, 14, 1, '#8a94c0');
}, { outline: '#0a0c1c', origin: [8, 3] });

defineDrawnSprite('shrine_flame_0', 6, 9, (p) => {
  p.ellipse(3, 6, 3, 3, '#3a6aff');
  p.poly([0.5, 6, 3, 0, 5.5, 6], '#3a6aff');
  p.ellipse(3, 6.5, 1.8, 2, '#a8d0ff');
  p.px(3, 6, '#ffffff');
}, { origin: [3, 8] });
defineDrawnSprite('shrine_flame_1', 6, 9, (p) => {
  p.ellipse(3, 6, 3, 3, '#3a6aff');
  p.poly([0.5, 6, 2, 1, 5.5, 6], '#3a6aff');
  p.ellipse(3, 6.5, 1.8, 2, '#a8d0ff');
  p.px(3, 6, '#ffffff');
}, { origin: [3, 8] });

export class LanternShrine extends Prop {
  flare = 0;
  spent = 0;
  constructor(x: number, y: number) {
    super(x, y, 1);
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.flare = Math.max(0, this.flare - dt);
    if (fx.chance(dt * 4)) {
      w.particles.spawn({ x: this.x + fx.range(-3, 3), y: this.y - 26, vx: fx.range(-4, 4), vy: -fx.range(8, 20), life: fx.range(0.8, 1.5), colors: ['#e0ecff', '#7aa8ff', '#2a40a0'], size: 1, additive: true });
    }
  }

  override draw(r: Renderer): void {
    r.shadow(this.x, this.y - 1, 26, 6, 0.35);
    r.sprite('shrine_lantern', this.x, this.y);
    const f = Math.floor(this.age * 6) % 2;
    const s = 1 + this.flare * 0.5;
    r.sprite(`shrine_flame_${f}`, this.x, this.y - 22, { sx: s, sy: s });
  }

  override light(w: World): void {
    const k = 1 + Math.sin(this.age * 2.3) * 0.06 + this.flare * 0.6;
    w.lights.add(this.x, this.y - 25, 92 * k, '#7aa0ff', { intensity: 0.9 });
    w.lights.glow(this.x, this.y - 25, 10 + this.flare * 12, '#8ab0ff', 0.4 + this.flare * 0.4);
  }
}

interface Blessing { stat: StatKey; amount: number; desc: string }
const BLESSINGS: Blessing[] = [
  { stat: 'damage', amount: 1.5, desc: '공격력이 이번 도전 동안 증가한다.' },
  { stat: 'fireRate', amount: 0.4, desc: '공격 속도가 이번 도전 동안 증가한다.' },
  { stat: 'moveSpeed', amount: 12, desc: '이동 속도가 이번 도전 동안 증가한다.' },
  { stat: 'range', amount: 45, desc: '사거리가 이번 도전 동안 증가한다.' },
  { stat: 'luck', amount: 2, desc: '행운이 이번 도전 동안 증가한다.' },
  { stat: 'critChance', amount: 0.08, desc: '치명타 확률이 이번 도전 동안 증가한다.' },
];

export class OfferingBowl extends Prop {
  mem: Record<string, number> = {};
  kind: 'coin' | 'heart';
  shrine: LanternShrine;
  get used(): boolean { return !!this.mem.used; }
  coolT = 0;
  constructor(x: number, y: number, kind: 'coin' | 'heart', shrine: LanternShrine) {
    super(x, y, 0);
    this.kind = kind;
    this.shrine = shrine;
  }

  get cost(): number {
    return this.kind === 'coin' ? 15 : 1;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    this.coolT -= dt;
    if (this.coolT > 0) return;
    const p = w.player;
    if (this.used) return;
    if (!p.alive || dist(p.x, p.y, this.x, this.y) > 10) return;
    this.coolT = 1.2;
    if (this.kind === 'coin') this.offerCoins(w);
    else this.offerHeart(w);
  }

  private offerCoins(w: World): void {
    const p = w.player;
    if (p.coins < this.cost) {
      w.sfx('no_money');
      w.floatText(this.x, this.y - 16, '동전 부족', '#ff8080');
      return;
    }
    p.coins -= this.cost;
    w.run.stats.coinsSpent += this.cost;
    p.heal(p.maxRed);
    p.addSoul(2);
    this.consume(w);
    w.sfx('heal');
    w.banner('등불의 온기', '체력이 모두 회복되고 영혼 심장을 얻었다.', { color: '#9ac0ff', small: true });
  }

  private offerHeart(w: World): void {
    const costText = heartCostText(w.player, 1);
    if (!payHeartCost(w, 1)) {
      w.sfx('ui_error');
      w.floatText(this.x, this.y - 16, '바칠 심장이 없다', '#ff8080');
      return;
    }
    w.sfx('player_hurt', { vol: 0.5, pitch: 0.8 });
    const b = w.rng.pick(BLESSINGS);
    const key = `shrine:${w.run.floor}:${w.run.stage}:${w.node.id}`;
    w.items.addBuff({
      key,
      hooks: { stats: (m) => { m.addStat(b.stat, b.amount); } },
      time: Infinity,
      label: '등불의 맹약',
    });
    this.consume(w);
    w.sfx('power_up');
    w.banner('등불의 맹약', `${costText} · ${b.desc}`, { color: '#b8ccff' });
  }

  private consume(w: World): void {
    // One shared offering per bowl. Its benefit goes to the keeper who pays.
    this.mem.used = 1;
    this.shrine.flare = 1;
    this.shrine.spent++;
    w.spawn(new RingFx(this.x, this.y, 26, 0.45, '#a8c0ff', 2));
    w.spawn(new RingFx(this.shrine.x, this.shrine.y - 24, 40, 0.6, '#ffffff', 2));
    w.particles.burst(this.x, this.y - 4, { count: 20, speed: [20, 70], life: [0.4, 0.9], colors: ['#ffffff', '#a8c0ff', '#4a6aff'], size: [1, 2], additive: true });
  }

  override draw(r: Renderer, w: World): void {
    r.sprite('shrine_bowl', this.x, this.y);
    if (this.used) return;
    const bob = Math.sin(this.age * 3) * 1.5;
    const icon = this.kind === 'coin' ? 'hud_coin' : 'pk_heart';
    r.sprite(icon, this.x, this.y - 11 + bob);
    const afford = this.kind === 'coin' ? w.player.coins >= this.cost : !!heartCostKind(w.player, 1);
    r.pixelText(`${this.cost}`, this.x, this.y + 5, afford ? '#ffffff' : '#ff7070', { align: 'center', outline: '#140c1c' });
    if (this.kind === 'heart' && dist(w.local.x, w.local.y, this.x, this.y) < 72) {
      r.pixelText(heartCostText(w.local, 1), this.x, this.y + 18, '#ffb0b8', { align: 'center', outline: '#140c1c' });
    }
  }

  override light(w: World): void {
    if (!this.used) w.lights.add(this.x, this.y - 6, 22, this.kind === 'coin' ? '#ffd060' : '#ff5060', { intensity: 0.5 });
  }
}

registerRoomHandler('shrine', {
  populate(w, room) {
    const m = room.markers.find((k) => k.ch === '@');
    const cx = m ? m.x : room.centerX;
    const cy = m ? m.y : room.centerY;
    withDecals(room, (p) => roundRug(p, cx, cy + 10, 52, 26, ['#0e1430', '#1a2450', '#2a3a78', '#4a5aa8'], '#a8c0ff'));
    const shrine = w.spawn(new LanternShrine(cx, cy - 2));
    const left = w.spawn(new OfferingBowl(cx - 34, cy + 22, 'coin', shrine));
    const right = w.spawn(new OfferingBowl(cx + 34, cy + 22, 'heart', shrine));
    w.spawn(new HintLabel(left.x, left.y - 24, '온기: 체력 회복', () => !left.used, '#ffe8a0', 40));
    w.spawn(new HintLabel(right.x, right.y - 24, '맹약: 이번 도전 능력치 증가', () => !right.used, '#ffb0b8', 65));
  },
  spawnEnemies() {
    return false;
  },
});
