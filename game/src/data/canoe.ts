import type {
  AttachmentDefinition, AttachmentId, HullTierDefinition, ItemAmount, ItemId, MountAnchor, MountId,
  StationId, ToolId, Transform,
} from './types.ts';

const amount = (itemId: ItemId, count: number): ItemAmount => ({ itemId, count });

const BASE_MOUNTS: MountId[] = [];
const RIBBED_MOUNTS: MountId[] = [
  'mid_aft_hull', 'stern_quarter_frame', 'mid_forward_slab', 'starboard_gunwale', 'port_float',
  'starboard_float', 'port_deck_forward', 'port_deck_aft', 'starboard_deck_forward',
  'starboard_deck_aft', 'mast_step', 'stern_post', 'bow_pole', 'cockpit_hoops', 'cockpit_table',
  'stern_rail', 'bow_stem',
];

/** Hull tiers in order. Index = tier. */
export const HULL_TIERS: HullTierDefinition[] = [
  {
    tier: 0, id: 'leaky_canoe', name: 'Leaky canoe',
    description: 'Cedar strip, split along two seams. It floats. Mostly.',
    iconId: 'hull_leaky_canoe', cost: [], tools: [],
    cargoSlots: 8, leakPerSecond: 0.4, speedMultiplier: 1,
    dimensions: { length: 4.9, beam: 0.9, depth: 0.38, draft: 0.15 },
    mountIds: BASE_MOUNTS,
  },
  {
    tier: 1, id: 'patched_canoe', name: 'Patched canoe',
    description: 'Bark over the seams, pitch over the bark. Dry feet at last.',
    iconId: 'hull_patched_canoe', cost: [amount('pitch', 2), amount('birch_bark', 3)], tools: [],
    cargoSlots: 8, leakPerSecond: 0, speedMultiplier: 1,
    dimensions: { length: 4.9, beam: 0.9, depth: 0.38, draft: 0.15 },
    mountIds: BASE_MOUNTS,
  },
  {
    tier: 2, id: 'ribbed_canoe', name: 'Ribbed canoe',
    description: 'New ribs and rails. Strong enough to bolt things onto.',
    iconId: 'hull_ribbed_canoe', cost: [amount('plank', 8), amount('nails', 6), amount('rope', 2)], tools: ['hammer'],
    cargoSlots: 12, leakPerSecond: 0, speedMultiplier: 1,
    dimensions: { length: 4.9, beam: 0.95, depth: 0.42, draft: 0.16 },
    mountIds: RIBBED_MOUNTS,
  },
  {
    tier: 3, id: 'long_canoe', name: 'Long canoe',
    description: 'A metre and a half longer, sheathed at the bow. Fast and deep.',
    iconId: 'hull_long_canoe',
    cost: [amount('plank', 10), amount('hardware', 4), amount('pitch', 3), amount('metal_sheet', 2)],
    tools: ['hammer', 'saw'],
    cargoSlots: 16, leakPerSecond: 0, speedMultiplier: 1.15,
    dimensions: { length: 6.4, beam: 1.05, depth: 0.46, draft: 0.18 },
    mountIds: [...RIBBED_MOUNTS, 'bow_crane', 'stern_shack'],
  },
];

/** Hull the attachment transforms are authored on. */
export const REFERENCE_HULL_TIER = 2;

interface AttachmentOptions {
  minimumHullTier?: 0 | 1 | 2 | 3;
  requiresAttachments?: AttachmentId[];
  cosmetic?: boolean;
  stabilityBonus?: number;
  cargoSlotsBonus?: number;
  station?: StationId;
}

function attachment(
  id: AttachmentId,
  name: string,
  mountId: MountId,
  anchor: MountAnchor,
  position: [number, number, number],
  rotation: [number, number, number],
  cost: ItemAmount[],
  tools: ToolId[],
  description: string,
  options: AttachmentOptions = {},
): AttachmentDefinition {
  const transform: Transform = { position, rotation };
  return {
    id, name, description, iconId: `attachment_${id}`, mountId, anchor, transform, cost, tools,
    minimumHullTier: options.minimumHullTier ?? 2,
    requiresAttachments: options.requiresAttachments ?? [],
    cosmetic: options.cosmetic ?? false,
    stabilityBonus: options.stabilityBonus ?? 0,
    cargoSlotsBonus: options.cargoSlotsBonus ?? 0,
    station: options.station ?? null,
  };
}

const NO_ROTATION: [number, number, number] = [0, 0, 0];
const OUTRIGGER_COST = [amount('log', 2), amount('plank', 4), amount('rope', 2), amount('nails', 4)];

