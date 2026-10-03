## 2026-10-03 — Expanded refuge, story guidance and optional dungeon branches
- Town now renders on the native world canvas with crypt floor/masonry, combat lighting and the selected keeper's animation. Layout is 768x432 world pixels with camera following, building/planter collision and eight-neighbour click paths. Uses combat moveVector and touch stick; diagonal speed normalized. Services require physically approaching; removed bottom movement instructions and location-title header.
- Residents are cats: Lume (루메), Brik (브릭), Orin (오린), with original procedural world sprites and matching 64x72 animated portraits. Dialogue has stable typewriter wrapping and explicit reveal/advance. Intro and return story start by talking to Lume, not automatically. Chapter objective points to the next resident/service. Expanded 86 story lines explain the refuge, contradictory memories and next action; current objective is also in solo pause/HUD.
- Stage generator now reuses branching floor generation and large rooms instead of fixed 3–4-room layouts. Measured 10–16 rooms over 1,400 layouts, with short optional normal-stage exits and bosses only on stage 4. Main free treasure occurs on stage 1, shop on stage 2, hidden reward room on stage 3; other branches use existing shrine/curse/challenge and new mechanisms.
- New optional rooms: relay (activate numbered lanterns 1→2→3; mistakes reset sequence; 5 coins + soul half-heart), workshop (one shared choice: 2 keys / 2 bombs / restore 2 red hearts), sealed vault (explicitly spend 2 bombs for one treasure pedestal). Shared once-only state persists on revisits and is hashed in mem. Generic entity interaction is exposed through the existing focus card and keyboard/pad/touch use action. Added map names/icons. Shrine buff keys now include stage to avoid collisions between stages.
- Chests retain pickup/cost behavior, with original procedural rounded lids, receding side, feet, riveted bands, distinct padlock and open interior.
- Verification: TypeScript and production build passed; 718 tests passed, 2 optional reports skipped. Browser verified keyboard eight directions, equal diagonal speed, mobile stick and talk, all 86 dialogue lines ≤3 wrapped lines, relay keyboard puzzle and chest rendering, no page errors. Scripted 88-stage campaign preserved 4/5/6/7 return flow, fresh 1-1 starts and once-only story. Co-op browser scenario passed: 32/32 shared hash ticks identical, town pier entry, revive, shared loot, pause/stall, party summary, lobby return, second run, disconnect notice; no console errors. Browser runner waits for transition and simulation progress instead of fixed CPU timing.

## 2026-10-03 — Town visual revision
- Rebuilt cached native-resolution village scenery: staggered hip-roof shingles, plaster/timber/stone foundations, glowing framed windows, keeper workshop awning/tools, archive books/banner, engraved lantern plinth, layered foliage, benches, detailed mooring pier and boat. Residents now have distinct scarves, apron/tools and book details.
- Reduced always-visible service labels, show interaction subtitles nearby, matched player scale to world, added a compact header/footer and time-based chimney smoke/canal glints. Scene art remains cached; animation never touches gameplay RNG.
- TypeScript clean; Chrome checked initial/fully lit town, 844×390 mobile, and departure at 1-1 toward floor 7 with no page errors. Screenshots: test-results/town-redesign*.png.

## 2026-10-03 — Four save slots, village, staged expeditions and first-clear story
- IMPORTANT corrected user intent: expedition one runs 1-1 → 4-4, then returns to town. Expedition two starts fresh at 1-1 and runs through 5-4; then fresh 1-1 → 6-4; then fresh 1-1 → 7-4. Subsequent expeditions can repeat through 7-4. Equipment, artifacts and blessings reset on completed expeditions/death; unlocks and story flags persist per slot. Do NOT resume directly at floor 5/6/7 after a successful return.
- Title logo uses non-bold native pixel glyphs and brighter bottom edges to keep 불 legible. New Game opens four independent browser-local save slots, with registration confirmation; slot one imports legacy unlock/collection/progress/history without deleting legacy keys. Settings remain shared. Save schema: lanternkeeper.slots.v1; campaign stores seen story IDs, highest cleared floor, pending return scene, selected character and interrupted-stage checkpoint.
- Town: procedural pixel square with central departure lamp, keeper selection house, record archive (collection + story replay), three residents with progress-aware optional dialogue and a cooperative pier. Lighting increases after first clears of floors 4–7. Campaign intro, first boss clears and return conversations are in src/game/story.ts. The ending reconciles two overlapping nights but leaves an unclaimed house/nameplate as an in-world mystery, not an upcoming-content notice.
- Production GameScene uses four stages per floor. Stages 1–3 contain normal encounters, an optional reward/service branch and a real passage after the terminal room clears. Stage 4 contains the boss. World startFloor keeps floor-scoped effects through intermediate stages; blessings remain once per floor. Stage participates in layout seeds and multiplayer state hashes. Legacy generateFloor remains for old headless QA callers; production uses generateStage.
- Interrupted single-player expeditions resume at the current stage entrance with its saved equipment/resources/RNG. Pause explicitly labels this checkpoint behavior. Completion or death removes the checkpoint. Checkpoints preserve paid heart-container debt, blessings and permanent stat buffs. They are not mid-combat snapshots. Camp story transitions occur after taking the cleared boss room's passage, allowing reward pickup first.
- Co-op is entered via the town pier (invite links first choose/register a slot), uses all 28 stages, never reads/writes solo story progression and has ordinary party-run results. Existing character unlocks/collection still work. Updated coop-e2e and boss-audit entry paths for the new UI/stages.
- Validation: TypeScript/Vite clean; full suite 710 passed, 2 optional DPS cases skipped. Browser campaign traversal exercised 16/20/24/28-stage successive expeditions (88 total), first-time story flags, fresh builds and town returns. Browser reload restored a 1-2 checkpoint toward floor 6, preserved unlocks, isolated slots and cleared builds on death; desktop/mobile layouts reviewed (test-results/campaign-ui/). Public PeerJS two-player test passed 36/36 common hashes, revival, menus, pause/stall, rewards, lobby return/restart and disconnect; solo story stayed unchanged (test-results/campaign-coop/). Combat traversal checks use automated kills and do not measure human difficulty.

