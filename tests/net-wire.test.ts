import { describe, expect, it } from 'vitest';
import {
  MAX_INPUT_BYTES, decodeFrame, decodeMessage, edgeMergeCodec, emptyFrame, encodeCommand, encodeDesync, encodeEnd, encodeFrame,
  encodeHash, encodeInput, encodeLeave, encodePing, frameDigest, type Frame,
} from '../src/net/wire';

describe('frame codec', () => {
  it('round-trips inputs, commands, join and leave markers', () => {
    const f: Frame = emptyFrame(123456);
    f.inputs[0] = new Uint8Array([1, 2, 3]);
    f.inputs[2] = new Uint8Array(32).fill(7);
    f.inputs[3] = new Uint8Array(0);
    f.commands.push({ slot: 0, cmd: { type: 'bless', pick: 1 } });
    f.commands.push({ slot: 2, cmd: { type: 'discard', id: '등불' } });
    f.commands.push({ slot: 2, cmd: { type: 'x', nested: { a: [1, 2] } } });
    f.left.push(1);
    f.joined.push(3);
    const back = decodeFrame(encodeFrame(f));
    expect(back.tick).toBe(123456);
    expect([...back.inputs[0]!]).toEqual([1, 2, 3]);
    expect(back.inputs[1]).toBeNull();
    expect([...back.inputs[2]!]).toEqual(new Array(32).fill(7));
    expect(back.inputs[3]!.length).toBe(0);
    expect(back.commands).toEqual(f.commands);
    expect(back.left).toEqual([1]);
    expect(back.joined).toEqual([3]);
    expect(frameDigest(back)).toBe(frameDigest(f));
  });

  it('is compact', () => {
    const f = emptyFrame(5);
    for (let s = 0; s < 4; s++) f.inputs[s] = new Uint8Array(12);
    expect(encodeFrame(f).byteLength).toBe(6 + 4 * (4 + 12));
  });

  it('rejects oversized payloads and malformed data', () => {
    const f = emptyFrame(1);
    f.inputs[0] = new Uint8Array(MAX_INPUT_BYTES + 1);
    expect(() => encodeFrame(f)).toThrow();
    expect(() => encodeInput(1, 0, new Uint8Array(33))).toThrow();
    expect(() => encodeCommand(1, { type: 'big', s: 'x'.repeat(5000) })).toThrow();
    expect(decodeMessage(new ArrayBuffer(0))).toBeNull();
    expect(decodeMessage(new Uint8Array([1, 0, 0]).buffer)).toBeNull();
    expect(decodeMessage(new Uint8Array([99]).buffer)).toBeNull();
  });
});

describe('messages', () => {
  it('round-trip', () => {
    expect(decodeMessage(encodeInput(7, 42, new Uint8Array([9, 8])))).toEqual({ type: 'input', seq: 7, ack: 42, payload: new Uint8Array([9, 8]) });
    expect(decodeMessage(encodeCommand(3, { type: 'bless', pick: 2 }))).toEqual({ type: 'cmd', seq: 3, cmd: { type: 'bless', pick: 2 } });
    expect(decodeMessage(encodeHash(600, 0xdeadbeef))).toEqual({ type: 'hash', tick: 600, hash: 0xdeadbeef });
    expect(decodeMessage(encodeLeave())).toEqual({ type: 'leave' });
    expect(decodeMessage(encodeDesync(60, 2, 1, 0xffffffff))).toEqual({ type: 'desync', tick: 60, slot: 2, hostHash: 1, peerHash: 0xffffffff });
    expect(decodeMessage(encodePing(5))).toEqual({ type: 'ping', id: 5 });
    expect(decodeMessage(encodePing(5, true))).toEqual({ type: 'pong', id: 5 });
    expect(decodeMessage(encodeEnd('kicked'))).toEqual({ type: 'end', reason: 'kicked' });
  });
});

describe('input merge contract', () => {
  const codec = edgeMergeCodec(2);
  it('ORs edge bytes and keeps the latest held bytes', () => {
    const a = new Uint8Array([0b0001, 0, 10, 1]);
    const b = new Uint8Array([0b0100, 0b1, 20, 2]);
    const m = codec.merge(a, b);
    expect([...m]).toEqual([0b0101, 0b1, 20, 2]);
    expect([...a]).toEqual([0b0001, 0, 10, 1]); // inputs untouched
  });
  it('repeats held bytes with edges cleared', () => {
    const r = codec.repeat(new Uint8Array([0xff, 0xff, 5, 6]));
    expect([...r]).toEqual([0, 0, 5, 6]);
  });
  it('copes with short payloads', () => {
    expect([...codec.merge(new Uint8Array([1]), new Uint8Array([2, 3, 4]))]).toEqual([3, 3, 4]);
    expect([...codec.repeat(new Uint8Array([1]))]).toEqual([0]);
  });
});
