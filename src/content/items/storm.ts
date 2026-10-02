// 번개 (storm) artifacts: chain lightning, sky bolts, dash sparks and speed.

import { defineArtifact } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { fx } from '../../engine/rng';
import { O, ZapFx, chainLightning, isPrimary, roll, rollHit, skyBolt, stackMul, syncFamiliars } from './lib';
import { BallLightning } from './familiars';
import { proc } from './lib';

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;
const BOLT = '#ffe95a';

// ------------------------------------------------------------------ 구리 코일
defineDrawnSprite('icon_copper_coil', 16, 16, (p) => {
  p.rect(6, 2, 4, 12, '#3a3a48');
  for (let y = 3; y <= 12; y += 2) {
    p.line(4, y, 11, y + 1, '#d08040');
    p.px(4, y, '#ffc080');
    p.px(5, y, '#f0a060');
    p.px(11, y + 1, '#8a4a20');
  }
  p.rect(5, 1, 6, 1, '#7a7a88');
  p.rect(5, 14, 6, 1, '#5a5a68');
  p.line(5, 1, 10, 1, '#a8a8b8');
  p.line(12, 2, 14, 0, BOLT);
  p.line(13, 3, 15, 4, BOLT);
  p.px(13, 1, '#ffffff');
  p.px(1, 4, BOLT);
  p.px(2, 2, '#ffffff');
}, { outline: O });

defineArtifact({
  id: 'copper_coil',
  name: '구리 코일',
  desc: '공격이 10% 확률로 근처 적에게 번개를 튕긴다',
  quote: '감긴 만큼 튀어 오른다.',
  rarity: 'common',
  tags: ['storm'],
  icon: 'icon_copper_coil',
  look: { shot: '#ffe95a', trail: 'static', orbit: '#fff6a0' },
  pools: ['treasure', 'shop', 'challenge'],
  onHit(w, t, hit, power) {
    if (!isPrimary(hit) || !rollHit(w, hit, 0.1, power)) return;
    chainLightning(w, t.x, t.y - t.z - 4, { jumps: 2, damage: dmg(w) * 0.7, exclude: new Set([t.id]) });
  },
});

// ------------------------------------------------------------------ 정전기 망토
defineDrawnSprite('icon_static_cape', 16, 16, (p) => {
  p.poly([4, 1, 12, 1, 14.5, 13.5, 10, 12, 8, 14.5, 6, 12, 1.5, 13.5], '#3a3a7a');
  p.shadeSphere(7, 5, 9, 10, ['#1a1a48', '#2a2a60', '#3a3a7a', '#50509a']);
  p.rect(4, 0, 8, 2, '#6a6ab8');
  p.line(4, 0, 11, 0, '#9a9ae0');
  p.line(6, 3, 4, 12, '#22224a');
  p.line(10, 3, 12, 12, '#22224a');
  p.line(2, 9, 5, 6, BOLT);
  p.line(5, 6, 6, 9, BOLT);
  p.line(6, 9, 10, 6, BOLT);
  p.line(10, 6, 11, 9, BOLT);
  p.line(11, 9, 14, 7, BOLT);
  p.px(6, 9, '#ffffff');
  p.px(10, 6, '#ffffff');
  p.px(15, 3, BOLT);
  p.px(0, 6, BOLT);
}, { outline: O });

defineArtifact({
  id: 'static_cape',
  name: '정전기 망토',
  desc: '대시가 빨라진다. 대시하면 주변 적에게 번개가 친다',
  quote: '옷깃만 스쳐도 찌릿하다.',
  rarity: 'common',
  tags: ['storm', 'shadow'],
  icon: 'icon_static_cape',
  look: { step: '#ffe95a', aura: '#fff6a0' },
  pools: ['treasure', 'shop', 'challenge'],
  stats(m, power) {
    m.mulStat('dashSpeed', 1 + 0.15 * power);
    m.mulStat('dashCooldown', Math.pow(0.92, power));
  },
  onDash(w, power) {
    const p = w.player;
    w.particles.burst(p.x, p.y - 6, { count: 10, speed: [40, 120], life: [0.1, 0.25], colors: ['#ffffff', BOLT], shape: 'spark', size: [1, 2], additive: true });
    chainLightning(w, p.x, p.y - 6, { jumps: 1 + power, damage: dmg(w) * 0.7, range: 75 });
  },
});

// ------------------------------------------------------------------ 바람 접부채
defineDrawnSprite('icon_paper_fan', 16, 16, (p) => {
  const cx = 8;
  const cy = 14;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (d > 12.5 || d < 2.5 || a > -0.35 || a < -Math.PI + 0.35) continue;
      const rib = Math.abs(((a + Math.PI) / (Math.PI / 7)) % 1 - 0.5) > 0.42;
      let c = d > 11.2 ? '#c0a070' : rib ? '#c8b898' : '#f4ecd8';
      if (!rib && d > 6 && d < 9 && Math.sin(a * 9 + d) > 0.55) c = '#5aa0d8';
      if (!rib && d >= 9 && d < 10 && Math.sin(a * 9 + d) > 0.75) c = '#9ad0f0';
      p.px(x, y, c);
    }
  }
  p.rect(7, 13, 2, 3, '#7a4a2a');
  p.px(7, 13, '#d8a070');
}, { outline: O });

