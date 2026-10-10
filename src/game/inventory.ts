// Collected passive artifacts (no slot limit). Picking up a
// duplicate stacks it: the artifact's `power` equals the number of copies.
// Artifact tags add up to "등불 공명" (resonance) bonuses (see SetDef).

import { Artifacts, Sets, type ArtifactDef, type SetDef, type SetTier } from './defs';

export interface InvItem {
  uid: number;
  id: string;
}

export interface ComputedArtifact {
  def: ArtifactDef;
  /** number of copies held */
  power: number;
  /** first pickup order (for UI sorting) */
  order: number;
}

export interface ComputedSet {
  def: SetDef;
  count: number;
  /** tiers currently active */
  active: SetTier[];
  /** next tier to reach, if any */
  next?: SetTier;
}

export interface InvComputed {
  artifacts: ComputedArtifact[];
  tagCounts: Record<string, number>;
  sets: ComputedSet[];
}

let nextUid = 1;
export function makeItem(id: string): InvItem {
  return { uid: nextUid++, id };
}

export class Inventory {
  items: InvItem[] = [];

  add(item: InvItem): void {
    this.items.push(item);
  }

  /** Remove one copy of `id`. Returns true if something was removed. */
  removeOne(id: string): boolean {
    const i = this.items.findIndex((it) => it.id === id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }

  has(id: string): boolean {
    return this.items.some((s) => s.id === id);
  }

  countOf(id: string): number {
    return this.items.filter((s) => s.id === id).length;
  }

  get size(): number {
    return this.items.length;
  }

  compute(): InvComputed {
    const byId = new Map<string, ComputedArtifact>();
    this.items.forEach((it, i) => {
      const def = Artifacts.get(it.id);
      if (!def) return;
      const cur = byId.get(it.id);
      if (cur) cur.power++;
      else byId.set(it.id, { def, power: 1, order: i });
    });
    const artifacts = [...byId.values()].sort((a, b) => a.order - b.order);
    const tagCounts: Record<string, number> = {};
    // each distinct artifact counts once toward resonance (duplicates don't stack tags)
    for (const a of artifacts) for (const tag of a.def.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    const sets: ComputedSet[] = [];
    for (const def of Sets.all()) {
      const count = tagCounts[def.tag] ?? 0;
      if (count <= 0) continue;
      const tiers = [...def.tiers].sort((a, b) => a.count - b.count);
      sets.push({ def, count, active: tiers.filter((t) => count >= t.count), next: tiers.find((t) => count < t.count) });
    }
    return { artifacts, tagCounts, sets };
  }
}
