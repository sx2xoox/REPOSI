import { describe, expect, it } from 'vitest';
import {
  AIM_ENGAGE, GAME_BUTTONS, MANUAL_ENGAGE, MANUAL_RELEASE, MOVE_DEAD_ZONE, MOVE_FULL_AT, SCROLL_STEP, SYSTEM_BUTTONS, TAP_SLOP, TARGET_DEFAULTS,
  TapTracker, TouchRouter, computeTouchLayout, followBase, hitButton, knobPosition, pickTarget, qualityProfile, stickVector, touchScheme, touchVisible,
  type HudGeometry, type Insets, type TargetCandidate, type TouchButtonId, type TouchLayout, type TouchScheme,
} from '../src/ui/touch-logic';
import { Input } from '../src/engine/input';
import { fitViewport, UI_H, VIEW_H } from '../src/engine/renderer';

const NO_SAFE: Insets = { l: 0, r: 0, t: 0, b: 0 };

/** What the renderer + HUD produce for a viewport (CSS px, dpr 1): world image rect and minimap block. */
function hudGeom(w: number, h: number, safe: Insets = NO_SAFE): HudGeometry {
  const f = fitViewport(w, h);
  const game = { x: f.offsetX, y: f.offsetY, w: f.viewW * f.scale, h: VIEW_H * f.scale };
  const us = f.uiScale;
  // HUD: minimap 124x86 (+ 2 text lines) 8 units from the safe top-right corner of the UI space
  const uiRight = f.uiOffsetX + f.uiW * us;
  const safeR = Math.max(0, uiRight - (w - safe.r));
  const safeT = Math.max(0, safe.t - f.uiOffsetY);
  const minimap = { x: uiRight - safeR - (124 + 8) * us, y: f.uiOffsetY + safeT + 8 * us, w: 124 * us, h: 116 * us };
  return { game, minimap };
}

const VIEWS: { name: string; w: number; h: number; safe: Insets }[] = [
  { name: 'pixel 7 (20:9)', w: 915, h: 412, safe: NO_SAFE },
  { name: 'iphone 16e (notch)', w: 844, h: 390, safe: { l: 47, r: 47, t: 0, b: 21 } },
  { name: 'iphone pro max (19.5:9)', w: 932, h: 430, safe: { l: 59, r: 59, t: 0, b: 21 } },
  { name: '21:9 android', w: 960, h: 411, safe: { l: 0, r: 32, t: 0, b: 0 } },
  { name: 'iphone se (16:9)', w: 667, h: 375, safe: NO_SAFE },
  { name: 'ipad', w: 1180, h: 820, safe: { l: 0, r: 0, t: 0, b: 20 } },
  { name: 'ipad 4:3', w: 1024, h: 768, safe: NO_SAFE },
];
describe('stick math', () => {
  it('ignores the dead zone', () => {
    const v = stickVector(40 * MOVE_DEAD_ZONE * 0.9, 0, 40);
    expect(v).toEqual({ x: 0, y: 0, mag: 0 });
  });
  it('ramps to full magnitude before the rim', () => {
    const r = 40;
    const half = stickVector(r * ((MOVE_DEAD_ZONE + MOVE_FULL_AT) / 2), 0, r);
    expect(half.mag).toBeCloseTo(0.5, 5);
    expect(stickVector(r * MOVE_FULL_AT, 0, r).mag).toBeCloseTo(1, 5);
    const far = stickVector(0, -r * 3, r);
    expect(far.mag).toBe(1);
    expect(far.x).toBeCloseTo(0, 6);
    expect(far.y).toBeCloseTo(-1, 6);
  });
  it('keeps the direction for diagonals and never exceeds length 1', () => {
    const v = stickVector(100, 100, 40);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
    expect(v.x).toBeCloseTo(v.y, 6);
  });
  it('drags the floating base along when the finger overshoots', () => {
    const b = followBase({ x: 0, y: 0 }, { x: 100, y: 0 }, 40);
    expect(b).toEqual({ x: 60, y: 0 });
    expect(followBase({ x: 0, y: 0 }, { x: 10, y: 10 }, 40)).toEqual({ x: 0, y: 0 });
  });
  it('clamps the drawn knob to the base radius', () => {
    expect(knobPosition({ x: 0, y: 0 }, { x: 0, y: 90 }, 30)).toEqual({ x: 0, y: 30 });
    expect(knobPosition({ x: 0, y: 0 }, { x: 5, y: 5 }, 30)).toEqual({ x: 5, y: 5 });
  });
});

