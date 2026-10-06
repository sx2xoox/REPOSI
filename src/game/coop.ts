import { applyFacility, type FacilityCommand } from './facilities';
// Online co-op rules shared by the simulation and the UI: revive timing and
// the lockstep commands (player decisions that change the world, applied at the
// same tick on every peer: blessing picks, artifact discards, the host ending
// the run or taking the party back to the lobby).
//
// No local UI mutates the world directly in a co-op run: overlays send one of
// these commands (net/netrun.ts) and the world applies it from the frame.

import type { World } from './world';
import type { Player } from './player';
import { applyBlessing, blessingChoices, markBlessed } from './blessings';
import { discardArtifact } from './interact';

/** Seconds a teammate must stand next to a downed keeper to revive them. */
export const REVIVE_TIME = 2;
/** Revive reach (px between the keepers' centers). */
export const REVIVE_RANGE = 22;

/** A lockstep command (JSON, see net/wire NetCommand). */
export type CoopCommand =
  | FacilityCommand
  /** the keeper picked this floor's blessing (`id: null` = skipped) */
  | { type: 'bless'; floor: number; id: string | null }
  /** the keeper discards one copy of an artifact (Tab screen) */
  | { type: 'discard'; id: string }
  /** host: end the descent for everyone (pause menu "하강 종료") */
  | { type: 'end' }
  /** host: back to the lobby together (after the party summary) */
  | { type: 'lobby' }
  /** e2e probe marker (no effect on the world) */
  | { type: 'probe' }
  /** debugging / e2e (window.__lk.coop.cmd): applied in lockstep like any command */
  | { type: 'debug'; op: 'down' | 'god' | 'killAll' | 'room'; kind?: string };

/** Is `cmd` one of ours (shape-checked: commands come from the network)? */
export function isCoopCommand(cmd: { type: string; [k: string]: unknown }): cmd is CoopCommand {
  switch (cmd.type) {
    case 'facility':
      return [cmd.floor,cmd.stage,cmd.room,cmd.entity].every(v=>typeof v==='number'&&Number.isSafeInteger(v)) && typeof cmd.fingerprint==='string' && cmd.fingerprint.length<12000 && Array.isArray(cmd.materials) && cmd.materials.length<=2 && cmd.materials.every(v=>typeof v==='string'&&v.length<100);
    case 'bless':
      return typeof cmd.floor === 'number' && (cmd.id === null || typeof cmd.id === 'string');
    case 'discard':
      return typeof cmd.id === 'string';
    case 'end':
    case 'lobby':
    case 'probe':
      return true;
    case 'debug':
      return cmd.op === 'down' || cmd.op === 'god' || cmd.op === 'killAll' || cmd.op === 'room';
    default:
      return false;
  }
}

/**
 * Apply a keeper's command to the world (every peer, same tick, between steps).
 * Host-only commands from other slots are ignored. Returns true when the world changed.
 */
export function applyCoopCommand(w: World, slot: number, cmd: CoopCommand): boolean {
  const p = w.players.find((q) => q.slot === slot);
  switch (cmd.type) {
    case 'facility':
      return !!p && w.asPlayer(p,()=>applyFacility(w,cmd));
    case 'bless':
      if (!p) return false;
      return w.asPlayer(p, () => bless(w, p, cmd.floor, cmd.id));
    case 'discard':
      if (!p || !p.alive) return false;
      return w.asPlayer(p, () => !!discardArtifact(w, cmd.id));
    case 'end':
      if (slot !== 0 || w.gameOver) return false;
      w.endRun('하강 종료');
      return true;
    case 'debug':
      if (!p) return false;
      return w.asPlayer(p, () => debugCommand(w, p, cmd.op, cmd.kind));
    default:
      return false;
  }
}

function debugCommand(w: World, p: Player, op: string, kind?: string): boolean {
  switch (op) {
    case 'down':
      if (!p.alive) return false;
      // one last ordinary hit (normal feedback)
      p.god = false;
      p.invuln = 0;
      p.shields = 0;
      p.red = Math.min(p.red, 1);
      p.soul = 0;
      return p.hurt(w, 1, '시험', true);
    case 'god':
      p.god = !p.god;
      return true;
    case 'killAll':
      for (const e of [...w.enemies]) w.killEnemy(e);
      return true;
    case 'room': {
      const n = w.map.nodes.find((x) => x.kind === kind && x !== w.node);
      if (!n || w.transitioning) return false;
      w.teleportTo(n);
      return true;
    }
    default:
      return false;
  }
}

function bless(w: World, p: Player, floor: number, id: string | null): boolean {
  // stale (another floor) or already chosen: ignore
  if (floor !== w.run.floor || (p.vars.__blessedFloor ?? 0) >= floor) return false;
  if (id === null) {
    markBlessed(w);
    return true;
  }
  if (!blessingChoices(w).includes(id)) return false;
  applyBlessing(w, id);
  return true;
}
