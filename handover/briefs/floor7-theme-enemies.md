<!-- 원래 에이전트 지시서 (model: fable, isolation: worktree) -->

You are building **floor 7** for 등불지기 (Lanternkeeper), a TypeScript + Vite + Canvas2D roguelike in the spirit of The Binding of Isaac (rooms, items, bosses) and Sephiria (crisp pixel art, juicy feedback). All art is procedural/ASCII pixel art in code; all audio is synthesized with WebAudio; there are no external assets. All player-facing text is Korean.

## Setup
- You are in your own git worktree; the main checkout is /home/user/REPOSI. Run `ln -s /home/user/REPOSI/node_modules node_modules` in your worktree root if node_modules is missing.
- Read `CLAUDE.md` first. It covers architecture, conventions, art rules, balance units, the telegraph rule, the **Determinism** section (gameplay randomness only via `w.rng`, never `fx`/`Math.random`; cosmetic entities flagged `cosmetic`), and the per-floor **DIFFICULTY** table in `src/content/floors.ts`.
- Study the existing floors as the structure reference and quality bar:
  - **Floor 6 (수몰된 서고)** was just added and is the best template for an act-2 floor:
    - `src/content/themes/archive.ts`, `src/content/props/archive.ts`
    - `src/content/enemies/archive*.ts`, `src/content/rooms/archive.ts`
    - `src/content/audio/music-archive.ts`, `sfx-archive.ts`, `tests/floor6.test.ts`
  - The other themes and enemies (`src/content/themes/*.ts`, `src/content/enemies/*.ts`, `shared.ts`), `src/game/roomart.ts`, and `scripts/sheet-enemies.mjs <out.png> <floor>`.
  - Debug: `__lk.gotoFloor(n)` exists in `src/debug.ts`.

## Context
- Floors 6–10 are act 2: below the abyss, harder, with more intricate enemy patterns.
- Another agent builds floor 7's two bosses in parallel in another worktree. Don't make bosses, and don't add boss music.

## Floor 7: 7층 · 멈춘 태엽탑 (The Stopped Clockwork Spire)
A colossal clock tower that stopped the moment the lantern went dark. Brass gears frozen mid-turn, pendulums, porcelain automatons, music-box cylinders, steam leaking from cracked pipes, clock faces with hands stuck at different hours. Time itself is unreliable here.
- **Palette:** aged brass and polished gold, verdigris teal-green patina, cream porcelain, warm amber lamp light, deep plum/aubergine shadows.
- It must be clearly distinct from floor 3 (ember forge: orange fire / black iron / lava), floor 6 (teal water / ink / parchment), floor 4 (icy blue/white) and floor 5 (void purple).
- Subtitle in the style of the others; write your own, e.g. '시곗바늘이 멈춘 그 순간에서.'

### Build
Follow floor 6's structure and file naming, with the prefix `clock`.

1. **Theme** `src/content/themes/clock.ts`.
   - Floor: tiled brass plates / parquet with inlaid clock-dial patterns.
   - Walls: gearwork walls, with big frozen gears and clock faces painted on the top wall face.
   - Obstacles: gear stacks, broken automatons, pendulum pillars; pits are drops into the gear shaft, if the tile system's pits fit.
   - Props: amber lamps, steam vents (cosmetic puffs), ticking clocks.
   - Ambient particles: drifting dust and brass flecks, steam wisps; lighting tint.
   - It must look as polished as floor 6.
2. **Enemies:** 7–8 new floor-7 enemies (`floors: [7]`), in `src/content/enemies/clock*.ts`. HP is defined at floor-1 scale; the DIFFICULTY multiplier is applied by the engine.
   - **Theme mechanic: time.** Some enemies tick in rhythm, some slow or haste bullets in an area, some rewind. Every dangerous attack is telegraphed. Enemy bullets need high contrast and must be distinct from player shots and from floor 6's glyph bullets.
   - Suggestions (refine or replace freely; names original and Korean):
     - 태엽 쥐: wind-up fodder that zips in straight lines and stops when its key runs down
     - 뻐꾸기: pops out of wall clocks and fires on the beat
     - 톱니 굴렁쇠: a rolling gear that ricochets off walls with a trajectory warning
     - 진자 파수꾼: swings a pendulum blade in a telegraphed arc
     - 도자기 인형: a porcelain automaton that dances closer, then spins a bullet ring; it cracks when hit and reveals its gears at low HP
     - 시간 고정체: a floating hourglass that creates a zone where bullets slow and then snap to full speed
     - 증기 골렘: tough; vents steam lanes with a GroundWarning
     - 되감기 유령: retraces its own path backwards and leaves bullet echoes along it
   - 1–2 enemies may also appear on floor 6 or 8 (`floors: [7, 8]`).
3. **Room templates:** 8–12 floor-7 room templates (`floors: [7]`) in `src/content/rooms/clock.ts`, including 2x1, 1x2 and 2x2 shapes.
4. **Music** `src/content/audio/music-clock.ts`: a 'floor7' track (add it to `MUSIC_IDS`).
   - Mood: a music box and clock ticks over an uneasy, slow waltz in 3/4. Celesta/glockenspiel timbres and a ticking-percussion layer, plus a combat layer like the other floor tracks; loopable.
5. **SFX:** in `src/content/audio/sfx-clock.ts` via `registerSfx`. **Prefix every new sfx name with `clock_`** (e.g. `clock_tick`, `clock_spring`) to avoid name clashes with other parallel agents, and add them to `SFX_NAMES`.
6. **Floor def** in `src/content/floors.ts`: `index: 7, id: 'clock', name: '7층 · 멈춘 태엽탑', theme: 'clock', music: 'floor7', ...DIFFICULTY[7]`, and `extraRooms` similar to floor 6.
7. **Tests** `tests/floor7.test.ts`, modelled on `tests/floor6.test.ts`.

### Verify
Look at every PNG and iterate on the art until it is clean and readable, at floor 6's level.
- `npx tsc --noEmit` clean; `npm test` passes. Under load some timing tests can time out; re-run them with `--maxWorkers=2` before concluding anything.
- Enemy sprite sheet: `node scripts/sheet-enemies.mjs <out> 7`.
- In-game Playwright screenshots via `__lk.gotoFloor(7)`: empty rooms (1x1/2x1/2x2), each enemy in combat, mixed fights, lighting.
- `node scripts/smoke.mjs --out <dir> --seconds 15` ok.
- Keep CPU use moderate: the machine is a shared 4-core box.
- Ports 5450–5499. Kill only processes you started, by PID. Never `pkill -f` broad patterns.

### Finish
- **Commit in your worktree branch** with a clear message ending with exactly these two lines. Do not push.
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_015Tf9FEWtBzZ7RSAdXW1yTp`
- Final report, concise:
  - branch name
  - new/changed files, with shared-file changes called out
  - enemy roster: name, HP, behaviour
  - screenshot paths