describe('adaptive viewport', () => {
  it('16:9 is exactly the classic 384x216 / 768x432', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [3840, 2160], [667, 375]]) {
      const f = fitViewport(w, h);
      expect(f.viewW, `${w}x${h}`).toBe(384);
      expect(f.uiW).toBe(768);
      expect(f.uiScale).toBeCloseTo(f.scale / 2, 9);
      expect(Math.abs(f.offsetX)).toBeLessThanOrEqual(1);
      expect(Math.abs(f.offsetY)).toBeLessThanOrEqual(1);
    }
  });
  it('wide phones fill the screen (no bars) with a wider world', () => {
    for (const [w, h, dpr] of [[844, 390, 3], [932, 430, 3], [915, 412, 2.625], [960, 411, 3], [800, 360, 2]]) {
      const W = Math.round(w * dpr);
      const H = Math.round(h * dpr);
      const f = fitViewport(W, H);
      expect(f.viewW % 2, `${w}x${h}`).toBe(0);
      expect(f.viewW).toBeGreaterThan(384);
      // world image covers the whole display (at most a world pixel is cropped)
      expect(f.offsetX).toBeLessThanOrEqual(0);
      expect(f.offsetX).toBeGreaterThan(-f.scale * 1.01);
      expect(f.offsetX + f.viewW * f.scale).toBeGreaterThanOrEqual(W - 1);
      expect(Math.abs(f.offsetY)).toBeLessThanOrEqual(1);
      expect(VIEW_H * f.scale).toBeGreaterThanOrEqual(H - 1);
      // the UI space spans the same rect, twice the world resolution
      expect(f.uiW).toBe(f.viewW * 2);
      expect(UI_H * f.uiScale).toBeCloseTo(VIEW_H * f.scale, 6);
    }
    expect(fitViewport(844 * 3, 390 * 3).viewW).toBe(468);
    expect(fitViewport(915, 412).viewW).toBe(480);
  });
  it('ultrawide is capped (pillarbox) and tall tablets keep a 768x432 UI band', () => {
    const uw = fitViewport(2560, 1080);
    expect(uw.viewW).toBe(512);
    const sw = fitViewport(3440, 1440);
    expect(sw.viewW).toBe(512);
    expect(sw.offsetX).toBeGreaterThan(0);
    const ipad = fitViewport(1180, 820);
    expect(ipad.viewW).toBeGreaterThanOrEqual(304);
    expect(ipad.viewW).toBeLessThan(384);
    expect(ipad.offsetY).toBe(0); // world fills the height
    expect(ipad.uiW).toBe(768);
    expect(ipad.uiOffsetY).toBeGreaterThan(0); // UI band centered vertically
    expect(ipad.uiScale * 768).toBeCloseTo(ipad.viewW * ipad.scale, 6);
    const ipad43 = fitViewport(1024, 768);
    expect(ipad43.viewW).toBe(304);
    expect(ipad43.offsetY).toBeGreaterThan(0); // slight letterbox below 1.41:1
    expect(ipad43.offsetY).toBeLessThan(768 * 0.04);
  });
  it('pixel-perfect keeps an integer scale', () => {
    const f = fitViewport(1280, 720, true);
    expect(f.scale).toBe(3);
    expect(f.offsetX).toBeLessThanOrEqual(0);
  });
});

