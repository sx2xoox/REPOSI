// Floor 3 — 잿불 대장간 (ember forge), the works floor:
//  - 용접 자동인형 (welding automaton): a squat iron automaton that walks into working
//    range, aims its torch, then holds a short welding beam that keeps turning toward
//    you at a limited rate (circle it to outpace the arc). Overheats and vents steam.
//  - 화약통 일꾼 (powder-keg porter): a soot imp that lobs powder kegs near you. A landed
//    keg is a timed bomb that blows along a plus-shaped cross; shoot it to defuse it.

import { defineEnemy } from '../../game/defs';
import { Actor, Entity, type HitInfo } from '../../game/entity';
import { PixelPainter, ramp } from '../../engine/painter';
import { defineDrawnSprite } from '../../engine/sprites';
import { RingFx, type GroundWarning } from '../../game/effects';
import { fx } from '../../engine/rng';
import { clamp, rotateToward } from '../../engine/math';
import type { Enemy } from '../../game/enemy';
import type { World } from '../../game/world';
import type { Renderer } from '../../engine/renderer';
import { Beam } from '../bosses/final-kit';
import { dust, frames, gather, hurtFrame, landingSpot, laneWarning, lob, rayFree, volleyTargets } from './shared';

// ------------------------------------------------------------------ forge palette (matches forge.ts)
const IRON = ramp('#55505e', 5);
const MAGMA = { hot: '#fff0a0', mid: '#ffa424', low: '#e0480c' };
const SOOT = ['#4a3a34', '#2a2024', '#6a5a50'];
const STEAM = ['#f4f0ec', '#c8c0c0', '#8a8288'];
/** Welding arc: white-hot core, electric blue body, orange heat halo. */
const ARC = { core: '#ffffff', blue: '#7ad0ff', heat: '#ff8a2a' };

// ================================================================== 용접 자동인형 (welding automaton)
const WELD_NAME = '용접 자동인형';
/** working distance band and beam reach (px) */
const WELD_NEAR = 56;
const WELD_FAR = 92;
const WELD_LEN = 96;
/** torch arm length from the shoulder joint to the nozzle tip */
const TORCH = 9;

type WeldMode = 'walk' | 'aim' | 'weld' | 'vent' | 'hurt';

// hand-placed pixels: iron boiler body, welding hood with a visor slot, brass gas tank
const WELD_IRON: Record<string, string> = {
  a: '#1e1a26', b: '#33303e', c: '#4c4858', d: '#6a6578', e: '#8e889c', k: '#c4bcd0',
  m: '#1c1822', M: '#2e2a36', N: '#4a4452',
  B: '#6a4416', y: '#a8742a', Y: '#e0b45a', r: '#d8b070',
};
const WELD_BODY = [
  '......NNNNN.....',
  '.....NNMMMMM....',
  '..YB.NMMMMMMm...',
  '.yYBNMMMvvvvvm..',
  '.yYBNMMMvVVWvm..',
  '.yyBmMMMvvvvvm..',
  '.yyBmmMMMMMMm...',
  '.yBbddeeddddcb..',
  '.yBdekkeddddcbYy',
  '.BBdeedddrddcbyB',
  '..bddddcfFHfcb..',
  '..bcdddcfffffb..',
  '..abcccccccccba.',
  '...abbbbbbbbba..',
];
// visor raised (venting): the hood tips back and shows two furnace eyes
const WELD_HOOD_UP = [
  '.....NNNNN......',
  '....NMMMMMMm....',
  '..YBmMMMMMMMm...',
  '.yYBNmmmmmmmm...',
  '.yYBNsoMsoMMm...',
  '.yyBmMMMMMMMm...',
  '.yyBmmMMMMMMm...',
];
const WELD_LEGS = ['...cdc....cdc...', '...bcb....bcb...', '..abccb..abcccb.'];

function weldPalette(mode: WeldMode, k: number): Record<string, string> {
  const v = { v: '#10203a', V: '#2e5a8a', W: '#6aa8e0' };
  const f = { f: '#3a140c', F: '#7a2a10', H: '#c04010' };
  if (mode === 'aim') {
    Object.assign(v, { v: '#1a3a6a', V: k ? '#9ad8ff' : '#5ab8ff', W: '#ffffff' });
    Object.assign(f, { F: '#c04010', H: '#ff8a20' });
  } else if (mode === 'weld') {
    Object.assign(v, { v: '#7ad0ff', V: '#ffffff', W: '#ffffff' });
    Object.assign(f, { F: '#ff8a20', H: '#fff0a0' });
  } else if (mode === 'vent') {
    Object.assign(f, { f: '#c04010', F: k ? '#fff0a0' : '#ffa424', H: '#ffffff' });
  } else if (mode === 'hurt') {
    Object.assign(v, { V: '#3a4a6a', W: '#ffffff' });
  }
  return { ...WELD_IRON, ...v, ...f, s: '#120a0a', o: k ? '#ff8a20' : '#ffa424' };
}

