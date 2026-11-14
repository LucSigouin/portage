/**
 * The Ink & Wash world view: B2's look (cel washes, an ink pen pass, paper
 * tooth, drawn detail) on the real game. It reads the `GameState` and the
 * shared world functions and draws them. It holds no rule, never writes to
 * the state, and owns no clock: every motion comes from `state.time` and the
 * `FrameInfo`.
 *
 * The frame: mirrored scene -> reflection; world -> colour (4x multisampled);
 * world -> ink buffer (normals, 11-bit ink ids, line wobble); composite ->
 * pen lines, foam, paper; then the heroes (the crew and the canoe) on their
 * own, at the window's full size with every stroke; marks on top. See LOOK.md.
 */
import * as THREE from 'three';
import { ISLANDS, ISLANDS_BY_ID, NODES_BY_ID, NODES_BY_ISLAND, NPCS, NPC_IDS, TUNING, spotPosition } from '../data/index.ts';
import type { IslandDefinition, NodeDefinition, NodeTypeId } from '../data/index.ts';
import type { Settings } from '../settings/index.ts';
import { bearingBetween, regionAt, selectTimeOfDay, terrainHeight, waterRoughnessAt, waveHeight } from '../sim/index.ts';
import type { GameEvent, GameState } from '../sim/index.ts';
import type { CameraPose, CanoeBounds, FrameInfo, StageName, WorldView } from '../client/contracts.ts';
import { crewOf } from './crew.ts';
import { KIND } from './b2/detail.js';
import { Builder, THIN } from './b2/geo.js';
import { GU, PAL, inkMaterial } from './b2/palette.js';
import { createPost, heroPen } from './b2/post.js';
import type { Post } from './b2/post.js';
import { createSky } from './b2/sky.js';
import { SHORE_ISLANDS, createWater } from './b2/water.js';
import type { Water } from './b2/water.js';
import { WAVES } from './b2/waves.js';
import { CanoeView } from './canoe.ts';
import type { FigureReport } from './canoe.ts';
import { buildCharacter } from './characters.ts';
import { bankColourAt, mistDensity, paletteAt, rainInkAt } from './daylight.ts';
import type { Rgb } from './daylight.ts';
import { Effects } from './effects.ts';
import { heroMargin, heroWindow, heroWindows } from './hero-windows.ts';
import type { HeroWindow } from './hero-windows.ts';
import { LANDMARK_HEIGHT, disposeLandmarks, landmarkGeometry } from './landmarks.ts';
import { LAMP_SLOTS, LampGlows, lampsOf, poolLamps } from './lamps.ts';
import { canoePieceTime } from './lobby.ts';
import { atTheShore } from '../client/viewmodels/shore.ts';
import { Marks } from './marks.ts';
import type { Anchor } from './marks.ts';
import { NODE_MARK_HEIGHT, disposeNodes, nodeGeometry } from './nodes.ts';
import { PingBeams } from './pings.ts';
import { floraFor } from './presets.ts';
import { buildIslandProps, buildValleyForest, disposePropLibrary, instancedMesh } from './props.ts';
import type { IslandProps } from './props.ts';
import { RAIN_SHED_SHARE, Rain } from './rain.ts';
import {
  CHIP_TEST_MILLISECONDS, FIRST_WARM_UP_FRAMES, FrameLadder, HATCH_BY_SHADOWS, WARM_UP_FRAMES, WATER_CELL_BY_DETAIL, climbTo, drawingPixelRatio, fitMilliseconds,
  fittingRung, frameMilliseconds, qualityAt, qualityCeiling, shedNote, topFitMilliseconds, windowPixelRatio,
} from './quality.ts';
import type { LadderChange, Quality } from './quality.ts';
import { hashText, scatterIsland } from './scatter.ts';
import { GROUND_UNIFORM, regionUniforms, shoreUniforms, waveUniforms } from './surface.ts';
import { buildIslandTerrain, buildValleyTerrain, disposeTerrainMaterials } from './terrain.ts';
import { easeWeather, lampShareAt, rainVelocity, starsAt, weatherGoals, wetFor } from './weather.ts';
import type { WeatherLook } from './weather.ts';

/** Draw distances, metres from an island's shoreline. Each pair is (switch on, switch off): the gap stops flicker at the edge. */
const ISLAND_DRAWN = 1700;
const FULL_TREES = [650, 700] as const;
const SMALL_PROPS = [220, 250] as const;
const NODES_DRAWN = [320, 340] as const;
/** The mirror only needs what is close: beyond this an island reflects as bare ground. */
const REFLECTED_PROPS = 380;
/** Share of the sheet's width left as bare paper in the lobby (B2's 0.4). */
const LOBBY_BARE_PAPER = 0.4;
/** How far the eye picks out loot, metres. */
const LOOT_SIGHT = 70;

interface NodeGroup {
  mesh: THREE.InstancedMesh;
  definitions: NodeDefinition[];
  /** Per instance: ink id shift, washed-out share, noise offset, unused. */
  perInstance: THREE.InstancedBufferAttribute;
  floats: boolean;
}

interface IslandView {
  definition: IslandDefinition;
  group: THREE.Group;
  props: IslandProps;
  nodes: THREE.Group;
  nodeGroups: NodeGroup[];
  survivors: THREE.Group;
  /** Metres from the camera to the shoreline, at the last cull. */
  distance: number;
}

