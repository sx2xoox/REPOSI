// Mixed resonance: two distinct artifacts from each family. Duplicates never
// advance these thresholds, just as with ordinary resonance.
export const SYNERGIES = [
  { id: 'thermal', name: '온도차', tags: ['flame', 'frost'], desc: '화상 + 둔화·빙결 적에게 직접 공격 피해 +12%', color: '#ffc49a' },
  { id: 'sepsis', name: '깊은 상처', tags: ['venom', 'blood'], desc: '중독 + 출혈 적에게 직접 공격 피해 +12%', color: '#d8b878' },
  { id: 'eclipse', name: '월식', tags: ['star', 'shadow'], desc: '대시 후 1초간 직접 공격의 치명타 피해 +10%', color: '#c8b8ff' },
] as const;

export function synergyActive(counts: Record<string, number>, tags: readonly string[]): boolean {
  return tags.every((tag) => (counts[tag] ?? 0) >= 2);
}