const ATTACHMENT_LIST: AttachmentDefinition[] = [
  attachment('cargo_rack', 'Cargo rack', 'mid_aft_hull', 'centre', [0, 0.1, 0.55], NO_ROTATION,
    [amount('plank', 4), amount('rope', 2), amount('nails', 2)], ['hammer'],
    'Slatted shelves low in the hull. Six more stacks.', { cargoSlotsBonus: 6 }),
  attachment('rain_catcher', 'Rain catcher', 'stern_quarter_frame', 'stern', [-0.3, 0.75, 1.95], [0, 0, 0.2],
    [amount('cloth', 2), amount('plank', 2), amount('rope', 1), amount('tin_can', 1)], ['hammer'],
    'A cloth funnel on a frame. Rain becomes clean water.'),
  attachment('firebox', 'Firebox', 'mid_forward_slab', 'centre', [0, 0.12, -1.25], NO_ROTATION,
    [amount('stone', 6), amount('clay', 4), amount('scrap_metal', 2)], ['hammer'],
    'A clay-lined hearth on a stone slab. Fire aboard, and warmth.', { station: 'fire' }),
  attachment('fishing_rig', 'Fishing rig', 'starboard_gunwale', 'centre', [0.5, 0.42, 0.2], [0, Math.PI / 2, 0],
    [amount('plank', 1), amount('rope', 2), amount('wire', 1)], ['hammer', 'fishing_rod'],
    'Two set lines on the gunwale. Fishes while you are beached or asleep.'),
  attachment('outrigger_port', 'Port outrigger', 'port_float', 'centre', [-1.9, 0, 0], NO_ROTATION,
    OUTRIGGER_COST, ['hammer', 'saw'],
    'A log float on two spars, decked over. Steadier, with room to build.', { stabilityBonus: 1 }),
  attachment('outrigger_starboard', 'Starboard outrigger', 'starboard_float', 'centre', [1.9, 0, 0], NO_ROTATION,
    OUTRIGGER_COST, ['hammer', 'saw'],
    'The matching float. Now nothing short of a storm will tip her.', { stabilityBonus: 1 }),
  attachment('workbench', 'Workbench', 'port_deck_forward', 'centre', [-1.1, 0.35, -0.6], NO_ROTATION,
    [amount('plank', 6), amount('nails', 4), amount('scrap_metal', 1)], ['hammer', 'saw'],
    'A bench and vice on the port deck. Saw and sew anywhere.',
    { requiresAttachments: ['outrigger_port'], station: 'bench' }),
  attachment('smoker', 'Smoker', 'port_deck_aft', 'centre', [-1.1, 0.35, 0.6], NO_ROTATION,
    [amount('plank', 3), amount('clay', 3), amount('stone', 2), amount('scrap_metal', 2)], ['hammer'],
    'A clay smoke box. Turns fish and apples into food that keeps.',
    { requiresAttachments: ['outrigger_port'], station: 'smoker' }),
  attachment('planter', 'Planter', 'starboard_deck_forward', 'centre', [1.1, 0.35, -0.6], NO_ROTATION,
    [amount('plank', 3), amount('clay', 2), amount('seeds', 3)], ['hammer'],
    'A box of earth on the starboard deck. Berries and roots each morning.',
    { requiresAttachments: ['outrigger_starboard'] }),
  attachment('forge', 'Forge', 'starboard_deck_aft', 'centre', [1.1, 0.35, 0.6], NO_ROTATION,
    [amount('stone', 6), amount('clay', 4), amount('metal_sheet', 1), amount('bellows', 1)], ['hammer'],
    'A hearth with Tink’s bellows. Work metal without sailing back to her.',
    { requiresAttachments: ['outrigger_starboard'], station: 'forge' }),
  attachment('mast_sail', 'Mast and sail', 'mast_step', 'centre', [0, 0.2, -0.4], NO_ROTATION,
    [amount('log', 2), amount('sailcloth', 2), amount('rope', 3), amount('nails', 2)], ['hammer', 'hatchet'],
    'A spruce mast and a square of sailcloth. The wind does the paddling.'),
  attachment('rudder', 'Rudder', 'stern_post', 'stern', [0, -0.05, 2.45], NO_ROTATION,
    [amount('plank', 2), amount('scrap_metal', 2), amount('rope', 1), amount('nails', 2)], ['hammer', 'saw'],
    'A blade on the stern post. Tighter turns, and the sail holds a reach.'),
  attachment('lantern_mast', 'Lantern mast', 'bow_pole', 'bow', [0, 0.3, -2.2], NO_ROTATION,
    [amount('log', 1), amount('glass_jar', 1), amount('tin_can', 1), amount('wire', 2), amount('pitch', 1)], ['hammer'],
    'A pitch lamp on a bow pole. Light at night, and a way through the Fog.'),
  attachment('canopy', 'Canopy', 'cockpit_hoops', 'centre', [0, 0.45, 1.35], NO_ROTATION,
    [amount('sailcloth', 2), amount('plank', 2), amount('rope', 2)], ['hammer'],
    'Hoops and cloth over the cockpit. Sleep aboard, dry, wherever you beach.'),
  attachment('map_table', 'Map table', 'cockpit_table', 'centre', [0, 0.36, 0.98], NO_ROTATION,
    [amount('plank', 2), amount('cloth', 1), amount('lens', 1), amount('lodestone', 1)], ['hammer', 'saw'],
    'A chart board with a lens and a lodestone. The whole valley, with bearings.'),
  attachment('winch', 'Winch', 'bow_crane', 'bow', [0.25, 0.4, -1.75], NO_ROTATION,
    [amount('steel_cable', 1), amount('hardware', 2), amount('plank', 2), amount('log', 1)], ['hammer', 'wrench'],
    'A crane arm and a drum of cable. Hauls up what the flood took.', { minimumHullTier: 3 }),
  attachment('radio', 'Radio', 'stern_shack', 'stern', [0.1, 0.4, 1.7], NO_ROTATION,
    [amount('copper_coil', 1), amount('battery', 1), amount('wire', 3), amount('radio_crystal', 1), amount('plank', 2), amount('metal_sheet', 1)],
    ['hammer', 'wrench'],
    'A crystal set in a stern shack. Hears the Beacon and marks what matters.', { minimumHullTier: 3 }),
  attachment('flag', 'Flag', 'stern_rail', 'stern', [0.32, 0.55, 2.3], NO_ROTATION,
    [amount('signal_flag', 1)], [],
    'Wren’s red pennant on the stern rail.', { cosmetic: true }),
  attachment('figurehead', 'Figurehead', 'bow_stem', 'bow', [0, 0.38, -2.5], NO_ROTATION,
    [amount('carved_figurehead', 1)], [],
    'Tink’s cedar loon, leading the way.', { cosmetic: true }),
];

