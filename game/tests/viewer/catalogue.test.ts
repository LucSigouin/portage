/**
 * The viewer's list against the game's own tables. Every count is read from a table, never typed in, so a thing
 * added to the game changes both sides together. Every entry, and every answer to every question it asks, is
 * built: none may throw, and each must have something to show.
 */
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATTACHMENTS, ATTACHMENT_IDS, CREW_MARKS, HULL_TIERS, ISLANDS, ITEMS, ITEM_IDS, NODE_TYPES, NPC_IDS } from '../../src/data/index.ts';
import { LANDMARK_KINDS } from '../../src/look/landmarks.ts';
import { NODE_TYPE_IDS } from '../../src/look/nodes.ts';
import { VARIANTS } from '../../src/look/scatter.ts';
import { GROUPS, catalogue, cleanOptions, defaultsOf, entryById, resetCatalogue } from '../../src/viewer/catalogue.ts';
import type { Entry, GroupId, Options } from '../../src/viewer/types.ts';

const countOf = (group: GroupId): number => catalogue().filter((entry) => entry.group === group).length;
const propsExpected = Object.values(VARIANTS).reduce((sum, variants) => sum + variants, 0);

describe('the list matches the game', () => {
  it('has as many hull tiers as the data (4 today)', () => {
    expect(countOf('hull')).toBe(HULL_TIERS.length);
    expect(HULL_TIERS.length).toBe(4);
  });

  it('has every attachment, 19 today', () => {
    expect(countOf('attachment')).toBe(ATTACHMENT_IDS.length);
    expect(countOf('attachment')).toBe(Object.keys(ATTACHMENTS).length);
    expect(ATTACHMENT_IDS.length).toBe(19);
  });

  it('has the four crew colours and the three survivors', () => {
    expect(countOf('crew')).toBe(CREW_MARKS.length + NPC_IDS.length);
    expect(catalogue().filter((entry) => entry.id.startsWith('crew/player-')).length).toBe(CREW_MARKS.length);
  });

  it('has every landmark kind, scavenge node, island, prop variant and item icon', () => {
    expect(countOf('landmark')).toBe(LANDMARK_KINDS.length);
    expect(countOf('node')).toBe(NODE_TYPE_IDS.length);
    expect(countOf('node')).toBe(Object.keys(NODE_TYPES).length);
    expect(countOf('island')).toBe(ISLANDS.length);
    expect(countOf('prop')).toBe(propsExpected);
    expect(countOf('icon')).toBe(ITEM_IDS.length);
    expect(ITEM_IDS.length).toBe(54);
  });

  it('adds up, with unique addresses, every one in a named group', () => {
    const entries = catalogue();
    const total = HULL_TIERS.length + ATTACHMENT_IDS.length + CREW_MARKS.length + NPC_IDS.length + LANDMARK_KINDS.length + NODE_TYPE_IDS.length + ISLANDS.length + propsExpected + ITEM_IDS.length;
    expect(entries.length).toBe(total);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(GROUPS.map((group) => group.id)).toContain(entry.group);
      expect(entry.id.startsWith(`${entry.group === 'crew' ? 'crew' : entry.group}/`)).toBe(true);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.source.length).toBeGreaterThan(0);
      expect(entryById(entry.id)).toBe(entry);
    }
  });

  it('shows a new thing by itself: an item added to the game is in the list with no edit here', () => {
    const before = countOf('icon');
    const id = 'zzz_new_item' as (typeof ITEM_IDS)[number];
    (ITEMS as Record<string, unknown>)[id] = { id, name: 'A New Thing', description: 'Added by a test', iconId: id, category: 'raw', edible: null, isDrink: false };
    ITEM_IDS.push(id);
    try {
      resetCatalogue();
      expect(countOf('icon')).toBe(before + 1);
      expect(entryById(`icon/${id}`)?.name).toBe('A New Thing');
    } finally {
      ITEM_IDS.pop();
      delete (ITEMS as Record<string, unknown>)[id];
      resetCatalogue();
    }
    expect(countOf('icon')).toBe(before);
  });
});

/** Every answer to every question, one change at a time from the defaults, and the defaults themselves. */
function variants(entry: Entry): Options[] {
  const base = defaultsOf(entry);
  const all: Options[] = [base];
  for (const control of entry.controls) for (const choice of control.choices) if (choice.value !== control.default) all.push({ ...base, [control.key]: choice.value });
  return all;
}

