// Character sprite builder. Each playable character is authored as three
// hand-placed 16x20 ASCII poses (front / back / side, feet at the bottom) plus a
// palette; this module derives the full animation set the player renderer uses:
//   `${prefix}_idle_{down,up,side}`  2-frame breathing loop (head bob)
//   `${prefix}_walk_{down,up,side}`  4-frame step cycle (feet + body bob)
//   `${prefix}_dash` / `${prefix}_dash_{down,up,side}`  stretched lean
//   `${prefix}_hurt`                 recoil pose with squeezed eyes
//   `${prefix}_portrait`             front pose with the starting weapon
// Light comes from the top-left; every frame gets the shared dark outline.
// Optional animal parts: a `tail` that wags (drawn behind the body, or over it in
// the back view), floppy `ears` that lag a pixel behind on walk steps, and `paws`.

import { defineAnim, defineDrawnSprite } from '../../engine/sprites';
import { finishCloth } from '../../game/sprite-finish';
import { PixelPainter } from '../../engine/painter';

export const CHAR_W = 16;
export const CHAR_H = 20;
export const OUTLINE = '#0c0810';

export type Pose = 'front' | 'back' | 'side';
export type Facing = 'down' | 'up' | 'side';

export interface CharSpec {
  prefix: string;
  /** ASCII key -> color. '.' and ' ' are transparent. */
  palette: Record<string, string>;
  front: string[];
  back: string[];
  side: string[];
  /** number of leg / feet rows at the bottom of each pose (redrawn when walking) */
  feetRows?: number;
  /** feet colors: [shin, boot, sole] */
  feet?: [string, string, string];
  /** front/back feet columns (left x, right x), each foot 2px wide */
  feetX?: [number, number];
  /** side feet columns (back foot x, front foot x) */
  sideFeetX?: [number, number];
  /** floating character (no feet): idle/walk = hover bob + hem flutter */
  float?: boolean;
  /** alternative bottom rows swapped in on odd frames (fluttering hem / cape) */
  hemAlt?: { front?: string[]; back?: string[]; side?: string[] };
  /** rows that make up the head (for the breathing bob), default 10 */
  headRows?: number;
  /** eye pixels in the front pose (replaced by a squeezed look in the hurt frame) */
  eyes?: [number, number][];
  /** skin color used to fill eye pixels when squeezing */
  hurtFill?: string;
  /** extra decoration painted on top of every frame (after pose & feet) */
  overlay?(p: PixelPainter, pose: Pose, frame: FrameInfo): void;
  /** portrait extras (e.g. weapon in hand), painted after the front pose */
  portrait?(p: PixelPainter): void;
  /** wagging tail, per pose (moves with the body; behind it unless `over`) */
  tail?: Partial<Record<Pose, TailPose>>;
  /** ear pixels (palette keys); floppy ears stretch a pixel down while the body is raised */
  ears?: { keys: string; flop?: boolean };
  /** fur paws instead of boots: feet = [paw top, leg fur & toes, toe shadow] */
  paws?: boolean;
}

export interface TailPose {
  /** top-left of the tail frames in pose coordinates */
  x: number;
  y: number;
  /**
   * wag frames (ASCII rows in the spec palette). Idle alternates the first and last
   * frame, walking cycles 0, 1, last, 1; dash / hurt / portrait use frame 1 (or 0).
   */
  frames: string[][];
  /** paint over the body instead of behind it (back view) */
  over?: boolean;
}

export interface FrameInfo {
  kind: 'idle' | 'walk' | 'dash' | 'hurt' | 'portrait';
  /** walk step 0..3, idle frame 0..1 */
  step: number;
  /** vertical body offset applied this frame (0 = resting, -1 = raised) */
  bob: number;
  /** idle tail wag phase (0 / 1 = first / last tail frame); defaults to `step` */
  wag?: number;
}

