/**
 * The drawn valley, checked in a real browser on the real graphics card:
 *
 * - a view from the water at each of the 15 islands runs with a clean console;
 * - at each, every landmark and every scavenge node stands where the rules put it, on the rules' ground;
 * - each view costs no more triangles than its budget, and no more than the stand-ins did (far islands are cheap);
 * - with a still camera not one pixel of the land changes at three islands, paused (the camp and its smoke,
 *   the church, the Beacon's summit) and while playing (the camp, the church, the orchard and farmhouse);
 * - a used-up node is drawn used up: what it gave is gone from the picture, and it was there before;
 * - the staged view of the Beacon (`?shot=beacon`) has the lit tower in it: its lamp shows, in the frame.
 *
 * Needs the dev server (PORTAGE_URL, default http://localhost:5222).
 *
 * PORTAGE_WORLD_BREAK adds switches to every address, to prove a check can fail: `&boil=1` breaks the
 * stillness. The other checks are broken in the source: see game/LOOK-world.md.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE = process.env.PORTAGE_URL ?? 'http://localhost:5222';
const BREAK = process.env.PORTAGE_WORLD_BREAK ?? '';

test.use({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
});
test.setTimeout(300_000);

/**
 * Triangles in one frame at each island's view from the water. `before`: the stand-ins, measured at the same
 * views on the commit this work started from. `after`: this drawing, as measured when it was finished.
 */
const TRIANGLES: Record<string, { before: number; after: number }> = {
  home_knoll: { before: 800603, after: 567151 },
  cabin_roofs: { before: 610546, after: 491415 },
  birch_islet: { before: 630351, after: 484464 },
  orchard_hill: { before: 677919, after: 538226 },
  the_boathouse: { before: 596193, after: 368355 },
  steeple_rock: { before: 706734, after: 501470 },
  silo_twins: { before: 540325, after: 417989 },
  pylon_line: { before: 563356, after: 424039 },
  scrapyard_bar: { before: 604295, after: 470427 },
  heron_marsh: { before: 702055, after: 610339 },
  truss_bridge: { before: 356785, after: 309119 },
  quarry_face: { before: 476864, after: 409292 },
  fire_tower_ridge: { before: 689318, after: 580487 },
  dam_crest: { before: 610486, after: 459559 },
  the_beacon: { before: 701767, after: 678208 },
};

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (!message.text().includes('GL Driver Message')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Open the game afloat, held still or live, and hand the page a way to put the eye anywhere. */
async function open(page: Page, live: boolean): Promise<void> {
  await page.goto(`${BASE}/?shot=play&hold=1${live ? '&live=1' : ''}${BREAK}`);
  await page.waitForFunction(() => {
    const view = (window as unknown as { portage?: { worldView?: { probe?: () => { drawingWidth: number } } } }).portage?.worldView;
    return view?.probe !== undefined && view.probe().drawingWidth > 0;
  });
  await page.addStyleTag({ content: '#interface { visibility: hidden !important; }' });
  await page.evaluate(async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const data: any = await import('/src/data/index.ts' as string);
    const sim: any = await import('/src/sim/index.ts' as string);
    const { session, worldView } = (window as any).portage;
    const drawn = worldView.render.bind(worldView);
    const world: any = { data, sim, pose: null };
    (window as any).world = world;
    worldView.render = (pose: unknown) => drawn(world.pose ?? pose);
    worldView.marks.scene.visible = false;
    /** Look from `eye` at `look`, with the canoe parked out of sight behind the eye. */
    world.view = (eye: number[], look: number[]) => {
      world.pose = { position: { x: eye[0], y: eye[1], z: eye[2] }, target: { x: look[0], y: look[1], z: look[2] }, fieldOfView: 60 };
      const length = Math.hypot(eye[0] - look[0], eye[2] - look[2]) || 1;
      const x = eye[0] + ((eye[0] - look[0]) / length) * 9;
      const z = eye[2] + ((eye[2] - look[2]) / length) * 9;
      const state = session.game;
      Object.assign(state.players[0], { mode: 'canoe', seat: 0, islandId: null, heading: 0, position: { x, y: 0, z } });
      Object.assign(state.canoe, { heading: 0, speed: 0, beached: false, position: { x, y: 0, z } });
    };
    /** An island broadside from the water, from its southern side. The Beacon from the east: south of it is the fog wall. */
    world.islandView = (id: string) => {
      const island = data.ISLANDS_BY_ID[id];
      const cosine = Math.cos(island.rotation);
      const sine = Math.sin(island.rotation);
      let direction = island.radiusX >= island.radiusZ ? [-sine, cosine] : [cosine, sine];
      if (direction[1] < -0.3) direction = [-direction[0], -direction[1]];
      if (data.REGIONS_BY_ID[island.regionId].fogWall) direction = [1, 0];
      const alongX = direction[0] * cosine + direction[1] * sine;
      const alongZ = -direction[0] * sine + direction[1] * cosine;
      const reach = Math.hypot(alongX * island.radiusX, alongZ * island.radiusZ) + Math.hypot(alongZ * island.radiusX, alongX * island.radiusZ) * 0.85 + 18;
      world.view([island.center.x + direction[0] * reach, 2.4, island.center.z + direction[1] * reach], [island.center.x, Math.min(14, island.peakHeight * 0.6 + 3), island.center.z]);
    };
    world.info = () => ({ calls: worldView.renderer.info.render.calls, triangles: worldView.renderer.info.render.triangles });
  });
}

