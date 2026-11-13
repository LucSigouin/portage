/**
 * The list: every drawn thing in the game, made from the game's own tables and registries, so a thing added to
 * the game later (a hull tier, an attachment, a landmark kind, a node, an island, a prop variant, an item) shows
 * up here without anyone editing this file. The only things written by hand are the questions each group asks
 * (which tier, how many aboard) and where to find the file that draws a thing.
 */
import { ATTACHMENTS, ATTACHMENT_IDS, CREW_MARKS, HULL_TIERS, ISLANDS, ITEMS, ITEM_IDS, NODE_TYPES, NPCS, NPC_IDS } from '../data/index.ts';
import type { AttachmentId, LandmarkKind, NodeTypeId } from '../data/index.ts';
import { LANDMARK_KINDS } from '../look/landmarks.ts';
import { NODE_TYPE_IDS } from '../look/nodes.ts';
import { VARIANTS } from '../look/scatter.ts';
import type { FloraKind } from '../look/scatter.ts';
import { NARROWS } from '../look/world/narrows.ts';
import { REACH } from '../look/world/reach.ts';
import { SHALLOWS } from '../look/world/shallows.ts';
import { canonicalBuild } from './canonical.ts';
import { attachmentSections, hullSections, itemSections, nodeSections } from './guide.ts';
import { attachmentAlone, canoeSubject, iconSubject, islandSubject, landmarkSubject, nodeSubject, propSubject, survivorSubject } from './subjects.ts';
import type { Choice, Control, Entry, Group, Options } from './types.ts';

export const GROUPS: Group[] = [
  { id: 'hull', label: 'Hull tiers', about: 'The four canoes, with a crew of 0 to 4 and the rig bolted on or not.' },
  { id: 'attachment', label: 'Attachments', about: 'What bolts onto a hull: alone or mounted, on any tier.' },
  { id: 'crew', label: 'Crew and survivors', about: 'The four crew colours in their poses, and the three survivors.' },
  { id: 'landmark', label: 'Landmarks', about: 'The big things that name an island.' },
  { id: 'node', label: 'Scavenge nodes', about: 'What the crew gathers from, fresh and used up.' },
  { id: 'island', label: 'Islands', about: 'Each island whole: ground, trees, landmarks, nodes, survivors.' },
  { id: 'prop', label: 'Trees and props', about: 'Every variant of every tree, bush, boulder and reed clump.' },
  { id: 'icon', label: 'Item icons', about: 'The flat drawing of every item.' },
];

const choice = (value: string, label: string = value): Choice => ({ value, label });
const control = (key: string, label: string, choices: Choice[], fallback: string = choices[0].value): Control => ({ key, label, choices, default: fallback });
const tiersOf = (): Choice[] => HULL_TIERS.map((hull) => choice(String(hull.tier), `${hull.tier}: ${hull.name}`));
const sentence = (text: string): string => text.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
const answer = (options: Options, controls: Control[], key: string): string => options[key] ?? controls.find((item) => item.key === key)?.default ?? '';

// --- Where the drawing lives ---------------------------------------------------------------------------------------------

const CANOE_FILES = ['src/look/canoe.ts (CanoeView)', 'src/look/b2/canoe.js (buildHull, buildBilge, buildStarterKit, createCrew)'];
/** Which file of `look/canoe/` draws an attachment. A newcomer falls back to the folder. */
const ATTACHMENT_FILE: Record<string, string> = {
  outrigger_port: 'deck-parts', outrigger_starboard: 'deck-parts', workbench: 'deck-parts', smoker: 'deck-parts', planter: 'deck-parts', forge: 'deck-parts',
  cargo_rack: 'hull-parts', firebox: 'hull-parts', fishing_rig: 'hull-parts', canopy: 'hull-parts', map_table: 'hull-parts',
  mast_sail: 'rig-parts', rudder: 'rig-parts', lantern_mast: 'rig-parts', rain_catcher: 'rig-parts', winch: 'rig-parts', radio: 'rig-parts', flag: 'rig-parts', figurehead: 'rig-parts',
  plank_chest: 'chest-parts', tin_trunk: 'chest-parts', sea_chest: 'chest-parts',
};
/** The outrigger whose deck a chest stands on: "Mounted on a hull" shows the two together. */
const DECK_UNDER: Record<string, AttachmentId | undefined> = { plank_chest: 'outrigger_port', tin_trunk: 'outrigger_starboard' };
const landmarkFile = (kind: LandmarkKind): string => {
  if (kind in SHALLOWS) return 'src/look/world/shallows.ts';
  if (kind in REACH) return 'src/look/world/reach.ts';
  if (kind in NARROWS) return 'src/look/world/narrows.ts';
  return 'src/look/landmarks.ts';
};
const FLORA_FILE: Record<string, string> = { spruce: 'src/look/b2/flora.js (spruce)', pine: 'src/look/b2/flora.js (whitePine)', birch: 'src/look/b2/flora.js (birch)' };

