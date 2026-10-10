// Cold wall sconces (꺼진 벽등): every hidden door to a secret room has a dead iron
// sconce on the wall beside it, the one dark lamp in a room of lit ones, with soot
// above it and hairline cracks in the wall next to it; dust drifts into the cracks
// while a keeper stands close (a draught from the other side). Lighting it opens
// the passage at once (World.revealSecretDoor: mid-fight it stays shut until the
// room is clear; the secret counts once). Ways to light it:
//   - a match (interact, never during a lockdown),
//   - the keeper's own 등불 해방 within 80 px (Player.release),
//   - the keeper's own explosion nearby (World.explode); enemy blasts never do.
// A door opened some other way (the old map, walking out of the secret room)
// simply shows its sconce lit. One per secret door, spawned on the room's first
// visit (World.spawnRoomFixtures, door order) and kept with the room.

import { Entity } from './entity';
import type { World } from './world';
import type { Door } from './room';
import type { Renderer } from '../engine/renderer';
import { DIR_VEC } from './constants';
import { hiddenDoorCracks, secretSconceAt } from './roomart';
import { inLockdown, matchCard, tryLightWithMatch } from './matches';
import { definePixelSprite, animFrame } from '../engine/sprites';
import { fx } from '../engine/rng';
import { dist } from '../engine/math';

/** fire runs along the wall cracks for this long after lighting (s, draw only) */
const CRACK_FIRE_T = 0.4;
/** a keeper this close (px, to the door) makes dust drift into the cracks */
const DRAUGHT_R = 60;

// 7 x 10 sooty iron sconce: a cup with a dead black wick and a rim of pale ash on a
// short arm, a wall plate with two rivets and one glint of old gilt on the arm's end
const SCONCE = [
  '...w...',
  '..awa..',
  '.IsssI.',
  '..iIi..',
  '.iIIIg.',
  '..iii..',
  '..pPp..',
  '..ppp..',
  '..pPp..',
  '..ppp..',
];
definePixelSprite('cold_sconce', { w: '#0a0608', a: '#8a8088', s: '#1c1820', i: '#3a3440', I: '#6a6474', g: '#d8a848', p: '#2a2630', P: '#5a5464' }, SCONCE, { outline: '#0c0810', origin: [3, 0] });
// lit: the ash burnt off the rim and the wick glowing
definePixelSprite('cold_sconce_lit', { w: '#ffd070', a: '#c89060', s: '#5a3a28', i: '#3a3440', I: '#8a8494', g: '#ffd860', p: '#2a2630', P: '#6a6474' }, SCONCE, { outline: '#0c0810', origin: [3, 0] });
definePixelSprite('icon_cold_sconce', { w: '#0a0608', s: '#1c1820', i: '#4a4450', I: '#6e6878', g: '#d8a848', p: '#34303a', c: '#0c0810' }, [
  '....w....',
  '...sws...',
  '..iIsss..',
  '...iii...',
  '.iIIIIig.',
  '..iiiii..',
  '...ppp...',
  '...pIp...',
  '...ppp...',
  '...pIp...',
  '...ppp...',
], { outline: '#0c0810' });

export class ColdSconce extends Entity {
  override readonly worldLoot = true;
  /** what kind of match target this is (bots / tools: class names are mangled in builds) */
  readonly fixture = 'sconce';
  readonly door: Door;
  lit = false;
  /** `age` when it was lit (draw / cosmetics only: the fire along the cracks) */
  private litAt = -1;
  /** the wick (world px) */
  private readonly wick: { x: number; y: number };
  /** crack polylines, for the fire that runs along them (cosmetic) */
  private cracks: { x: number; y: number }[][] | null = null;

  constructor(door: Door, wick: { x: number; y: number }) {
    super();
    this.door = door;
    this.wick = wick;
    // focus point: between the doorway and the sconce, a step into the room
    const v = DIR_VEC[door.dir];
    this.x = Math.round((door.x + (door.dir === 'N' || door.dir === 'S' ? wick.x : door.x)) / 2 - v.x * 6);
    this.y = Math.round((door.y + (door.dir === 'E' || door.dir === 'W' ? wick.y : door.y)) / 2 - v.y * 6);
    this.r = 5;
    this.persistent = true;
    this.solid = false;
    this.tileCollide = false;
  }

  /** A sconce for a secret door of `room` (its wick from the room geometry; lit if the door is open already). */
  static forDoor(room: { pxW: number; pxH: number }, door: Door): ColdSconce {
    const s = new ColdSconce(door, secretSconceAt(room, door));
    if (door.state !== 'hidden') s.markLit();
    return s;
  }

  /** wall sconces on the top and side walls sit behind everything; one on the bottom lip in front */
  override get sortY(): number {
    return this.door.dir === 'S' ? this.door.y + 16 : -1000 + this.door.y;
  }

