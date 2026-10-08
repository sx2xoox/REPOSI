// Weapon families (user 2026-10-08: "무기 종류를 정리"): every weapon belongs to exactly one
// family, shown on its info line as "등급 · 계열 · 속성" (e.g. "일반 · 활·쇠뇌 · 충전 무기"), in
// green when it is the current keeper's favoured weapon. Keeper favoured classes
// (CharacterDef.affinity) are made only of families (AffinityDef.families) and named after
// them ("창 / 방패"), so the family label alone tells whose weapon it is; 부채·라켓 is
// nobody's. A new weapon must be added here (tests/weapon-families.test.ts checks every weapon).

export interface WeaponFamily {
  id: string;
  /** Korean label */
  name: string;
}

export const WEAPON_FAMILIES: readonly WeaponFamily[] = [
  { id: 'lantern', name: '등불' },
  { id: 'bow', name: '활·쇠뇌' },
  { id: 'gun', name: '총' },
  { id: 'launcher', name: '폭약·포' },
  { id: 'thrown', name: '투척' },
  { id: 'fan', name: '부채·라켓' },
  { id: 'wand', name: '마법봉' },
  { id: 'staff', name: '지팡이' },
  { id: 'occult', name: '주술구' },
  { id: 'tome', name: '마도서·붓' },
  { id: 'sword', name: '검' },
  { id: 'dagger', name: '단검' },
  { id: 'spear', name: '창' },
  { id: 'heavy', name: '둔기·도끼' },
  { id: 'chain', name: '사슬·채찍' },
  { id: 'shield', name: '방패' },
  { id: 'ritual', name: '종·향로' },
];

const MEMBERS: Record<string, readonly string[]> = {
  lantern: ['lantern_bolt', 'dawn_lantern', 'wandering_lamp', 'twin_lamp', 'mine_lantern'],
  bow: ['hunter_bow', 'volley_crossbow', 'glacier_arbalest', 'silvermoon_longbow', 'repeater_crossbow', 'star_piercer', 'sticky_crossbow', 'stasis_arbalest', 'crescent_bow', 'pearl_crossbow', 'thorn_shortbow'],
  gun: ['nail_carbine', 'brass_revolver', 'sunset_rifle', 'gatekeeper_shotgun', 'bell_blunderbuss', 'ember_musket', 'harpoon_gun', 'scatter_horn'],
  launcher: ['firework_barrel', 'thunder_mortar', 'comet_tube', 'saw_launcher'],
  thrown: ['throwing_knives', 'dusk_knives', 'pinwheel_boomerang', 'ricochet_chakram', 'return_blade', 'spin_top_yoyo'],
  fan: ['gale_fan', 'moon_fan', 'badminton_racket'],
  wand: ['amber_wand', 'cinder_sceptre', 'stormhorn_rod', 'tide_staff', 'frost_wand', 'bubble_wand'],
  staff: ['shepherd_crook', 'flame_staff', 'meteor_staff', 'constellation_staff', 'crystal_gatling', 'dragon_breath', 'prism_staff', 'thunder_rod'],
  occult: ['void_gaze', 'void_orbs', 'gravity_orb', 'star_launcher', 'tesla_stake'],
  tome: ['firefly_tome', 'ink_brush'],
  sword: ['sentinel_blade', 'copper_sabre', 'moon_katana', 'obsidian_cleaver', 'rose_rapier', 'titan_greatsword'],
  dagger: ['fang_blade', 'twin_daggers'],
  spear: ['iron_spear', 'fang_spear', 'dawn_pike', 'comet_pike', 'javelin_bundle'],
  heavy: ['great_hammer', 'quake_mace', 'cathedral_mace', 'gatebreaker_maul', 'anchor_axe', 'lantern_flail', 'reaper_scythe'],
  chain: ['chain_sickle', 'thorn_whip'],
  shield: ['mirror_buckler', 'aegis_cannon'],
  ritual: ['resonance_bell', 'smoke_censer'],
};

const FAMILY_OF = new Map<string, WeaponFamily>();
for (const f of WEAPON_FAMILIES) for (const id of MEMBERS[f.id] ?? []) FAMILY_OF.set(id, f);

/** The family of weapon `id` (undefined for an unlisted weapon). */
export function weaponFamily(id: string): WeaponFamily | undefined {
  return FAMILY_OF.get(id);
}

/** Weapon ids of family `familyId`. */
export function familyMembers(familyId: string): readonly string[] {
  return MEMBERS[familyId] ?? [];
}

/** Korean "속성" label of a weapon kind (the info line's third part). */
export const WEAPON_KIND_NAMES: Record<string, string> = { ranged: '원거리 무기', melee: '근접 무기', charge: '충전 무기', beam: '광선 무기' };
