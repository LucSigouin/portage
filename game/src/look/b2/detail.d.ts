/** Material tags: what a piece is made of. Each one picks the pen marks drawn inside its wash. */
export const KIND: {
  readonly PLAIN: 0; readonly WOOD: 1; readonly BARK: 2; readonly NEEDLE: 3; readonly LEAF: 4; readonly CLOTH: 5;
  readonly METAL: 6; readonly ROPE: 7; readonly SHINGLE: 8; readonly STONE: 9; readonly DRIFT: 10; readonly BIRCH: 11;
  readonly PAINT: 12; readonly SIDING: 13; readonly PATCH: 14; readonly CANE: 15; readonly SOIL: 16;
};
export type MaterialKind = typeof KIND[keyof typeof KIND];
export const DIRECTIONAL: Set<number>;
/** Say what one colour is made of, where the guess from its hue would be wrong. */
export function tagColor(color: string, kind: MaterialKind): void;
export function kindOf(color: string): MaterialKind;
export const DETAIL: string;
