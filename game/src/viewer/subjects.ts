/**
 * Builders: each makes one drawn thing the way the game does, with the game's own functions, and stands it on
 * the ground (y = 0). Nothing here draws a pixel and nothing re-draws a shape: a hull comes from `CanoeView`, an
 * attachment from `buildAttachment`, a survivor from `buildCharacter`, a landmark from `landmarkGeometry`, and so on.
 */
import * as THREE from 'three';
import { HULL_TIERS, NODES_BY_ISLAND, NPCS, NPC_IDS, spotPosition } from '../data/index.ts';
import type { AttachmentId, IslandDefinition, LandmarkKind, NodeDefinition, NodeTypeId, NpcId } from '../data/index.ts';
import { attachmentTransformForHull, bearingBetween, createGame, terrainHeight } from '../sim/index.ts';
import type { CanoeState, GameState } from '../sim/index.ts';
import { buildAttachment } from '../look/attachments.ts';
import { makeHullShape } from '../look/b2/canoe.js';
import { inkMaterial } from '../look/b2/palette.js';
import { CanoeView } from '../look/canoe.ts';
import { buildCharacter } from '../look/characters.ts';
import { crewOf } from '../look/crew.ts';
import { landmarkFarGeometry, landmarkGeometry } from '../look/landmarks.ts';
import { floraFor } from '../look/presets.ts';
import { buildIslandProps, coarsePropLibrary, finePropLibrary, instancedMesh } from '../look/props.ts';
import { nodeGeometry } from '../look/nodes.ts';
import { hashText, scatterIsland } from '../look/scatter.ts';
import type { FloraKind } from '../look/scatter.ts';
import { buildIslandTerrain } from '../look/terrain.ts';
import { clearDistance, within } from '../look/world/distance.ts';
import { itemIcon } from '../interface/icons.ts';
import type { ItemId } from '../data/index.ts';
import { measure } from './measure.ts';
import type { Options, Subject } from './types.ts';

/** The camera the game gives the canoe: where it looks (metres above the waterline) and how far out it stands. */
const PADDLE_FOCUS_HEIGHT = 1.1;
const PADDLE_DISTANCE = 8.5;

/** The distances the game switches an island's parts at (world-view.ts), metres from its shoreline. */
const FULL_TREES = [650, 700] as const;
const SMALL_PROPS = [220, 250] as const;
const NODES_DRAWN = [320, 340] as const;

interface Finish {
  /** Leave y = 0 where the object put it (sea level) instead of standing its lowest point on the ground. */
  sea?: boolean;
  /** The canoe's draft, so the paddling camera's focus can be put back where the game has it. */
  draft?: number;
  notes?: string[];
  watch?: Subject['watch'];
  dispose?: () => void;
}

/** Put the built thing on the ground, measure it, and wrap it as a subject. */
function finish(object: THREE.Object3D, options: Finish = {}): Subject {
  const holder = new THREE.Group();
  holder.add(object);
  let measured = measure(holder);
  if (!options.sea) {
    holder.position.y = -measured.box.min.y;
    measured = measure(holder);
  }
  const lift = holder.position.y;
  return {
    object: holder,
    svg: null,
    box: measured.box,
    triangles: measured.triangles,
    drawCalls: measured.drawCalls,
    paddle: options.draft === undefined ? null : { focus: [0, PADDLE_FOCUS_HEIGHT + lift, 0], distance: PADDLE_DISTANCE },
    notes: options.notes ?? [],
    watch: options.watch,
    dispose: () => {
      holder.removeFromParent();
      options.dispose?.();
    },
  };
}

/** A game state with the canoe as asked and nobody's bag to carry: the one the canoe view reads. */
function stagedState(tier: number, attachments: AttachmentId[], flags: { sail: boolean; lantern: boolean; rain: number; beached: boolean }): GameState {
  const state = createGame(7, { crew: 4 });
  const canoe = state.canoe;
  canoe.position = { x: 0, y: 0, z: 0 };
  canoe.heading = 0;
  canoe.pitch = 0;
  canoe.roll = 0;
  canoe.waterLevel = 0;
  canoe.hullTier = tier;
  canoe.attachments = attachments;
  canoe.sailRaised = flags.sail;
  canoe.lanternLit = flags.lantern;
  canoe.rainProgress = flags.rain;
  canoe.beached = flags.beached;
  return state;
}

