// Room codes: 4 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
// typed by friends or carried in a share link (`?room=CODE`). Pure helpers.

import { PEER_ID_PREFIX, SHARED_URL_PARAMS } from './config';

/** 31 symbols: A-Z without I, L, O plus 2-9 (no 0 / 1). 31^4 ≈ 920k codes. */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

const ALLOWED = new Set(ROOM_ALPHABET);

/** A random room code; `rand` returns [0, 1) (defaults to crypto / Math.random). */
export function randomRoomCode(rand: () => number = defaultRand): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length];
  return s;
}

function defaultRand(): number {
  try {
    const c = globalThis.crypto;
    if (c?.getRandomValues) {
      const a = new Uint32Array(1);
      c.getRandomValues(a);
      return a[0] / 4294967296;
    }
  } catch {
    // fall through
  }
  return Math.random();
}

/**
 * Normalize typed / pasted input into a (possibly partial) room code:
 * upper-cases, drops spaces, dashes and anything outside the alphabet, and
 * accepts a whole pasted share link (`...?room=K7QM`). Max 4 characters.
 */
export function normalizeRoomCode(raw: string): string {
  if (!raw) return '';
  const fromLink = /[?&#]room=([^&#\s]+)/i.exec(raw);
  const src = fromLink ? decodeURIComponent(fromLink[1]) : raw;
  let out = '';
  for (const ch of src.toUpperCase()) {
    if (ALLOWED.has(ch)) {
      out += ch;
      if (out.length >= ROOM_CODE_LENGTH) break;
    }
  }
  return out;
}

/** A complete, valid room code? */
export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ALLOWED.has(ch)) return false;
  return true;
}

/** Apply typed characters ('\b' = backspace) to a partial room code. */
export function applyTypedCode(cur: string, typed: string[]): string {
  let s = cur;
  for (const ch of typed) {
    if (ch === '\b') s = s.slice(0, -1);
    else s = normalizeRoomCode(s + ch);
  }
  return s;
}

/** The signaling-server peer id the host of `code` registers. */
export function roomPeerId(code: string): string {
  return `${PEER_ID_PREFIX}${code}`;
}

/** Room code carried by a URL query string (`?room=K7QM`), or '' when absent / invalid. */
export function roomFromSearch(search: string): string {
  const v = new URLSearchParams(search).get('room');
  if (!v) return '';
  const c = normalizeRoomCode(v);
  return isValidRoomCode(c) ? c : '';
}

/**
 * Share link for a room: the current page (origin + path) with `?room=CODE`,
 * keeping only the params a friend needs to reach the same transport / server.
 */
export function shareLink(code: string, href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return `?room=${code}`;
  }
  const keep = new URLSearchParams();
  for (const k of SHARED_URL_PARAMS) {
    const v = url.searchParams.get(k);
    if (v !== null) keep.set(k, v);
  }
  keep.set('room', code);
  return `${url.origin}${url.pathname}?${keep.toString()}`;
}

/** The query string without `room` (after the share link has been consumed). */
export function searchWithoutRoom(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('room');
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------- nicknames
export const NICKNAME_MAX = 10;

/** Trim, collapse whitespace, strip control / invisible characters, max 10 characters. */
export function sanitizeNickname(raw: string): string {
  let out = '';
  let n = 0;
  for (const ch of (raw ?? '').replace(/\s+/g, ' ')) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || cp === 0xfeff) continue;
    if (n >= NICKNAME_MAX) break;
    out += ch;
    n++;
  }
  return out.trimStart();
}

/** Final form of a nickname (trimmed; empty → fallback). */
export function finalNickname(raw: string, fallback: string): string {
  const s = sanitizeNickname(raw).trim();
  return s || fallback;
}

/** Default nickname: "등불지기" + 3 digits. */
export function defaultNickname(rand: () => number = defaultRand): string {
  return `등불지기${String(Math.floor(rand() * 1000)).padStart(3, '0')}`;
}
