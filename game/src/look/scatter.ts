/**
 * Where the trees, scrub, boulders, reeds and sedge stand: the rules' own
 * placements (`sim/scatter.ts`), drawn as they are. The rules read the same
 * list to make trees and rocks solid (Luc's list, line 1), so what you see is
 * what you bump into.
 *
 * No Three.js in here: props.ts turns placements into instanced meshes.
 */
export {
  LANDMARK_CLEARANCE, LANDMARK_FOOTPRINT, VARIANTS, hashText, islandHectares, keepOutCircles, scatterIsland, seededRandom,
  shoreLength,
} from '../sim/index.ts';
export type { FloraKind, Placement } from '../sim/index.ts';
