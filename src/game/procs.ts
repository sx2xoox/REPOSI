import type { World } from './world';

/** Gameplay cooldowns live in the owning player's vars (saved/hashed with the player). */
export const MIN_PROC_INTERVAL = 0.2;
export const MIN_STATUS_INTERVAL = 0.5;
interface ProcFrame { effect: string; owner: Record<string, number>; committed: boolean; interval: number; }
const frames = new WeakMap<World, ProcFrame[]>();
const keyOf = (effect: string) => `__proc:${effect}`;
const ready = (vars: Record<string, number>, key: string, now: number) => (vars[key] ?? -Infinity) <= now + 1e-9;

/** A hook is one activation: its area/chain may affect every eligible target. */
export function withProcContext<T>(w: World, effect: string, fn: () => T, emitted = false): T {
  const stack = frames.get(w) ?? [];
  if (!frames.has(w)) frames.set(w, stack);
  stack.push({ effect, owner: w.vars, committed: emitted, interval: MIN_PROC_INTERVAL });
  try { return fn(); } finally { stack.pop(); }
}
export function currentProcEffect(w: World): string | undefined {
  return frames.get(w)?.at(-1)?.effect;
}
export function procReady(w: World, effect: string): boolean {
  return ready(w.vars, keyOf(effect), w.time);
}

/** Declare a longer cooldown without consuming it before a helper actually succeeds. */
export function effectInterval(w: World, interval: number): boolean {
  const frame = frames.get(w)?.at(-1);
  if (!frame) return true;
  frame.interval = Math.max(MIN_PROC_INTERVAL, interval);
  return frame.committed || ready(frame.owner, keyOf(frame.effect), w.time);
}

/** Reserve before the callback to block recursive triggers; unsuccessful attempts refund it. */
function transact(vars: Record<string, number>, key: string, now: number, interval: number, action: () => boolean): boolean {
  if (!ready(vars, key, now)) return false;
  const old = vars[key];
  vars[key] = now + interval;
  let success = false;
  try { success = action(); return success; }
  finally { if (!success) { if (old === undefined) delete vars[key]; else vars[key] = old; } }
}

/** Explicit API for a character or other independently authored effect. */
export function runProc(w: World, effect: string, action: () => boolean, interval = MIN_PROC_INTERVAL): boolean {
  return transact(w.vars, keyOf(effect), w.time, Math.max(MIN_PROC_INTERVAL, interval), () =>
    withProcContext(w, effect, () => {
      // Nested shared helpers belong to this already reserved activation.
      frames.get(w)!.at(-1)!.committed = true;
      return action();
    }));
}

/** Shared item helpers claim lazily: failed chance rolls and empty target searches cost nothing. */
export function effectProc(w: World, action: () => boolean): boolean {
  const frame = frames.get(w)?.at(-1);
  if (!frame) return action(); // Base weapon / active effects are outside passive-item dispatch.
  if (frame.committed) return action();
  return transact(frame.owner, keyOf(frame.effect), w.time, frame.interval, () => {
    frame.committed = true;
    const success = action();
    if (!success) frame.committed = false;
    return success;
  });
}

/** Use inside one AoE activation, or for a previously emitted effect's delayed impact. */
export function runProcStatus(w: World, effect: string, targetId: number, action: () => boolean, interval = MIN_STATUS_INTERVAL): boolean {
  return transact(w.vars, `__procStatus:${effect}:${targetId}`, w.time, Math.max(MIN_STATUS_INTERVAL, interval), action);
}

/** Dead targets must not grow checkpoint/hash state for the rest of a run. */
export function pruneProcState(w: World): void {
  if ((w.vars.__procSweep ?? -Infinity) > w.time) return;
  w.vars.__procSweep = w.time + 1;
  for (const key of Object.keys(w.vars)) {
    if ((key.startsWith('__proc:') || key.startsWith('__procStatus:')) && w.vars[key] < w.time) delete w.vars[key];
  }
}
