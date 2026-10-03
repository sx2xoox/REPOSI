// 불꽃 (flame) artifacts: burns, embers, explosions and the lantern release.

import { defineArtifact } from '../../game/defs';
import { defineDrawnSprite } from '../../engine/sprites';
import { ramp } from '../../engine/painter';
import { RingFx } from '../../game/effects';
import { defaultRelease } from '../../game/player';
import { attackEmber } from '../../game/ember';
import { Enemy } from '../../game/enemy';
import { fx } from '../../engine/rng';
import {
  O, HazardZone, addHitStatus, enemiesNear, isAttack, hitWeight, isPrimary, itemHit, miniBlast, roll, rollHit, shout, stackMul,
} from './lib';
import { proc } from './lib';

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;

// ------------------------------------------------------------------ 부싯깃 주머니
defineDrawnSprite('icon_tinder_pouch', 16, 16, (p) => {
  p.ellipse(7, 10.5, 5.5, 4.5, '#9a6038');
  p.poly([3.5, 7.5, 10.5, 7.5, 9.5, 4, 4.5, 4], '#9a6038');
  p.shadeSphere(7, 10, 6, 5.5, ramp('#a86a3e', 4));
  p.rect(4, 3, 6, 2, '#c08850');
  p.px(4, 3, '#e8b880');
  p.px(6, 3, '#e8b880');
  p.px(8, 3, '#e8b880');
  p.line(3, 6, 10, 6, '#4a2410');
  p.line(10, 6, 12, 8, '#4a2410');
  p.px(12, 9, '#d8b070');
  // stitched flame emblem
  p.px(7, 9, '#ffb040');
  p.px(6, 10, '#ff8030');
  p.px(7, 10, '#ffe080');
  p.px(8, 10, '#ff8030');
  p.px(7, 11, '#ff8030');
  // flint sparks
  p.px(12, 3, '#fff4b0');
  p.px(13, 2, '#ffb040');
  p.px(14, 4, '#ff7a20');
  p.px(13, 0, '#ffd060');
}, { outline: O });

defineArtifact({
  id: 'tinder_pouch',
  name: '부싯깃 주머니',
  desc: '공격이 15% 확률로 적을 불태운다',
  quote: '작은 불씨 하나면 충분하다.',
  rarity: 'common',
  tags: ['flame'],
  icon: 'icon_tinder_pouch',
  look: { shot: '#ff9a3a', trail: 'ember', hit: '#ffb040' },
  pools: ['treasure', 'shop'],
  modifyHit(w, t, hit, power) {
    if (isAttack(hit) && rollHit(w, hit, 0.15, power)) addHitStatus(w, t, hit, { kind: 'burn', duration: 3, power: dmg(w) * 0.4 });
  },
});

// ------------------------------------------------------------------ 꺼지지 않는 숯
defineDrawnSprite('icon_smoldering_coal', 16, 16, (p) => {
  p.poly([1.5, 11, 3, 6.5, 7, 4, 11.5, 4.5, 14.5, 8.5, 13, 13, 7, 14.5, 3, 13.5], '#3a2c2e');
  p.shadeSphere(8, 9.5, 7, 5.5, ['#141012', '#241c1e', '#3c3234', '#5e5050']);
  p.line(4, 10, 7, 9, '#ff6a20');
  p.line(7, 9, 9, 11, '#ff6a20');
  p.line(9, 11, 12, 9, '#ff6a20');
  p.line(8, 6, 7, 9, '#ff6a20');
  p.px(7, 9, '#ffe080');
  p.px(9, 11, '#ffd040');
  p.px(5, 10, '#ffb040');
  p.px(11, 9, '#ffb040');
  p.px(10, 1, '#ffb040');
  p.px(11, 0, '#ff7020');
  p.px(6, 1, '#ff9030');
}, { outline: O });

