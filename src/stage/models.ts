import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Kenney packs (CC0, see CREDITS.md). Each GLB is loaded once and cloned.
const PACKS = {
  factory: "/assets/models/kenney-factory-kit/",
  market: "/assets/models/kenney-mini-market/",
  car: "/assets/models/kenney-car-kit/",
  city: "/assets/models/kenney-city-kit-industrial/",
} as const;
export type Pack = keyof typeof PACKS;

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

/** `model("factory", "box-small")`; pass `ownMaterials` to tint one copy without touching the others. */
export function model(pack: Pack, name: string, ownMaterials = false): Promise<THREE.Object3D> {
  const key = `${pack}/${name}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      loader.loadAsync(`${PACKS[pack]}${name}.glb`).then((g) => {
        g.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        return g.scene;
      }),
    );
  }
  return cache.get(key)!.then((s) => {
    const copy = s.clone(true);
    if (ownMaterials)
      copy.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.material = (mesh.material as THREE.Material).clone();
      });
    return copy;
  });
}

/** Every standard material inside an object (for tinting / emissive flashes). */
export function materialsOf(obj: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) out.push(m as THREE.MeshStandardMaterial);
  });
  return out;
}
