/**
 * The wild trees and stones as scavenge spots (Luc's bugfix list, round 2: "Any tree/collectable on island should be
 * able to count/usable for trees/rocks whatever"). Every spruce, pine, birch and boulder the scatter places
 * (`sim/scatter.ts`) and every crag of the look's dressing (`sim/solids.ts`) is a spot of its kind (`WILD_KINDS` in
 * `data/nodes.ts`): the same prompt, tools, loot and ten-minute refill as the placed spot it is named for.
 *
 * - Ids are stable, from the seeded placements: `<island>.scatter.<index in scatterIsland>` for a tree or a boulder,
 *   `<island>.dressing.<index in dressingAnchors>` for a crag. Nothing is added to the state until one is used: its
 *   refill clock lives in `state.nodes` under that id, like any spot's, and is dropped again once it has refilled.
 * - Reach is from the bark or the stone (`TUNING.nodes.wildReach`), since the thing itself is solid.
 * - Built once, the first time anything asks, and filed in a grid, so "what wild thing is in reach of this body?" is
 *   one lookup and a handful of comparisons: four players, every frame. It depends on the place alone, never on the
 *   state, so a guest's screen offers the same tree as the host's rules.
 */
import { floraMixFor } from '../data/flora.ts';
import { WILD_KINDS, resolveWildNodesWith } from '../data/nodes.ts';
import type { WildKind } from '../data/nodes.ts';
import { TUNING } from '../data/tuning.ts';
import type { IslandId, NodeDefinition, NodeId } from '../data/types.ts';
import { ISLANDS } from '../data/world.ts';
import { scatterIsland } from './scatter.ts';
import { anchorSolids, dressingAnchors, placementSolids } from './solids.ts';
import type { GameState } from './types.ts';

/** A wild tree or stone: its spot, and the solid it is reached round. */
export interface WildNode {
  kind: WildKind;
  definition: NodeDefinition;
  /** The trunk, the stone and its lump, or a crag's blocks: world metres. */
  circles: readonly { x: number; z: number; radius: number }[];
}

interface WildIndex {
  nodes: WildNode[];
  byId: Map<NodeId, WildNode>;
  byIsland: Map<IslandId, WildNode[]>;
  cells: Map<number, WildNode[]>;
}

/** Metres a filing cell spans. Each wild thing is filed in every cell its reach touches, so a body asks one cell. */
const CELL = 4;
const cellKey = (column: number, row: number): number => (column + 4096) * 8192 + (row + 4096);
const NONE: readonly WildNode[] = [];

let built: WildIndex | null = null;

function wildNode(kind: WildKind, id: NodeId, islandId: IslandId, x: number, z: number, circles: WildNode['circles']): WildNode {
  const wild = WILD_KINDS[kind];
  return {
    kind,
    definition: {
      id, typeId: wild.typeId, name: wild.name, description: wild.description, iconId: `node_${wild.typeId}`,
      islandId, position: { x, z }, reach: 'foot', actions: wild.actions, bottleId: null,
    },
    circles,
  };
}

const isWildKind = (kind: string): kind is WildKind => Object.hasOwn(WILD_KINDS, kind);

/** Every wild tree and stone of the valley, built on first use. */
export function wildIndex(): WildIndex {
  if (built) return built;
  const index: WildIndex = { nodes: [], byId: new Map(), byIsland: new Map(), cells: new Map() };
  for (const island of ISLANDS) {
    const onIsland: WildNode[] = [];
    scatterIsland(island, floraMixFor(island)).forEach((placement, at) => {
      if (!isWildKind(placement.kind)) return;
      onIsland.push(wildNode(placement.kind, `${island.id}.scatter.${at}`, island.id, placement.x, placement.z, placementSolids(island.id, placement)));
    });
    dressingAnchors(island).forEach((anchor, at) => {
      if (!isWildKind(anchor.kind)) return;
      onIsland.push(wildNode(anchor.kind, `${island.id}.dressing.${at}`, island.id, anchor.x, anchor.z, anchorSolids(anchor, island.id)));
    });
    index.byIsland.set(island.id, onIsland);
    index.nodes.push(...onIsland);
  }
  const reach = TUNING.nodes.wildReach;
  for (const node of index.nodes) {
    index.byId.set(node.definition.id, node);
    const minimumX = Math.min(...node.circles.map((circle) => circle.x - circle.radius)) - reach;
    const maximumX = Math.max(...node.circles.map((circle) => circle.x + circle.radius)) + reach;
    const minimumZ = Math.min(...node.circles.map((circle) => circle.z - circle.radius)) - reach;
    const maximumZ = Math.max(...node.circles.map((circle) => circle.z + circle.radius)) + reach;
    for (let column = Math.floor(minimumX / CELL); column <= Math.floor(maximumX / CELL); column += 1) {
      for (let row = Math.floor(minimumZ / CELL); row <= Math.floor(maximumZ / CELL); row += 1) {
        const key = cellKey(column, row);
        const entry = index.cells.get(key);
        if (entry) entry.push(node);
        else index.cells.set(key, [node]);
      }
    }
  }
  built = index;
  return index;
}

/** True for an id of the wild-tree form, without building anything. */
export const isWildNodeId = (nodeId: NodeId): boolean => nodeId.includes('.scatter.') || nodeId.includes('.dressing.');

/** A wild tree or stone by id, or undefined. */
export function findWildNode(nodeId: NodeId): WildNode | undefined {
  return isWildNodeId(nodeId) ? wildIndex().byId.get(nodeId) : undefined;
}

/** The wild trees and stones of one island. */
export function wildNodesOn(islandId: IslandId): readonly WildNode[] {
  return wildIndex().byIsland.get(islandId) ?? NONE;
}

/** The wild things that may be in reach of a body at (x, z): a superset, from one cell. */
export function wildNodesNear(x: number, z: number): readonly WildNode[] {
  return wildIndex().cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? NONE;
}

/** Metres from (x, z) to the bark or the stone: below zero inside it. */
export function distanceToWild(node: WildNode, x: number, z: number): number {
  let nearest = Infinity;
  for (const circle of node.circles) nearest = Math.min(nearest, Math.hypot(circle.x - x, circle.z - z) - circle.radius);
  return nearest;
}

/**
 * Forget the wild trees that have refilled and hold nothing left behind: the state keeps only the ones in use, and
 * forgetting one changes nothing (a tree with no entry is ready). Run after each harvest.
 */
export function forgetRefilledWild(state: GameState): void {
  for (const nodeId of Object.keys(state.nodes)) {
    if (!isWildNodeId(nodeId)) continue;
    const nodeState = state.nodes[nodeId];
    if (nodeState.leftover.length === 0 && nodeState.readyAt.every((readyAt) => readyAt !== null && readyAt <= state.time)) delete state.nodes[nodeId];
  }
}

// The data's `NODES_BY_ID` names a used tree like any spot: for the toasts, the sound and the look's puff.
resolveWildNodesWith((nodeId) => findWildNode(nodeId)?.definition);
