// Review of the Hangul world float texts (user 2026-10-10, "응 같이 고쳐"): the parts
// that run in node. Galmuri arriving late must not leave a fallback / blank raster in a
// cache (float texts and the room labels of content/rooms/floortext), popups whose
// source is off screen stay off screen, Hangul popups that come together (a hit's '-1',
// 보리's '구조통이 쏟아진다' and '꿀꺽! +' in one frame) stack instead of printing over
// each other, long sentences rest a moment to be read, and every all-3x5 text (damage
// numbers, '+1', '-0.5' + flame) keeps its old motion exactly.
import { describe, expect, it } from 'vitest';
import { nudgeIntoView, readingHold, stackRise, type TextBox } from '../src/engine/worldtext';

type FakeFonts = { check: (f: string) => boolean; load: (f: string) => Promise<unknown> };

/** Swap in a FontFaceSet whose faces are still loading; `finish()` ends the load. */
function loadingFonts(): { fonts: FakeFonts; finish: () => Promise<void>; restore: () => void } {
  const doc = globalThis.document as unknown as { fonts?: unknown };
  const prev = doc.fonts;
  let done!: () => void;
  const loaded = new Promise<void>((r) => (done = r));
  const fonts: FakeFonts = { check: () => false, load: () => loaded.then(() => []) };
  doc.fonts = fonts;
  return {
    fonts,
    finish: async () => {
      done();
      await loaded;
      for (let i = 0; i < 4; i++) await Promise.resolve();
    },
    restore: () => {
      doc.fonts = prev;
    },
  };
}

// first in the file: the module-level font state is fresh here
describe('Galmuri still loading', () => {
  it('float texts: nothing is drawn or cached until the face settles, then it is', async () => {
    await import('./headless');
    const f = loadingFonts();
    try {
      const wt = await import('../src/engine/worldtext');
      const st = wt.fontTextStyle(1);
      expect(wt.fontFaceReady(st.css)).toBe(false);
      expect(wt.fontTextBitmap('성냥이 없다', st, '#ff8a7a', '#140c1c')).toBeNull();
      expect(wt.fontTextBitmap('성냥이 없다', st, '#ff8a7a', '#140c1c')).toBeNull();
      expect(wt.fontTextCacheSize()).toEqual({ bitmaps: 0, masks: 0 });
      // layout still gets a sane width meanwhile
      expect(wt.fontTextWidth('성냥이 없다', st)).toBe(wt.fontTextWidthEstimate('성냥이 없다', st));
      await f.finish();
      expect(wt.fontFaceReady(st.css)).toBe(true);
      expect(wt.fontTextBitmap('성냥이 없다', st, '#ff8a7a', '#140c1c')).not.toBeNull();
      expect(wt.fontTextCacheSize().bitmaps).toBe(1);
    } finally {
      f.restore();
    }
  });

  it('room labels (pixelTextCanvas): rasterized but never cached before the face is there; bounded after', async () => {
    await import('./headless');
    const f = loadingFonts();
    try {
      const { pixelTextCanvas } = await import('../src/content/rooms/floortext');
      const o = { size: 12, font: 'Galmuri11' as const, color: '#d8d0ec', outline: '#0c0810' };
      const a = pixelTextCanvas('완료', o);
      // (identity checks: vitest's matchers would walk the fake canvases on a mismatch)
      expect(pixelTextCanvas('완료', o) === a).toBe(false); // the fallback raster was not kept
      await f.finish();
      const b = pixelTextCanvas('완료', o);
      expect(pixelTextCanvas('완료', o) === b).toBe(true); // cached once the face settled
      // counters ('랠리 37') no longer grow the cache without bound: the oldest drops out
      for (let i = 0; i < 400; i++) pixelTextCanvas(`랠리 ${i}`, o);
      expect(pixelTextCanvas('완료', o) === b).toBe(false);
    } finally {
      f.restore();
    }
  });
});

describe('popups near the view edge', () => {
  it('a cut box is nudged back inside while its anchor is on screen', () => {
    expect(nudgeIntoView(-10, 40, 8, 384)).toBe(1);
    expect(nudgeIntoView(360, 40, 375, 384)).toBe(384 - 1 - 40);
    expect(nudgeIntoView(100, 40, 120, 384)).toBe(100);
  });

  it('a popup whose source is off screen is left alone (it must not ride the edge)', () => {
    expect(nudgeIntoView(400, 40, 420, 384)).toBe(400);
    expect(nudgeIntoView(-70, 40, -50, 384)).toBe(-70);
    // and a box wider than the view is never forced
    expect(nudgeIntoView(-20, 500, 100, 384)).toBe(-20);
  });
});