/** The controls whose answers change how an attachment is drawn, by what the game's `update` reads. */
function stateControl(attachmentId: AttachmentId): Control | null {
  switch (attachmentId) {
    case 'mast_sail': return control('state', 'Sail', [choice('down', 'Lowered'), choice('up', 'Raised')]);
    case 'lantern_mast': return control('state', 'Lantern', [choice('dark', 'Dark'), choice('lit', 'Lit')]);
    case 'canopy': return control('state', 'Canopy', [choice('rolled', 'Rolled'), choice('closed', 'Closed (beached)')]);
    case 'rain_catcher': return control('state', 'Pail', [choice('empty', 'Empty'), choice('half', 'Half full'), choice('full', 'Full')]);
    default: return null;
  }
}
const flagsFrom = (attachmentId: string, state: string): { sail: boolean; lantern: boolean; rain: number; beached: boolean } => ({
  sail: attachmentId === 'mast_sail' && state === 'up',
  lantern: attachmentId === 'lantern_mast' && state === 'lit',
  rain: attachmentId === 'rain_catcher' ? (state === 'full' ? 1 : state === 'half' ? 0.5 : 0) : 0,
  beached: attachmentId === 'canopy' && state === 'closed',
});

// --- Entries, group by group ---------------------------------------------------------------------------------------------

function hulls(): Entry[] {
  const controls = [
    control('crew', 'Crew aboard', [0, 1, 2, 3, 4].map((count) => choice(String(count), count === 0 ? 'None' : String(count))), '1'),
    control('fitted', 'Rig', [choice('bare', 'Bare hull'), choice('all', 'Every attachment')]),
    { ...control('sail', 'Sail', [choice('down', 'Lowered'), choice('up', 'Raised')]), when: { key: 'fitted', is: 'all' } },
    { ...control('lantern', 'Lantern', [choice('dark', 'Dark'), choice('lit', 'Lit')]), when: { key: 'fitted', is: 'all' } },
  ];
  return HULL_TIERS.map((hull) => ({
    id: `hull/${hull.id}`,
    group: 'hull',
    name: hull.name,
    description: hull.description,
    source: [...CANOE_FILES, ...(hull.tier === 1 ? ['src/look/canoe/mends.ts (the bark on the patched hull)'] : [])],
    guide: () => hullSections(hull),
    controls,
    flat: false,
    build: (options) => {
      const crew = Number(answer(options, controls, 'crew'));
      const fitted = answer(options, controls, 'fitted') === 'all';
      return canoeSubject({
        tier: hull.tier,
        attachments: fitted ? [...ATTACHMENT_IDS] : [],
        sail: answer(options, controls, 'sail') === 'up',
        lantern: answer(options, controls, 'lantern') === 'lit',
        aboard: Array.from({ length: crew }, (_, seat) => seat),
        shown: Array.from({ length: crew }, (_, seat) => seat),
      });
    },
  }));
}