function paintWelder(p: PixelPainter, k: number, mode: WeldMode): void {
  const walk = mode === 'walk';
  const bob = walk ? [0, -1, 0, -1][k] : mode === 'hurt' ? 0 : 1;
  const pal = weldPalette(mode, k);
  // stubby piston legs (a wide stance while bracing)
  const step = walk ? [1, 0, -1, 0][k] : 0;
  const spread = mode === 'aim' || mode === 'weld' ? 1 : 0;
  const legs = WELD_LEGS;
  p.stamp(step - spread, 14, [legs[0].slice(0, 8)], pal);
  p.stamp(step - spread, 15, [legs[1].slice(0, 8), legs[2].slice(0, 8)], pal);
  p.stamp(8 - step + spread, 14 + (walk && k === 1 ? -1 : 0), [legs[0].slice(8), legs[1].slice(8), legs[2].slice(8)], pal);
  // body (the weld shudders it sideways)
  const bx = mode === 'weld' ? (k ? 1 : 0) : mode === 'hurt' ? -1 : 0;
  const by = 1 + bob;
  p.stamp(bx, by, WELD_BODY, pal);
  if (mode === 'vent') {
    for (let y = 0; y < 7; y++) for (let x = 4; x < 14; x++) p.px(bx + x, by + y, null);
    p.stamp(bx, by - 1, WELD_HOOD_UP, pal);
  }
  if (mode === 'hurt') {
    // cracked visor, knocked hood
    p.px(bx + 10, by + 3, '#ffffff');
    p.px(bx + 11, by + 5, '#ffffff');
    p.px(bx + 6, by, null);
  }
}
frames('weldbot', 'walk', 4, 17, 18, (p, i) => paintWelder(p, i, 'walk'), { anchor: 'bottom', fps: 6 });
frames('weldbot', 'aim', 2, 17, 18, (p, i) => paintWelder(p, i, 'aim'), { anchor: 'bottom', fps: 12 });
frames('weldbot', 'weld', 2, 17, 18, (p, i) => paintWelder(p, i, 'weld'), { anchor: 'bottom', fps: 20 });
frames('weldbot', 'vent', 2, 17, 18, (p, i) => paintWelder(p, i, 'vent'), { anchor: 'bottom', fps: 5 });
frames('weldbot', 'hurt', 1, 17, 18, (p) => paintWelder(p, 0, 'hurt'), { anchor: 'bottom' });

const TORCH_ROWS = [
  '..yY.......',
  'cdddcYYyy..',
  'bcccbyyyBBt',
  'abbbaBBB...',
];
defineDrawnSprite('weldbot_torch', 11, 4, (p) => p.stamp(0, 0, TORCH_ROWS, { ...WELD_IRON, t: '#2a1a10' }), { outline: '#0c0810', origin: [1, 2] });
defineDrawnSprite('weldbot_torch_hot', 11, 4, (p) => {
  p.stamp(0, 0, TORCH_ROWS, { ...WELD_IRON, t: '#ffffff' });
  p.px(9, 2, ARC.blue);
  p.px(10, 1, ARC.blue);
  p.px(10, 3, ARC.blue);
}, { outline: '#0c0810', origin: [1, 2] });

/** World position of the welder's shoulder joint (the torch pivot), for a given facing. */
function shoulder(e: Enemy, facing = e.facing): { x: number; y: number } {
  // the joint sits 6.5 px in front of and 8 px above the sprite's feet (elites are drawn larger)
  return { x: e.x + facing * 6.5 * e.scale, y: e.y + 5 - 8 * e.scale - e.z };
}

/** Facing that keeps the torch on the open side of the body. */
function torchFacing(a: number): number {
  return Math.cos(a) >= 0 ? 1 : -1;
}

/**
 * The welding beam: a Beam whose origin stays glued to the torch nozzle. It tracks
 * quickly while aiming, holds still while locked, then — firing — keeps turning toward
 * the target at a limited angular speed, so circling the welder outpaces the arc.
 * The beam stops if the welder dies or is frozen / stunned / scared.
 */
export class WeldBeam extends Beam {
  owner: Enemy;
  /** max turn rate while firing (rad/s) */
  turn: number;
  constructor(e: Enemy, angle: number, fire: number, turn: number) {
    super(e.x, e.y, angle, {
      aim: 0.6, lock: 0.25, fire, width: 5, color: ARC.blue, core: ARC.core, damage: 1, source: WELD_NAME,
      length: WELD_LEN, rehit: 0.6,
      follow: (b, w) => (b as WeldBeam).steer(w),
    });
    this.owner = e;
    this.turn = turn;
    this.place();
  }

  /** Put the origin on the nozzle tip for the current angle. */
  private place(): void {
    const s = shoulder(this.owner, torchFacing(this.angle));
    this.x = s.x + Math.cos(this.angle) * TORCH;
    this.y = s.y + Math.sin(this.angle) * TORCH;
  }

  steer(w: World): void {
    const e = this.owner;
    const st = this.state;
    const t = e.target(w);
    const s = shoulder(e, torchFacing(this.angle));
    const want = Math.atan2(t.y - 2 - s.y, t.x - s.x);
    if (st === 'aim') this.angle = rotateToward(this.angle, want, 6 * w.dt);
    else if (st === 'fire') this.angle = rotateToward(this.angle, want, this.turn * w.dt);
    e.mem.aim = this.angle;
    this.place();
    // the arc stops at rocks and walls
    this.o.length = Math.max(6, rayFree(w.room, this.x, this.y + 3, this.angle, 2, WELD_LEN, true, 2));
  }