describe('popups that come together stack', () => {
  const box = (cx: number, w: number, top: number, bottom: number): TextBox => ({ cx, w, top, bottom });

  it('raises a box just above the one it runs into, then above the next', () => {
    const hurt = box(168, 14, 96, 104);
    const spill = box(166, 82, 94, 106);
    expect(stackRise(spill, [hurt], 2)).toBe(96 - 2 - 106);
    const spillUp = box(166, 82, 94 - 14, 106 - 14);
    const gulp = box(168, 40, 92, 104);
    const dy = stackRise(gulp, [hurt, spillUp], 2);
    expect(104 + dy).toBeLessThanOrEqual(spillUp.top - 2);
    expect(stackRise(gulp, [spillUp, hurt], 2)).toBe(dy); // order does not matter
  });

  it('side by side or far apart: no move; never more than maxRise', () => {
    expect(stackRise(box(100, 20, 50, 60), [box(140, 20, 50, 60)])).toBe(0);
    expect(stackRise(box(100, 20, 50, 60), [box(100, 20, 80, 90)])).toBe(0);
    const tower = Array.from({ length: 20 }, (_, i) => box(100, 20, 50 - i * 11, 60 - i * 11));
    expect(stackRise(box(100, 20, 50, 60), tower, 1, 48)).toBe(-48);
  });

  it('long sentences rest a moment to be read; short words and numbers do not', () => {
    for (const t of ['동전 부족', '성냥이 없다', '+방패', '꿀꺽! +', '-1', '27!', 'MISS', '']) expect(readingHold(t), t).toBe(0);
    expect(readingHold('구조통이 쏟아진다')).toBeGreaterThan(0.1);
    expect(readingHold('전투가 끝나면 붙일 수 있다')).toBeGreaterThan(0.3);
    expect(readingHold('우물의 축복 · 서리 마법봉 · 제련 없음 · 제련 없음')).toBe(0.5);
  });

  it('FloatingText: the hit, the spill and the gulp of one frame end up in a readable stack', async () => {
    await import('./headless');
    const { FloatingText, LIFE_ICON, LIFE_HURT_TEXT, LIFE_HEAL_TEXT } = await import('../src/game/effects');
    const live: InstanceType<typeof FloatingText>[] = [];
    const pop = (y: number, t: string, c: string, icon: string | null, x = 168) => {
      const f = new FloatingText(x, y, t, c, 1, 0.7, icon);
      f.settle([live]);
      live.push(f);
      return f;
    };
    const hurt = pop(82, '-1', LIFE_HURT_TEXT, LIFE_ICON);
    const spill = pop(80, '구조통이 쏟아진다', '#ffd9b0', null);
    const gulp = pop(80, '꿀꺽! +', LIFE_HEAL_TEXT, LIFE_ICON);
    expect(hurt.y).toBe(82);
    expect(spill.y).toBeLessThan(hurt.y - 8);
    expect(gulp.y).toBeLessThan(spill.y - 8);
    // all-3x5 texts and repeats keep overlapping exactly as before
    const coin1 = pop(60, '+1', '#ffe060', null, 40);
    const coin2 = pop(60, '+1', '#ffe060', null, 40);
    const heal = pop(60, '+0.5', LIFE_HEAL_TEXT, LIFE_ICON, 40);
    expect([coin1.y, coin2.y, heal.y]).toEqual([60, 60, 60]);
    const again = pop(80, '꿀꺽! +', LIFE_HEAL_TEXT, LIFE_ICON);
    expect(again.y).toBeLessThan(80); // stacks over the others, not over its own twin
    expect(again.y).toBe(gulp.y);
  });

  it('FloatingText motion: 3x5 texts follow the old hop exactly; a long Hangul text rests at the top', async () => {
    await import('./headless');
    const { FloatingText } = await import('../src/game/effects');
    const w = { entities: [] } as unknown as Parameters<InstanceType<typeof FloatingText>['update']>[0];
    const dt = 1 / 60;
    const num = new FloatingText(100, 100, '-0.5', '#ff6a3a');
    num.vx = 10;
    // the old update, step for step
    let x = num.x;
    let y = 100;
    let vx = 10;
    let vy = -55;
    let age = 0;
    while (!num.dead) {
      num.update(w, dt);
      age += dt;
      x += vx * dt;
      y += vy * dt;
      vy += 120 * dt;
      vx *= Math.exp(-dt * 4);
      expect(num.x).toBe(x);
      expect(num.y).toBe(y);
      expect(num.dead).toBe(age >= 0.7);
    }
    const long = new FloatingText(100, 100, '전투가 끝나면 붙일 수 있다', '#ff8a7a');
    expect(long.life).toBeCloseTo(0.7 + readingHold(long.text), 6);
    const ys: number[] = [];
    while (!long.dead) {
      long.update(w, dt);
      ys.push(long.y);
    }
    const top = Math.min(...ys);
    // it rests at the top for the hold, and never sinks below its spawn point
    expect(ys.filter((v) => v === top).length).toBeGreaterThanOrEqual(Math.floor(readingHold(long.text) / dt) - 1);
    expect(Math.max(...ys)).toBeLessThan(100);
  });
});
