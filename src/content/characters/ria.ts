// Starting character: 리아, the lantern keeper. Weapon: 등불 마탄 (lantern bolts).

import { defineCharacter, defineWeapon } from '../../game/defs';
import { defineAnim, defineDrawnSprite } from '../../engine/sprites';
import { ramp, type PixelPainter } from '../../engine/painter';
import { fanAngles } from '../../game/projectile';

// ------------------------------------------------------------------ sprites
type Facing = 'down' | 'up' | 'side';

export interface CharacterLook {
  cloak: string;
  hood: string;
  skin: string;
  accent: string;
  eye: string;
  hair?: string;
}

/** Procedural chibi hooded character, 14x18, feet at the bottom. Reusable by other characters. */
export function drawHooded(p: PixelPainter, look: CharacterLook, facing: Facing, step: number, bob: number): void {
  const cl = ramp(look.cloak, 4);
  const hd = ramp(look.hood, 4);
  const y0 = bob;
  // feet
  const lf = step === 1 ? -1 : step === 3 ? 1 : 0;
  p.rect(4, 15 + Math.max(0, lf) , 2, 2 - Math.max(0, lf), '#1a1420');
  p.rect(8, 15 + Math.max(0, -lf), 2, 2 - Math.max(0, -lf), '#1a1420');
  // cloak body (trapezoid)
  p.poly([3, 8 + y0, 11, 8 + y0, 12.5, 16, 1.5, 16], look.cloak);
  p.shadeVertical(1, 8 + y0, 12, 9, [cl[0], cl[1], cl[2]]);
  // cloak hem highlight + fold
  p.line(2, 15, 11, 15, cl[0]);
  if (facing !== 'up') p.line(7, 10 + y0, 7, 15, cl[1]);
  // scarf
  p.rect(3, 8 + y0, 8, 2, look.accent);
  p.px(3, 8 + y0, ramp(look.accent, 3)[2]);
  if (facing === 'side') p.rect(1, 9 + y0, 3, 3, look.accent);
  // head / hood
  p.ellipse(7, 4.5 + y0, 5, 4.6, look.hood);
  p.shadeSphere(7, 4.5 + y0, 5, 4.6, [hd[0], hd[1], hd[2], hd[3]], { dither: false });
  if (facing === 'down') {
    p.ellipse(7, 5.5 + y0, 3.2, 2.6, look.skin);
    p.rect(5, 5 + y0, 1, 2, look.eye);
    p.rect(9, 5 + y0, 1, 2, look.eye);
    p.px(5, 5 + y0, '#ffffff');
    p.px(9, 5 + y0, '#ffffff');
    if (look.hair) p.rect(4, 3 + y0, 6, 1, look.hair);
  } else if (facing === 'side') {
    p.ellipse(9, 5.5 + y0, 2.6, 2.6, look.skin);
    p.rect(10, 5 + y0, 1, 2, look.eye);
    p.px(10, 5 + y0, '#ffffff');
    if (look.hair) p.rect(7, 3 + y0, 4, 1, look.hair);
  } else {
    // back of the hood: seam
    p.line(7, 1 + y0, 7, 8 + y0, hd[1]);
  }
  // hood tip
  p.px(7, 0 + y0, hd[3]);
}

export function defineCharacterSprites(prefix: string, look: CharacterLook): void {
  const facings: Facing[] = ['down', 'up', 'side'];
  for (const f of facings) {
    for (let i = 0; i < 2; i++) {
      defineDrawnSprite(`${prefix}_idle_${f}_${i}`, 14, 18, (p) => drawHooded(p, look, f, 0, i), { outline: '#0c0810', anchor: 'bottom' });
    }
    for (let i = 0; i < 4; i++) {
      defineDrawnSprite(`${prefix}_walk_${f}_${i}`, 14, 18, (p) => drawHooded(p, look, f, i, i % 2 ? 1 : 0), { outline: '#0c0810', anchor: 'bottom' });
    }
    defineAnim(`${prefix}_idle_${f}`, [`${prefix}_idle_${f}_0`, `${prefix}_idle_${f}_1`], 2.5);
    defineAnim(`${prefix}_walk_${f}`, [0, 1, 2, 3].map((i) => `${prefix}_walk_${f}_${i}`), 10);
  }
  defineDrawnSprite(`${prefix}_portrait`, 14, 18, (p) => drawHooded(p, look, 'down', 0, 0), { outline: '#0c0810' });
}

defineCharacterSprites('ria', { cloak: '#2f5866', hood: '#3a6c78', skin: '#f2d6c0', accent: '#d8503a', eye: '#1a1420', hair: '#e8c070' });

// held lantern (pointing right). Bolts leave from its glass.
defineDrawnSprite('w_lantern', 9, 10, (p) => {
  p.rect(3, 0, 3, 1, '#8a7a5a');
  p.rect(1, 1, 7, 2, '#5a4a3a');
  p.rect(1, 3, 7, 5, '#ffe080');
  p.rect(2, 4, 5, 3, '#fff8d0');
  p.rect(1, 3, 1, 5, '#5a4a3a');
  p.rect(7, 3, 1, 5, '#5a4a3a');
  p.rect(1, 8, 7, 2, '#5a4a3a');
}, { outline: '#0c0810', origin: [2, 5] });

defineDrawnSprite('icon_lantern_bolt', 16, 16, (p) => {
  p.circle(8, 8, 6, '#ffd890');
  p.shadeSphere(8, 8, 6, 6, ramp('#ffb840', 4));
  p.circle(8, 8, 2.5, '#fff8e0');
}, { outline: '#0c0810' });

// ------------------------------------------------------------------ weapon
defineWeapon({
  id: 'lantern_bolt',
  name: '등불 마탄',
  desc: '등불의 불꽃을 탄환으로 쏘아낸다. 균형 잡힌 원거리 무기.',
  icon: 'icon_lantern_bolt',
  heldSprite: 'w_lantern',
  kind: 'ranged',
  rarity: 'common',
  pools: [],
  update(w, p, st, _dt, firing, aim) {
    if (!firing || st.cooldown > 0) return;
    st.cooldown = 1 / p.stats.fireRate;
    st.sinceAttack = 0;
    w.items.onAttack(aim);
    p.fireProjectiles(w, aim, { style: 'orb', color: '#ffd078', light: 20 });
    w.sfx('shoot_magic', { vol: 0.5, pitch: 0.95 + w.rng.next() * 0.1 });
    void fanAngles;
  },
});

// ------------------------------------------------------------------ character
defineCharacter({
  id: 'ria',
  name: '리아',
  title: '마지막 등불지기',
  desc: '꺼져가는 마을의 등불을 되살리기 위해 지하로 내려간 소녀. 모든 능력이 고르다.',
  spritePrefix: 'ria',
  portrait: 'ria_portrait',
  color: '#ffd078',
  hearts: 3,
  weapon: 'lantern_bolt',
  bombs: 1,
  unlocked: true,
  lightColor: '#ffd8a0',
  releaseDesc: '주변을 불태우는 화염 고리를 터뜨리고 적 탄환을 지운다.',
});
