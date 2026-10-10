// Secret rooms without bombs: every hidden door has a cold wall sconce (꺼진 벽등)
// beside it. A match (interact, never during a lockdown), the keeper's own release
// within 80 px or the keeper's own blast lights it and opens the passage; enemy
// blasts never do. The old map / walking out of the secret room shows it lit
// without spending anything. Co-op strikes pay once; the secret counts once.

import './headless';
import { describe, expect, it, vi } from 'vitest';
import { fakeDisplay } from './headless';
import { Renderer } from '../src/engine/renderer';
import { loadContent } from '../src/content';
import { World } from '../src/game/world';
import { RunState } from '../src/game/run';
import { matchingDoor, type RoomNode } from '../src/game/dungeon';
import { ColdSconce } from '../src/game/cold-sconce';
import { EMBER_MAX } from '../src/game/player';
import { PRESS } from '../src/game/seam';
import { stateHash } from '../src/game/statehash';
import { revealFloorMap } from '../src/content/items/actives';
import { WallLight } from '../src/content/props/lights';
import { SECRET_DOOR_CLEAR } from '../src/content/props/prop';
import { DIR_VEC } from '../src/game/constants';
import type { Door } from '../src/game/room';

loadContent();

const DT = 1 / 60;

function make(seed: string, chars: string[]): World {
  const run = new RunState(seed, chars[0]);
  run.staged = true;
  const w = new World(new Renderer(fakeDisplay(1280, 720)), run, { openInventory() {}, onGameOver() {} });
  if (chars.length > 1) w.startParty(chars.map((characterId, slot) => ({ slot, characterId, name: `P${slot + 1}` })), 0);
  else w.start();
  for (const p of w.players) p.god = true;
  return w;
}

function press(w: World, bits: number): void {
  w.inputSource = (_w, _p, out) => { out.pressed = bits; };
  w.update(DT);
  w.inputSource = (_w, _p, out) => { out.pressed = 0; };
}

interface Found { w: World; secret: RoomNode; room: RoomNode; sconce: ColdSconce; door: Door }

/**
 * A stage with a secret room: enter (cleared) a plain room next to it; its sconce
 * and the hidden door. `skip` picks a later neighbour.
 */
function secretSetup(chars: string[] = ['ria'], tag = 'S', skip = 0): Found {
  for (let s = 0; s < 80; s++) {
    const w = make(`SCONCE-${tag}-${s}`, chars);
    for (let stage = 1; stage <= 3; stage++) {
      w.run.stage = stage;
      w.startFloor(1);
      const secret = w.map.nodes.find((n) => n.kind === 'secret');
      if (!secret) continue;
      const plain = secret.doors.map((d) => w.map.nodes[d.to]).filter((n) => n.kind === 'normal' || n.kind === 'start');
      const room = plain[Math.min(skip, plain.length - 1)];
      if (!room || (skip > 0 && plain.length <= skip)) continue;
      room.cleared = true;
      w.enterRoom(room, null);
      w.update(DT);
      const sconce = w.entities.find((e): e is ColdSconce => e instanceof ColdSconce && e.door.to === secret.id);
      if (!sconce) throw new Error('no sconce by the hidden door');
      return { w, secret, room, sconce, door: sconce.door };
    }
  }
  throw new Error('no secret room found');
}

function standAt(w: World, x: number, y: number): void {
  for (const p of w.players) {
    p.x = x;
    p.y = y;
    p.vx = p.vy = 0;
  }
  w.update(DT);
}

