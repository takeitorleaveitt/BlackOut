// Procedural texture generation.  Everything the game renders is authored in
// code — no image downloads — which keeps the whole build tiny and lets the
// texture budget scale with the quality preset.
//
// Each material produces an albedo, a roughness map and a normal map derived
// from the same height field, so surfaces light consistently.

import * as THREE from 'three';
import { SURFACE } from '../shared/constants.js';

const cache = new Map();

// ---------------------------------------------------------------------------
// noise
// ---------------------------------------------------------------------------
function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, oct, seed, lac = 2.0, gain = 0.5) {
  let f = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    f += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= gain; freq *= lac;
  }
  return f / norm;
}

/** Worley/cellular noise — used for gravel, concrete aggregate and tiles. */
function worley(x, y, seed, jitter = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 10, best2 = 10;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox, cy = yi + oy;
      const px = cx + hash2(cx, cy, seed) * jitter;
      const py = cy + hash2(cx, cy, seed + 99) * jitter;
      const d = Math.hypot(px - x, py - y);
      if (d < best) { best2 = best; best = d; } else if (d < best2) best2 = d;
    }
  }
  return { f1: best, f2: best2 };
}

// ---------------------------------------------------------------------------
// canvas helpers
// ---------------------------------------------------------------------------
function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Sobel a height field into a tangent-space normal map. */
function heightToNormal(height, size, strength = 2.0) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function writeMaps(size, fn) {
  // fn(x, y) -> [r,g,b, height, roughness]
  const albedo = makeCanvas(size);
  const rough = makeCanvas(size);
  const ac = albedo.getContext('2d'), rc = rough.getContext('2d');
  const ai = ac.createImageData(size, size);
  const ri = rc.createImageData(size, size);
  const height = new Float32Array(size * size);
  const out = [0, 0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn(x, y, out);
      const i = (y * size + x) * 4;
      ai.data[i] = out[0] * 255; ai.data[i + 1] = out[1] * 255; ai.data[i + 2] = out[2] * 255; ai.data[i + 3] = 255;
      const r = Math.max(0, Math.min(1, out[4])) * 255;
      ri.data[i] = r; ri.data[i + 1] = r; ri.data[i + 2] = r; ri.data[i + 3] = 255;
      height[y * size + x] = out[3];
    }
  }
  ac.putImageData(ai, 0, 0);
  rc.putImageData(ri, 0, 0);
  return { albedo, rough, height };
}