  /** Is the welder still able to hold the torch? */
  private ownerReady(): boolean {
    const e = this.owner;
    return e.alive && !e.hasStatus('freeze') && !e.hasStatus('stun') && !e.hasStatus('fear');
  }

  override update(w: World, dt: number): void {
    if (!this.ownerReady()) {
      this.dead = true;
      return;
    }
    super.update(w, dt);
    const st = this.state;
    if (st === 'aim' && fx.chance(0.35)) {
      w.particles.spawn({ x: this.x, y: this.y, vx: fx.range(-30, 30), vy: -fx.range(10, 50), life: fx.range(0.12, 0.25), colors: ['#ffffff', ARC.blue], size: 1, gravity: 0, shape: 'spark' });
    }
    if (st === 'fire') {
      const ex = this.x + Math.cos(this.angle) * this.len;
      const ey = this.y + Math.sin(this.angle) * this.len;
      if (fx.chance(0.9)) {
        w.particles.burst(ex, ey, { count: 2, speed: [40, 120], life: [0.12, 0.3], colors: ['#ffffff', MAGMA.hot, ARC.heat], size: [1, 1], shape: 'spark', gravity: 260, vz: [20, 70], additive: true });
      }
      if (fx.chance(0.25)) {
        w.particles.spawn({ x: ex + fx.range(-2, 2), y: ey + fx.range(-2, 2), vy: -fx.range(6, 14), life: fx.range(0.4, 0.8), colors: STEAM, size: 2, sizeEnd: 4, alpha: 0.35 });
      }
    }
  }

  override draw(r: Renderer): void {
    const st = this.state;
    if (st === 'aim' || st === 'lock') {
      super.draw(r);
      return;
    }
    const o = this.o;
    const k = st === 'fade' ? Math.max(0, 1 - (this.age - o.aim - o.lock - o.fire) / 0.18) : 1;
    if (k <= 0) return;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const x1 = this.x + c * this.len;
    const y1 = this.y + s * this.len;
    const fl = Math.floor(this.age * 30) % 3;
    // heat halo, electric arc body, white-hot core
    r.pixelLine(this.x, this.y, x1, y1, ARC.heat, Math.max(1, Math.round(7 * k)), 0.22 + fl * 0.05);
    r.pixelLine(this.x, this.y, x1, y1, ARC.blue, Math.max(1, Math.round((fl === 1 ? 4 : 3) * k)), 0.9);
    r.pixelLine(this.x, this.y, x1, y1, ARC.core, 1, k);
    // jagged arc flicker riding the beam
    const nx = -s;
    const ny = c;
    for (let i = 1; i < 6; i++) {
      const d = (this.len * i) / 6;
      const off = ((i + fl) % 3) - 1;
      r.rect(this.x + c * d + nx * off * 2 - 0.5, this.y + s * d + ny * off * 2 - 0.5, 1, 1, '#ffffff', 0.85 * k);
    }
    // weld puddle where it bites, flare at the nozzle
    r.pixelDisc(x1, y1, 3 + (fl === 2 ? 1 : 0), ARC.heat, 0.5 * k);
    r.pixelDisc(x1, y1, 2, MAGMA.hot, 0.9 * k);
    r.pixelDisc(x1, y1, 1, '#ffffff', k);
    r.pixelDisc(this.x, this.y, 2 + (fl === 0 ? 1 : 0), '#ffffff', 0.9 * k);
  }

  override light(w: World): void {
    const st = this.state;
    if (st === 'aim' || st === 'lock') {
      w.lights.add(this.x, this.y, 16, ARC.blue, { intensity: st === 'lock' ? 0.7 : 0.4 });
      return;
    }
    const n = Math.max(1, Math.floor(this.len / 32));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      w.lights.add(this.x + Math.cos(this.angle) * this.len * t, this.y + Math.sin(this.angle) * this.len * t, 30, '#9ad8ff', { intensity: 0.75 });
    }
    w.lights.add(this.x + Math.cos(this.angle) * this.len, this.y + Math.sin(this.angle) * this.len, 26, ARC.heat, { intensity: 0.8 });
  }
}

