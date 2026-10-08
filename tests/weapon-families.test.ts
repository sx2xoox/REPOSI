// Weapon families and the weapon info line (user 2026-10-08: "잘 나눠라 위에 무기 분류로 이해할 수
// 있게 해야한다"). Every weapon belongs to exactly one family (game/weapon-families.ts); every keeper's
// favoured class is made only of families and named after them ("창 / 방패"), so the family label
// on a weapon's info line ("등급 · 계열 · 속성", the family green when favoured) tells the player
// whose weapon it is. 부채·라켓 is the one family no keeper favours.

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { Characters, RARITY_NAME, Weapons, weaponMatchesAffinity } from '../src/game/defs';
import { WEAPON_FAMILIES, WEAPON_KIND_NAMES, familyMembers, weaponFamily } from '../src/game/weapon-families';
import { favouringKeepers, weaponClassRuns, weaponClassText } from '../src/ui/logic';
import { cardWidth, type ItemCard } from '../src/ui/item-tooltip';

loadContent();

const GOOD = '#8ee07a';
const BASE = '#b4a8c0';
const keepers = Characters.all();
const weapons = Weapons.all();
const familyName = (id: string) => WEAPON_FAMILIES.find((f) => f.id === id)?.name;

describe('weapon families', () => {
  it('every registered weapon belongs to exactly one family', () => {
    expect(weapons.length).toBeGreaterThan(80);
    for (const w of weapons) {
      const owners = WEAPON_FAMILIES.filter((f) => familyMembers(f.id).includes(w.id));
      expect(owners.map((f) => f.id), w.id).toHaveLength(1);
      expect(weaponFamily(w.id)?.id, w.id).toBe(owners[0].id);
    }
  });

  it('lists only registered weapons, each once, and no empty family', () => {
    const all = WEAPON_FAMILIES.flatMap((f) => familyMembers(f.id));
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(Weapons.has(id), `stale member ${id}`).toBe(true);
    expect(all.length).toBe(weapons.length);
    for (const f of WEAPON_FAMILIES) expect(familyMembers(f.id).length, f.id).toBeGreaterThan(0);
  });

  it('family ids and names are unique Korean labels that never clash with the line separators', () => {
    const ids = WEAPON_FAMILIES.map((f) => f.id);
    const names = WEAPON_FAMILIES.map((f) => f.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n, n).toMatch(/^[가-힣]+(·[가-힣]+)*$/); // "활·쇠뇌": no spaces, so " · " and " / " stay separators
    }
  });
});

describe('keeper classes are made of families', () => {
  for (const c of keepers) {
    it(`${c.name}: ${c.affinity?.name ?? '(none)'}`, () => {
      const aff = c.affinity;
      expect(aff, `${c.id} has no favoured class`).toBeTruthy();
      if (!aff) return;
      // only families: no ids / tags / kinds that a family label could not show
      expect(aff.ids, c.id).toBeUndefined();
      expect(aff.tags, c.id).toBeUndefined();
      expect(aff.kinds, c.id).toBeUndefined();
      const fams = aff.families ?? [];
      expect(fams.length, c.id).toBeGreaterThan(0);
      expect(new Set(fams).size, c.id).toBe(fams.length);
      for (const f of fams) expect(familyName(f), `${c.id}: unknown family ${f}`).toBeTruthy();
      // the class reads exactly as its family labels
      expect(aff.name).toBe(fams.map((f) => familyName(f)).join(' / '));
      // favoured <=> the weapon's family is in the class (so the green label never lies)
      for (const w of weapons) {
        expect(weaponMatchesAffinity(aff, w), `${c.id} / ${w.id}`).toBe(fams.includes(weaponFamily(w.id)!.id));
      }
      // the starter is in the class
      expect(weaponMatchesAffinity(aff, Weapons.get(c.weapon)), `${c.id} starter ${c.weapon}`).toBe(true);
    });
  }

  it('부채·라켓 is the only family no keeper favours', () => {
    const favoured = new Set(keepers.flatMap((c) => c.affinity?.families ?? []));
    expect(WEAPON_FAMILIES.filter((f) => !favoured.has(f.id)).map((f) => f.name)).toEqual(['부채·라켓']);
  });

  it('오르트 starts with the javelin bundle; the long bow is no longer in his class', () => {
    const ort = Characters.get('ort')!;
    expect(ort.weapon).toBe('javelin_bundle');
    expect(weaponMatchesAffinity(ort.affinity, Weapons.get('crescent_bow'))).toBe(false);
    expect(weaponMatchesAffinity(ort.affinity, Weapons.get('aegis_cannon'))).toBe(true);
  });
});

