// 그림자 (shadow) artifacts: dodges, dashes, fear and a mimicking shadow twin.

import { defineArtifact } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { fx } from '../../engine/rng';
import { O, addHitStatus, cooldown, enemiesNear, familiarsOf, isAttack, isMelee, itemHit, roll, rollHit, stackMul, syncFamiliars } from './lib';
import { TwinShadow } from './familiars';
import { proc, miniBlast } from './lib';
import { Entity } from '../../game/entity';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';

/** 연기 장막 signature: a short-lived smoke puff that erases enemy bullets inside it. */
class SmokeScreen extends Entity {
  constructor(x: number, y: number, readonly radius: number) {
    super();
    this.x = x;
    this.y = y;
    this.layer = 2;
    this.tileCollide = false;
    this.flying = true;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.age > 1.1) {
      this.dead = true;
      return;
    }
    if (w.clearEnemyBullets(this.x, this.y, this.radius) > 0) proc(w, 'smoke_veil');
    if (fx.chance(dt * 26)) {
      const a = fx.angle();
      const rr = fx.range(0, this.radius * 0.8);
      w.particles.spawn({ x: this.x + Math.cos(a) * rr, y: this.y - 4 + Math.sin(a) * rr * 0.6, vy: -8, life: 0.6, colors: ['#8a7a9a90', '#5a4a6a80', '#3a2e4a70'], size: 3, sizeEnd: 6, shape: 'circle' });
    }
  }
}

/** 밤의 실내화 signature: violet afterimages left behind while dashing. */
class AfterImage extends Entity {
  /** purely visual: separate (negative) ids, not in the state hash */
  static override readonly cosmetic = true;
  private readonly frame: string;
  private readonly flip: boolean;
  constructor(w: World) {
    super();
    const p = w.player;
    this.x = p.x;
    this.y = p.y;
    this.frame = p.frameName();
    this.flip = p.spriteFlip;
    this.tileCollide = false;
    this.flying = true;
  }

  override get sortY(): number {
    return this.y - 1;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age > 0.22) this.dead = true;
  }

  override draw(r: Renderer): void {
    r.sprite(this.frame, this.x, this.y + 5, { flipX: this.flip, alpha: 0.42 * (1 - this.age / 0.22), tint: '#9a6aff', tintAmount: 0.7 });
  }
}

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;
const VIO = ['#1a0c38', '#3a1a70', '#6a3ad0', '#9a6aff', '#d0b8ff'];

// ------------------------------------------------------------------ 연기 베일
defineDrawnSprite('icon_smoke_veil', 16, 16, (p) => {
  const c = '#9a8cc0';
  p.circle(4.5, 7.5, 3.6, c);
  p.circle(9, 5.5, 4.4, c);
  p.circle(12.5, 8.5, 3.2, c);
  p.rect(3, 8, 11, 3.5, c);
  p.shadeSphere(8.5, 7, 7.5, 5.5, ['#4e4478', '#6e62a0', '#9a8cc0', '#cfc6ec'], { dither: false });
  p.px(7, 2, '#ffffff');
  p.px(8, 2, '#ffffff');
  p.px(2, 5, '#e8e0ff');
  p.line(4, 12, 5, 15, '#7a6ea8');
  p.line(8, 12, 9, 14, '#7a6ea8');
  p.line(12, 12, 13, 15, '#7a6ea8');
  p.px(6, 9, '#5a4e88');
  p.px(10, 9, '#5a4e88');
  p.px(6, 8, '#e8e0ff');
  p.px(10, 8, '#e8e0ff');
}, { outline: '#120c24' });

defineArtifact({
  id: 'smoke_veil',
  name: '연기 베일',
  desc: '10% 확률로 피해 회피. 대시하면 연막이 탄환을 지움',
  signature: '대시한 자리에 연막이 남아 적 탄환을 지운다',
  quote: '보이지 않으면 맞지도 않는다.',
  rarity: 'common',
  tags: ['shadow'],
  icon: 'icon_smoke_veil',
  look: { step: '#8a7a9a', aura: '#6a5a7a', trail: 'smoke' },
  pools: ['treasure', 'shop'],
  stats(m, power) {
    m.addStat('dodge', 0.1 * power);
  },
  onDash(w, power) {
    const p = w.player;
    w.spawn(new SmokeScreen(p.x, p.y, 18 + 4 * (power - 1)));
  },
});

