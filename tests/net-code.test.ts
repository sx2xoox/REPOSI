import { describe, expect, it } from 'vitest';
import {
  ROOM_ALPHABET, applyTypedCode, defaultNickname, finalNickname, isValidRoomCode, normalizeRoomCode, randomRoomCode,
  roomFromSearch, roomPeerId, sanitizeNickname, searchWithoutRoom, shareLink,
} from '../src/net/code';
import { DEFAULT_PEER_SERVER, netConfigFromSearch } from '../src/net/config';
import { mapPeerError } from '../src/net/transport-peerjs';
import { netErrorText } from '../src/net/transport';

describe('room codes', () => {
  it('uses an alphabet without look-alikes', () => {
    for (const ch of '0O1IL') expect(ROOM_ALPHABET).not.toContain(ch);
    expect(new Set(ROOM_ALPHABET).size).toBe(ROOM_ALPHABET.length);
  });

  it('generates valid 4-character codes', () => {
    let s = 7;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = randomRoomCode(rand);
      expect(c).toHaveLength(4);
      expect(isValidRoomCode(c)).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(1990);
    expect(isValidRoomCode(randomRoomCode())).toBe(true);
  });

  it('normalizes typed and pasted input', () => {
    expect(normalizeRoomCode(' k7 qm ')).toBe('K7QM');
    expect(normalizeRoomCode('k7-qm')).toBe('K7QM');
    expect(normalizeRoomCode('ab')).toBe('AB');
    expect(normalizeRoomCode('o0i1l')).toBe('');
    expect(normalizeRoomCode('abcdefgh')).toBe('ABCD');
    expect(normalizeRoomCode('한글k7qm')).toBe('K7QM');
    expect(normalizeRoomCode('https://x.github.io/lk/?net=bc&room=k7qm#x')).toBe('K7QM');
    expect(isValidRoomCode('K7QM')).toBe(true);
    expect(isValidRoomCode('K7Q')).toBe(false);
    expect(isValidRoomCode('K7QO')).toBe(false);
  });

  it('applies typed characters with backspace', () => {
    expect(applyTypedCode('', ['k', '7', ' ', 'q', 'm', 'z'])).toBe('K7QM');
    expect(applyTypedCode('K7QM', ['\b', '\b', 'a'])).toBe('K7A');
    expect(applyTypedCode('', ['0', 'o', '1'])).toBe('');
  });

  it('builds peer ids and share links', () => {
    expect(roomPeerId('K7QM')).toBe('lanternkeeper-K7QM');
    expect(roomFromSearch('?room=k7qm')).toBe('K7QM');
    expect(roomFromSearch('?room=k7')).toBe('');
    expect(roomFromSearch('?seed=x')).toBe('');
    const link = shareLink('K7QM', 'https://me.github.io/lantern/?net=bc&debug=1&room=OLD#frag');
    expect(link).toBe('https://me.github.io/lantern/?net=bc&room=K7QM');
    expect(shareLink('ABCD', 'http://localhost:5173/')).toBe('http://localhost:5173/?room=ABCD');
    expect(searchWithoutRoom('?net=bc&room=K7QM')).toBe('?net=bc');
    expect(searchWithoutRoom('?room=K7QM')).toBe('');
  });
});

describe('nicknames', () => {
  it('sanitizes', () => {
    expect(sanitizeNickname('  등불 지기  ')).toBe('등불 지기 ');
    expect(finalNickname('  등불 지기  ', 'x')).toBe('등불 지기');
    expect(sanitizeNickname('a\u0000b​c\nd')).toBe('abc d');
    expect([...sanitizeNickname('가나다라마바사아자차카타')].length).toBe(10);
    expect(finalNickname('   ', '기본')).toBe('기본');
  });

  it('defaults to 등불지기 + 3 digits', () => {
    expect(defaultNickname(() => 0.042)).toBe('등불지기042');
    expect(defaultNickname()).toMatch(/^등불지기\d{3}$/);
  });
});

describe('net config', () => {
  it('defaults to the PeerJS cloud with STUN', () => {
    const c = netConfigFromSearch('');
    expect(c.kind).toBe('peerjs');
    expect(c.peer).toEqual(DEFAULT_PEER_SERVER);
    expect(c.iceServers.length).toBeGreaterThan(0);
  });

  it('honors URL overrides', () => {
    expect(netConfigFromSearch('?net=bc').kind).toBe('bc');
    const local = netConfigFromSearch('?peerHost=localhost&peerPort=5150&peerPath=lk');
    expect(local.peer).toMatchObject({ host: 'localhost', port: 5150, path: '/lk', secure: false });
    expect(netConfigFromSearch('?peerHost=peer.example.com').peer).toMatchObject({ secure: true, port: 443 });
    expect(netConfigFromSearch('?ice=none').iceServers).toEqual([]);
    const turn = netConfigFromSearch('?turn=turn:t.example.com:3478&turnUser=u&turnPass=p').iceServers.at(-1);
    expect(turn).toEqual({ urls: 'turn:t.example.com:3478', username: 'u', credential: 'p' });
  });

  it('maps PeerJS errors and has Korean texts', () => {
    expect(mapPeerError('unavailable-id')).toBe('id-taken');
    expect(mapPeerError('peer-unavailable')).toBe('not-found');
    expect(mapPeerError('network')).toBe('network');
    expect(netErrorText('full').title).toBe('방이 가득 찼어요');
    expect(netErrorText('not-found').title).toBe('방을 찾을 수 없어요');
    expect(netErrorText('started').title).toBe('이미 시작된 방이에요');
    expect(netErrorText('version').title).toContain('버전이 달라요');
    expect(netErrorText('timeout').hint).toContain('Wi-Fi');
    expect(netErrorText('host-lost').title).toBe('방장과의 연결이 끊어졌어요');
  });
});