/** Copy an ASCII pose into a painter with an optional per-row x shift and y shift. */
function stampPose(p: PixelPainter, rows: string[], pal: Record<string, string>, opts: { dy?: number; headDy?: number; headRows?: number; skipBottom?: number; shear?: (row: number) => number; earKeys?: string } = {}): void {
  const n = rows.length - (opts.skipBottom ?? 0);
  if (opts.earKeys) {
    // floppy ears lag behind the raised body: paint them one row lower first,
    // the regular pass then leaves a 1px longer ear
    for (let r = 0; r < n; r++) {
      const row = rows[r];
      const dy = (opts.dy ?? 0) + (r < (opts.headRows ?? 10) ? opts.headDy ?? 0 : 0) + 1;
      const dx = opts.shear ? opts.shear(r) : 0;
      for (let c = 0; c < row.length; c++) if (opts.earKeys.includes(row[c])) p.px(c + dx, r + dy, pal[row[c]]);
    }
  }
  // a lowered head (breathing) is painted after the body so it rests on the collar
  // instead of sinking behind it (keeps the chin / muzzle visible)
  const headRows = Math.min(n, opts.headRows ?? 10);
  const order = opts.headDy ? [...Array(n).keys()].slice(headRows).concat([...Array(headRows).keys()]) : [...Array(n).keys()];
  for (const r of order) {
    const row = rows[r];
    const isHead = r < headRows;
    const dy = (opts.dy ?? 0) + (isHead ? opts.headDy ?? 0 : 0);
    const dx = opts.shear ? opts.shear(r) : 0;
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.' || ch === ' ') continue;
      const col = pal[ch];
      if (col) p.px(c + dx, r + dy, col);
    }
  }
}

/** Draw two feet (2px wide) for a front/back pose. lift: [-1..1] per foot (1 = raised). */
function drawFeet(p: PixelPainter, spec: CharSpec, xs: [number, number], lifts: [number, number], shift: [number, number] = [0, 0]): void {
  const [shin, boot, sole] = spec.feet ?? ['#2a2030', '#5a4038', '#1a1018'];
  // canvas is CHAR_H + 1 tall: poses are stamped one row down, the sole sits on the last row
  const base = CHAR_H;
  for (let i = 0; i < 2; i++) {
    const x = xs[i] + shift[i];
    const lift = lifts[i];
    const y = base - lift;
    // shin connects the hem to the boot
    for (let yy = CHAR_H + 1 - (spec.feetRows ?? 3); yy < y - 1; yy++) p.rect(x, yy, 2, 1, spec.paws ? boot : shin);
    if (spec.paws) {
      // fur paw: lit top row, toes below with a shadow on the outer side
      p.rect(x, y - 1, 2, 1, shin);
      p.px(x, y, i === 0 ? boot : sole);
      p.px(x + 1, y, i === 0 ? sole : boot);
    } else {
      p.rect(x, y - 1, 2, 1, boot);
      p.rect(x, y, 2, 1, sole);
    }
  }
}

/** Wag frame for a frame description (see TailPose.frames). */
function wagIndex(info: FrameInfo, n: number): number {
  if (info.kind === 'walk') return [0, 1, n - 1, 1][info.step % 4] % n;
  if (info.kind === 'idle') return (info.wag ?? info.step) % 2 ? n - 1 : 0;
  return Math.min(1, n - 1);
}

function drawTail(p: PixelPainter, spec: CharSpec, pose: Pose, info: FrameInfo, over: boolean, dy: number, shear?: (row: number) => number): void {
  const t = spec.tail?.[pose];
  if (!t || !!t.over !== over || !t.frames.length) return;
  const rows = t.frames[wagIndex(info, t.frames.length)];
  for (let r = 0; r < rows.length; r++) {
    const dx = shear ? shear(t.y + r) : 0;
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch === '.' || ch === ' ') continue;
      const col = spec.palette[ch];
      if (col) p.px(t.x + c + dx, t.y + r + dy, col);
    }
  }
}

function frameName(prefix: string, kind: string, facing: Facing | null, i: number): string {
  return facing ? `${prefix}_${kind}_${facing}_${i}` : `${prefix}_${kind}_${i}`;
}

const POSE_OF: Record<Facing, Pose> = { down: 'front', up: 'back', side: 'side' };

function poseRows(spec: CharSpec, pose: Pose, odd = false): string[] {
  const rows = pose === 'front' ? spec.front : pose === 'back' ? spec.back : spec.side;
  const alt = odd ? spec.hemAlt?.[pose] : undefined;
  if (!alt?.length) return rows;
  return [...rows.slice(0, rows.length - alt.length), ...alt];
}