describe('every entry builds', () => {
  for (const group of GROUPS) {
    it(`${group.label}: every thing, every answer, no error, something to show`, () => {
      let built = 0;
      for (const entry of catalogue().filter((candidate) => candidate.group === group.id)) {
        for (const options of variants(entry)) {
          const subject = entry.build(options);
          built += 1;
          const where = `${entry.id} ${JSON.stringify(options)}`;
          if (entry.flat) {
            expect(subject.svg, where).toContain('<svg');
            expect(subject.object, where).toBeNull();
          } else {
            expect(subject.object, where).not.toBeNull();
            expect(subject.box.isEmpty(), where).toBe(false);
            expect(Number.isFinite(subject.box.max.x - subject.box.min.x), where).toBe(true);
            expect(subject.triangles, where).toBeGreaterThan(0);
            expect(subject.drawCalls, where).toBeGreaterThan(0);
          }
          subject.dispose();
        }
      }
      expect(built).toBeGreaterThanOrEqual(countOf(group.id));
    });
  }

  it('stands every thing on the ground: its lowest point is at y = 0, except islands (sea level)', () => {
    for (const entry of catalogue()) {
      if (entry.flat) continue;
      if (entry.group === 'island' && !entry.id.endsWith('home_knoll')) continue;
      const subject = entry.build(defaultsOf(entry));
      if (entry.group === 'island') expect(subject.box.min.y, entry.id).toBeLessThan(0.5);
      else expect(Math.abs(subject.box.min.y), entry.id).toBeLessThan(1e-6);
      subject.dispose();
    }
  });

  it('keeps the questions honest: a control has choices, its default is one of them, and a `when` names a real control', () => {
    for (const entry of catalogue()) {
      for (const control of entry.controls) {
        expect(control.choices.length, `${entry.id}.${control.key}`).toBeGreaterThan(1);
        expect(control.choices.map((choice) => choice.value)).toContain(control.default);
        if (control.when) expect(entry.controls.find((other) => other.key === control.when?.key)?.choices.map((choice) => choice.value)).toContain(control.when.is);
      }
    }
  });

  it('turns a bad answer into the default', () => {
    const entry = entryById('hull/long_canoe') as Entry;
    expect(cleanOptions(entry, { crew: '9', fitted: 'banana', extra: 'x' })).toEqual(defaultsOf(entry));
    expect(cleanOptions(entry, { crew: '3' }).crew).toBe('3');
  });
});

describe('what the numbers say', () => {
  it('the long hull is longer than the ribbed one, to the data', () => {
    const size = (id: string): number => {
      const subject = (entryById(id) as Entry).build({ crew: '0', fitted: 'bare' });
      const length = subject.box.max.z - subject.box.min.z;
      subject.dispose();
      return length;
    };
    const ribbed = HULL_TIERS[2].dimensions.length;
    const long = HULL_TIERS[3].dimensions.length;
    expect(size('hull/long_canoe') - size('hull/ribbed_canoe')).toBeGreaterThan((long - ribbed) * 0.9);
    expect(size('hull/long_canoe')).toBeGreaterThan(long * 0.95);
  });

  it('a used-up node draws fewer or different triangles than a fresh one, and the right half shows', () => {
    const entry = entryById('node/crate') ?? (catalogue().find((candidate) => candidate.group === 'node') as Entry);
    const fresh = entry.build({ state: 'fresh' });
    const used = entry.build({ state: 'used' });
    expect(fresh.triangles).toBeGreaterThan(0);
    expect(used.triangles).toBeGreaterThan(0);
    fresh.dispose();
    used.dispose();
    const different = catalogue().filter((candidate) => candidate.group === 'node').some((candidate) => {
      const a = candidate.build({ state: 'fresh' });
      const b = candidate.build({ state: 'used' });
      const same = a.triangles === b.triangles;
      a.dispose();
      b.dispose();
      return !same;
    });
    expect(different).toBe(true);
  });

  it('a crew of N aboard draws more than none', () => {
    const entry = entryById('hull/ribbed_canoe') as Entry;
    const empty = entry.build({ crew: '0' });
    const four = entry.build({ crew: '4' });
    expect(four.triangles).toBeGreaterThan(empty.triangles);
    expect(four.drawCalls).toBeGreaterThan(empty.drawCalls);
    empty.dispose();
    four.dispose();
  });
});

/** Every attribute of every mesh under a subject, boiled down to one number. */
function drawingOf(root: THREE.Object3D): string {
  let hash = 2166136261;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const name of Object.keys(mesh.geometry.attributes).sort()) {
      const array = mesh.geometry.getAttribute(name).array as ArrayLike<number>;
      for (let at = 0; at < array.length; at += 1) hash = Math.imul(hash ^ Math.round(array[at] * 1e5), 16777619) >>> 0;
    }
  });
  return String(hash);
}

describe('the same picture whatever was opened before', () => {
  it('builds each kind of thing to the same drawing after other things, ink ids and all', () => {
    const ids = ['hull/ribbed_canoe', 'attachment/forge', 'crew/odile', 'crew/player-2', 'landmark/steeple', 'node/crate', 'prop/spruce-1', 'island/steeple_rock'];
    for (const id of ids) {
      const entry = entryById(id) as Entry;
      const first = entry.build(defaultsOf(entry));
      const before = drawingOf(first.object as THREE.Object3D);
      first.dispose();
      // other things, in another order, with the game's shared drawings built along the way
      for (const other of catalogue().filter((candidate) => !candidate.flat && candidate.id !== id).slice(3, 40).reverse()) other.build(defaultsOf(other)).dispose();
      const again = entry.build(defaultsOf(entry));
      expect(drawingOf(again.object as THREE.Object3D), id).toBe(before);
      again.dispose();
    }
  });
});
