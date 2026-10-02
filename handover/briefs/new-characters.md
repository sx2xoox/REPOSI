<!-- 원래 에이전트 지시서 (model: fable, isolation: none) -->

You are adding **three new playable characters** to 등불지기 (Lanternkeeper), a TypeScript + Vite + Canvas2D roguelike in /home/user/REPOSI, in the spirit of The Binding of Isaac and Sephiria.
- Read /home/user/REPOSI/CLAUDE.md first, including the **Determinism** section, which you must follow strictly:
  - `w.rng` only for gameplay
  - `fx` only for cosmetics
  - cosmetic entities flagged `cosmetic`
  - input only via `Player.input`
  - no settings, real time or viewport in the sim
- All player-facing text is Korean.
- All characters are **puppy-motif** keepers.

## What the user asked (translated)
"Add about 3 new characters. Each must have personality: a clear reason why you would pick this one."
The user approved these three concepts and names:
1. **보리 (Saint Bernard): 구조견 탱커 / 서포터 (rescue-dog tank and support)**
   - High HP, slow, sturdy.
   - Signature: a little rescue barrel on the collar. It heals and shields; it could store overheal or excess hearts as "barrel charges" you drink with a tap, or periodically spill a healing/shield puddle.
   - Strong knockback resistance, and maybe damage reduction while not dashing.
   - Dash: a short, heavy "body block" shove that blocks bullets in front for a moment, rather than a long dash.
   - Why pick: survivability, a forgiving playstyle, and great in co-op.
   - Online co-op is being built right now in another workstream. Give 보리's def a data field that the co-op code can read later, e.g. `coop: { reviveSpeed: 2, reviveHearts: 2 }`, documented in a comment. Don't implement co-op logic yourself.
2. **백구 (white Jindo): 반격의 달인 (counter master)**
   - Skill-expression character, high risk / high reward.
   - Signature: a dash timed just before a bullet or enemy attack hits is a **perfect dodge** that reflects nearby enemy bullets and triggers a powerful counter-strike, with a brief slow-mo flash, a satisfying sound and a visible "간파!" pop.
   - Normal dashes are shorter, and the window is fair but demanding: ~0.15–0.2 s, generous on touch.
   - Low HP.
   - Why pick: mastering timing turns enemy attacks into your damage.
   - The existing 베른 (husky) has 기세 momentum and a rushing charge dash; 백구 must feel clearly different, all about timing.
3. **모리 (Border Collie): 몰이꾼 (herder)**
   - Fights alongside spirit companions, e.g. 2–3 small spectral sheep/wisp-dogs that orbit or follow and attack, and positioning matters.
   - Signature: herding. Enemies near the companions get nudged and clumped together, and grouped enemies take bonus damage. Alternatively, a "whistle" that sends the companions to the aimed spot.
   - Dash: a quick sidestep that leaves the companions where you were, or swaps places with one.
   - Why pick: a companion-led, positioning-based playstyle that rewards grouping enemies, with steady damage while you dodge.
   - Mind performance and readability: a few clear companions, not a swarm.

## Framework (just built; use it, don't rebuild it)
- `CharacterDef` in `src/game/defs.ts` has these optional fields:
  - `passive` (`PassiveDef` = ItemHooks plus name/desc/icon/look)
  - `dash` (`DashDef`: start/update/end hooks, iframes, blink, color, sfx)
  - `affinity` (`AffinityDef`: weapon kinds, tags, ids, stats)
  - presentation: `playstyle`, `difficulty`, `pitch`, `releaseName`, `lightRadius`
- `ItemSystem.recompute` dispatches the passive as effect key `passive:<id>`; `proc(w, 'passive:<id>')` gives feedback.
- Reference implementations to copy the structure from:
  - `src/content/characters/kit.ts` (shared helpers)
  - `kit-ria.ts`, `kit-bern.ts`, `kit-serin.ts`, `kit-niel.ts`
  - `ria.ts`, `bern.ts`, `serin.ts`, `niel.ts` (defs, sprites, story)
  - `look.ts` (character sprite system)
  - `releases.ts` (등불 해방 moves)
  - `unlocks.ts` (unlock conditions)
