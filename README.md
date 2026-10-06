# 등불지기 — Lanternkeeper

아이작·세피리아 감성의 탑다운 로그라이크 던전 액션. 코드로 그린 픽셀 아트와
저장소에 포함된 PixelLab 이미지를 사용하며, 소리는 WebAudio로 합성합니다.

## 다른 컴퓨터에서 개발 이어가기

개발 소스는 기본 브랜치 `claude/isaac-seperia-game-12hrqr`에 있습니다.
`gh-pages`는 [공개 게임](https://sx2xoox.github.io/REPOSI/)의 실행 파일만 보관합니다.
현재 소스에는 7층 × 3스테이지, 단조·엘리트·미션방 개편과 자유 보상 분배까지 포함됩니다.

Node.js 24를 사용하세요(`.nvmrc` 포함). Mac의 Apple Silicon·Intel용 의존성은
`package-lock.json`에 포함되어 있으며 `npm ci`가 현재 기기에 맞게 설치합니다.

처음 내려받는 경우:

```bash
git clone --branch claude/isaac-seperia-game-12hrqr https://github.com/sx2xoox/REPOSI.git
cd REPOSI
npm ci
npm run dev
```

이미 내려받았다면, 로컬 작업을 커밋해 보관한 뒤:

```bash
git switch claude/isaac-seperia-game-12hrqr
git pull --ff-only origin claude/isaac-seperia-game-12hrqr
npm ci
npm run dev
```

현재 인수 내용은 [HANDOVER.md](HANDOVER.md) 맨 위부터 확인하세요.
이미지·코드·테스트는 모두 저장소에 포함됩니다. `test-results/`의 과거 검증 결과와
로컬 미리보기는 개발 실행에 필요하지 않으며 Git에 포함하지 않습니다.

## 플레이

```bash
npm ci
npm run dev          # http://localhost:5173
npm run build:single # dist-single/index.html — 파일 하나로 어디서나 실행
```

| 키 | 동작 |
|---|---|
| WASD | 이동 |
| 마우스 / 방향키 | 조준·공격 |
| Space / Shift / 우클릭 | 대시 (무적) |
| E | 폭탄 |
| Q | 액티브 아이템 |
| R | 물약 |
| F | 등불 해방 (불씨 게이지가 가득 찼을 때) |
| G | 줍기 · 구매 (아이템 곁에 서면 설명 카드가 뜬다) |
| Tab | 소지품 · 등불 공명 (Q/E 유물·축복 탭, X 두 번 유물 버리기) |
| M | 지도 |
| Esc | 일시정지 |

게임패드도 지원합니다.

## 내용

- 강아지 등불지기 12명, 캐릭터별 무기·고유 능력·등불 해방과 해금 조건
- 마을·세이브 슬롯·첫 진행 스토리, 7개 층 × 3스테이지의 시드 기반 원정
- 각 층 3스테이지의 보스, 보스 13종과 층별 난이도
- 보물·상점·성소·저주·비밀·시련방, 제련·우물·합성방, 엘리트 및 세 가지 미션방
- 무기·유물·축복 조합과 등불 공명, 플레이어 수에 맞춘 전투와 보상
- 최대 4인 협동 플레이, 자유롭게 분배할 수 있는 바닥 보상
- 검토 중인 신규 무기 20종은 배포판에서 임시 잠금 유지 (`src/game/release-policy.ts`)

## 개발

- `npm run typecheck`, `npm test`
- `node scripts/smoke.mjs --out <dir>` — 헤드리스 봇 스모크 테스트
- `node scripts/qa-run.mjs --suite balance --seeds 3` — QA 봇 밸런스 측정 (층별 방 · 보스 시간, 받은 피해, 해방 비중)
- `node scripts/sheet-{characters,enemies,items}.mjs out.png` — 스프라이트 시트 렌더링
- 구조와 규칙은 [CLAUDE.md](CLAUDE.md) 참고

폰트: Galmuri (SIL Open Font License 1.1, `src/assets/fonts/GALMURI-LICENSE.txt`).