defineArtifact({
  id: 'smoldering_coal',
  name: '꺼지지 않는 숯',
  desc: '불타는 적에게 주는 피해 +30%',
  quote: '식은 줄 알았지?',
  rarity: 'common',
  tags: ['flame'],
  icon: 'icon_smoldering_coal',
  look: { shot: '#ff6a20', trail: 'smoke', hit: '#ff6a20' },
  pools: ['treasure', 'shop', 'boss'],
  modifyHit(_w, t, hit, power) {
    if (t.hasStatus('burn')) {
      hit.damage *= 1 + 0.3 * power;
      proc(_w, 'smoldering_coal', true);
    }
  },
});

// ------------------------------------------------------------------ 작은 풀무
defineDrawnSprite('icon_bellows', 16, 16, (p) => {
  p.poly([2, 5.5, 10, 7.5, 10, 9, 2, 11], '#6a3a20');
  p.line(4, 6.5, 4, 10, '#3a1c0c');
  p.line(6, 7, 6, 9.6, '#3a1c0c');
  p.line(8, 7.5, 8, 9.2, '#3a1c0c');
  p.poly([0, 3.5, 11, 6.5, 11, 7.8, 0, 5.6], '#c89048');
  p.line(0, 3, 11, 6, '#f0c878');
  p.poly([0, 10.5, 11, 8.6, 11, 9.8, 0, 12.6], '#a06830');
  p.line(0, 12.5, 11, 9.8, '#5a3418');
  p.rect(10, 7, 3, 3, '#d8b050');
  p.rect(13, 7.5, 2, 2, '#a08030');
  p.px(10, 7, '#fff0a0');
  p.px(11, 7, '#fff0a0');
  p.px(15, 5, '#ffd060');
  p.px(14, 3, '#ff9030');
  p.px(15, 11, '#ffb040');
}, { outline: O });

defineArtifact({
  id: 'bellows',
  name: '작은 풀무',
  desc: '직접 공격의 등불 기본 충전량 +40%',
  detail: '광선·보스 대상의 충전 감쇠 적용. 추가 파편·지속 피해·해방은 충전 제외.',
  quote: '숨을 불어넣으면 불은 대답한다.',
  rarity: 'common',
  tags: ['flame', 'clockwork'],
  icon: 'icon_bellows',
  look: { aura: '#ffb040', mote: '#ffd060' },
  pools: ['treasure', 'shop', 'shrine'],
  onHit(w, t, hit, power) {
    if (!isPrimary(hit)) return;
    w.player.addEmber(0.4 * power * (hit.emberCharge ?? attackEmber(w.player.stats.damage, hit.damage, t instanceof Enemy && t.isBoss, hit.kind === 'laser')));
    proc(w, 'bellows', true);
  },
});

// ------------------------------------------------------------------ 잿불 장화
defineDrawnSprite('icon_ashwalk_boots', 16, 16, (p) => {
  p.poly([0, 14, 1.5, 8, 2.5, 11, 3.5, 6.5, 5, 14], '#ff7a20');
  p.poly([1, 14, 2, 10.5, 3, 12, 3.8, 9.5, 4.5, 14], '#ffe080');
  p.rect(5, 2, 5, 9, '#4a3a40');
  p.poly([5, 10, 10, 10, 14, 11.2, 15, 14, 5, 14], '#4a3a40');
  p.shadeSphere(8, 8, 6, 7, ['#22181c', '#3a2c32', '#54444a', '#6e5c60']);
  p.rect(4, 2, 7, 2, '#7a5a50');
  p.line(4, 2, 10, 2, '#a07a6a');
  p.line(6, 6, 9, 6, '#1c1216');
  p.line(6, 8, 9, 8, '#1c1216');
  p.rect(5, 14, 11, 1, '#ff7a20');
  p.line(6, 14, 14, 14, '#ffd060');
  p.px(8, 12, '#ff9030');
  p.px(12, 12, '#ff9030');
  p.px(13, 13, '#ffb040');
}, { outline: O });

