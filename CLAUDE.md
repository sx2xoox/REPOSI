# 등불지기 (Lanternkeeper) — project guide

An **original** top-down roguelike action game in the spirit of *The Binding of Isaac*
(room-by-room dungeon floors, item synergies, secrets, bosses) and *Sephiria* (crisp
pixel art, responsive dash-based action, juicy feedback). We aim for that level of
**quality and feel**, but every name, mechanic detail, sprite and sound is our own.
Do **not** copy content, names or signature systems from those games (e.g. no
Sephiria-style slate/석판 grid, no Isaac item names). All player-facing text is Korean.

Signature mechanics of this game:
- **등불 해방 (lantern release)**: dealing damage fills the ember gauge (`player.ember`,
  max `EMBER_MAX`); `F` releases a character-specific special move (`CharacterDef.release`).
- **등불 공명 (lantern resonance)**: artifacts carry tags; distinct artifacts sharing a tag
  unlock tiered bonuses (`SetDef`). Duplicate artifacts stack (`power` = copies held).
- Isaac-like floors: start / normal / treasure / shop / boss / secret / challenge / shrine /
  curse rooms, keys, bombs, coins, hearts (red + soul), potions (unidentified, colors
  shuffled per run), active items with room charges.

## Tech
TypeScript (strict) + Vite + Canvas2D. **No external assets**: all art is procedural or
ASCII pixel art defined in code; all audio is synthesized with WebAudio. Fonts: Galmuri
(OFL) bundled in `src/assets/fonts`.

Commands:
- `npm run typecheck` — must stay clean.
- `npm test` — vitest unit tests (`tests/**/*.test.ts`, node env, no DOM).
- `node scripts/smoke.mjs --out <dir> --seconds 15` — boots the game headless in Chromium,
  plays a random bot, visits treasure/shop/boss rooms, saves screenshots + `report.json`
  (exit 1 on console errors). Use `--character <id>` / `--seed <s>`.
- `npm run dev` — dev server. In the browser console / Playwright: `window.__lk`
  (`start(seed, char)`, `state()`, `god()`, `give(id)`, `spawn(enemyId, x, y)`, `killAll()`,
  `gotoRoom(kind)`, `nextFloor()`, `list()`, `errors`). See `src/debug.ts`.
- Screenshots are the way to check visuals: write a small Playwright script in your scratch
  dir (Chromium is preinstalled; `import { chromium } from 'playwright'`), start a run with
  `__lk.start`, spawn/give what you made, `page.screenshot`, then **look at the PNG** with Read.

## Architecture (src/)
- `engine/` — generic: `math`, `rng` (seeded sfc32; `fx` = cosmetic-only RNG), `input`
  (actions, mouse/keys/gamepad), `renderer` (384x216 world canvas scaled up + 768x432 UI
  space), `sprites` (registry, lazy compile), `painter` (PixelPainter primitives: ellipse,
  shadeSphere, outline, ramp ...), `lighting` (multiply light map + additive glow),
  `particles`, `script` (generator coroutines), `save` (localStorage).
- `audio/audio.ts` — `sfx(name)` / `audio.playMusic(id)`; names in `SFX_NAMES`, ids in `MUSIC_IDS`;
  synths registered with `registerSfx` / `registerTrack`.
- `game/` — rules: `defs.ts` (**all content interfaces + registries**), `world.ts` (run
  simulation & API used by content), `player.ts`, `enemy.ts` (AI helpers), `projectile.ts`,
  `melee.ts`, `pickups.ts`, `effects.ts`, `room.ts` (tiles, doors, background rendering),
  `dungeon.ts` (floor generation), `items.ts` (hook dispatch, stats, loot), `inventory.ts`,
  `stats.ts`, `roomkinds.ts`, `run.ts`, `app.ts`.
- `ui/` — scenes & overlays (title, character select, game scene, HUD, minimap, pause,
  settings, status (Tab), map (M), game over).
- `content/` — **all game content**. Every `.ts` file under `src/content/**` is auto-imported
  (`import.meta.glob`), so adding content = adding a file that calls `define*()`.
  No central list to edit.

## Conventions
- World coordinates are pixels in the current room; tiles are 16px; a room cell interior is
  17x9 tiles, walls 2 tiles. Room shapes 1x1 / 2x1 / 1x2 / 2x2.
- Units: player damage base 10, fire rate 2.6/s, move 92 px/s. Player HP is in half hearts;
  enemy contact & bullets deal 1 half-heart (heavy attacks 2). Enemy HP is defined for floor 1
  and multiplied by `FloorDef.hpMult` (1, 1.45, 2.0, 2.7, 3.5).
  Typical floor-1 HP: fodder 10–20, regular 25–45, tough 60–120; bosses 450–700.
- Enemy AI = generator `script(e, w)`: `yield 0.5` waits 0.5s, `yield` waits a frame.
  Use `Enemy` helpers: `chase`, `chaseFor`, `wanderFor`, `charge`, `jumpTo`, `moveAngle`,
  `stop`, `telegraph(t)`, `shoot`, `shootAt`, `shootRing`, `summon`, `target(w)`.
  **Telegraph every dangerous attack** (`e.telegraph`, `GroundWarning`) — fairness matters.
- Item hooks (`ItemHooks` in defs.ts) receive `power` (copies held); scale effects with it.
  Never mutate shared defs at runtime; use `w.vars`, `w.flags`, or projectile `mem`.
- Use `w.rng` for gameplay randomness, `fx` (engine/rng) only for cosmetics.
- Colors are `#rrggbb` (code appends alpha hex in places). Outline color `#0c0810`/`#140c1c`.
- Art: chunky readable pixel art, 1px dark outline, light from top-left, hue-shifted ramps
  (`ramp()`), limited palettes per floor. Characters ~14x18, small enemies 10–16px, big
  enemies 20–28px, bosses 32–64px, item icons 16x16. Enemy bullets must be high-contrast
  (bright core + dark outline) and distinct from player shots.
- Keep each file focused; put sprites next to the content that uses them.
- Do not touch files owned by other workstreams unless strictly needed; if you must extend a
  core API, keep it backward compatible and small, and mention it in your final report.
- Never run git commands that change state (commit/checkout/reset/stash) — the orchestrator commits.
