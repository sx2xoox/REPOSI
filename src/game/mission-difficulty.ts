export type MissionKind = 'relay' | 'workshop' | 'vault';
export const MISSION_DIFFICULTY = {
  relay: { label: '쉬움' },
  workshop: { label: '보통' },
  vault: { label: '어려움' },
} as const;