// ---------------------------------------------------------------------------
// material generators
// ---------------------------------------------------------------------------
const GEN = {
  [SURFACE.CONCRETE]: (s, o) => (x, y, out) => {
    const u = x / s * 4, v = y / s * 4;
    const grain = fbm(u * 8, v * 8, 4, 11);
    const blot = fbm(u * 1.7, v * 1.7, 4, 3);
    const w = worley(u * 6, v * 6, 5).f1;
    let l = 0.30 + grain * 0.16 + blot * 0.12 - w * 0.06;
    // pitting + stains
    const pit = fbm(u * 26, v * 26, 2, 77);
    if (pit > 0.78) l -= 0.14;
    const stain = fbm(u * 0.8 + 3, v * 0.8, 3, 41);
    l *= 0.82 + stain * 0.34;
    out[0] = l * 1.0; out[1] = l * 0.99; out[2] = l * 0.95;
    out[3] = grain * 0.5 + (pit > 0.78 ? -0.4 : 0) + blot * 0.3;
    out[4] = 0.86 + grain * 0.12 - stain * 0.06;
  },
  [SURFACE.PLASTER]: (s) => (x, y, out) => {
    const u = x / s * 3, v = y / s * 3;
    const n = fbm(u * 12, v * 12, 4, 21);
    const large = fbm(u * 1.2, v * 1.2, 3, 9);
    const crack = Math.abs(fbm(u * 3, v * 3, 4, 55) - 0.5);
    let l = 0.60 + n * 0.10 + large * 0.10;
    if (crack < 0.02) l *= 0.6;
    const damp = fbm(u * 0.6, v * 0.6 + 5, 3, 66);
    l *= 0.85 + damp * 0.3;
    out[0] = l * 1.0; out[1] = l * 0.985; out[2] = l * 0.95;
    out[3] = n * 0.3 + (crack < 0.02 ? -0.6 : 0);
    out[4] = 0.92 - n * 0.06;
  },
  [SURFACE.METAL]: (s) => (x, y, out) => {
    const u = x / s, v = y / s;
    const brush = fbm(u * 220, v * 5, 3, 31);
    const rust = fbm(u * 3.5, v * 3.5, 5, 71);
    const panel = (Math.abs(((u * 2) % 1) - 0.5) < 0.012 || Math.abs(((v * 2) % 1) - 0.5) < 0.012) ? 0.55 : 1;
    const bolt = worley(u * 8, v * 8, 13, 0.2).f1 < 0.06 ? 1 : 0;
    let base = (0.42 + brush * 0.15) * panel;
    let r = base, g = base, b = base * 1.06;
    if (rust > 0.62) {
      const t = Math.min(1, (rust - 0.62) * 4.2);
      r = base * (1 - t) + 0.36 * t;
      g = base * (1 - t) + 0.17 * t;
      b = base * (1 - t) + 0.08 * t;
    }
    if (bolt) { r *= 1.35; g *= 1.35; b *= 1.35; }
    out[0] = r; out[1] = g; out[2] = b;
    out[3] = brush * 0.2 + (panel < 1 ? -0.7 : 0) + bolt * 0.8 + (rust > 0.62 ? 0.3 : 0);
    out[4] = rust > 0.62 ? 0.85 : 0.34 + brush * 0.1;
  },
  [SURFACE.WOOD]: (s) => (x, y, out) => {
    const u = x / s, v = y / s;
    const plank = Math.floor(v * 5);
    const off = hash2(plank, 3, 7) * 10;
    const ring = fbm((u + off) * 2.4, v * 26 + off, 3, 5);
    const grain = 0.35 + 0.65 * Math.abs(Math.sin((u * 3.0 + off + ring * 0.9) * 4.2));
    const seam = Math.abs((v * 5) % 1 - 0.5) > 0.472 ? 0.42 : 1;
    const knot = worley((u + off) * 4, v * 4, 23, 0.9).f1 < 0.12 ? 0.55 : 1;
    const tone = 0.30 + grain * 0.14 + hash2(plank, 9, 2) * 0.08;
    const l = tone * seam * knot;
    out[0] = l * 1.0; out[1] = l * 0.79; out[2] = l * 0.58;
    out[3] = grain * 0.35 + (seam < 1 ? -0.8 : 0) + (knot < 1 ? -0.3 : 0);
    out[4] = 0.72 + grain * 0.14;
  },
  [SURFACE.TILE]: (s) => (x, y, out) => {
    const u = x / s * 6, v = y / s * 6;
    const gx = Math.abs((u % 1) - 0.5), gy = Math.abs((v % 1) - 0.5);
    const grout = (gx > 0.455 || gy > 0.455) ? 1 : 0;
    const dirt = fbm(u * 2, v * 2, 4, 43);
    const spec = fbm(u * 22, v * 22, 2, 12);
    let l = grout ? 0.24 + dirt * 0.1 : 0.55 + dirt * 0.14 + spec * 0.05;
    out[0] = l * 1.0; out[1] = l * 1.0; out[2] = l * 0.97;
    out[3] = grout ? -0.8 : spec * 0.15;
    out[4] = grout ? 0.95 : 0.30 + dirt * 0.25;
  },
  [SURFACE.CARPET]: (s) => (x, y, out) => {
    const u = x / s * 8, v = y / s * 8;
    const fuzz = fbm(u * 40, v * 40, 3, 61);
    const patch = fbm(u * 1.5, v * 1.5, 3, 19);
    const l = 0.20 + fuzz * 0.12 + patch * 0.07;
    out[0] = l * 0.95; out[1] = l * 0.92; out[2] = l * 0.86;
    out[3] = fuzz * 0.5;
    out[4] = 0.97;
  },
  [SURFACE.GRASS]: (s) => (x, y, out) => {
    const u = x / s * 5, v = y / s * 5;
    const blade = fbm(u * 55, v * 55, 3, 81);
    const clump = fbm(u * 2.4, v * 2.4, 4, 27);
    const dry = fbm(u * 1.1, v * 1.1, 3, 91);
    const l = 0.13 + clump * 0.14 + blade * 0.10;
    out[0] = l * (0.62 + dry * 0.7); out[1] = l * 1.0; out[2] = l * (0.42 + dry * 0.2);
    out[3] = blade * 0.6 + clump * 0.3;
    out[4] = 0.94;
  },
  [SURFACE.DIRT]: (s) => (x, y, out) => {
    const u = x / s * 5, v = y / s * 5;
    const n = fbm(u * 12, v * 12, 4, 33);
    const w = worley(u * 14, v * 14, 47).f1;
    const l = 0.16 + n * 0.14 + w * 0.06;
    out[0] = l * 1.0; out[1] = l * 0.80; out[2] = l * 0.60;
    out[3] = n * 0.5 - w * 0.3;
    out[4] = 0.93;
  },
  [SURFACE.GRAVEL]: (s) => (x, y, out) => {
    const u = x / s * 9, v = y / s * 9;
    const c = worley(u * 10, v * 10, 57, 1.0);
    const stone = 1 - Math.min(1, (c.f2 - c.f1) * 3.2);
    const n = fbm(u * 20, v * 20, 3, 63);
    const l = 0.16 + stone * 0.20 + n * 0.10;
    out[0] = l * 1.0; out[1] = l * 0.97; out[2] = l * 0.92;
    out[3] = stone * 0.9 + n * 0.2;
    out[4] = 0.88 - stone * 0.1;
  },
  [SURFACE.FABRIC]: (s) => (x, y, out) => {
    const u = x / s * 20, v = y / s * 20;
    const weave = (Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI * 2)) * 0.5 + 0.5;
    const n = fbm(u * 4, v * 4, 3, 71);
    const l = 0.16 + weave * 0.07 + n * 0.08;
    out[0] = l * 0.94; out[1] = l * 0.90; out[2] = l * 0.88;
    out[3] = weave * 0.6;
    out[4] = 0.95;
  },
  [SURFACE.GLASS]: (s) => (x, y, out) => {
    const u = x / s * 3, v = y / s * 3;
    const smudge = fbm(u * 6, v * 6, 3, 83);
    const l = 0.42 + smudge * 0.14;
    out[0] = l * 0.86; out[1] = l * 0.95; out[2] = l * 1.0;
    out[3] = smudge * 0.1;
    out[4] = 0.06 + smudge * 0.10;
  },
  [SURFACE.WATER]: (s) => (x, y, out) => {
    const u = x / s * 4, v = y / s * 4;
    const w = fbm(u * 9, v * 9, 4, 93);
    const l = 0.10 + w * 0.06;
    out[0] = l * 0.6; out[1] = l * 0.85; out[2] = l * 1.0;
    out[3] = w * 0.7;
    out[4] = 0.10;
  }
};

