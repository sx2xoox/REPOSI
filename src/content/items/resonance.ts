// 등불 공명 (lantern resonance): every DISTINCT artifact carrying a tag adds one
// to that tag's count; tiers wake up at thresholds. Eight tags:
//   flame 불꽃 · frost 서리 · venom 독 · storm 번개 · blood 피 · star 별빛 · shadow 그림자 · clockwork 태엽
// A tier announces itself with a small banner the frame after it wakes up.

import { defineSet, type ItemHooks, type SetDef } from '../../game/defs';
import { defineDrawnSprite, definePixelSprite } from '../../engine/sprites';
import { RingFx } from '../../game/effects';
import { Projectile } from '../../game/projectile';
import { Actives } from '../../game/defs';
import { fx } from '../../engine/rng';
import {
  O, HazardZone, Starfall, addHitStatus, chainLightning, cooldown, enemiesNear, inflict, isAttack, isPrimary,
  itemHit, roll, rollHit, shout, spawnShards, tickTimeStop, timeStop,
} from './lib';

// ------------------------------------------------------------------ 8x8 icons
defineDrawnSprite('res_flame', 8, 8, (p) => {
  p.poly([1, 7, 7, 7, 6, 3, 4, 0, 2, 3], '#ff8a30');
  p.poly([2.5, 7, 5.5, 7, 5, 4, 4, 2, 3, 4], '#ffe080');
}, { outline: O });
definePixelSprite('res_frost', { b: '#6ac8f0', w: '#d8f6ff', c: '#ffffff' }, [
  '...b....',
  '.b.w.b..',
  '..bwb...',
  'bwwcwwb.',
  '..bwb...',
  '.b.w.b..',
  '...b....',
], { outline: '#0c2038' });
definePixelSprite('res_venom', { g: '#5ad030', l: '#a8ff70', w: '#f0ffd0', d: '#2a7a18' }, [
  '...l....',
  '...ll...',
  '..lggg..',
  '.lwgggd.',
  '.lggggd.',
  '.gggddd.',
  '..dddd..',
], { outline: '#0c2008' });
definePixelSprite('res_storm', { y: '#ffe95a', w: '#ffffff', o: '#d09a20' }, [
  '....wy..',
  '...wy...',
  '..wy....',
  '.wyyyo..',
  '...yo...',
  '..yo....',
  '.yo.....',
  '.o......',
], { outline: '#2a1a04' });
definePixelSprite('res_blood', { r: '#e02838', l: '#ff6a78', w: '#ffd0d8', d: '#8a1020' }, [
  '...l....',
  '...rr...',
  '..lrrr..',
  '.lwrrrd.',
  '.lrrrrd.',
  '.rrrddd.',
  '..dddd..',
], { outline: '#200408' });
definePixelSprite('res_star', { s: '#c8b8ff', w: '#ffffff', d: '#7a60d8' }, [
  '...s....',
  '...w....',
  '..sws...',
  'swwwwwd.',
  '..sws...',
  '...d....',
  '...d....',
], { outline: '#140c38' });
definePixelSprite('res_shadow', { p: '#9a6aff', l: '#d0b8ff', d: '#5a3aa8' }, [
  '..lpp...',
  '.lp.....',
  'lp......',
  'pp......',
  'dp......',
  '.dp.....',
  '..ddp...',
], { outline: '#100620' });
definePixelSprite('res_clockwork', { g: '#d8b070', l: '#fff0b8', d: '#8a6028', k: '#3a2410' }, [
  '..l.g...',
  '.lgggg..',
  'lggdggd.',
  '.gdkdg..',
  'gggdggd.',
  '.gdddd..',
  '..d.d...',
], { outline: '#1a0e04' });

// ------------------------------------------------------------------ tier helper
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'];

function resonance(tag: string, name: string, color: string, icon: string, tiers: [number, string, ItemHooks][]): SetDef {
  return defineSet({
    tag, name, color, icon,
    tiers: tiers.map(([count, desc, hooks], i) => ({
      count,
      desc,
      hooks: {
        ...hooks,
        onAcquire(w, power) {
          hooks.onAcquire?.(w, power);
          if (w.time > 0.5) w.vars[`__resAnn_${tag}`] = Math.max(w.vars[`__resAnn_${tag}`] ?? 0, i + 1);
        },
        onUpdate(w, dt, power) {
          hooks.onUpdate?.(w, dt, power);
          const ann = w.vars[`__resAnn_${tag}`] ?? 0;
          if (ann === i + 1) {
            w.vars[`__resAnn_${tag}`] = 0;
            const p = w.player;
            w.banner(`등불 공명 · ${name} ${ROMAN[i] ?? i + 1}`, desc, { icon, color, small: true });
            w.sfx('power_up', { vol: 0.7 });
            w.spawn(new RingFx(p.x, p.y - 6, 40, 0.5, color, 3));
            w.particles.burst(p.x, p.y - 6, { count: 24, speed: [40, 130], life: [0.3, 0.7], colors: ['#ffffff', color, color], size: [1, 2], additive: true, light: 5, lightColor: color.slice(0, 7) });
          }
        },
      },
    })),
  });
}

