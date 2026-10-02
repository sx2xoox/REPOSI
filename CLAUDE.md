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
- Units: player damage base 10, fire rate 2.6/s, move 92 px/s. Player HP is in half hearts.
  Enemy hits are written at *base strength*: contact & bullets 1, heavy attacks (slams, blasts) 2;
  `Player.hurt` turns that into the floor's damage (`FloorDef.enemyDamage`, `enemyHitDamage()`;
  pass `raw` only for the keeper's own bombs / status ticks). Enemy HP is defined in floor-1 units
  and multiplied by `FloorDef.hpMult` (bosses: `bossHpMult`). Typical floor-1 HP: fodder 10–20,
  regular 25–45, tough 60–120; bosses 700–1150.
- **Floors & difficulty** (`content/floors.ts`): floors are 1..N and the deepest defined floor is
  the last (`lastFloorIndex()` / `isLastFloor()` in defs.ts): its boss gets `boss_final` music and
  the victory cinematic; every other boss (incl. 무명, the act-1 finale on floor 5) leaves a
  reward + trapdoor. A floor spreads its row of `DIFFICULTY` into `defineFloor({ ...DIFFICULTY[n] })`
  (`tests/floors.test.ts` enforces it and the monotonic curve):

  | floor | hpMult | bossHpMult | hit [regular, heavy] ½♥ | move / shot speed | budget | champion | rooms |
  |---|---|---|---|---|---|---|---|
  | 1 | 1.3 | 1.35 | 1, 2 | 1.00 / 1.00 | 3–5 | 3% | 8–10 |
  | 2 | 1.75 | 2.05 | 1, 2 | 1.02 / 1.02 | 4–6 | 6% | 10–12 |
  | 3 | 2.4 | 2.9 | 1, 2 | 1.03 / 1.04 | 5–7 | 8% | 11–13 |
  | 4 | 3.6 | 4.2 | 1, 2 | 1.05 / 1.06 | 6–8 | 10% | 12–14 |
  | 5 | 4.9 | 6.0 | 1, 2 | 1.06 / 1.08 | 7–9 | 12% | 12–15 |
  | 6 | 6.3 | 11 | 1, 3 | 1.08 / 1.10 | 7–10 | 14% | 13–15 |
  | 7 | 7.7 | 13.8 | 2, 3 | 1.09 / 1.12 | 8–10 | 16% | 13–16 |
  | 8 | 9.4 | 17.2 | 2, 3 | 1.10 / 1.14 | 8–11 | 18% | 14–16 |
  | 9 | 11.5 | 21.5 | 2, 4 | 1.12 / 1.16 | 9–11 | 20% | 14–17 |
  | 10 | 14 | 26.9 | 2, 4 | 1.13 / 1.18 | 9–12 | 22% | 15–17 |

  Floors 1–6 are measured (QA bot median: rooms ~6–10 s, bosses ~30–50 s, humans ~1.3x longer; the
  bot's boss dps grows ~1.45x per floor; boss def.hp ~700–1150); 7–10 are extrapolated — re-measure with
  `node scripts/qa-run.mjs --suite balance --seeds 3` (per-floor table: room / boss seconds, damage
  taken, would-die count, release share) once their content exists. From floor 7 a regular hit costs
  a full heart, so bosses drop one heart pickup per half-heart of regular damage. Deeper floors need
  their own enemies (`EnemyDef.floors`), bosses (`bossFloors`), music ids (`MUSIC_IDS`) and room
  templates (`RoomTemplate.floors` lists that stop at 5 are skipped deeper down). Keep `def.speed x
  enemySpeed` under the keeper's 92 px/s for regular enemies.
- **등불 해방** balance: a release is a burst / crowd-control moment worth ~10–15x `stats.damage` on a
  single target (multi-hit releases use `HitFalloff`), ≤ ~20% of a run's damage.
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
  diverging step, the per-part hashes and the differing entities (harness: tests/detsim.ts; it
  cycles through weapons / artifacts / actives / extra enemies, so new content gets exercised).