describe('cold wall sconces', () => {
  it('every hidden door has one (unlit, with a card), and no wall light crowds it', () => {
    const { w, door, sconce } = secretSetup();
    const hidden = w.room.doors.filter((d) => d.state === 'hidden');
    expect(hidden.length).toBeGreaterThan(0);
    for (const d of hidden) {
      const s = w.entities.filter((e): e is ColdSconce => e instanceof ColdSconce && e.door === d);
      expect(s).toHaveLength(1);
      expect(s[0].lit).toBe(false);
    }
    expect(door.state).toBe('hidden');
    expect(sconce.previewable()).toBe(true);
    const card = sconce.interactionInfo(w);
    expect(card.name).toBe('꺼진 벽등');
    expect(card.desc).toBe('벽 너머로 바람이 샌다. 불을 붙이면 길이 드러날 것 같다.');
    expect(card.actionLabel).toBe('불 붙이기');
    // the dark sconce is the only lamp near the hidden door on that wall
    const face = door.dir === 'N' ? 'top' : door.dir === 'S' ? 'bottom' : door.dir === 'W' ? 'left' : 'right';
    for (const l of w.entities.filter((e): e is WallLight => e instanceof WallLight)) {
      if (l.face !== face) continue;
      const along = face === 'top' || face === 'bottom' ? Math.abs(l.x - door.x) : Math.abs(l.y - door.y);
      expect(along).toBeGreaterThanOrEqual(SECRET_DOOR_CLEAR - 8);
    }
    // the focus point is reachable from the room side
    expect(w.room.isFree(sconce.x, sconce.y, 3)).toBe(true);
  });

  it('a match (interact) lights it and opens the passage at once; the secret counts once', () => {
    const { w, door, sconce, secret } = secretSetup(['ria'], 'M');
    const p = w.player;
    p.matches = 2;
    const found = w.run.stats.secretsFound;
    standAt(w, sconce.x, sconce.y);
    expect(w.focus).toBe(sconce);
    expect(sconce.interactionInfo(w).available).toBe(true);
    press(w, PRESS.interact);
    expect(sconce.lit).toBe(true);
    expect(door.state).toBe('open');
    expect(p.matches).toBe(1);
    expect(w.run.stats.matchesUsed).toBe(1);
    expect(w.run.stats.secretsFound).toBe(found + 1);
    expect(w.map.nodes[secret.id].discovered).toBe(true);
    expect(sconce.previewable()).toBe(false);
    expect(sconce.interact(w)).toBe(false);
    expect(p.matches).toBe(1);
  });

  it('refuses with no match (float text) and during a lockdown (the match is kept)', () => {
    const { w, door, sconce } = secretSetup(['ria'], 'R');
    const p = w.player;
    const float = vi.spyOn(w, 'floatText');
    standAt(w, sconce.x, sconce.y);
    p.matches = 0;
    expect(sconce.interactionInfo(w).available).toBe(false);
    press(w, PRESS.interact);
    expect(sconce.lit).toBe(false);
    expect(door.state).toBe('hidden');
    expect(float.mock.calls.some((c) => c[2] === '성냥이 없다')).toBe(true);
    const other = w.room.doors.find((d) => d !== door && d.state === 'open');
    expect(other).toBeTruthy();
    other!.state = 'closed';
    p.matches = 1;
    const card = sconce.interactionInfo(w);
    expect(card.available).toBe(false);
    expect(card.desc).toBe('전투가 끝나면 불을 붙일 수 있다.');
    expect(sconce.interact(w)).toBe(false);
    expect(p.matches).toBe(1);
    expect(door.state).toBe('hidden');
    other!.state = 'open';
    expect(sconce.interact(w)).toBe(true);
    expect(door.state).toBe('open');
  });

  it('the keeper\'s release lights sconces within 80 px of the doorway, not beyond', () => {
    const { w, door, sconce } = secretSetup(['ria'], 'L');
    const v = DIR_VEC[door.dir];
    // the boundary itself
    expect(w.lightSecretSconces(door.x - v.x * 81, door.y - v.y * 81, 80)).toBe(0);
    expect(sconce.lit).toBe(false);
    // a release far away does nothing
    const p = w.player;
    const far = w.room.nearestFree(w.room.centerX, w.room.centerY, p.r);
    if (Math.hypot(far.x - door.x, far.y - door.y) > 120) {
      standAt(w, far.x, far.y);
      p.ember = EMBER_MAX;
      w.asPlayer(p, () => p.release(w));
      expect(w.run.stats.releases).toBe(1);
      expect(sconce.lit).toBe(false);
      expect(door.state).toBe('hidden');
      p.releaseCooldown = 0;
    }
    // close by: the passage opens, no match spent
    const m = p.matches;
    standAt(w, sconce.x, sconce.y);
    p.ember = EMBER_MAX;
    p.releaseCooldown = 0;
    p.holdT = 0;
    const found = w.run.stats.secretsFound;
    w.asPlayer(p, () => p.release(w));
    expect(sconce.lit).toBe(true);
    expect(door.state).toBe('open');
    expect(p.matches).toBe(m);
    expect(w.run.stats.secretsFound).toBe(found + 1);
    // the 80 px rule: exactly 80 reaches
    const s2 = secretSetup(['ria'], 'L80');
    const d2 = s2.door;
    const v2 = DIR_VEC[d2.dir];
    expect(s2.w.lightSecretSconces(d2.x - v2.x * 80, d2.y - v2.y * 80, 80)).toBe(1);
    expect(s2.sconce.lit).toBe(true);
  });

  it('a keeper\'s blast lights it; an enemy blast never does', () => {
    const { w, door, sconce } = secretSetup(['ria'], 'B');
    const v = DIR_VEC[door.dir];
    const x = door.x - v.x * 24;
    const y = door.y - v.y * 24;
    const p = w.player;
    p.flags.add('blastImmune');
    w.explode(x, y, 30, 1, { byPlayer: false, hurtsPlayer: false });
    w.update(DT);
    expect(sconce.lit).toBe(false);
    expect(door.state).toBe('hidden');
    w.asPlayer(p, () => w.explode(x, y, 30, 1, { byPlayer: true, hurtsPlayer: false }));
    expect(sconce.lit).toBe(true);
    expect(door.state).toBe('open');
  });

  it('mid-fight a release opens it, but the door stays shut until the room is clear', () => {
    const { w, door, sconce } = secretSetup(['ria'], 'F');
    const other = w.room.doors.find((d) => d !== door && d.state === 'open')!;
    other.state = 'closed';
    const p = w.player;
    standAt(w, sconce.x, sconce.y);
    p.ember = EMBER_MAX;
    w.asPlayer(p, () => p.release(w));
    expect(sconce.lit).toBe(true);
    expect(door.state).toBe('closed');
    w.room.setDoorsClosed(false);
    expect(door.state).toBe('open');
  });

  it('the old map or walking out of the secret room shows it lit without spending anything', () => {
    // the old map, in this room
    const a = secretSetup(['ria'], 'MAP');
    const pa = a.w.player;
    const m = pa.matches;
    a.w.asPlayer(pa, () => revealFloorMap(a.w));
    a.w.update(DT);
    expect(a.door.state).toBe('open');
    expect(a.sconce.lit).toBe(true);
    expect(pa.matches).toBe(m);
    // walking out of the secret room into a room whose sconce is still cold
    const b = secretSetup(['ria'], 'OUT');
    const w = b.w;
    const found = w.run.stats.secretsFound;
    const mb = w.player.matches;
    w.enterRoom(b.secret, null);
    w.update(DT);
    const out = b.secret.doors.find((d) => d.to === b.room.id)!;
    w.enterRoom(b.room, out);
    w.update(DT);
    const again = w.entities.find((e): e is ColdSconce => e instanceof ColdSconce && e.door.to === b.secret.id);
    expect(again).toBe(b.sconce);
    expect(b.sconce.lit).toBe(true);
    expect(b.sconce.door.state).toBe('open');
    expect(w.player.matches).toBe(mb);
    expect(w.run.stats.secretsFound).toBe(found);
    expect(matchingDoor(w.map, b.secret, out)).toBeTruthy();
  });

  it('co-op: two keepers striking the same sconce on the same step pay one match', () => {
    const { w, door, sconce } = secretSetup(['ria', 'bern'], 'CO');
    const purse = w.players[0].purse;
    purse.matches = 3;
    const found = w.run.stats.secretsFound;
    standAt(w, sconce.x, sconce.y);
    press(w, PRESS.interact);
    expect(sconce.lit).toBe(true);
    expect(door.state).toBe('open');
    expect(purse.matches).toBe(2);
    expect(w.run.stats.matchesUsed).toBe(1);
    expect(w.run.stats.secretsFound).toBe(found + 1);
  });

  it('a lit sconce is part of the state hash', () => {
    const { w, sconce } = secretSetup(['ria'], 'H');
    const h = stateHash(w);
    sconce.markLit();
    expect(stateHash(w)).not.toBe(h);
  });
});
