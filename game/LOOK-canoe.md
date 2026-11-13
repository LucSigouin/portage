# The canoe

How the canoe, its nineteen bolted-on pieces and the three survivors are drawn. Read `LOOK.md` first: this builds on its "Heroes", "The crew" and "Building a mesh".

The rule that outranks the rest still holds: nothing shimmers. Cloth moves slowly on the paint clock. A lamp is lit or it is not. Nothing pulses.

## Where things are

| File | What it holds |
|---|---|
| `src/look/b2/canoe.js` | `makeHullShape`, `buildHull(shape, tier)`, the bilge, the starter kit, the crew figure |
| `src/look/canoe.ts` | `CanoeView`: picks the hull, hangs each piece at its mount, seats the crew |
| `src/look/attachments.ts` | The registry: one builder per attachment id |
| `src/look/canoe/kit.ts` | What every piece is drawn with: `partBuilder`, `hullOf`, shared colours, `rig`, `line`, `plate`, `lashing` |
| `src/look/canoe/deck-parts.ts` | Both outriggers, workbench, smoker, planter, forge |
| `src/look/canoe/hull-parts.ts` | Cargo rack, firebox, map table, fishing rig, canopy |
| `src/look/canoe/rig-parts.ts` | Mast and sail, rudder, lantern mast, winch, radio, rain catcher, flag, figurehead |
| `src/look/characters.ts` | Odile, Wren, Tink |

## The four hulls

The paddling camera looks down into the boat from astern. So each tier changes what shows from there: the planking inside, the rails, the decks.

| Tier | What you see |
|---|---|
| 0 Leaky | Faded paint flaked to grey wood. Two split seams with rag pushed in. A snapped rail. Half the stern deck gone. Grey planking, and the bilge water at `waterLevel` |
| 1 Patched | The same boat, mended. Sheets of pale birch bark along both sides and lining the inside, each run round with black pitch. Two seams payed with pitch from end to end. Bark over the rails and the deck. The rail splinted and whipped. The bow keeps its paint and her name |
| 2 Ribbed | Rebuilt. Fresh cedar with a dark rib every third station. Stout wood rails, rub strakes, mount blocks, a mast step, new decks |
| 3 Long | 1.5 m longer. Cream rails and a cream band. Tin riveted round the bow. A rib every second station. Floorboards |

**The floor.** The hull's real floor is under the waterline. The game draws the water in the world's pass and the heroes apart, tested against the water's depth. The hero pass now takes the world's water out from inside the hull (`PREFILL` in `b2/post.js`, from the shape `buildHull` marks on its mesh), so what is aboard below the waterline is drawn, not painted over.

`buildHull` still stops the planking you see at `HULL.floor`, 5 cm above the waterline: lowering it is the last step of issue 10 and is not done. `&floor=0.05` shows it 5 cm above the keel. Two things to settle first. Everything that stands on the floor moves with it (`kit.ts` reads `floor`). And the flat of the floor narrows: 41 cm each side of the keel today, 24 cm at 5 cm above the keel on the first hull, so wide pieces need re-seating.

## Drawing a piece

A piece is authored in **canoe space**: bow toward -z, starboard +x, y = 0 at the waterline, metres. `partBuilder(context, seed)` gives a `Builder` that carries it into the mount's own space, turn included, which is where `CanoeView` hangs it.

```ts
export const thingPart: AttachmentBuilder = (context) => {
  const b = partBuilder(context, 140);          // a seed of its own
  const hull = hullOf(context);                 // halfBeam(z), gunwale(z), floor, bow, stern, seat(n)
  const [x, y, z] = context.mount;              // where the rules put it
  b.box(0.3, 0.2, 0.3, PAL.wood, { pos: [x, y + 0.1, z], kind: KIND.WOOD });
  return only(b.mesh());
};
```

- Start from `context.mount`. The mount is the rules engine's (`attachmentTransformForHull`). Never move it.
- Stand on the hull with `hull.gunwale(z)` and `hull.halfBeam(z)`, not with numbers. Tier 2 and tier 3 differ in beam, depth and length.
- Lay it out round the crew with `hull.seat(n)`. Seats come from the rules and spread when the hull grows. Measured reach round a seat at z: a seated body from z - 0.77 to z + 0.22, a kneeler from z - 0.63 to z + 0.22, hands out to 0.71 m each side, a paddle blade out to 1.32 m.
- Cloth that moves is a `cloth()` mesh. Its update must apply `mountSpace(context)`. Keep it slow: the sail's fastest point moves under 4 cm a second.
- Tag every piece with a `kind`. The colours in `kit.ts` are tagged once there.

## Pieces with a state

A piece reads the canoe's state in `update(canoe, time)`. It never invents one.