// ------------------------------------------------------------------ 밤의 덧신
defineDrawnSprite('icon_night_slippers', 16, 16, (p) => {
  p.ellipse(10.5, 9.5, 5, 2.6, '#34449a');
  p.ellipse(9.5, 8.7, 3.2, 1.6, '#5a6ad0');
  p.line(6, 11.5, 15, 11.5, '#1a1c48');
  p.ellipse(12.5, 8.6, 1.6, 1.1, '#141838');
  p.ellipse(6, 12.5, 5.2, 2.7, '#4a5ac0');
  p.ellipse(5, 11.6, 3.4, 1.7, '#7a8ae8');
  p.line(1, 14.5, 11, 14.5, '#1a1c48');
  p.ellipse(8.4, 11.6, 1.8, 1.2, '#141838');
  p.circle(1.6, 11.4, 1.5, '#f4f0ff');
  p.circle(6.2, 8.6, 1.2, '#e0dcf8');
  p.circle(9, 3.5, 3, '#ffe880');
  p.circle(10.4, 2.6, 2.5, null);
  p.px(7, 3, '#fffbe0');
  p.px(13, 2, '#ffffff');
  p.px(3, 6, '#d8c8ff');
  p.px(14, 6, '#9aa8ff');
}, { outline: O });

defineArtifact({
  id: 'night_slippers',
  name: '밤의 덧신',
  desc: '대시 쿨다운 -25%, 이속 +8%. 대시 무적 연장',
  signature: '대시하면 보랏빛 잔상이 남고 무적 시간이 조금 길어진다',
  quote: '발소리조차 잠들었다.',
  rarity: 'common',
  tags: ['shadow'],
  icon: 'icon_night_slippers',
  look: { step: '#b08aff', mote: '#6a3ad0' },
  pools: ['treasure', 'shop', 'boss'],
  stats(m, power) {
    m.mulStat('dashCooldown', Math.pow(0.75, power));
    m.mulStat('moveSpeed', 1 + 0.08 * power);
  },
  onDash(w) {
    const p = w.player;
    p.invuln = Math.max(p.invuln, p.stats.dashTime + 0.22);
    w.vars.__slipT = w.time + p.stats.dashTime + 0.03;
  },
  onUpdate(w) {
    if ((w.vars.__slipT ?? 0) < w.time) return;
    if (!cooldown(w, 'slip_ghost', 0.05)) return;
    w.spawn(new AfterImage(w));
  },
});

// ------------------------------------------------------------------ 검은 초
defineDrawnSprite('icon_black_candle', 16, 16, (p) => {
  p.rect(5, 7, 6, 8, '#2a2030');
  p.shadeVertical(5, 7, 6, 8, ['#141018', '#2a2030', '#3e3448']);
  p.ellipse(8, 7, 3, 1.2, '#4a4058');
  p.px(5, 8, '#4a4058');
  p.px(5, 9, '#4a4058');
  p.px(10, 8, '#3e3448');
  p.px(10, 9, '#3e3448');
  p.px(10, 10, '#3e3448');
  p.rect(3, 14, 10, 2, '#5a4a3a');
  p.line(3, 14, 12, 14, '#8a7050');
  p.line(8, 4, 8, 6, '#1a1010');
  p.ellipse(8, 2.6, 1.8, 2.8, '#9a6aff');
  p.ellipse(8, 3.2, 0.9, 1.6, '#e0d0ff');
  p.px(8, 0, '#6a3ad0');
  p.px(11, 2, '#6a3ad0');
  p.px(4, 3, '#6a3ad0');
}, { outline: O });

defineArtifact({
  id: 'black_candle',
  name: '검은 초',
  desc: '공격력 +2.5, 행운 -1. 처치 시 가끔 검은 불꽃',
  signature: '처치 시 10% 확률로 검은 불꽃이 터져 주변 적을 겁먹게 한다',
  quote: '어둠을 태우는 불도 있다.',
  rarity: 'common',
  tags: ['shadow', 'flame'],
  icon: 'icon_black_candle',
  look: { shot: '#8a5ac8', trail: 'smoke', mote: '#3a2a4a' },
  pools: ['curse', 'shop', 'treasure'],
  stats(m, power) {
    m.addStat('damage', 2.5 * power);
    m.addStat('luck', -power);
  },
  onKill(w, e, power) {
    if (e.isMinion || !roll(w, 0.1, power, 0)) return;
    miniBlast(w, e.x, e.y - 3, 30, w.player.stats.damage * 0.8, '#8a5ac8', [{ kind: 'fear', duration: 2 }]);
  },
});