export interface CanoeSpec {
  tier: number;
  attachments: AttachmentId[];
  sail?: boolean;
  lantern?: boolean;
  rain?: number;
  beached?: boolean;
  /** Player ids seated aboard, by seat (the first takes seat 0, the stern). */
  aboard: number[];
  /** Player ids drawn. Everyone else is made (so each figure keeps the pen seeds it has in a crew of four) and hidden. */
  shown: number[];
  paddling?: number[];
  bailing?: number[];
  asleep?: number[];
  /** Where the crew's stroke clock stands, 0 to 1 (the pull is the first 0.46). */
  phase?: number;
  /** Ashore figures mid-stride. */
  walking?: boolean;
}

type FigureHandle = { stand(time: number, stride: number, moving: number, lying: number): void };
type CanoeViewInside = { phase: number; members: Map<number, { figure: FigureHandle }> };

/** The game's own canoe view, posed once on a state made for it, and held still. */
export function canoeSubject(spec: CanoeSpec): Subject {
  const state = stagedState(spec.tier, spec.attachments, { sail: spec.sail ?? false, lantern: spec.lantern ?? false, rain: spec.rain ?? 0, beached: spec.beached ?? false });
  state.players.forEach((player) => {
    const seat = spec.aboard.indexOf(player.id);
    player.mode = seat >= 0 ? 'canoe' : 'foot';
    player.seat = seat >= 0 ? seat : null;
    player.position = { x: 0, y: 0, z: 0 };
    player.heading = 0;
    player.paddling = spec.paddling?.includes(player.id) ?? false;
    player.bailing = spec.bailing?.includes(player.id) ?? false;
    player.asleep = spec.asleep?.includes(player.id) ?? false;
  });
  const view = new CanoeView();
  const inside = view as unknown as CanoeViewInside;
  if (spec.phase !== undefined) inside.phase = spec.phase;
  view.sync(state, crewOf(state), 0, 0, true, true);
  if (spec.walking) for (const id of spec.shown) if (!spec.aboard.includes(id)) inside.members.get(id)?.figure.stand(0, 1.4, 1, 0);
  for (const player of state.players) {
    const figure = view.figureOf(player.id);
    if (figure) figure.visible = spec.shown.includes(player.id);
  }
  const holder = new THREE.Group();
  holder.add(view.group, view.ashore);
  return finish(holder, { draft: HULL_TIERS[spec.tier].dimensions.draft, dispose: () => view.dispose() });
}

/** What the canoe's state-driven attachments follow. */
export interface AttachmentFlags {
  sail: boolean;
  lantern: boolean;
  rain: number;
  beached: boolean;
}

/** One attachment by itself, in its own mount's space: the origin is the mount, as the game's builder makes it. */
export function attachmentAlone(attachmentId: AttachmentId, tier: number, flags: AttachmentFlags): Subject {
  const dimensions = HULL_TIERS[tier].dimensions;
  const transform = attachmentTransformForHull(attachmentId, tier);
  const piece = buildAttachment(attachmentId, {
    hullTier: tier,
    shape: makeHullShape(dimensions),
    halfBeam: dimensions.beam / 2,
    gunwaleY: dimensions.depth - dimensions.draft,
    mount: transform.position,
    rotation: transform.rotation,
  });
  const canoe: CanoeState = stagedState(tier, [attachmentId], flags).canoe;
  piece.update?.(canoe, 0);
  return finish(piece.object, {
    dispose: () =>
      piece.object.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) (object as THREE.Mesh).geometry.dispose();
      }),
  });
}

export function landmarkSubject(kind: LandmarkKind, far: boolean): Subject {
  const geometry = far ? landmarkFarGeometry(kind) : landmarkGeometry(kind);
  return finish(new THREE.Mesh(geometry, inkMaterial), { notes: far ? ['The outline the game draws from far off: no pen marks inside the washes.'] : [] });
}

/** A scavenge node: instanced as the game does, so the node material hides the half its state does not show. */
export function nodeSubject(typeId: NodeTypeId, usedUp: boolean): Subject {
  const mesh = instancedMesh(nodeGeometry(typeId), [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }], hashText(typeId));
  (mesh.geometry.getAttribute('aInst') as THREE.BufferAttribute).setY(0, usedUp ? 1 : 0);
  return finish(mesh, { dispose: () => mesh.geometry.dispose() });
}

export function survivorSubject(npcId: NpcId): Subject {
  const mesh = buildCharacter(npcId);
  return finish(mesh, { dispose: () => mesh.geometry.dispose() });
}