describe('layout', () => {
  for (const scheme of ['auto', 'twin'] as TouchScheme[]) {
    for (const v of VIEWS) {
      describe(`${scheme} · ${v.name}`, () => {
        const hud = hudGeom(v.w, v.h, v.safe);
        const L = computeTouchLayout({ w: v.w, h: v.h }, v.safe, hud, scheme);
        const all = [...GAME_BUTTONS, ...SYSTEM_BUTTONS] as TouchButtonId[];
        const circles = [...all.map((id) => ({ id: id as string, c: L.buttons[id] })), ...(L.attack ? [{ id: 'attack', c: L.attack }] : [])];
        it('keeps every button and stick inside the safe area', () => {
          for (const { id, c } of circles) {
            expect(c.x - c.r, id).toBeGreaterThanOrEqual(v.safe.l);
            expect(c.x + c.r, id).toBeLessThanOrEqual(v.w - v.safe.r);
            expect(c.y - c.r, id).toBeGreaterThanOrEqual(v.safe.t);
            expect(c.y + c.r, id).toBeLessThanOrEqual(v.h - v.safe.b);
          }
          for (const rest of [L.leftRest, L.rightRest]) {
            expect(rest.x - L.stickR).toBeGreaterThanOrEqual(v.safe.l);
            expect(rest.x + L.stickR).toBeLessThanOrEqual(v.w - v.safe.r);
            expect(rest.y + L.stickR).toBeLessThanOrEqual(v.h - v.safe.b);
          }
          for (const c of [L.back, L.backLeft]) {
            expect(c.x - c.r).toBeGreaterThanOrEqual(v.safe.l);
            expect(c.x + c.r).toBeLessThanOrEqual(v.w - v.safe.r);
          }
        });
        it('buttons do not overlap each other, the attack button or the resting sticks', () => {
          for (let i = 0; i < circles.length; i++) {
            for (let j = i + 1; j < circles.length; j++) {
              const a = circles[i].c;
              const b = circles[j].c;
              expect(Math.hypot(a.x - b.x, a.y - b.y), `${circles[i].id}/${circles[j].id}`).toBeGreaterThan(a.r + b.r);
            }
          }
          for (const id of all) {
            const c = L.buttons[id];
            if (scheme === 'twin') expect(Math.hypot(c.x - L.rightRest.x, c.y - L.rightRest.y), id).toBeGreaterThan(c.r + L.stickR);
            expect(Math.hypot(c.x - L.leftRest.x, c.y - L.leftRest.y), id).toBeGreaterThan(c.r + L.stickR);
          }
        });
        it('system buttons stay clear of the HUD minimap', () => {
          const mm = hud.minimap;
          for (const id of SYSTEM_BUTTONS) {
            const c = L.buttons[id];
            const inside = c.x + c.r > mm.x && c.x - c.r < mm.x + mm.w && c.y + c.r > mm.y && c.y - c.r < mm.y + mm.h;
            expect(inside, id).toBe(false);
          }
        });
        it('gameplay buttons are >= 44pt and stay on the right half', () => {
          for (const id of GAME_BUTTONS) {
            expect(L.buttons[id].r * 2, id).toBeGreaterThanOrEqual(44);
            expect(L.buttons[id].x - L.buttons[id].r, id).toBeGreaterThan(L.splitX);
          }
          if (scheme === 'auto') expect(L.attack!.r * 2).toBeGreaterThanOrEqual(68);
          else expect(L.attack).toBe(null);
        });
      });
    }
  }
});

function layout(scheme: TouchScheme = 'twin'): TouchLayout {
  return computeTouchLayout({ w: 863, h: 360 }, NO_SAFE, hudGeom(863, 360), scheme);
}

describe('hit testing', () => {
  it('hits the nearest enabled button with a margin', () => {
    const L = layout();
    const d = L.buttons.dash;
    expect(hitButton(L, d.x + d.r * 1.1, d.y, () => true)).toBe('dash');
    expect(hitButton(L, d.x + d.r * 1.6, d.y, () => true)).toBe(null);
    const a = L.buttons.active;
    expect(hitButton(L, a.x, a.y, (id) => id !== 'active')).toBe(null);
  });
});