// ------------------------------------------------------------------ 등 뒤의 눈
defineDrawnSprite('icon_rear_eye', 16, 16, (p) => {
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI;
    p.px(8.5 + Math.cos(a) * 5, 6.5 - Math.sin(a) * 4.6, VIO[3]);
    p.px(8.5 + Math.cos(a) * 4, 6.5 - Math.sin(a) * 3.6, VIO[2]);
  }
  p.poly([0.5, 6, 6, 5, 3.5, 9.5], VIO[3]);
  p.px(2, 6, VIO[4]);
  p.ellipse(8, 11.5, 6.5, 3.6, '#f4f0ff');
  p.shadeSphere(8, 11.5, 6.5, 3.6, ['#b0a8c8', '#dcd6ec', '#f4f0ff', '#ffffff'], { dither: false });
  p.circle(5, 11.5, 2.4, VIO[2]);
  p.circle(4.6, 11.5, 1.2, '#140828');
  p.px(5, 10, '#ffffff');
  p.line(2, 8.5, 13, 8.5, '#3a2a50');
  p.line(3, 14.5, 12, 14.5, '#6a5a80');
}, { outline: O });

defineArtifact({
  id: 'rear_eye',
  name: '등 뒤의 눈',
  desc: '공격할 때 등 뒤로도 약한 공격이 나간다',
  quote: '등 뒤에도 눈이 있다.',
  rarity: 'common',
  tags: ['shadow'],
  icon: 'icon_rear_eye',
  look: { mote: '#c0a0ff', orbit: '#c0a0ff' },
  pools: ['treasure', 'shop'],
  onAttack(w, angle, power) {
    if (!cooldown(w, 'rear_eye', 0.12)) return;
    const p = w.player;
    const back = angle + Math.PI;
    if (isMelee(w)) {
      p.swing(w, { angle: back, damage: dmg(w) * 0.6, arc: 1.8, color: '#b08aff' });
    } else {
      for (const pr of p.fireProjectiles(w, back, { fromWeapon: false, count: power, damageMult: 0.7, spreadMult: 1.2 })) pr.color = '#c0a0ff';
    }
  },
});

// ------------------------------------------------------------------ 그림자 단검
defineDrawnSprite('icon_shade_dagger', 16, 16, (p) => {
  p.poly([6, 9, 13, 1, 15, 0, 14, 3, 8, 11], VIO[2]);
  p.poly([6, 9, 13, 1, 15, 0, 9.5, 8.5], VIO[3]);
  p.line(7, 9, 14, 1, VIO[4]);
  p.line(3, 8, 9, 13, '#a8a0b8');
  p.line(4, 8, 9, 12, '#d8d0e8');
  p.line(1, 15, 6, 10, '#3a2a40');
  p.line(2, 15, 6, 11, '#5a4a60');
  p.circle(1.5, 14.5, 1.3, VIO[3]);
  p.px(13, 6, VIO[4]);
  p.px(11, 9, VIO[3]);
}, { outline: '#0c0418' });

defineArtifact({
  id: 'shade_dagger',
  name: '그림자 단검',
  desc: '대시로 적을 통과하면 큰 피해를 주고 출혈시킨다',
  quote: '그림자는 등 뒤에서 찌른다.',
  rarity: 'rare',
  tags: ['shadow', 'blood'],
  icon: 'icon_shade_dagger',
  look: { step: '#c0a0ff', hit: '#c0a0ff' },
  pools: ['treasure', 'challenge'],
  onDash(w) {
    w.vars.__dagT = w.time + w.player.stats.dashTime + 0.06;
    w.vars.__dagId = (w.vars.__dagId ?? 0) + 1;
  },
  onUpdate(w, _dt, power) {
    if ((w.vars.__dagT ?? 0) < w.time) return;
    const p = w.player;
    const tag = `__dag${w.vars.__dagId}`;
    for (const e of enemiesNear(w, p.x, p.y, p.r + 7)) {
      if (e.mem[tag]) continue;
      e.mem[tag] = 1;
      itemHit(w, e, dmg(w) * 2.5 * stackMul(power), { knockback: 120, statuses: [{ kind: 'bleed', duration: 3, power: dmg(w) * 0.3 }] });
      proc(w, 'shade_dagger');
      w.sfx('swing_heavy', { vol: 0.5, pitch: 1.3 });
      w.particles.burst(e.x, e.y - 5, { count: 14, speed: [60, 160], angle: Math.atan2(p.dashDY, p.dashDX), spread: 0.8, life: [0.15, 0.35], colors: ['#ffffff', VIO[4], VIO[3], VIO[1]], shape: 'spark', size: [1, 2] });
    }
  },
});