defineArtifact({
  id: 'paper_fan',
  name: '바람 접부채',
  desc: '탄환 +2. 공격력 -20%, 공격 속도 -10%',
  quote: '바람을 가르면 세 갈래가 된다.',
  rarity: 'rare',
  tags: ['storm'],
  icon: 'icon_paper_fan',
  look: { trail: 'wind', shot: '#f0e8d0' },
  pools: ['treasure', 'shop', 'boss', 'challenge'],
  stats(m, power) {
    m.addStat('shots', 1 + power);
    m.mulStat('damage', 0.8);
    m.mulStat('fireRate', 0.9);
    m.mulStat('spread', 1.15);
  },
});

// ------------------------------------------------------------------ 천둥 북
defineDrawnSprite('icon_thunder_drum', 16, 16, (p) => {
  p.rect(2, 6, 12, 8, '#b03a2a');
  p.shadeSphere(6, 9, 9, 7, ramp('#b83c2c', 4), { dither: false });
  p.ellipse(8, 14, 6, 1.6, '#7a2018');
  for (let i = 0; i < 6; i++) {
    const x = 2.5 + i * 2.2;
    p.line(x, 7, x + 1.1, 13, '#e8d0a0');
  }
  p.ellipse(8, 6, 6.2, 2.2, '#8a6a4a');
  p.ellipse(8, 5.8, 5.4, 1.6, '#f4e8c8');
  p.px(5, 5, '#ffffff');
  p.poly([8.5, 7.5, 6.5, 10.5, 8, 10.5, 7, 13, 10, 9.5, 8.5, 9.5, 9.5, 7.5], BOLT);
  p.line(10, 0, 13, 4, '#8a5a3a');
  p.circle(9.5, 0.5, 1.3, '#e8d0a0');
  p.px(14, 2, BOLT);
  p.px(15, 5, '#ffffff');
}, { outline: O });

defineArtifact({
  id: 'thunder_drum',
  name: '천둥 북',
  desc: '적이 있는 방에 들어서면 모든 적에게 벼락이 떨어진다',
  quote: '북이 울리면 하늘이 대답한다.',
  rarity: 'rare',
  tags: ['storm'],
  icon: 'icon_thunder_drum',
  look: { mote: '#ffe95a', aura: '#7ad8ff' },
  pools: ['treasure', 'boss', 'challenge'],
  onRoomEnter(w) {
    if (!w.node.cleared) w.vars.__drumT = w.time + 0.75;
  },
  onUpdate(w, _dt, power) {
    const t = w.vars.__drumT ?? 0;
    if (t <= 0 || w.time < t) return;
    w.vars.__drumT = 0;
    const es = w.enemies.filter((e) => e.alive && !e.hidden && e.vulnerable);
    if (!es.length) return;
    w.sfx('lightning', { vol: 0.9, pitch: 0.7 });
    w.sfx('slam', { vol: 0.5 });
    w.shake(0.5);
    w.renderer.screenFlash('#fff8c0', 0.35);
    proc(w, 'thunder_drum');
    for (const e of es) skyBolt(w, e, dmg(w) * 1.5 * stackMul(power), 0.8);
  },
});

// ------------------------------------------------------------------ 구전 정령
defineDrawnSprite('icon_ball_lightning', 16, 16, (p) => {
  p.line(8, 8, 1, 3, BOLT);
  p.line(8, 8, 15, 5, BOLT);
  p.line(8, 8, 3, 15, BOLT);
  p.line(8, 8, 14, 14, BOLT);
  p.px(2, 6, BOLT);
  p.px(13, 1, BOLT);
  p.circle(8, 8, 4.6, BOLT);
  p.shadeSphere(8, 8, 4.6, 4.6, ['#c08a10', '#ffd030', '#ffef80', '#ffffff'], { dither: false });
  p.px(7, 7, '#ffffff');
  p.px(6, 7, '#ffffff');
  p.px(6, 9, '#3a2a04');
  p.px(10, 9, '#3a2a04');
}, { outline: '#2a1a04' });

defineArtifact({
  id: 'ball_lightning',
  name: '구전 정령',
  desc: '번개 정령이 따라다니며 가까운 적을 감전시킨다',
  quote: '말은 안 통하지만, 마음은 통한다.',
  rarity: 'rare',
  tags: ['storm'],
  icon: 'icon_ball_lightning',
  look: { mote: '#7ad8ff', hit: '#c8f0ff' },
  pools: ['treasure', 'shop', 'secret'],
  onUpdate(w, _dt, power) {
    syncFamiliars(w, 'ball_lightning', Math.min(3, power), (w2) => new BallLightning(w2), power);
  },
  onRemove(w) {
    syncFamiliars(w, 'ball_lightning', 0, (w2) => new BallLightning(w2));
  },
});

