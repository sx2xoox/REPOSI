<!-- 원래 에이전트 지시서 (model: fable, isolation: worktree) -->

You are building the **two floor-7 bosses** for 등불지기 (Lanternkeeper), a TypeScript + Vite + Canvas2D roguelike in the spirit of The Binding of Isaac (rooms, items, bosses) and Sephiria (crisp pixel art, juicy feedback). All art is procedural/ASCII pixel art in code; all audio is synthesized with WebAudio; there are no external assets. All player-facing text is Korean.

## Setup
- You are in your own git worktree; the main checkout is /home/user/REPOSI. Run `ln -s /home/user/REPOSI/node_modules node_modules` in your worktree root if node_modules is missing.
- Read `CLAUDE.md` first: architecture, conventions, art rules (bosses 32–64 px, 1 px dark outline, top-left light, hue-shifted ramps), balance units, the **telegraph every dangerous attack** rule, and the **Determinism** section (gameplay randomness only via `w.rng`; cosmetic entities flagged `cosmetic`).
- The best reference is the floor-6 bosses that were just added:
  - `src/content/bosses/archivist.ts`, `lighthouse.ts` and `kit6.ts`
  - `src/content/audio/music-boss6.ts`, `sfx-boss6.ts`, `tests/bosses6.test.ts`
  - They show portraits, `bossMusic`, `bossFloors`, phases, death sequences, and the debug `e.mem.attacks` tour.
  - The older bosses in `src/content/bosses/*.ts` and the kits (`kit13.ts`, `final-kit.ts`, `shared.ts`) are useful too.

## Context
- Floors 6–10 are act 2: harder. Floor 7 is **7층 · 멈춘 태엽탑 (The Stopped Clockwork Spire)**: a colossal clock tower frozen the moment the lantern went dark. Brass gears, pendulums, porcelain automatons, music boxes, steam, clock faces stuck at different hours. Time is unreliable here.
- Palette: aged brass/gold, verdigris teal-green, cream porcelain, warm amber, deep plum shadows.
- Another agent builds the floor-7 theme, enemies, music and floor def in parallel. Use `bossFloors: [7]` on your bosses.
- Boss base HP: around 850–950 at floor-1 scale; the engine applies the floor's `bossHpMult`. Report the values you pick.

## The two bosses (original designs, Korean names)
1. **시계장인 (The Clockmaker):** a gaunt automaton craftsman fused to a giant clock mechanism. Theme: **time manipulation**.
   - Ideas:
     - Bullets that freeze in place and then resume on the next "tick".
     - A rewind: the last attack's bullets fly back along their paths, telegraphed by afterimages.
     - The clock hands sweep the arena as long blades, telegraphed by a dial overlay.
     - Slow-time zones.
     - A tick-tock rhythm that is readable and learnable.
   - Phase 2: the giant clock face behind it shatters, it speeds up, and the hands double.
2. **태엽 무희 (The Clockwork Dancer):** a porcelain ballerina automaton from a giant music box. Theme: **graceful, fast melee-and-pattern choreography**.
   - Ideas:
     - Pirouette dashes along telegraphed paths.
     - Spinning bullet skirts.
     - The music-box cylinder pins become bullet rows.
     - Pairs of mirrored afterimage dancers.
   - Phase 2: its porcelain cracks to reveal the gears, the tempo rises, and the music detunes.

Refine or replace freely, but stay distinct from all existing bosses:
- bone colossus, bell-keeper, slime queen, spore mother
- chain smith, slag imugi, frost saint, frost knight commander
- 무명, 대서기관, 가라앉은 등대

## Each boss needs
- A big, readable, animated sprite with idle, wind-ups, hurt flash and a phase-2 look.
- A dedicated intro portrait.
- At least 6 distinct attacks across 2 phases, every dangerous one telegraphed. Fair but harder than the floor-6 bosses.
- A death sequence and high-contrast bullets.
- SFX via `registerSfx`. **Prefix every new sfx name with `clockboss_`** to avoid clashes with the parallel floor-7 agent, and add them to `SFX_NAMES`.
- A boss music track `boss_clockwork` (add it to `MUSIC_IDS`; the audio tests require every id to have a track), used by both bosses via `bossMusic`.
- A shared kit file `src/content/bosses/kit7.ts` if useful.

## Verify
Look at every PNG and iterate until the bosses match the floor-6 bosses in quality and readability.
- `npx tsc --noEmit` clean. `npm test` passes; under load, re-run timing-sensitive failures with `--maxWorkers=2`.
- Add `tests/bosses7.test.ts`, modelled on `tests/bosses6.test.ts`.
- Playwright screenshot tour: start a run, `__lk.gotoRoom('boss')`, `__lk.killAll()`, `__lk.spawn('<id>', x, y)`, `__lk.god(true)`. Capture the intro, each attack's telegraph and active frames, phase 2, and death. Floor 6 (`__lk.gotoFloor(6)`) works as a stand-in arena.
- `node scripts/smoke.mjs --out <dir> --seconds 15` ok.
- Keep CPU use moderate on this shared 4-core box. Use ports 5500–5549. Kill only processes you started, by PID. Never `pkill -f` broad patterns.

## Finish
- **Commit in your worktree branch** with a clear message ending with exactly these two lines. Do not push.
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_015Tf9FEWtBzZ7RSAdXW1yTp`
- Final report, concise:
  - branch name
  - new/changed files, with shared-file changes called out
  - per boss: base HP, phases, attacks
  - screenshot paths
