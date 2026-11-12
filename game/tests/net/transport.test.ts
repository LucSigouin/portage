/** The loopback pair: two ends, a delay, jitter and loss that can be set, and time that only the test moves. */
import { describe, expect, it } from 'vitest';
import { createLoopbackPair } from '../../src/net/index.ts';
import type { Transport } from '../../src/net/index.ts';

function collect(transport: Transport): { messages: unknown[]; closed: number } {
  const box = { messages: [] as unknown[], closed: 0 };
  transport.receive((message) => void box.messages.push(message), () => void (box.closed += 1));
  return box;
}

describe('the loopback pair', () => {
  it('carries a message from each end to the other, as a copy', () => {
    const pair = createLoopbackPair();
    const atHost = collect(pair.host);
    const atGuest = collect(pair.guest);
    const sent = { type: 'state', nested: { value: 1 } };
    pair.host.send(sent);
    pair.guest.send({ type: 'input', seq: 1 });
    sent.nested.value = 99; // changed after sending: the wire took a copy
    expect(atGuest.messages).toEqual([]);
    pair.advance(0);
    expect(atGuest.messages).toEqual([{ type: 'state', nested: { value: 1 } }]);
    expect(atHost.messages).toEqual([{ type: 'input', seq: 1 }]);
    expect(atGuest.messages[0]).not.toBe(sent);
  });

  it('holds a message for the delay, and not a moment less', () => {
    const pair = createLoopbackPair({ delay: 0.2 });
    const atGuest = collect(pair.guest);
    pair.host.send({ n: 1 });
    pair.advance(0.19);
    expect(atGuest.messages).toEqual([]);
    expect(pair.inFlight).toBe(1);
    pair.advance(0.02);
    expect(atGuest.messages).toEqual([{ n: 1 }]);
    expect(pair.inFlight).toBe(0);
  });

  it('with jitter, messages arrive spread out, some out of order, none changed, none lost', () => {
    const pair = createLoopbackPair({ delay: 0.05, jitter: 0.2 }, 3);
    const atGuest = collect(pair.guest);
    for (let n = 0; n < 200; n += 1) {
      pair.host.send({ n });
      pair.advance(0.01);
    }
    pair.advance(1);
    const order = atGuest.messages.map((message) => (message as { n: number }).n);
    expect(order).toHaveLength(200);
    expect([...order].sort((first, second) => first - second)).toEqual(Array.from({ length: 200 }, (_, n) => n));
    expect(order.some((n, index) => index > 0 && n < order[index - 1]!)).toBe(true);
  });

  it('with loss, about that share never arrives, and the same ones every run', () => {
    const run = (): number[] => {
      const pair = createLoopbackPair({ loss: 0.25 }, 5);
      const atGuest = collect(pair.guest);
      for (let n = 0; n < 2000; n += 1) pair.host.send({ n });
      pair.advance(0);
      expect(pair.stats.host.sent).toBe(2000);
      expect(pair.stats.host.lost + pair.stats.host.delivered).toBe(2000);
      return atGuest.messages.map((message) => (message as { n: number }).n);
    };
    const first = run();
    expect(first.length).toBeGreaterThan(1400);
    expect(first.length).toBeLessThan(1600);
    expect(run()).toEqual(first);
  });

  it('with no loss set, loses nothing', () => {
    const pair = createLoopbackPair({ delay: 0.1, jitter: 0.1 });
    const atHost = collect(pair.host);
    for (let n = 0; n < 500; n += 1) pair.guest.send({ n });
    pair.advance(1);
    expect(atHost.messages).toHaveLength(500);
    expect(pair.stats.guest.lost).toBe(0);
  });

  it('lets the line be changed while it runs', () => {
    const pair = createLoopbackPair();
    const atGuest = collect(pair.guest);
    pair.conditions.loss = 1;
    pair.host.send({ n: 1 });
    pair.conditions.loss = 0;
    pair.conditions.delay = 0.5;
    pair.host.send({ n: 2 });
    pair.advance(0.4);
    expect(atGuest.messages).toEqual([]);
    pair.advance(0.2);
    expect(atGuest.messages).toEqual([{ n: 2 }]);
  });

  it('tells the other end once when one closes, and carries nothing after', () => {
    const pair = createLoopbackPair({ delay: 0.1 });
    const atHost = collect(pair.host);
    const atGuest = collect(pair.guest);
    pair.guest.send({ n: 1 });
    pair.guest.close();
    pair.guest.close();
    pair.guest.send({ n: 2 });
    pair.advance(0.2);
    expect(atHost.messages).toEqual([{ n: 1 }]);
    expect(atHost.closed).toBe(1);
    expect(atGuest.closed).toBe(0);
    pair.host.send({ n: 3 });
    pair.advance(1);
    expect(atGuest.messages).toEqual([]);
  });

  it('counts what each end sent, by type and by weight', () => {
    const pair = createLoopbackPair();
    pair.host.send({ type: 'state', step: 1 });
    pair.host.send({ type: 'state', step: 2 });
    pair.host.send({ type: 'events', events: [] });
    expect(pair.stats.host.byType.state).toEqual({ count: 2, bytes: 2 * JSON.stringify({ type: 'state', step: 1 }).length });
    expect(pair.stats.host.byType.events!.count).toBe(1);
    expect(pair.stats.host.bytes).toBe(pair.stats.host.byType.state!.bytes + pair.stats.host.byType.events!.bytes);
    expect(pair.stats.guest.sent).toBe(0);
  });
});
