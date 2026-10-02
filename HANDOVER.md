# 등불지기 (Lanternkeeper) — 인수인계 문서

작성: 2026-10-02 (UTC). 이 문서 하나로 다른 작업 공간에서 이어서 개발할 수 있도록 정리했다.
기술 규칙의 원본은 **`CLAUDE.md`** (구조·규칙·난이도 표·결정성 규칙)이고, 이 문서는 "지금 어디까지 왔고 무엇을 이어서 하면 되는지"를 다룬다.

---

## 1. 한눈에 보기

| 항목 | 값 |
|---|---|
| 저장소 | https://github.com/sx2xoox/REPOSI |
| 개발 브랜치 | `claude/isaac-seperia-game-12hrqr` (모든 작업은 여기에 커밋) |
| 배포 | GitHub Pages, `gh-pages` 브랜치 → https://sx2xoox.github.io/REPOSI/ |
| 마지막 배포 | `a3464d3` (아이템 미리보기·버리기·Tab 분리까지). **그 이후 작업은 아직 배포 전** |
| 기술 | TypeScript(strict) + Vite + Canvas2D, 외부 에셋 없음(픽셀아트·사운드 전부 코드로 생성), Galmuri 폰트 |
| 규모 | 층 7개 정의(1–7층), 적 정의 65개(보스·소환체 포함), 보스 13종, 무기 42종, 액티브 11종, 축복 22종, 캐릭터 4명(+3명 작업 중), 테스트 파일 33개 |

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

### 진행 중 (이 문서 작성 시점)
| 작업 | 위치 | 상태 |
|---|---|---|
| 층 구조·난이도 표·해방 너프·적 체력 | 메인 작업 트리 (커밋됨, 마무리 중) | 거의 완료. 남은 것 5.1 |
| 새 캐릭터 3명 (보리/백구/모리) | 메인 작업 트리 (부분 커밋) | 진행 중. 5.2 |
| 멀티플레이 월드 + lockstep 연결 | 별도 worktree → `handover/multiplayer-wip.patch`로 보존 | 초반~중반. 5.3 |

---

## 5. 이어서 할 일 (상세)

### 5.1 난이도·해방 마무리
- 구현됨: `DIFFICULTY` 표(1–10층: hpMult, bossHpMult, enemyDamage[regular,heavy], enemySpeed, shotSpeed, budget, championChance, roomCount), `Player.hurt`에서 층별 피해 변환(`enemyHitDamage()`), 층 수 자동 확장, CLAUDE.md 표 갱신, 해방 기준(10–15× 단일 대상).
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
- 이미 생긴 파일(부분): `src/content/characters/{bori.ts, kit-bori.ts, kit-baekgu.ts, kit-mori.ts, kit-common.ts}`, 무기 `src/content/weapons/{lantern-flail.ts, fang-blade.ts, shepherd-crook.ts}`, `src/content/audio/sfx-characters2.ts`, `unlocks.ts` 수정, `SFX_NAMES`에 `bori_* / baekgu_* / mori_*`.
- 남은 것: `baekgu.ts`, `mori.ts` 정의/스프라이트(파일이 없으면 `kit-mori` import 오류로 typecheck 실패 — 가장 먼저 확인), 해방 연출, 해금 조건, 캐릭터 선택·로비·Tab 표시, `tests/characters-new.test.ts`, 결정성 테스트 통과, 스크린샷 검수.
- 원 지시서: `handover/briefs/new-characters.md`

### 5.3 멀티플레이 (2–4인, 방 코드, 무료 P2P)
- **구조(확정)**: 호스트 주도 결정적 lockstep. 모든 기기가 같은 시드로 전체 시뮬레이션을 돌리고 **입력만** 주고받음. PeerJS 무료 시그널링(0.peerjs.com) + Google STUN, 서버 없음. 별 모양(클라이언트는 호스트에만 연결).
- **완료된 기반**
  - `src/net/lockstep.ts` — `LockstepHost.sealFrame(tick, payload, cmds)`, `LockstepClient.sendInput / stepsDue / nextFrame / waitingForHost`, 해시 비교(`shouldHash/submitHash` → `onDesync`), 퇴장 마커, 호스트 끊김.
  - `src/net/wire.ts` — `Frame { tick, inputs[4], commands, joined, left }`, `edgeMergeCodec(4)` (앞 4바이트는 눌림 엣지 OR 병합).
  - `src/net/session.ts` — `startNetRun(session, start)` **← 여기를 실제 멀티 시작으로 교체해야 함** (지금은 각자 싱글 런 시작).
  - `src/game/seam.ts` — `PlayerInput`(17바이트 인코딩), `World.inputSource`; `w.rules`/`fixedRules()`; `src/game/statehash.ts`.
  - 로비 UI(코드 4글자, 공유 링크 `?room=CODE`, 캐릭터 선택, 준비, 시작), 빌드 ID 검사, 서비스워커 자동 갱신.
- **진행 중이던 작업의 보존본**: `handover/multiplayer-wip.patch` (커밋 `f23efb9` 기준 diff, 36개 파일 — `w.players`/맥락 전환 일부, `tests/coop.test.ts`, `tests/coopsim.ts` 등). 적용 방법: `git switch -c mp-wip f23efb9 && git apply handover/multiplayer-wip.patch` 로 기준 시점에 그대로 복원한 뒤, 최신 `claude/isaac-seperia-game-12hrqr`를 merge해서 충돌을 정리하며 이어가는 것을 권장 (또는 최신 브랜치에서 `git apply --3way`). `tests/zz-sp-baseline.test.ts`는 싱글 해시 기준값 확인용 임시 파일. 작업 공간이 바뀌면 원래 worktree는 사라지므로 이 패치가 유일한 사본.
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
