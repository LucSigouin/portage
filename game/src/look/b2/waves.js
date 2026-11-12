// Ink & Wash — the water surface, shared by every shader that needs to know where the water is.
// It evaluates the rules engine's own wave sum (WAVE_TABLE) and its roughness bands (REGIONS), so the
// drawn surface is the surface the canoe floats on. The numbers arrive as uniforms from world-view.ts.
import * as THREE from 'three';

export const WAVE_COUNT = 4;
export const REGION_COUNT = 4;
// The most the wave sum reaches per point of roughness, metres: the amplitudes of the rules' WAVE_TABLE, added up.
export const WAVE_AMPLITUDE = 0.177;

const vec4s = (count) => Array.from({ length: count }, () => new THREE.Vector4());

export const WAVE_UNIFORMS = {
  uWave: { value: vec4s(WAVE_COUNT) }, // wavenumber * directionX, wavenumber * directionZ, amplitude, phase right now
  uRegion: { value: vec4s(REGION_COUNT) }, // north edge z, south edge z, roughness, roughness of the band to its south (-1: none)
  uWaveArea: { value: new THREE.Vector4(0, 0, 36, 48) }, // centre x, centre z, full-height reach, flat beyond
  uRegionBlend: { value: 80 },
  uStorm: { value: 0 },
};

export const WAVES = /* glsl */ `
uniform vec4 uWave[${WAVE_COUNT}];
uniform vec4 uRegion[${REGION_COUNT}];
uniform vec4 uWaveArea;
uniform float uRegionBlend, uStorm;
float waterRoughness(float z){
  vec4 r = z > 0. ? uRegion[0] : uRegion[${REGION_COUNT - 1}];
  for (int i = 0; i < ${REGION_COUNT}; i++) if (z > uRegion[i].x && z <= uRegion[i].y) r = uRegion[i];
  float rough = r.z;
  if (r.w >= 0. && r.w < r.z) {
    float t = clamp((r.y - z) / uRegionBlend, 0., 1.);
    rough = r.w + (r.z - r.w) * t * t * (3. - 2. * t);
  }
  return rough + uStorm;
}
// the rules engine's surface, everywhere
float waveSum(vec2 p){
  float h = 0.;
  for (int i = 0; i < ${WAVE_COUNT}; i++) h += uWave[i].z * sin(dot(uWave[i].xy, p) + uWave[i].w);
  return waterRoughness(p.y) * h;
}
// the surface as drawn: the same sum, laid flat beyond the fine part of the water mesh
float waveSurface(vec2 p){
  float d = max(abs(p.x - uWaveArea.x), abs(p.y - uWaveArea.y));
  return waveSum(p) * (1. - smoothstep(uWaveArea.z, uWaveArea.w, d));
}
`;