const dmg = (w: { player: { stats: { damage: number } } }) => w.player.stats.damage;

// ------------------------------------------------------------------ 불꽃 flame
resonance('flame', '불꽃', '#ff9a40', 'res_flame', [
  [2, '공격이 20% 확률로 적을 불태운다', {
    modifyHit(w, t, hit) {
      if (isAttack(hit) && rollHit(w, hit, 0.2, 1)) addHitStatus(w, t, hit, { kind: 'burn', duration: 3, power: dmg(w) * 0.4 });
    },
  }],
  [4, '불타는 적이 죽으면 폭발한다', {
    onKill(w, e) {
      if (e.hasStatus('burn')) w.explode(e.x, e.y, 26, dmg(w) * 1.5, { hurtsPlayer: false, noTiles: true, color: '#ff7020' });
    },
  }],
  [6, '화상이 근처의 적에게 옮겨 붙는다', {
    onUpdate(w) {
      if (!cooldown(w, 'flameSpread', 0.7)) return;
      let spread = 0;
      for (const e of w.enemies) {
        const b = e.statuses.get('burn');
        if (!b || !e.alive || spread >= 4) continue;
        const near = enemiesNear(w, e.x, e.y, 42).find((o) => o !== e && !o.hasStatus('burn'));
        if (!near) continue;
        inflict(w, near, { kind: 'burn', duration: 3, power: Math.max(b.power, dmg(w) * 0.4) });
        w.particles.burst((e.x + near.x) / 2, (e.y + near.y) / 2 - 4, { count: 6, speed: [10, 40], life: [0.2, 0.4], colors: ['#fff0a0', '#ff9a30', '#c04010'], size: [1, 2], additive: true });
        spread++;
      }
    },
  }],
]);

// ------------------------------------------------------------------ 서리 frost
resonance('frost', '서리', '#8fe0ff', 'res_frost', [
  [2, '공격이 15% 확률로 적을 둔화시킨다', {
    modifyHit(w, t, hit) {
      if (isAttack(hit) && rollHit(w, hit, 0.15, 1)) addHitStatus(w, t, hit, { kind: 'slow', duration: 2.5, power: 0.4 });
    },
  }],
  [3, '둔화된 적을 공격하면 12% 확률로 얼린다', {
    modifyHit(w, t, hit) {
      if (isAttack(hit) && t.hasStatus('slow') && !t.hasStatus('freeze') && rollHit(w, hit, 0.12, 1)) {
        addHitStatus(w, t, hit, { kind: 'freeze', duration: 1.3 });
        w.sfx('freeze', { vol: 0.4 });
      }
    },
  }],
  [5, '얼어붙은 적이 죽으면 얼음 파편이 튄다', {
    onKill(w, e) {
      if (!e.hasStatus('freeze')) return;
      w.sfx('freeze', { vol: 0.6, pitch: 1.3 });
      w.particles.burst(e.x, e.y - 4, { count: 18, speed: [40, 140], life: [0.3, 0.7], colors: ['#ffffff', '#c8f4ff', '#6ac8f0'], size: [1, 3], shape: 'square', gravity: 250, vz: [30, 90], vrot: 10 });
      spawnShards(w, e.x, e.y - 3, { count: 6, damage: dmg(w) * 0.7, sprite: 'proj_ice_shard', color: '#9fe8ff', speed: 210, range: 120, statuses: [{ kind: 'slow', duration: 2, power: 0.4 }] });
    },
  }],
]);

// ------------------------------------------------------------------ 독 venom
resonance('venom', '독', '#8aff5a', 'res_venom', [
  [2, '공격이 20% 확률로 적을 중독시킨다', {
    modifyHit(w, t, hit) {
      if (isAttack(hit) && rollHit(w, hit, 0.2, 1)) addHitStatus(w, t, hit, { kind: 'poison', duration: 4, power: dmg(w) * 0.2 });
    },
  }],
  [3, '중독된 적이 죽으면 독 웅덩이를 남긴다', {
    onKill(w, e) {
      if (!e.hasStatus('poison')) return;
      HazardZone.add(w, new HazardZone(w, e.x, e.y + 2, 'poison', { radius: 15, life: 4, tick: 1, damage: 0, statuses: [{ kind: 'poison', duration: 3, power: dmg(w) * 0.15 }] }), 8);
      w.sfx('splat', { vol: 0.5 });
    },
  }],
  [5, '적이 독 중첩 1당 받는 피해 +5%', {
    modifyHit(_w, t, hit) {
      const s = t.statuses.get('poison');
      if (s) hit.damage *= 1 + 0.05 * s.stacks;
    },
  }],
]);

