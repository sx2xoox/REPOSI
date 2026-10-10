// World float texts with Hangul (user 2026-10-10, "응 같이 고쳐"): the 3x5 world font
// has no Hangul, so '동전 부족', '성냥이 없다', 보리's '꿀꺽! +' ... drew as blank space.
// Renderer.pixelText now sends any text the 3x5 font cannot draw through the bundled
// Galmuri pixel face (engine/worldtext.ts), and FloatingText steps out from under the
// item card. These are the pure parts (no DOM) plus a headless draw smoke test.
import { describe, expect, it } from 'vitest';
import {
  FONT_MASK_CACHE_MAX, FONT_TEXT_CACHE_MAX, LruCache, PIXEL_GLYPHS, dodgeCovers, fontTextBitmap, fontTextCacheSize, fontTextKey,
  fontTextStyle, fontTextWidth, pixelFontCovers,
} from '../src/engine/worldtext';

describe('which world texts need the Galmuri path', () => {
  it('numbers and the 3x5 words stay on the 3x5 font', () => {
    for (const t of ['0', '37', '+1', '-0.5', '+12', '27!', 'MISS', 'miss', '1/3 · 45%', '2/3 · 41s', '+', '...', 'x2', '60%', '']) {
      expect(pixelFontCovers(t), t).toBe(true);
    }
  });

  it('Hangul (and any glyph the 3x5 font lacks) takes the Galmuri path', () => {
    for (const t of ['동전 부족', '꿀꺽! +', '+방패', '통 2/3', '성냥이 없다', '간파!', '…', '♥', 'Q', 'J', 'ß', '😀', 'ㅋ']) {
      expect(pixelFontCovers(t), t).toBe(false);
    }
  });

  it('the 3x5 glyphs are 3 wide and 5 tall', () => {
    for (const [ch, g] of Object.entries(PIXEL_GLYPHS)) {
      expect(g.length, ch).toBe(5);
      for (const row of g) expect(row, ch).toMatch(/^[01]{3}$/);
    }
  });
});

describe('Galmuri style per pixelText scale', () => {
  it('scale 1 is Galmuri9; even scales Galmuri11 Bold; integer pixel multipliers', () => {
    expect(fontTextStyle(1)).toMatchObject({ font: 'Galmuri9', size: 10, bold: false, k: 1 });
    expect(fontTextStyle(2)).toMatchObject({ font: 'Galmuri11', size: 12, bold: true, k: 1 });
    expect(fontTextStyle(3)).toMatchObject({ font: 'Galmuri9', k: 2 });
    expect(fontTextStyle(4)).toMatchObject({ font: 'Galmuri11', bold: true, k: 2 });
    expect(fontTextStyle(0.4).k).toBe(1);
    expect(fontTextStyle(1)).toBe(fontTextStyle(1)); // cached, no per-frame allocation
  });

  it('a bigger scale never reads smaller, and never below the 3x5 height', () => {
    let prev = 0;
    for (let s = 1; s <= 8; s++) {
      const st = fontTextStyle(s);
      const h = st.ink * st.k;
      expect(Number.isInteger(st.k)).toBe(true);
      expect(h).toBeGreaterThan(prev);
      expect(h).toBeGreaterThanOrEqual(Math.max(9, 5 * s));
      prev = h;
    }
  });

  it('cache keys separate face, color and outline', () => {
    const a = fontTextStyle(1).css;
    const b = fontTextStyle(2).css;
    const keys = new Set([
      fontTextKey('동전 부족', a, '#ff7070', '#140c1c'),
      fontTextKey('동전 부족', b, '#ff7070', '#140c1c'),
      fontTextKey('동전 부족', a, '#ff8080', '#140c1c'),
      fontTextKey('동전 부족', a, '#ff7070', undefined),
      fontTextKey('동전 부족 ', a, '#ff7070', '#140c1c'),
    ]);
    expect(keys.size).toBe(5);
  });
});

describe('bounded LRU', () => {
  it('never holds more than its cap and drops the least recently used first', () => {
    const c = new LruCache<number>(3);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBe(1); // a is fresh again
    c.set('d', 4); // drops b
    expect(c.size).toBe(3);
    expect(c.has('b')).toBe(false);
    expect(c.has('a') && c.has('c') && c.has('d')).toBe(true);
    for (let i = 0; i < 1000; i++) c.set(`k${i}`, i);
    expect(c.size).toBe(3);
    c.set('k999', 5); // replacing keeps the size
    expect(c.size).toBe(3);
    expect(c.get('k999')).toBe(5);
  });

  it('the shipped caps are small', () => {
    expect(FONT_TEXT_CACHE_MAX).toBeLessThanOrEqual(128);
    expect(FONT_MASK_CACHE_MAX).toBeLessThanOrEqual(256);
  });
});