defineArtifact({
  id: 'ashwalk_boots',
  name: '잿불 장화',
  desc: '대시한 자리에 불길이 남아 적을 태운다',
  quote: '걸음마다 잿더미.',
  rarity: 'rare',
  tags: ['flame', 'shadow'],
  icon: 'icon_ashwalk_boots',
  look: { step: '#ff7a20', aura: '#ff7a20' },
  pools: ['treasure', 'challenge'],
  onDash(w) {
    const p = w.player;
    w.vars.__ashT = w.time + p.stats.dashTime + 0.04;
    proc(w, 'ashwalk_boots');
    w.vars.__ashX = p.x;
    w.vars.__ashY = p.y;
    HazardZone.add(w, new HazardZone(w, p.x, p.y + 2, 'fire', { radius: 9, life: 2.4, tick: 0.3, damage: dmg(w) * 0.35, statuses: [{ kind: 'burn', duration: 2, power: dmg(w) * 0.3 }] }), 28);
  },
  onUpdate(w, _dt, power) {
    if ((w.vars.__ashT ?? 0) < w.time) return;
    const p = w.player;
    if (Math.hypot(p.x - w.vars.__ashX, p.y - w.vars.__ashY) < 8) return;
    w.vars.__ashX = p.x;
    w.vars.__ashY = p.y;
    HazardZone.add(w, new HazardZone(w, p.x, p.y + 2, 'fire', {
      radius: 9, life: 2.2 + 0.6 * (power - 1), tick: 0.3, damage: dmg(w) * 0.35 * stackMul(power),
      statuses: [{ kind: 'burn', duration: 2, power: dmg(w) * 0.3 }],
    }), 28);
  },
});

// ------------------------------------------------------------------ 가마의 심장
defineDrawnSprite('icon_kiln_core', 16, 16, (p) => {
  p.ellipse(8, 9, 7, 6.5, '#a85a3a');
  p.rect(1, 9, 14, 6, '#a85a3a');
  p.shadeSphere(8, 9, 7.5, 7, ramp('#b06040', 4));
  p.line(1, 12, 14, 12, '#6a3020');
  p.line(3, 7, 13, 7, '#7a3a24');
  p.px(4, 13, '#6a3020');
  p.px(10, 13, '#6a3020');
  p.px(6, 11, '#6a3020');
  p.px(12, 11, '#6a3020');
  p.px(5, 8, '#6a3020');
  p.px(10, 8, '#6a3020');
  p.rect(7, 1, 3, 3, '#8a4a30');
  p.px(7, 1, '#c07a50');
  p.ellipse(8, 10.5, 3.6, 3.2, '#2a0804');
  p.ellipse(8, 11, 2.7, 2.3, '#ff6a20');
  p.ellipse(8, 11.3, 1.6, 1.4, '#ffe080');
  p.px(8, 11, '#ffffff');
}, { outline: O });

defineArtifact({
  id: 'kiln_core',
  name: '가마의 심장',
  desc: '직접 공격 적중 시 작은 폭발이 일어난다',
  detail: '재사용 0.06초 (광선 0.15초). 추가 파편으로는 발동하지 않는다.',
  quote: '그 안의 불은 천 년째 꺼지지 않았다.',
  rarity: 'epic',
  tags: ['flame'],
  icon: 'icon_kiln_core',
  look: { shot: '#ff7a20', grow: 1, hit: '#ffd060' },
  pools: ['treasure', 'boss', 'challenge'],
  onHit(w, t, hit, power) {
    if (!isPrimary(hit)) return;
    const k = '__kilnT';
    if ((w.vars[k] ?? -1) > w.time) return;
    w.vars[k] = w.time + (hit.kind === 'laser' ? 0.15 : 0.06);
    miniBlast(w, t.x, t.y - 3, 20 + 3 * (power - 1), dmg(w) * 0.5 * stackMul(power), '#ff8a30');
  },
});