// ------------------------------------------------------------------ 번개 storm
resonance('storm', '번개', '#ffe95a', 'res_storm', [
  [2, '공격이 8% 확률로 근처 적에게 번개를 튕긴다', {
    onHit(w, t, hit) {
      if (!isPrimary(hit) || !rollHit(w, hit, 0.08, 1)) return;
      chainLightning(w, t.x, t.y - t.z - 4, { jumps: 2, damage: dmg(w) * 0.6, exclude: new Set([t.id]) });
    },
  }],
  [3, '대시하면 주변 적 3명에게 번개가 친다', {
    onDash(w) {
      const p = w.player;
      chainLightning(w, p.x, p.y - 6, { jumps: 3, damage: dmg(w) * 0.8, range: 100 });
    },
  }],
  [5, '번개 +2회, 적 마비 (보스는 짧게 마비·2초 재적용 대기)', {
    stats(m) {
      m.flag('stormMastery');
    },
  }],
]);

// ------------------------------------------------------------------ 피 blood
resonance('blood', '피', '#e83048', 'res_blood', [
  [2, '적 처치 시 6% 확률로 체력 반 칸 회복', {
    stats(m) {
      m.addStat('lifesteal', 0.06);
    },
  }],
  [3, '잃은 체력 반 칸당 공격력 +4%', {
    modifyHit(w, _t, hit) {
      const p = w.player;
      const missing = Math.max(0, p.maxRed - p.red);
      if (missing > 0) hit.damage *= 1 + Math.min(0.48, missing * 0.04);
    },
  }],
  [5, '층마다 한 번, 치명상을 반 칸으로 버틴다', {
    onHurt(w) {
      const p = w.player;
      if (p.alive || w.vars.__bloodOathFloor === w.run.floor) return;
      w.vars.__bloodOathFloor = w.run.floor;
      if (p.maxRed > 0) p.red = 1;
      else p.soul = 1;
      p.invuln = Math.max(p.invuln, 1.6);
      w.renderer.screenFlash('#ff2040', 0.5);
      w.sfx('heal', { pitch: 0.6 });
      shout(w, '피의 맹세!', '#ff5060');
      w.spawn(new RingFx(p.x, p.y - 6, 60, 0.5, '#ff3048', 4));
      for (const e of enemiesNear(w, p.x, p.y, 60)) itemHit(w, e, dmg(w) * 2, { knockback: 260, statuses: [{ kind: 'bleed', duration: 4, power: dmg(w) * 0.3 }] });
    },
  }],
]);

// ------------------------------------------------------------------ 별빛 star
resonance('star', '별빛', '#b8a8ff', 'res_star', [
  [2, '행운 +1, 치명타 확률 +5%', {
    stats(m) {
      m.addStat('luck', 1);
      m.addStat('critChance', 0.05);
    },
  }],
  [4, '치명타가 별 조각 2개를 흩뿌린다', {
    onHit(w, t, hit) {
      if (!hit.crit || !isPrimary(hit)) return;
      spawnShards(w, t.x, t.y - t.z - 4, { count: 2, damage: dmg(w) * 0.5, sprite: 'proj_star_shard', color: '#d8c8ff', speed: 170, range: 150, homing: 6, spectral: true });
    },
  }],
  [6, '적이 있는 방에 들어서면 별똥별이 쏟아진다', {
    onRoomEnter(w) {
      if (!w.node.cleared) w.vars.__starfallT = w.time + 0.9;
    },
    onUpdate(w) {
      const t = w.vars.__starfallT ?? 0;
      if (t <= 0 || w.time < t) return;
      w.vars.__starfallT = 0;
      const targets = [...w.enemies].filter((e) => e.alive && !e.hidden);
      for (let i = 0; i < 4; i++) {
        const e = targets.length ? targets[i % targets.length] : null;
        const x = e ? e.x + w.rng.range(-6, 6) : w.room.centerX + w.rng.range(-80, 80);
        const y = e ? e.y + w.rng.range(-4, 4) : w.room.centerY + w.rng.range(-40, 40);
        const s = new Starfall(x, y, { damage: dmg(w) * 2.5, fall: 0.7 + i * 0.18 });
        w.spawn(s);
      }
    },
  }],
]);