function attachments(): Entry[] {
  return ATTACHMENT_IDS.map((attachmentId) => {
    const definition = ATTACHMENTS[attachmentId];
    const extra = stateControl(attachmentId);
    const controls = [
      control('mount', 'Shown', [choice('alone', 'Alone'), choice('hull', 'Mounted on a hull')]),
      control('tier', 'Hull tier', tiersOf(), String(definition.minimumHullTier)),
      ...(extra ? [extra] : []),
    ];
    const folder = ATTACHMENT_FILE[attachmentId];
    return {
      id: `attachment/${attachmentId}`,
      group: 'attachment',
      name: definition.name,
      description: definition.description,
      source: [folder ? `src/look/canoe/${folder}.ts` : 'src/look/canoe/ (see src/look/attachments.ts)', 'src/look/attachments.ts (BUILDERS)', 'src/look/canoe/kit.ts'],
      guide: () => attachmentSections(definition),
      controls,
      flat: false,
      build: (options) => {
        const tier = Number(answer(options, controls, 'tier'));
        const flags = flagsFrom(attachmentId, answer(options, controls, 'state'));
        if (answer(options, controls, 'mount') === 'alone') return attachmentAlone(attachmentId, tier, flags);
        // A deck chest is shown on the deck it stands on.
        const deck = DECK_UNDER[attachmentId];
        return canoeSubject({ tier, attachments: deck ? [deck, attachmentId] : [attachmentId], ...flags, aboard: [], shown: [] });
      },
    };
  });
}

const POSES = [
  choice('stand', 'Standing ashore'), choice('walk', 'Walking ashore'), choice('sleep', 'Asleep ashore'),
  choice('sit', 'Resting aboard'), choice('pull', 'Paddling: the pull'), choice('recover', 'Paddling: the recovery'), choice('bail', 'Bailing'),
];

function crew(): Entry[] {
  const players: Entry[] = CREW_MARKS.map((mark, index) => {
    const controls = [control('pose', 'Pose', POSES), control('hull', 'Hull tier (aboard)', tiersOf(), '2')];
    return {
      id: `crew/player-${index + 1}`,
      group: 'crew',
      name: mark.label,
      description: `Wears the ${index + 1}${['st', 'nd', 'rd', 'th'][index] ?? 'th'} crew colours: coat ${mark.coat}, toque ${mark.toque}, legs ${mark.legs}.`,
      source: ['src/look/b2/canoe.js (createCrew)', 'src/look/canoe.ts (CanoeView.sync: seats, poses)', 'src/look/crew.ts (outfitOf)', 'src/data/crew.ts (CREW_MARKS)'],
      controls,
      flat: false,
      build: (options) => {
        const pose = answer(options, controls, 'pose');
        const aboard = ['sit', 'pull', 'recover', 'bail'].includes(pose);
        return canoeSubject({
          tier: Number(answer(options, controls, 'hull')),
          attachments: [],
          aboard: aboard ? [index] : [],
          shown: [index],
          paddling: pose === 'pull' || pose === 'recover' ? [index] : [],
          bailing: pose === 'bail' ? [index] : [],
          asleep: pose === 'sleep' ? [index] : [],
          phase: pose === 'recover' ? 0.8 : 0.25,
          walking: pose === 'walk',
        });
      },
    };
  });
  const survivors: Entry[] = NPC_IDS.map((npcId) => ({
    id: `crew/${npcId}`,
    group: 'crew',
    name: NPCS[npcId].name,
    description: NPCS[npcId].description,
    source: ['src/look/characters.ts (BUILDERS)'],
    controls: [],
    flat: false,
    build: () => survivorSubject(npcId),
  }));
  return [...players, ...survivors];
}

function landmarks(): Entry[] {
  const controls = [control('detail', 'Drawn', [choice('near', 'Near: every stroke'), choice('far', 'Far off: outline only')])];
  return LANDMARK_KINDS.map((kind) => {
    const seenOn = ISLANDS.filter((island) => island.landmarks.some((landmark) => landmark.kind === kind)).map((island) => island.name);
    return {
      id: `landmark/${kind}`,
      group: 'landmark',
      name: sentence(kind),
      description: seenOn.length > 0 ? `Seen on ${seenOn.join(', ')}.` : 'On no island yet.',
      source: [landmarkFile(kind), 'src/look/landmarks.ts (landmarkGeometry)', 'src/look/world/kit.ts'],
      controls,
      flat: false,
      build: (options) => landmarkSubject(kind, answer(options, controls, 'detail') === 'far'),
    };
  });
}

