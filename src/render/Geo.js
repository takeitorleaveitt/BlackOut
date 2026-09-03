// Geometry helpers: world-scaled box UVs (so one tiling material covers every
// brush regardless of size) and colour-baked geometry for prop instancing.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * BoxGeometry whose UVs are derived from world size, so textures tile at a
 * constant real-world scale across brushes of any dimension.
 */
export function boxGeo(sx, sy, sz, texScale = 0.3) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  const s = texScale;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [
    [sz, sy], [sz, sy],
    [sx, sz], [sx, sz],
    [sx, sy], [sx, sy]
  ];
  for (let f = 0; f < 6; f++) {
    const [w, h] = dims[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * w * s, uv.getY(idx) * h * s);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** Apply a flat colour to every vertex of a geometry. */
export function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Colour with per-vertex noise so flat prop faces are not dead flat. */
export function paintNoisy(geo, color, amount = 0.08, seed = 1) {
  const c = new THREE.Color(color);
  const pos = geo.attributes.position;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const h = Math.sin((pos.getX(i) * 12.9 + pos.getY(i) * 78.2 + pos.getZ(i) * 37.7 + seed) * 43758.5) * 0.5;
    const f = 1 + h * amount * 2;
    arr[i * 3] = c.r * f; arr[i * 3 + 1] = c.g * f; arr[i * 3 + 2] = c.b * f;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Build a merged, vertex-coloured geometry from [geometry, color, transform] parts. */
export function buildParts(parts) {
  const geos = [];
  for (const p of parts) {
    const g = p.geo;
    paintNoisy(g, p.color, p.noise ?? 0.07, p.seed ?? 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (p.rot) q.setFromEuler(new THREE.Euler(p.rot[0] || 0, p.rot[1] || 0, p.rot[2] || 0));
    m.compose(
      new THREE.Vector3(p.pos?.[0] || 0, p.pos?.[1] || 0, p.pos?.[2] || 0),
      q,
      new THREE.Vector3(p.scale?.[0] ?? 1, p.scale?.[1] ?? 1, p.scale?.[2] ?? 1)
    );
    g.applyMatrix4(m);
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    g.deleteAttribute('uv1');
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const sph = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
export const cone = (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg);
export const plane = (w, h) => new THREE.PlaneGeometry(w, h);
