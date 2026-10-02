<!-- 원래 에이전트 지시서 (model: default, isolation: worktree) -->

You are implementing **online co-op for 2–4 players** in 등불지기 (Lanternkeeper), a TypeScript + Vite + Canvas2D roguelike (Isaac-like rooms and items, Sephiria-like feel). All player-facing text is Korean.

## Setup
- You are in your own git worktree, a copy of the repo. The main checkout is /home/user/REPOSI on branch `claude/isaac-seperia-game-12hrqr`.
- Run `ln -s /home/user/REPOSI/node_modules node_modules` in your worktree root if node_modules is missing.
- Read `CLAUDE.md` first: architecture, conventions, and the **Determinism (multiplayer lockstep)** section.

## Already built (read these modules first)
- **Netcode (`src/net/**`), host-paced deterministic lockstep:**
  - `session.ts`
    - `NetSession`: transport, lobby, role, code, roster, localSlot, start, host/client, rtt
    - `startNetRun(session, start)`: the integration hook. **Replace its body.** Today it just starts a single-player run.
  - `lobby.ts`
    - `StartInfo { seed, roster, buildId, inputDelayHint }`
    - `LobbyPlayer { slot, peer, name, characterId, ready, ping, host }`
  - `lockstep.ts`
    - Host: `LockstepHost.sealFrame(tick, localPayload, localCommands?)` returns a `Frame`.
    - Client: `LockstepClient.sendInput(payload)`, `stepsDue()`, `nextFrame()`, `waitingForHost`, `onEnd`, `onDesync`.
    - Both: `submitHash` / `shouldHash`, `sendCommand`.
  - `wire.ts`
    - `Frame { tick, inputs[4], commands[{slot,cmd}], joined, left }`
    - `edgeMergeCodec(4)`: bytes [0,4) are OR-merged edges.
  - `src/ui/lobby.ts`: the lobby scene (already done, with title-menu "함께하기", room code, roster, character pick, ready, start).
  - `scripts/net-e2e.mjs`: e2e over BroadcastChannel (`?net=bc`) and a local PeerServer.
- **Determinism:**
  - `src/engine/dmath.ts`, already installed globally.
  - `src/game/seam.ts`
    - `PlayerInput { mx,my,ax,ay,cx,cy,held,pressed }`
    - `encodeInput` / `decodeInput`: 17 bytes, edges in [0,4)
    - `quantizeInput`
    - `World.inputSource`: fills `Player.input` once per step; the default `readLocalInput` reads the local devices.
  - `w.rules` / `fixedRules({ hitStop })`: the sim never reads live settings.
  - `src/game/statehash.ts`: `stateHash(w)` and `stateHashParts(w)`.
  - Tests: `tests/determinism*.test.ts`, with harness `tests/detsim.ts` / `tests/headless.ts` (headless World + scripted inputs).
- **120 fps interpolation:**
  - `World.update` calls `savePrev()` first.
  - `World.draw(alpha?)`
  - the main loop in `src/main.ts` (`FramePacer.tick`, `renderer.simStep`, `renderer.alpha`)
  - `px/py` are draw-only.

## What to build: the multi-player world and its integration

