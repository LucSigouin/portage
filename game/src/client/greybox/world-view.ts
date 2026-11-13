/**
 * The greybox world view: the whole game in plain primitives, so it can be
 * played before the art exists. Flat-shaded water that follows the shared
 * wave function, islands sampled from the shared terrain function, a
 * coloured primitive per scavenge node, capsules for people, a simple hull
 * per tier and one labelled box per attachment.
 *
 * No art effort here on purpose. The real look replaces this file and keeps
 * the `WorldView` contract.
 */
import * as THREE from 'three';
import {
  ATTACHMENTS, HULL_TIERS, ISLANDS, ISLANDS_BY_ID, NODES, NODES_BY_ID, NPCS, NPC_IDS, TUNING, VALLEY_NORTH_SHORE_Z,
  VALLEY_SOUTH_SHORE_Z, WEATHER, spotPosition,
} from '../../data/index.ts';
import type { AttachmentId, IslandDefinition, LandmarkKind, NodeDefinition, NodeTypeId } from '../../data/index.ts';
import type { Settings, WaterDetail } from '../../settings/index.ts';
import {
  attachmentTransformForHull, regionAt, selectTimeOfDay, terrainHeight, valleyHalfWidth, waterRoughnessAt, waveHeight,
} from '../../sim/index.ts';
import { playerOf } from '../../sim/index.ts';
import type { GameEvent, GameState, PlayerId } from '../../sim/index.ts';
import type { CameraPose, FrameInfo, StageName, WorldView } from '../contracts.ts';

type Shape = 'box' | 'cylinder' | 'cone' | 'sphere';

interface Primitive {
  shape: Shape;
  /** Width, height, depth in metres. Round shapes use width as the diameter. */
  size: [number, number, number];
  colour: number;
}

const primitive = (shape: Shape, width: number, height: number, depth: number, colour: number): Primitive => ({
  shape, size: [width, height, depth], colour,
});

const NODE_LOOKS: Record<NodeTypeId, Primitive> = {
  driftwood_pile: primitive('box', 1.3, 0.4, 0.8, 0x9a8f80),
  cattail_stand: primitive('cylinder', 0.6, 1.4, 0.6, 0x6f8f3a),
  berry_bush: primitive('sphere', 1.1, 0.9, 1.1, 0x7a3f8f),
  apple_tree: primitive('sphere', 2.6, 3.4, 2.6, 0xb8493a),
  mushroom_log: primitive('box', 1.3, 0.35, 0.45, 0xc9a56b),
  birch: primitive('cylinder', 0.4, 5, 0.4, 0xeeeeea),
  spruce: primitive('cone', 2.2, 6, 2.2, 0x24523a),
  stone_outcrop: primitive('sphere', 1.5, 1, 1.5, 0x8a8d90),
  clay_bank: primitive('box', 1.5, 0.4, 1.1, 0xb36b3c),
  crate: primitive('box', 0.8, 0.8, 0.8, 0xa9793f),
  attic: primitive('box', 1.6, 1, 1.6, 0x8f3b32),
  shed: primitive('box', 2.2, 2, 2.2, 0x5d6f7d),
  junk_heap: primitive('box', 1.7, 0.8, 1.4, 0x93502c),
  boat_wreck: primitive('box', 1.2, 0.8, 3.2, 0xd9d4c4),
  machinery: primitive('box', 1.5, 1.5, 1.5, 0xc9a227),
  rain_barrel: primitive('cylinder', 0.8, 1, 0.8, 0x3f6fa8),
  garden_bed: primitive('box', 2, 0.3, 1.2, 0x4a3524),
  fishing_spot: primitive('cylinder', 2.2, 0.08, 2.2, 0x58d0d8),
  wreck_buoy: primitive('sphere', 0.9, 0.9, 0.9, 0xf07a1a),
  message_bottle: primitive('cylinder', 0.3, 0.5, 0.3, 0x4fd08a),
  cache: primitive('box', 0.8, 0.6, 0.6, 0xe6c34a),
  beacon_lamp: primitive('sphere', 1.2, 1.2, 1.2, 0xfff0a0),
};

