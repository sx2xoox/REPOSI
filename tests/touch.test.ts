import { describe, expect, it } from 'vitest';
import {
  AIM_ENGAGE, GAME_BUTTONS, MOVE_DEAD_ZONE, MOVE_FULL_AT, SCROLL_STEP, SYSTEM_BUTTONS, TAP_SLOP,
  TapTracker, TouchRouter, computeTouchLayout, followBase, hitButton, knobPosition, qualityProfile, stickVector, touchVisible,
  type Insets, type TouchButtonId, type TouchLayout,
} from '../src/ui/touch-logic';
import { Input } from '../src/engine/input';

const NO_SAFE: Insets = { l: 0, r: 0, t: 0, b: 0 };

/** 16:9 game rect letterboxed into a viewport (what the renderer does). */
function gameRect(w: number, h: number) {
  const s = Math.min(w / 384, h / 216);
  const gw = 384 * s;
  const gh = 216 * s;
  return { x: (w - gw) / 2, y: (h - gh) / 2, w: gw, h: gh };
}

const VIEWS: { name: string; w: number; h: number; safe: Insets }[] = [
  { name: 'pixel 7', w: 863, h: 360, safe: NO_SAFE },
  { name: 'iphone 14 (notch)', w: 844, h: 390, safe: { l: 47, r: 47, t: 0, b: 21 } },
  { name: 'iphone se (16:9)', w: 667, h: 375, safe: NO_SAFE },
  { name: 'ipad', w: 1194, h: 834, safe: { l: 0, r: 0, t: 0, b: 20 } },
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

describe('layout', () => {
  for (const v of VIEWS) {
    describe(v.name, () => {
      const game = gameRect(v.w, v.h);
      const L = computeTouchLayout({ w: v.w, h: v.h }, v.safe, game);
      const all = [...GAME_BUTTONS, ...SYSTEM_BUTTONS] as TouchButtonId[];
      it('keeps every button and stick inside the safe area', () => {
        for (const id of all) {
          const c = L.buttons[id];
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
      it('buttons do not overlap each other or the resting aim stick', () => {
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            const a = L.buttons[all[i]];
            const b = L.buttons[all[j]];
            expect(Math.hypot(a.x - b.x, a.y - b.y), `${all[i]}/${all[j]}`).toBeGreaterThan(a.r + b.r);
          }
          const c = L.buttons[all[i]];
          expect(Math.hypot(c.x - L.rightRest.x, c.y - L.rightRest.y), all[i]).toBeGreaterThan(c.r + L.stickR);
        }
      });
      it('system buttons stay clear of the HUD minimap', () => {
        const s = game.w / 768;
        const mm = { x: game.x + 636 * s, y: game.y + 8 * s, w: 124 * s, h: 120 * s }; // map + floor name lines
        for (const id of SYSTEM_BUTTONS) {
          const c = L.buttons[id];
          const inside = c.x + c.r > mm.x && c.x - c.r < mm.x + mm.w && c.y + c.r > mm.y && c.y - c.r < mm.y + mm.h;
          expect(inside, id).toBe(false);
        }
      });
      it('buttons are big enough to hit with a thumb', () => {
        expect(L.buttons.dash.r * 2).toBeGreaterThanOrEqual(44);
        for (const id of all) expect(L.buttons[id].r * 2 * 1.25, id).toBeGreaterThanOrEqual(34);
      });
    });
  }
});

function layout(): TouchLayout {
  return computeTouchLayout({ w: 863, h: 360 }, NO_SAFE, gameRect(863, 360));
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
  it('routes left / right halves to the move and aim sticks (multi-touch)', () => {
    const r = new TouchRouter(layout());
    const R = r.layout.stickR;
    expect(r.down(1, 120, 250)).toEqual({ kind: 'stick', side: 'left' });
    expect(r.down(2, 600, 200)).toEqual({ kind: 'stick', side: 'right' });
    r.move(1, 120 + R, 250);
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
  it('floating base follows a finger that overshoots', () => {
    const r = new TouchRouter(layout());
    const R = r.layout.stickR;
    r.down(1, 100, 250);
    r.move(1, 100 + R * 3, 250);
    expect(r.left!.base.x).toBeCloseTo(100 + R * 2, 5);
    // reversing direction responds immediately
    r.move(1, 100 + R * 2 - R, 250);
    expect(r.moveVector().x).toBeLessThan(0);
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
    r.down(1, 100, 250);
    r.move(1, 160, 250);
    r.reset();
    expect(r.moveVector()).toEqual({ x: 0, y: 0 });
    r.move(1, 200, 250);
    expect(r.moveVector()).toEqual({ x: 0, y: 0 });
    expect(r.up(1)).toEqual({ kind: 'ignored' });
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