/** Paint one frame of `pose`. */
export function paintFrame(p: PixelPainter, spec: CharSpec, pose: Pose, info: FrameInfo): void {
  const odd = (info.kind === 'walk' || info.kind === 'idle') && info.step % 2 === 1;
  const rows = poseRows(spec, pose, odd);
  const feetRows = spec.float ? 0 : spec.feetRows ?? 3;
  const headRows = spec.headRows ?? 10;
  const fx = spec.feetX ?? [5, 9];
  const sfx = spec.sideFeetX ?? [6, 8];
  const earKeys = spec.ears?.flop ? spec.ears.keys : undefined;
  if (info.kind === 'dash') {
    // lean forward: upper rows shift ahead (side pose), feet trail behind
    const shear = (r: number) => (pose === 'side' ? (r < headRows ? 2 : r < CHAR_H - feetRows - 2 ? 1 : 0) : 0);
    drawTail(p, spec, pose, info, false, 1, shear);
    // floppy ears lag behind the lunge
    stampPose(p, rows, spec.palette, { dy: 1, skipBottom: feetRows, shear, headRows, earKeys });
    if (!spec.float) {
      if (pose === 'side') drawFeet(p, spec, [sfx[0] - 2, sfx[1] + 1], [1, 0]);
      else drawFeet(p, spec, fx, [1, 1]);
    }
    drawTail(p, spec, pose, info, true, 1, shear);
  } else if (info.kind === 'walk') {
    const s = info.step;
    const bob = info.bob;
    drawTail(p, spec, pose, info, false, 1 + bob);
    stampPose(p, rows, spec.palette, { dy: 1 + bob, skipBottom: feetRows, headRows, earKeys: bob < 0 ? earKeys : undefined });
    if (!spec.float) {
      if (pose === 'side') {
        // stride: feet swap front/back
        const a = s === 0 ? [-1, 1] : s === 2 ? [1, -1] : [0, 0];
        const lift: [number, number] = s === 1 ? [1, 0] : s === 3 ? [0, 1] : [0, 0];
        drawFeet(p, spec, sfx, lift, [a[0], a[1]]);
      } else {
        const lift: [number, number] = s === 1 ? [1, 0] : s === 3 ? [0, 1] : [0, 0];
        drawFeet(p, spec, fx, lift);
      }
    }
    drawTail(p, spec, pose, info, true, 1 + bob);
  } else {
    // idle / hurt / portrait (floating characters hover instead of breathing)
    const hover = spec.float && info.kind === 'idle' && info.step === 1 ? -1 : 0;
    const headDy = !spec.float && info.kind === 'idle' && info.step === 1 ? 1 : 0;
    const dy = 1 + info.bob + hover;
    drawTail(p, spec, pose, info, false, dy);
    stampPose(p, rows, spec.palette, { dy, headDy, skipBottom: feetRows, headRows });
    if (!spec.float) drawFeet(p, spec, pose === 'side' ? sfx : fx, [0, 0]);
    drawTail(p, spec, pose, info, true, dy);
    if (info.kind === 'hurt' && spec.eyes) {
      // squeezed eyes: >  <
      const fill = spec.hurtFill ?? spec.palette.s ?? '#f0d0b8';
      const dark = spec.palette.e ?? '#1a1420';
      for (const [x, y] of spec.eyes) p.px(x, y + 1 + info.bob, fill);
      const xs = [...new Set(spec.eyes.map((e) => e[0]))].sort((a, b) => a - b);
      const ys = spec.eyes.map((e) => e[1]);
      const y0 = Math.min(...ys) + 1 + info.bob;
      if (xs.length >= 4) {
        // left eye ">" right eye "<"
        p.px(xs[0], y0, dark); p.px(xs[1], y0 + 1, dark);
        p.px(xs[xs.length - 1], y0, dark); p.px(xs[xs.length - 2], y0 + 1, dark);
      }
    }
  }
  spec.overlay?.(p, pose, info);
  const pal=spec.palette;
  finishCloth(p, pal['1']?[pal['1'],pal['2'],pal['3']]:[pal.R,pal.r,pal.s]);
}