describe('TouchRouter', () => {
  it('routes the fixed move pad and right aim stick independently (multi-touch)', () => {
    const r = new TouchRouter(layout());
    const R = r.layout.stickR;
    const rest = r.layout.leftRest;
    expect(r.down(1, rest.x, rest.y)).toEqual({ kind: 'stick', side: 'left' });
    expect(r.down(2, 600, 200)).toEqual({ kind: 'stick', side: 'right' });
    r.move(1, rest.x + R, rest.y);
    const mv = r.moveVector();
    expect(mv.x).toBeCloseTo(1, 5);
    expect(mv.y).toBeCloseTo(0, 5);
    // aim not engaged until the threshold
    r.move(2, 600, 200 - R * AIM_ENGAGE * 0.5);
    expect(r.aimVector()).toBe(null);
    r.move(2, 600, 200 - R);
    expect(r.aimVector()!.y).toBeCloseTo(-1, 5);
    // returning to the center keeps firing the last direction
    r.move(2, 600, 200);
    expect(r.aimVector()!.y).toBeCloseTo(-1, 5);
    // a third finger in an occupied half is ignored
    expect(r.down(3, 140, 260).kind).toBe('ignored');
    r.up(1);
    expect(r.moveVector()).toEqual({ x: 0, y: 0 });
    r.up(2);
    expect(r.aimVector()).toBe(null);
    r.up(3);
    expect(r.owners.size).toBe(0);
  });
  it('keeps the movement base fixed through overshoot, reversal, release and re-press', () => {
    for (const scheme of ['auto', 'twin'] as const) {
      const r = new TouchRouter(layout(scheme)), R = r.layout.stickR, rest = r.layout.leftRest;
      r.down(1, rest.x, rest.y);
      for (const offset of [{ x: 3, y: 0 }, { x: 0, y: -4 }, { x: -3, y: 0 }, { x: 0, y: 0 }]) {
        r.move(1, rest.x + R * offset.x, rest.y + R * offset.y);
        expect(r.left!.base).toEqual(rest);
        const knob = knobPosition(r.left!.base, r.left!.finger, R);
        expect(Math.hypot(knob.x - rest.x, knob.y - rest.y)).toBeLessThanOrEqual(R + 1e-8);
      }
      expect(r.moveVector()).toEqual({ x: 0, y: 0 });
      r.up(1); r.down(2, rest.x - R * .9, rest.y);
      expect(r.left!.base).toEqual(rest); expect(r.moveVector().x).toBe(-1);
      r.up(2); expect(r.moveVector()).toEqual({ x: 0, y: 0 });
      expect(r.down(3, rest.x + R * 2, rest.y).kind).toBe('ignored');
      r.move(3, rest.x, rest.y); expect(r.moveVector()).toEqual({ x: 0, y: 0 });
    }
  });
  it('retains the existing floating right aim stick', () => {
    const r = new TouchRouter(layout()), R = r.layout.stickR;
    r.down(1, 600, 200); r.move(1, 600 + R * 3, 200);
    expect(r.right!.base.x).toBeCloseTo(600 + R * 2, 5);
    r.move(1, 600 + R, 200); expect(r.aimVector()!.x).toBeLessThan(0);
  });
  it('buttons take priority and report held state', () => {
    const r = new TouchRouter(layout());
    const d = r.layout.buttons.dash;
    expect(r.down(5, d.x, d.y)).toEqual({ kind: 'button', id: 'dash' });
    expect(r.heldButtons().has('dash')).toBe(true);
    // a disabled button lets the touch fall through to the aim stick
    const p = r.layout.buttons.consumable;
    expect(r.down(6, p.x, p.y, (id) => id !== 'consumable')).toEqual({ kind: 'stick', side: 'right' });
    expect(r.up(5)).toEqual({ kind: 'button', id: 'dash' });
    expect(r.heldButtons().size).toBe(0);
  });
  it('reset forgets sticks and ignores fingers still down', () => {
    const r = new TouchRouter(layout());
    r.down(1, r.layout.leftRest.x, r.layout.leftRest.y);
    r.move(1, 160, 250);
    r.reset();
    expect(r.moveVector()).toEqual({ x: 0, y: 0 });
    r.move(1, 200, 250);
    expect(r.moveVector()).toEqual({ x: 0, y: 0 });
    expect(r.up(1)).toEqual({ kind: 'ignored' });
  });
});

