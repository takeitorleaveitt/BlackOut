// Prop meshes.  Each entry returns a single merged, vertex-coloured geometry
// so the whole map can render one InstancedMesh per prop type.

import * as THREE from 'three';
import { buildParts, box, cyl, sph, cone } from './Geo.js';

const C = {
  wood: 0x8a6a42, woodDark: 0x5c452b, ply: 0xa8845a,
  steel: 0x6e747a, steelDark: 0x44494e, rust: 0x7a4a2c,
  paintRed: 0x8c3630, paintBlue: 0x2f4f6b, paintYellow: 0xa08128,
  plastic: 0x2c3034, fabric: 0x4a4238, fabricLight: 0x6b6357,
  glass: 0x6d8fa3, black: 0x1b1e21, white: 0xb9bcbd,
  leaf: 0x3d5c2a, leafDark: 0x2b4420, bark: 0x4a3a2a,
  stone: 0x6b6862, concrete: 0x8e8c86, dirt: 0x6b563c,
  chrome: 0x9aa2a8, tyre: 0x1c1e20, glassCar: 0x3d4f5c
};

const cache = new Map();

const BUILDERS = {
  crate_wood: () => buildParts([
    { geo: box(0.9, 0.9, 0.9), color: C.wood, noise: 0.12 },
    { geo: box(0.94, 0.09, 0.94), color: C.woodDark, pos: [0, 0.4, 0] },
    { geo: box(0.94, 0.09, 0.94), color: C.woodDark, pos: [0, -0.4, 0] },
    { geo: box(0.06, 0.92, 0.06), color: C.woodDark, pos: [0.44, 0, 0.44] },
    { geo: box(0.06, 0.92, 0.06), color: C.woodDark, pos: [-0.44, 0, 0.44] }
  ]),
  crate_large: () => buildParts([
    { geo: box(1.4, 1.4, 1.4), color: C.wood, noise: 0.13 },
    { geo: box(1.44, 0.12, 1.44), color: C.woodDark, pos: [0, 0.62, 0] },
    { geo: box(1.44, 0.12, 1.44), color: C.woodDark, pos: [0, -0.62, 0] },
    { geo: box(0.5, 0.3, 0.02), color: C.paintYellow, pos: [0, 0.1, 0.71] }
  ]),
  crate_metal: () => buildParts([
    { geo: box(1.0, 0.8, 1.0), color: C.steel, noise: 0.09 },
    { geo: box(1.04, 0.08, 1.04), color: C.steelDark, pos: [0, 0.36, 0] },
    { geo: box(0.08, 0.82, 0.08), color: C.steelDark, pos: [0.46, 0, 0.46] },
    { geo: box(0.08, 0.82, 0.08), color: C.steelDark, pos: [-0.46, 0, -0.46] }
  ]),
  crate_stack: () => buildParts([
    { geo: box(1.0, 0.95, 1.0), color: C.wood, pos: [0, -0.5, 0], noise: 0.12 },
    { geo: box(0.92, 0.95, 0.92), color: C.woodDark, pos: [0.04, 0.5, -0.03], rot: [0, 0.2, 0], noise: 0.12 }
  ]),
  pallet: () => {
    const p = [];
    for (let i = 0; i < 5; i++) p.push({ geo: box(1.2, 0.03, 0.12), color: C.ply, pos: [0, 0.12, -0.44 + i * 0.22] });
    for (let i = 0; i < 3; i++) p.push({ geo: box(0.1, 0.1, 1.0), color: C.woodDark, pos: [-0.5 + i * 0.5, 0.05, 0] });
    return buildParts(p);
  },
  barrel: () => buildParts([
    { geo: cyl(0.29, 0.29, 0.88, 14), color: C.paintBlue, noise: 0.1 },
    { geo: cyl(0.30, 0.30, 0.06, 14), color: C.steelDark, pos: [0, 0.22, 0] },
    { geo: cyl(0.30, 0.30, 0.06, 14), color: C.steelDark, pos: [0, -0.22, 0] },
    { geo: cyl(0.30, 0.30, 0.05, 14), color: C.steelDark, pos: [0, 0.42, 0] }
  ]),
  fuel_drum: () => buildParts([
    { geo: cyl(0.31, 0.31, 0.94, 14), color: C.rust, noise: 0.16 },
    { geo: cyl(0.32, 0.32, 0.07, 14), color: C.steelDark, pos: [0, 0.26, 0] },
    { geo: cyl(0.32, 0.32, 0.07, 14), color: C.steelDark, pos: [0, -0.26, 0] },
    { geo: box(0.2, 0.02, 0.3), color: C.paintYellow, pos: [0, 0.48, 0] }
  ]),
  shelf_rack: () => {
    const p = [];
    for (const x of [-1.25, 1.25]) for (const z of [-0.35, 0.35]) {
      p.push({ geo: box(0.09, 2.4, 0.09), color: C.paintBlue, pos: [x, 0, z] });
    }
    for (const y of [-1.1, -0.35, 0.4, 1.15]) {
      p.push({ geo: box(2.6, 0.06, 0.8), color: C.steel, pos: [0, y, 0] });
    }
    return buildParts(p);
  },
  table: () => buildParts([
    { geo: box(1.6, 0.06, 0.9), color: C.wood, pos: [0, 0.36, 0] },
    { geo: box(0.07, 0.72, 0.07), color: C.woodDark, pos: [-0.72, 0, -0.38] },
    { geo: box(0.07, 0.72, 0.07), color: C.woodDark, pos: [0.72, 0, -0.38] },
    { geo: box(0.07, 0.72, 0.07), color: C.woodDark, pos: [-0.72, 0, 0.38] },
    { geo: box(0.07, 0.72, 0.07), color: C.woodDark, pos: [0.72, 0, 0.38] }
  ]),
  desk: () => buildParts([
    { geo: box(1.5, 0.05, 0.72), color: C.woodDark, pos: [0, 0.35, 0] },
    { geo: box(0.45, 0.6, 0.66), color: C.steelDark, pos: [0.5, 0.03, 0] },
    { geo: box(0.06, 0.7, 0.66), color: C.steelDark, pos: [-0.7, 0, 0] },
    { geo: box(0.42, 0.03, 0.02), color: C.chrome, pos: [0.5, 0.16, 0.34] }
  ]),
  chair: () => buildParts([
    { geo: box(0.44, 0.05, 0.44), color: C.wood, pos: [0, 0.22, 0] },
    { geo: box(0.44, 0.5, 0.05), color: C.wood, pos: [0, 0.48, -0.2] },
    { geo: box(0.05, 0.44, 0.05), color: C.woodDark, pos: [-0.18, 0, -0.18] },
    { geo: box(0.05, 0.44, 0.05), color: C.woodDark, pos: [0.18, 0, -0.18] },
    { geo: box(0.05, 0.44, 0.05), color: C.woodDark, pos: [-0.18, 0, 0.18] },
    { geo: box(0.05, 0.44, 0.05), color: C.woodDark, pos: [0.18, 0, 0.18] }
  ]),
  office_chair: () => buildParts([
    { geo: box(0.5, 0.09, 0.5), color: C.fabric, pos: [0, 0.42, 0] },
    { geo: box(0.48, 0.6, 0.08), color: C.fabric, pos: [0, 0.75, -0.22] },
    { geo: cyl(0.05, 0.05, 0.38, 8), color: C.chrome, pos: [0, 0.2, 0] },
    { geo: cyl(0.28, 0.28, 0.05, 10), color: C.black, pos: [0, 0.03, 0] }
  ]),
  sofa: () => buildParts([
    { geo: box(2.0, 0.42, 0.9), color: C.fabric, pos: [0, 0.28, 0] },
    { geo: box(2.0, 0.55, 0.22), color: C.fabricLight, pos: [0, 0.62, -0.34] },
    { geo: box(0.18, 0.6, 0.9), color: C.fabric, pos: [-0.91, 0.5, 0] },
    { geo: box(0.18, 0.6, 0.9), color: C.fabric, pos: [0.91, 0.5, 0] },
    { geo: box(1.9, 0.12, 0.7), color: C.fabricLight, pos: [0, 0.53, 0.06] }
  ]),
  bed: () => buildParts([
    { geo: box(1.4, 0.3, 2.0), color: C.woodDark, pos: [0, 0.16, 0] },
    { geo: box(1.34, 0.22, 1.94), color: C.white, pos: [0, 0.4, 0] },
    { geo: box(1.34, 0.1, 1.1), color: C.fabricLight, pos: [0, 0.5, 0.4] },
    { geo: box(0.6, 0.14, 0.34), color: C.white, pos: [-0.3, 0.55, -0.78] },
    { geo: box(1.4, 0.7, 0.08), color: C.woodDark, pos: [0, 0.5, -1.0] }
  ]),
  wardrobe: () => buildParts([
    { geo: box(1.2, 2.0, 0.6), color: C.woodDark, noise: 0.09 },
    { geo: box(0.02, 1.9, 0.55), color: C.black, pos: [0, 0, 0.3] },
    { geo: box(0.06, 0.14, 0.06), color: C.chrome, pos: [-0.12, 0.1, 0.32] },
    { geo: box(0.06, 0.14, 0.06), color: C.chrome, pos: [0.12, 0.1, 0.32] }
  ]),
  fridge: () => buildParts([
    { geo: box(0.72, 1.75, 0.7), color: C.white, noise: 0.05 },
    { geo: box(0.74, 0.03, 0.72), color: C.steelDark, pos: [0, 0.35, 0] },
    { geo: box(0.05, 0.5, 0.05), color: C.chrome, pos: [0.3, 0.75, 0.36] },
    { geo: box(0.05, 0.4, 0.05), color: C.chrome, pos: [0.3, -0.2, 0.36] }
  ]),
  counter: () => buildParts([
    { geo: box(2.0, 0.86, 0.65), color: C.woodDark, pos: [0, 0.43, 0] },
    { geo: box(2.06, 0.06, 0.7), color: C.stone, pos: [0, 0.89, 0] },
    { geo: box(0.9, 0.02, 0.6), color: C.chrome, pos: [-0.4, 0.92, 0] }
  ]),
  locker: () => buildParts([
    { geo: box(0.9, 1.9, 0.5), color: C.paintBlue, noise: 0.08 },
    { geo: box(0.02, 1.85, 0.46), color: C.steelDark, pos: [0, 0, 0.25] },
    { geo: box(0.4, 0.06, 0.02), color: C.steelDark, pos: [-0.22, 0.5, 0.26] },
    { geo: box(0.4, 0.06, 0.02), color: C.steelDark, pos: [0.22, 0.5, 0.26] }
  ]),
  cabinet: () => buildParts([
    { geo: box(1.0, 1.35, 0.48), color: C.steel, noise: 0.07 },
    { geo: box(0.94, 0.03, 0.02), color: C.steelDark, pos: [0, 0.3, 0.25] },
    { geo: box(0.94, 0.03, 0.02), color: C.steelDark, pos: [0, -0.15, 0.25] },
    { geo: box(0.2, 0.04, 0.03), color: C.chrome, pos: [0, 0.45, 0.26] }
  ]),
  bookshelf: () => {
    const p = [{ geo: box(1.1, 1.8, 0.35), color: C.woodDark }];
    for (let i = 0; i < 3; i++) {
      p.push({ geo: box(1.04, 0.04, 0.33), color: C.wood, pos: [0, -0.6 + i * 0.55, 0.01] });
      for (let j = 0; j < 7; j++) {
        p.push({
          geo: box(0.06 + (j % 3) * 0.02, 0.28, 0.22), color: [0x7a3b2e, 0x2f4a63, 0x4a5c34, 0x6b5730][j % 4],
          pos: [-0.45 + j * 0.14, -0.42 + i * 0.55, 0.02]
        });
      }
    }
    return buildParts(p);
  },
  tv: () => buildParts([
    { geo: box(1.1, 0.65, 0.06), color: C.black },
    { geo: box(1.02, 0.57, 0.01), color: 0x0c1116, pos: [0, 0, 0.04] },
    { geo: box(0.3, 0.04, 0.2), color: C.black, pos: [0, -0.35, 0] }
  ]),
  monitor: () => buildParts([
    { geo: box(0.55, 0.34, 0.04), color: C.black, pos: [0, 0.2, 0] },
    { geo: box(0.5, 0.29, 0.01), color: 0x0d1418, pos: [0, 0.2, 0.03] },
    { geo: box(0.06, 0.14, 0.06), color: C.black, pos: [0, 0.0, 0] },
    { geo: box(0.24, 0.02, 0.16), color: C.black, pos: [0, -0.07, 0] }
  ]),
  computer: () => buildParts([
    { geo: box(0.22, 0.45, 0.48), color: C.black },
    { geo: box(0.02, 0.4, 0.02), color: 0x2fa8c8, pos: [0.11, 0.05, 0.2] }
  ]),
  printer: () => buildParts([
    { geo: box(0.6, 0.34, 0.5), color: C.white, noise: 0.05 },
    { geo: box(0.52, 0.04, 0.4), color: C.black, pos: [0, 0.19, 0.02] },
    { geo: box(0.3, 0.01, 0.22), color: 0xe8e8e0, pos: [0, 0.22, 0.16] }
  ]),
  whiteboard: () => buildParts([
    { geo: box(1.8, 1.1, 0.05), color: C.white },
    { geo: box(1.86, 0.06, 0.08), color: C.steel, pos: [0, -0.56, 0.02] }
  ]),
  dumpster: () => buildParts([
    { geo: box(2.0, 1.0, 1.1), color: 0x2f5e3a, pos: [0, 0.5, 0], noise: 0.14 },
    { geo: box(2.06, 0.12, 1.16), color: 0x24472c, pos: [0, 1.08, 0] },
    { geo: box(0.1, 0.5, 0.1), color: C.steelDark, pos: [-1.0, 0.25, 0.5] },
    { geo: box(0.1, 0.5, 0.1), color: C.steelDark, pos: [1.0, 0.25, 0.5] },
    { geo: cyl(0.12, 0.12, 0.08, 8), color: C.black, pos: [-0.8, 0.06, 0.5], rot: [Math.PI / 2, 0, 0] },
    { geo: cyl(0.12, 0.12, 0.08, 8), color: C.black, pos: [0.8, 0.06, 0.5], rot: [Math.PI / 2, 0, 0] }
  ]),
  car: () => buildParts([
    { geo: box(1.8, 0.62, 4.3), color: 0x53565c, pos: [0, 0.62, 0], noise: 0.06 },
    { geo: box(1.62, 0.56, 2.1), color: 0x4a4d53, pos: [0, 1.16, -0.15] },
    { geo: box(1.5, 0.42, 1.9), color: C.glassCar, pos: [0, 1.2, -0.15] },
    { geo: box(1.84, 0.18, 4.34), color: C.black, pos: [0, 0.36, 0] },
    { geo: box(0.5, 0.2, 0.06), color: 0xffd9a0, pos: [-0.6, 0.72, 2.16] },
    { geo: box(0.5, 0.2, 0.06), color: 0xffd9a0, pos: [0.6, 0.72, 2.16] },
    { geo: box(0.44, 0.18, 0.06), color: 0x8c2a24, pos: [-0.6, 0.78, -2.16] },
    { geo: box(0.44, 0.18, 0.06), color: 0x8c2a24, pos: [0.6, 0.78, -2.16] },
    ...[[-0.86, 1.42], [0.86, 1.42], [-0.86, -1.42], [0.86, -1.42]].map(([x, z]) => ({
      geo: cyl(0.33, 0.33, 0.22, 12), color: C.tyre, pos: [x, 0.33, z], rot: [0, 0, Math.PI / 2]
    }))
  ]),
  van: () => buildParts([
    { geo: box(2.05, 1.5, 3.4), color: 0x8f9296, pos: [0, 1.15, -0.6], noise: 0.05 },
    { geo: box(2.0, 0.95, 1.9), color: 0x83868a, pos: [0, 0.85, 1.6] },
    { geo: box(1.86, 0.5, 0.1), color: C.glassCar, pos: [0, 1.2, 2.5] },
    { geo: box(0.1, 0.5, 1.4), color: C.glassCar, pos: [1.0, 1.2, 1.5] },
    { geo: box(0.1, 0.5, 1.4), color: C.glassCar, pos: [-1.0, 1.2, 1.5] },
    { geo: box(2.1, 0.2, 5.2), color: C.black, pos: [0, 0.42, 0] },
    ...[[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.5], [0.95, -1.5]].map(([x, z]) => ({
      geo: cyl(0.4, 0.4, 0.26, 12), color: C.tyre, pos: [x, 0.4, z], rot: [0, 0, Math.PI / 2]
    }))
  ]),
  tire_stack: () => buildParts([0, 1, 2].map((i) => ({
    geo: cyl(0.44, 0.44, 0.26, 14), color: C.tyre, pos: [(i % 2) * 0.04, 0.14 + i * 0.26, 0], noise: 0.1
  }))),
  toolbox: () => buildParts([
    { geo: box(0.7, 0.38, 0.4), color: 0xa8452c, pos: [0, 0.19, 0] },
    { geo: box(0.72, 0.06, 0.42), color: 0x7d3320, pos: [0, 0.41, 0] },
    { geo: box(0.24, 0.06, 0.04), color: C.chrome, pos: [0, 0.48, 0] }
  ]),
  sandbags: () => {
    const p = [];
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 4; i++) {
        p.push({
          geo: sph(0.24, 7, 5), color: r ? 0x6d6350 : 0x7a705c,
          pos: [-0.58 + i * 0.39 + r * 0.18, 0.2 + r * 0.36, 0],
          scale: [1.5, 0.75, 1.15], rot: [0, i * 0.3, 0], noise: 0.12
        });
      }
    }
    return buildParts(p);
  },
  jersey: () => buildParts([
    { geo: box(1.6, 0.2, 0.6), color: C.concrete, pos: [0, 0.1, 0] },
    { geo: box(1.4, 0.5, 0.34), color: C.concrete, pos: [0, 0.42, 0] },
    { geo: box(1.3, 0.2, 0.24), color: C.concrete, pos: [0, 0.76, 0] },
    { geo: box(1.32, 0.12, 0.26), color: 0xb8622a, pos: [0, 0.6, 0] }
  ]),
  cone: () => buildParts([
    { geo: box(0.35, 0.03, 0.35), color: 0xc2512a, pos: [0, 0.015, 0] },
    { geo: cone(0.14, 0.55, 8), color: 0xd45a2c, pos: [0, 0.29, 0] },
    { geo: cyl(0.1, 0.11, 0.08, 8), color: C.white, pos: [0, 0.34, 0] }
  ]),
  generator: () => buildParts([
    { geo: box(1.6, 0.9, 0.9), color: 0x5e6a52, pos: [0, 0.45, 0], noise: 0.08 },
    { geo: box(1.3, 0.25, 0.8), color: C.steelDark, pos: [0, 0.98, 0] },
    { geo: cyl(0.1, 0.1, 0.5, 8), color: C.steelDark, pos: [-0.6, 1.2, -0.2] },
    { geo: box(0.3, 0.2, 0.02), color: C.black, pos: [0.5, 0.6, 0.46] },
    { geo: box(0.06, 0.06, 0.02), color: 0x30d060, pos: [0.42, 0.66, 0.48] }
  ]),
  ac_unit: () => buildParts([
    { geo: box(1.1, 0.85, 1.1), color: C.steel, noise: 0.07 },
    { geo: cyl(0.4, 0.4, 0.08, 12), color: C.steelDark, pos: [0, 0.44, 0] },
    { geo: box(1.0, 0.02, 0.06), color: C.steelDark, pos: [0, 0.1, 0.55] },
    { geo: box(1.0, 0.02, 0.06), color: C.steelDark, pos: [0, -0.1, 0.55] }
  ]),
  pipe_run: () => buildParts([
    { geo: cyl(0.13, 0.13, 6.0, 10), color: C.steel, rot: [Math.PI / 2, 0, 0], noise: 0.08 },
    { geo: cyl(0.16, 0.16, 0.16, 10), color: C.steelDark, pos: [0, 0, -2], rot: [Math.PI / 2, 0, 0] },
    { geo: cyl(0.16, 0.16, 0.16, 10), color: C.steelDark, pos: [0, 0, 2], rot: [Math.PI / 2, 0, 0] }
  ]),
  girder: () => buildParts([
    { geo: box(0.34, 0.05, 8.0), color: C.rust, pos: [0, 0.15, 0], noise: 0.12 },
    { geo: box(0.34, 0.05, 8.0), color: C.rust, pos: [0, -0.15, 0], noise: 0.12 },
    { geo: box(0.05, 0.3, 8.0), color: C.rust, noise: 0.12 }
  ]),
  rubble: () => {
    const p = [];
    for (let i = 0; i < 9; i++) {
      const a = i * 2.1;
      p.push({
        geo: box(0.3 + (i % 3) * 0.22, 0.2 + (i % 2) * 0.18, 0.28 + (i % 4) * 0.15),
        color: i % 3 === 0 ? C.stone : C.concrete,
        pos: [Math.cos(a) * 0.5, 0.12 + (i % 3) * 0.14, Math.sin(a) * 0.5],
        rot: [i * 0.3, a, i * 0.2], noise: 0.16
      });
    }
    return buildParts(p);
  },
  debris_pile: () => {
    const p = [];
    for (let i = 0; i < 14; i++) {
      const a = i * 1.7;
      const r = 0.2 + (i % 4) * 0.24;
      p.push({
        geo: box(0.4 + (i % 3) * 0.3, 0.16, 0.3 + (i % 5) * 0.2),
        color: i % 4 === 0 ? C.woodDark : i % 3 === 0 ? C.steelDark : C.concrete,
        pos: [Math.cos(a) * r, 0.08 + (i % 5) * 0.13, Math.sin(a) * r],
        rot: [i * 0.4, a, i * 0.25], noise: 0.18
      });
    }
    return buildParts(p);
  },
  tree: () => {
    const p = [{ geo: cyl(0.16, 0.28, 4.2, 7), color: C.bark, pos: [0, 2.1, 0], noise: 0.12 }];
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3;
      p.push({
        geo: sph(1.1 - i * 0.06, 7, 5), color: i % 2 ? C.leaf : C.leafDark,
        pos: [Math.cos(a) * 0.75, 4.4 + (i % 3) * 0.7, Math.sin(a) * 0.75],
        scale: [1.2, 0.85, 1.2], noise: 0.16
      });
    }
    return buildParts(p);
  },
  pine: () => {
    const p = [{ geo: cyl(0.12, 0.24, 7.0, 7), color: C.bark, pos: [0, 3.5, 0], noise: 0.1 }];
    for (let i = 0; i < 4; i++) {
      p.push({
        geo: cone(1.35 - i * 0.26, 2.4, 8), color: i % 2 ? C.leafDark : 0x24401c,
        pos: [0, 3.2 + i * 1.5, 0], noise: 0.14
      });
    }
    return buildParts(p);
  },
  bush: () => buildParts([0, 1, 2, 3].map((i) => ({
    geo: sph(0.55 - i * 0.05, 6, 5), color: i % 2 ? C.leaf : C.leafDark,
    pos: [Math.cos(i * 1.6) * 0.32, 0.42 + (i % 2) * 0.2, Math.sin(i * 1.6) * 0.32],
    scale: [1.2, 0.8, 1.2], noise: 0.18
  }))),
  rock: () => buildParts([
    { geo: sph(0.62, 7, 5), color: C.stone, scale: [1.1, 0.7, 1.0], noise: 0.16 },
    { geo: sph(0.36, 6, 4), color: C.stone, pos: [0.4, 0.12, 0.2], scale: [1, 0.75, 1], noise: 0.16 }
  ]),
  streetlight: () => buildParts([
    { geo: cyl(0.09, 0.13, 6.2, 8), color: C.steelDark, pos: [0, 3.1, 0] },
    { geo: box(0.1, 0.1, 1.0), color: C.steelDark, pos: [0, 6.1, 0.5] },
    { geo: box(0.4, 0.14, 0.7), color: C.steel, pos: [0, 5.98, 1.0] },
    { geo: box(0.34, 0.04, 0.6), color: 0xffe6b0, pos: [0, 5.9, 1.0] }
  ]),
  fence_panel: () => {
    const p = [
      { geo: box(0.08, 2.2, 0.08), color: C.steelDark, pos: [-1.45, 0, 0] },
      { geo: box(0.08, 2.2, 0.08), color: C.steelDark, pos: [1.45, 0, 0] },
      { geo: box(3.0, 0.06, 0.05), color: C.steelDark, pos: [0, 1.05, 0] },
      { geo: box(3.0, 0.06, 0.05), color: C.steelDark, pos: [0, -1.05, 0] }
    ];
    for (let i = 0; i < 11; i++) p.push({ geo: box(0.025, 2.1, 0.025), color: C.steel, pos: [-1.35 + i * 0.27, 0, 0] });
    for (let i = 0; i < 7; i++) p.push({ geo: box(2.9, 0.025, 0.025), color: C.steel, pos: [0, -0.9 + i * 0.3, 0] });
    return buildParts(p);
  },
  plant: () => buildParts([
    { geo: cyl(0.22, 0.17, 0.34, 8), color: 0x6b4a34, pos: [0, 0.17, 0] },
    ...[0, 1, 2, 3, 4].map((i) => ({
      geo: box(0.06, 0.7, 0.14), color: i % 2 ? C.leaf : C.leafDark,
      pos: [Math.cos(i * 1.3) * 0.1, 0.68, Math.sin(i * 1.3) * 0.1],
      rot: [Math.cos(i) * 0.35, i * 1.3, Math.sin(i) * 0.35], noise: 0.16
    }))
  ]),
  lamp: () => buildParts([
    { geo: cyl(0.16, 0.2, 0.05, 10), color: C.steelDark, pos: [0, 0.02, 0] },
    { geo: cyl(0.03, 0.03, 1.1, 6), color: C.chrome, pos: [0, 0.58, 0] },
    { geo: cone(0.26, 0.34, 10), color: 0xd8c9a8, pos: [0, 1.28, 0] }
  ]),
  vent: () => buildParts([
    { geo: box(0.8, 0.5, 0.8), color: C.steel, noise: 0.08 },
    { geo: box(0.68, 0.04, 0.68), color: C.steelDark, pos: [0, 0.27, 0] },
    { geo: cyl(0.22, 0.22, 0.1, 10), color: C.black, pos: [0, 0.3, 0] }
  ]),
  pillar_round: () => buildParts([
    { geo: cyl(0.35, 0.35, 3.0, 12), color: C.concrete, noise: 0.06 },
    { geo: cyl(0.4, 0.4, 0.12, 12), color: C.concrete, pos: [0, -1.45, 0] }
  ]),
  barrier: () => buildParts([
    { geo: box(2.4, 0.9, 0.12), color: 0xc25a2a, pos: [0, 0.5, 0] },
    { geo: box(2.4, 0.16, 0.14), color: C.white, pos: [0, 0.72, 0] },
    { geo: box(0.12, 0.9, 0.5), color: 0xc25a2a, pos: [-1.1, 0.45, 0] },
    { geo: box(0.12, 0.9, 0.5), color: 0xc25a2a, pos: [1.1, 0.45, 0] }
  ])
};

/** Build (once) and return the merged geometry for a prop type. */
export function propGeometry(type) {
  if (cache.has(type)) return cache.get(type);
  const fn = BUILDERS[type];
  if (!fn) {
    const g = box(0.6, 0.6, 0.6);
    const merged = buildParts([{ geo: g, color: 0x7a7a7a }]);
    cache.set(type, merged);
    return merged;
  }
  const g = fn();
  cache.set(type, g);
  return g;
}

export function disposeProps() {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}

export const PROP_TYPES = Object.keys(BUILDERS);