### 1. N players in one World
- **Players**
  - Add `w.players: Player[]` (slot order) and `w.local` (this peer's player).
  - Keep `w.player` working everywhere. Content references it ~300 times; do not rewrite content.
- **Context switching**
  - The recommended approach: `w.player` is a *context* that the sim sets before running code on behalf of a player.
    - `Player.update`: that player.
    - Each enemy's update and AI script resume: its target, which is the nearest alive player, with a little stickiness. Make `Enemy.target(w)` agree.
    - Item / artifact / blessing hook dispatch: the owner.
    - Projectile hits and on-hit hooks: the projectile owner.
    - Pickups and pedestals: the collector.
    - Room handlers and other world events: the nearest or first alive player, or loop over players where that is correct (e.g. heal everyone).
    - Outside the sim (drawing, UI, HUD): `w.player === w.local`.
  - Restore the context deterministically. Audit core code (`world.ts`, `player.ts`, `enemy.ts`, `projectile.ts`, `pickups.ts`, `items.ts`, `inventory.ts`, `melee.ts`, `effects.ts`, `room.ts`/handlers) for places that must iterate over all players instead, e.g.:
    - enemy bullets and contact damage vs every player
    - explosions
    - hazards
    - door/room transition triggers
    - "room cleared" rewards
- **Per-player state**
  - Each player has own HP, ember, weapons (2 slots), active, potion, artifacts and blessings.
  - If the inventory/stats are world-level today (e.g. `w.items`), make them per-player and keep `w.items` as a context accessor (`w.player`'s inventory) so content keeps working.
- **Shared state**
  - Coins, keys and bombs are a **shared party pool**.
  - Potion identification and run stats are shared.
- **Single-player** must stay byte-for-byte identical in behaviour. The determinism tests' single-player hash sequences should not change unless unavoidable; explain any change.

### 2. Co-op rules (defaults agreed with the user)
- **Rooms and camera**
  - Everyone is in the same room.
  - Walking through an open door moves the whole party (Isaac-style).
  - Each peer's camera follows its own local player in multi-cell rooms.
- **Items**
  - Pedestal items go to whoever takes them with interact.
  - Treasure rooms and boss rewards spawn 1 extra pedestal per extra player. Use `w.rng`; deterministic.
  - Hearts go to whoever touches them, if they need them.
- **Blessings:** at floor start, each player picks their own blessing from their own 3 choices, as a lockstep **command**.
- **Downed and revive**
  - At 0 HP a player is downed: a translucent ghost that can move but not attack or interact, and doesn't take damage.
  - Downed players revive with 1 heart when the room is cleared, or when a teammate stands next to them for ~2 s.
  - All players downed means game over.
- **Scaling**
  - Enemy HP × (1 + 0.5·(n−1)); boss HP × (1 + 0.6·(n−1)), via `w.rules` or a party-size field.
  - Enemy damage unchanged.
- **Teammates:** no friendly fire. Players don't collide with each other. Bombs don't hurt teammates.
- **Pausing and overlays**
  - In multiplayer, pause, Tab and map are overlays that **do not stop the sim**.
  - The pause menu offers 계속 / 설정 / 방 나가기. The host also gets 하강 종료 for everyone, as a command.
  - Artifact discard (`ui/status.ts`) and the blessing pick become lockstep commands. **No local UI may mutate world state directly in multiplayer.**

### 3. Lockstep integration (`startNetRun`)
- Create the World fresh on every peer with the same seed, the roster's characters and party size.
- Set `w.rules = fixedRules(...)`, using the host's settings from `StartInfo`. Extend `StartInfo` if needed; keep it backward compatible.
- **Each fixed step:**
  - Sample local input via the existing local-input code, so touch auto-aim is computed locally and sent as aim.
  - Quantize it with `quantizeInput` / `encodeInput`.
  - Host: `sealFrame`. Client: `sendInput`, then run `stepsDue()` frames.
  - For each frame: decode every slot's payload into that player's `input` (`w.inputSource`), apply the frame's commands, then step the world.
  - A slot in `left` removes that player deterministically (their character fades out).
- Use the interpolation correctly when a client runs 0 or 2 steps in a frame.
- `submitHash` every `shouldHash` tick with `stateHash(w)`. It must cover all players.
- **UI states:**
  - Client waiting for the host for more than 500 ms: "연결 대기 중…" overlay.
  - Desync: a clear message with a 로비로 button. Log `stateHashParts` to the console for diagnosis.
  - Host lost: "방장과의 연결이 끊어졌어요", back to the title.
  - Game over / victory: a party summary, then back to the lobby (same room/roster) or the title.

### 4. HUD and presentation
- Local player: the full HUD as today.
- Teammates: compact panels (name, character face, hearts, ember, downed state).
- In the world:
  - each player gets a name tag and a colour-coded ring/outline (P1 gold, P2 cyan, P3 pink, P4 green)
  - off-screen teammate arrows
  - a downed ghost visual with a revive progress ring
  - an "OO님이 쓰러졌어요" / "OO님이 일어났어요" toast
- Must work on phone layouts (`r.uiSafe`, adaptive UI width) and desktop.
- Sounds: per-player events play for everyone, but screen shake and flash only for the local player's own hits.

### 5. Tests and verification
- **Headless lockstep test** (`tests/coop.test.ts`)
  - 2, 3 and 4 Worlds in node driven through `MemoryTransport` + `LockstepHost` / `LockstepClient` with latency and jitter, plus scripted inputs per player.
  - Several thousand steps across rooms, doors, a boss, a downed/revive, commands (blessing, discard) and a player leaving.
  - Assert identical `stateHash` sequences on all peers.
  - Also assert single-player is unchanged against the existing determinism tests.
- **Browser e2e** (`scripts/coop-e2e.mjs`)
  - 2–4 Playwright pages with `?net=bc`. Create the room, join, start.
  - Each page's bot moves and shoots.
  - Assert no desync events and equal hashes over ~60 s.
  - Screenshots of each page: HUD, teammate panels, name tags, a downed ghost, the waiting overlay, phone layout.
  - Look at the PNGs and fix what looks wrong.
- `npx tsc --noEmit` clean, `npm test` passing, `node scripts/smoke.mjs` ok (single-player), `node scripts/net-e2e.mjs` still passing.

## Coordination and finishing
- Other agents are changing the main checkout in parallel and committing to `claude/isaac-seperia-game-12hrqr`:
  - character identity: `CharacterDef` dash/passive/affinity hooks in `player.ts`/`items.ts`/`defs.ts`, `charselect`, `status`
  - difficulty/balance: `floors.ts`, enemy HP/damage/speed multipliers in `enemy.ts`/`projectile.ts`, `releases.ts`, blessings, `handlers.ts` floor-end
  - new floors: content only
- **Before you finish:**
  - Merge the latest `claude/isaac-seperia-game-12hrqr` into your worktree branch: `git fetch` is not needed, it's the same repository; run `git merge claude/isaac-seperia-game-12hrqr`.
  - Resolve conflicts carefully, preserving both sides' intent. New character passives/dashes must work per player under your context switching.
  - Re-run all tests after the merge.
- Keep core API changes backward compatible and small where possible.
- Use ports 5550–5599. Kill only processes you started, by PID. Never `pkill -f` broad patterns. Keep CPU use moderate on this shared 4-core box.
- **Commit in your worktree branch** with clear messages ending with exactly these two lines, and do not push:
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_015Tf9FEWtBzZ7RSAdXW1yTp`
- Final report, concise:
  - the architecture (context switching rules, per-player vs shared state)
  - the integration flow
  - commands added
  - test results, including the hash-equality evidence
  - screenshot paths
  - known limitations
  - the branch name and the merged-main commit