// ------------------------------------------------------------------ 텅 빈 가면
defineDrawnSprite('icon_hollow_mask', 16, 16, (p) => {
  p.ellipse(8, 8, 6, 7, '#ece4d8');
  p.shadeSphere(8, 7, 6.5, 7, ramp('#e8e0d4', 4), { dither: false });
  p.ellipse(5.5, 7, 1.7, 2.2, '#0c0610');
  p.ellipse(10.5, 7, 1.7, 2.2, '#0c0610');
  p.px(5, 8, VIO[3]);
  p.px(10, 8, VIO[3]);
  p.line(6, 12, 10, 12, '#5a4a50');
  p.px(7, 13, '#5a4a50');
  p.px(9, 13, '#5a4a50');
  p.line(9, 1, 8, 3, '#7a6a68');
  p.line(8, 3, 9, 5, '#7a6a68');
  p.px(3, 4, '#ffffff');
  p.px(4, 3, '#ffffff');
}, { outline: O });

defineArtifact({
  id: 'hollow_mask',
  name: '텅 빈 가면',
  desc: '10% 확률로 공포를 건다. 겁먹은 적에게 피해 +25%',
  quote: '가면 뒤엔 아무도 없다. 그래서 무섭다.',
  rarity: 'rare',
  tags: ['shadow'],
  icon: 'icon_hollow_mask',
  look: { shot: '#9a7aff', aura: '#4a3a6a', hit: '#d0c0ff' },
  pools: ['treasure', 'curse', 'challenge'],
  modifyHit(w, t, hit, power) {
    if (t.hasStatus('fear')) hit.damage *= 1.25;
    else if (isAttack(hit) && rollHit(w, hit, 0.1, power)) addHitStatus(w, t, hit, { kind: 'fear', duration: 2.5 });
  },
});

// ------------------------------------------------------------------ 쌍둥이 그림자
defineDrawnSprite('icon_twin_shadow', 16, 16, (p) => {
  const fig = (ox: number, body: string, hood: string, eye: string) => {
    p.poly([ox + 1, 15, ox + 2.5, 8, ox + 7.5, 8, ox + 9, 15], body);
    p.ellipse(ox + 5, 5.5, 3.6, 3.4, hood);
    p.px(ox + 4, 6, eye);
    p.px(ox + 6, 6, eye);
  };
  fig(6, VIO[2], VIO[3], VIO[4]);
  fig(0, '#2f5866', '#3a6c78', '#1a1420');
  p.ellipse(5, 6, 2.2, 1.6, '#f2d6c0');
  p.px(4, 6, '#1a1420');
  p.px(6, 6, '#1a1420');
  p.rect(2, 8, 6, 1, '#d8503a');
  p.px(12, 2, VIO[4]);
}, { outline: O });

defineArtifact({
  id: 'twin_shadow',
  name: '쌍둥이 그림자',
  desc: '그림자 분신이 따라다니며 내 공격을 흉내 낸다',
  quote: '그림자가 먼저 움직였다.',
  rarity: 'epic',
  tags: ['shadow'],
  icon: 'icon_twin_shadow',
  look: { aura: '#6a3ad0', step: '#6a3ad0' },
  pools: ['treasure', 'secret', 'curse'],
  onUpdate(w, _dt, power) {
    syncFamiliars(w, 'twin_shadow', Math.min(2, power), (w2) => new TwinShadow(w2), power);
  },
  onRemove(w) {
    syncFamiliars(w, 'twin_shadow', 0, (w2) => new TwinShadow(w2));
  },
  onAttack(w, angle) {
    if (!cooldown(w, 'twin_shadow', 0.08)) return;
    const melee = isMelee(w);
    for (const t of familiarsOf<TwinShadow>(w, 'twin_shadow')) {
      t.mimic(w, angle, melee);
      if (fx.chance(0.3)) w.sfx('whoosh', { vol: 0.2, pitch: 1.6 });
    }
  },
});
