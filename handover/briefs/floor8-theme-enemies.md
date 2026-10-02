<!-- 원래 에이전트 지시서 (model: fable, isolation: worktree) -->

You are building **floor 8** for 등불지기 (Lanternkeeper), a TypeScript + Vite + Canvas2D roguelike in the spirit of The Binding of Isaac (rooms, items, bosses) and Sephiria (crisp pixel art, juicy feedback). All art is procedural/ASCII pixel art in code; all audio is synthesized with WebAudio; there are no external assets. All player-facing text is Korean.

## Setup
- You are in your own git worktree; the main checkout is /home/user/REPOSI. Run `ln -s /home/user/REPOSI/node_modules node_modules` in your worktree root if node_modules is missing.
- Read `CLAUDE.md` first. It covers architecture, conventions, art rules, balance units, the telegraph rule, the **Determinism** section (gameplay randomness only via `w.rng`, never `fx`/`Math.random`; cosmetic entities flagged `cosmetic`; no `fx` values in projectile `mem` that steer shots), and the per-floor **DIFFICULTY** table (from floor 7 a regular hit costs a full heart; keep `def.speed × enemySpeed` under the keeper's 92 px/s).
- The best templates are the **two act-2 floors just added**. Copy their structure and quality bar:
  - Floor 6 (수몰된 서고): `themes/archive.ts`, `props/archive.ts`, `enemies/archive*.ts`, `rooms/archive.ts`, `audio/music-archive.ts`, `sfx-archive.ts`, `tests/floor6.test.ts`.
  - Floor 7 (멈춘 태엽탑): `themes/clock.ts`, `props/clock.ts`, `enemies/clock*.ts`, `rooms/clock.ts`, `audio/music-clock.ts`, `sfx-clock.ts`, `tests/floor7.test.ts`.
- Tools: `scripts/sheet-enemies.mjs <out.png> <floor>` and `__lk.gotoFloor(n)` in `src/debug.ts`.

## Floor 8: 8층 · 결정 광맥 (The Prism Vein)
A deep mine where the lantern's light was swallowed by living crystal. Clear and prismatic crystal clusters split light into rainbows; dark charcoal-slate bedrock; abandoned mine rails, lanterns and carts; glittering dust.
- **Mechanic theme: light and reflection.** Beams that refract off crystals, shards that split, mirrored or prismatic patterns.
- **Palette:** charcoal and blue-grey slate rock, with clear/white crystals that throw **prismatic rainbow** edge highlights (rose, citrine, mint, sky), plus the warm amber of old mine lanterns.
  - It must be clearly distinct from floor 5 (void purple/black), floor 4 (icy pale blue/white snow), floor 6 (teal water/ink) and floor 7 (brass/verdigris).
  - Keep the crystals clear and rainbow-edged, not purple and not ice.
- Write your own subtitle, e.g. '빛은 여기서 길을 잃었다.'

### Build (follow floors 6 and 7; file prefix `prism`)
1. **Theme** `src/content/themes/prism.ts`. It must look as polished as floors 6–7.
   - floor: rough slate with crystal veins and mine-rail strips
   - walls: rock faces studded with crystal clusters and timber mine supports
   - obstacles: crystal clusters, ore carts, broken lanterns
   - pits: chasms into a glowing vein
   - props: mine lanterns and glowing crystal lights
   - ambient: sparkle and rainbow glints, dust
   - lighting tint
2. **Enemies:** 7–8 new floor-8 enemies (`floors: [8]`) in `src/content/enemies/prism*.ts`.
   - Every dangerous attack is telegraphed. High-contrast bullets, distinct from player shots and from floor 6/7 bullets.
   - Suggestions (refine or replace freely; names original and Korean):
     - 결정 진드기: fodder that clings and bursts into shards
     - 프리즘 박쥐: fires a beam that bends once off the nearest crystal, with the bend point telegraphed
     - 광부의 망령: swings a pickaxe; throws a lantern that leaves a light pool
     - 거울 껍질 게: reflects player shots back when struck from the front
     - 정동 골렘: tough; cracks open to fire a crystal shard fan, with a GroundWarning slam
     - 무지개 해파리: rings in alternating colours that split in two on a beat
     - 빛 먹는 벌레: tunnels underground, with a ripple-track telegraph
     - 결정 포탑: grows from the floor and fires refracting prisms
   - 1–2 may also appear on floors 7 or 9 (`floors: [8, 9]`).
3. **Room templates:** 8–12 floor-8 rooms (`floors: [8]`) in `src/content/rooms/prism.ts`, including 2x1, 1x2 and 2x2.
4. **Music** `src/content/audio/music-prism.ts`: a 'floor8' track (add it to `MUSIC_IDS`).
   - Mood: crystalline, shimmering bell/glass timbres with reverb-like echoes, a slow minor arpeggio, deep sub drones, and dripping/mining percussion (distant pick strikes).
   - It needs a combat layer like the other floor tracks, and must loop.
5. **SFX** in `src/content/audio/sfx-prism.ts`. **Prefix every new sfx name with `prism_`** and add them to `SFX_NAMES`.
6. **Floor def** in `src/content/floors.ts`: `index: 8, id: 'prism', name: '8층 · 결정 광맥', theme: 'prism', music: 'floor8', ...DIFFICULTY[8]`, with `extraRooms` like floor 7.
7. **Tests:** `tests/floor8.test.ts`, modelled on `tests/floor7.test.ts`.
   - Run `npx vitest run tests/determinism` too.
   - If adding enemies shifts a determinism-test seed's coverage (the harness shuffles a gift pool), retune that seed as the floor-7 agent did, and note it.

### Verify
- `npx tsc --noEmit` clean. `npm test` passes: under load, re-run timing failures with `--maxWorkers=2`.
  - Known pre-existing failure to ignore: `presence.test.ts` "enemy hp grows gently".
  - Another agent is adding three new characters in the main checkout; a missing `kit-mori` import there is theirs, not yours.
- Enemy sprite sheet; in-game Playwright screenshots via `__lk.gotoFloor(8)`:
  - empty 1x1/2x1/2x2 rooms
  - each enemy attacking
  - mixed fights
  - lighting
  - Look at every PNG and iterate until it matches floors 6–7.
- `node scripts/smoke.mjs --out <dir> --seconds 15` ok.
- Keep CPU use moderate on this shared 4-core box. Use ports 5650–5699. Kill only processes you started, by PID. Never `pkill -f` broad patterns.

### Finish
- **Commit in your worktree branch** with a clear message ending with exactly these two lines. Do not push.
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_015Tf9FEWtBzZ7RSAdXW1yTp`
- Final report, concise:
  - branch name
  - new/changed files, with shared-file changes called out
  - enemy roster: name, HP, behaviour
  - screenshot paths
