// 삼연 쇠뇌 (triple repeater): each attack fires a rapid three-bolt burst of
// fast, heavy bolts. Strong single-target pressure with crunchy recoil.

import { defineWeapon, type WeaponState } from '../../game/defs';
import type { World } from '../../game/world';
import type { Player } from '../../game/player';
import { defineDrawnSprite } from '../../engine/sprites';
import { O, attackInterval, drawHeld, handPos, kick, muzzle, attackInput, consumeAttack } from './common';

defineDrawnSprite('w_crossbow', 15, 13, (p) => {
  // stock
  p.rect(0, 5, 10, 3, '#6a4026');
  p.rect(0, 5, 10, 1, '#9a6a40');
  p.rect(2, 8, 2, 2, '#4a2a18');
  // magazine box
  p.rect(5, 2, 4, 3, '#4a5068');
  p.rect(5, 2, 4, 1, '#8a92ac');
  // prod (bow arms)
  for (let y = 0; y < 13; y++) {
    const k = (y - 6) / 6;
    p.px(Math.round(11 - 2.5 * k * k), y, y === 0 || y === 12 ? '#c8d0e4' : '#8a92ac');
  }
  p.line(8, 0, 8, 12, '#e8e0d0');
  p.rect(10, 6, 5, 1, '#c0c8d8');
}, { outline: O, origin: [3, 6] });

defineDrawnSprite('icon_repeater', 16, 16, (p) => {
  // classic crossbow silhouette pointing right
  p.rect(0, 8, 11, 3, '#6a4026');
  p.rect(0, 8, 11, 1, '#9a6a40');
  p.rect(1, 11, 2, 2, '#4a2a18');
  // magazine with three bolts
  p.rect(5, 5, 4, 3, '#4a5068');
  p.rect(5, 5, 4, 1, '#8a92ac');
  p.px(6, 4, '#ffd060'); p.px(7, 4, '#ffd060'); p.px(8, 4, '#ffd060');
  // curved prod + string
  for (let y = 1; y < 16; y++) {
    const k = (y - 8.5) / 7.5;
    p.px(Math.round(12.5 - 2.6 * k * k), y, y < 3 || y > 13 ? '#e8ecf8' : '#8a92ac');
  }
  p.line(10, 1, 7, 9, '#f0e8d8');
  p.line(10, 15, 7, 9, '#f0e8d8');
  // bolt on the rail
  p.line(6, 9, 13, 9, '#c8a070');
  p.poly([13, 7.5, 16, 9.5, 13, 11.5], '#e8f0ff');
}, { outline: O });

function bolt(w: World, p: Player, st: WeaponState): void {
  const aim = p.aim + (w.rng.next() - 0.5) * 0.06;
  const h = handPos(p, aim, 12);
  p.fireProjectiles(w, aim, {
    style: 'sprite', sprite: 'proj_bolt', radius: p.stats.projSize * 0.85, light: 8, color: '#e8e0d0',
    spreadMult: 0.5, x: h.x, y: h.y,
  });
  st.mem.boltAt = w.time;
  muzzle(w, h.x, h.y, aim, ['#ffffff', '#e8e0d0', '#a09080'], 3, [30, 90]);
  kick(w, aim + Math.PI, 0.9);
  w.sfx('shoot_arrow', { vol: 0.5, pitch: 1.35 + st.mem.burst * 0.06 });
}

defineWeapon({
  id: 'repeater_crossbow',
  name: '삼연 쇠뇌',
  desc: '한 번에 세 발의 쇠뇌살을 연사한다. 빠르고 묵직한 단일 대상 화력.',
  icon: 'icon_repeater',
  heldSprite: 'w_crossbow',
  kind: 'ranged',
  rarity: 'common',
  tags: ['bow'],
  pools: ['treasure', 'shop'],
  stats(m) {
    m.mulStat('damage', 0.41);
    m.mulStat('fireRate', 0.78);
    m.mulStat('shotSpeed', 1.5);
    m.mulStat('range', 1.15);
  },
  update(w, p, st, dt, firing, aim) {
    const want = attackInput(st, w, firing, 0.15);
    if ((st.mem.burst ?? 0) > 0) {
      st.mem.bt = (st.mem.bt ?? 0) - dt;
      if (st.mem.bt <= 0) {
        st.mem.burst--;
        st.mem.bt = 0.07;
        bolt(w, p, st);
      }
      return;
    }
    if (!want || st.cooldown > 0) return;
    consumeAttack(st);
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    st.mem.burst = 3;
    st.mem.bt = 0;
    st.cooldown = attackInterval(p);
  },
  draw(w, p, r, st) {
    const t = w.time - (st.mem.boltAt ?? -9);
    const rec = t < 0.07 ? (1 - t / 0.07) * 3 : 0;
    drawHeld(r, p, 'w_crossbow', p.aim, 6 - rec, { flash: rec > 2 ? 0.3 : 0 });
  },
});