describe('TouchRouter · auto-aim attack button', () => {
  it('holding the attack button attacks; dragging past the dead zone aims manually', () => {
    const r = new TouchRouter(layout('auto'));
    const A = r.layout.attack!;
    expect(r.down(1, A.x + 3, A.y - 2)).toEqual({ kind: 'attack' });
    expect(r.attackHeld()).toBe(true);
    expect(r.manualAim()).toBe(null); // auto-aim
    // small wobble stays auto
    r.move(1, A.x + 3 + A.r * MANUAL_ENGAGE * 0.6, A.y - 2);
    expect(r.manualAim()).toBe(null);
    // drag up past the dead zone: manual aim up
    r.move(1, A.x + 3, A.y - 2 - A.r * 0.9);
    expect(r.manualAim()!.y).toBeCloseTo(-1, 5);
    // hysteresis: slightly back toward the center keeps manual ...
    r.move(1, A.x + 3, A.y - 2 - A.r * (MANUAL_RELEASE + 0.05));
    expect(r.manualAim()).not.toBe(null);
    // ... returning to the touch point goes back to auto
    r.move(1, A.x + 3, A.y - 2);
    expect(r.manualAim()).toBe(null);
    expect(r.attackHeld()).toBe(true);
    expect(r.up(1)).toEqual({ kind: 'attack' });
    expect(r.attackHeld()).toBe(false);
  });
  it('anywhere on the right half (off the buttons) also attacks; left half moves; buttons win', () => {
    const L = layout('auto');
    const r = new TouchRouter(L);
    expect(r.down(1, L.splitX + 20, 60)).toEqual({ kind: 'attack' });
    expect(r.attack!.onButton).toBe(false);
    expect(r.down(2, L.leftRest.x, L.leftRest.y)).toEqual({ kind: 'stick', side: 'left' });
    // a second attack finger is ignored
    expect(r.down(3, L.attack!.x, L.attack!.y).kind).toBe('ignored');
    const d = L.buttons.dash;
    expect(r.down(4, d.x, d.y)).toEqual({ kind: 'button', id: 'dash' });
    r.reset();
    expect(r.attackHeld()).toBe(false);
    expect(r.up(1)).toEqual({ kind: 'ignored' });
  });
  it('a disabled button under the finger falls through to the attack', () => {
    const L = layout('auto');
    const r = new TouchRouter(L);
    const p = L.buttons.consumable;
    expect(r.down(1, p.x, p.y, (id) => id !== 'consumable')).toEqual({ kind: 'attack' });
  });
  it('scheme setting parsing', () => {
    expect(touchScheme(undefined)).toBe('auto');
    expect(touchScheme('twin')).toBe('twin');
    expect(touchScheme('bogus')).toBe('auto');
  });
});

describe('auto-aim target selection', () => {
  const O = { x: 0, y: 0 };
  const c = (id: number, x: number, y: number, visible = true, weight?: number): TargetCandidate => ({ id, x, y, visible, weight });
  it('picks the nearest visible enemy', () => {
    const t = pickTarget(O, null, [c(1, 120, 0), c(2, 60, 40), c(3, -200, 0)], null);
    expect(t!.id).toBe(2);
  });
  it('ignores nothing-in-range and returns null for no candidates', () => {
    expect(pickTarget(O, null, [], null)).toBe(null);
    expect(pickTarget(O, null, [c(1, TARGET_DEFAULTS.maxDist + 50, 0)], null)).toBe(null);
  });
  it('prefers targets roughly in the facing / move direction', () => {
    const cands = [c(1, -80, 0), c(2, 110, 10)];
    expect(pickTarget(O, null, cands, null)!.id).toBe(1); // pure nearest
    expect(pickTarget(O, { x: 1, y: 0 }, cands, null)!.id).toBe(2); // moving right
    // ... but a much closer enemy behind still wins
    expect(pickTarget(O, { x: 1, y: 0 }, [c(1, -30, 0), c(2, 200, 0)], null)!.id).toBe(1);
  });
  it('prefers line of sight; falls back to hidden-behind-rocks targets', () => {
    expect(pickTarget(O, null, [c(1, 50, 0, false), c(2, 90, 0, true)], null)!.id).toBe(2);
    expect(pickTarget(O, null, [c(1, 50, 0, false)], null)!.id).toBe(1);
  });
  it('is sticky: the current target is kept until another is clearly better (no flicker)', () => {
    // two enemies at almost the same distance, swapping order every frame
    let prev: number | null = null;
    const picks: number[] = [];
    for (let f = 0; f < 20; f++) {
      const wob = f % 2 ? 3 : -3;
      const t: TargetCandidate = pickTarget(O, null, [c(1, 100 + wob, 0), c(2, 0, 100 - wob)], prev)!;
      prev = t.id;
      picks.push(t.id);
    }
    expect(new Set(picks).size).toBe(1);
    // a clearly closer enemy takes over
    expect(pickTarget(O, null, [c(1, 100, 0), c(2, 0, 50)], 1)!.id).toBe(2);
    // the current target is kept a bit past the normal range
    expect(pickTarget(O, null, [c(1, TARGET_DEFAULTS.maxDist * 1.05, 0)], 1)!.id).toBe(1);
  });
  it('weights (e.g. charmed enemies) lower the priority', () => {
    expect(pickTarget(O, null, [c(1, 50, 0, true, 2), c(2, 80, 0)], null)!.id).toBe(2);
  });
});