// ------------------------------------------------------------------ 재점화 깃털
defineDrawnSprite('icon_rekindle_plume', 16, 16, (p) => {
  p.poly([2, 14, 4.5, 9, 8.5, 4.5, 13, 1, 14.5, 2.5, 12, 7, 8, 11, 4, 13.5], '#e8481c');
  p.poly([4, 12.5, 6.5, 8.5, 10.5, 4.5, 13.5, 2, 11.5, 6, 7.5, 10], '#ff9a30');
  p.poly([7, 9, 10.5, 5, 13, 2.5, 10.5, 6.5], '#ffe080');
  p.line(2, 14, 13, 2, '#fff4c0');
  p.line(0, 16, 2, 14, '#7a3a18');
  p.px(5, 13, null);
  p.px(9, 10, null);
  p.px(12, 7, null);
  p.px(4, 9, null);
  p.px(15, 0, '#ffd060');
  p.px(11, 0, '#ff9030');
}, { outline: O });

defineArtifact({
  id: 'rekindle_plume',
  name: '재점화 깃털',
  desc: '쓰러지면 불길 속에서 체력 2칸으로 되살아난다 (1회)',
  quote: '재가 된 것은 다시 타오를 수 있다.',
  rarity: 'epic',
  tags: ['flame', 'blood'],
  icon: 'icon_rekindle_plume',
  look: { mote: '#ffe080', aura: '#ff9a30' },
  pools: ['secret', 'shrine', 'boss'],
  unique: true,
  onHurt(w) {
    const p = w.player;
    if (p.alive) return;
    proc(w, 'rekindle_plume');
    if (p.maxRed > 0) p.red = Math.min(p.maxRed, 4);
    else p.addSoul(4);
    p.invuln = 2.2;
    w.renderer.screenFlash('#ffb040', 0.6);
    w.shake(0.7);
    w.sfx('fire', { vol: 1 });
    w.sfx('item_get_rare', { vol: 0.7 });
    w.banner('재점화!', '깃털이 타오르며 다시 일어선다', { icon: 'icon_rekindle_plume', color: '#ffb040', small: true });
    for (let i = 0; i < 3; i++) w.spawn(new RingFx(p.x, p.y - 6, 40 + i * 25, 0.4 + i * 0.12, i ? '#ff7020' : '#fff0a0', 4 - i));
    w.particles.burst(p.x, p.y - 6, { count: 70, speed: [60, 260], life: [0.4, 0.9], colors: ['#ffffff', '#ffe080', '#ff9a30', '#c04010'], size: [1, 3], additive: true, light: 7 });
    w.clearEnemyBullets(p.x, p.y);
    for (const e of enemiesNear(w, p.x, p.y, 100)) itemHit(w, e, dmg(w) * 4, { knockback: 300, statuses: [{ kind: 'burn', duration: 4, power: dmg(w) * 0.6 }] });
    w.items.take('rekindle_plume');
  },
});

// ------------------------------------------------------------------ 불씨 저장고
defineDrawnSprite('icon_ember_reservoir', 16, 16, (p) => {
  p.rect(4, 4, 8, 10, '#4a5a70');
  p.ellipse(8, 13.6, 4, 1.4, '#4a5a70');
  p.rect(5, 6, 6, 7, '#c04a18');
  p.ellipse(8, 9.5, 2.6, 3, '#ff8a30');
  p.ellipse(8, 10, 1.4, 1.6, '#ffe080');
  p.px(6, 7, '#ffd060');
  p.px(10, 11, '#ffd060');
  p.px(9, 7, '#fff0a0');
  p.px(6, 12, '#ff9a30');
  p.line(4, 5, 4, 13, '#a8c8e0');
  p.px(5, 5, '#e0f0ff');
  p.line(11, 5, 11, 13, '#2a3448');
  p.rect(5, 2, 6, 2, '#b88050');
  p.line(5, 2, 10, 2, '#e0b080');
  p.rect(4, 3.5, 8, 1, '#7a5030');
}, { outline: O });

