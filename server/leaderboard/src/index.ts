// 등불지기 speedrun leaderboard: a Cloudflare Worker in front of one D1 (SQLite) table.
//
//   GET  /v1/health
//   GET  /v1/top?season=1&floor=3&limit=50
//        each device's fastest clear of floors 1..3, fastest first, with that run's per-floor times
//   POST /v1/submit   { season, build, device, runId, name, seed, char, weapon, floor, bossMs, splitMs }
//
// No secrets: the game only knows this Worker's URL. Submissions are checked (shape, plausible
// times, one row per run and floor) and rate limited per device and per (hashed) address.

import { FLOORS, RANK_SQL, RATE_DEVICE, RATE_IP, SCHEMA, TOP_SQL, params, parseFloor, parseLimit, validate } from './logic';

// minimal D1 surface (avoids a dependency on @cloudflare/workers-types)
interface D1Result<T> { results?: T[] }
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1 {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<D1Result<Record<string, unknown>>[]>;
}
export interface Env {
  DB: D1;
  /** comma-separated origins allowed to submit (browsers send Origin on POST) */
  ALLOWED_ORIGINS?: string;
}

const DEFAULT_ORIGINS = 'https://sx2xoox.github.io,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173';

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  schemaReady = true;
}

const origins = (env: Env): string[] => (env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS).split(',').map((s) => s.trim());

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': origins(env).includes(origin) ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function hashIp(ip: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`lanternkeeper:${ip}`));
  return Array.from(new Uint8Array(d).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

const seasonOf = (u: URL): number => {
  const n = Number(u.searchParams.get('season') ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : 1;
};

interface Row { name: string; seed: string; char: string; weapon: string; run_id: string; ms: number; at: number }
interface Part { run_id: string; floor: number; split_ms: number; boss_ms: number }

async function top(env: Env, season: number, floor: number, limit: number) {
  const r = await env.DB.prepare(TOP_SQL).bind(season, floor, limit).all<Row>();
  const rows = r.results ?? [];
  // the per-floor times of each listed run (floors 1..N)
  const parts = new Map<string, { floor: number; splitMs: number; bossMs: number }[]>();
  if (rows.length) {
    const ids = rows.map((e) => e.run_id);
    const q = await env.DB.prepare(`SELECT run_id, floor, split_ms, boss_ms FROM runs WHERE floor <= ?1 AND run_id IN (${params(2, ids.length)}) ORDER BY floor`).bind(floor, ...ids).all<Part>();
    for (const p of q.results ?? []) {
      const l = parts.get(p.run_id) ?? [];
      l.push({ floor: p.floor, splitMs: p.split_ms, bossMs: p.boss_ms });
      parts.set(p.run_id, l);
    }
  }
  return rows.map((e, i) => ({ rank: i + 1, name: e.name, seed: e.seed, char: e.char, weapon: e.weapon, ms: e.ms, at: e.at, floors: parts.get(e.run_id) ?? [] }));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    try {
      await ensureSchema(env);
      if (req.method === 'GET' && url.pathname === '/v1/health') return json({ ok: true, floors: FLOORS }, 200, h);
      if (req.method === 'GET' && url.pathname === '/v1/top') {
        const floor = parseFloor(url.searchParams.get('floor'));
        if (!floor) return json({ error: 'floor' }, 400, h);
        return json({ floor, entries: await top(env, seasonOf(url), floor, parseLimit(url.searchParams.get('limit'))) }, 200, h);
      }
      if (req.method === 'POST' && url.pathname === '/v1/submit') {
        const origin = req.headers.get('Origin');
        if (origin && !origins(env).includes(origin)) return json({ error: 'origin' }, 403, h);
        const text = await req.text();
        if (text.length > 2048) return json({ error: 'size' }, 413, h);
        let body: unknown;
        try { body = JSON.parse(text); } catch { return json({ error: 'json' }, 400, h); }
        const v = validate(body);
        if (!v.ok) return json({ error: v.error }, 400, h);
        const e = v.value;
        const now = Date.now();
        const ip = await hashIp(req.headers.get('CF-Connecting-IP') ?? 'unknown');
        const [byDevice, byIp] = await env.DB.batch([
          env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE device = ?1 AND at > ?2').bind(e.device, now - 60_000),
          env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE ip = ?1 AND at > ?2').bind(ip, now - 60_000),
        ]);
        if (Number(byDevice.results?.[0]?.n ?? 0) >= RATE_DEVICE || Number(byIp.results?.[0]?.n ?? 0) >= RATE_IP) return json({ error: 'rate' }, 429, h);
        await env.DB.prepare('INSERT OR IGNORE INTO runs (season, floor, boss_ms, split_ms, name, seed, device, run_id, char, weapon, build, ip, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)')
          .bind(e.season, e.floor, e.bossMs, e.splitMs, e.name, e.seed, e.device, e.runId, e.char, e.weapon, e.build, ip, now).run();
        // this device's best clear of floors 1..N and where it stands
        const best = await env.DB.prepare('SELECT MIN(split_ms) AS ms FROM runs WHERE season = ?1 AND floor = ?2 AND device = ?3').bind(e.season, e.floor, e.device).first<{ ms: number }>();
        const bestMs = best?.ms ?? e.splitMs;
        const rank = await env.DB.prepare(RANK_SQL).bind(e.season, e.floor, bestMs).first<{ rank: number }>();
        return json({ ok: true, floor: e.floor, bestMs, personalBest: bestMs === e.splitMs, rank: Number(rank?.rank ?? 0) }, 200, h);
      }
      return json({ error: 'not found' }, 404, h);
    } catch (err) {
      return json({ error: 'server', detail: String(err).slice(0, 200) }, 500, h);
    }
  },
};
