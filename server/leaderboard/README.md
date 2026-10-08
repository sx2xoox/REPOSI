# 등불지기 스피드런 온라인 랭킹 서버

Cloudflare Worker + D1(SQLite) 하나로 동작하는 작은 API입니다. 게임은 이 Worker의 주소만 알면 되고,
비밀 키는 게임이나 저장소에 들어가지 않습니다. 무료 플랜으로 충분합니다.

## 처음 한 번 (내 컴퓨터에서)

```bash
npx wrangler login                 # 브라우저에서 Cloudflare 로그인 승인 (이미 했다면 생략)
cd server/leaderboard
npm install
npm run setup                      # DB 생성 → wrangler.toml에 id 기록 → 테이블 생성 → 배포
```

마지막 줄에 `랭킹 서버 주소: https://lanternkeeper-ranking.<계정>.workers.dev` 가 나오면 완료입니다.
그 주소를 게임 설정(`src/net/leaderboard.ts`의 `LEADERBOARD_URL`)에 넣으면 온라인 랭킹이 켜집니다.
주소는 비밀 값이 아닙니다. 로그인 토큰이나 API 키는 어디에도 붙여넣을 필요가 없습니다.

다시 배포할 때는 `npm run deploy`, 처음부터 다시 맞출 때는 `npm run setup`을 다시 실행해도 됩니다(기존 DB를 재사용).

## API

| 요청 | 설명 |
|---|---|
| `GET /v1/health` | 상태 확인 |
| `GET /v1/top?floor=1..7&limit=50&season=1` | N층 랭킹: 1층 시작부터 N층 보스 처치까지 걸린 시간(누적), 기기별 최고 기록만, 빠른 순. 각 항목에 그 런의 층별 시간(`floors`) 포함 |
| `POST /v1/submit` | `{ season, build, device, runId, name, seed, char, weapon, floor, bossMs, splitMs }` — 스피드런 모드에서 N층 보스를 잡을 때마다 게임이 보냄 |

검사: 층 1~7, 보스전 ≥ 5초, 누적 ≥ 층×30초, 누적 ≥ 보스전, 6시간 이하, 닉네임 1~12자(제어·보이지 않는 문자 제거),
같은 런·같은 층은 한 번만 저장, 기기당 분당 20회·주소당 분당 60회 제한, 허용된 출처(`ALLOWED_ORIGINS`)에서만 제출.
IP는 해시 일부만 저장합니다.

## 로컬 테스트

```bash
npm run dev                        # http://127.0.0.1:8787 (로컬 D1)
```