/** What `probe()` reports. */
export interface LookProbe {
  /** Size of the world's drawing in pixels. */
  drawingWidth: number;
  drawingHeight: number;
  /** Size of the canvas in pixels: the window's own. The heroes are drawn at this size. */
  canvasWidth: number;
  canvasHeight: number;
  hero: {
    /** The hero windows of the last frame, in canvas pixels from the bottom left. Empty when no hero is on screen, or with `?hero=0`. */
    windows: HeroWindow[];
    /** Hero colour buffer pixels drawn per canvas pixel of the last hero window: 1 at the window's size. 0 when the heroes are not drawn apart. */
    pixelsPerCanvasPixel: number;
    /** Ink texels per canvas pixel in the hero's ink buffer, each way. */
    inkScale: number;
    /** Fine strokes on the heroes: 1 on. */
    fine: number;
    /** How many crew figures are in the picture. */
    crew: number;
    /** Each crew figure in the picture, by player id: its seat, what it is drawn doing, what it wears. */
    figures: FigureReport[];
    /** The share of its full width the pen keeps on the local player's figure: 1 at every normal play distance, less as the figure gets small. */
    pen: number;
    /** The local player's figure on the page, in CSS pixels from the top left. Null when off screen. */
    subject: { x: number; y: number; width: number; height: number } | null;
  };
  /** The weather as drawn: the rules' weather, eased, and what it turned into. */
  weather: {
    /** 0 dry, 0.6 steady rain, 1 a full storm. */
    rain: number;
    storm: number;
    /** Fog weather, 0 to 1. */
    veil: number;
    overcast: number;
    visibility: number;
    /** Metres a second, the way it blows toward. */
    wind: [number, number];
    /** How near the next weather is, 0 to 1. */
    ahead: number;
    stars: number;
    /** The share of lamp light that shows: 0 in daylight, 1 at night. */
    lampShare: number;
    wet: number;
    /** Rain strokes drawn now, and how far the rain has fallen (metres, inside its box). */
    strokes: number;
    fallen: [number, number, number];
    /** Lamps throwing a pool (of four slots), and glows drawn. */
    pools: number;
    glows: number;
  };
  /**
   * The frame-rate ladder: every change this session, the best rung it may still climb to, and the seconds of frames it has seen (the clock of `changes[].at`).
   * `chipTest`: what the test at load found, or null if it did not run (`&chiptest=0`, `&rung=`, `&hold=1`): the rung it started on, how long it took,
   * and each rung it timed with that rung's frame, all in milliseconds.
   */
  ladder: { changes: LadderChange[]; bestAllowed: number; seconds: number; chipTest: ChipTest | null };
  /** Rungs shed by the frame-rate ladder, and what the look draws now. */
  rung: number;
  quality: Quality;
  shed: string;
  paintTime: number;
  /** 0, always, unless `?boil=1`. */
  lineBoil: number;
  /** Height of the canoe's waterline datum as drawn, and as the rules engine has it. */
  canoeDrawnHeight: number;
  canoeSimHeight: number;
  /** Height of the water at the canoe: as the graphics card draws it, and as the rules engine has it. */
  waterDrawnAtCanoe: number;
  waterSimAtCanoe: number;
  islandsDrawn: number;
  /** Puffs of smoke in the air, or about to rise: a gathering or a craft makes three. A build makes none. */
  puffs: number;
  /** Columns of light standing: one for each ping the crew has on the map. */
  beams: number;
}

/** What the chip test at load found. */
export interface ChipTest {
  /** The rung the game started on. */
  rung: number;
  /** How long the test took, milliseconds, the first frame's shader compiling left out. */
  took: number;
  /** Each rung it timed, and that rung's frame in milliseconds, drawn back to back. */
  timed: [rung: number, milliseconds: number][];
}

const setColour = (target: THREE.Color, value: Rgb): void => void target.setRGB(value[0], value[1], value[2]);

/** A node is used up when nothing is left to pick up and no action is ready. */
function depleted(state: GameState, node: NodeDefinition): boolean {
  const nodeState = state.nodes[node.id];
  return nodeState !== undefined && nodeState.leftover.length === 0
    && nodeState.readyAt.every((readyAt) => readyAt === null || readyAt > state.time);
}