describe('TapTracker', () => {
  it('distinguishes taps from drags', () => {
    const t = new TapTracker(100, 100);
    expect(t.move(100 + TAP_SLOP * 0.5, 100)).toBe(0);
    expect(t.isTap()).toBe(true);
    const d = new TapTracker(100, 100);
    d.move(100, 100 - TAP_SLOP - 1);
    expect(d.isTap()).toBe(false);
  });
  it('turns vertical drags into wheel steps (finger up = scroll down)', () => {
    const t = new TapTracker(0, 300);
    let steps = 0;
    for (let y = 300; y >= 300 - SCROLL_STEP * 3 - TAP_SLOP; y -= 4) steps += t.move(0, y);
    expect(steps).toBeGreaterThanOrEqual(2);
    let back = 0;
    for (let y = 300 - SCROLL_STEP * 3; y <= 300; y += 4) back += t.move(0, y);
    expect(back).toBeLessThan(0);
  });
});

describe('visibility & quality', () => {
  it('auto shows only while touch is the last device', () => {
    expect(touchVisible('auto', 'touch')).toBe(true);
    expect(touchVisible('auto', 'keyboard')).toBe(false);
    expect(touchVisible('auto', 'mouse')).toBe(false);
    expect(touchVisible('on', 'keyboard')).toBe(true);
    expect(touchVisible('off', 'touch')).toBe(false);
  });
  it('quality presets lower resolution and particles', () => {
    expect(qualityProfile('low').dprCap).toBe(1);
    expect(qualityProfile('low').particleMult).toBeLessThan(qualityProfile('medium').particleMult);
    expect(qualityProfile('high').dprCap).toBeGreaterThan(qualityProfile('medium').dprCap);
    expect(qualityProfile('bogus')).toEqual(qualityProfile('high'));
  });
});

describe('Input touch API', () => {
  it('virtual buttons get pressed / held / released edges', () => {
    const inp = new Input();
    inp.touchPress('dash');
    inp.update();
    expect(inp.pressed('dash')).toBe(true);
    inp.update();
    expect(inp.pressed('dash')).toBe(false);
    expect(inp.held('dash')).toBe(true);
    inp.touchRelease('dash');
    inp.update();
    expect(inp.released('dash')).toBe(true);
  });
  it('a press and release between two steps is not lost', () => {
    const inp = new Input();
    inp.touchPress('bomb');
    inp.touchRelease('bomb');
    inp.update();
    expect(inp.pressed('bomb')).toBe(true);
    inp.update();
    expect(inp.held('bomb')).toBe(false);
    inp.touchTap('cancel');
    inp.update();
    expect(inp.pressed('cancel')).toBe(true);
    inp.update();
    expect(inp.released('cancel')).toBe(true);
  });
  it('sticks feed moveVector and the right-stick aim path', () => {
    const inp = new Input();
    inp.touchMove.x = 0.6;
    inp.touchMove.y = -0.3;
    expect(inp.moveVector()).toEqual({ x: 0.6, y: -0.3 });
    expect(inp.padAimVector()).toBe(null);
    inp.touchAim = { x: 0, y: 2 };
    expect(inp.padAimVector()).toEqual({ x: 0, y: 1 });
    // keyboard movement still wins over the stick
    inp.simulateDown('KeyA');
    inp.update();
    expect(inp.moveVector()).toEqual({ x: -1, y: 0 });
    inp.releaseAll();
    inp.update();
    expect(inp.touchAim).toBe(null);
    expect(inp.moveVector()).toEqual({ x: 0, y: 0 });
  });
  it('menu taps act as a one-step left click at the tapped point', () => {
    const inp = new Input();
    inp.tapMouse(120, 80);
    expect([inp.mouseX, inp.mouseY, inp.mouseMoved]).toEqual([120, 80, true]);
    inp.update();
    expect(inp.pressed('fire')).toBe(true);
    inp.update();
    expect(inp.held('fire')).toBe(false);
    inp.addWheel(2);
    inp.update();
    expect(inp.wheel).toBe(2);
  });
  it('text capture still lets touch confirm / cancel through', () => {
    const inp = new Input();
    inp.textCapture = true;
    inp.touchTap('confirm');
    inp.touchTap('dash');
    inp.update();
    expect(inp.pressed('confirm')).toBe(true);
    expect(inp.pressed('dash')).toBe(false);
  });
});
