/** Shared simulation clock keeps warning, artwork and damage in sync in co-op. */
export function spikeState(roomTime: number, cleared: boolean): { height: number; warning: boolean; active: boolean } {
  if (cleared) return { height: 0, warning: false, active: false };
  const phase = Math.max(0, roomTime) % 3.8;
  if (phase < 1.6) return { height: 0, warning: false, active: false };
  if (phase < 2.25) return { height: 0, warning: true, active: false };
  if (phase < 2.45) return { height: Math.min(2, 1 + Math.floor((phase - 2.25) * 10)), warning: false, active: false };
  if (phase < 3.55) return { height: 3, warning: false, active: true };
  return { height: Math.max(0, 2 - Math.floor((phase - 3.55) * 12)), warning: false, active: false };
}
