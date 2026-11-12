/**
 * The quarry's benches are ground: the rules stand feet on the blocks the look draws, so a bench's
 * face is a wall and its top is a floor. The hill itself (`terrainHeight`) is left as it was.
 */
import { describe, expect, it } from 'vitest';
import { ISLANDS, ISLANDS_BY_ID, QUARRY_BENCHES, TUNING, spotPosition } from '../src/data/index.ts';
import { LANDMARK_SUNK } from '../src/look/world/kit.ts';
import { NARROWS } from '../src/look/world/narrows.ts';
import { findFootPath } from '../src/bot/navigation.ts';
import { groundHeight, terrainHeight } from '../src/sim/index.ts';
import { newGame, run } from './support.ts';

const quarry = ISLANDS_BY_ID.quarry_face;
const cut = quarry.landmarks.find((landmark) => landmark.kind === 'quarry_cut')!;
const origin = spotPosition(quarry, cut.spot);
const turn = -(cut.bearing + quarry.rotation);
/** A point in the cut's own frame, as the look places it in the world. */
const world = (x: number, z: number): { x: number; z: number } => ({
  x: origin.x + x * Math.cos(turn) + z * Math.sin(turn),
  z: origin.z - x * Math.sin(turn) + z * Math.cos(turn),
});
const sunk = Math.max(0, terrainHeight(origin.x, origin.z)) - LANDMARK_SUNK;
const { rows, columns, front, depth, firstColumnX, columnWidth } = QUARRY_BENCHES;

/** The blocks the look really draws for the cut: every box its builder asks for, in the cut's own frame. */
function drawnBlocks(): { x: number; z: number; width: number; depth: number; top: number }[] {
  const boxes: { x: number; z: number; width: number; depth: number; top: number }[] = [];
  const builder = new Proxy({}, {
    get: (_target, name) => (name === 'box'
      ? (width: number, height: number, deep: number, _tone: string, options: { pos: [number, number, number]; rot?: unknown }) => {
        if (!options.rot) boxes.push({ x: options.pos[0], z: options.pos[2], width, depth: deep, top: options.pos[1] + height / 2 });
      }
      : () => undefined),
  });
  NARROWS.quarry_cut!(builder as never, false);
  // The benches are the big blocks. The derrick's stone and the cut blocks at the foot are turned (rot) or small.
  return boxes.filter((box) => box.width > 4);
}

function standAt(x: number, z: number) {
  const state = newGame();
  state.players[0].mode = 'foot';
  state.players[0].islandId = 'quarry_face';
  state.players[0].position = { x, y: groundHeight(x, z), z };
  return state;
}