defineEnemy({
  id: 'welder_automaton',
  name: WELD_NAME,
  hp: 40,
  radius: 6,
  speed: 28,
  mass: 2,
  sprite: 'weldbot_walk',
  spriteYOffset: 5,
  shadow: 15,
  cost: 2,
  floors: [3],
  weight: 0.8,
  champion: true,
  deathFx: 'metal',
  bloodColor: '#ffb040',
  hurtSfx: 'hit_metal',
  light: { radius: 18, color: '#ffa040' },
  init(e, w) {
    e.mem.aim = Math.atan2(w.player.y - e.y, w.player.x - e.x);
  },
  *script(e, w) {
    yield w.rng.range(0.3, 0.9);
    let side = w.rng.sign();
    while (true) {
      e.setAnim('weldbot_walk');
      // trudge into working range, torch tracking the keeper
      const t = w.rng.range(1.3, 2.1);
      for (let el = 0; el < t; el += w.dt) {
        const d = e.distToTarget(w);
        const a = e.angleToTarget(w);
        if (d > WELD_FAR) e.chase(w, e.speed);
        else if (d < WELD_NEAR) e.moveAngle(a + Math.PI + side * 0.5, e.speed * 0.8);
        else e.moveAngle(a + (side * Math.PI) / 2, e.speed * 0.5);
        if (e.mem.__bumped && w.rng.chance(0.3)) side = -side;
        yield;
      }
      const tg = e.target(w);
      if (e.distToTarget(w) > WELD_FAR + 14 || !w.room.lineOfSight(e.x, e.y, tg.x, tg.y)) continue;
      // lower the mask, aim (thin tracking line), lock, weld
      e.halt();
      e.setAnim('weldbot_aim');
      e.telegraph(0.85);
      e.mem.welding = 1;
      w.sfx('beam_charge', { vol: 0.35, pitch: 1.7 });
      const beam = w.spawn(new WeldBeam(e, e.mem.aim, e.champion ? 1.4 : 1.0, e.champion ? 1.2 : 0.9));
      let lit = false;
      while (!beam.dead) {
        if (!lit && beam.state === 'fire') {
          lit = true;
          e.setAnim('weldbot_weld');
          w.sfx('fire', { vol: 0.5, pitch: 1.6 });
        }
        if (beam.state === 'aim' && fx.chance(0.2)) gather(w, beam.x, beam.y, ['#ffffff', ARC.blue], 1, 8);
        yield;
      }
      e.mem.welding = 0;
      // overheated: the mask flips up and it vents steam (punish window)
      e.setAnim('weldbot_vent');
      e.mem.venting = 1;
      w.sfx('clock_steam', { vol: 0.4, pitch: 0.75 });
      yield 1.6;
      e.mem.venting = 0;
    }
  },
  update(e, w, dt) {
    if (!e.mem.welding) e.mem.aim = rotateToward(e.mem.aim ?? 0, e.angleToTarget(w), (e.mem.venting ? 0.4 : 2.4) * dt);
    if (e.mem.venting && fx.chance(0.45)) {
      const vx = e.x - torchFacing(e.mem.aim) * 3;
      w.particles.spawn({ x: vx + fx.range(-1, 1), y: e.y - 12, vx: fx.range(-8, 8), vy: -fx.range(18, 34), life: fx.range(0.5, 0.9), colors: STEAM, size: 2, sizeEnd: 5, alpha: 0.55, drag: 1.5 });
    }
    if (e.mem.welding && fx.chance(0.15)) {
      w.particles.spawn({ x: e.x + fx.range(-3, 3), y: e.y - 6, vy: -fx.range(4, 10), life: fx.range(0.3, 0.6), colors: ['#8a8288', '#5a5258'], size: 1, alpha: 0.5 });
    }
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 6, { count: 14, speed: [40, 130], life: [0.2, 0.5], colors: ['#ffffff', MAGMA.hot, ARC.blue], size: [1, 2], shape: 'spark', additive: true });
    w.particles.burst(e.x, e.y - 8, { count: 8, speed: [10, 40], life: [0.6, 1.1], colors: STEAM, size: [2, 3], sizeEnd: 6, alpha: 0.5, drag: 2 });
  },
  draw(e, r, w) {
    const a = e.mem.aim ?? 0;
    const facing0 = e.facing;
    // draw-only facing (restored below: drawing never changes simulation state)
    e.facing = torchFacing(a);
    const ta = e.mem.venting ? (e.facing > 0 ? 1.15 : Math.PI - 1.15) : a;
    const s = shoulder(e);
    const behind = Math.sin(ta) < -0.35;
    const hot = !!e.mem.welding && (e.anim === 'weldbot_weld' || e.telegraphT > 0);
    const opts = {
      rot: ta, flipY: Math.cos(ta) < 0, sx: e.scale, sy: e.scale, flash: e.flash > 0 ? 1 : 0,
      tint: e.champion ? e.championColor : undefined, tintAmount: e.champion ? 0.35 : 0,
    };
    const torch = hot ? 'weldbot_torch_hot' : 'weldbot_torch';
    if (behind) r.sprite(torch, s.x, s.y, opts);
    e.drawDefault(r, hurtFrame(e, w, 'weldbot_hurt_0'));
    if (!behind) r.sprite(torch, s.x, s.y, opts);
    e.facing = facing0;
  },
});

// ================================================================== 화약통 일꾼 (powder-keg porter)
const PORTER_NAME = '화약통 일꾼';
const WOOD = ['#5a3418', '#8a5a2c', '#c08a4c'];
/** cross arm length / lane width of a keg blast, fuse time */
export const KEG_ARM = 52;
export const KEG_WIDTH = 12;
export const KEG_FUSE = 1.6;

type PorterMode = 'walk' | 'wind' | 'throw' | 'hurt';