const LANDMARK_LOOKS: Record<LandmarkKind, Primitive> = {
  lean_to: primitive('box', 2.6, 1.6, 2, 0x7a5a3a),
  campfire: primitive('cone', 0.9, 0.7, 0.9, 0xf08a2a),
  stump_bench: primitive('cylinder', 0.9, 0.6, 0.9, 0x8a6a45),
  cabin_roof: primitive('box', 6, 2.4, 5, 0x7d4034),
  birch_grove: primitive('cylinder', 0.5, 6, 0.5, 0xf2f2ee),
  orchard_rows: primitive('box', 14, 1.2, 9, 0x5f7f3f),
  farmhouse: primitive('box', 8, 5, 7, 0xcfc6ad),
  boathouse: primitive('box', 10, 4, 7, 0x4f6d7a),
  dock: primitive('box', 8, 0.4, 2, 0x8a7355),
  steeple: primitive('box', 4, 15, 4, 0xe6e1d6),
  silo: primitive('cylinder', 6, 13, 6, 0xb9bcc0),
  pylon: primitive('box', 2, 18, 2, 0x70777d),
  scrap_stack: primitive('box', 6, 3, 5, 0x8c4a2a),
  crane_arm: primitive('box', 1, 8, 1, 0xd0a030),
  reed_bed: primitive('box', 9, 1, 6, 0x8a8f45),
  truss_span: primitive('box', 6, 5, 44, 0x4a4f55),
  quarry_cut: primitive('box', 14, 8, 4, 0xbfc2c4),
  fire_tower: primitive('box', 3, 16, 3, 0x8a5a3a),
  dam_wall: primitive('box', 6, 6, 60, 0x9a9da0),
  gatehouse: primitive('box', 5, 4, 5, 0x7f8588),
  radio_tower: primitive('box', 3, 30, 3, 0xb04a3a),
  keeper_hut: primitive('box', 4, 3, 4, 0x6f5a45),
  bedroll: primitive('box', 0.8, 0.2, 1.8, 0x4a6fa5),
  forge_hearth: primitive('box', 1.5, 1.2, 1.5, 0x3a3a3f),
};

/** Width, height, depth of each attachment's box, metres. */
const ATTACHMENT_SIZES: Record<AttachmentId, [number, number, number]> = {
  cargo_rack: [0.7, 0.25, 0.9],
  rain_catcher: [0.7, 0.5, 0.6],
  firebox: [0.5, 0.35, 0.5],
  fishing_rig: [0.8, 0.5, 0.15],
  outrigger_port: [0.4, 0.35, 3.4],
  outrigger_starboard: [0.4, 0.35, 3.4],
  workbench: [0.8, 0.45, 0.8],
  smoker: [0.6, 0.8, 0.6],
  planter: [0.8, 0.3, 0.8],
  forge: [0.7, 0.6, 0.7],
  mast_sail: [0.12, 3.4, 0.12],
  rudder: [0.08, 0.7, 0.5],
  lantern_mast: [0.08, 1.7, 0.08],
  canopy: [1, 0.7, 1.4],
  map_table: [0.6, 0.12, 0.45],
  winch: [0.3, 0.9, 0.5],
  radio: [0.6, 0.7, 0.6],
  flag: [0.05, 0.9, 0.4],
  figurehead: [0.2, 0.4, 0.3],
  plank_chest: [0.56, 0.3, 0.36],
  tin_trunk: [0.36, 0.3, 0.4],
  sea_chest: [0.72, 0.25, 0.28],
};

const HULL_COLOURS = [0x8f8674, 0x6f5236, 0xa9743f, 0xa84f2f];
const ATTACHMENT_COLOUR = 0xd9b36a;
const DEPLETED_COLOUR = 0x565a5e;
const WATER_DAY = new THREE.Color(0x2f6f8f);
const WATER_NIGHT = new THREE.Color(0x0a1a2a);
const SKY_DAY = new THREE.Color(0x9ec9e8);
const SKY_NIGHT = new THREE.Color(0x0b1020);
const SKY_DUSK = new THREE.Color(0xe8a070);
const SKY_OVERCAST = new THREE.Color(0x7a8288);

/** Cloud cover per weather, 0 clear to 1. */
const OVERCAST = { clear: 0, fog: 0.5, rain: 0.65, storm: 0.9 } as const;

/** Water grid: a dense square of `cell`-metre cells, then cells that grow outward to the horizon. */
const WATER_GRIDS: Record<WaterDetail, { cell: number; denseCells: number }> = {
  low: { cell: 3, denseCells: 22 },
  medium: { cell: 2.4, denseCells: 30 },
  high: { cell: 2, denseCells: 40 },
};
const WATER_OUTER_CELLS = 22;
const WATER_OUTER_GROWTH = 1.3;
/** Waves fade out over this many cells at the edge of the dense square. */
const WATER_FADE_CELLS = 6;

/** Nodes further than this from the camera are not drawn, metres. */
const NODE_DRAW_DISTANCE = 320;
const MAXIMUM_EFFECTS = 14;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
};

