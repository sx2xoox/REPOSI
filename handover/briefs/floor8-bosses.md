<!-- 원래 에이전트 지시서 (model: fable, isolation: worktree) -->

You are building the **two floor-8 bosses** for 등불지기 (Lanternkeeper), a TypeScript + Vite + Canvas2D roguelike in the spirit of The Binding of Isaac (rooms, items, bosses) and Sephiria (crisp pixel art, juicy feedback). All art is procedural/ASCII pixel art in code; all audio is synthesized with WebAudio; there are no external assets. All player-facing text is Korean.

## Setup
- You are in your own git worktree; the main checkout is /home/user/REPOSI. Run `ln -s /home/user/REPOSI/node_modules node_modules` in your worktree root if node_modules is missing.
- Read `CLAUDE.md` first: architecture, conventions, art rules (bosses 32–64 px, 1 px dark outline, top-left light, hue-shifted ramps), balance units, **telegraph every dangerous attack**, **Determinism** (gameplay randomness only via `w.rng`; never put `fx` values into projectile `mem` that steers shots; cosmetic entities flagged `cosmetic`), and the DIFFICULTY table (bosses get `bossHpMult`).
- The best references are the four act-2 bosses just added. Copy their structure and quality bar:
  - `src/content/bosses/archivist.ts`, `lighthouse.ts`, `kit6.ts` (floor 6)
  - `clockmaker.ts`, `clockwork-dancer.ts`, `kit7.ts` (floor 7)
  - `audio/music-boss6.ts`, `music-boss7.ts`, `sfx-boss6.ts`, `sfx-boss7.ts`
  - `tests/bosses6.test.ts`, `tests/bosses7.test.ts`

## Context
- Floor 8 is **8층 · 결정 광맥 (The Prism Vein)**: a deep mine where the lantern's light was swallowed by living crystal. Clear prismatic crystals split light into rainbows; charcoal/blue-grey slate; abandoned mine rails, carts and lanterns.
- **Mechanic theme: light and reflection** (refracting beams, splitting shards, mirrors).
- **Palette:** charcoal slate, clear/white crystal with rainbow edge highlights (rose, citrine, mint, sky), warm amber mine lanterns. Not void purple, not ice blue.
- Another agent builds the floor-8 theme, enemies, music and floor def in parallel. Use `bossFloors: [8]`.
- Base HP around 900–1000 at floor-1 scale (the engine applies `bossHpMult`). Report your values.

## The two bosses (original designs, Korean names; refine freely)
1. **보석 세공사 (The Gem-Cutter):** a slender crystalline artisan with a faceting chisel.
   - She plants mirror crystals in the arena (telegraphed), then fires beams that **reflect** off them along previewed paths.
   - She cleaves crystals into shard fans, and cuts the floor into facets that light up in sequence.
   - Phase 2: her body fractures into 2–3 refracted copies that share her HP; only the real one casts a shadow.
2. **정동 거북 (The Geode Tortoise):** a colossal tortoise whose shell is a geode.
   - Slow but massive: telegraphed stomps, and shell-spin rolls that ricochet off the walls.
   - Crystals grow from the floor as temporary obstacles, which shatter into shrapnel if left too long or when hit.
   - Phase 2: the shell cracks open into a glittering crystal garden on its back that fires prismatic volleys, and it rolls faster.

Keep both distinct from every existing boss: bone colossus, bell-keeper, slime queen, spore mother, chain smith, slag imugi, frost saint, frost commander, 무명, 대서기관, 가라앉은 등대, 시계장인, 태엽 무희. In particular, avoid copying the lighthouse's sweeping beam: reflections should be about previewed bounce paths, not a sweep.

## Each boss needs
- An animated sprite with idle, wind-ups, hurt flash and a phase-2 look.
- An intro portrait.
- ≥6 distinct attacks across 2 phases, with every dangerous one telegraphed. Fair, but harder than the floor-7 bosses (floor 8 regular hits cost a full heart, so readability matters even more).
- A death sequence and high-contrast bullets.
- SFX via `registerSfx`, with **every new name prefixed `prismboss_`** and added to `SFX_NAMES`.
- A boss track `boss_prism` (add it to `MUSIC_IDS`), used by both bosses via `bossMusic`.
- A shared kit `src/content/bosses/kit8.ts`.

## Verify
- `npx tsc --noEmit` clean; `npm test` passes, re-running timing failures with `--maxWorkers=2`. Ignore the known `presence.test.ts` "enemy hp grows gently" failure and another agent's missing `kit-mori` import if it appears.
- Add `tests/bosses8.test.ts`, modelled on `tests/bosses7.test.ts`.
- Playwright tour with the floor 6 or 7 boss room as the arena (`__lk.gotoFloor(7)`, `gotoRoom('boss')`, `killAll`, `spawn`, `god`). Cover intro, every attack's telegraph and active frames, phase 2, and death. Look at every PNG and iterate.
- `node scripts/smoke.mjs --out <dir> --seconds 15` ok.
- Keep CPU moderate. Use ports 5700–5749. Kill only processes you started, by PID. Never `pkill -f` broad patterns.

## Finish
- **Commit in your worktree branch**; the message must end with exactly these two lines. Do not push.
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_015Tf9FEWtBzZ7RSAdXW1yTp`
- Final report, concise:
  - branch name
  - new/changed files, with shared-file changes called out
  - per boss: base HP, phases, attacks
  - screenshot paths
