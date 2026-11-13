# The drawn valley

How the islands, landmarks and scavenge nodes are drawn. Read `LOOK.md` first: this builds on its `Builder`, material tags and ink ids. The rule that outranks the rest still holds: nothing on the land moves, ever.

## Where things are

| File | What it holds |
|---|---|
| `landmarks.ts` | The registry. Every kind is built twice: with every stroke, and as its outline for far off |
| `world/kit.ts` | Shared colours (`TONE`), a gable roof, a window, a lattice mast, a ladder, and `siteOf`. No fire draws smoke (Luc's call) |
| `world/shallows.ts`, `reach.ts`, `narrows.ts` | The landmark drawings, by region. `narrows.ts` also holds the Fog's two |
| `world/dressing.ts` | What each island gets beyond its landmarks, by rule from the island table |
| `world/distance.ts` | Detail by distance: the ranges, and how the eye's place is read |
| `world/spent.ts` | The node material: B2's ink material plus the used-up switch |
| `nodes.ts` | The 22 node drawings, each with its fresh and used-up parts |
| `terrain.ts`, `props.ts`, `scatter.ts`, `presets.ts` | Ground, trees, placement, flora rules |

## The rules decide where, the look decides what

- The world view places one mesh per landmark at its spot, sunk 0.1 m, turned by its bearing. That code is not touched.
- A kind the island table has once (dock, dam, quarry cut, orchard, grove) asks `siteOf(kind)` for the rules' ground under it. So the dock runs down the real bank to the water, the dam follows its crest, the orchard trees stand on the slope.
- A kind the table has more than once (cabin roof, silo, pylon) is one shared mesh. It must look right on any ground: give it a footing that goes below its origin.
- A kind the table has more than once that cannot look right on any ground is a **fitted kind** (`FITTED_KINDS` in `landmarks.ts`: the truss span, whose deck is the rules' ground and falls 2.2 m under the outer spans). Each landmark of it gets its own drawing and far outline, built on its own site: inside its builder `siteOf(kind)` answers for the span being drawn. The world view still hands every span the shared drawing. The island's watcher (`terrain.ts`) swaps each one's own in, by the spot it stands on, the first time it runs.
- Some nodes sit on a landmark's own spot: an attic in each cabin roof and in the nave, a cache in the boathouse and under the fire tower, a machine under the gatehouse, the lamp at the tower's foot. The landmark leaves room: a gable stove in, a door stood open, a cabin up on legs, an open foot. The attic node is a cupola tall enough to stand through a roof ridge (`ATTIC_HEIGHT` in `nodes.ts`, held over `COTTAGE_RIDGE` by a test).
- What stands under a roof must show from outside. The cottage (`cabin_roof`) is B2's cabin roof set on what shows of its walls, a fifth bigger, so it carries the outline from the water. Its eave is gone over the middle of each slope and its south end is stove in, wall and gable. A test casts the walking eye's sight lines to the chest from the east, the west and the south: change the roof and run it.
- The truss spans have no floor. The rules' ground is the deck, and the dressing lays the track on it. Every joint of a span stands as high over the deck as on a level one.

## Adding a landmark

1. Add a builder to the region file: `(builder, detail) => { ... }`. Draw the outline first, then `if (!detail) return;`, then the strokes.
2. The far version must keep the height and the big shapes. A test holds it to within 1.5 m or a tenth.
3. If it is longer than a circle, add its footprint to `LANDMARK_FOOTPRINT` in `scatter.ts` so no tree grows through it.
4. Lattice, wires and rungs are `PEN` (never outlined). Solid things get their own ink id.

## Adding a node

```ts
crate: (builder, stage) => {
  builder.box(...);                       // always there
  stage.fresh(() => builder.box(...));    // the lid: gone when used up
  stage.spent(() => builder.box(...));    // the lid on the ground: only when used up
},
```

- Every type needs fresh parts. A test fails a node that looks the same used up.
- A used-up node is also washed out toward the paper, and a spent part cannot glow.
- Set its mark height in `NODE_MARK_HEIGHT`.

## Dressing: what makes an island its own place

Rules in `dressIsland`, all from data, none by name:

| Data | Gets |
|---|---|
| two or more pylons | five wires between each pair, two drooping into the water at each end |
| a truss span | rails end to end on the ground, sleepers from near by, a buffer stop |
| a `wreck_buoy` node | the top of a wreck beside it (tug, launch or houseboat) |
| peak 20 m or more | crags on the slopes |
| roughness 3, not built works | skerries standing off the shore |
| marsh ground, or the Fog | drowned snags in the shallows |
| a reed bed | herons in the shallows, standing still |
| the start island | one great pine over the camp |
| a fog-wall region | the fog wall along its edge, and banks along the valley walls behind (`fogBanks`) |

`floraFor` in `presets.ts` bends the trees the same way: a grove is all birch, cottage lots and yards are cleared, a marina keeps its pines, a lookout stands in pine.

Fog lies low on the water: a bank is four times as broad as it is tall (`FOG_HEAPS`). The wall's two rows are low enough that from the dam's crest the head of the Beacon's tower stands over them, and high enough to hide the island's shore. Two tests cast those sight lines through the banks as drawn: change a size and run them. The staged `?shot=beacon` floats north of the wall (z = -1128): from inside a bank the tower is not in its own picture.

The fog heaps wear one normal (`fogNormal`). A paddler crosses the wall, so a heap is seen from inside, and with real normals the inside is the shadow tone: dark fog. The one normal lies square to the light by day and by night, so both sides take the plain wash. Never turn a heap (`yaw: 0`).

## Detail by distance

The world view culls full trees at 650 m and small props at 220 m. Four more steps happen here, in metres from the shoreline:

| Range (on, off) | Near | Far |
|---|---|---|
| `FINE_TREES` 250, 280 | every bough | the same tree, half the triangles |
| `CLOSE_DRESSING` 300, 340 | sleepers, herons | not drawn |
| `FINE_LANDMARKS` 340, 380 | every stroke | the outline |
| `FINE_GROUND` 420, 470 | 3 m grid | 7 m grid |

- The world view does not tell the look where the eye is. Every ground mesh reports the camera as it is drawn (`eyeHook`), and when the eye has moved a metre the watchers run.
- A switch swaps a mesh's geometry or a group's `visible`. It takes effect on the next pass.
- Every range has a gap of 30 m or more between on and off, so nothing flickers at its edge. With a still camera the watchers do not run at all.
- A coarse tree is built from the same seeds as the fine one, with every random draw kept. It is the same tree, not another.

## Gates

```
npm --prefix game run check                                        # tests/look/world.test.ts is the valley's
PORTAGE_URL=http://localhost:5222 npm --prefix e2e test -- world.spec.ts look.spec.ts
```

`tests/look/world.test.ts`, no graphics card: every landmark kind and node type is a real drawing, the dam and dock fit the rules' ground, the dressing follows the island table, the 15 skylines differ, detail drops with distance and comes back, the cottages stand on their walls and show what is under them.

`e2e/tests/world.spec.ts`, real graphics card: 15 island views with a clean console, every landmark and node at the rules' place, each view inside its triangle budget, 0 changed land pixels at three islands paused and playing, a used-up node drawn used up, the lit tower in the staged Beacon view.

Each view's budget is in `TRIANGLES` in the spec. Redraw something and it grows: measure, and raise the number on purpose.

### Proving a check can fail

`PORTAGE_WORLD_BREAK='&boil=1'` fails the stillness tests. The rest are broken in the source, one line each:

| Break | Fails |
|---|---|
| a landmark builder that returns after one box | draws every landmark kind |
| `siteOf`: turn of 0 | fits the dam, runs the dock, one-of-a-kind |
| `nodes.ts`: `fresh: mark(0)` | draws every node type |
| `props.ts`: always `inkMaterial` | wears the material |
| `dressing.ts`: wires from four pylons up, or hung at half height | follows the island table, hangs the wires |
| `fogNormal` from day and dusk | gives the fog one normal |
| `floraFor` returns the preset's mix | own outline |
| `treeWatcher` always fine; `islandWatcher` never far | detail by distance |
| `FINE_GROUND` of 42 km | the 15 views (budget) |
| `world/spent.ts`: `HIDE` empty, or `aGone != 0.` | a used-up node |
| `narrows.ts`: `rise` always 0; `landmarkGeometryAt` always the shared drawing | the truss spans follow their own ground |
| `terrain.ts`: the watcher never fits a landmark | the truss spans get a drawing each |
| `FOG_HEAPS`: the old heap (`at: [0, 0.2, 0], reach: [1.7, 0.85, 1.1]`) | the tower's head over the fog |
| `fogBanks`: rows of size 4 and 5 | the fog is still a wall |
| `staging.ts`: the beacon view back at `floatAt(state, 0, -1085, 0)` | e2e: the staged view of the Beacon has the lit tower in it |
| `shallows.ts`: `holed` never true, or the south gable stove in only to `y < 0.2` | the cottages show the cache |
| `COTTAGE_EAVES = -0.6` (the roof back on the ground) | the cottages stand on their walls |
| `ATTIC_HEIGHT = 2.9` | the attic's cupola stands through the ridge |
