/**
 * The name an address is counted under for the dial limit. Plain logic: no Worker is started here.
 * The limit itself is tested on the real Worker, in worker.test.ts. Run: npm test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DIALS_PER_MINUTE, DIAL_WINDOW_SECONDS, dialKey } from '../src/dial.ts';

describe('the name an address is counted under', () => {
  it('is the address itself for IPv4', () => {
    assert.equal(dialKey('203.0.113.7'), '203.0.113.7');
    assert.equal(dialKey(' 203.0.113.7 '), '203.0.113.7');
    assert.notEqual(dialKey('203.0.113.7'), dialKey('203.0.113.8'));
  });

  it('is the first 64 bits for IPv6, however the address is written', () => {
    const line = '2001:db8:0:51::/64';
    for (const address of [
      '2001:db8:0:51::1', '2001:db8:0:51:ffff:ffff:ffff:9', '2001:0DB8:0000:0051:0000:0000:0000:0001', '2001:db8::51:0:0:0:1',
      '[2001:db8:0:51::1]', '2001:db8:0:51::1%en0', '2001:db8:0:51:1:2:3:4',
    ]) {
      assert.equal(dialKey(address), line, address);
    }
    assert.equal(dialKey('2001:db8:0:52::1'), '2001:db8:0:52::/64');
    assert.equal(dialKey('2a06:98c0:3600::103'), '2a06:98c0:3600:0::/64', 'the address Cloudflare gives another site\'s Worker');
    assert.equal(dialKey('::2'), '0:0:0:0::/64');
  });

  it('is the IPv4 address when one is written as IPv6', () => {
    assert.equal(dialKey('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(dialKey('::ffff:cb00:7107'), '203.0.113.7');
    assert.equal(dialKey('0:0:0:0:0:ffff:cb00:7107'), '203.0.113.7');
  });

  it('is nothing for this computer, which is never limited', () => {
    for (const address of ['127.0.0.1', '127.9.8.7', '::1', '0:0:0:0:0:0:0:1', '[::1]', '::ffff:127.0.0.1']) {
      assert.equal(dialKey(address), null, address);
    }
  });

  it('is one shared name when there is no address, and the text itself when it is not an address', () => {
    assert.equal(dialKey(null), 'unknown');
    assert.equal(dialKey(''), 'unknown');
    assert.equal(dialKey('   '), 'unknown');
    // None of these may pass for this computer, or for one another.
    const odd = ['localhost', '1.2.3', '999.1.1.1', '127.0.0.1.5', '1::2::3', '2001:db8:0:51', ':::1', '12345::1', 'g::1', '1:2:3:4:5:6:7:8:9'];
    for (const text of odd) assert.equal(dialKey(text), `other:${text}`, text);
    assert.equal(dialKey('x'.repeat(500)), `other:${'x'.repeat(64)}`);
  });
});

describe('the dial limit\'s numbers', () => {
  it('cover what the game itself can dial, behind one address, in one minute', () => {
    // game/src/net/relay.ts: after a drop a line dials again after 0.25, 0.5, 1, 2 and then every 3 seconds,
    // for 45 seconds, and only as fast as that while the room keeps turning it away.
    const RETRY_SECONDS = [0.25, 0.5, 1, 2, 3];
    const RECONNECT_SECONDS = 45;
    let dials = 0;
    for (let clock = 0, tries = 0; ; tries += 1) {
      clock += RETRY_SECONDS[Math.min(tries, RETRY_SECONDS.length - 1)]!;
      dials += 1;
      if (clock > RECONNECT_SECONDS) break;
    }
    assert.equal(dials, 18, 'one player coming back flat out');
    const crewJoining = 4;
    const reloads = 8;
    assert.ok(dials + crewJoining + reloads <= DIALS_PER_MINUTE);
    assert.equal(DIAL_WINDOW_SECONDS, 60);
    // A script held to the limit all day wakes this many rooms at the very most: under half the free plan's 100,000.
    assert.ok(DIALS_PER_MINUTE * 60 * 24 < 50_000);
  });
});