// a soot-black imp with ember eyes, a hooped powder keg strapped to its back
const PORTER_PAL: Record<string, string> = {
  k: '#141014', s: '#2a2026', S: '#3e3038', t: '#58464e', T: '#7a6470',
  w: '#5a3418', W: '#8a5a2c', X: '#c08a4c', i: '#26242e', I: '#787686',
  g: '#9a9090', h: '#e8d8b0', H: '#a89878', E: '#ffb830', e: '#fff6c8',
  m: '#100606', n: '#f4f0e8', p: '#d03a28', P: '#ffe8c8', l: '#a07040',
  o: '#ffe070', O: '#ffffff',
};
const PORTER_WALK = [
  '...g............',
  '....g...........',
  '.XXXXW..........',
  'XWWWWWw.h....h..',
  'iIiiiiil.H..H...',
  'XWWpWWwlStTTTts.',
  'XWpPpWwStTTTTTTs',
  'XWWpWWwStTEeTEes',
  'iIiiiiiSttTTTTts',
  'XWWWWWwSStmnmnms',
  '.wwwwwsSSSsssss.',
  '...kSSSttts.....',
  '..kSSSSttTs.....',
  '.k.sSSSSSSsSt...',
  '.k..sSSsSSs.St..',
];
const PORTER_WIND = [
  '........g.o.....',
  '.......g.oO.....',
  '..XXXXXXXXXW....',
  '.XiWWWWWWWiWw...',
  '.XIWWpPpWWIWw...',
  '.XiWWWpWWWiWw...',
  '..wwwwwwwwwww...',
  '...tS.....St....',
  '...tS.h..hSt....',
  '....StTTTTTS....',
  '....tTTTTTTTs...',
  '....tTEeTEeTs...',
  '....StmnmnmSs...',
  '.....SSSSSSs....',
  '....sSSttSSs....',
];
const PORTER_THROW = [
  '................',
  '................',
  '..............Tt',
  '.............Tt.',
  '........h..hTt..',
  '.......StTTtS...',
  '......StTTTTTs..',
  '......StEeTEes..',
  '......StttTTTs..',
  '......SStmmmms..',
  '....kSSSSnmnns..',
  '...kSSSSSSSss...',
  '..k.sSSSttSs....',
  '.k..sSSSSSs.....',
  '....sSSsSSs.....',
];
const PORTER_FOLLOW = [
  '................',
  '................',
  '................',
  '................',
  '........h..h....',
  '.......StTTtS...',
  '......StTTTTTs..',
  '......StEeTEes..',
  '......StttTTTs..',
  '......SStmmmmsTt',
  '....kSSSSnmnnsTt',
  '...kSSSSSSSss.t.',
  '..k.sSSSttSs....',
  '.k..sSSSSSs.....',
  '....sSSsSSs.....',
];
const PORTER_LEGS = [
  ['....sSs..sS.....', '....sS....sS....', '...kss...kss....'],
  ['...sSs....sS....', '..sS.......sS...', '.kss.......kss..'],
  ['....sSs..sS.....', '....sS....sS....', '...kss...kss....'],
  ['.....sSsSs......', '.....sSsS.......', '....ksskss......'],
];
const KEG_ROWS = [
  '....g...',
  '...g....',
  '.XXXXW..',
  'XWWWWWw.',
  'iIiiiii.',
  'XWWpWWw.',
  'XWpPpWw.',
  'XWWpWWw.',
  'iIiiiii.',
  'XWWWWWw.',
  '.wwwww..',
];

function paintPorter(p: PixelPainter, k: number, mode: PorterMode): void {
  const walk = mode === 'walk';
  const bob = walk ? [0, -1, 0, -1][k] : 0;
  const pal = mode === 'wind' && k ? { ...PORTER_PAL, o: '#ffffff', O: '#ffe070' } : PORTER_PAL;
  p.stamp(0, 15, PORTER_LEGS[walk ? k : mode === 'throw' ? 1 : 0], pal);
  if (mode === 'wind') {
    p.stamp(0, 0, PORTER_WIND, pal);
    return;
  }
  if (mode === 'throw') {
    // release (arm flung high), then the follow-through
    p.stamp(0, 0, k ? PORTER_FOLLOW : PORTER_THROW, pal);
    return;
  }
  p.stamp(0, 1 + bob, PORTER_WALK, pal);
  if (mode === 'hurt') {
    // eyes squeezed shut, mouth clenched, knocked back a pixel
    const y = 1 + bob;
    for (const x of [10, 11, 13, 14]) p.px(x, y + 7, PORTER_PAL.T);
    p.px(10, y + 7, PORTER_PAL.E);
    p.px(11, y + 6, PORTER_PAL.E);
    p.px(14, y + 7, PORTER_PAL.E);
    p.px(13, y + 6, PORTER_PAL.E);
    p.rect(10, y + 9, 5, 1, PORTER_PAL.m);
  }
}
frames('kegimp', 'walk', 4, 16, 18, (p, i) => paintPorter(p, i, 'walk'), { anchor: 'bottom', fps: 10 });
frames('kegimp', 'wind', 2, 16, 18, (p, i) => paintPorter(p, i, 'wind'), { anchor: 'bottom', fps: 12 });
frames('kegimp', 'throw', 2, 16, 18, (p, i) => paintPorter(p, i, 'throw'), { anchor: 'bottom', fps: 6, loop: false });
frames('kegimp', 'hurt', 1, 16, 18, (p) => paintPorter(p, 0, 'hurt'), { anchor: 'bottom' });

// the keg itself (lobbed + standing bomb), and the fizzled dud
defineDrawnSprite('kegimp_keg', 8, 11, (p) => p.stamp(0, 0, KEG_ROWS, PORTER_PAL), { outline: '#0c0810', anchor: 'bottom' });
defineDrawnSprite('kegimp_dud', 8, 11, (p) => {
  p.stamp(0, 2, KEG_ROWS.slice(2), { ...PORTER_PAL, w: '#2e241e', W: '#4a3a30', X: '#64524a', p: '#5a2a24', P: '#8a7a70' });
  p.px(3, 1, '#3a3434');
}, { outline: '#0c0810', anchor: 'bottom' });

