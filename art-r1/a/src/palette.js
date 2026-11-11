// Cutbank palette + shared materials. Everything 3D pulls colour from here.
import * as THREE from 'three';

export const PAL = {
  // canoe: the one true red in every frame
  canoeRed: 0xe0392a,
  canoeRedDeep: 0xa5261f,
  canoeRedFaded: 0xd0503c,

  // sign-paint neutrals (shared with the UI theme)
  cream: 0xf6e9cb,
  creamDark: 0xdcc8a0,
  pine: 0x1f4a3c,
  pineLight: 0x2f6b55,
  pineDark: 0x12332a,
  blaze: 0xf6b52e, // trail-blaze yellow: "you can take this"
  blazeDark: 0xd18a1a,

  // woods + salvage
  wood: 0xb5804e,
  woodLight: 0xd9ad74,
  woodDark: 0x76502f,
  woodGrey: 0x9b8f80,
  driftwood: 0xc9bfae,
  driftwoodDark: 0x9c917f,
  iron: 0x38414a,
  ironLight: 0x56636c,
  tin: 0xa9b6b8,
  rust: 0xb5562c,
  rope: 0xe6d6a8,
  canvas: 0xf1e3c0,
  canvasShade: 0xd9c79d,
  tarp: 0xe08a3a,
  drum: 0xf0b63a,
  barrelBlue: 0x3f7f96,
  soil: 0x4a3526,

  // rock + ground
  granite: 0xcf9f93,
  graniteLight: 0xe9c3b2,
  graniteDark: 0x8f6c70,
  graniteGrey: 0xa9a09e,
  wetRock: 0x4f4450,
  lichen: 0xb9c79a,
  sand: 0xecc892,
  sandDark: 0xcfa671,
  moss: 0x6f8f3c,
  mossDark: 0x4d7038,
  grassGold: 0xd2a53a,

  // trees
  spruce: 0x1f5c46,
  spruceLight: 0x2f7d58,
  spruceDark: 0x14402f,
  trunk: 0x6b4630,
  birchBark: 0xf4eee0,
  birchMark: 0x2b2b2e,
  birchLeaf: 0xf5b62b,
  birchLeafDeep: 0xe58a1f,
  snag: 0x8f8a86,
  berry: 0x5a3fd6,
  berryLight: 0x8a6cf0,

  // character
  skin: 0xe9a57c,
  sweater: 0xf4e8cf,
  toque: 0x1f5c46,
  pants: 0x24424f,
  boots: 0x6b4630,
  hair: 0x4a2f22,

  // water
  waterShallow: 0x58e0c8,
  waterTeal: 0x1fb3a6,
  waterMid: 0x118a82,
  waterDeep: 0x0d6e63,
  waterAqua: 0x74e0cc,
  waterAbyss: 0x08524e,
  foam: 0xfff7e8,
  glint: 0xffe2a8,

  // sky + light
  skyZenith: 0x1f7f8c,
  skyUpper: 0x49a9a6,
  skyMid: 0xf3c6a0,
  skyHorizon: 0xffb489,
  sunDisc: 0xfff1c4,
  sunGlow: 0xffcf9c,
  sunLight: 0xffc890,
  fillSky: 0xbfe3da,
  fillGround: 0xe0a078,
  haze: 0xf9b891,

  // far ridges (nearest to farthest)
  ridge1: 0x2b6a63,
  ridge2: 0x5c8d86,
  ridge3: 0xa9a59a,
  cloudTop: 0xfff0d6,
  cloudMid: 0xffc9a6,
  cloudLow: 0xe79a8c,
  cloudShade: 0xa9809e,
};

// One lit material for the whole diorama: flat facets, colour from vertices, no textures.
export const flatMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const flatMatDouble = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
// Unlit: lantern glass, fire glow, blaze markers, foam.
export const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
export const backdropMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