const REPEATS = {
  [SURFACE.CONCRETE]: 0.25, [SURFACE.PLASTER]: 0.22, [SURFACE.METAL]: 0.35,
  [SURFACE.WOOD]: 0.5, [SURFACE.TILE]: 0.5, [SURFACE.CARPET]: 0.7,
  [SURFACE.GRASS]: 0.35, [SURFACE.DIRT]: 0.3, [SURFACE.GRAVEL]: 0.45,
  [SURFACE.FABRIC]: 0.8, [SURFACE.GLASS]: 0.2, [SURFACE.WATER]: 0.2
};

export function textureSizeFor(quality) {
  return quality === 'low' ? 128 : quality === 'medium' ? 256 : 512;
}

/** Build (and cache) the map set for a surface type. */
export function getSurfaceMaps(surface, quality = 'high', aniso = 8) {
  const key = surface + ':' + quality;
  if (cache.has(key)) return cache.get(key);
  const size = textureSizeFor(quality);
  const gen = (GEN[surface] || GEN[SURFACE.CONCRETE])(size);
  const { albedo, rough, height } = writeMaps(size, gen);
  const normalCanvas = heightToNormal(height, size, size / 128);
  const maps = {
    map: toTexture(albedo, { srgb: true, aniso }),
    roughnessMap: toTexture(rough, { aniso }),
    normalMap: toTexture(normalCanvas, { aniso }),
    scale: REPEATS[surface] ?? 0.3
  };
  cache.set(key, maps);
  return maps;
}

/** A small noise texture used by the post stack for grain and sensor noise. */
export function makeNoiseTexture(size = 256) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.random() * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = Math.random() * 255;
    img.data[i * 4 + 2] = Math.random() * 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  return t;
}

/** Radial soft-edged sprite (muzzle flash core, light glow). */
export function makeRadialTexture(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', power = 1) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    g.addColorStop(t, i === 0 ? inner : i === 8 ? outer : mixColor(inner, outer, Math.pow(t, power)));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mixColor(a, b, t) {
  const pa = a.match(/[\d.]+/g).map(Number);
  const pb = b.match(/[\d.]+/g).map(Number);
  const out = [0, 1, 2].map((i) => Math.round(pa[i] + (pb[i] - pa[i]) * t));
  const alpha = (pa[3] ?? 1) + ((pb[3] ?? 1) - (pa[3] ?? 1)) * t;
  return `rgba(${out[0]},${out[1]},${out[2]},${alpha})`;
}

/** Bullet hole decal: dark crater + cracked rim, tinted per surface. */
export function makeDecalTexture(kind = 'concrete', size = 64) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  const img = ctx.createImageData(size, size);
  const glass = kind === 'glass';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / (size / 2), dy = (y - cy) / (size / 2);
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const rough = fbm(x / size * 8, y / size * 8, 3, 17);
      const spikes = 0.34 + Math.sin(ang * 7 + rough * 6) * 0.06 + rough * 0.12;
      let a = 0;
      if (d < spikes * 0.42) a = 1;
      else if (d < spikes) a = Math.pow(1 - (d - spikes * 0.42) / (spikes * 0.58), 1.5) * (glass ? 0.9 : 0.72);
      if (glass) {
        const crack = Math.abs(Math.sin(ang * 9 + rough * 3));
        if (d < 0.95 && crack > 0.93) a = Math.max(a, (1 - d) * 0.8);
      }
      const i = (y * size + x) * 4;
      const core = d < spikes * 0.45 ? 0 : 0.35;
      const tint = kind === 'metal' ? [0.55, 0.55, 0.6] : kind === 'wood' ? [0.25, 0.16, 0.09] : kind === 'glass' ? [0.8, 0.9, 1.0] : [0.4, 0.39, 0.37];
      img.data[i] = tint[0] * core * 255;
      img.data[i + 1] = tint[1] * core * 255;
      img.data[i + 2] = tint[2] * core * 255;
      img.data[i + 3] = Math.max(0, Math.min(1, a)) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function disposeTextures() {
  for (const m of cache.values()) {
    m.map?.dispose(); m.roughnessMap?.dispose(); m.normalMap?.dispose();
  }
  cache.clear();
}