describe('weapon info line: 등급 · 계열 · 속성', () => {
  it('속성 labels name the four weapon kinds (no old 차지 wording)', () => {
    expect(WEAPON_KIND_NAMES).toEqual({ ranged: '원거리 무기', melee: '근접 무기', charge: '충전 무기', beam: '광선 무기' });
  });

  it('every weapon reads "계열 · 속성"', () => {
    for (const w of weapons) {
      const text = weaponClassText(w);
      expect(text, w.id).toBe(`${weaponFamily(w.id)!.name} · ${WEAPON_KIND_NAMES[w.kind]}`);
      expect(text).not.toContain('기타');
      expect(text).not.toContain('차지');
      const line = `${RARITY_NAME[w.rarity]} · ${text}`.split(' · ');
      expect(line, w.id).toHaveLength(3);
    }
  });

  it('the runs spell the same text; only the family turns green, and only when favoured', () => {
    for (const w of weapons) {
      for (const c of [...keepers, null]) {
        const runs = weaponClassRuns(w, c, BASE, GOOD);
        expect(runs.map((x) => x.t).join(''), w.id).toBe(weaponClassText(w));
        expect(runs[0].t).toBe(weaponFamily(w.id)!.name);
        const fav = !!c && weaponMatchesAffinity(c.affinity, w);
        expect(runs[0].c, `${c?.id ?? 'none'} / ${w.id}`).toBe(fav ? GOOD : BASE);
        for (const x of runs.slice(1)) expect(x.c).toBe(BASE);
      }
    }
  });

  it('the collection names the keepers who favour a weapon (locked ones as ???)', () => {
    const all = keepers.map((c) => `unlock:${c.id}`);
    const shield = Weapons.get('mirror_buckler')!;
    const want = keepers.filter((c) => c.affinity?.families?.includes('shield')).map((c) => c.name);
    expect(want).toEqual(expect.arrayContaining(['보리', '오르트']));
    if (keepers.every((c) => !c.suspended)) expect(favouringKeepers(shield, all)).toEqual(want);
    expect(favouringKeepers(shield, [])).toEqual(keepers.filter((c) => c.affinity?.families?.includes('shield')).map((c) => (c.unlocked && !c.suspended ? c.name : '???')));
    expect(favouringKeepers(Weapons.get('badminton_racket')!, all)).toEqual([]);
  });

  it('the pickup card is wide enough for the whole line beside the interact key', () => {
    // a Galmuri-like metric: a Hangul glyph is one em, the rest ~0.45 em
    const r = { measureText: (s: string, size = 12) => [...s].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? size : size * 0.45), 0) };
    for (const w of weapons) {
      const sub = [{ t: RARITY_NAME[w.rarity], c: BASE }, { t: ' · ', c: BASE }, ...weaponClassRuns(w, null, BASE, GOOD)];
      const subW = sub.reduce((s, x) => s + r.measureText(x.t, 10), 0);
      for (const action of [{ key: 'G', label: '교체', pad: false, ok: true }, { key: '', label: '구매', pad: false, ok: true }, { key: 'A', label: '교체', pad: true, ok: true }]) {
        const card: ItemCard = { icon: '', name: w.name, color: BASE, sub, desc: '', extra: [], action, note: '', price: null };
        const W = cardWidth(r as never, card);
        const act = (action.key ? Math.max(18, Math.ceil((r.measureText(action.key, 10) + 10) / 2) * 2) : 14) + 4 + r.measureText(action.label, 10) + 6;
        // paintCard: the sub row runs from PAD + 38 to W - PAD - (interact hint)
        expect(9 + 38 + subW, `${w.id} ${action.label}`).toBeLessThanOrEqual(W - 9 - act + 0.001);
      }
    }
  });
});