## 2026-10-03 — Boss combat sprite detailing
- Updated all 13 combat boss designs: funeral seals, mourning stole, hanging fungal gills, swallowed royal jewelry, forge exhausts/tool belt, imugi scale plates, knight heraldry, saint stained-glass veil, void cage shackles, manuscript strips, lighthouse chains/porthole, clock escapements and rose overskirt. Details follow existing poses and phase palettes; no extra gameplay entities, RNG or hitbox changes.
- Lighthouse sprite now has 12px top padding with a matching origin offset. Previously the dome/finial and broken phase-two housing were clipped; the waterline and separate rotating lens remain aligned.
- Validation: TypeScript and Vite build passed; 57 boss tests passed. Real Chrome ran 13 bosses at full and 24% HP with clean phase changes/deaths and no runtime errors (test-results/boss-design-audit/). Visually reviewed full sprite sheet and combat screenshots including lighthouse alignment and saint phase-two telegraphs. Before/after sheets: test-results/boss-design-before.png and boss-design-after.png. No combat balance changes.

## 2026-10-03 — Character reference, honest item rules, release-loop balance
- Tab inventory now has a 캐릭터 tab: full passive/dash/release/affinity descriptions, current affinity status, rebound keyboard/gamepad hints and touch labels. Seven characters checked at 1280×720 and 844×390; real Tab/Q/E and touch selection verified. Artifact `detail` text is shown in inventory, preview and collection; previews no longer truncate rules at three lines.
- Text audit corrections include maximum-heart vs current-heart costs, run-only shrine buffs, critical multiplier +0.5 vs +50%, direct-hit exclusions, beam-incompatible relics, hidden proc cooldowns, repeat-release count and throwing-blade limit. Fourteen relics now have extended rules. Changed rules fit their panels (2–3 lines); screenshots and measurement report: test-results/kit-ui/.
- Heart purchases and shrine offerings share one payment rule: spend maximum red containers while leaving at least one, otherwise soul hearts. Persistent per-keeper container debt is applied after the ordinary stat cap; item-granted containers are actually paid, capped stats cannot hide the cost, and soul payment no longer silently takes a container instead. Current-health oath dagger is unchanged.
- Reproduction: reconstructed Niel void_gaze + star/venom/storm loadout with haste/crit/kindle/hunter blessings (exact friend's inventory unknown). Before: 38 manual releases in 60 seconds, minimum gap 0.77s on a boss dummy. Generated shards previously refilled both base ember and fallen_star. Now secondary projectiles do not charge through either path; beam base charging and fallen_star use half weight, fallen_star also respects boss half-charge; bellows grants the stated +40% base direct-hit credit. Kill-triggered charging remains.
- All keepers have a 4-second minimum manual-release interval (gauge may refill during it; no gauge is lost on a denied input); cooldown is shown on HUD/touch and included in multiplayer state hashes. Twin wick still produces its scheduled extra releases.
- Boss stun/freeze maximum 0.35s with a shared 2-second reapplication gate; slow capped at 30%. Existing item-side boss resistance remains. Normal enemies retain full control effects.
- After: three seeded 60s dummy runs yielded 7 releases each, shortest gaps 7.22–8.12s. Extreme 3-copy recharge stack stays at ≤15/min. Actual floor-7 clockmaker/dancer AI against this loadout died after 39.60/38.33s, fired 238/302 projectiles, and spent ~2% of frames hard-controlled. These are invulnerable scripted-player measurements, not human win-rate estimates. Boss HP was not inflated.
- Verification: TypeScript clean, 705 tests passed, 2 optional DPS reports skipped. New 11 balance/payment regressions. Co-op tick hashes agree; final-floor scenario now allows more exploration before forcing its boss so it still covers three rooms under changed combat timings. Browser errors 0. Logs: test-results/kit-final-tests.log, boss-build-audit.log.
## 2026-10-03 — Cycling spike traps
- Spike tiles cycle on deterministic roomTime: down 1.6s, amber warning 0.65s, rise 0.2s, raised 1.1s, retract 0.25s. Only fully raised spikes damage grounded players.
- Cleared rooms immediately retract all spikes and suppress damage, including on revisits. All co-op keepers use the same clock.
- Rendering caches four frames per theme and spike positions per room tile version; no per-frame background repaint or simulation mutation.
- Verification: typecheck, 694 tests passed (2 optional DPS tests skipped), browser screenshots in test-results/spikes with zero page errors.
# 등불지기 (Lanternkeeper) — 인수인계 문서

작성: 2026-10-02 (UTC), 최종 갱신: 모든 작업 중단 시점. 이 문서 하나로 다른 작업 공간에서 이어서 개발할 수 있도록 정리했다.
기술 규칙의 원본은 **`CLAUDE.md`** (구조·규칙·난이도 표·결정성 규칙)이고, 이 문서는 "지금 어디까지 왔고 무엇을 이어서 하면 되는지"를 다룬다.

## 2026-10-03 팀원 투사체 표시 설정

설정 → 화면 → 팀원 투사체 불투명도: 기본 50%, 0–100%를 10% 단위로 조절하고 브라우저에 저장한다. 팀원 소유 Projectile 본체/그림자/그리기 훅/탄환 조명에만 적용하며 내 탄환·적 탄환·캐릭터는 유지한다. 별도로 생성된 파티클/근접 공격/지속 장판의 표시 설정은 포함하지 않는다. draw/light에서만 값을 읽으므로 판정·피해·네트워크 상태에 영향이 없다. 관련 43개 테스트와 타입 검사 통과, Chrome 100/30/0% 및 설정 화면 확인 (`test-results/opacity/`).

## 2026-10-03 실제 온라인 협동 통합

배포 완료: 소스 `6bced55`, GitHub Pages `03c3fe6`, 번들 `index-D9i_yJyw.js`. 공개 주소 https://sx2xoox.github.io/REPOSI/ 에서 2인 실제 협동 60초·해시 61/61 일치·부활·보상·메뉴 중 진행·전원 결과·같은 로비 복귀·재시작·방장 연결 종료 안내를 모두 검증, 오류 0 (`test-results/coop-deployed/report.json`). 방 정원/시작 후 참가 거절/명령 동기화도 BC 및 WebRTC 4인 모두 통과 (`test-results/coop-net-final/report.json`).

이 절이 아래의 과거 기록보다 최신이다. `handover/multiplayer-wip.patch`를 현재 코드에 통합했다. 아래의 “협동 미구현/패치 병합 전” 문구는 이전 상태 기록이다.

- `startNetRun`이 실제 `GameScene + NetRun`을 시작한다. 2–4명이 하나의 월드에서 전투하며, 입력과 축복/유물 버리기/하강 종료/로비 복귀 명령을 host-paced lockstep으로 처리한다. 월드 상태 해시는 매 60틱 비교한다.
- 캐릭터별 체력·무기·유물·축복·해방·소환수·능력 상태와 공용 코인/열쇠/폭탄을 분리했다. 보스/적의 공격은 모든 플레이어를 대상으로 하며, 적은 가까운 생존자를 추적한다. 보물/보스 보상은 인원수에 맞게 추가되고 문/층 이동은 파티 전체가 함께 한다.
- 쓰러진 캐릭터는 이동 가능한 유령이 된다. 동료가 약 2초 곁에 있거나 방을 정리하면 부활한다. 보리는 2배 빠르게 부활시키며 체력 2칸을 준다(최대 체력 제한). 전원 쓰러짐은 패배. 소환수 상한은 플레이어별이며 퇴장한 플레이어의 소환수/탄환은 제거한다.
- HUD 동료 체력/이름표/화면 밖 위치/부활 진행, 연결 대기 및 연결 종료 안내, 파티 결과와 동일 로비 재시작. 멀티의 메뉴/설정/소지품/지도는 시뮬레이션을 멈추지 않는다. 층이 바뀐 동안 열려 있던 이전 축복 선택은 닫아서 오래된 명령을 방지한다.
- 최신 외형/혼합 공명/축복 역할 분배/피격 방향/해방 집계 변경을 보존했다. 소환수 귀속, 개인 축복, 공격자별 아이템 훅을 검증했다.
- 전체 테스트 **691 통과, 선택 DPS 보고 2 제외**, TypeScript와 Vite 빌드 성공. 2/3/4인 지연·지터·패킷 손실·이탈 조건의 틱별 해시 일치. 보리/백구/모리/모리 4인 6층 보스→7층 시나리오는 6,600틱, 26,386개 비교 일치. 공유 자원·부활 속도/체력·유효하지 않은 명령·소환수 분리·퇴장 정리·그리기 순수성 회귀 테스트 포함.
- 로컬 PeerServer/WebRTC 4인 60초: 공통 해시 61/61 일치, 전투/부활/메뉴 중 진행/보상/전원 결과/같은 로비 복귀 통과. `test-results/coop-webrtc/report.json`. PC 및 844×390 모바일 HUD/결과 화면 확인.
- 공개 PeerJS 신호 서버 + 배포용 빌드 4인 60초: 해시 61/61 일치, 부활/보상/메뉴/결과/로비 복귀/동일 연결 재시작/참가자 퇴장 후 지속/방장 이탈 안내 전부 통과, 오류 0 (`test-results/coop-release-final/report.json`). 단일 컴퓨터의 분리된 브라우저 세션이며 신호 서버만 공개 인터넷을 이용했다. 모리 싱글플레이 프로덕션 스모크도 오류 0. 7층 증기 지대/칼날/시계바늘의 모든 플레이어 판정을 추가하고 바늘의 재피격 타이머를 개인별로 분리했다. 7층 협동 동기화 및 다중 피격 회귀 검사 통과. 다른 실제 기기/브라우저 엔진/서로 다른 NAT 조합은 검증하지 않았다. TURN 서버는 설정하지 않았으므로 일부 엄격한 네트워크에서 직접 연결이 안 될 수 있다. 방장 이탈 시 호스트 이전 대신 세션을 끝낸다.

## 2026-10-03 전투·조합 개선 및 배포 전 점검

배포 완료: 2026-10-03(KST), 소스 `26e8a95`, GitHub Pages 커밋 `be078e7`. 공개 주소 https://sx2xoox.github.io/REPOSI/ 에서 신규 번들 `index-C_VWVDjx.js` 반영 확인. 공개 사이트 Chrome 스모크(모리, 게임 시작·전투·특수방 진입) 통과, 오류 0 (`test-results/deployed-smoke/report.json`). 아래 이전 배포/인증 대기 문구는 당시 기록이다.

- 유물 미리보기: 획득 전후 공명 개수, 다음 단계 효과, 중복 유물의 공명 개수 유지 안내. 혼합 공명 3종은 서로 다른 유물로 각 계열 2개씩 필요하다. 온도차(불꽃/서리)는 화상+둔화·빙결 대상 직접 공격 +12%, 깊은 상처(독/피)는 중독+출혈 대상 직접 공격 +12%, 월식(별빛/그림자)은 대시 종료 후 1초까지 직접 치명타 피해 +10%. 발동 피해가 다시 유물 발동을 일으키지 않으며, 유물을 버리면 즉시 조건을 다시 평가한다. 소지품 공명 목록과 결과 화면에서도 조합 표시.
- 축복: 매번 공격/생존/탐험·기동에서 하나씩 제시(남은 계열이 없으면 나머지 풀로 보충). 불씨는 고정 추가량 대신 기본 피해 충전량의 +35%로 변경하여 보스의 충전 감쇠를 유지. 황금은 즉시 8코인 + 방 2개당 1코인. 끌림에 이동 속도 +5%. 쉼터/해방 회복은 빨간 체력 최대 시 영혼 하트를 쌓지 않음; 최대 빨간 체력이 없는 경우 영혼 하트 2칸까지 회복. 설명도 일치시킴.
- 손맛/가독성: 보리 몸통 밀치기 방향성 불꽃, 백구 반격 잔여시간, 모리 양몰이 지점 잔여시간, 정예 적 바닥 테두리/왕관, 피격 방향/체력 손실 표시. 별 발사기 잔광 및 공용 총/지팡이 반동 복귀, 등잔총/서리 지팡이 재질 디테일. 무기 카드에 선호 무기와 기본 능력치 비교 범위 안내. 결과에 무기 이름과 조합 기록.
- 화면 섬광 강도 설정 추가(이전 저장값은 100%). 그리기에서만 적용하며 공격 예고는 유지. 화면 흔들림/피해 숫자는 기존 개별 설정 유지. 결정성 테스트의 낮은 품질 변형은 섬광 0으로 실행.
- 전체 테스트 **675 통과 / 선택 DPS 보고 2 제외**, TypeScript 및 Vite 빌드 성공. 신규 10개 회귀 테스트 포함. 실제 월드에서 3시드×3무기×3빌드(각 24초)를 측정: 불꽃/서리 유물 4종 빌드 단일 대상 평균 약 1.71–1.84배, 공격 축복 3종 빌드 약 1.31–1.45배(기본 대비). 전체 무기 단독 피해 범위 회귀 검사도 통과.
- 성능: `scripts/perf.mjs` 9상황(적25, 보스, 시계장인, 무명, 보리/백구/모리 해방, 모바일 고/중 품질)×2회×8초. 로컬 Chrome 기준 update+draw p95 **1.7–2.5ms**, 8.3ms 초과 0회; 프레임간격 기반 약 82fps, 시뮬레이션 약 60step/s. 실제 120Hz 디스플레이/휴대폰 GPU·발열 검증은 아님. GC 최대 정지 약 4.82ms, 짧은 측정에서 회수 후 힙 +0.5–0.92MB이며 장기 누수 여부를 확정하지 않음. `test-results/perf-review/perf-run.json`.
- 보스: `scripts/boss-audit.mjs` 추가. 13종×일반/변신 단계 각각 30초를 실제 Chrome에서 실행, 모든 단계 전환/사망 처리 통과, 비정상 좌표·엔티티 폭증·실행 오류 없음. 기존 공격 예고/안전지대/사후 소환 방지 테스트도 통과. 무적 상태의 동작 검사이므로 사람이 모든 패턴을 회피할 수 있다는 증명은 아님. `test-results/boss-audit/report.json` 및 26스크린샷.
- 멀티: 로컬 4인 BroadcastChannel 및 PeerJS/WebRTC 각각 방 생성·참가·정원/시작 후 참가 제한·같은 시드 시작·입력 프레임/명령 틱 일치 통과. **실제 협동 월드는 여전히 미구현**: `src/net/session.ts:startNetRun`은 각자 1인 월드를 시작한다. 공개 인터넷/NAT 환경은 미검증. 타이틀 힌트와 로비에 현재 시험 운영 범위를 명시. `test-results/net-review/report.json`.
- QA 집계 오류 수정: `HitInfo.release`/`SwingOpts.release`(선택 필드)로 직접 해방 피해를 명시. 기존 “해방 후 3.6초의 noProc 피해” 추정 제거. 반사탄 및 해방으로 부여된 지속 피해는 이 직접 피해 집계에 포함하지 않는다. QA의 hurt 래퍼가 raw 인자를 누락하던 문제도 수정.
- 변경 후 QA-S1: 보리/백구/모리 전원 1–7층 승리, fallback 0/오류 0. 직접 해방 피해 비중 **15.7% / 14.6% / 8.4%**. 체력 보충 사용 및 단일 완주 시드이므로 정상 난이도 승률·다중 시드 최종 밸런스로 해석하지 말 것. `test-results/qa-balance-final/`.
- PC/모바일 축복·공명 카드·소지품·피격·결과 화면 검사, 실행 오류 0. 이전 캐릭터/적/보스 외형 수정도 포함한 배포를 사용자가 승인함. 현재 GitHub 쓰기 인증 연결 대기 중이며 아직 공개 배포하지 않음.

## 2026-10-03 인수 후 검증 (로컬 변경, 미배포)

아래 본문의 중단 시점 기록보다 이 절의 검증 결과가 최신이다.

- 기존 실패 3건 해결: 모리 `SpiritSheep`의 생성 위치에 쓰던 `fx`를 `w.rng`로 변경, `weapons2` 가상 월드에 `vars` 추가, `presence`의 구 난이도 기대값을 현재 곡선으로 갱신.
- 추가로 Windows / Node 24.19.0에서 native `Math.pow`와 고정 수학 구현 사이에 1 ULP 차이를 확인. 시뮬레이션 구현은 유지했고, 테스트를 native 정확도 비교(최대 1 ULP)와 원본 구현의 고정 SHA-256 결과(283,321개 인자쌍) 검사로 분리했다.
- 타입 검사 및 Vite 배포용 빌드 성공. 전체 테스트 665개 통과 / 선택 실행 DPS 측정 2개 제외; 해당 DPS 측정도 별도로 실행하여 2개 통과.
- 신규 시작 무기의 단일 대상 DPS는 기본 등불 대비 모리 0.99배 / 백구 1.07배 / 보리 1.26배. 신규 캐릭터 능력·해금·해방 테스트 통과.
- 세 신규 캐릭터의 배포용 빌드 스모크 테스트 모두 오류 0건. 캐릭터 7명의 방향·걷기·대시·피격 시트, 소지품 화면, PC 선택 화면을 직접 확인했다. 모바일 844×390 가로 UI와 390×844 세로 회전 안내도 확인했다(Chrome 에뮬레이션, 실제 iOS 검증은 아님).
- `QA-S1` 자동 플레이: 보리·백구·모리 모두 1–7층 승리, 우회(fallback) 0회, 실행 오류 0건. 체력 보충(`--immortal`)을 사용한 진행 검증이며 정상 난이도 완주를 뜻하지 않는다. 런 전체 해방 피해 추정 비중은 보리 15.3% / 백구 31.1% / 모리 25.2%. 목표 20%를 넘는 두 캐릭터는 추가 검증 필요. 현재 QA는 해방 후 3.6초 내 `noProc` 피해를 해방으로 집계하므로 다른 발동·동료 피해 포함 여부부터 확인한 뒤 여러 시드로 측정하고 밸런스를 조정할 것.
- 로컬 검증 자료: `test-results/characters.png`, `test-results/smoke-{bori,baekgu,mori}/report.json`, `test-results/browser-check.json`, `test-results/qa-new/`. 이 경로는 Git에서 제외된다.
- Windows에서도 캐릭터 시트 도구가 Node로 Vite를 실행하도록 수정. 시트·QA 도구도 기존 smoke와 동일하게 `PW_CHROMIUM` 브라우저 경로를 지원한다.
- 외형 다듬기: 캐릭터 7명의 털·주둥이·의상 명암과 금속/천 디테일을 보강. 일반 적 공용 구형 명암은 기본 점무늬 대신 색 면으로 정리하고, 날벌레·해골·박쥐·쥐·망령에 개별 디테일을 추가했다. 적 시트 스크립트도 Windows 및 `PW_CHROMIUM`을 지원. 외형 변경 후 665개 테스트, 타입 검사, 배포용 빌드 통과. 비교 시트는 `test-results/characters-{before,after}.png`, `test-results/enemies-{before,after}.png`.
- 멀티플레이 패치는 아직 병합하지 않았고, 8–10층은 미착수. 전체 캐릭터·여러 시드 밸런스 재측정과 실제 P2P 검증도 남아 있다.
- 보스 외형 다듬기: 13종의 전투 아트에 재질별 명암·균열·판금·서리·렌즈·장식 디테일 추가. 해골 거상·시계장인·태엽 무희는 소개 초상화도 수정. 보스 및 결정성 테스트 63개, 타입 검사, 빌드 통과. 실제 브라우저에서 13종의 일반/변신 단계 26개 화면 확인, 실행 오류 0건 (`test-results/boss-visual-report.json`). 비교 자료는 `bosses-before.png`, `bosses-after.png`, `bosses-live-after.png`, `boss-battle-gallery.png` (모두 `test-results/`). 적 시트에 `bosses`(초상화) / `bosses-live`(전투 스프라이트) 옵션 추가.

---

## 1. 한눈에 보기

| 항목 | 값 |
|---|---|
| 저장소 | https://github.com/sx2xoox/REPOSI |
| 개발 브랜치 | `claude/isaac-seperia-game-12hrqr` (모든 작업은 여기에 커밋) |
| 배포 | GitHub Pages, `gh-pages` 브랜치 → https://sx2xoox.github.io/REPOSI/ |
| 마지막 배포 | `a3464d3` (아이템 미리보기·버리기·Tab 분리까지). **그 이후 작업은 아직 배포 전** |
| 기술 | TypeScript(strict) + Vite + Canvas2D, 외부 에셋 없음(픽셀아트·사운드 전부 코드로 생성), Galmuri 폰트 |
| 규모 | 층 7개 정의(1–7층), 적 정의 65개(보스·소환체 포함), 보스 13종, 무기 42종, 액티브 11종, 축복 22종, 캐릭터 7명(신규 3명은 마무리 전), 테스트 파일 35개 |
| 테스트 현황 (중단 시점) | `tsc` 통과. `vitest` 606 통과 / 2 실패 / 1 파일 로드 오류 — 아래 "중단 시점 상태" 참고 |

### 배포되지 않은 채 브랜치에 쌓여 있는 것 (다음 배포 때 한꺼번에 나감)
- 120fps 보간 렌더링 + "최대 프레임" 설정, 프레임 할당 감소
- 결정적(bit-identical) 시뮬레이션 — 온라인 협동의 기반
- 방 코드 로비(함께하기) + 네트워크 계층 (아직 "같은 시드로 각자 시작"까지만 연결됨)
- 층 수 자동 확장 구조 + 1–10층 난이도 표 + 해방 너프 (마무리 중)
- 캐릭터 개성(고유 능력·전용 대시·선호 무기) + 무기 격차 축소
- 6층 수몰된 서고 / 7층 멈춘 태엽탑 (적·방·음악·보스 각 2종)

> 배포 전 체크: `npx tsc --noEmit`, `npm test`, `npm run build`, 빌드본으로 `node scripts/smoke.mjs --url http://localhost:<port>/` (아래 6장).

---

## 2. 사용자(기획자) 요구사항과 취향 — 반드시 지킬 것

- **아이작·세피리아 "수준의 퀄리티와 손맛"**, 하지만 **이름·시스템·그림·소리는 전부 오리지널**. 세피리아식 석판(슬레이트) 시스템은 넣지 않는다(사용자가 명시적으로 거부).
- **모든 플레이어 대상 텍스트는 한국어.** 사용자와의 대화도 **한국어로**.
- **플레이 캐릭터는 전부 강아지 모티브** (리아=골든리트리버, 베른=허스키, 세린=비글, 니엘=검은 포메라니안, 신규: 보리=세인트버나드, 백구=진돗개, 모리=보더콜리). 사람 이름처럼 들리는 이름은 피한다(예: "한결" → "백구"로 변경됨).
- 모바일(아이폰 16e 포함 모든 폰) 전체 화면 대응, 터치 조작(자동 조준 공격 버튼 기본), PC 120fps 끊김 없이.
- 소울나이트 같은 느낌: 무기 2슬롯 + 교체, 층 시작 축복 선택. **유물 하나하나의 효과는 크지 않되 존재감은 크게**(시각 흔적·발동 피드백).
- **캐릭터 존재감 > 무기 존재감** (최근 요청으로 무기 격차를 0.9–1.3배로 압축, 캐릭터 고유 능력 강화).
- 난이도는 **층에 비례해 확실히 상승**. 해방(F)은 "한 방 폭발/군중 제어"지 보스 딜 수단이 아님.
- 10층까지 **천천히, 퀄리티 유지하며** 확장. 두 모델(Opus/Fable)로 나눠 만들 때 품질 차이가 티 나지 않게 — 합치기 전 기존 층과 나란히 스크린샷 비교.
- 비용 의식이 있음: 진행 상황·남은 시간을 물어보면 솔직하게 답할 것.

---

## 3. 현재 게임 구성

### 핵심 시스템
- **등불 해방(F)**: 피해를 주면 불씨 게이지가 차고, 가득 차면 캐릭터 고유 필살기. 기준: 단일 대상 `stats.damage`의 약 10–15배, 런 전체 피해의 20% 이하.
- **등불 공명**: 유물 태그가 겹치면 단계별 보너스. 같은 유물 중복 시 `power` 증가.
- **유물의 흔적**: 모든 유물에 `look`(탄 색·궤적·오라 등)과 `proc` 피드백 필수 — `tests/presence.test.ts`가 강제.
- **등불의 축복**: 매 층 시작 시 3개 중 1개 선택(22종).
- 아이작식 층: 시작/일반/보물/상점/보스/비밀/도전/제단/저주 방, 열쇠·폭탄·동전·하트(빨강+영혼), 미확인 물약, 액티브 아이템.
- 무기 2슬롯 + 교체(C/휠/패드), 아이템 근처 미리보기 카드, G로 줍기, Tab에서 유물 버리기(2번 눌러 확정), Tab 화면 유물/축복 탭 분리.

### 층
| 층 | 이름 | 상태 |
|---|---|---|
| 1 | 잊혀진 지하묘지 | 완료 (보스: 해골 거상, 조종지기) |
| 2 | 포자 동굴 | 완료 (점액 여왕, 포자 어미) |
| 3 | 잿불 대장간 | 완료 (사슬 대장장이, 쇳물 이무기) |
| 4 | 얼어붙은 성소 | 완료 (서리 기사단장, 빙결 성녀) |
| 5 | 공허의 심장 | 완료 (무명 — 1막 피날레. 마지막 층이 아니면 보상+다음 층 문) |
| 6 | 수몰된 서고 | 완료, 미배포 (대서기관, 가라앉은 등대) |
| 7 | 멈춘 태엽탑 | 완료, 미배포 (시계장인, 태엽 무희) |
| 8 | 결정 광맥 | **미착수** — 지시서 `handover/briefs/floor8-*.md` |
| 9 | (안) 진홍 정원 | 미착수 — 아래 5.4 |
| 10 | (안) 등불의 근원 | 미착수 — 최종 보스, 아래 5.4 |

"가장 깊은 정의된 층 = 마지막 층" 구조라서 층 파일을 추가하면 자동으로 런이 길어진다(`lastFloorIndex()`/`isLastFloor()` in `src/game/defs.ts`). 난이도 값은 `src/content/floors.ts`의 `DIFFICULTY[n]`을 펼쳐 쓴다(표는 CLAUDE.md).

### 캐릭터 (고유 능력 / 대시 / 선호 무기)
| 캐릭터 | 고유 능력 | 대시 | 선호 무기 |
|---|---|---|---|
| 리아 (골든리트리버) | 불씨 심지: 해방 게이지 +40%, 4타마다 불꽃 폭발 | 불씨 질주(불길 남김) | 없음(균형형) |
| 베른 (허스키) | 기세: 연속 적중마다 공·이속 증가(최대 5) | 설원 돌진(관통 타격) | 근접 |
| 세린 (비글) | 사냥 감각: 표식(받는 피해 +12%), 멀쩡한 적 첫 타 치명 | 도약(착지 후 첫 타 치명) | 활·쇠뇌 |
| 니엘 (검은 포메) | 공허 메아리: 4번째 공격마다 추적 메아리 | 공허 걸음(순간이동+균열) | 마법 |
| 보리 / 백구 / 모리 | **작업 중** — 아래 5.2 | | |

캐릭터 키트는 콘텐츠 파일만으로 추가 가능: `CharacterDef.passive / dash / affinity / playstyle / difficulty / pitch / releaseName` (`src/game/defs.ts`), 예시 `src/content/characters/kit-*.ts` + `<id>.ts`.

---

## 4. 작업 현황

### 완료 (브랜치에 커밋됨)
- 기본 게임 전체(1–5층, 적·보스·유물·무기·UI·사운드·음악), 모바일·PWA, 화면 꽉 채우기, 자동 조준
- 아이템 미리보기·G 줍기·유물 버리기·Tab 분리 (배포됨)
- 120fps 보간 렌더링, 결정적 시뮬레이션(dmath·입력 seam·state hash·결정성 테스트)
- 네트워크 계층 + 로비 UI (`src/net/**`, `src/ui/lobby.ts`)
- 캐릭터 개성 패스, 무기 압축
- 6층·7층 콘텐츠 + 보스 4종

### 중단 시점 상태 (사용자 요청으로 모든 에이전트 중단, 전부 커밋·푸시됨)
| 작업 | 위치 | 상태 |
|---|---|---|
| 층 구조·난이도 표·해방 너프·적 체력 | 브랜치에 커밋됨 | 구현 완료, **최종 검증(밸런스 봇 측정·테스트 정리) 직전에 중단**. 5.1 |
| 새 캐릭터 3명 (보리/백구/모리) | 브랜치에 커밋됨 | 정의·키트·무기·사운드 파일 모두 존재, **테스트 2건 실패 상태로 중단**. 5.2 |
| 멀티플레이 월드 + lockstep 연결 | `handover/multiplayer-wip.patch` (기준 `f23efb9`) | **핵심 구현 완료**(별도 브랜치에서 tsc 통과, 2·3·4인 동기화 테스트 통과), **최신 브랜치와 병합 전**. 5.3 |
| 8층 | 지시서만 | 착수 직후 중단(산출물 없음). 5.4 |

중단 시점 테스트 실패 3건 (모두 진행 중이던 작업의 미완 부분):
1. `tests/presence.test.ts` "enemy hp grows gently per floor" — 1층 hpMult=1을 기대하나 새 난이도 표는 1.3. 테스트를 새 곡선 기준으로 갱신하면 됨.
2. `tests/weapons2.test.ts` 파일 로드 오류 `Cannot read properties of undefined (reading '__bgCounterUntil')` — 백구 키트(`kit-baekgu.ts`)나 새 무기 파일이 모듈 로드 시점에 `w.vars`류를 읽는 것으로 보임. 해당 접근을 훅 안으로 옮기면 됨.
3. `tests/determinism-chars.test.ts` "mori: floor 1" — **0번째 스텝부터** fx 시드/화면 폭/품질에 따라 해시가 달라짐 → 모리 동료(영혼 양) 생성이나 초기 상태에 `fx`/화면 의존 값이 들어감. 결정성 규칙(CLAUDE.md) 위반이니 동료 엔티티 생성 경로 점검.

---

## 5. 이어서 할 일 (상세)

### 5.1 난이도·해방 마무리
- 구현됨: `DIFFICULTY` 표(1–10층: hpMult, bossHpMult, enemyDamage[regular,heavy], enemySpeed, shotSpeed, budget, championChance, roomCount), `Player.hurt`에서 층별 피해 변환(`enemyHitDamage()`), 층 수 자동 확장, CLAUDE.md 표 갱신, 해방 기준(10–15× 단일 대상).
- 에이전트는 "밸런스 봇으로 최종 빌드 측정 → 해방 측정 → 테스트·스모크" 단계 직전에 중단됨. 아래를 이어서 하면 된다.
- 확인할 것:
  - `tests/presence.test.ts` "enemy hp grows gently per floor"가 1층 hpMult=1을 기대하는데 표는 1.3 → 테스트를 새 곡선 기준으로 갱신.
  - `tests/floors.test.ts` 보스 시간 검사(가라앉은 등대 62초 등) 기준 조정 여부.
  - QA 봇(god 끔)이 1–2층 보스에서 죽는 경우가 있었음 → `node scripts/qa-run.mjs --suite balance --seeds 3`로 층별 방/보스 시간·피해 재측정 후 미세 조정. 1층은 신규 유저에게 친절해야 함.
  - 7–10층 수치는 외삽값 → 8–10층 콘텐츠가 생기면 재측정.
- 원 지시서: `handover/briefs/difficulty-10floors.md`

### 5.2 새 캐릭터 3명
- 컨셉(사용자 승인):
  - **보리 (세인트버나드)** 구조견 탱커/서포터 — 고체력·느림, 목의 구조 술통으로 회복/보호막, 대시는 짧고 무거운 몸통 밀치기(전방 탄 차단). 협동용 데이터 필드 `coop: { reviveSpeed, reviveHearts }` (멀티 코드가 읽을 예정).
  - **백구 (흰 진돗개)** 반격의 달인 — 피격 직전 대시 = 완벽 회피 "간파!" → 주변 적탄 반사 + 강한 반격. 저체력, 고수용.
  - **모리 (보더콜리)** 몰이꾼 — 영혼 동료 2–3마리, 적을 한데 몰수록 추가 피해, 위치 선정형.
- 이미 있는 파일: `src/content/characters/{bori.ts, baekgu.ts, mori.ts, kit-bori.ts, kit-baekgu.ts, kit-mori.ts, kit-common.ts}`, 시작 무기 `src/content/weapons/{lantern-flail.ts (보리), fang-blade.ts (백구), shepherd-crook.ts (모리)}`, `src/content/audio/sfx-characters2.ts`, `unlocks.ts` 수정, `SFX_NAMES`에 `bori_* / baekgu_* / mori_*`, 테스트 `tests/characters-new.test.ts`, `tests/determinism-chars.test.ts`. typecheck 통과.
- 에이전트는 "사운드와 세 캐릭터 정의 파일(스프라이트+정의) 작성" 단계에서 중단 → 스프라이트 완성도·해방 연출·캐릭터 선택/로비/Tab 표시는 **스크린샷으로 직접 검수 필요**.
- 남은 것: 위 테스트 실패 2건(weapons2 로드 오류, 모리 결정성) 수정, 해방 피해량 기준(10–15×) 확인, 시작 무기 DPS 0.9–1.3배 확인(`DPS_MATRIX=1 npx vitest run tests/dps-matrix`), 해금 조건 확인, QA 봇(`--char bori,baekgu,mori`), 7명 캐릭터 시트 스크린샷으로 기존 4명과 화풍 비교.
- 원 지시서: `handover/briefs/new-characters.md`

### 5.3 멀티플레이 (2–4인, 방 코드, 무료 P2P)
- **구조(확정)**: 호스트 주도 결정적 lockstep. 모든 기기가 같은 시드로 전체 시뮬레이션을 돌리고 **입력만** 주고받음. PeerJS 무료 시그널링(0.peerjs.com) + Google STUN, 서버 없음. 별 모양(클라이언트는 호스트에만 연결).
- **완료된 기반**
  - `src/net/lockstep.ts` — `LockstepHost.sealFrame(tick, payload, cmds)`, `LockstepClient.sendInput / stepsDue / nextFrame / waitingForHost`, 해시 비교(`shouldHash/submitHash` → `onDesync`), 퇴장 마커, 호스트 끊김.
  - `src/net/wire.ts` — `Frame { tick, inputs[4], commands, joined, left }`, `edgeMergeCodec(4)` (앞 4바이트는 눌림 엣지 OR 병합).
  - `src/net/session.ts` — `startNetRun(session, start)` **← 여기를 실제 멀티 시작으로 교체해야 함** (지금은 각자 싱글 런 시작).
  - `src/game/seam.ts` — `PlayerInput`(17바이트 인코딩), `World.inputSource`; `w.rules`/`fixedRules()`; `src/game/statehash.ts`.
  - 로비 UI(코드 4글자, 공유 링크 `?room=CODE`, 캐릭터 선택, 준비, 시작), 빌드 ID 검사, 서비스워커 자동 갱신.
- **구현 보존본**: `handover/multiplayer-wip.patch` — 커밋 `f23efb9` 기준 전체 diff (54개 파일, +3182/−364). 이 작업 공간(worktree)은 GitHub에 없으므로 **이 패치가 유일한 사본**.
  - 포함된 것(에이전트 커밋 메시지 요약): World에 `players`/`local`/맥락 플레이어(엔티티·훅·피격·줍기마다 `w.player` 전환, `w.items`/`w.vars`/`w.flow`/`w.focus`도 따라감), 공용 지갑, 쓰러짐 유령·부활, 인원수 체력 보정, 추가 받침대, 파티 문 이동, 월드별 엔티티 id(싱글 해시 불변), `NetRun`(입력·명령·해시·동기화 오류·호스트 끊김), 협동 HUD(동료 패널·이름표·화살표·토스트), 일시정지 메뉴, 대기 오버레이, 파티 결과 화면 후 같은 로비로 복귀, `tests/coop.test.ts`, `tests/coopsim.ts`, `scripts/coop-e2e.mjs`. 마지막 미커밋분은 콘텐츠(보스·적 파일 21개)의 조준 대상을 맥락 플레이어 기준으로 바꾸던 작업.
  - 중단 시점 검증: 그 브랜치에서 `tsc` 통과, `tests/coop.test.ts` 7개 통과(2·3·4인, 퇴장 포함 — 모든 피어 stateHash 동일), `tests/determinism.test.ts` 통과.
  - 적용 방법: `git switch -c mp-wip f23efb9 && git apply handover/multiplayer-wip.patch` → 테스트 확인 → 최신 `claude/isaac-seperia-game-12hrqr`를 merge. 충돌 예상 지점: `src/game/player.ts`·`items.ts`·`defs.ts`(캐릭터 키트 패스와 겹침), `src/audio/audio.ts`, 6·7층 콘텐츠 파일. 병합 후 새 캐릭터 고유 능력·대시가 플레이어별로 동작하는지, 보리의 `coop.reviveSpeed` 연결, `scripts/coop-e2e.mjs`(2–4페이지 브라우저 테스트)와 스크린샷 검수까지 하면 완료. `tests/zz-sp-baseline.test.ts`는 싱글 해시 기준값 확인용 임시 파일(정리 대상).
- **남은 설계(사용자와 합의된 규칙)**
  - `w.players[]` + `w.local`, **`w.player`는 "현재 맥락의 플레이어"**: 플레이어 업데이트=본인, 적 업데이트=가장 가까운 생존 플레이어, 아이템 훅=소유자, 투사체=발사자, 줍기=수집자, UI=로컬. 콘텐츠의 `w.player` 300여 곳을 고치지 않기 위한 핵심 아이디어.
  - 체력·불씨·무기·유물·축복은 개인, **동전·열쇠·폭탄은 공용**.
  - 같은 방에 모두 있음, 문 통과 시 전원 이동, 카메라는 각자 자기 캐릭터.
  - 보물방·보스 보상 받침대 인원수만큼, 축복은 각자 선택(lockstep 명령).
  - 쓰러지면 유령(이동만), 방 클리어 또는 동료 옆 2초 → 하트 1칸 부활. 전원 쓰러지면 게임 오버.
  - 적 체력 ×(1+0.5(n−1)), 보스 ×(1+0.6(n−1)). 아군 피해·충돌 없음.
  - 멀티에서는 일시정지·Tab·지도가 시뮬레이션을 멈추지 않음. 유물 버리기·축복 선택 등 UI가 월드를 바꾸는 동작은 전부 lockstep 명령으로.
  - HUD: 동료 패널(이름·얼굴·하트·불씨), 이름표 색(P1 금/P2 청록/P3 분홍/P4 초록), 화면 밖 화살표, 쓰러짐/부활 토스트, "연결 대기 중…", 동기화 오류 화면.
  - 테스트: MemoryTransport로 2–4개 World를 노드에서 돌려 해시 동일성 검증(`tests/coop.test.ts`), Playwright 2–4페이지 `?net=bc` e2e(`scripts/coop-e2e.mjs`).
- 한계: TURN 서버 없음(일부 모바일 데이터망에서 직접 연결 실패 가능 → `src/net/config.ts`의 `TURN_SERVERS` 또는 URL 파라미터), 0.peerjs.com은 이 컨테이너에서 막혀 있어 로컬 PeerServer로만 시험됨.
- 원 지시서: `handover/briefs/multiplayer-integration.md`

### 5.4 8–10층
- 8층 **결정 광맥**: 지시서 2개 그대로 사용 가능 — `handover/briefs/floor8-theme-enemies.md`, `floor8-bosses.md` (보스 안: 보석 세공사, 정동 거북). 접두사 `prism`, sfx `prism_` / `prismboss_`, 음악 `floor8` / `boss_prism`.
- 9층 (안) **진홍 정원**: 가시·꽃·꽃가루, 진홍/짙은 녹색/뼈 흰색 팔레트(기존 층과 겹치지 않게). 메커닉 예: 피어나는 패턴, 덩굴 구역 제어. 보스 2종.
- 10층 (안) **등불의 근원**: 흰빛·금빛 원초의 불꽃, 최종 보스(예: "꺼지지 않는 자" — 최초의 등불지기). 최종 승리 연출은 마지막 층 보스에 자동 연결됨(`isLastFloor`).
- 7층 지시서(`handover/briefs/floor7-*.md`)를 템플릿으로 층 이름·팔레트·접두사만 바꿔 쓰면 된다.
- 교훈: 병렬 작업 시 sfx 이름은 반드시 층별 접두사(중복 이름 `ink_splash` 충돌 사례). 보스는 `bossFloors`, 일반 적은 `floors`. 투사체 `mem`에 `fx` 값 금지(결정성 깨짐 사례). 적 추가로 결정성 테스트 시드 커버리지가 바뀌면 시드 재조정.

### 5.5 그 밖의 TODO
- 성능: 업데이트 경로 할당(스텝당 ~38KB: `Enemy.update` ~12KB, `Projectile.update` ~5KB, `input.update`가 매 스텝 Set 생성), 아이템 배너 텍스트 매 프레임 재그리기, 니엘 해방 중 8.3ms 초과 프레임 5%.
- 던전 생성기가 2x2 방을 사실상 만들지 않음(이웃 규칙) — 의도라면 무시, 아니면 `dungeon.ts` 확인.
- 10층으로 길어진 런 → 모바일용 "층 시작 시점 이어하기(저장)" 검토 가치 있음(사용자 미요청, 제안만).
- `scripts/perf.mjs`를 CLAUDE.md 명령 목록에 추가.

---

## 6. 실행·테스트·배포

```bash
npm install
npm run dev                         # 개발 서버
npx tsc --noEmit                    # 타입 검사 (항상 깨끗해야 함)
npm test                            # vitest (부하가 크면 --maxWorkers=2; 타임아웃은 단독 재실행으로 확인)
npx vitest run tests/determinism    # 결정성 검사 (시뮬레이션 코드 고치면 필수)
node scripts/smoke.mjs --out /tmp/smoke --seconds 15 [--character <id>] [--url <빌드 미리보기 URL>]
node scripts/qa-run.mjs --suite balance --seeds 3   # 밸런스 측정 봇
node scripts/perf.mjs --out /tmp/perf [--hz 120]    # 성능 측정
node scripts/net-e2e.mjs --mode all --players 4     # 로비/네트워크 e2e
node scripts/sheet-enemies.mjs out.png [floor]      # 적 스프라이트 시트
```
브라우저 콘솔 디버그: `window.__lk` (`start(seed, char)`, `god()`, `give(id)`, `spawn(id,x,y)`, `killAll()`, `gotoRoom(kind)`, `gotoFloor(n)`, `nextFloor()`, `state()`), `window.__lkAutoBless = true`(축복 자동 선택).

### GitHub Pages 배포 (gh-pages 브랜치에 dist만 올림)
```bash
npm run build && touch dist/.nojekyll
git fetch origin gh-pages
export GIT_INDEX_FILE=/tmp/ghp.index && rm -f $GIT_INDEX_FILE
git --work-tree=dist add -A .
tree=$(git write-tree); parent=$(git rev-parse origin/gh-pages)
commit=$(echo "Deploy $(git rev-parse --short HEAD)" | git commit-tree $tree -p $parent)
unset GIT_INDEX_FILE
git push origin $commit:refs/heads/gh-pages
```
저장소 Settings → Pages → Source: `gh-pages` / root. 빌드는 상대 경로(`base: './'`)라 하위 경로에서도 동작. 서비스워커가 새 빌드를 감지하면 타이틀 화면에서 자동 새로고침(멀티는 빌드 ID가 같아야 입장 가능).

---

## 7. 코드 구조 요약 (자세한 건 CLAUDE.md)
- `src/engine/` 범용(렌더러 384x216 월드 + UI 레이어, 스프라이트, 조명, 파티클, 입력, 저장, `pacing.ts` 프레임 페이서, `dmath.ts` 결정적 수학)
- `src/game/` 규칙(`defs.ts` 모든 콘텐츠 인터페이스·레지스트리, `world.ts`, `player.ts`, `items.ts`, `dungeon.ts`, `seam.ts`, `statehash.ts`, `interp.ts`)
- `src/content/**` 모든 콘텐츠 — 파일을 추가하면 자동 등록(`import.meta.glob`)
- `src/net/**` 네트워크, `src/ui/**` 화면들, `scripts/` 자동화, `tests/` vitest
- 반드시 지킬 규칙: 결정성(게임플레이 난수는 `w.rng`, 연출은 `fx`, 시뮬레이션에서 시간·화면·설정 읽지 않기), 위험한 공격은 모두 예고, 적 탄은 고대비, 한국어.

---

## 8. 작업 방식 메모 (AI 에이전트로 이어갈 때)
- 큰 작업은 에이전트에 **상세 지시서**로 맡기고, 파일 소유권을 명확히 나눔(같은 트리 동시 작업 시 "편집 직전 다시 읽기, 작게 고치기"). 콘텐츠(층·보스)는 **worktree 격리** 후 메인에 병합 — 충돌은 주로 `src/audio/audio.ts`의 `SFX_NAMES`/`MUSIC_IDS` 한 줄.
- 합치기 전 반드시 스크린샷을 직접 보고 기존 층과 품질 비교.
- 이 저장소의 원래 규칙상 커밋 메시지 끝에 공동 작성자/세션 줄을 붙였음(새 환경 규칙에 맞게 조정).
- 4코어 머신에서 동시 에이전트 5개 이상은 테스트 타임아웃·성능 측정 노이즈 유발 → 3–4개 권장.
- `handover/briefs/`에 실제 사용했던 지시서 원문이 있음 — 다음 작업 지시서의 템플릿으로 재사용.
