// Tile ids & properties. Tiles are stored in a Uint8Array per room.

export const Tile = {
  FLOOR: 0,
  WALL: 1,
  ROCK: 2,      // destroyed by explosions; blocks walking & shots
  BLOCK: 3,     // indestructible metal block
  PIT: 4,       // blocks walking (not flying), shots pass over
  SPIKES: 5,    // hurts the player when walked on
  POT: 6,       // breakable urn: destroyed by shots / melee / explosions; may drop loot
  STONE_LANTERN: 7, // stone lantern: a match lights it for a reward (StoneLantern entity)
  DOOR: 8,      // doorway (walkable only when the door is open)
  RUBBLE: 9,    // destroyed rock remains (walkable, decorative)
  SKULL_ROCK: 10, // crypt rock, acts like ROCK
} as const;
export type TileId = (typeof Tile)[keyof typeof Tile];

export interface TileProps {
  /** blocks ground movement */
  solid: boolean;
  /** blocks flying movement too */
  solidFlying: boolean;
  /** blocks projectiles */
  blocksShots: boolean;
  /** destroyed by explosions */
  blastable: boolean;
  /** destroyed by player attacks (hp-based) */
  breakable: boolean;
  hp: number;
  /** pathfinding: ground units treat as blocked */
  pathBlocked: boolean;
}

const P = (p: Partial<TileProps>): TileProps => ({
  solid: false, solidFlying: false, blocksShots: false, blastable: false, breakable: false, hp: 0, pathBlocked: false, ...p,
});

export const TILE_PROPS: Record<number, TileProps> = {
  [Tile.FLOOR]: P({}),
  [Tile.WALL]: P({ solid: true, solidFlying: true, blocksShots: true, pathBlocked: true }),
  [Tile.ROCK]: P({ solid: true, blocksShots: true, blastable: true, pathBlocked: true }),
  [Tile.BLOCK]: P({ solid: true, blocksShots: true, pathBlocked: true }),
  [Tile.PIT]: P({ solid: true, pathBlocked: true }),
  [Tile.SPIKES]: P({}),
  [Tile.POT]: P({ solid: true, blocksShots: true, blastable: true, breakable: true, hp: 22, pathBlocked: true }),
  [Tile.STONE_LANTERN]: P({ solid: true, blocksShots: true, pathBlocked: true }),
  [Tile.DOOR]: P({ solid: true, solidFlying: true, blocksShots: true, pathBlocked: true }),
  [Tile.RUBBLE]: P({}),
  [Tile.SKULL_ROCK]: P({ solid: true, blocksShots: true, blastable: true, pathBlocked: true }),
};

export function tileProps(t: number): TileProps {
  return TILE_PROPS[t] ?? TILE_PROPS[Tile.FLOOR];
}

/** Legend for room template strings. */
export const TEMPLATE_LEGEND: Record<string, number> = {
  '.': Tile.FLOOR,
  '#': Tile.ROCK,
  'X': Tile.BLOCK,
  'O': Tile.PIT,
  '^': Tile.SPIKES,
  'p': Tile.POT,
  't': Tile.STONE_LANTERN,
  's': Tile.SKULL_ROCK,
};
