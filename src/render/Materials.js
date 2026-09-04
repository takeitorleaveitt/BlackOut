// Material library.  One shared THREE material per surface type so the level
// merges down to a handful of draw calls, plus a vertex-coloured material used
// by every prop (props merge their sub-meshes into a single instanced geometry).

import * as THREE from 'three';
import { SURFACE } from '../shared/constants.js';
import { getSurfaceMaps } from './Textures.js';
import { S } from '../core/Settings.js';

const mats = new Map();

const TINT = {
  [SURFACE.CONCRETE]: 0xb8b8b4,
  [SURFACE.PLASTER]: 0xc9c6bd,
  [SURFACE.METAL]: 0x9aa0a6,
  [SURFACE.WOOD]: 0x9a8266,
  [SURFACE.TILE]: 0xc6c9c8,
  [SURFACE.CARPET]: 0x8a7f72,
  [SURFACE.GRASS]: 0x84a05a,
  [SURFACE.DIRT]: 0x9c7f5e,
  [SURFACE.GRAVEL]: 0xa8a49c,
  [SURFACE.FABRIC]: 0x8d8378,
  [SURFACE.GLASS]: 0xbfd8e6,
  [SURFACE.WATER]: 0x6f9dbd
};

export function surfaceMaterial(surface) {
  const key = surface + ':' + S.textureQuality;
  if (mats.has(key)) return mats.get(key);
  const maps = getSurfaceMaps(surface, S.textureQuality, S.anisotropy);
  const glass = surface === SURFACE.GLASS;
  const water = surface === SURFACE.WATER;
  const m = new THREE.MeshStandardMaterial({
    color: TINT[surface] ?? 0xb0b0b0,
    map: maps.map,
    roughnessMap: maps.roughnessMap,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    metalness: surface === SURFACE.METAL ? 0.55 : water ? 0.2 : 0.02,
    roughness: 1.0,
    transparent: glass || water,
    opacity: glass ? 0.22 : water ? 0.72 : 1,
    side: glass ? THREE.DoubleSide : THREE.FrontSide,
    envMapIntensity: surface === SURFACE.METAL ? 1.6 : 0.7
  });
  m.userData.surface = surface;
  m.userData.texScale = maps.scale;
  mats.set(key, m);
  return m;
}

let vcMat = null;
/** Shared vertex-coloured material for props. */
export function propMaterial() {
  if (vcMat) return vcMat;
  vcMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.82, metalness: 0.08,
    envMapIntensity: 0.6
  });
  return vcMat;
}

let glassPropMat = null;
export function propGlassMaterial() {
  if (glassPropMat) return glassPropMat;
  glassPropMat = new THREE.MeshStandardMaterial({
    color: 0x93b6cc, roughness: 0.08, metalness: 0.1,
    transparent: true, opacity: 0.34, side: THREE.DoubleSide
  });
  return glassPropMat;
}

let emissiveCache = new Map();
export function emissiveMaterial(color, intensity = 2) {
  const k = color + ':' + intensity;
  if (emissiveCache.has(k)) return emissiveCache.get(k);
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  m.userData.emissiveStrength = intensity;
  emissiveCache.set(k, m);
  return m;
}

export function refreshMaterials() {
  for (const m of mats.values()) m.needsUpdate = true;
}

export function disposeMaterials() {
  for (const m of mats.values()) m.dispose();
  mats.clear();
  vcMat?.dispose(); vcMat = null;
  glassPropMat?.dispose(); glassPropMat = null;
  for (const m of emissiveCache.values()) m.dispose();
  emissiveCache.clear();
}