/** Axis directions of the keg's cross: right, down, left, up. */
const CROSS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/** Is (px, py) with radius `pr` inside a keg cross at (x, y) whose arms are `arms` long? Returns the lane index or -1. */
export function inKegCross(x: number, y: number, arms: number[], px: number, py: number, pr: number, halfW = KEG_WIDTH / 2): number {
  const dx = px - x;
  const dy = py - y;
  const m = pr * 0.5;
  const h = Math.abs(dy) < halfW + m && dx > -arms[2] - m && dx < arms[0] + m;
  const v = Math.abs(dx) < halfW + m && dy > -arms[3] - m && dy < arms[1] + m;
  if (h && (!v || Math.abs(dx) >= Math.abs(dy))) return dx >= 0 ? 0 : 2;
  if (v) return dy >= 0 ? 1 : 3;
  return -1;
}

/** The flash of a keg going off: flame racing out along the cross (purely visual). */
class KegBlastFx extends Entity {
  static override readonly cosmetic = true;
  arms: number[];
  static readonly LIFE = 0.34;
  constructor(x: number, y: number, arms: number[]) {
    super();
    this.x = x;
    this.y = y;
    this.arms = arms;
    this.layer = 2;
    this.tileCollide = false;
  }

  override update(_w: World, dt: number): void {
    this.age += dt;
    if (this.age >= KegBlastFx.LIFE) this.dead = true;
  }

  override draw(r: Renderer): void {
    const t = clamp(this.age / KegBlastFx.LIFE, 0, 1);
    const f = 1 - t;
    const reach = clamp(this.age / 0.07, 0, 1);
    const { x, y } = this;
    const cy = y - 2;
    const lane = (i: number, h: number, color: string, alpha: number) => {
      const L = this.arms[i] * reach;
      if (L <= 0 || h <= 0) return;
      if (i === 0) r.rect(x, cy - h / 2, L, h, color, alpha);
      else if (i === 2) r.rect(x - L, cy - h / 2, L, h, color, alpha);
      else if (i === 1) r.rect(x - h / 2, cy, h, L, color, alpha);
      else r.rect(x - h / 2, cy - L, h, L, color, alpha);
    };
    const wid = KEG_WIDTH * (1 - t * 0.7);
    for (let i = 0; i < 4; i++) {
      lane(i, Math.round(wid), MAGMA.low, 0.5 * f);
      lane(i, Math.round(wid * 0.6), MAGMA.mid, 0.75 * f);
      lane(i, Math.max(1, Math.round(wid * 0.25)), '#ffffff', 0.9 * f);
      // rolling fireballs along the lane
      const c = Math.cos(CROSS[i]);
      const sn = Math.sin(CROSS[i]);
      for (let d = 8; d <= this.arms[i] * reach; d += 10) {
        const k = 1 - d / (KEG_ARM + 10);
        r.pixelDisc(x + c * d, cy + sn * d, (2 + 4 * k) * f + 1, MAGMA.hot, 0.8 * f);
      }
    }
    r.pixelDisc(x, cy, 9 * f + 2, MAGMA.mid, 0.6 * f);
    r.pixelDisc(x, cy, 6 * f + 1, '#ffffff', 0.9 * f);
  }

  override light(w: World): void {
    const f = 1 - clamp(this.age / KegBlastFx.LIFE, 0, 1);
    w.lights.add(this.x, this.y, 70 * f + 10, '#ffa040', { intensity: 0.95 * f });
    for (let i = 0; i < 4; i++) {
      const L = this.arms[i];
      w.lights.add(this.x + Math.cos(CROSS[i]) * L * 0.7, this.y + Math.sin(CROSS[i]) * L * 0.7, 30 * f + 6, '#ff8030', { intensity: 0.7 * f });
    }
  }
}

/**
 * A landed powder keg: a timed bomb. Its fuse burns for `KEG_FUSE` s while four lane
 * warnings fill outward, then it blows along the cross (half-heart, knock along the
 * lane). Any keeper attack that touches it (shots, swings, blasts) defuses it.
 * Kegs keep burning after their porter dies.
 */
export class PowderKeg extends Actor {
  owner: number;
  fuse: number;
  arms: number[];
  state: 'fuse' | 'dud' | 'boom' = 'fuse';
  endAt = 0;
  warnings: GroundWarning[] = [];

  constructor(x: number, y: number, owner: number, arms: number[], fuse = KEG_FUSE) {
    super();
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.arms = arms;
    this.fuse = fuse;
    this.r = 7;
    this.team = 'neutral';
    this.maxHp = this.hp = 1e6;
    this.solid = false;
    this.tileCollide = false;
    this.mass = Infinity;
    this.enemyHazard = true;
    this.layer = 1;
  }