defineArtifact({
  id: 'ember_reservoir',
  name: '불씨 저장고',
  desc: '등불 해방 후 6초간 공격력 +40%, 공격 속도 +25%',
  quote: '모아둔 불씨는 한꺼번에 쏟아진다.',
  rarity: 'rare',
  tags: ['flame'],
  icon: 'icon_ember_reservoir',
  look: { mote: '#ff8a30', hit: '#ffe080' },
  pools: ['treasure', 'shrine'],
  onRelease(w, power) {
    const k = 1 + 0.4 * power;
    w.items.addBuff({
      key: 'ember_reservoir', time: 6, label: '불씨 폭주', icon: 'icon_ember_reservoir',
      hooks: {
        stats(m) {
          m.mulStat('damage', k);
          m.mulStat('fireRate', 1.25);
        },
        onUpdate(w2, dt) {
          if (fx.chance(dt * 25)) {
            const p = w2.player;
            w2.particles.spawn({ x: p.x + fx.range(-6, 6), y: p.y - fx.range(0, 12), vy: -fx.range(20, 40), life: 0.45, colors: ['#fff0a0', '#ff9a30', '#c04010'], size: fx.range(1, 2), additive: true, light: 3 });
          }
        },
      },
    });
    shout(w, '불씨 폭주!', '#ffb040');
  },
});

// ------------------------------------------------------------------ 쌍심지
defineDrawnSprite('icon_twin_wick', 16, 16, (p) => {
  p.rect(4, 8, 8, 7, '#f0e4c8');
  p.ellipse(8, 8, 4, 1.4, '#fff8e8');
  p.shadeVertical(4, 9, 8, 6, ['#b8a080', '#d8c8a8', '#f0e4c8']);
  p.px(4, 9, '#fff8e8');
  p.px(4, 10, '#fff8e8');
  p.px(11, 9, '#fff8e8');
  p.rect(3, 14, 10, 2, '#8a6a4a');
  p.line(3, 14, 12, 14, '#b89070');
  p.line(6, 5, 6, 7, '#3a2a1a');
  p.line(10, 5, 10, 7, '#3a2a1a');
  p.ellipse(6, 3.5, 1.6, 2.6, '#ff8a30');
  p.ellipse(10, 3.5, 1.6, 2.6, '#ff8a30');
  p.ellipse(6, 4, 0.9, 1.6, '#ffe080');
  p.ellipse(10, 4, 0.9, 1.6, '#ffe080');
  p.px(6, 1, '#ffb040');
  p.px(10, 1, '#ffb040');
}, { outline: O });

defineArtifact({
  id: 'twin_wick',
  name: '쌍심지',
  desc: '해방 0.55초 뒤 추가 발동 (최대 2회)',
  detail: '1개 보유 시 1회, 2개 이상이면 2회. 추가 해방은 해방 발동 유물을 다시 발동시키지 않는다.',
  quote: '눈에 쌍심지를 켜고 덤벼라.',
  rarity: 'epic',
  tags: ['flame'],
  icon: 'icon_twin_wick',
  look: { mote: '#ffd060', orbit: '#ffd060' },
  pools: ['treasure', 'shrine', 'secret'],
  onRelease(w, power) {
    w.vars.__twinWickT = w.time + 0.55;
    w.vars.__twinWickN = Math.min(2, power);
  },
  onUpdate(w) {
    const t = w.vars.__twinWickT ?? 0;
    if (t <= 0 || w.time < t) return;
    const p = w.player;
    if (!p.alive) return;
    w.vars.__twinWickN = (w.vars.__twinWickN ?? 1) - 1;
    w.vars.__twinWickT = w.vars.__twinWickN > 0 ? w.time + 0.55 : 0;
    shout(w, '한 번 더!', '#ffd080');
    proc(w, 'twin_wick');
    if (p.character.release) p.character.release(w, p);
    else defaultRelease(w, p);
  },
});