// ------------------------------------------------------------------ 폭풍 부름 지팡이
defineDrawnSprite('icon_stormcaller_rod', 16, 16, (p) => {
  p.line(1, 15, 9, 7, '#8a5a3a');
  p.line(2, 15, 10, 7, '#5a3418');
  p.line(1, 14, 8, 7, '#b88050');
  p.rect(3, 12, 2, 2, '#d8b050');
  p.line(9, 7, 10, 3, '#a8a8c0');
  p.line(9, 7, 13, 6, '#a8a8c0');
  p.px(10, 2, '#e0e0f0');
  p.poly([12, 1, 14.5, 3.5, 12, 6, 9.5, 3.5], BOLT);
  p.poly([12, 1, 12, 6, 9.5, 3.5], '#fff6b0');
  p.px(12, 3, '#ffffff');
  p.line(14, 0, 15, 1, '#ffffff');
  p.line(6, 2, 8, 0, BOLT);
  p.px(15, 7, BOLT);
}, { outline: O });

defineArtifact({
  id: 'stormcaller_rod',
  name: '폭풍 부름 지팡이',
  desc: '치명타 확률 +6%. 치명타가 연쇄 번개를 일으킨다',
  quote: '번개는 가장 높은 곳에 떨어진다.',
  rarity: 'epic',
  tags: ['storm', 'star'],
  icon: 'icon_stormcaller_rod',
  look: { shot: '#7ad8ff', shape: 'spark', trail: 'static' },
  pools: ['treasure', 'boss', 'challenge'],
  stats(m, power) {
    m.addStat('critChance', 0.06 * power);
  },
  onHit(w, t, hit, power) {
    if (!hit.crit || !isPrimary(hit)) return;
    chainLightning(w, t.x, t.y - t.z - 4, { jumps: 3 + power, damage: dmg(w) * 0.75, range: 100, exclude: new Set([t.id]) });
  },
});

// ------------------------------------------------------------------ 폭풍의 심장 (legendary)
defineDrawnSprite('icon_tempest_heart', 16, 16, (p) => {
  p.circle(4.8, 5.4, 3.7, '#5a6ad8');
  p.circle(11.2, 5.4, 3.7, '#5a6ad8');
  p.poly([1.1, 6.4, 14.9, 6.4, 8, 15], '#5a6ad8');
  p.shadeSphere(8, 7.5, 7.5, 7.5, ['#232a62', '#3a48a8', '#5a6ad8', '#8a9af0', '#c8d0ff'], { dither: false });
  p.px(8, 3, null);
  p.px(8, 2, null);
  p.poly([9.5, 3.5, 5.5, 9, 8, 9, 6.5, 13.5, 11.5, 7.2, 9, 7.2, 10.5, 3.5], BOLT);
  p.line(9, 4.5, 7, 7.5, '#ffffff');
  p.px(3, 3, '#e0e8ff');
  p.px(4, 2, '#e0e8ff');
  p.px(0, 1, BOLT);
  p.px(15, 1, BOLT);
  p.px(15, 12, '#ffffff');
  p.px(1, 12, BOLT);
}, { outline: '#0c0c28' });

defineArtifact({
  id: 'tempest_heart',
  name: '폭풍의 심장',
  desc: '모든 공격이 번개를 튕긴다. 공격 속도 +20%',
  quote: '이 심장은 천둥으로 뛴다.',
  rarity: 'legendary',
  tags: ['storm'],
  icon: 'icon_tempest_heart',
  look: { shot: '#bfe8ff', orbit: '#ffe95a', aura: '#ffe95a', grow: 1 },
  pools: ['treasure', 'boss', 'secret'],
  stats(m) {
    m.mulStat('fireRate', 1.2);
  },
  onHit(w, t, hit, power) {
    if (!isPrimary(hit)) return;
    if ((w.vars.__tempestT ?? -1) > w.time) return;
    w.vars.__tempestT = w.time + 0.12;
    chainLightning(w, t.x, t.y - t.z - 4, { jumps: 2, damage: dmg(w) * 0.45 * stackMul(power), range: 80, exclude: new Set([t.id]), quiet: fx.chance(0.6) });
  },
  onUpdate(w, dt) {
    if (!fx.chance(dt * 5)) return;
    const p = w.player;
    const a = fx.angle();
    const r0 = 5;
    const r1 = fx.range(10, 15);
    w.spawn(new ZapFx(p.x + Math.cos(a) * r0, p.y - 7 + Math.sin(a) * r0, p.x + Math.cos(a) * r1, p.y - 7 + Math.sin(a) * r1, { dur: 0.1, width: 1 }));
  },
});