  /** Place a burning keg with its cross warnings (arms stop at rocks and walls). */
  static place(w: World, x: number, y: number, owner: number): PowderKeg {
    const arms = CROSS.map((a) => rayFree(w.room, x, y, a, 2, KEG_ARM, true, 2));
    const k = w.spawn(new PowderKeg(x, y, owner, arms));
    for (let i = 0; i < 4; i++) if (arms[i] > 2) k.warnings.push(laneWarning(w, x, y, CROSS[i], arms[i], KEG_WIDTH, KEG_FUSE));
    w.sfx('fuse', { vol: 0.4, pitch: 1.1 });
    dust(w, x, y + 1, SOOT, 4, 30);
    return k;
  }

  get burning(): boolean {
    return this.state === 'fuse';
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (this.flash > 0) this.flash -= dt;
    this.updateSquash(dt);
    if (this.state === 'fuse') {
      if (fx.chance(0.6)) {
        w.particles.spawn({ x: this.x + fx.range(-1, 1), y: this.y - 11, vx: fx.range(-20, 20), vy: -fx.range(10, 40), life: fx.range(0.1, 0.25), colors: ['#ffffff', MAGMA.hot, MAGMA.mid], size: 1, shape: 'spark', additive: true, gravity: 120 });
      }
      if (this.age >= this.fuse) this.detonate(w);
    } else if (this.age >= this.endAt) {
      this.dead = true;
    }
  }

  private detonate(w: World): void {
    this.state = 'boom';
    this.enemyHazard = false;
    this.endAt = this.age + 0.2;
    for (const p of w.targets()) {
      if (!p.alive || p.z > 8) continue;
      const lane = inKegCross(this.x, this.y, this.arms, p.x, p.y, p.r);
      if (lane < 0) continue;
      if (p.hurt(w, 1, PORTER_NAME)) p.knock(Math.cos(CROSS[lane]), Math.sin(CROSS[lane]), 150);
    }
    // the blast races along the cross
    for (let i = 0; i < 4; i++) {
      const a = CROSS[i];
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (let d = 4; d <= this.arms[i]; d += 8) {
        w.particles.burst(this.x + c * d, this.y + s * d - 2, { count: 1, speed: [30, 80], life: [0.2, 0.4], colors: [MAGMA.hot, MAGMA.mid, MAGMA.low], size: [1, 2], additive: true, angle: a, spread: 0.6 });
        w.particles.spawn({ x: this.x + c * d + fx.range(-2, 2), y: this.y + s * d - 2, vx: c * fx.range(10, 30), vy: s * fx.range(10, 30) - fx.range(4, 12), life: fx.range(0.5, 0.9), colors: ['#5a4a44', '#3a302c', '#2a2024'], size: 3, sizeEnd: 6, alpha: 0.6, drag: 2 });
      }
      w.decal(this.x + c * this.arms[i] * 0.5, this.y + s * this.arms[i] * 0.5, '#1a1010', 3, 0.3);
    }
    w.particles.burst(this.x, this.y - 4, { count: 12, speed: [40, 140], life: [0.2, 0.45], colors: ['#ffffff', '#fff0a0', MAGMA.mid], size: [1, 2], additive: true, light: 6 });
    w.particles.burst(this.x, this.y - 4, { count: 8, speed: [40, 110], life: [0.4, 0.8], colors: [WOOD[2], WOOD[1], WOOD[0], IRON[1]], size: [1, 2], gravity: 300, vz: [40, 110], shape: 'square', vrot: 10 });
    w.spawn(new KegBlastFx(this.x, this.y, this.arms));
    w.spawn(new RingFx(this.x, this.y, 16, 0.25, MAGMA.hot, 2));
    w.decal(this.x, this.y, '#140c0c', 6, 0.5);
    w.shake(0.2);
    w.sfx('explosion', { vol: 0.45, pitch: 1.25, x: this.x });
  }

  /** Fizzle out harmlessly (shot, struck, or erased by a bullet-clear). */
  defuse(w: World): void {
    if (this.state !== 'fuse') return;
    this.state = 'dud';
    this.enemyHazard = false;
    this.endAt = this.age + 0.7;
    for (const g of this.warnings) g.dead = true;
    this.flash = 0.1;
    this.squash(1.25, 0.8);
    w.particles.burst(this.x, this.y - 9, { count: 8, speed: [10, 40], life: [0.4, 0.8], colors: ['#d0c8c8', '#8a8288', '#5a5258'], size: [2, 3], sizeEnd: 5, alpha: 0.6, drag: 2 });
    w.particles.burst(this.x, this.y - 11, { count: 4, speed: [20, 60], life: [0.1, 0.2], colors: ['#ffffff', MAGMA.hot], size: [1, 1], shape: 'spark' });
    w.sfx('clock_steam', { vol: 0.35, pitch: 1.6, x: this.x });
  }

  override takeHit(w: World, hit: HitInfo): boolean {
    if (this.state !== 'fuse') return false;
    if (hit.attacker && hit.attacker.team !== 'player') return false;
    this.defuse(w);
    return true;
  }

  override onCleared(w: World): void {
    this.defuse(w);
  }