/** Count the pixels that differ between two PNG captures of the same size. */
async function differingPixels(page: Page, first: Buffer, second: Buffer): Promise<number> {
  return page.evaluate(async ([firstPng, secondPng]) => {
    const pixelsOf = async (base64: string): Promise<ImageData> => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [one, two] = [await pixelsOf(firstPng), await pixelsOf(secondPng)];
    let different = 0;
    for (let index = 0; index < one.data.length; index += 4) {
      if (one.data[index] !== two.data[index] || one.data[index + 1] !== two.data[index + 1] || one.data[index + 2] !== two.data[index + 2]) different += 1;
    }
    return different;
  }, [first.toString('base64'), second.toString('base64')]);
}

test('a view at each of the 15 islands: clean console, everything at the rules\' place, within its triangle budget', async ({ page }) => {
  const problems = watchConsole(page);
  await open(page, false);
  const ids = Object.keys(TRIANGLES);
  expect(await page.evaluate(() => (window as any).world.data.ISLANDS.map((island: { id: string }) => island.id))).toEqual(ids);
  const rows: string[] = [];
  for (const id of ids) {
    await page.evaluate((islandId) => (window as any).world.islandView(islandId), id);
    await page.waitForTimeout(700);
    const report = await page.evaluate((islandId) => {
      const { data, sim, info } = (window as any).world;
      const island = data.ISLANDS_BY_ID[islandId];
      const view = (window as any).portage.worldView.islands.find((entry: any) => entry.definition.id === islandId);
      const wrong: string[] = [];
      // Landmarks: one mesh each, at its spot, sunk 0.1 m into the rules' ground, turned by its bearing.
      const meshes = view.group.children.filter((child: any) => child.isMesh && child.geometry.userData.landmark);
      if (meshes.length !== island.landmarks.length) wrong.push(`${meshes.length} landmark meshes for ${island.landmarks.length} landmarks`);
      island.landmarks.forEach((landmark: any, index: number) => {
        const mesh = meshes[index];
        if (!mesh) return;
        const spot = data.spotPosition(island, landmark.spot);
        const ground = Math.max(0, sim.terrainHeight(spot.x, spot.z)) - 0.1;
        if (mesh.geometry.userData.landmark !== landmark.kind) wrong.push(`${landmark.kind} drawn as ${mesh.geometry.userData.landmark}`);
        if (Math.hypot(mesh.position.x - spot.x, mesh.position.z - spot.z) > 1e-6 || Math.abs(mesh.position.y - ground) > 1e-6) wrong.push(`${landmark.kind} is off its spot`);
        if (Math.abs(mesh.rotation.y + landmark.bearing + island.rotation) > 1e-6) wrong.push(`${landmark.kind} is off its bearing`);
        if (!mesh.geometry.userData.far) wrong.push(`${landmark.kind} is not drawn with every stroke at ${Math.round(view.distance)} m`);
      });
      // Nodes: every node of the island is one instance, at its place, with its foot on the rules' ground.
      let nodes = 0;
      const matrix = view.group.matrix.clone();
      for (const nodeGroup of view.nodeGroups) {
        nodeGroup.definitions.forEach((node: any, index: number) => {
          nodes += 1;
          nodeGroup.mesh.getMatrixAt(index, matrix);
          const [x, y, z] = [matrix.elements[12], matrix.elements[13], matrix.elements[14]];
          if (Math.hypot(x - node.position.x, z - node.position.z) > 1e-4) wrong.push(`${node.id} is off its place`);
          if (!nodeGroup.floats && Math.abs(y - Math.max(0, sim.terrainHeight(node.position.x, node.position.z))) > 1e-4) wrong.push(`${node.id} is off the ground`);
          if (!nodeGroup.mesh.geometry.getAttribute('aGone')) wrong.push(`${node.id} has no used-up drawing`);
        });
      }
      if (nodes !== (data.NODES_BY_ISLAND[islandId] ?? []).length) wrong.push(`${nodes} nodes drawn of ${(data.NODES_BY_ISLAND[islandId] ?? []).length}`);
      return { wrong, ...info(), shown: view.group.visible, landmarks: meshes.length, nodes };
    }, id);
    rows.push(`${id}: ${report.calls} draw calls, ${report.triangles} triangles (stand-ins ${TRIANGLES[id].before}), ${report.landmarks} landmarks, ${report.nodes} nodes`);
    expect(report.wrong, id).toEqual([]);
    expect(report.shown, id).toBe(true);
    expect(report.triangles, `${id} against its budget`).toBeLessThanOrEqual(TRIANGLES[id].after * 1.05);
    expect(report.triangles, `${id} against the stand-ins`).toBeLessThanOrEqual(TRIANGLES[id].before * 1.06);
  }
  console.log(rows.join('\n'));
  expect(problems).toEqual([]);
});

