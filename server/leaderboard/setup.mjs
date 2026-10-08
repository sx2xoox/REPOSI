// One-time setup (run on your own computer after `npx wrangler login`):
//   cd server/leaderboard && npm install && npm run setup
// Creates the D1 database if it does not exist yet, writes its id into wrangler.toml,
// creates the table, deploys the Worker and prints its URL (give that URL to the game).
// Safe to run again: it reuses the database and redeploys.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DB = 'lanternkeeper-ranking';
const win = process.platform === 'win32';

function wrangler(args, { capture = false } = {}) {
  const r = spawnSync(win ? 'npx.cmd' : 'npx', ['wrangler', ...args], { stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`\n[setup] 실패: wrangler ${args.join(' ')}`);
    if (capture && r.stdout) console.error(r.stdout);
    process.exit(1);
  }
  return r.stdout ?? '';
}

function findDb() {
  const out = wrangler(['d1', 'list', '--json'], { capture: true });
  const start = out.indexOf('[');
  const list = JSON.parse(start >= 0 ? out.slice(start) : '[]');
  return list.find((d) => d.name === DB) ?? null;
}

console.log('[setup] Cloudflare 로그인 확인');
wrangler(['whoami']);

let db = findDb();
if (!db) {
  console.log(`[setup] D1 데이터베이스 ${DB} 생성 (아시아-태평양)`);
  wrangler(['d1', 'create', DB, '--location', 'apac']);
  db = findDb();
}
if (!db?.uuid) {
  console.error('[setup] 데이터베이스 id를 찾지 못했습니다. `npx wrangler d1 list`로 확인해 주세요.');
  process.exit(1);
}
const toml = readFileSync('wrangler.toml', 'utf8').replace(/database_id = "[^"]*"/, `database_id = "${db.uuid}"`);
writeFileSync('wrangler.toml', toml);
console.log(`[setup] wrangler.toml에 database_id 기록: ${db.uuid}`);

console.log('[setup] 테이블 생성');
wrangler(['d1', 'execute', DB, '--remote', '--file=schema.sql', '-y']);

// interactive on purpose: a first deploy may ask to register a workers.dev subdomain (answer Y
// and pick a name); capturing the output would make wrangler answer "no" on its own
console.log('[setup] Worker 배포 (workers.dev 하위 도메인을 물으면 Y를 누르고 이름을 정해 주세요)');
wrangler(['deploy']);
console.log('\n위 출력의 https://lanternkeeper-ranking.<이름>.workers.dev 주소를 알려주시면 게임에 연결합니다.');
console.log('(브라우저에서 그 주소 뒤에 /v1/health 를 붙여 열면 {"ok":true,"floors":7} 이 보여야 합니다. 비밀 값이 아니라 그대로 공유해도 됩니다)');
