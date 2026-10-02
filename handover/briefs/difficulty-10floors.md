<!-- 원래 에이전트 지시서 (model: default, isolation: none) -->

You are working on 등불지기 (Lanternkeeper), a TypeScript + Vite + Canvas2D roguelike in /home/user/REPOSI. Read /home/user/REPOSI/CLAUDE.md first (project guide, conventions, balance units, commands). All player-facing text is Korean.

## User feedback to address

Translated from Korean:
1. "Slowly build the game up to **10 floors**, and make difficulty rise in proportion to the floor number."
2. "The lantern release (등불 해방, F) damage needs a slight nerf — right now the mage and the archer have very high **single-target** release DPS."
3. "Since blessings (등불의 축복) were added, the enemies became paper-thin (물몸)."
   - Interpretation: enemies and bosses die too fast now that players also get a blessing every floor.
   - A previous change also flattened the enemy HP curve (hpMult 1/1.3/1.65/2.1/2.6).

The characters:
- 리아 (lantern_bolt; release `releaseLanternBloom`)
- 베른 (sentinel_blade; release `releaseWhirlwind`)
- 세린 (archer, hunter_bow; release `releaseArrowRain`)
- 니엘 ('공허를 삼킨 아이', void_gaze, the caster; release `releaseAbyss`)

Releases are in `src/content/characters/releases.ts`; ember gain is somewhere in `player.ts`/items.

## Your job (this agent)

### A. Floor-count-agnostic structure
New floors 6–10 (new themes, enemies and bosses) will be added later by other agents as content files. Make the game support N floors without code changes:
- The last floor = the max defined `FloorDef.index`.
- The boss clear on a non-final floor gives the normal reward + trapdoor. The final-victory cinematic and `boss_final` music play only on the last floor.
  - Today `src/content/rooms/handlers.ts` hardcodes floor 5 (around lines 133–144), and `src/content/characters/unlocks.ts:53` too.
  - The current floor-5 boss 무명 (`src/content/bosses/final.ts`, `final-kit.ts`) must still work as the act-1 finale: its victory flow when it is the last floor, and a normal boss clear + trapdoor once floor 6 exists.
- Audit everything else that assumes 5 floors: UI (map, game-over/victory stats, title record "최고 N층", collection floor names, status), run records/unlocks in `save`, loot/shop pools, enemy floor ranges, tests (e.g. `tests/final.test.ts`), and README.
- Add a test that defines extra floors (6–7, reusing an existing theme) and checks a run can progress past 5 and ends only at the last floor.
- Until real floor 6–10 content exists, the shipped game should still be 5 floors and fully playable.

### B. Difficulty that scales with floor
- Design a clear per-floor difficulty table for floors 1–10. Put it in `src/content/floors.ts` or an exported `DIFFICULTY` table that the future floor 6–10 agents will use with `defineFloor`, and document it in CLAUDE.md under Conventions. Cover:
  - enemy HP multiplier
  - enemy damage: half-hearts per hit, e.g. floors 1–3 = 1, heavy attacks 2; later floors raising regular hits to 2. Decide this with care: the player's max HP and healing growth must keep it fair.
  - enemy move/bullet speed multiplier (small, e.g. up to +15–20% by floor 10)
  - room budget/density, champion chance
- Implement the damage and speed multipliers generically in the core (`FloorDef` fields + where enemy damage and bullet speed are applied, `enemy.ts`/`projectile.ts`), backward compatible and small.
- Also raise floors 1–5 so the curve is clearly "proportional to floor": noticeably harder each floor, with floor 1 staying friendly for new players.

### C. Enemy toughness vs player power (the 물몸 problem)
- Measure first:
  - Use `scripts/qa-run.mjs` (QA bot that plays full runs) and/or a dedicated headless harness in node/vitest, or Playwright with `window.__lk`.
  - Quantify, per floor, for typical builds with blessings: player DPS (`src/game/power.ts` has a readout), room clear time, boss fight duration, damage taken. Compare to enemy HP.
- Retune the enemy HP curve (and boss HP where needed) so that:
  - with blessings, normal rooms and especially bosses last a satisfying amount of time
  - Isaac-like targets: boss fights roughly 35–70 s with an average build, longer on later floors
  - no fight becomes a slog for weak builds
- Review the blessings (`src/content/blessings/blessings.ts`) and trim outliers that are clearly overtuned. Small edits, keep their identity.

### D. Release nerf
- Build a measurement: full ember, release on a single target dummy (a high-HP stationary enemy spawned via `__lk.spawn` or in a node test), total damage dealt to that target. Also measure on 6 targets.
- Report per character: single-target and multi-target release damage, in multiples of `stats.damage` and as % of a typical room's or boss's HP, plus ember refill time.
- Nerf the outliers (the user named the mage and the archer) so that single-target release damage is in line across characters. A release should be a strong burst and crowd-control moment, not the main boss-killing tool. Release share of total damage over a QA run should be modest; pick a target, e.g. ≤ 20–25%, and justify it.
- Keep the spectacle and feel. Change numbers, not visuals.

### E. Verification
- Report before/after numbers in tables in your final message:
  - release damage per character
  - TTK / boss duration per floor
  - damage taken per floor
  - the difficulty table
- `npx tsc --noEmit` clean, `npm test` passes, `node scripts/smoke.mjs --out /tmp/claude-0/-home-user-REPOSI/5b6d1b7f-a03d-5f09-9d18-90f35456395e/scratchpad/bal-smoke --seconds 15` ok.
- A QA run per character on floors 1–5 should still be winnable by the bot in god mode or with the bot's normal settings; report what the bot achieves.

## Constraints
- Other agents work in the same working tree right now:
  - (A) performance/120 fps: engine renderer/pacing/lighting/particles, main loop, `World.draw`/entity draw, HUD.
  - (B) determinism: `src/engine/dmath.ts`, fixes of `Math.random`/`fx` misuse in sim code, a per-tick input-struct seam in `player.ts`/`world.ts`.
  - (C) netcode: `src/net/**`, `src/ui/lobby.ts`, title menu.
  - Later, another agent will rework **character identity**: traits, character-specific dashes, and weapon power compressed so characters matter more than weapons. So don't touch character kit/trait files (`ria/bern/serin/niel/traits/look.ts`) or weapon definitions, except release damage numbers in `releases.ts` and ember gain if needed.
  - You own: `floors.ts`, `handlers.ts` floor-end logic, `unlocks.ts` floor logic, `dungeon.ts`, the difficulty multipliers in `enemy.ts`/`projectile.ts`, boss HP numbers, `blessings.ts` numbers, `scripts/qa-run.mjs`, and tests for these.
  - Always re-read a file right before editing it, keep edits small and local, and don't reformat files.
  - If typecheck breaks in a file you didn't touch, it's probably another agent mid-edit: wait a minute and retry.
- **Determinism rule**: gameplay randomness only via `w.rng`; never `fx` or `Math.random` in sim code; no real time or viewport/settings dependence in the sim. Lockstep multiplayer depends on it.
- Use unique ports (5200–5299). Kill only processes you started, by PID. Never `pkill -f` broad patterns.
- No git commands that change state. The orchestrator commits.
- Scratch dir: /tmp/claude-0/-home-user-REPOSI/5b6d1b7f-a03d-5f09-9d18-90f35456395e/scratchpad/balance/

## Final report
Keep it concise:
- the tables
- files changed
- the new FloorDef fields and the difficulty table: what floor 6–10 content agents must use
- anything left to tune
