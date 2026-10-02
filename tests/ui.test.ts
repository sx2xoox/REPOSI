import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Characters, Sets } from '../src/game/defs';
import { BASE_STATS, computeStats, StatMods } from '../src/game/stats';
import { DEFAULT_BINDINGS } from '../src/engine/input';
import { packColor } from '../src/engine/painter';
import {
  applyTyped, characterOrder, characterStatRows, characterStats, formatDelta, fullStatRows, gridMove, heartSlots,
  hudStats, isUnlocked, sanitizeSeed, scrollToRow, ROOM_ICONS, ROOM_LABELS,
} from '../src/ui/logic';
import { ChangeTracker, Repeater, Spring, envelope, heartbeat, popScale } from '../src/ui/anim';
import { actionLabel, actionLabels, controlKeys, keyName, CONTROL_ROWS } from '../src/ui/keys';
import { formatTime, roman, splitFloorName } from '../src/ui/theme';
import { paintFrame, type FrameStyle } from '../src/ui/frame';
import { hasSprite } from '../src/engine/sprites';

loadContent();

describe('seed entry', () => {
  it('sanitizes typed seeds', () => {
    expect(sanitizeSeed('ab12-cd34')).toBe('AB12-CD34');
    expect(sanitizeSeed('héllo wörld!')).toBe('HLLOWRLD');
    expect(sanitizeSeed('x'.repeat(40))).toHaveLength(16);
  });
  it('applies typed characters and backspace', () => {
    expect(applyTyped('', ['a', 'b', '\b', 'c'])).toBe('AC');
    expect(applyTyped('K7', ['\b', '\b', '\b'])).toBe('');
    expect(applyTyped('AB', [' ', '-', '1'])).toBe('AB-1');
  });
});

describe('character select logic', () => {
  it('computes preview stats including weapon modifiers', () => {
    for (const c of Characters.all()) {
      const s = characterStats(c);
      expect(s.maxHearts).toBe(c.hearts);
      expect(s.damage).toBeGreaterThan(0);
      expect(s.fireRate).toBeGreaterThan(0);
      const rows = characterStatRows(s);
      expect(rows.length).toBeGreaterThanOrEqual(5);
      for (const r of rows) {
        expect(r.frac).toBeGreaterThan(0);
        expect(r.frac).toBeLessThanOrEqual(1);
        expect(hasSprite(r.icon), r.icon).toBe(true);
      }
    }
  });
  it('orders unlocked characters first and respects unlock flags', () => {
    const locked = Characters.all().find((c) => !c.unlocked);
    const order = characterOrder([]);
    expect(order.length).toBe(Characters.all().length);
    const firstLocked = order.findIndex((c) => !isUnlocked(c, []));
    if (firstLocked >= 0) for (const c of order.slice(firstLocked)) expect(isUnlocked(c, [])).toBe(false);
    if (locked) {
      expect(isUnlocked(locked, [])).toBe(false);
      expect(isUnlocked(locked, [`unlock:${locked.id}`])).toBe(true);
    }
  });
});

describe('hud logic', () => {
  it('builds heart slots like Isaac (red containers, then soul)', () => {
    expect(heartSlots(6, 6, 0)).toEqual(['full', 'full', 'full']);
    expect(heartSlots(3, 6, 0)).toEqual(['full', 'half', 'empty']);
    expect(heartSlots(0, 4, 3)).toEqual(['empty', 'empty', 'soul', 'soulHalf']);
    expect(heartSlots(0, 0, 4)).toEqual(['soul', 'soul']);
  });
  it('normalizes HUD stats and formats deltas', () => {
    const s = hudStats(BASE_STATS);
    expect(s.find((x) => x.key === 'moveSpeed')!.text).toBe('1.00');
    expect(s.find((x) => x.key === 'damage')!.text).toBe('10.0');
    expect(formatDelta(0.4, '3.00')).toBe('+0.40');
    expect(formatDelta(-1.5, '16.8')).toBe('-1.5');
    expect(formatDelta(0.001, '1.00')).toBe('');
    expect(formatDelta(2, '0')).toBe('+2');
  });
  it('compares full stats against the base', () => {
    const m = new StatMods().addStat('damage', 5).mulStat('moveSpeed', 0.8).addStat('dashCooldown', -0.2);
    const s = computeStats(BASE_STATS, m);
    const rows = fullStatRows(s, BASE_STATS);
    const get = (label: string) => rows.find((r) => r[0] === label)!;
    expect(get('공격력')[2]).toBe(1);
    expect(get('이동 속도')[2]).toBe(-1);
    expect(get('대시 재사용')[2]).toBe(1); // lower cooldown is better
    expect(get('행운')[2]).toBe(0);
  });
  it('has labels for every room kind and icons that exist', () => {
    for (const k of Object.keys(ROOM_LABELS)) expect(ROOM_LABELS[k as keyof typeof ROOM_LABELS]).toBeTruthy();
    for (const icon of Object.values(ROOM_ICONS)) expect(hasSprite(icon!), icon).toBe(true);
  });
  it('every resonance set has an icon sprite', () => {
    for (const s of Sets.all()) expect(hasSprite(s.icon), s.icon).toBe(true);
  });
});

