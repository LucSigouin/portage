/**
 * The dial limit: how often one address may dial a room. Plain logic, no
 * Cloudflare in here. The count itself is kept by Cloudflare's rate limiting
 * binding (`DIALS` in `wrangler.jsonc`), asked at the door in `worker.ts`
 * before any room is woken.
 *
 * Why it is needed: every other cap is per socket. Without this one a script
 * that dials in a loop wakes a room with every dial, and the free plan's
 * 100,000 room requests a day are gone in minutes.
 *
 * Why 30 a minute. The busiest thing the game itself ever does is come back
 * after a drop: at most 18 dials in 45 seconds from one player, and only
 * while the room keeps turning it away (`RETRY_SECONDS` and
 * `RECONNECT_SECONDS` in `game/src/net/relay.ts`). A join is one dial, a
 * reload is one dial. So 30 covers one player coming back flat out, plus a
 * crew of four joining, and a friend who reloads eight times, all behind one
 * address and all in the same minute. A script meets it in a fraction of a
 * second, and is then held to 30 a minute: 43,200 a day at the very most.
 *
 * The two numbers below must be the ones in `wrangler.jsonc`. A test holds
 * them together. Cloudflare allows a window of 10 or 60 seconds, nothing else.
 */
export const DIALS_PER_MINUTE = 30;
export const DIAL_WINDOW_SECONDS = 60;

/** What a dial over the limit is told, as plain HTTP: no socket is opened and no room is woken. */
export const TOO_MANY_DIALS = 'too many dials from this address: wait a minute';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const GROUP = /^[0-9a-f]{1,4}$/;

/** The eight groups of an IPv6 address as numbers, or null when the text is not one. */
function sixGroups(text: string): number[] | null {
  let address = text;
  // The last 32 bits may be written as an IPv4 address: `::ffff:203.0.113.7`.
  const tail = address.slice(address.lastIndexOf(':') + 1);
  const four = IPV4.exec(tail);
  if (four) {
    const bytes = four.slice(1).map(Number);
    if (bytes.some((byte) => byte > 255)) return null;
    const high = ((bytes[0]! << 8) | bytes[1]!).toString(16);
    const low = ((bytes[2]! << 8) | bytes[3]!).toString(16);
    address = `${address.slice(0, address.length - tail.length)}${high}:${low}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0]!.split(':');
  const rest = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (!groups.every((group) => GROUP.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/**
 * The name an address is counted under, or null for this computer, which is
 * never limited.
 *
 * - IPv4: the address itself.
 * - IPv6: its first 64 bits. One line at home or one rented server is handed
 *   a whole /64 (2^64 addresses), so counting each address by itself would
 *   count nothing.
 * - An IPv4 address written as IPv6 (`::ffff:203.0.113.7`): the IPv4 address.
 * - This computer (`127.x.x.x`, `::1`): null. Cloudflare never reports such
 *   an address, so this only frees the relay run locally and its tests.
 * - No address, or text that is not one: counted together under one name.
 *   On Cloudflare the header is always there.
 */
export function dialKey(address: string | null): string | null {
  const text = (address ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (text === '') return 'unknown';
  const four = IPV4.exec(text);
  if (four) {
    const bytes = four.slice(1).map(Number);
    if (bytes.every((byte) => byte <= 255)) return bytes[0] === 127 ? null : bytes.join('.');
  }
  const groups = text.includes(':') ? sixGroups(text) : null;
  if (!groups) return `other:${text.slice(0, 64)}`;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return null;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return dialKey(`${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`);
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}