  override update(w: World, dt: number): void {
    this.age += dt;
    if (!this.lit) {
      // opened some other way (the old map, walking out of the secret room): simply lit
      if (this.door.state !== 'hidden') {
        this.markLit();
        return;
      }
      this.draught(w, dt);
      return;
    }
    const since = this.age - this.litAt;
    if (since < CRACK_FIRE_T + 0.1) this.crackFire(w, since);
    if (fx.chance(dt * 1.6)) {
      w.particles.spawn({ x: this.wick.x + fx.range(-1, 1), y: this.wick.y - 6, vx: fx.range(-4, 4), vy: -fx.range(12, 24), life: fx.range(0.3, 0.6), colors: ['#fff0a0', '#ffa040', '#a03010'], size: 1, additive: true });
    }
  }

  /** Cosmetic: dust sucked into the cracks while a keeper is near. */
  private draught(w: World, dt: number): void {
    const d = this.door;
    const near = (w.coop ? w.players : [w.player]).some((p) => p && !p.dead && dist(p.x, p.y, d.x, d.y) < DRAUGHT_R);
    if (!near || !fx.chance(dt * 5)) return;
    const pts = this.crackPoints(w);
    const line = pts[fx.int(0, pts.length - 1)];
    const end = line?.[fx.int(0, Math.max(0, line.length - 1))];
    if (!end) return;
    const v = DIR_VEC[d.dir];
    // start a little into the room and drift to the crack
    const sx = end.x - v.x * fx.range(6, 14) + fx.range(-5, 5) * (v.x === 0 ? 1 : 0);
    const sy = end.y - v.y * fx.range(6, 14) + fx.range(-5, 5) * (v.y === 0 ? 1 : 0);
    const life = fx.range(0.7, 1.1);
    w.particles.spawn({ x: sx, y: sy, vx: (end.x - sx) / life, vy: (end.y - sy) / life, life, colors: ['#c8c0b0', '#8a8478'], size: 1, alpha: 0.55 });
  }

  private crackPoints(w: World): { x: number; y: number }[][] {
    if (!this.cracks) this.cracks = hiddenDoorCracks(w.room, this.door);
    return this.cracks;
  }

  /** Cosmetic: fire runs from the opening out along the cracks. */
  private crackFire(w: World, since: number): void {
    const k = Math.min(1, since / CRACK_FIRE_T);
    for (const line of this.crackPoints(w)) {
      const i = Math.min(line.length - 1, Math.floor(k * line.length));
      const pt = line[i];
      if (!pt || !fx.chance(0.7)) continue;
      w.particles.spawn({ x: pt.x, y: pt.y, vx: fx.range(-6, 6), vy: -fx.range(6, 18), life: fx.range(0.2, 0.4), colors: ['#ffffff', '#ffd060', '#ff7a20'], size: 1, additive: true });
    }
  }

  override previewable(): boolean {
    return !this.lit && !this.dead && this.door.state === 'hidden';
  }

  override interactionInfo(w?: World) {
    const name = '꺼진 벽등';
    const desc = '벽 너머로 바람이 샌다. 불을 붙이면 길이 드러날 것 같다.';
    if (!w) return { name, desc, icon: 'icon_cold_sconce', actionLabel: '불 붙이기', available: false, price: { icon: 'hud_match', text: '1', ok: false } };
    return matchCard(w, { name, desc, icon: 'icon_cold_sconce', lockdown: inLockdown(w) });
  }

  override interact(w: World): boolean {
    if (!this.previewable() || !w.entities.includes(this)) return false;
    if (!tryLightWithMatch(w, this, true, this.wick)) return false;
    this.ignite(w);
    return true;
  }

  /** Light it (a match, a release, a keeper's blast): the passage opens at once. */
  ignite(w: World): void {
    if (this.lit) return;
    this.markLit(true);
    w.sfx('lantern_lit', { x: this.wick.x });
    w.particles.burst(this.wick.x, this.wick.y - 3, { count: 12, speed: [20, 70], life: [0.2, 0.5], colors: ['#ffffff', '#ffd060', '#ff7a20'], size: [1, 2], additive: true, light: 4 });
    if (this.door.state === 'hidden') w.revealSecretDoor(this.door);
  }

  /** Lit (`show`: the fire runs along the cracks; otherwise quietly, e.g. a door already open). */
  markLit(show = false): void {
    if (this.lit) return;
    this.lit = true;
    this.litAt = show ? this.age : this.age - 10;
  }

  override draw(r: Renderer): void {
    const { x, y } = this.wick;
    if (!this.lit) {
      r.sprite('cold_sconce', x, y);
      // a last ember still glows in the dead wick now and then
      if (Math.floor(this.age * 1.2 + this.id * 0.7) % 4 === 0 && Math.floor(this.age * 6) % 3 !== 0) r.rect(Math.round(x), Math.round(y), 1, 1, '#ff8a40', 0.9);
      return;
    }
    r.sprite('cold_sconce_lit', x, y);
    r.sprite(animFrame('prop_flame', this.age + this.id * 0.29), x, y);
  }

  override light(w: World): void {
    if (!this.lit) return;
    const fl = 1 + Math.sin(this.age * 12 + this.id) * 0.04;
    w.lights.add(this.wick.x, this.wick.y - 4, 60 * fl, '#ffa850', { intensity: 0.8 });
    const since = this.age - this.litAt;
    if (since < 0.5) w.lights.glow(this.door.x, this.door.y, 30, '#ffb060', 0.6 * (1 - since / 0.5));
  }
}
