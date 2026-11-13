/**
 * What the viewer's list and stage agree on. An `Entry` is one drawn thing, made from the game's own tables. A
 * `Subject` is that thing built, with the numbers the facts panel shows. Nothing here touches the graphics card.
 */
import type * as THREE from 'three';
import type { GuideSection } from './guide.ts';

export type GroupId = 'hull' | 'attachment' | 'crew' | 'landmark' | 'node' | 'island' | 'prop' | 'icon';

/** One answer to a question the group asks (a crew of 2, the long hull, the night). */
export interface Choice {
  value: string;
  label: string;
}

/** A question that matters for one group: which tier, how many aboard, what pose. The first choice is the default unless `default` says. */
export interface Control {
  key: string;
  label: string;
  choices: Choice[];
  default: string;
  /** Asked only while another control has this answer (the sail, only once the rig is fitted). */
  when?: { key: string; is: string };
}

/** The answers given, by control key. A key left out takes the control's default. */
export type Options = Record<string, string>;

export interface Entry {
  /** `group/key`: the address of the thing, e.g. `hull/long_canoe`. Stable across loads. */
  id: string;
  group: GroupId;
  name: string;
  /** One line from the game's table, when it has one. */
  description: string;
  /** The file that draws it, then the ones it leans on. */
  source: string[];
  /** Where to find it and what it is for, read from the game's tables (see guide.ts). Absent: no guide. */
  guide?: () => GuideSection[];
  controls: Control[];
  /** A flat picture (an item icon): it has no turning, no ground and no triangles. */
  flat: boolean;
  /** Build it, with the answers given. Throws if the game's builder does. */
  build(options: Options): Subject;
}

export interface Subject {
  /** What goes on the stage: ground at y = 0. Null for a flat picture. */
  object: THREE.Object3D | null;
  /** A flat picture's drawing, as SVG markup. Null for a 3D thing. */
  svg: string | null;
  /** Round the visible parts, metres. Empty for a flat picture. */
  box: THREE.Box3;
  /** Triangles drawn in one pass. */
  triangles: number;
  /** Meshes drawn in one pass (each is a draw call). */
  drawCalls: number;
  /** The game's paddling camera, when this thing is a canoe: where it looks and how far out it stands. */
  paddle: { focus: [number, number, number]; distance: number } | null;
  /** A line or two on what is and is not drawn here. */
  notes: string[];
  /** Called before each frame with the camera, for things the game switches by distance (an island's trees). */
  watch?(eye: THREE.Vector3): void;
  /** Free what this subject made. Shared geometry belongs to the game and is left alone. */
  dispose(): void;
}

export interface Group {
  id: GroupId;
  label: string;
  /** One line: what is in it. */
  about: string;
}
