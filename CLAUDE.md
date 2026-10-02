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
- **유물의 흔적 (artifact presence)**: every artifact declares `look` (shot color layer / shape /
  grow / trail / orbit, keeper mote / aura / step / hit sparks — composed in `game/look.ts`), and
  calls `proc(w, id)` (items/lib) when its effect triggers (HUD row flash + icon pop; the shared
  helpers auto-proc inside event hooks). Stat-only artifacts get a small `signature` side effect.
  `tests/presence.test.ts` enforces this.
- **등불의 축복 (floor blessings)**: pick 1 of 3 seeded blessings at every floor start
  (`content/blessings`, hidden artifacts with `blessing: true`; `window.__lkAutoBless` auto-picks).
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
  and multiplied by `FloorDef.hpMult` (1, 1.3, 1.65, 2.1, 2.6 — flat on purpose: items must outpace it).
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

### Determinism (multiplayer lockstep)
Every co-op peer runs the full simulation from the same seed and only exchanges inputs, so
`World.update` and everything under it (enemy scripts, items, projectiles, pickups, room
handlers, dungeon generation) must be **bit-identical on every browser** (V8 / JavaScriptCore / SpiderMonkey).
- **`w.rng` (or a stream seeded from the run / room seed) for anything that touches gameplay**:
  positions, velocities, spawns, damage, drops, AI choices, timers, which entities exist. If the
  code has no `w`, take it as a parameter or derive the value from deterministic state (see
  `Pickup.pop`). Never `Math.random`.
- **`fx` only for cosmetics** (particles, sound pitch, shake, decals, purely visual entities). A
  value drawn from `fx` must never flow into gameplay state. Purely visual entity classes declare
  `static override readonly cosmetic = true` (separate negative ids, left out of the state hash);
  everything else counts as gameplay.
- **No real time, viewport, camera or settings in the simulation**: no `performance.now` /
  `Date`, no `VIEW_W` / `renderer.camX` / on-screen checks, no `save.settings` / `save.progress` /
  quality / touch mode / audio state. Player input reaches the sim only through `Player.input`
  (`PlayerInput`, filled by `World.inputSource`; game/seam.ts) — never read the `input` singleton
  or the mouse from gameplay code (use `p.input.cx/cy` / `w.mouseWorld()`). Options that change the
  simulation live in `w.rules` (`SimRules`, fixed per run in multiplayer).
- **Fixed step only**: state changes happen in `update(dt)` with the fixed `FIXED_DT`; `draw()` /
  `light()` must not change simulation state (restore anything you temporarily change).
- Transcendental math is deterministic because `engine/dmath.ts` replaces `Math.sin/cos/tan/atan2/
  exp/log/pow/hypot/...` at boot (`installDeterministicMath`, also in tests via `tests/setup.ts`).
  Do not use the `**` operator in simulation code (it bypasses `Math.pow`); write `x * x` or `Math.pow`.
- Prefer `Map` / `Set` / arrays (insertion order) for iteration that affects gameplay; sorts need
  total, NaN-free comparators.
- Entity ids are simulation state (restart at 1 per run): spawn order must not depend on anything above.
- Check: `npx vitest run tests/determinism` drives the real World headless with a scripted bot
  through floors 1–5 and asserts identical per-step `stateHash(w)` (game/statehash.ts) across fx
  seeds, view widths, quality / settings, drawing and cache warm-up. On failure it prints the first
  diverging step, the per-part hashes and the differing entities. Add new content to its coverage
  by playing it there (the harness cycles every weapon / artifact / active / enemy over its scenarios).