describe('float texts step out from under a UI card', () => {
  const VIEW: [number, number] = [384, 216];

  it('no cover, no move', () => {
    expect(dodgeCovers(10, 10, 40, 12, [], ...VIEW)).toEqual([0, 0, -1]);
    expect(dodgeCovers(10, 10, 40, 12, [100, 100, 50, 50], ...VIEW)).toEqual([0, 0, -1]);
  });

  it('a card just above (the text rising into its bottom) pushes the text down to its edge', () => {
    // card 120 x 50 at (100, 20); text 46 x 12 whose top is 4 px inside the card's bottom
    const [dx, dy, dir] = dodgeCovers(130, 66, 46, 12, [100, 20, 120, 50], ...VIEW);
    expect([dx, dy, dir]).toEqual([0, 4, 1]);
  });

  it('a card beside (overlapping the text by 12 px) pushes the text sideways', () => {
    const [dx, dy, dir] = dodgeCovers(100, 80, 46, 12, [134, 50, 120, 60], ...VIEW);
    expect([dx, dy, dir]).toEqual([-12, 0, 2]);
  });

  it('stays inside the view, and keeps last frame\'s side unless it costs much more', () => {
    // pushing left would leave the view: it goes down instead
    const [dx, , dir] = dodgeCovers(2, 30, 40, 12, [10, 0, 100, 36], ...VIEW);
    expect(dx).toBe(0);
    expect(dir).toBe(1);
    // nearly equal costs: the preferred side wins
    expect(dodgeCovers(100, 60, 20, 10, [115, 53, 100, 14], ...VIEW, 1)[2]).toBe(1);
    expect(dodgeCovers(100, 60, 20, 10, [115, 53, 100, 14], ...VIEW, -1)[2]).toBe(2);
  });
});

describe('without a DOM (node)', () => {
  it('nothing is rasterized or cached, widths are estimated', () => {
    if (typeof document !== 'undefined') return; // a headless shim from another file in this worker
    const st = fontTextStyle(1);
    expect(fontTextBitmap('동전 부족', st, '#ff7070', '#140c1c')).toBeNull();
    expect(fontTextWidth('동전 부족', st)).toBeGreaterThan(30);
    expect(fontTextCacheSize()).toEqual({ bitmaps: 0, masks: 0 });
  });
});

describe('headless draw (fake canvases)', () => {
  it('pixelText / FloatingText draw Hangul without throwing; ASCII keeps the 3x5 metrics; caches stay bounded', async () => {
    await import('./headless');
    const { fakeDisplay } = await import('./headless');
    const { Renderer } = await import('../src/engine/renderer');
    const { FloatingText, LIFE_ICON } = await import('../src/game/effects');
    await import('../src/content/sprites/common');
    const r = new Renderer(fakeDisplay(1280, 720));
    r.beginWorld();
    // ASCII: exactly the old 3x5 widths
    expect(r.pixelText('-0.5', 50, 50, '#ffffff', { outline: '#140c1c' })).toBe(15);
    expect(r.pixelTextWidth('MISS', 2)).toBe(30);
    expect(r.pixelTextHeight('37', 1)).toBe(5);
    expect(r.pixelTextHeight('동전 부족', 1)).toBe(9);
    expect(r.pixelTextHeight('간파!', 2)).toBe(11);
    // Hangul: drawn through the Galmuri path (the fake canvas has no ink: width 0)
    expect(() => r.pixelText('동전 부족', 50, 50, '#ff7070', { align: 'center', outline: '#140c1c' })).not.toThrow();
    for (const [t, icon, scale] of [['꿀꺽! +', LIFE_ICON, 1], ['+방패', null, 1], ['간파!', null, 2], ['-1', LIFE_ICON, 1]] as const) {
      const f = new FloatingText(100, 80, t, '#ffb24a', scale, 0.7, icon);
      f.age = 0.01; // pop frame
      expect(() => f.draw(r)).not.toThrow();
      f.age = 0.5;
      expect(() => f.draw(r)).not.toThrow();
    }
    // a card over the text: the dodge path runs too
    r.coverWorld(0, 0, 768, 200);
    r.beginWorld();
    expect(r.worldCovers().length).toBe(4);
    expect(() => new FloatingText(100, 40, '성냥이 없다', '#ff8a7a').draw(r)).not.toThrow();
    r.beginWorld();
    r.beginWorld();
    expect(r.worldCovers().length).toBe(0); // a cover lives one frame
    // spam: hundreds of distinct texts never grow the caches past their caps
    for (let i = 0; i < 400; i++) r.pixelText(`피해 ${i}`, 10, 10, i % 2 ? '#ffffff' : '#ff0000', { outline: '#140c1c' });
    const n = fontTextCacheSize();
    expect(n.bitmaps).toBeLessThanOrEqual(FONT_TEXT_CACHE_MAX);
    expect(n.masks).toBeLessThanOrEqual(FONT_MASK_CACHE_MAX);
    expect(n.bitmaps).toBeGreaterThan(0);
  });
});