const CROP = { x: 660, y: 330, width: 600, height: 320 };

for (const live of [false, true]) {
  test(`${live ? 'while playing' : 'paused'}, with a still camera, no pixel of the land changes at three islands`, async ({ page }) => {
    await open(page, live);
    expect(await page.evaluate(() => (window as any).portage.worldView.probe().lineBoil)).toBe(BREAK.includes('boil') ? 1 : 0);
    const lines: string[] = [];
    // Looking down on the camp and its smoke, on the church, and on a third island: the crop is all land.
    // Paused, the third is the Beacon's summit, tower and hut. Playing, it is the orchard and its farmhouse:
    // the rules turn a canoe out of the Fog within seconds and the weather turns with it, so a live view
    // there does not hold the same sky long enough to compare.
    const third = live ? (['orchard_hill', -0.05, 0, 44, 28] as const) : (['the_beacon', 0.03, 0.2, 80, 60] as const);
    for (const [id, along, across, height, back] of [['home_knoll', 0.05, -0.4, 26, 16], ['steeple_rock', 0, -0.05, 42, 26], third] as const) {
      await page.evaluate(([islandId, spotAlong, spotAcross, eyeHeight, eyeBack]) => {
        const { data, sim, view } = (window as any).world;
        const island = data.ISLANDS_BY_ID[islandId];
        const spot = data.spotPosition(island, { along: spotAlong, across: spotAcross });
        const ground = sim.terrainHeight(spot.x, spot.z);
        view([spot.x, ground + eyeHeight, spot.z + eyeBack], [spot.x, ground, spot.z]);
      }, [id, along, across, height, back] as const);
      await page.waitForTimeout(live ? 2500 : 1200);
      const first = await page.screenshot({ clip: CROP });
      await page.waitForTimeout(400);
      const second = await page.screenshot({ clip: CROP });
      const different = await differingPixels(page, first, second);
      lines.push(`${id}: ${different} of ${CROP.width * CROP.height} land pixels changed in 400 ms`);
      expect(different, id).toBe(0);
    }
    console.log(`${live ? 'playing' : 'paused'}: ${lines.join('; ')}`);
  });
}