export class InkWashWorldView implements WorldView {
  private renderer: THREE.WebGLRenderer | null = null;
  private post: Post | null = null;
  private water: Water | null = null;
  private sky: ReturnType<typeof createSky> | null = null;
  private marks: Marks | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 1700);
  private readonly canoe = new CanoeView();
  /** The crew and the canoe: left out of the world's passes and drawn apart, at the window's size. */
  private readonly heroes = new THREE.Group();
  /** `?hero=0` leaves them in the world, as it was: only to prove the sharpness tests can fail. */
  private heroPass = true;
  /** `&stall=N` (or `stall(N)`) holds every frame N milliseconds: a slow spell on demand, for the ladder test. */
  private stallMilliseconds = 0;
  private canvasWidth = 1;
  private canvasHeight = 1;
  private readonly effects = new Effects();
  private readonly glows = new LampGlows();
  /** A column of light on every spot the crew has pinged (`pings.ts`). */
  private readonly beams = new PingBeams();
  private readonly rain = new Rain();
  /** `&rain=0` leaves the rain's strokes out (the rings, the wet and the sky stay): to prove that in rain the land changes only where a stroke is drawn. */
  private rainStrokes = true;
  private readonly islands: IslandView[] = [];
  private readonly beacon = new THREE.Group();
  private readonly matrix = new THREE.Matrix4();
  private readonly mirrorHidden: THREE.Object3D[] = [];
  /** Stands of trees along the valley walls, each with the point they are culled from. */
  private readonly forest: { mesh: THREE.InstancedMesh; x: number; z: number; shown: boolean; distance?: number }[] = [];
  private cullDue = true;

  // Sizing and quality
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private graphics: Settings['graphics'] | null = null;
  private ceiling: Quality = { weather: 1, reflection: 0.75, fine: 1, ink: 2, resolution: 1 };
  private quality: Quality = { ...this.ceiling };
  private ladder = new FrameLadder();
  /**
   * The chip test: before the first frame is shown, time the chip and start on the rung that fits.
   * `&chiptest=0` leaves it out, and so does a start rung or a pinned ladder (`&rung=`, `&hold=1`).
   */
  private chipTestDue = false;
  private chipTest: ChipTest | null = null;
  /** The gap the last frame was meant to have, seconds. */
  private dueSeconds: number | undefined;
  private readonly testPixel = new Uint8Array(4);
  /** The page's clock cannot time a frame: the ladder then climbs without asking, as it always did. */
  private clockIsCoarse = false;
  private boil = false;
  /** ?bench=N draws every frame N times: the graphics card's true cost, and a way to make the frame-rate test fail. */
  private benchDraws = 1;

  // Per frame
  private stage: StageName = 'lobby';
  private state: GameState | null = null;
  private frameCount = 0;
  /** Seconds of drawn motion: follows the simulation's clock, never faster than real time, still while paused. */
  private paintTime = 0;
  private paintSeconds = 0;
  private lastStateTime = 0;
  /** The weather as drawn: the rules' weather, eased. */
  private weather: WeatherLook | null = null;
  /** `settle()` asks the next frame to land on the rules' weather at once. */
  private settleDue = false;
  private readonly ready: Anchor[] = [];

  // Probe (browser tests): the water's drawn height, read back from the graphics card
  private probeTarget: THREE.WebGLRenderTarget | null = null;
  private probeScene: THREE.Scene | null = null;
  private readonly probeAt = { value: new THREE.Vector2() };
  private readonly probePoint = new THREE.Vector3();

  mount(container: HTMLElement): void {
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.setClearColor(0xe0e2d8, 1);
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    // Look-only switches, for checking the look in a browser nobody can type into.
    const switches = new URLSearchParams(window.location.search);
    this.ladder = new FrameLadder({ hold: switches.has('hold'), startRung: Number(switches.get('rung')) || 0, ask: true });
    this.chipTestDue = switches.get('chiptest') !== '0' && !switches.has('hold') && !switches.has('rung');
    this.boil = switches.has('boil');
    this.benchDraws = Math.max(1, Math.min(64, Number(switches.get('bench')) || 1));
    this.heroPass = switches.get('hero') !== '0';
    this.stallMilliseconds = Math.max(0, Number(switches.get('stall')) || 0);
    this.rainStrokes = switches.get('rain') !== '0';

    const post = createPost(renderer, this.camera);
    this.post = post;
    // ?boil=1 turns B2's line boil on, on real time. It exists so the steadiness test can be seen to fail. Never on otherwise.
    post.pen.uBoil.value = this.boil ? 1 : 0;
    // ?heropen=0 keeps the full pen on a far hero, as it was. It exists so the far-figure test can be seen to fail.
    post.heroPen.value = switches.get('heropen') === '0' ? 0 : 1;
    post.bench.draws = this.benchDraws;
    post.bench.pass = switches.get('benchpass') ?? '';
    // ?hullwater=1 leaves the world's water inside the hull, as it was. It exists so the floor check can be seen to fail.
    post.hullWater.keep = switches.get('hullwater') === '1';
    const sky = createSky();
    this.sky = sky;
    const water = createWater(post.reflection, post.resolution);
    this.water = water;
    post.linkWater(water.uniforms.uDrift);
    water.uniforms.uGround.value.set(...GROUND_UNIFORM);

    this.heroes.add(this.canoe.group, this.canoe.ashore);
    this.scene.add(sky.mesh, water.mesh, buildValleyTerrain(), this.heroes, this.effects.group, this.beacon, this.glows.mesh);
    this.scene.add(this.beams.mesh);
    for (const stand of buildValleyForest()) {
      this.scene.add(stand.mesh);
      this.forest.push({ ...stand, shown: true });
    }
    for (const definition of ISLANDS) this.islands.push(this.buildIsland(definition));
    this.buildBeacon();
    this.marks = this.buildMarks();
    this.setWaveTable();

    this.showStage(this.stage);
    this.resize(container.clientWidth || 1, container.clientHeight || 1, window.devicePixelRatio || 1);
    if (this.graphics) this.applyGraphicsSettings(this.graphics);
  }

  // --- Building ---------------------------------------------------------------

  private buildIsland(definition: IslandDefinition): IslandView {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.add(buildIslandTerrain(definition));

    const props = buildIslandProps(scatterIsland(definition, floraFor(definition)), hashText(definition.id));
    group.add(props.near, props.far, props.detail);

    // Landmarks: one shared mesh per kind, placed by the island table.
    for (const landmark of definition.landmarks) {
      const mesh = new THREE.Mesh(landmarkGeometry(landmark.kind), inkMaterial);
      const spot = spotPosition(definition, landmark.spot);
      mesh.position.set(spot.x, Math.max(0, terrainHeight(spot.x, spot.z)) - 0.1, spot.z);
      mesh.rotation.y = -(landmark.bearing + definition.rotation);
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }

    // Scavenge nodes: one instanced mesh per type on this island.
    const nodes = new THREE.Group();
    nodes.matrixAutoUpdate = false;
    const nodeGroups: NodeGroup[] = [];
    const byType = new Map<NodeTypeId, NodeDefinition[]>();
    for (const node of NODES_BY_ISLAND[definition.id] ?? []) byType.set(node.typeId, [...(byType.get(node.typeId) ?? []), node]);
    for (const [typeId, definitions] of byType) {
      const floats = definitions[0].reach === 'canoe';
      const mesh = instancedMesh(nodeGeometry(typeId), definitions.map((node) => ({
        x: node.position.x,
        y: floats ? 0 : Math.max(0, terrainHeight(node.position.x, node.position.z)),
        z: node.position.z,
        yaw: (hashText(node.id) % 628) / 100,
        scale: 1,
      })), hashText(`${definition.id}.${typeId}`));
      if (floats) mesh.frustumCulled = false;
      nodes.add(mesh);
      nodeGroups.push({ mesh, definitions, perInstance: mesh.geometry.getAttribute('aInst') as THREE.InstancedBufferAttribute, floats });
    }
    group.add(nodes);

    // Survivors stand at their spot, facing the landing.
    const survivors = new THREE.Group();
    const landing = spotPosition(definition, definition.landing);
    for (const npcId of NPC_IDS) {
      if (NPCS[npcId].islandId !== definition.id) continue;
      const spot = spotPosition(definition, NPCS[npcId].spot);
      const figure = buildCharacter(npcId);
      figure.position.set(spot.x, terrainHeight(spot.x, spot.z), spot.z);
      figure.rotation.y = -bearingBetween(spot.x, spot.z, landing.x, landing.z);
      survivors.add(figure);
    }
    group.add(survivors);
    this.scene.add(group);
    return { definition, group, props, nodes, nodeGroups, survivors, distance: 0 };
  }

  /** The Beacon's light: a lamp and its rays at the top of the radio tower. Shown once it is lit. */
  private buildBeacon(): void {
    const island = ISLANDS_BY_ID.the_beacon;
    const tower = island.landmarks.find((landmark) => landmark.kind === 'radio_tower');
    const spot = spotPosition(island, tower ? tower.spot : { along: 0, across: 0 });
    const builder = new Builder(2300);
    const lamp = { glow: 1, flat: true, kind: KIND.PLAIN } as const;
    builder.sphere(1.5, PAL.glow, { ...lamp }, 12);
    for (let ray = 0; ray < 10; ray += 1) {
      const angle = (ray / 10) * Math.PI * 2;
      const reach = ray % 2 ? 5.5 : 8;
      builder.beam([Math.cos(angle) * 2.3, Math.sin(angle) * 0.25, Math.sin(angle) * 2.3], [Math.cos(angle) * reach, Math.sin(angle * 3) * 0.6, Math.sin(angle) * reach], 0.09, PAL.glow, { ...lamp, id: THIN }, 4);
    }
    this.beacon.add(builder.mesh());
    this.beacon.position.set(spot.x, terrainHeight(spot.x, spot.z) + (LANDMARK_HEIGHT.radio_tower ?? 30) + 1.2, spot.z);
    this.beacon.visible = false;
  }

  private buildMarks(): Marks {
    const names = ISLANDS.map((island) => ({ text: island.name, x: island.center.x, y: island.peakHeight + 8, z: island.center.z }));
    const landings = ISLANDS.map((island) => {
      const shore = spotPosition(island, island.landing);
      return { x: shore.x, y: 2.4, z: shore.z };
    });
    const survivors = NPC_IDS.map((npcId) => {
      const spot = spotPosition(ISLANDS_BY_ID[NPCS[npcId].islandId], NPCS[npcId].spot);
      return { text: NPCS[npcId].name, x: spot.x, y: terrainHeight(spot.x, spot.z) + 2.05, z: spot.z };
    });
    return new Marks(names, landings, survivors);
  }

  /** The parts of the water surface that never change: where each roughness band lies. */
  private setWaveTable(): void {
    regionUniforms().forEach((region, index) => GU.uRegion.value[index].set(...region));
    GU.uRegionBlend.value = TUNING.world.regionBlendMetres;
  }

  // --- Sizing and quality -----------------------------------------------------

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.applyQuality();
  }

  /**
   * Render scale 1 draws the world at the screen's full size (the heroes always are). Shadows set the hatching in
   * the shade (the look's only shadow), water detail sets the wave mesh and
   * the reflection, and the quality preset sets the pen's anti-aliasing and
   * the fine strokes. The frame-rate ladder then sheds below that if it must.
   */
  applyGraphicsSettings(graphics: Settings['graphics']): void {
    // New settings are a new ceiling: the ladder starts over, and every rung gets a fresh try.
    if (this.graphics && JSON.stringify(this.graphics) !== JSON.stringify(graphics)) this.ladder.reset();
    this.graphics = graphics;
    this.ceiling = qualityCeiling(graphics);
    GU.uHatch.value = HATCH_BY_SHADOWS[graphics.shadows];
    this.water?.setDetail(WATER_CELL_BY_DETAIL[graphics.waterDetail]);
    this.applyQuality();
  }

  /** Size everything for a rung: the ladder's own, or one the chip test is timing. */
  private applyQuality(rung = this.ladder.rung): void {
    const { renderer, post, water } = this;
    if (!renderer || !post || !water) return;
    this.quality = qualityAt(this.ceiling, rung);
    // The canvas is the window's own pixels, always: the heroes are drawn at that size. The world is drawn at
    // whatever the pixel budget, the render scale and the ladder leave it, and stretched to the canvas.
    const windowRatio = windowPixelRatio(this.width, this.height, this.pixelRatio);
    const worldRatio = drawingPixelRatio(this.width, this.height, this.pixelRatio, this.graphics?.renderScale ?? 1, this.quality.resolution);
    renderer.setPixelRatio(windowRatio);
    renderer.setSize(this.width, this.height, true);
    const canvas = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.canvasWidth = canvas.x;
    this.canvasHeight = canvas.y;
    const worldWidth = worldRatio === windowRatio ? canvas.x : Math.max(1, Math.floor(this.width * worldRatio));
    const worldHeight = worldRatio === windowRatio ? canvas.y : Math.max(1, Math.floor(this.height * worldRatio));
    post.setSize(worldWidth, worldHeight, Math.max(0.25, this.quality.reflection), this.quality.ink, canvas.x, canvas.y, this.quality.fine);
    water.uniforms.uReflect.value = this.quality.reflection > 0 ? 1 : 0;
    this.rain.resize(canvas.x, canvas.y);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** The lobby and the credits get B2's wider margin of bare paper round the painting. */
  showStage(stage: StageName): void {
    // A game begins: the work is not the lobby's, so the ladder finds its level again.
    if (stage === 'game' && this.stage !== 'game') this.ladder.find();
    this.stage = stage;
    if (!this.post) return;
    this.post.uniforms.uFrame.value = stage === 'game' ? 0.013 : 0.03;
    // The lobby leaves the left of the sheet unpainted, for the title and the menu.
    this.post.uniforms.uPaperLeft.value = stage === 'lobby' ? LOBBY_BARE_PAPER : 0;
  }

  // --- Per frame --------------------------------------------------------------

  sync(state: GameState, frame: FrameInfo): void {
    // Paint time follows the simulation's clock, capped at real time: a paused game is perfectly still,
    // a fast replay or a night's sleep does not make the water race.
    const jumped = state !== this.state;
    this.paintSeconds = jumped || frame.paused ? 0 : Math.max(0, Math.min(frame.frameSeconds, state.time - this.lastStateTime));
    this.paintTime += this.paintSeconds;
    this.lastStateTime = state.time;
    this.state = state;
    if (jumped) this.cullDue = true;
    this.frameCount += 1;
    GU.uTime.value = this.paintTime;
    if (this.post && this.boil) this.post.pen.uBoilTime.value = frame.elapsedSeconds;
    this.dueSeconds = frame.dueSeconds;
    if (this.ladder.note(frame.frameSeconds, frame.dueSeconds)) {
      this.applyQuality();
      console.info(`Portage look: frames ran long, rung ${this.ladder.rung}, ${shedNote(this.ceiling, this.quality)}`);
    }

    this.syncLight(state, jumped || this.frameCount <= 1 || this.settleDue);
    this.settleDue = false;
    this.syncWaves(state);
    // In the lobby the canoe's own pieces hold still: a raised sail does not breathe and a flag does not wave behind the menu.
    const dips = this.canoe.sync(state, crewOf(state), this.paintSeconds, canoePieceTime(this.stage, this.paintTime), this.stage !== 'lobby', jumped);
    this.syncLamps(state);
    this.beams.sync(state);
    this.syncWake(state, dips);
    this.syncNodes(state);
    this.effects.update(this.paintSeconds);
    this.beacon.visible = state.flags.beacon_lit === true;
    this.beacon.scale.setScalar(this.stage === 'credits' ? 1.5 : 1);
  }

  /** The time-of-day palette and the weather's mist. */
  private syncLight(state: GameState, snap: boolean): void {
    const inFog = regionAt(crewOf(state).local.position.x, crewOf(state).local.position.z).fogWall;
    const goal = weatherGoals(state.weather, inFog);
    if (!this.weather) this.weather = { ...goal };
    const look = this.weather;
    easeWeather(look, goal, this.paintSeconds, snap);

    const hour = selectTimeOfDay(state).hour;
    const palette = paletteAt(hour, look.overcast, look.storm);
    setColour(GU.uLight.value, palette.light);
    setColour(GU.uShadowTint.value, palette.shadowTint);
    setColour(GU.uPaper.value, palette.paper);
    setColour(GU.uFogColor.value, palette.fog);
    setColour(GU.uSkyTop.value, palette.skyTop);
    setColour(GU.uSkyLow.value, palette.skyLow);
    setColour(GU.uCloud.value, palette.cloud);
    setColour(GU.uCloudLight.value, palette.cloudLight);
    setColour(GU.uSunColor.value, palette.sun);
    setColour(GU.uFarTint.value, palette.farTint);
    setColour(GU.uWaterDeep.value, palette.waterDeep);
    setColour(GU.uWaterMid.value, palette.waterMid);
    setColour(GU.uWaterPale.value, palette.waterPale);
    setColour(GU.uInkBlue.value, palette.inkBlue);
    setColour(GU.uFoam.value, palette.foam);
    GU.uSunGlow.value = palette.sunGlow;
    GU.uOvercast.value = look.overcast;
    GU.uLightDir.value.set(...palette.lightDirection);
    GU.uSunDir.value.set(...palette.sunDirection);
    GU.uFogDensity.value = mistDensity(look.visibility);
    GU.uStars.value = starsAt(hour, look);
    GU.uDark.value = lampShareAt(hour, look);
    GU.uWet.value = wetFor(look);
    GU.uRain.value = look.rain;
    GU.uVeil.value = look.veil;
    GU.uWeatherDetail.value = this.quality.weather;

    // The wind: its speed, and the way it blows. A dead calm keeps the last heading.
    const windSpeed = Math.hypot(look.windX, look.windZ);
    if (windSpeed > 0.05) GU.uWind.value.set(look.windX / windSpeed, look.windZ / windSpeed, windSpeed);
    else GU.uWind.value.z = windSpeed;
    // What is coming stands upwind, in its own colour, as high as it is near.
    const coming = look.aheadStorm + look.aheadRain + look.aheadFog + look.aheadClear;
    GU.uAhead.value.set(-GU.uWind.value.x, -GU.uWind.value.y, look.ahead, coming > 0 ? look.aheadFog / coming : 0);
    setColour(GU.uAheadColor.value, bankColourAt(hour, look.aheadStorm, look.aheadRain, look.aheadFog, look.aheadClear));

    const pen = rainInkAt(hour, look.overcast, look.storm);
    this.rain.sync(look.rain, look.storm, rainVelocity(look), this.paintSeconds, pen.ink, pen.strength, this.quality.weather > 0 ? 1 : RAIN_SHED_SHARE);
  }

  /** The lights: a pool from each of the nearest four, a glow on every one that burns. */
  private syncLamps(state: GameState): void {
    const lamps = lampsOf(state, this.stage === 'lobby' ? { lantern: null, firebox: null } : this.canoe.lights());
    const subject = crewOf(state).local.position;
    const pools = poolLamps(lamps, subject.x, subject.z);
    for (let slot = 0; slot < LAMP_SLOTS; slot += 1) {
      const lamp = pools[slot];
      GU.uLamp.value[slot].set(lamp?.position[0] ?? 0, lamp?.position[1] ?? 0, lamp?.position[2] ?? 0, lamp && lamp.strength > 0 ? lamp.reach : 0);
      GU.uLampTint.value[slot].set(lamp?.tint[0] ?? 0, lamp?.tint[1] ?? 0, lamp?.tint[2] ?? 0, lamp?.strength ?? 0);
    }
    this.glows.sync(lamps);
  }

  /** The water surface: the rules engine's wave table at this moment, and the storm. */
  private syncWaves(state: GameState): void {
    waveUniforms(state.time).forEach((wave, index) => GU.uWave.value[index].set(...wave));
    GU.uStorm.value = state.weather.stormLevel;
  }

  private syncWake(state: GameState, dips: readonly { x: number; z: number; strength: number; size: number }[]): void {
    const water = this.water;
    if (!water) return;
    for (const dip of dips) water.ring(dip.x, dip.z, dip.strength, dip.size);
    if (this.paintSeconds <= 0) return;
    const canoe = state.canoe;
    const forwardX = Math.sin(canoe.heading);
    const forwardZ = -Math.cos(canoe.heading);
    const reach = this.canoe.halfBeam(state) * 5;
    const afloat = !canoe.beached && this.stage !== 'lobby';
    water.update(
      this.paintSeconds, canoe.position.x + forwardX * reach, canoe.position.z + forwardZ * reach, forwardX, forwardZ,
      afloat ? Math.abs(canoe.speed) : 0, 0, 0, this.canoe.halfBeam(state) * 0.45,
    );
  }

  /** Used-up nodes wash out; floating ones ride the waves; the loot in sight is listed for the marks. */
  private syncNodes(state: GameState): void {
    const refresh = this.frameCount % 12 === 1;
    const player = crewOf(state).local.position;
    if (refresh) this.ready.length = 0;
    for (const island of this.islands) {
      if (!island.nodes.visible || !island.group.visible) continue;
      for (const group of island.nodeGroups) {
        if (refresh) {
          let changed = false;
          group.definitions.forEach((node, index) => {
            const spent = depleted(state, node) ? 1 : 0;
            if (group.perInstance.getY(index) !== spent) {
              group.perInstance.setY(index, spent);
              changed = true;
            }
            const distance = Math.hypot(node.position.x - player.x, node.position.z - player.z);
            if (!spent && distance < LOOT_SIGHT) {
              const ground = group.floats ? 0 : Math.max(0, terrainHeight(node.position.x, node.position.z));
              this.ready.push({ x: node.position.x, y: ground + NODE_MARK_HEIGHT[node.typeId], z: node.position.z });
            }
          });
          if (changed) group.perInstance.needsUpdate = true;
        }
        if (group.floats) {
          group.definitions.forEach((node, index) => {
            const { x, z } = node.position;
            const height = waveHeight(x, z, state.time, waterRoughnessAt(x, z, state.weather.stormLevel)) - 0.05;
            group.mesh.setMatrixAt(index, this.matrix.makeTranslation(x, height, z));
          });
          group.mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
    if (refresh) this.ready.sort((first, second) => Math.hypot(first.x - player.x, first.z - player.z) - Math.hypot(second.x - player.x, second.z - player.z));
  }

  // --- Effects ----------------------------------------------------------------

  handleEvents(events: readonly GameEvent[]): void {
    const state = this.state;
    const water = this.water;
    if (!state || !water) return;
    const canoe = state.canoe.position;
    const player = crewOf(state).local.position;
    const splash = (x: number, z: number): void => {
      water.ring(x, z, 1, 1.5);
      water.ring(x, z, 0.8, 0.8);
    };
    for (const event of events) {
      switch (event.type) {
        case 'node_depleted': {
          const node = NODES_BY_ID[event.nodeId];
          this.effects.puff(node.position.x, Math.max(0, terrainHeight(node.position.x, node.position.z)) + 0.6, node.position.z);
          break;
        }
        case 'canoe_beached':
        case 'canoe_launched':
        case 'capsized':
        case 'boarded':
          splash(canoe.x, canoe.z);
          break;
        case 'landed':
        case 'washed_ashore':
          splash(player.x, player.z);
          break;
        case 'crafted':
          this.effects.puff(player.x, player.y + 1.2, player.z);
          break;
        // A build draws no puff. Whoever built it is shown the canoe, still, with the new piece on it (the client's
        // built view), and a puff would move in that picture. The old one rose a metre over the hull, behind the
        // builder panel, and played over the player's face when the panel closed.
        default:
          break;
      }
    }
  }

  // --- Drawing ----------------------------------------------------------------

  /** Switch each island's groups by distance, with a gap between on and off so nothing flickers at the edge. */
  private cull(): void {
    const eye = this.camera.position;
    const within = (shown: boolean, distance: number, range: readonly [number, number]): boolean => distance < (shown ? range[1] : range[0]);
    for (const island of this.islands) {
      const { center, radiusX, radiusZ } = island.definition;
      const distance = Math.max(0, Math.hypot(center.x - eye.x, center.z - eye.z) - Math.max(radiusX, radiusZ));
      island.distance = distance;
      island.group.visible = distance < ISLAND_DRAWN;
      island.props.near.visible = within(island.props.near.visible, distance, FULL_TREES);
      island.props.far.visible = !island.props.near.visible;
      island.props.detail.visible = within(island.props.detail.visible, distance, SMALL_PROPS);
      island.nodes.visible = within(island.nodes.visible, distance, NODES_DRAWN);
      island.survivors.visible = island.nodes.visible;
    }
    for (const stand of this.forest) {
      stand.distance = Math.hypot(stand.x - eye.x, stand.z - eye.z);
      stand.shown = stand.distance < ISLAND_DRAWN;
      stand.mesh.visible = stand.shown;
    }
  }

  /** The water needs the ground of the islands nearest the player, and the valley's shore there. */
  private syncShore(x: number, z: number): void {
    const water = this.water;
    if (!water) return;
    const shore = shoreUniforms(x, z, SHORE_ISLANDS);
    shore.isleA.forEach((values, index) => water.uniforms.uIsleA.value[index].set(...values));
    shore.isleB.forEach((values, index) => water.uniforms.uIsleB.value[index].set(...values));
    water.uniforms.uValley.value.set(...shore.valley);
    water.uniforms.uValleyZ.value = shore.valleyZ;
  }

  render(pose: CameraPose): void {
    const { renderer, post, water, sky, marks, state } = this;
    if (!renderer || !post || !water || !sky || !marks || !state) return;
    const camera = this.camera;
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    if (camera.fov !== pose.fieldOfView) {
      camera.fov = pose.fieldOfView;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    if (this.stallMilliseconds > 0) {
      const until = performance.now() + this.stallMilliseconds;
      while (performance.now() < until);
    }

    const subject = crewOf(state).local.position;
    if (this.cullDue || this.frameCount % 10 === 1) {
      this.cullDue = false;
      this.cull();
      this.syncShore(subject.x, subject.z);
    }
    sky.update(camera);
    water.follow(camera, subject.x, subject.z);
    // Island names only aboard or at the water's edge (Luc's bugfix list, line 4): `client/viewmodels/shore.ts`.
    const local = crewOf(state).local;
    marks.update(camera, subject, local.mode === 'canoe', this.ready, this.stage === 'game', atTheShore(local));

    renderer.info.reset();
    water.renderWake(renderer);
    // Where the heroes are on the window: each gets a rectangle of the canvas, drawn at the canvas's own size.
    this.heroes.updateMatrixWorld();
    const windows = this.heroPass ? heroWindows(this.canoe.heroes(), camera, this.canvasWidth, this.canvasHeight, heroMargin(this.canvasHeight)) : [];
    const draw = (): void => post.render(this.scene, camera, water.mesh, this.rainStrokes && this.rain.falling ? [this.rain.scene, marks.scene] : marks.scene, this.quality.reflection > 0, (pass) => this.beforePass(pass), this.heroPass ? this.heroes : null, windows);
    if (this.chipTestDue) this.startOnFittingRung(draw);
    else if (this.ladder.asking !== null) this.answerLadder(this.ladder.asking, draw);
    else return draw();
    // The timing drew frames nobody sees: the frame's own counts are the last draw's alone.
    renderer.info.reset();
    draw();
  }

  /**
   * The honest cost of a frame on a rung, in milliseconds: the frame drawn twice back to back, then the chip is
   * waited for (`frameMilliseconds`). Leaves the world sized for that rung. It all happens inside one frame, so none
   * of it is shown: the caller draws the real frame last. `again`: time it a second time and keep the quicker.
   * `warmUps`: frames drawn first and left out. The first on new buffers pays for making them.
   */
  private frameCost(rung: number, draw: () => void, again: (milliseconds: number) => boolean = () => false, warmed: () => void = () => {}, warmUps = WARM_UP_FRAMES): number {
    const renderer = this.renderer;
    if (!renderer) return 0;
    const gl = renderer.getContext();
    const finish = (): void => {
      renderer.setRenderTarget(null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.testPixel);
    };
    this.applyQuality(rung);
    return frameMilliseconds(draw, finish, () => performance.now(), warmUps, again, warmed);
  }

  /** The chip test (S1): time the chip on the first frame, before anything is shown, and start on the best rung that fits. */
  private startOnFittingRung(draw: () => void): void {
    this.chipTestDue = false;
    const fits = fitMilliseconds(this.dueSeconds);
    // Rung 0 fits when the ladder itself would hold it: the test's margin never takes a pixel from a machine at the line.
    const topFits = topFitMilliseconds(this.dueSeconds);
    const timed: [number, number][] = [];
    let from = 0;
    const measure = (candidate: number): number => {
      // Top quality gets a second look when it is close: a busy moment must not cost a good chip its pixels.
      // The test's very first frame compiles every shader, and the frame after it still runs long: two are left out.
      const cost = this.frameCost(candidate, draw, (first) => candidate === 0 && first > topFits && first <= topFits * 2, () => {
        if (from === 0) from = performance.now();
      }, timed.length === 0 ? FIRST_WARM_UP_FRAMES : WARM_UP_FRAMES);
      timed.push([candidate, cost]);
      return cost;
    };
    const outOfTime = (): boolean => performance.now() - from > CHIP_TEST_MILLISECONDS;
    let rung = fittingRung(measure, fits, outOfTime, undefined, 0, topFits);
    // And a last look at the top if there is time: the chip may only have been busy when the test began.
    if (rung > 0 && !outOfTime() && measure(0) <= topFits) rung = 0;
    // A clock too coarse to time a frame (some private modes) proves nothing: start at the top and let the ladder judge.
    const blind = timed.some(([, cost]) => cost <= 0);
    this.clockIsCoarse = blind;
    this.ladder.startOn(blind ? 0 : rung);
    this.applyQuality();
    this.chipTest = { rung: this.ladder.rung, took: performance.now() - from, timed };
    console.info(`Portage look: chip test, top quality takes ${timed[0][1].toFixed(1)} ms a frame (${topFits.toFixed(1)} fits), starting on rung ${this.ladder.rung}, ${shedNote(this.ceiling, this.quality)}`);
  }

  /** The ladder wants the rung above: time it first, so it only climbs to a rung the chip has room for. */
  private answerLadder(asked: number, draw: () => void): void {
    const from = performance.now();
    const fits = fitMilliseconds(this.dueSeconds);
    const timed: string[] = [];
    const measure = (rung: number): number => {
      const cost = this.frameCost(rung, draw);
      timed.push(`rung ${rung} ${cost.toFixed(1)} ms`);
      return cost;
    };
    const climbed = this.ladder.answer(this.clockIsCoarse ? asked
      : climbTo(asked, this.ladder.bestAllowed, measure, fits, () => performance.now() - from > CHIP_TEST_MILLISECONDS, topFitMilliseconds(this.dueSeconds)));
    this.applyQuality();
    console.info(`Portage look: ${climbed ? 'frames are quick again' : 'no room to climb yet'} (${timed.join(', ')}; ${fits.toFixed(1)} fits), rung ${this.ladder.rung}, ${shedNote(this.ceiling, this.quality)}`);
  }

  /** How big the canoe is as drawn, with everything bolted onto it, and the frame's shape: what the built view frames. */
  canoeBounds(): CanoeBounds | null {
    if (!this.state) return null;
    const box = this.canoe.bounds();
    if (box.isEmpty()) return null;
    // Which side of the hull the light falls on: the light's direction against the canoe's own starboard, in the world.
    const elements = this.canoe.group.matrixWorld.elements;
    const light = GU.uLightDir.value;
    const toStarboard = light.x * elements[0] + light.y * elements[1] + light.z * elements[2];
    const lit = Math.abs(toStarboard) < 0.15 ? null : toStarboard > 0 ? 'starboard' : 'port';
    return { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z }, aspect: this.width / this.height, lit };
  }

  /** The frame's shape, width over height, for the lobby's camera. */
  viewAspect(): number {
    return this.width / this.height;
  }

  /** Before each pass of the world (2 mirrored, 0 colour, 1 ink): the mirror sees less, and the ink buffer no washes of light. */
  private beforePass(pass: number): void {
    this.glows.mesh.visible = pass !== 1;
    if (pass !== 1) this.thinForMirror(pass === 2);
  }

  /** The mirror sees bare ground on far islands: their trees and loot would be a few pixels, at a third of the frame's draw calls. */
  private thinForMirror(mirror: boolean): void {
    if (!mirror) {
      for (const object of this.mirrorHidden) object.visible = true;
      this.mirrorHidden.length = 0;
      return;
    }
    for (const island of this.islands) {
      if (island.distance < REFLECTED_PROPS || !island.group.visible) continue;
      for (const object of [island.props.near, island.props.far, island.props.detail, island.nodes, island.survivors]) {
        if (!object.visible) continue;
        object.visible = false;
        this.mirrorHidden.push(object);
      }
    }
    for (const stand of this.forest) {
      if (!stand.mesh.visible || (stand.distance ?? 0) < REFLECTED_PROPS + 200) continue;
      stand.mesh.visible = false;
      this.mirrorHidden.push(stand.mesh);
    }
  }

  /** Test hook: draw every pass `draws` times from now on (`pass` names one pass only). The same as `&bench=N&benchpass=`. */
  bench(draws: number, pass = ''): void {
    if (this.post) Object.assign(this.post.bench, { draws: Math.max(1, Math.min(64, draws)), pass });
  }

  /** Test hook: land on the rules' weather at the next frame, without easing. For a staged view that is held still. */
  settle(): void {
    this.settleDue = true;
  }

  /** Test hook: hold every frame this many milliseconds from now on. 0 lets go. The same as `&stall=N`. */
  stall(milliseconds: number): void {
    this.stallMilliseconds = Math.max(0, milliseconds);
  }

  /** Draw calls and triangles of the last frame, all passes together. */
  renderStats(): { drawCalls: number; triangles: number } {
    const info = this.renderer?.info.render;
    return { drawCalls: info?.calls ?? 0, triangles: info?.triangles ?? 0 };
  }

  /**
   * The water's drawn height at a point, worked out by the graphics card from
   * the same shader code and uniforms the water mesh uses, and read back.
   */
  private readWaterHeight(x: number, z: number): number {
    const renderer = this.renderer;
    if (!renderer || !renderer.extensions.has('EXT_color_buffer_float')) return Number.NaN;
    if (!this.probeTarget || !this.probeScene) {
      this.probeTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
      const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { uWave: GU.uWave, uRegion: GU.uRegion, uWaveArea: GU.uWaveArea, uRegionBlend: GU.uRegionBlend, uStorm: GU.uStorm, uAt: this.probeAt },
        vertexShader: `${WAVES}
          uniform vec2 uAt;
          out float vHeight;
          void main(){ vHeight = waveSurface(uAt); gl_Position = vec4(0., 0., 0., 1.); gl_PointSize = 1.; }`,
        fragmentShader: 'precision highp float; in float vHeight; layout(location = 0) out vec4 oHeight; void main(){ oHeight = vec4(vHeight, 0., 0., 1.); }',
      }));
      points.frustumCulled = false;
      this.probeScene = new THREE.Scene();
      this.probeScene.add(points);
    }
    this.probeAt.value.set(x, z);
    const pixel = new Float32Array(4);
    renderer.setRenderTarget(this.probeTarget);
    renderer.render(this.probeScene, this.camera);
    renderer.readRenderTargetPixels(this.probeTarget, 0, 0, 1, 1, pixel);
    renderer.setRenderTarget(null);
    return pixel[0];
  }

  /** Numbers for the browser tests and the console: `window.portage.worldView.probe()`. */
  probe(): LookProbe {
    const state = this.state;
    const canoe = state?.canoe.position ?? { x: 0, y: 0, z: 0 };
    const drawn = this.post?.state;
    const lastWindow = drawn?.heroWindows[drawn.heroWindows.length - 1];
    const ratio = this.canvasHeight / this.height;
    const local = this.canoe.localFigure();
    const figure = state && this.stage !== 'lobby' ? heroWindow(local, this.camera, this.canvasWidth, this.canvasHeight, 0) : null;
    // The pen on the local figure: from how much of the world the window's height covers at the figure's depth, as the shader does per pixel.
    const depth = -this.probePoint.setFromMatrixPosition(local.matrixWorld).applyMatrix4(this.camera.matrixWorldInverse).z;
    const thinned = this.heroPass && this.post?.heroPen.value === 1;
    return {
      drawingWidth: drawn?.w ?? 0,
      drawingHeight: drawn?.h ?? 0,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      hero: {
        windows: (drawn?.heroWindows ?? []).map((window) => ({ ...window })),
        pixelsPerCanvasPixel: drawn && lastWindow ? Math.min(drawn.heroDrawnW / lastWindow.w, drawn.heroDrawnH / lastWindow.h) : 0,
        inkScale: drawn && lastWindow ? drawn.heroInkScale : 0,
        fine: drawn?.heroFine ?? 0,
        crew: this.canoe.figuresShown(),
        figures: state && this.stage !== 'lobby' ? this.canoe.figures() : [],
        pen: thinned ? heroPen(2 * Math.tan((this.camera.fov * Math.PI) / 360) * depth) : 1,
        subject: figure && { x: figure.x / ratio, y: (this.canvasHeight - figure.y - figure.h) / ratio, width: figure.w / ratio, height: figure.h / ratio },
      },
      weather: {
        rain: this.weather?.rain ?? 0,
        storm: this.weather?.storm ?? 0,
        veil: this.weather?.veil ?? 0,
        overcast: this.weather?.overcast ?? 0,
        visibility: this.weather?.visibility ?? 0,
        wind: [this.weather?.windX ?? 0, this.weather?.windZ ?? 0],
        ahead: this.weather?.ahead ?? 0,
        stars: GU.uStars.value,
        lampShare: GU.uDark.value,
        wet: GU.uWet.value,
        strokes: this.rainStrokes ? this.rain.drawn : 0,
        fallen: [...this.rain.fallen],
        pools: GU.uLamp.value.filter((lamp) => lamp.w > 0).length,
        glows: this.glows.mesh.count,
      },
      ladder: {
        changes: this.ladder.changes.map((change) => ({ ...change })), bestAllowed: this.ladder.bestAllowed, seconds: this.ladder.seconds,
        chipTest: this.chipTest && { ...this.chipTest, timed: this.chipTest.timed.map(([rung, milliseconds]) => [rung, milliseconds]) },
      },
      rung: this.ladder.rung,
      quality: { ...this.quality },
      shed: shedNote(this.ceiling, this.quality),
      paintTime: this.paintTime,
      lineBoil: this.post?.pen.uBoil.value ?? 0,
      canoeDrawnHeight: this.canoe.group.matrixWorld.elements[13],
      canoeSimHeight: canoe.y,
      waterDrawnAtCanoe: this.readWaterHeight(canoe.x, canoe.z),
      waterSimAtCanoe: state ? waveHeight(canoe.x, canoe.z, state.time, waterRoughnessAt(canoe.x, canoe.z, state.weather.stormLevel)) : 0,
      islandsDrawn: this.islands.filter((island) => island.group.visible).length,
      puffs: this.effects.active,
      beams: this.beams.beams.length,
    };
  }

  dispose(): void {
    this.canoe.dispose();
    this.effects.dispose();
    this.glows.dispose();
    this.beams.dispose();
    this.rain.dispose();
    this.marks?.dispose();
    this.water?.dispose();
    this.post?.dispose();
    this.probeTarget?.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    disposeLandmarks();
    disposeNodes();
    disposePropLibrary();
    disposeTerrainMaterials();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
  }
}