function geometryFor(look: Primitive): THREE.BufferGeometry {
  const [width, height, depth] = look.size;
  let geometry: THREE.BufferGeometry;
  if (look.shape === 'box') geometry = new THREE.BoxGeometry(width, height, depth);
  else if (look.shape === 'cylinder') geometry = new THREE.CylinderGeometry(width / 2, width / 2, height, 10);
  else if (look.shape === 'cone') geometry = new THREE.ConeGeometry(width / 2, height, 8);
  else geometry = new THREE.SphereGeometry(0.5, 10, 8).scale(width, height, depth);
  // Sit on the ground: origin at the base.
  return geometry.translate(0, height / 2, 0);
}

/** A text label that always faces the camera. */
function createLabel(text: string, worldHeight = 0.32): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const font = '600 30px system-ui, sans-serif';
  let width = 128;
  if (context) {
    context.font = font;
    width = Math.ceil(context.measureText(text).width) + 24;
  }
  canvas.width = width;
  canvas.height = 44;
  if (context) {
    context.fillStyle = 'rgba(16, 20, 24, 0.78)';
    context.fillRect(0, 0, width, 44);
    context.font = font;
    context.fillStyle = '#ffffff';
    context.textBaseline = 'middle';
    context.fillText(text, 12, 23);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set((worldHeight * width) / 44, worldHeight, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function terrainColour(height: number, target: THREE.Color): void {
  if (height < -0.4) target.setRGB(0.2, 0.27, 0.27);
  else if (height < 0.6) target.setRGB(0.76, 0.7, 0.52);
  else if (height < 14) target.setRGB(0.36, 0.5, 0.3);
  else target.setRGB(0.52, 0.53, 0.54);
}

/** A height-field mesh over a grid, with up-facing triangles and a colour per vertex. */
function buildHeightGrid(
  countU: number,
  countV: number,
  pointAt: (indexU: number, indexV: number) => { x: number; y: number; z: number },
): THREE.BufferGeometry {
  const positions = new Float32Array((countU + 1) * (countV + 1) * 3);
  const colours = new Float32Array(positions.length);
  const colour = new THREE.Color();
  let offset = 0;
  for (let indexV = 0; indexV <= countV; indexV += 1) {
    for (let indexU = 0; indexU <= countU; indexU += 1) {
      const point = pointAt(indexU, indexV);
      positions[offset] = point.x;
      positions[offset + 1] = point.y;
      positions[offset + 2] = point.z;
      terrainColour(point.y, colour);
      colours[offset] = colour.r;
      colours[offset + 1] = colour.g;
      colours[offset + 2] = colour.b;
      offset += 3;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(gridIndices(countU, countV));
  return geometry;
}

function gridIndices(countU: number, countV: number): number[] {
  const indices: number[] = [];
  const row = countU + 1;
  for (let indexV = 0; indexV < countV; indexV += 1) {
    for (let indexU = 0; indexU < countU; indexU += 1) {
      const corner = indexV * row + indexU;
      indices.push(corner, corner + row, corner + 1, corner + 1, corner + row, corner + row + 1);
    }
  }
  return indices;
}

function buildIslandGeometry(definition: IslandDefinition): THREE.BufferGeometry {
  const reach = 1 + TUNING.world.shelfWidth;
  const extentU = definition.radiusX * reach;
  const extentV = definition.radiusZ * reach;
  const count = (extent: number): number => Math.max(16, Math.min(96, Math.round((extent * 2) / 3)));
  const countU = count(extentU);
  const countV = count(extentV);
  const cosine = Math.cos(definition.rotation);
  const sine = Math.sin(definition.rotation);
  return buildHeightGrid(countU, countV, (indexU, indexV) => {
    const along = -extentU + (indexU / countU) * extentU * 2;
    const across = -extentV + (indexV / countV) * extentV * 2;
    const x = definition.center.x + along * cosine - across * sine;
    const z = definition.center.z + along * sine + across * cosine;
    return { x, y: terrainHeight(x, z), z };
  });
}

/** The valley walls that close the lake, without the islands (they have their own meshes). */
function buildValleyGeometry(): THREE.BufferGeometry {
  const extent = TUNING.world.halfExtent + 300;
  const count = 68;
  return buildHeightGrid(count, count, (indexU, indexV) => {
    const x = -extent + (indexU / count) * extent * 2;
    const z = -extent + (indexV / count) * extent * 2;
    const shoreDistance = Math.max(Math.abs(x) - valleyHalfWidth(z), z - VALLEY_SOUTH_SHORE_Z, VALLEY_NORTH_SHORE_Z - z);
    const height = Math.max(-TUNING.world.seabedDepth, Math.min(140, shoreDistance * TUNING.world.valleyWallSlope));
    return { x, y: height, z };
  });
}

function buildHullGeometry(tier: number): THREE.BufferGeometry {
  const { length, beam, depth, draft } = HULL_TIERS[tier].dimensions;
  const geometry = new THREE.BoxGeometry(beam, depth, length, 1, 1, 12);
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const share = position.getZ(index) / (length / 2);
    // Pinch the ends to a point and lift them a little.
    position.setX(index, position.getX(index) * Math.sqrt(Math.max(0, 1 - share ** 4)));
    position.setY(index, position.getY(index) + depth * 0.25 * share * share);
  }
  position.needsUpdate = true;
  return geometry.translate(0, depth / 2 - draft, 0);
}

interface NodeVisual {
  definition: NodeDefinition;
  mesh: THREE.Mesh;
  ready: THREE.Material;
  floats: boolean;
}

interface Effect {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  kind: 'splash' | 'puff';
}

export class GreyboxWorldView implements WorldView {
  /** The player this screen follows. The greybox draws only them. */
  localPlayerId: PlayerId = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  private readonly fog = new THREE.Fog(0x9ec9e8, 50, 1500);
  private readonly skyLight = new THREE.HemisphereLight(0xffffff, 0x334433, 1);
  private readonly sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
  private readonly sky = new THREE.Color();
  private pixelRatio = 1;
  private renderScale = 1;
  private width = 1;
  private height = 1;
  private stage: StageName = 'lobby';
  private state: GameState | null = null;
  private frameCount = 0;
  private visibility = 1500;
  private overcast = 0;
  private daylight = 1;

  // Water
  private waterDetail: WaterDetail | null = null;
  private water: THREE.Mesh | null = null;
  private waterOffsets: Float32Array = new Float32Array(0);
  private waterFade: Float32Array = new Float32Array(0);
  private waterCell = 2;
  private readonly waterMaterial = new THREE.MeshLambertMaterial({ color: WATER_DAY.clone(), flatShading: true, vertexColors: true });

  // Things
  private readonly nodes: NodeVisual[] = [];
  private readonly depletedMaterial = new THREE.MeshLambertMaterial({ color: DEPLETED_COLOUR, transparent: true, opacity: 0.45 });
  private readonly canoe = new THREE.Group();
  private readonly hulls: THREE.Mesh[] = [];
  private readonly bilge = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.04, 3.2),
    new THREE.MeshLambertMaterial({ color: 0x3f8fd0, transparent: true, opacity: 0.75 }),
  );
  private readonly attachments = new THREE.Group();
  private attachmentsKey = '';
  private sail: THREE.Mesh | null = null;
  private lamp: THREE.Mesh | null = null;
  private readonly lampLight = new THREE.PointLight(0xffc870, 0, 30, 1.5);
  private readonly player = new THREE.Group();
  private readonly beaconLight = new THREE.PointLight(0xfff0a0, 0, 600, 1);
  private readonly beaconGlow = new THREE.Mesh(
    new THREE.SphereGeometry(3, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff6c0 }),
  );
  private readonly effects: Effect[] = [];
  private readonly splashGeometry = new THREE.RingGeometry(0.7, 1, 20).rotateX(-Math.PI / 2);
  private readonly puffGeometry = new THREE.SphereGeometry(0.4, 8, 6);

  mount(container: HTMLElement): void {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene.fog = this.fog;
    this.scene.add(this.skyLight, this.sun, this.sun.target);
    this.buildTerrain();
    this.buildLandmarks();
    this.buildNodes();
    this.buildSurvivors();
    this.buildCanoe();
    this.buildPlayer();
    this.buildBeacon();
    this.resize(container.clientWidth || 1, container.clientHeight || 1, 1);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.applySize();
  }

  private applySize(): void {
    if (!this.renderer) return;
    this.renderer.setPixelRatio(Math.min(3, this.pixelRatio * this.renderScale));
    this.renderer.setSize(this.width, this.height, true);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** The greybox honours render scale and water detail. It draws no shadows at any setting. */
  applyGraphicsSettings(graphics: Settings['graphics']): void {
    this.renderScale = graphics.renderScale;
    this.applySize();
    if (graphics.waterDetail !== this.waterDetail) this.buildWater(graphics.waterDetail);
  }

  showStage(stage: StageName): void {
    this.stage = stage;
  }

  // --- Building ---------------------------------------------------------------

  private buildTerrain(): void {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const definition of ISLANDS) this.scene.add(new THREE.Mesh(buildIslandGeometry(definition), material));
    this.scene.add(new THREE.Mesh(buildValleyGeometry(), material));
  }

  private buildLandmarks(): void {
    const geometries = new Map<LandmarkKind, THREE.BufferGeometry>();
    const materials = new Map<LandmarkKind, THREE.Material>();
    for (const island of ISLANDS) {
      for (const landmark of island.landmarks) {
        const look = LANDMARK_LOOKS[landmark.kind];
        if (!geometries.has(landmark.kind)) {
          geometries.set(landmark.kind, geometryFor(look));
          materials.set(landmark.kind, new THREE.MeshLambertMaterial({ color: look.colour, flatShading: true }));
        }
        const mesh = new THREE.Mesh(geometries.get(landmark.kind), materials.get(landmark.kind));
        const spot = spotPosition(island, landmark.spot);
        mesh.position.set(spot.x, Math.max(0, terrainHeight(spot.x, spot.z)) - 0.1, spot.z);
        mesh.rotation.y = -(landmark.bearing + island.rotation);
        this.scene.add(mesh);
      }
      const label = createLabel(island.name, 5);
      label.position.set(island.center.x, island.peakHeight + 22, island.center.z);
      this.scene.add(label);
    }
  }

  private buildNodes(): void {
    const geometries = new Map<NodeTypeId, THREE.BufferGeometry>();
    const materials = new Map<NodeTypeId, THREE.Material>();
    for (const definition of NODES) {
      const look = NODE_LOOKS[definition.typeId];
      if (!geometries.has(definition.typeId)) {
        geometries.set(definition.typeId, geometryFor(look));
        materials.set(definition.typeId, new THREE.MeshLambertMaterial({ color: look.colour, flatShading: true }));
      }
      const ready = materials.get(definition.typeId)!;
      const mesh = new THREE.Mesh(geometries.get(definition.typeId), ready);
      const floats = definition.reach === 'canoe';
      const { x, z } = definition.position;
      mesh.position.set(x, floats ? 0 : Math.max(0, terrainHeight(x, z)), z);
      this.scene.add(mesh);
      this.nodes.push({ definition, mesh, ready, floats });
    }
  }

  private buildSurvivors(): void {
    const geometry = new THREE.CapsuleGeometry(0.32, 1.1, 4, 10).translate(0, 0.87, 0);
    const material = new THREE.MeshLambertMaterial({ color: 0xd98a3a });
    for (const npcId of NPC_IDS) {
      const npc = NPCS[npcId];
      const spot = spotPosition(ISLANDS_BY_ID[npc.islandId], npc.spot);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(spot.x, terrainHeight(spot.x, spot.z), spot.z);
      const label = createLabel(npc.name, 0.45);
      label.position.y = 2.3;
      mesh.add(label);
      this.scene.add(mesh);
    }
  }

  private buildCanoe(): void {
    HULL_TIERS.forEach((_, tier) => {
      const hull = new THREE.Mesh(buildHullGeometry(tier), new THREE.MeshLambertMaterial({ color: HULL_COLOURS[tier], flatShading: true }));
      hull.visible = false;
      this.hulls.push(hull);
      this.canoe.add(hull);
    });
    this.canoe.add(this.bilge, this.attachments, this.lampLight);
    this.canoe.rotation.order = 'YXZ';
    this.scene.add(this.canoe);
  }

  private buildPlayer(): void {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 1.1, 4, 10).translate(0, 0.85, 0),
      new THREE.MeshLambertMaterial({ color: 0x3f7fd9 }),
    );
    // A nose, so the facing reads. Forward is -z.
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.3), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    nose.position.set(0, 1.4, -0.36);
    this.player.add(body, nose);
    this.scene.add(this.player);
  }

  private buildBeacon(): void {
    const beacon = ISLANDS_BY_ID.the_beacon;
    const tower = beacon.landmarks.find((landmark) => landmark.kind === 'radio_tower');
    const spot = spotPosition(beacon, tower ? tower.spot : { along: 0, across: 0 });
    const top = terrainHeight(spot.x, spot.z) + LANDMARK_LOOKS.radio_tower.size[1] + 2;
    this.beaconGlow.position.set(spot.x, top, spot.z);
    this.beaconLight.position.copy(this.beaconGlow.position);
    this.beaconGlow.visible = false;
    this.scene.add(this.beaconGlow, this.beaconLight);
  }

  private buildWater(detail: WaterDetail): void {
    this.waterDetail = detail;
    if (this.water) {
      this.scene.remove(this.water);
      this.water.geometry.dispose();
    }
    const { cell, denseCells } = WATER_GRIDS[detail];
    this.waterCell = cell;
    // Offsets from the grid centre along one axis: dense in the middle, growing outward.
    const half: number[] = [0];
    for (let index = 1; index <= denseCells; index += 1) half.push(index * cell);
    let step = cell;
    for (let index = 0; index < WATER_OUTER_CELLS; index += 1) {
      step *= WATER_OUTER_GROWTH;
      half.push(half[half.length - 1] + step);
    }
    const offsets = [...half.slice(1).reverse().map((value) => -value), ...half];
    const fades = offsets.map((_, index) => {
      const cellsFromCentre = Math.abs(index - (offsets.length - 1) / 2);
      return clamp01((denseCells - cellsFromCentre) / WATER_FADE_CELLS);
    });
    this.waterOffsets = Float32Array.from(offsets);
    this.waterFade = Float32Array.from(fades);
    const count = offsets.length - 1;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(offsets.length * offsets.length * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(offsets.length * offsets.length * 3).fill(1), 3));
    geometry.setIndex(gridIndices(count, count));
    this.water = new THREE.Mesh(geometry, this.waterMaterial);
    this.water.frustumCulled = false;
    this.scene.add(this.water);
  }

  // --- Per frame --------------------------------------------------------------

  sync(state: GameState, frame: FrameInfo): void {
    this.state = state;
    this.frameCount += 1;
    this.syncSky(state, frame);
    this.syncWater(state);
    this.syncCanoe(state);
    this.syncPlayer(state);
    this.syncNodes(state);
    this.syncEffects(frame.frameSeconds);
    this.beaconGlow.visible = state.flags.beacon_lit === true;
    this.beaconLight.intensity = state.flags.beacon_lit ? 40 : 0;
  }

  private syncSky(state: GameState, frame: FrameInfo): void {
    const time = selectTimeOfDay(state);
    const weather = WEATHER[state.weather.kind];
    // Daylight: up from 05:00 to 07:00, down from 19:30 to 22:00.
    const daylight = Math.min(smooth((time.hour - 5) / 2), smooth((22 - time.hour) / 2.5));
    this.daylight = daylight;
    const ease = 1 - Math.exp(-frame.frameSeconds * 0.8);
    const snap = this.frameCount <= 1 || frame.paused;
    const overcastGoal = state.weather.kind === 'storm' ? Math.max(0.5, OVERCAST.storm * state.weather.stormLevel) : OVERCAST[state.weather.kind];
    const inFog = regionAt(playerOf(state, this.localPlayerId).position.x, playerOf(state, this.localPlayerId).position.z).fogWall;
    const visibilityGoal = weather.visibility * (inFog ? 0.35 : 1);
    this.overcast = snap ? overcastGoal : this.overcast + (overcastGoal - this.overcast) * ease;
    this.visibility = snap ? visibilityGoal : this.visibility + (visibilityGoal - this.visibility) * ease;

    this.sky.copy(SKY_NIGHT).lerp(SKY_DAY, daylight);
    this.sky.lerp(SKY_DUSK, 4 * daylight * (1 - daylight) * 0.55);
    this.sky.lerp(SKY_OVERCAST.clone().multiplyScalar(0.35 + 0.65 * daylight), this.overcast);
    this.scene.background = this.sky;
    this.fog.color.copy(this.sky);
    this.fog.far = this.visibility;
    this.fog.near = this.visibility * 0.2;
    this.waterMaterial.color.copy(WATER_NIGHT).lerp(WATER_DAY, daylight).lerp(this.sky, 0.25 + 0.35 * this.overcast);

    this.skyLight.intensity = 0.55 + 0.9 * daylight * (1 - 0.3 * this.overcast);
    this.sun.intensity = 1.8 * daylight * (1 - 0.7 * this.overcast);
    const sunAngle = (time.dayFraction - 0.25) * Math.PI * 2;
    const focus = playerOf(state, this.localPlayerId).position;
    this.sun.position.set(focus.x + Math.cos(sunAngle) * 200, Math.max(20, Math.sin(sunAngle) * 200), focus.z + 80);
    this.sun.target.position.set(focus.x, 0, focus.z);
  }

  private syncWater(state: GameState): void {
    if (!this.water) return;
    const offsets = this.waterOffsets;
    const fades = this.waterFade;
    const size = offsets.length;
    const cell = this.waterCell;
    // Snap to the grid so the dense vertices do not swim as the player moves.
    const originX = Math.round(playerOf(state, this.localPlayerId).position.x / cell) * cell;
    const originZ = Math.round(playerOf(state, this.localPlayerId).position.z / cell) * cell;
    const attribute = this.water.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = attribute.array as Float32Array;
    const shadeAttribute = this.water.geometry.getAttribute('color') as THREE.BufferAttribute;
    const shades = shadeAttribute.array as Float32Array;
    const storm = state.weather.stormLevel;
    let offset = 0;
    for (let indexZ = 0; indexZ < size; indexZ += 1) {
      const z = originZ + offsets[indexZ];
      const fadeZ = fades[indexZ];
      const roughness = fadeZ > 0 ? waterRoughnessAt(0, z, storm) : 0;
      for (let indexX = 0; indexX < size; indexX += 1) {
        const x = originX + offsets[indexX];
        const fade = Math.min(fadeZ, fades[indexX]);
        const height = fade > 0 ? waveHeight(x, z, state.time, roughness) * fade : 0;
        positions[offset] = x;
        positions[offset + 1] = height;
        positions[offset + 2] = z;
        // Crests lighter, troughs darker, so the swell reads in flat light.
        const shade = 1 + Math.max(-0.3, Math.min(0.45, height * 1.6));
        shades[offset] = shade;
        shades[offset + 1] = shade;
        shades[offset + 2] = shade;
        offset += 3;
      }
    }
    attribute.needsUpdate = true;
    shadeAttribute.needsUpdate = true;
  }

  private syncCanoe(state: GameState): void {
    const canoe = state.canoe;
    this.canoe.position.set(canoe.position.x, canoe.position.y, canoe.position.z);
    this.canoe.rotation.set(canoe.pitch, -canoe.heading, -canoe.roll);
    this.hulls.forEach((hull, tier) => {
      hull.visible = tier === canoe.hullTier;
    });
    const hull = HULL_TIERS[canoe.hullTier].dimensions;
    // Water in the hull: a blue slab that rises with the water level.
    this.bilge.visible = canoe.waterLevel > 1;
    this.bilge.scale.set(hull.beam / 0.9, 1, hull.length / 4.9);
    this.bilge.position.y = -hull.draft + 0.05 + (canoe.waterLevel / 100) * (hull.depth - 0.08);

    const key = `${canoe.hullTier}:${canoe.attachments.join(',')}`;
    if (key !== this.attachmentsKey) this.rebuildAttachments(state, key);
    if (this.sail) this.sail.visible = canoe.sailRaised;
    if (this.lamp) (this.lamp.material as THREE.MeshBasicMaterial).color.setHex(canoe.lanternLit ? 0xffd070 : 0x554f40);
    this.lampLight.intensity = canoe.lanternLit ? 4 + 36 * (1 - this.daylight) : 0;
  }

  private rebuildAttachments(state: GameState, key: string): void {
    this.attachmentsKey = key;
    for (const child of [...this.attachments.children]) {
      this.attachments.remove(child);
      child.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
        if (object instanceof THREE.Sprite) object.material.map?.dispose();
      });
    }
    this.sail = null;
    this.lamp = null;
    const material = new THREE.MeshLambertMaterial({ color: ATTACHMENT_COLOUR, flatShading: true });
    for (const attachmentId of state.canoe.attachments) {
      const [width, height, depth] = ATTACHMENT_SIZES[attachmentId];
      const transform = attachmentTransformForHull(attachmentId, state.canoe.hullTier);
      const holder = new THREE.Group();
      holder.position.set(...transform.position);
      holder.rotation.set(...transform.rotation);
      const box = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth).translate(0, height / 2, 0), material);
      const label = createLabel(ATTACHMENTS[attachmentId].name, 0.2);
      label.position.y = height + 0.18;
      holder.add(box, label);
      if (attachmentId === 'mast_sail') {
        this.sail = new THREE.Mesh(
          new THREE.BoxGeometry(1.9, 2.3, 0.04).translate(0, 2.05, 0),
          new THREE.MeshLambertMaterial({ color: 0xf2ead6 }),
        );
        holder.add(this.sail);
      }
      if (attachmentId === 'lantern_mast') {
        this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0x554f40 }));
        this.lamp.position.y = height;
        holder.add(this.lamp);
        this.lampLight.position.set(transform.position[0], transform.position[1] + height, transform.position[2]);
      }
      this.attachments.add(holder);
    }
  }

  private syncPlayer(state: GameState): void {
    const player = playerOf(state, this.localPlayerId);
    this.player.visible = this.stage !== 'lobby';
    if (player.mode === 'canoe') {
      // Seated amidships: half height, riding with the hull.
      const canoe = state.canoe;
      this.player.position.set(canoe.position.x, canoe.position.y, canoe.position.z);
      this.player.rotation.y = -canoe.heading;
      this.player.scale.set(1, 0.6, 1);
    } else {
      this.player.position.set(player.position.x, player.position.y, player.position.z);
      this.player.rotation.y = -player.heading;
      this.player.scale.set(1, 1, 1);
    }
  }

  private syncNodes(state: GameState): void {
    const refresh = this.frameCount % 12 === 1;
    const camera = this.camera.position;
    for (const node of this.nodes) {
      const { x, z } = node.definition.position;
      if (refresh) {
        node.mesh.visible = Math.hypot(x - camera.x, z - camera.z) <= NODE_DRAW_DISTANCE;
        const nodeState = state.nodes[node.definition.id];
        const depleted = nodeState !== undefined && nodeState.leftover.length === 0
          && nodeState.readyAt.every((readyAt) => readyAt === null || readyAt > state.time);
        node.mesh.material = depleted ? this.depletedMaterial : node.ready;
        const scale = depleted ? 0.6 : 1;
        node.mesh.scale.set(scale, scale, scale);
      }
      if (node.floats && node.mesh.visible) {
        node.mesh.position.y = waveHeight(x, z, state.time, waterRoughnessAt(x, z, state.weather.stormLevel)) - 0.05;
      }
    }
  }

  // --- Effects ----------------------------------------------------------------

  handleEvents(events: readonly GameEvent[]): void {
    const state = this.state;
    if (!state) return;
    const canoe = state.canoe.position;
    const player = playerOf(state, this.localPlayerId).position;
    for (const event of events) {
      switch (event.type) {
        case 'node_depleted': {
          const node = NODES_BY_ID[event.nodeId];
          this.spawnEffect('puff', node.position.x, Math.max(0, terrainHeight(node.position.x, node.position.z)) + 0.6, node.position.z);
          break;
        }
        case 'canoe_beached':
        case 'canoe_launched':
        case 'capsized':
        case 'boarded':
          this.spawnEffect('splash', canoe.x, canoe.y + 0.05, canoe.z);
          break;
        case 'landed':
        case 'washed_ashore':
          this.spawnEffect('splash', player.x, Math.max(0.05, player.y + 0.05), player.z);
          break;
        case 'crafted':
          this.spawnEffect('puff', player.x, player.y + 1.2, player.z);
          break;
        case 'hull_upgraded':
        case 'attachment_built':
          this.spawnEffect('puff', canoe.x, canoe.y + 1, canoe.z);
          break;
        default:
          break;
      }
    }
  }

  private spawnEffect(kind: Effect['kind'], x: number, y: number, z: number): void {
    if (this.effects.length >= MAXIMUM_EFFECTS) this.removeEffect(0);
    const material = new THREE.MeshBasicMaterial({
      color: kind === 'splash' ? 0xe8f6ff : 0xf2efe6, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(kind === 'splash' ? this.splashGeometry : this.puffGeometry, material);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.effects.push({ mesh, age: 0, life: kind === 'splash' ? 0.9 : 0.7, kind });
  }

  private removeEffect(index: number): void {
    const [effect] = this.effects.splice(index, 1);
    this.scene.remove(effect.mesh);
    (effect.mesh.material as THREE.Material).dispose();
  }

  private syncEffects(frameSeconds: number): void {
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      effect.age += frameSeconds;
      const share = effect.age / effect.life;
      if (share >= 1) {
        this.removeEffect(index);
        continue;
      }
      const scale = effect.kind === 'splash' ? 1 + share * 3 : 1 + share * 1.6;
      effect.mesh.scale.set(scale, scale, scale);
      if (effect.kind === 'puff') effect.mesh.position.y += frameSeconds * 1.2;
      (effect.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - share);
    }
  }

  // --- Drawing ----------------------------------------------------------------

  render(pose: CameraPose): void {
    if (!this.renderer) return;
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    if (this.camera.fov !== pose.fieldOfView) {
      this.camera.fov = pose.fieldOfView;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Draw calls and triangles of the last frame, for the fps readout. */
  renderStats(): { drawCalls: number; triangles: number } {
    const info = this.renderer?.info.render;
    return { drawCalls: info?.calls ?? 0, triangles: info?.triangles ?? 0 };
  }

  dispose(): void {
    while (this.effects.length > 0) this.removeEffect(0);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
  }
}