test('a used-up node is drawn used up: what it gave is gone, and it was there before', async ({ page }) => {
  await open(page, false);
  // A cattail stand, seen from the land side against the water. The band is the picture above its stubble.
  const band = { x: 760, y: 215, width: 400, height: 290 };
  const node = await page.evaluate(() => {
    const { data, sim, view } = (window as any).world;
    const found = data.NODES_BY_ISLAND.home_knoll.find((entry: any) => entry.typeId === 'cattail_stand');
    const island = data.ISLANDS_BY_ID.home_knoll;
    const length = Math.hypot(found.position.x - island.center.x, found.position.z - island.center.z);
    const inward = [(island.center.x - found.position.x) / length, (island.center.z - found.position.z) / length];
    const ground = sim.terrainHeight(found.position.x, found.position.z);
    view([found.position.x + inward[0] * 3.6, ground + 0.9, found.position.z + inward[1] * 3.6], [found.position.x, ground + 0.9, found.position.z]);
    return found.id as string;
  });
  const shoot = async (): Promise<Buffer> => {
    await page.waitForTimeout(900);
    return page.screenshot({ clip: band });
  };
  // The staged game has been played: make sure this stand has grown back.
  await page.evaluate((id) => { delete (window as any).portage.session.game.nodes[id]; }, node);
  const fresh = await shoot();
  await page.evaluate((id) => {
    const { data } = (window as any).world;
    const state = (window as any).portage.session.game;
    state.nodes[id] = { readyAt: data.NODE_TYPES.cattail_stand.actions.map(() => null), leftover: [] };
  }, node);
  const spent = await shoot();
  // The same picture with the stand taken away altogether.
  await page.evaluate((id) => {
    const view = (window as any).portage.worldView.islands.find((entry: any) => entry.definition.id === 'home_knoll');
    for (const nodeGroup of view.nodeGroups) {
      const index = nodeGroup.definitions.findIndex((entry: any) => entry.id === id);
      if (index < 0) continue;
      nodeGroup.mesh.setMatrixAt(index, nodeGroup.mesh.matrix.clone().makeScale(0, 0, 0));
      nodeGroup.mesh.instanceMatrix.needsUpdate = true;
    }
  }, node);
  const bare = await shoot();
  const total = band.width * band.height;
  const freshShare = (await differingPixels(page, fresh, bare)) / total;
  const spentShare = (await differingPixels(page, spent, bare)) / total;
  console.log(`cattail stand, the band above its stubble: fresh covers ${(freshShare * 100).toFixed(1)}% of it, used up ${(spentShare * 100).toFixed(2)}%`);
  expect(freshShare).toBeGreaterThan(0.04);
  expect(spentShare).toBeLessThan(0.002);
});

test('the staged view of the Beacon has the lit tower in it: the lamp shows, well inside the frame', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto(`${BASE}/?shot=beacon&hold=1${BREAK}`);
  await page.waitForFunction(() => {
    const view = (window as unknown as { portage?: { worldView?: { probe?: () => { drawingWidth: number } } } }).portage?.worldView;
    return view?.probe !== undefined && view.probe().drawingWidth > 0;
  });
  await page.addStyleTag({ content: '#interface { visibility: hidden !important; }' });
  await page.waitForTimeout(1200);
  // Where the lamp is on the page, from the look's own camera. The island's name would hang over it: marks off.
  const lamp = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const view: any = (window as any).portage.worldView;
    view.marks.scene.visible = false;
    const at = view.beacon.position.clone().project(view.camera);
    return { lit: view.beacon.visible as boolean, x: (at.x * 0.5 + 0.5) * window.innerWidth, y: (0.5 - at.y * 0.5) * window.innerHeight, ahead: at.z < 1 };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
  await page.waitForTimeout(400);
  expect(lamp.lit, 'the Beacon is lit in this view').toBe(true);
  expect(lamp.ahead).toBe(true);
  expect(lamp.x).toBeGreaterThan(200);
  expect(lamp.x).toBeLessThan(1720);
  // (its rays reach 30 pixels over it: 70 keeps them inside the painted sheet)
  expect(lamp.y).toBeGreaterThan(70);
  expect(lamp.y).toBeLessThan(700);
  // The lamp is the flat lamp colour whatever the light (PAL.glow, 255 217 138): warm and bright. Fog, sky or a tree there would not be.
  const png = await page.screenshot({ clip: { x: Math.round(lamp.x) - 3, y: Math.round(lamp.y) - 3, width: 7, height: 7 } });
  const colour = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const sum = [0, 0, 0];
    for (let offset = 0; offset < data.length; offset += 4) for (let channel = 0; channel < 3; channel += 1) sum[channel] += data[offset + channel];
    return sum.map((value) => value / (data.length / 4));
  }, png.toString('base64'));
  console.log(`?shot=beacon: the lamp at ${lamp.x.toFixed(0)}, ${lamp.y.toFixed(0)} of 1920 by 1080, drawn ${colour.map((value) => value.toFixed(0)).join(' ')}`);
  expect(colour[0], 'bright').toBeGreaterThan(215);
  expect(colour[0] - colour[2], 'warm').toBeGreaterThan(60);
  expect(problems).toEqual([]);
});

