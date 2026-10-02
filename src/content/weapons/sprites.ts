// Projectile sprites shared by weapons (all authored pointing right).

import { defineDrawnSprite, hasSprite } from '../../engine/sprites';
import { O } from './common';

/** Crescent sword wave (검기), pivot at its center. */
export function swordWaveSprite(color: string): string {
  const name = `__wave_${color}`;
  if (hasSprite(name)) return name;
  defineDrawnSprite(name, 12, 22, (p) => {
    for (let y = 0; y < 22; y++) {
      for (let x = 0; x < 12; x++) {
        const d1 = Math.hypot(x + 0.5 + 6, y + 0.5 - 11);
        const d2 = Math.hypot(x + 0.5 + 10, y + 0.5 - 11);
        if (d1 < 17 && d2 > 17.5) {
          const edge = 17 - d1;
          p.px(x, y, edge < 1.3 ? '#ffffff' : edge < 3 ? color : color + 'aa');
        }
      }
    }
  }, { origin: [6, 11] });
  return name;
}

// arrow (hunter bow): shaft, iron head, red fletching
defineDrawnSprite('proj_arrow', 14, 5, (p) => {
  p.line(2, 2, 10, 2, '#c8a070');
  p.line(3, 2, 9, 2, '#e8c890');
  p.poly([10, 0, 14, 2.5, 10, 5], '#d8e0f0');
  p.px(11, 2, '#ffffff');
  p.px(0, 1, '#e03c2c'); p.px(1, 1, '#e03c2c'); p.px(2, 1, '#ff7050');
  p.px(0, 3, '#a02418'); p.px(1, 3, '#e03c2c'); p.px(2, 3, '#e03c2c');
}, { outline: O, origin: [8, 2] });

// fully drawn arrow wrapped in lantern light
defineDrawnSprite('proj_arrow_glow', 18, 7, (p) => {
  p.line(0, 3, 6, 3, '#ffe08a80');
  p.line(4, 3, 13, 3, '#fff0c0');
  p.line(5, 2, 12, 2, '#ffd060');
  p.line(5, 4, 12, 4, '#ffd060');
  p.poly([13, 0.5, 18, 3.5, 13, 6.5], '#ffffff');
  p.px(14, 3, '#fff8d0');
  p.px(3, 2, '#ff9050'); p.px(4, 2, '#ffd060');
  p.px(3, 4, '#ff9050'); p.px(4, 4, '#ffd060');
}, { outline: '#3a1c08', origin: [11, 3] });

// crossbow bolt: short and heavy
defineDrawnSprite('proj_bolt', 10, 3, (p) => {
  p.rect(1, 1, 6, 1, '#8a6a48');
  p.poly([6, 0, 10, 1.5, 6, 3], '#c0c8d8');
  p.px(7, 1, '#ffffff');
  p.px(0, 0, '#e8e0d0');
  p.px(0, 2, '#e8e0d0');
}, { outline: O, origin: [6, 1] });

// thrown dagger / spinning blade frames are defined by their weapons