describe('the quarry benches', () => {
  it('are the blocks the look draws: same eighteen, same footprints, same tops', () => {
    const blocks = drawnBlocks();
    expect(blocks).toHaveLength(rows * columns);
    expect(blocks).toHaveLength(18);
    for (const block of blocks) {
      // The table's grid has this block: its centre sits on a row and a column of it.
      const row = (block.z - depth / 2 - front) / depth;
      const column = (block.x - firstColumnX) / columnWidth;
      expect(Math.abs(row - Math.round(row))).toBeLessThan(1e-9);
      expect(Math.abs(column - Math.round(column))).toBeLessThan(1e-9);
      // Drawn 6 cm oversize so neighbours share no seam.
      expect(Math.abs(block.width - columnWidth)).toBeLessThan(0.1);
      expect(Math.abs(block.depth - depth)).toBeLessThan(0.1);
      // Feet stand exactly on its drawn top, at the middle and just inside each corner.
      for (const [alongX, alongZ] of [[0, 0], [-0.49, -0.49], [0.49, -0.49], [-0.49, 0.49], [0.49, 0.49]]) {
        const point = world(block.x + alongX * columnWidth, block.z + alongZ * depth);
        const hill = terrainHeight(point.x, point.z);
        expect(groundHeight(point.x, point.z)).toBeCloseTo(Math.max(hill, sunk + block.top), 9);
      }
      // And the block really does stand proud of the hill at its front: a face, metres high.
      const face = world(block.x, block.z - 0.49 * depth);
      expect(groundHeight(face.x, face.z) - terrainHeight(face.x, face.z)).toBeGreaterThan(2);
    }
  });

  it('change the ground nowhere else: off the benches feet stand on the hill, on every island', () => {
    let raised = 0;
    let checked = 0;
    for (const island of ISLANDS) {
      for (let x = island.center.x - 160; x <= island.center.x + 160; x += 3.7) {
        for (let z = island.center.z - 160; z <= island.center.z + 160; z += 3.7) {
          checked += 1;
          if (groundHeight(x, z) === terrainHeight(x, z)) continue;
          raised += 1;
          expect(island.id).toBe('quarry_face');
          expect(groundHeight(x, z)).toBeGreaterThan(terrainHeight(x, z));
          // Inside the cut's footprint, in its own frame.
          const localX = (x - origin.x) * Math.cos(turn) - (z - origin.z) * Math.sin(turn);
          const localZ = (x - origin.x) * Math.sin(turn) + (z - origin.z) * Math.cos(turn);
          expect(Math.abs(localX)).toBeLessThanOrEqual(columns * columnWidth / 2);
          expect(localZ).toBeGreaterThanOrEqual(front);
          expect(localZ).toBeLessThanOrEqual(front + rows * depth);
        }
      }
    }
    expect(checked).toBeGreaterThan(100000);
    expect(raised).toBeGreaterThan(40);
    expect(raised).toBeLessThan(120); // 48 m by 19.5 m of benches, sampled every 3.7 m
  });

  it('cannot be walked through: a face stops you, where the smooth hill used to let you by', () => {
    // Along the hillside at the height of the middle bench's foot, heading into the side of the cut.
    const from = world(-27, -6.4);
    const state = standAt(from.x, from.z);
    const into = world(0, -6.4);
    const yaw = Math.atan2(into.x - from.x, -(into.z - from.z));
    run(state, { moveY: 1, cameraYaw: yaw }, 12);
    const player = state.players[0].position;
    const along = (player.x - origin.x) * Math.cos(turn) - (player.z - origin.z) * Math.sin(turn);
    // 12 seconds of walking is 31 m. The side of the first block is 3 m away, and that is as far as it goes.
    expect(along).toBeLessThan(-columns * columnWidth / 2 + 0.05);
    expect(player.y).toBeCloseTo(groundHeight(player.x, player.z), 9);
    // The smooth hill alone would have let the walk through: this is the bug that was.
    const steps = 60;
    let steepest = 0;
    for (let index = 0; index < steps; index += 1) {
      const a = world(-27 + (27 * index) / steps, -6.4);
      const b = world(-27 + (27 * (index + 1)) / steps, -6.4);
      steepest = Math.max(steepest, (terrainHeight(b.x, b.z) - terrainHeight(a.x, a.z)) / Math.hypot(b.x - a.x, b.z - a.z));
    }
    expect(steepest).toBeLessThan(TUNING.foot.slopeLimit);
  });

  it('carry you: level along a bench top, down a step to the next block, and off the front to the bench below', () => {
    // On the top bench, a block from the high end, walking toward the low end.
    const start = world(-12, 3.2);
    const state = standAt(start.x, start.z);
    const top = groundHeight(start.x, start.z);
    expect(top).toBeGreaterThan(terrainHeight(start.x, start.z) + 0.2);
    const lowEnd = world(20, 3.2);
    run(state, { moveY: 1, cameraYaw: Math.atan2(lowEnd.x - start.x, -(lowEnd.z - start.z)) }, 1);
    expect(state.players[0].position.y).toBe(top); // flat while on one block
    run(state, { moveY: 1, cameraYaw: Math.atan2(lowEnd.x - start.x, -(lowEnd.z - start.z)) }, 3);
    expect(state.players[0].position.y).toBeLessThan(top); // stepped down onto the next block
    expect(state.players[0].position.y).toBe(groundHeight(state.players[0].position.x, state.players[0].position.z));
    // Back the way it came: the step up is a wall, however small.
    const there = { ...state.players[0].position };
    run(state, { moveY: -1, cameraYaw: Math.atan2(lowEnd.x - start.x, -(lowEnd.z - start.z)) }, 6);
    expect(state.players[0].position.y).toBeLessThanOrEqual(there.y);
    // Off the front edge: down to the middle bench, and no way back up.
    const edge = world(4, 0.6);
    const dropper = standAt(edge.x, edge.z);
    const upper = dropper.players[0].position.y;
    const outward = world(4, -6);
    run(dropper, { moveY: 1, cameraYaw: Math.atan2(outward.x - edge.x, -(outward.z - edge.z)) }, 1);
    expect(dropper.players[0].position.y).toBeLessThan(upper - 2);
    run(dropper, { moveY: -1, cameraYaw: Math.atan2(outward.x - edge.x, -(outward.z - edge.z)) }, 3);
    expect(dropper.players[0].position.y).toBeLessThan(upper - 2);
  });

  it('are planned around: the bot finds no straight path through the cut, and still reaches every quarry node', () => {
    const west = world(27, -6.4);
    const east = world(-27, -6.4);
    const path = findFootPath('quarry_face', east, west);
    // Either it goes round (more than one leg), or there is no way along this contour at all.
    expect(path === null || path.length > 1).toBe(true);
  });
});