function nodes(): Entry[] {
  const controls = [control('state', 'Node', [choice('fresh', 'Fresh'), choice('used', 'Used up')])];
  return (NODE_TYPE_IDS as NodeTypeId[]).map((typeId) => ({
    id: `node/${typeId}`,
    group: 'node',
    name: NODE_TYPES[typeId]?.name ?? sentence(typeId),
    description: NODE_TYPES[typeId]?.description ?? '',
    source: ['src/look/nodes.ts (BUILDERS)', 'src/look/world/spent.ts (the used-up switch)', 'src/look/props.ts (instancedMesh)'],
    guide: () => nodeSections(typeId),
    controls,
    flat: false,
    build: (options) => nodeSubject(typeId, answer(options, controls, 'state') === 'used'),
  }));
}

function islands(): Entry[] {
  return ISLANDS.map((island) => ({
    id: `island/${island.id}`,
    group: 'island',
    name: island.name,
    description: island.description,
    source: ['src/look/terrain.ts (buildIslandTerrain)', 'src/look/world/dressing.ts', 'src/look/props.ts (buildIslandProps)', 'src/look/scatter.ts', 'src/look/presets.ts', 'src/look/landmarks.ts', 'src/look/nodes.ts'],
    controls: [],
    flat: false,
    build: () => islandSubject(island),
  }));
}

const TREES: FloraKind[] = ['spruce', 'pine', 'birch'];

function props(): Entry[] {
  const entries: Entry[] = [];
  for (const kind of Object.keys(VARIANTS) as FloraKind[]) {
    for (let variant = 0; variant < VARIANTS[kind]; variant += 1) {
      const controls = TREES.includes(kind) ? [control('detail', 'Drawn', [choice('full', 'Every bough'), choice('half', 'Half the triangles (middle distance)')])] : [];
      entries.push({
        id: `prop/${kind}-${variant + 1}`,
        group: 'prop',
        name: `${sentence(kind)} ${variant + 1}`,
        description: `Variant ${variant + 1} of ${VARIANTS[kind]}.`,
        source: [FLORA_FILE[kind] ?? 'src/look/props.ts (PROP_BUILDERS)', 'src/look/props.ts (PROP_BUILDERS, the library)', 'src/look/scatter.ts (VARIANTS)'],
        controls,
        flat: false,
        build: (options) => propSubject(kind, variant, answer(options, controls, 'detail') === 'half'),
      });
    }
  }
  return entries;
}

function icons(): Entry[] {
  return ITEM_IDS.map((itemId) => ({
    id: `icon/${itemId}`,
    group: 'icon',
    name: ITEMS[itemId].name,
    description: ITEMS[itemId].description,
    source: ['src/interface/icons.ts (ITEM_ICONS)', 'src/interface/theme.css (.iw-ico)'],
    guide: () => itemSections(itemId),
    controls: [],
    flat: true,
    build: () => iconSubject(itemId),
  }));
}

/** Every drawn thing, in list order. Made on first use, and the same list after that. */
let list: Entry[] | null = null;
export function catalogue(): Entry[] {
  list ??= [...hulls(), ...attachments(), ...crew(), ...landmarks(), ...nodes(), ...islands(), ...props(), ...icons()].map((entry) => ({
    ...entry,
    // every build starts from the same place (see canonical.ts), so a link reopens the same picture
    build: (options) => {
      if (!entry.flat) canonicalBuild();
      return entry.build(options);
    },
  }));
  return list;
}

/** Forget the made list, so the next `catalogue()` reads the tables again. For tests. */
export function resetCatalogue(): void {
  list = null;
}

export function entryById(id: string): Entry | undefined {
  return catalogue().find((entry) => entry.id === id);
}

/** The answers a control would take if none were given. */
export function defaultsOf(entry: Entry): Options {
  return Object.fromEntries(entry.controls.map((item) => [item.key, item.default]));
}

/** Keep only answers that are choices of this entry's controls. */
export function cleanOptions(entry: Entry, given: Options): Options {
  const clean: Options = {};
  for (const item of entry.controls) {
    const value = given[item.key];
    clean[item.key] = value !== undefined && item.choices.some((candidate) => candidate.value === value) ? value : item.default;
  }
  return clean;
}
