/**
 * The material scavenge nodes are drawn in: B2's ink material, with one line
 * added to its vertex shader. A node's mesh marks each vertex with `aGone`
 * (1: only there while the node is fresh, -1: only once it is used up), and
 * the instance's used-up flag is `aInst.y`. A vertex of the wrong half is put
 * outside the view, so its triangles are never drawn.
 *
 * Same shaders, same shared uniforms, and the same twin for the mirrored pass
 * as every other ink material: nothing else in the look can tell them apart.
 */
import * as THREE from 'three';
import { inkMaterial } from '../b2/palette.js';

const DECLARED = 'in vec4 aInst;';
const PLACED = 'gl_Position = projectionMatrix * viewMatrix * wp;';
const HIDE = 'if (aGone * (aInst.y - .5) > 0.) gl_Position = vec4(0., 0., -2., 1.);';

/** The vertex shader with the used-up switch added. Throws if B2's shader no longer has the two lines it hangs on. */
export function withSpentSwitch(vertexShader: string): string {
  if (!vertexShader.includes(DECLARED) || !vertexShader.includes(PLACED)) throw new Error('The ink vertex shader has changed: world/spent.ts cannot add the used-up switch.');
  return vertexShader.replace(DECLARED, `in float aGone;\n${DECLARED}`).replace(PLACED, `${PLACED}\n  ${HIDE}`);
}

let material: THREE.ShaderMaterial | null = null;

function derive(source: THREE.ShaderMaterial): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: source.glslVersion,
    vertexShader: withSpentSwitch(source.vertexShader),
    fragmentShader: source.fragmentShader,
    uniforms: source.uniforms,
    defines: { ...source.defines },
    side: source.side,
  });
}

/** The node material, made once. */
export function nodeMaterial(): THREE.ShaderMaterial {
  if (!material) {
    material = derive(inkMaterial);
    const mirror = derive(inkMaterial.userData.mirror as THREE.ShaderMaterial);
    material.userData.mirror = mirror;
    mirror.userData.plain = material;
  }
  return material;
}

export function disposeNodeMaterial(): void {
  (material?.userData.mirror as THREE.ShaderMaterial | undefined)?.dispose();
  material?.dispose();
  material = null;
}