| Piece | Reads | Draws |
|---|---|---|
| Hull (tier 0) | `waterLevel` | The bilge water's height |
| Mast and sail | `sailRaised` | Gaff hoisted and sail set, or gaff lowered and sail furled on the boom |
| Lantern mast | `lanternLit` | The jar glowing, or dull |
| Canopy | `beached` | Canvas rolled forward under way, drawn over the cockpit when beached |
| Rain catcher | `rainProgress` | The water level in the pail |

## Why it is laid out this way

- **Spars cross the rail between paddlers.** `sparStations` puts each outrigger spar in a gap between two seats' strokes.
- **A well of open water runs between hull and deck** (`DECK.well`, 31 cm). Hands and arms reach 71 cm out when paddling.
- **Decks stop 1 m fore and aft of the mount** (`DECK.halfLength`). On the long hull the two seated paddlers swing clear of them.
- **The map table sits between the aft kneeler's back and the stern paddler's knees**, across the rails.
- **The canopy has two hoops**, one each side of the stern paddler's stroke. Rolled forward under way, so whoever steers is seen from the paddling camera.
- **The rudder is worked by a yoke and two lines** along the rails. A tiller would run through the radio shack.
- **The cargo rack is two low side shelves and a stack behind the thwart.** The middle stays clear to kneel in.

Known and unsolved, because the rules decide them:

- **Long hull, fourth player.** The firebox has 12 cm between the bow seat's back and the forward kneeler's hands. It is drawn 9 cm deep. That kneeler's leading hand still passes over its aft lip.
- **Long hull, third and fourth players.** The kneelers' paddles sweep through the outrigger decks.
- **Ribbed hull (4.9 m).** One paddler fits round everything. A second fits but for the firebox: the rules mount it 2 cm from the bow seat. A third and fourth do not fit round a full set: there the map table, canopy hoop, cargo rack, rig and spars take the kneelers' places, and the mast stands where seat 3 kneels.
- A paddler changing sides swings the paddle across the boat in a fifth of a second, through whatever is amidships.

On the short hulls the stern paddler comes first: the map table, the cargo shelves, the canopy's forward hoop and the rain frame all give way to seat 0.

## The survivors

One static mesh each, facing -z, feet at the origin. Told apart by shape first: Wren is the tall one, Tink the broad one, Odile the small one under a wide hat. Then by what they carry: apples and a stick, a bell and bell rope, a wrench and a pack of salvage. `head`, `arm` and `legs` in `characters.ts` are the shared parts.

## Checks

```
npm --prefix game run check                                        # unit: tests/look/attachments.test.ts, characters.test.ts
PORTAGE_URL=http://localhost:5221 npm --prefix e2e test -- canoe.spec.ts   # browser
```

`tests/look/attachments.test.ts`:

- every id has its own drawing (12 or more inked pieces, 4 or more colours);
- each piece reaches its mount on tier 2 and tier 3, and the view hangs it at the rules' transform;
- sail, lantern, canopy and rain pail follow the state; the sail is slow;
- no crew member is inside a piece on the fitted long hull: at rest, paddling, bailing, asleep. On the ribbed hull the same holds for one paddler, and for two but for the firebox. It tests every triangle of every piece against small boxes along every limb (`tests/look/canoe-geometry.ts`). The one known hit is named in the test;
- the seated paddlers' paddles touch nothing outboard; the kneelers' touch only the decks and what stands on them.

`tests/look/attachments.test.ts`, "the patched hull": only tier 1 wears the mends; the sheets show over a third of a square metre of bark a side above the water and line the inside; they lie on the planking; each has pitch along its four edges; two seams are payed from end to end; her name still shows. "The canoe says how big it is as drawn": the box the built view frames.

`tests/look/characters.test.ts`: own drawing, feet down, facing -z, told apart by shape and by what they carry.

`e2e/tests/canoe.spec.ts`: tiers tell apart from the paddling camera, the patched hull from the leaky one at a glance (pixels that differ and pixels of bark, off the bow at 9.5 m and astern), bilge water rises, each attachment draws, state changes show, the held canoe does not change by one pixel, 55 frames a second fitted with four aboard, clean console over 32 views. `e2e/tests/built.spec.ts` checks the built view in a browser.

To prove a check can fail, break the line it guards and watch it go red. `PORTAGE_CANOE_BREAK='&bench=24'` fails the frame-rate check. The full list of breaks is in `scratch/portage/canoe/tool/breaks.py`.

## Pictures

`scratch/portage/canoe/tool/shots.mjs` stages a canoe (tier, attachments, state, crew, camera) and crops round a point in canoe space. `sheet.mjs` lays pictures out with labels. Both are headless.