describe('grid navigation', () => {
  it('wraps within rows and clamps the last row', () => {
    expect(gridMove(0, 25, 10, 1, 0)).toBe(1);
    expect(gridMove(9, 25, 10, 1, 0)).toBe(0);
    expect(gridMove(20, 25, 10, -1, 0)).toBe(24);
    expect(gridMove(9, 25, 10, 0, 1)).toBe(19);
    expect(gridMove(19, 25, 10, 0, 1)).toBe(24); // shorter last row clamps
    expect(gridMove(3, 25, 10, 0, -1)).toBe(23);
    expect(gridMove(0, 0, 10, 1, 0)).toBe(0);
  });
  it('keeps the selected row visible', () => {
    expect(scrollToRow(0, 2, 5)).toBe(0);
    expect(scrollToRow(0, 6, 5)).toBe(2);
    expect(scrollToRow(3, 1, 5)).toBe(1);
  });
});

describe('animation helpers', () => {
  it('spring converges to its target', () => {
    const s = new Spring(0, 260, 26);
    s.target = 10;
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(s.value).toBeCloseTo(10, 1);
  });
  it('change tracker reports direction, delta and pops', () => {
    const t = new ChangeTracker(0);
    expect(t.update(5, 0.016)).toBe(false); // first value initializes silently
    expect(t.update(8, 0.016)).toBe(true);
    expect(t.dir).toBe(1);
    expect(t.delta).toBe(3);
    expect(t.pop).toBe(1);
    t.update(9, 0.1);
    expect(t.delta).toBe(4); // accumulates while recent
    t.update(4, 0.1);
    expect(t.dir).toBe(-1);
    expect(t.delta).toBe(-5);
  });
  it('pop scale returns to 1 and envelopes stay in range', () => {
    expect(popScale(0)).toBe(1);
    expect(popScale(1, 0.4)).toBeCloseTo(1, 5);
    expect(popScale(0.85, 0.4)).toBeGreaterThan(1);
    for (let t = -1; t < 5; t += 0.1) {
      const e = envelope(t, 3, 0.4, 0.6);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
    expect(heartbeat(0.07)).toBeGreaterThan(0.8);
  });
  it('repeater fires on press then repeats after a delay', () => {
    const r = new Repeater(0.3, 0.1);
    let n = 0;
    for (let i = 0; i < 60; i++) if (r.update(true, 1 / 60)) n++; // 1 second held
    expect(n).toBeGreaterThanOrEqual(7);
    expect(n).toBeLessThanOrEqual(9);
    expect(r.update(false, 1 / 60)).toBe(false);
    expect(r.update(true, 1 / 60)).toBe(true);
  });
});

describe('key labels', () => {
  it('names keys and actions readably', () => {
    expect(keyName('KeyQ')).toBe('Q');
    expect(keyName('Space')).toBe('Space');
    expect(keyName('Mouse2')).toBe('우클릭');
    expect(actionLabel(DEFAULT_BINDINGS, 'active')).toBe('Q');
    expect(actionLabel(DEFAULT_BINDINGS, 'special')).toBe('F');
    expect(actionLabel(DEFAULT_BINDINGS, 'dash', true)).toBe('A');
    expect(actionLabels(DEFAULT_BINDINGS, 'dash')).toEqual(['Space', 'Shift', '우클릭']);
    expect(controlKeys(DEFAULT_BINDINGS, ['up', 'left', 'down', 'right'])).toBe('WASD');
  });
  it('controls reference covers every gameplay action', () => {
    const covered = new Set(CONTROL_ROWS.flatMap((r) => r.actions));
    for (const a of ['up', 'dash', 'bomb', 'active', 'consumable', 'special', 'inventory', 'map', 'pause'] as const) expect(covered.has(a), a).toBe(true);
  });
});

describe('theme helpers', () => {
  it('formats time, numerals and floor names', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75.9)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(roman(3)).toBe('III');
    expect(splitFloorName('1층 · 잊혀진 지하묘지')).toEqual(['1층', '잊혀진 지하묘지']);
    expect(splitFloorName('심연')).toEqual(['', '심연']);
  });
});

describe('pixel frames', () => {
  const styles: FrameStyle[] = ['panel', 'panelHi', 'ornate', 'inset', 'slot', 'slotHi', 'parchment', 'tooltip', 'button', 'buttonHi', 'glass', 'ribbon', 'key', 'keyDown'];
  it('paints every style with transparent rounded corners and a filled center', () => {
    for (const st of styles) {
      for (const [w, h] of [[8, 8], [40, 20], [120, 60]]) {
        const p = paintFrame(st, w, h, '#ff8040');
        expect(p.isSet(0, 0), `${st} corner`).toBe(false);
        expect(p.isSet(Math.floor(w / 2), Math.floor(h / 2)), `${st} center`).toBe(true);
        expect(p.isSet(Math.floor(w / 2), 0), `${st} top edge`).toBe(true);
      }
    }
  });
  it('panel outline uses the ink color', () => {
    const p = paintFrame('panel', 30, 20);
    expect(p.get(10, 0)).toBe(packColor('#0c0810'));
  });
});