- **Release balance rule (CLAUDE.md):** a release is a burst / crowd-control moment worth ~10–15× `stats.damage` on a single target, at most ~20% of a run's damage.
- Weapons: `src/content/weapons/**`. Weapon power was just compressed to 0.9–1.3× the starter. `WeaponDef.tags` exist.
- DPS harness: `tests/dpsharness.ts`; `DPS_MATRIX=1 npx vitest run tests/dps-matrix` prints tables.

## Build, per character
1. **Sprites:** puppy-motif character sprites in the same style and size as the existing four.
   - Idle, walk, dash and hurt.
   - A clearly recognizable breed silhouette and palette:
     - Saint Bernard: big, brown/white, rescue barrel
     - Jindo: white, alert ears, curled tail
     - Border Collie: black/white, a herding crook or bandana
   - Portraits wherever the existing characters have them (character select, lobby, HUD).
2. **Kit:**
   - passive, dash and affinity, with clear visual and audio feedback: register sfx with names prefixed by the character id, e.g. `bori_barrel`
   - a distinct stat profile
   - its own **등불 해방** release with its own spectacle, following the release balance rule. Put the release in the character's own kit file, not `releases.ts`.
   - a **new signature starter weapon** that fits the character, in `src/content/weapons/`, with DPS within the compressed band. Ideas:
     - 보리: a heavy lantern-flail or barrel-cannon
     - 백구: a short counter-blade
     - 모리: a shepherd's crook that flings spirit bolts
3. **Unlocks:**
   - Sensible unlock conditions in `unlocks.ts`, achievable and shown in character select like the existing locked characters. For example:
     - 보리: finish floor 3 in any run
     - 백구: beat a boss without taking damage
     - 모리: clear 60 rooms in total
   - Check how the existing unlocks work and match them.
4. **Character select / lobby / Tab:** must show the new characters properly, with pitch, story, kit strip, affinity, tags and difficulty, on desktop 1280×720 and phone 844×390. Seven characters must fit the carousel nicely.
5. **Tests:** `tests/characters-new.test.ts`.
   - Each kit's mechanics: perfect-dodge window and reflect, barrel healing, herding clumping and companion behaviour.
   - Release damage within the band.
   - Starter weapon DPS within the band.
   - Determinism: add the new characters to the determinism harness if it enumerates characters, and make sure `npx vitest run tests/determinism` passes.

## Verify
- `npx tsc --noEmit` clean. `npm test` passes; failures in the difficulty workstream's files (`presence`/`floors` tests) are not yours, so report them.
- `node scripts/smoke.mjs --character <id>` ok for each new character.
- QA bot: `node scripts/qa-run.mjs --suite custom --char bori,baekgu,mori --god 0 --max-min 8`, or whatever ids you choose; report results.
- Screenshots, which you must look at and iterate on:
  - each character in character select (desktop + phone)
  - passive and dash in action: perfect dodge "간파!" reflect, barrel heal, companions herding a group
  - each release
  - the Tab screen
  - a sprite sheet of all 7 characters side by side, to confirm the style matches the existing four

## Constraints
- Other agents work in the same tree right now:
  - (F) difficulty/balance: `floors.ts`, enemy HP, `releases.ts` numbers, blessings, `handlers.ts`, `qa-run.mjs` suites
  - (D) multiplayer, in a separate worktree, merging later
  - floor-7 content, in separate worktrees
- Keep your changes to new files plus small, local edits to shared files: `defs.ts` only if truly needed, `unlocks.ts`, charselect/lobby/status if layout needs it, and `audio.ts` `SFX_NAMES`.
- Always re-read a file right before editing it, and don't reformat files.
- Ports 5600–5649. Kill only processes you started, by PID. Never `pkill -f` broad patterns.
- No git commands that change state. The orchestrator commits.
- Scratch dir: /tmp/claude-0/-home-user-REPOSI/5b6d1b7f-a03d-5f09-9d18-90f35456395e/scratchpad/newchars/

## Final report
Keep it concise. For each character:
- id, stats, passive, dash, affinity, release, starter weapon (DPS ×starter), unlock condition, and the one-line "why pick"

Then: files changed, test/QA results and screenshot paths.
