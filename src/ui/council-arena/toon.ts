import type * as T from "three";

type Three = typeof T;

/** Ink colour of the cartoon outlines: a deep plum reads softer than black on bright colours. */
export const INK = "#1d1424";

/** Three flat light bands, the cel-shaded look of party games. */
export function toonGradient(three: Three): T.DataTexture {
  const steps = new Uint8Array([90, 170, 255]);
  const texture = new three.DataTexture(steps, steps.length, 1, three.RedFormat);
  texture.minFilter = three.NearestFilter;
  texture.magFilter = three.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Back faces pushed out along their normals, drawn in ink behind the mesh: a cartoon outline whose thickness
 * stays even on any shape. Works for instanced meshes too (the push happens before the instance transform).
 */
export function outlineMaterial(three: Three, thickness: number, color: string = INK): T.MeshBasicMaterial {
  const material = new three.MeshBasicMaterial({ color, side: three.BackSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n\ttransformed += normalize( normal ) * ${thickness.toFixed(4)};`,
    );
  };
  material.customProgramCacheKey = () => `outline-${thickness}`;
  material.userData.outline = true;
  return material;
}

/** Lit surfaces get an outline; unlit details (pupils, blush, glows) and earlier outlines do not. */
function wantsOutline(mesh: T.Mesh): boolean {
  if (!mesh.isMesh || mesh.userData.outline || mesh.userData.noOutline) return false;
  if (mesh.children.some((child) => child.userData.outline)) return false;
  const material = mesh.material as T.Material | T.Material[];
  const first = Array.isArray(material) ? material[0] : material;
  if (!first || (first as T.MeshBasicMaterial).isMeshBasicMaterial || first.transparent) return false;
  return Boolean(mesh.geometry?.getAttribute("normal"));
}

/** Adds an ink shell to every lit mesh under `root`; the shell shares the mesh's geometry and transform. */
export function addOutlines(three: Three, root: T.Object3D, material: T.Material): void {
  const meshes: T.Mesh[] = [];
  root.traverse((object) => { if (wantsOutline(object as T.Mesh)) meshes.push(object as T.Mesh); });
  for (const mesh of meshes) {
    const shell = (mesh as T.InstancedMesh).isInstancedMesh
      ? Object.assign(new three.InstancedMesh(mesh.geometry, material, (mesh as T.InstancedMesh).count), { instanceMatrix: (mesh as T.InstancedMesh).instanceMatrix })
      : new three.Mesh(mesh.geometry, material);
    shell.userData.outline = true;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.frustumCulled = mesh.frustumCulled;
    shell.raycast = () => undefined;
    mesh.add(shell);
  }
}

/** Cel-shaded material in a flat colour. */
export function toon(three: Three, gradient: T.Texture | null, color: T.ColorRepresentation, extra: T.MeshToonMaterialParameters = {}): T.MeshToonMaterial {
  return new three.MeshToonMaterial({ color, gradientMap: gradient ?? undefined, emissive: "#000000", ...extra });
}