  override draw(r: Renderer): void {
    if (this.state === 'boom') return;
    const dud = this.state === 'dud';
    const fade = dud ? clamp((this.endAt - this.age) / 0.3, 0, 1) : 1;
    r.shadow(this.x, this.y + 1, 9, 3.5, 0.35 * fade);
    // blinks faster as the fuse runs out
    const left = this.fuse - this.age;
    const rate = left < 0.5 ? 14 : left < 1 ? 8 : 4;
    const blink = !dud && Math.floor(this.age * rate) % 2 === 1;
    const sq = blink ? 1.08 : 1;
    r.sprite(dud ? 'kegimp_dud' : 'kegimp_keg', this.x, this.y + 2, {
      flash: this.flash > 0 ? 1 : blink ? 0.45 : 0, sx: this.squashX * sq, sy: this.squashY / sq, alpha: fade,
    });
    if (!dud) {
      // the burning wick end
      const tip = this.y - 10;
      r.pixelDisc(this.x, tip, blink ? 2 : 1, MAGMA.mid, 0.8);
      r.rect(this.x - 0.5, tip - 0.5, 1, 1, '#ffffff', 1);
    }
  }

  override light(w: World): void {
    if (this.state === 'fuse') {
      const left = this.fuse - this.age;
      w.lights.add(this.x, this.y - 10, 14 + (left < 0.5 ? 6 : 0), '#ffb040', { intensity: 0.7 });
    }
  }
}

/** Living kegs a porter (by enemy id) has burning right now. */
export function liveKegs(w: World, owner: number): number {
  let n = 0;
  for (const e of w.entities) if (e instanceof PowderKeg && !e.dead && e.burning && e.owner === owner) n++;
  return n;
}

/** Where the porter's kegs land: ahead of the keeper's motion, clamped onto free floor. */
function kegSpots(w: World, e: Enemy, n: number): { x: number; y: number }[] {
  const t = e.target(w) as { x: number; y: number; vx?: number; vy?: number };
  let lx = (t.vx ?? 0) * 0.45;
  let ly = (t.vy ?? 0) * 0.45;
  const l = Math.hypot(lx, ly);
  if (l > 36) {
    lx *= 36 / l;
    ly *= 36 / l;
  }
  const tx = t.x + lx;
  const ty = t.y + ly;
  const pts = n > 1 ? volleyTargets(e.x, e.y, tx, ty, n, 44) : [{ x: tx, y: ty }];
  return pts.map((s) => landingSpot(w, s.x, s.y, 6));
}

defineEnemy({
  id: 'powder_porter',
  name: PORTER_NAME,
  hp: 30,
  radius: 6,
  speed: 36,
  sprite: 'kegimp_walk',
  spriteYOffset: 5,
  shadow: 12,
  cost: 1.5,
  floors: [3],
  weight: 0.9,
  champion: true,
  deathFx: 'blood',
  bloodColor: '#5a3434',
  light: { radius: 14, color: '#ff9a40' },
  *script(e, w) {
    yield w.rng.range(0.5, 1.2);
    let side = w.rng.sign();
    while (true) {
      e.setAnim('kegimp_walk');
      // skulk at throwing distance
      const t = w.rng.range(2.3, 3.0);
      for (let el = 0; el < t; el += w.dt) {
        const d = e.distToTarget(w);
        const a = e.angleToTarget(w);
        if (d < 70) e.moveAngle(a + Math.PI + side * 0.6, e.speed);
        else if (d > 130) e.chase(w, e.speed);
        else e.moveAngle(a + (side * Math.PI) / 2, e.speed * 0.7);
        if (e.mem.__bumped || w.rng.chance(0.008)) side = -side;
        yield;
      }
      const live = liveKegs(w, e.id);
      if (live >= 2 || e.distToTarget(w) > 200) continue;
      // hoist a keg overhead (lit wick = telegraph), then lob it
      const tg = e.target(w);
      e.halt();
      e.facing = tg.x >= e.x ? 1 : -1;
      e.setAnim('kegimp_wind');
      e.telegraph(0.45);
      w.sfx('fuse', { vol: 0.35, pitch: 1.4 });
      yield 0.45;
      const n = e.champion && live === 0 ? 2 : 1;
      const owner = e.id;
      for (const s of kegSpots(w, e, n)) {
        lob(w, e.x + e.facing * 2, e.y - 14, s.x, s.y, {
          sprite: 'kegimp_keg', color: '#ffb040', time: 0.75, height: 40, warn: 7, warnColor: '#ffb040', damage: 0, spin: 5,
          light: 12, source: PORTER_NAME, onLand: (ww, x, y) => PowderKeg.place(ww, x, y, owner),
        });
      }
      e.setAnim('kegimp_throw');
      e.squash(0.85, 1.15);
      yield 0.55;
    }
  },
  update(e, w) {
    if (e.anim === 'kegimp_wind' && fx.chance(0.6)) {
      w.particles.spawn({ x: e.x + e.facing * 1.5, y: e.y - 22, vx: fx.range(-25, 25), vy: -fx.range(10, 40), life: fx.range(0.1, 0.25), colors: ['#ffffff', MAGMA.hot, MAGMA.mid], size: 1, shape: 'spark', additive: true, gravity: 120 });
    }
  },
  onDeath(e, w) {
    w.particles.burst(e.x, e.y - 8, { count: 10, speed: [10, 50], life: [0.5, 1.0], colors: ['#3a302c', '#2a2024', '#5a4a44'], size: [2, 3], sizeEnd: 5, alpha: 0.6, drag: 2 });
  },
  draw(e, r, w) {
    e.drawDefault(r, hurtFrame(e, w, 'kegimp_hurt_0'));
  },
});