/** A tree, bush, boulder or reed clump, one variant of the game's library, drawn the way an island instances it. */
export function propSubject(kind: FloraKind, variant: number, coarse: boolean): Subject {
  const library = coarse ? coarsePropLibrary() : finePropLibrary();
  const mesh = instancedMesh(library[kind][variant], [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }], hashText(`${kind}.${variant}`));
  return finish(mesh, { dispose: () => mesh.geometry.dispose(), notes: coarse ? ['The half-triangle copy the game draws from the middle distance.'] : [] });
}

/**
 * One island as the world view builds it: the ground and its dressing, the trees and small props, the landmarks,
 * the nodes and the survivors. Sea level stays at y = 0 and the island stays where the world has it (its centre is
 * not the origin: the game's distance rules read world places). The game's own
 * distance rules (`watch`) swap its parts as the camera moves, as they do in play.
 */
export function islandSubject(island: IslandDefinition): Subject {
  clearDistance();
  const group = new THREE.Group();
  const own: THREE.BufferGeometry[] = [];
  const ground = buildIslandTerrain(island);
  group.add(ground);
  const props = buildIslandProps(scatterIsland(island, floraFor(island)), hashText(island.id));
  group.add(props.near, props.far, props.detail);
  props.far.visible = false;
  for (const landmark of island.landmarks) {
    const mesh = new THREE.Mesh(landmarkGeometry(landmark.kind), inkMaterial);
    const spot = spotPosition(island, landmark.spot);
    mesh.position.set(spot.x, Math.max(0, terrainHeight(spot.x, spot.z)) - 0.1, spot.z);
    mesh.rotation.y = -(landmark.bearing + island.rotation);
    group.add(mesh);
  }
  const nodes = new THREE.Group();
  const byType = new Map<NodeTypeId, NodeDefinition[]>();
  for (const node of NODES_BY_ISLAND[island.id] ?? []) byType.set(node.typeId, [...(byType.get(node.typeId) ?? []), node]);
  for (const [typeId, definitions] of byType) {
    const floats = definitions[0].reach === 'canoe';
    const mesh = instancedMesh(
      nodeGeometry(typeId),
      definitions.map((node) => ({ x: node.position.x, y: floats ? 0 : Math.max(0, terrainHeight(node.position.x, node.position.z)), z: node.position.z, yaw: (hashText(node.id) % 628) / 100, scale: 1 })),
      hashText(`${island.id}.${typeId}`),
    );
    if (floats) mesh.frustumCulled = false;
    own.push(mesh.geometry);
    nodes.add(mesh);
  }
  group.add(nodes);
  const survivors = new THREE.Group();
  const landing = spotPosition(island, island.landing);
  for (const npcId of NPC_IDS) {
    if (NPCS[npcId].islandId !== island.id) continue;
    const spot = spotPosition(island, NPCS[npcId].spot);
    const figure = buildCharacter(npcId);
    figure.position.set(spot.x, terrainHeight(spot.x, spot.z), spot.z);
    figure.rotation.y = -bearingBetween(spot.x, spot.z, landing.x, landing.z);
    own.push(figure.geometry);
    survivors.add(figure);
  }
  group.add(survivors);
  const holder = new THREE.Group();
  holder.add(group);
  // The world view's own cull (world-view.ts `cull`), for one island: shoreline distance, with a gap between on and off.
  const watch = (eye: THREE.Vector3): void => {
    const distance = Math.max(0, Math.hypot(island.center.x - eye.x, island.center.z - eye.z) - Math.max(island.radiusX, island.radiusZ));
    props.near.visible = within(props.near.visible, distance, FULL_TREES);
    props.far.visible = !props.near.visible;
    props.detail.visible = within(props.detail.visible, distance, SMALL_PROPS);
    nodes.visible = within(nodes.visible, distance, NODES_DRAWN);
    survivors.visible = nodes.visible;
  };
  watch(new THREE.Vector3(island.center.x, 0, island.center.z));
  const subject = finish(holder, {
    sea: true,
    watch,
    notes: ['No water is drawn: the ground ends where its shelf passes 1.6 m under the surface.'],
    dispose: () => {
      clearDistance();
      for (const geometry of own) geometry.dispose();
    },
  });
  return subject;
}

/** An item's icon: flat SVG, drawn by the game's interface. */
export function iconSubject(itemId: ItemId): Subject {
  return { object: null, svg: itemIcon(itemId), box: new THREE.Box3(), triangles: 0, drawCalls: 0, paddle: null, notes: ['A flat drawing on a 24-unit grid, not a 3D thing.'], dispose: () => {} };
}

export type { Options };
