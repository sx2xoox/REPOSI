# 등불지기 — Lanternkeeper

아이작·세피리아 감성의 탑다운 로그라이크 던전 액션. 모든 그림은 코드로 그린 픽셀 아트,
모든 소리는 WebAudio로 합성합니다(외부 에셋 없음).

## 플레이

```bash
npm install
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
| Tab | 소지품 · 등불 공명 |
| M | 지도 |
| Esc | 일시정지 |

게임패드도 지원합니다.

## 내용

- 강아지 등불지기 4명(리아·베른·세린·니엘), 캐릭터마다 다른 무기와 등불 해방
- 5개 층(지하묘지 · 포자 동굴 · 잿불 대장간 · 얼어붙은 성소 · 공허의 심장), 시드 기반 층 생성
- 일반·보물·상점·보스·비밀·시련·제단·저주의 방, 방 배치 69종 이상
- 일반 적 40여 종, 보스 9종(최종 보스 포함)
- 유물 73종 + 등불 공명 8종, 액티브 11종, 물약 12종, 무기 12종
- 합성 효과음 전체와 배경음악 12곡

## 개발

- `npm run typecheck`, `npm test`
- `node scripts/smoke.mjs --out <dir>` — 헤드리스 봇 스모크 테스트
- `node scripts/sheet-{characters,enemies,items}.mjs out.png` — 스프라이트 시트 렌더링
- 구조와 규칙은 [CLAUDE.md](CLAUDE.md) 참고

폰트: Galmuri (SIL Open Font License 1.1, `src/assets/fonts/GALMURI-LICENSE.txt`).