/** Register every sprite & animation for a character spec. */
export function defineCharacter2D(spec: CharSpec): void {
  const pre = spec.prefix;
  const opts = { outline: OUTLINE, anchor: 'bottom' as const };
  const facings: Facing[] = ['down', 'up', 'side'];
  for (const f of facings) {
    const pose = POSE_OF[f];
    const idle: string[] = [];
    // with a tail the breathing loop is doubled so the tail wags twice per breath
    const wags = spec.tail?.[pose] ? 2 : 1;
    for (let i = 0; i < 2 * wags; i++) {
      const n = frameName(pre, 'idle', f, i);
      const step = Math.floor(i / wags);
      const wag = wags > 1 ? i % 2 : undefined;
      defineDrawnSprite(n, CHAR_W, CHAR_H + 1, (p) => paintFrame(p, spec, pose, { kind: 'idle', step, bob: 0, wag }), opts);
      idle.push(n);
    }
    defineAnim(`${pre}_idle_${f}`, idle, 2.2 * wags);
    const walk: string[] = [];
    for (let i = 0; i < 4; i++) {
      const n = frameName(pre, 'walk', f, i);
      const bob = i % 2 ? -1 : 0;
      defineDrawnSprite(n, CHAR_W, CHAR_H + 1, (p) => paintFrame(p, spec, pose, { kind: 'walk', step: i, bob }), opts);
      walk.push(n);
    }
    defineAnim(`${pre}_walk_${f}`, walk, 9);
    const dn = `${pre}_dash_${f}`;
    defineDrawnSprite(`${dn}_0`, CHAR_W + 3, CHAR_H + 1, (p) => paintFrame(p, spec, pose, { kind: 'dash', step: 0, bob: 0 }), opts);
    defineAnim(dn, [`${dn}_0`], 1);
  }
  defineAnim(`${pre}_dash`, [`${pre}_dash_side_0`], 1);
  defineDrawnSprite(`${pre}_hurt_0`, CHAR_W, CHAR_H + 1, (p) => paintFrame(p, spec, 'front', { kind: 'hurt', step: 0, bob: 0 }), opts);
  defineAnim(`${pre}_hurt`, [`${pre}_hurt_0`], 1);
  defineDrawnSprite(`${pre}_portrait`, CHAR_W + 6, CHAR_H + 2, (p) => {
    // draw into an offset area so weapons can stick out on both sides
    const inner = makeSub(CHAR_W, CHAR_H + 1);
    paintFrame(inner, spec, 'front', { kind: 'portrait', step: 0, bob: 0 });
    p.blit(inner, 3, 1);
    spec.portrait?.(p);
  }, { outline: OUTLINE, anchor: 'center' });
}

function makeSub(w: number, h: number): PixelPainter {
  return new PixelPainter(w, h);
}

/** Validate an ASCII pose (used by tests). Returns a list of problems. */
export function validateSpec(spec: CharSpec): string[] {
  const out: string[] = [];
  for (const pose of ['front', 'back', 'side'] as Pose[]) {
    const rows = poseRows(spec, pose);
    if (rows.length !== CHAR_H) out.push(`${spec.prefix}.${pose}: ${rows.length} rows (want ${CHAR_H})`);
    rows.forEach((r, i) => {
      if (r.length !== CHAR_W) out.push(`${spec.prefix}.${pose}[${i}]: width ${r.length} (want ${CHAR_W}) "${r}"`);
      for (const ch of r) if (ch !== '.' && ch !== ' ' && !(ch in spec.palette)) out.push(`${spec.prefix}.${pose}[${i}]: unknown key '${ch}'`);
    });
    const tail = spec.tail?.[pose];
    tail?.frames.forEach((f, fi) => f.forEach((r, i) => {
      if (tail.x + r.length > CHAR_W || tail.y + i >= CHAR_H) out.push(`${spec.prefix}.tail.${pose}[${fi}][${i}]: outside the sprite`);
      for (const ch of r) if (ch !== '.' && ch !== ' ' && !(ch in spec.palette)) out.push(`${spec.prefix}.tail.${pose}[${fi}][${i}]: unknown key '${ch}'`);
    }));
  }
  for (const ch of spec.ears?.keys ?? '') if (!(ch in spec.palette)) out.push(`${spec.prefix}.ears: unknown key '${ch}'`);
  return out;
}