// ------------------------------------------------------------------ 그림자 shadow
resonance('shadow', '그림자', '#9a6aff', 'res_shadow', [
  [2, '대시 쿨다운 -15%', {
    stats(m) {
      m.mulStat('dashCooldown', 0.85);
    },
  }],
  [4, '대시 후 1초 안의 첫 공격이 2배 피해를 준다', {
    onDash(w) {
      w.vars.__ambushT = w.time + w.player.stats.dashTime + 1.0;
    },
    onUpdate(w, dt) {
      if ((w.vars.__ambushT ?? 0) > w.time && fx.chance(dt * 30)) {
        const p = w.player;
        w.particles.spawn({ x: p.x + fx.range(-6, 6), y: p.y - fx.range(0, 14), vy: -20, life: 0.4, colors: ['#d0b8ff', '#9a6aff', '#3a1a70'], size: 1, additive: true });
      }
    },
    modifyHit(w, t, hit) {
      if (!isAttack(hit) || (w.vars.__ambushT ?? 0) <= w.time) return;
      w.vars.__ambushT = 0;
      hit.damage *= 2;
      w.particles.burst(t.x, t.y - 6, { count: 12, speed: [40, 120], life: [0.2, 0.4], colors: ['#ffffff', '#c8a8ff', '#6a3ad0'], shape: 'spark', size: [1, 2] });
      w.floatText(t.x, t.y - 18, '기습!', '#c8a8ff');
    },
  }],
  [6, '대시로 꿰뚫은 적이 공포에 빠진다', {
    onDash(w) {
      w.vars.__shadowPassT = w.time + w.player.stats.dashTime + 0.05;
      w.vars.__shadowPassId = (w.vars.__shadowPassId ?? 0) + 1;
    },
    onUpdate(w) {
      if ((w.vars.__shadowPassT ?? 0) < w.time) return;
      const p = w.player;
      const tag = `__shp${w.vars.__shadowPassId}`;
      for (const e of enemiesNear(w, p.x, p.y, p.r + 6)) {
        if (e.mem[tag]) continue;
        e.mem[tag] = 1;
        itemHit(w, e, dmg(w) * 1.2, { statuses: [{ kind: 'fear', duration: 2.5 }], knockback: 80 });
      }
    },
  }],
]);

// ------------------------------------------------------------------ 태엽 clockwork
resonance('clockwork', '태엽', '#d8b070', 'res_clockwork', [
  [2, '5번째 공격마다 반드시 치명타가 터진다', {
    onAttack(w) {
      w.vars.__clockN = (w.vars.__clockN ?? 0) + 1;
      if (w.vars.__clockN % 5 === 0) {
        w.vars.__clockCritT = w.time + 0.12;
        w.sfx('ui_select', { vol: 0.35, pitch: 1.6 });
        const p = w.player;
        w.particles.burst(p.x, p.y - 8, { count: 6, speed: [20, 60], life: [0.15, 0.3], colors: ['#fff0b8', '#d8b070'], shape: 'spark', size: [1, 2] });
      }
    },
    onShoot(w, p) {
      if ((w.vars.__clockCritT ?? 0) >= w.time) {
        p.crit = true;
        p.mem.clockCrit = 1;
        p.color = '#ffe08a';
      }
    },
    modifyHit(w, _t, hit) {
      if (hit.crit || !isAttack(hit)) return;
      const fromVolley = hit.source instanceof Projectile ? !!hit.source.mem.clockCrit : (w.vars.__clockCritT ?? 0) >= w.time;
      if (fromVolley) {
        hit.crit = true;
        hit.damage *= w.player.stats.critMult;
      }
    },
  }],
  [4, '방 클리어 시 30% 확률로 액티브 충전 +1', {
    onRoomClear(w) {
      const p = w.player;
      const act = p.activeId ? Actives.get(p.activeId) : undefined;
      if (!act || act.timed || p.activeCharge >= act.charge || !w.rng.chance(0.3)) return;
      p.activeCharge = Math.min(act.charge, p.activeCharge + 1);
      shout(w, '+1 충전', '#ffe0a0');
      w.sfx(p.activeCharge >= act.charge ? 'active_ready' : 'ui_select', { vol: 0.6 });
    },
  }],
  [6, '전투 중 12초마다 시간이 2초간 멈춘다', {
    onRoomEnter(w) {
      w.vars.__clockStopT = w.time + 6;
      tickTimeStop(w);
    },
    onUpdate(w) {
      tickTimeStop(w);
      if (w.node.cleared || !w.enemies.some((e) => e.alive && !e.ignoreForClear)) return;
      if ((w.vars.__clockStopT ?? 0) === 0) w.vars.__clockStopT = w.time + 6;
      if (w.time >= w.vars.__clockStopT) {
        w.vars.__clockStopT = w.time + 12;
        timeStop(w, 2);
        shout(w, '정지!', '#c8d8ff');
      }
    },
    onRemove(w) {
      w.vars.__tsEnd = Math.min(w.vars.__tsEnd ?? 0, w.time);
      tickTimeStop(w);
    },
  }],
]);
