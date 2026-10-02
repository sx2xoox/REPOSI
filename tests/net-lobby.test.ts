import { describe, expect, it } from 'vitest';
import { MemoryNetwork } from '../src/net/transport-memory';
import { Lobby, type LobbyOptions, type StartInfo } from '../src/net/lobby';
import { NetError, hostRoom, type NetErrorCode } from '../src/net/transport';

const CHARS = ['ria', 'bern', 'niel'];

function opts(net: MemoryNetwork, name: string, extra: Partial<LobbyOptions> = {}): LobbyOptions {
  return { name, buildId: 'build-1', unlocked: CHARS, characterId: 'ria', now: net.now, closeDelayMs: 0, ...extra };
}

/** advance time in 10 ms steps, updating every lobby */
function run(net: MemoryNetwork, lobbies: Lobby[], ms: number): void {
  for (let t = 0; t < ms; t += 10) {
    net.advance(10);
    for (const l of lobbies) l.update();
  }
}

function room(n: number, link = { latencyMs: 25, jitterMs: 10 }) {
  const net = new MemoryNetwork({ seed: 3, ...link });
  const host = Lobby.host(net.hostSync('K7QM'), opts(net, '방장'));
  const clients = Array.from({ length: n }, (_, i) => Lobby.join(net.joinSync('K7QM'), opts(net, `친구${i + 1}`)));
  run(net, [host, ...clients], 300);
  return { net, host, clients, all: [host, ...clients] };
}

describe('lobby protocol', () => {
  it('fills slots 0..3 and shares one roster', () => {
    const { host, clients } = room(3);
    expect(host.roster.map((p) => p.slot)).toEqual([0, 1, 2, 3]);
    expect(host.roster.map((p) => p.name)).toEqual(['방장', '친구1', '친구2', '친구3']);
    expect(host.roster[0].host).toBe(true);
    for (const [i, c] of clients.entries()) {
      expect(c.state).toBe('open');
      expect(c.localSlot).toBe(i + 1);
      expect(c.roster.map((p) => p.name)).toEqual(host.roster.map((p) => p.name));
    }
  });

  it('rejects a fifth player, a different build, and joins after start', () => {
    const { net, host, all } = room(3);
    const reasons: NetErrorCode[] = [];
    const fifth = Lobby.join(net.joinSync('K7QM'), opts(net, '다섯째'));
    fifth.onClosed = (r) => reasons.push(r);
    run(net, [...all, fifth], 300);
    expect(fifth.state).toBe('closed');
    expect(fifth.closeReason).toBe('full');

    const { net: net2, host: host2, all: all2 } = room(1);
    const old = Lobby.join(net2.joinSync('K7QM'), opts(net2, '옛날', { buildId: 'build-0' }));
    run(net2, [...all2, old], 300);
    expect(old.closeReason).toBe('version');
    expect(host2.roster).toHaveLength(2);

    host2.start('SEED-1');
    const late = Lobby.join(net2.joinSync('K7QM'), opts(net2, '늦음'));
    run(net2, [...all2, late], 300);
    expect(late.closeReason).toBe('started');
    expect(reasons).toEqual(['full']);
    expect(host.roster).toHaveLength(4);
  });

  it('validates character picks and tracks ready', () => {
    const { net, host, clients, all } = room(2);
    const [a, b] = clients;
    a.pick('bern');
    b.pick('niel');
    expect(a.me?.characterId).toBe('bern'); // optimistic
    run(net, all, 200);
    expect(host.roster.map((p) => p.characterId)).toEqual(['ria', 'bern', 'niel']);
    expect(b.roster.map((p) => p.characterId)).toEqual(['ria', 'bern', 'niel']);
    a.pick('locked-one');
    run(net, all, 200);
    expect(host.roster[1].characterId).toBe('bern');

    expect(host.canStart()).toBe(false);
    a.setReady(true);
    run(net, all, 200);
    expect(host.canStart()).toBe(false);
    b.setReady(true);
    run(net, all, 200);
    expect(host.canStart()).toBe(true);
    expect(a.roster.every((p) => p.ready)).toBe(true);
    // changing character un-readies
    b.pick('ria');
    run(net, all, 200);
    expect(host.canStart()).toBe(false);
    expect(host.roster[2]).toMatchObject({ characterId: 'ria', ready: false });
  });

  it('sends the same StartInfo to everyone', () => {
    const { net, host, clients, all } = room(3);
    for (const c of clients) c.setReady(true);
    run(net, all, 1500);
    const got: StartInfo[] = [];
    for (const l of all) l.onStart = (info) => got.push(info);
    const info = host.start('ABC-123');
    run(net, all, 300);
    expect(got).toHaveLength(4);
    for (const g of got) expect(g).toEqual(info);
    expect(info.buildId).toBe('build-1');
    expect(info.roster.map((p) => p.slot)).toEqual([0, 1, 2, 3]);
    expect(info.inputDelayHint).toBeGreaterThanOrEqual(1);
    expect(info.inputDelayHint).toBeLessThanOrEqual(4);
    for (const c of clients) expect(c.state).toBe('started');
  });

  it('measures RTT', () => {
    const { net, host, clients, all } = room(1, { latencyMs: 40, jitterMs: 0 });
    run(net, all, 3500);
    expect(clients[0].rtt()).toBeGreaterThan(70);
    expect(clients[0].rtt()).toBeLessThan(110);
    expect(host.roster[1].ping).toBeGreaterThan(70);
    expect(clients[0].roster[1].ping).toBeGreaterThan(70);
  });

  it('handles leaving and the host closing the room', () => {
    const { net, host, clients, all } = room(2);
    clients[0].leave();
    run(net, all, 300);
    expect(host.roster.map((p) => p.slot)).toEqual([0, 2]);
    expect(clients[1].roster.map((p) => p.slot)).toEqual([0, 2]);
    // the freed slot is reused
    const again = Lobby.join(net.joinSync('K7QM'), opts(net, '다시'));
    run(net, [...all, again], 300);
    expect(again.localSlot).toBe(1);
    host.leave();
    run(net, [...all, again], 300);
    expect(clients[1].closeReason).toBe('closed');
    expect(again.closeReason).toBe('closed');
  });

  it('notices a vanished host or client', () => {
    const { net, host, clients, all } = room(2);
    net.cut(clients[0].transport.localId);
    run(net, all, 7000);
    expect(host.roster.map((p) => p.slot)).toEqual([0, 2]);
    net.cut(host.transport.localId);
    run(net, all, 7000);
    expect(clients[1].closeReason).toBe('host-lost');
  });

  it('times out a join without an answer', () => {
    const net = new MemoryNetwork({ latencyMs: 20 });
    const ht = net.hostSync('ABCD');
    const c = Lobby.join(net.joinSync('ABCD'), opts(net, 'x', { joinTimeoutMs: 3000 }));
    void ht; // a raw transport without a lobby never answers
    run(net, [c], 3500);
    expect(c.closeReason).toBe('timeout');
  });

  it('retries hosting on taken codes and reports unknown rooms', async () => {
    const net = new MemoryNetwork();
    net.hostSync('AAAA');
    const codes = ['AAAA', 'AAAA', 'BBBB'];
    const t = await hostRoom(net.factory(), () => codes.shift()!);
    expect(t.code).toBe('BBBB');
    await expect(net.factory().join('ZZZZ')).rejects.toBeInstanceOf(NetError);
    await expect(net.factory().join('ZZZZ')).rejects.toMatchObject({ code: 'not-found' });
  });
});