export const ATTACHMENTS: Record<AttachmentId, AttachmentDefinition> = Object.fromEntries(
  ATTACHMENT_LIST.map((definition) => [definition.id, definition]),
) as Record<AttachmentId, AttachmentDefinition>;

export const ATTACHMENT_IDS: AttachmentId[] = ATTACHMENT_LIST.map((definition) => definition.id);

/**
 * Where an attachment sits on a given hull tier, in canoe space. Bow and stern
 * mounts slide with the ends of the hull when it grows; centre mounts stay put.
 */
export function attachmentTransformForHull(attachmentId: AttachmentId, hullTier: number): Transform {
  const definition = ATTACHMENTS[attachmentId];
  const referenceLength = HULL_TIERS[REFERENCE_HULL_TIER].dimensions.length;
  const hull = HULL_TIERS[Math.max(0, Math.min(HULL_TIERS.length - 1, hullTier))];
  const halfGrowth = (hull.dimensions.length - referenceLength) / 2;
  const shift = definition.anchor === 'bow' ? -halfGrowth : definition.anchor === 'stern' ? halfGrowth : 0;
  const [x, y, z] = definition.transform.position;
  return { position: [x, y, z + shift], rotation: [...definition.transform.rotation] };
}

/** Seats along the hull as shares of its length, aft of centre: stern, bow, then the two between. */
const SEAT_STATIONS = [0.3107, -0.2589, 0.1265, -0.1265];

/**
 * Where a crew member sits on a given hull tier, in canoe space, facing the
 * bow. Seat 0 is the stern seat (a paddler who is alone steers from there),
 * seat 1 the bow seat, seats 2 and 3 kneel between them, aft then forward.
 * The seats spread with the hull when it grows. `y` is the top of the seat.
 */
export function seatTransformForHull(hullTier: number, seat: number): Transform {
  const hull = HULL_TIERS[Math.max(0, Math.min(HULL_TIERS.length - 1, hullTier))];
  const station = SEAT_STATIONS[Math.max(0, Math.min(SEAT_STATIONS.length - 1, Math.floor(seat)))];
  const { length, depth, draft } = hull.dimensions;
  return { position: [0, 0.75 * depth - draft, station * length], rotation: [0, 0, 0] };
}
