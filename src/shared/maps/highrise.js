import { MapBuilder } from './kit.js';
import { SURFACE, mulberry32 } from '../constants.js';

/**
 * MERIDIAN — partially destroyed office block.
 * Two floors of cubicle farm with the south face blown out, so the whole map
 * is lit by a hard low sun and cut apart by collapsed slabs and rubble.
 */
export function buildHighrise() {
  const rng = mulberry32(0x0FF1C);
  const b = new MapBuilder({
    key: 'highrise',
    name: 'Meridian',
    subtitle: 'Collapsed Office Block',
    desc: 'Blown-out office floors, hanging cable and a collapsed slab you can fight through in three directions.',
    size: [70, 58],
    compact: false,
    env: {
      sky: 'dusk',
      sunDir: [-0.82, 0.28, 0.2],
      sunColor: 0xffb070, sunIntensity: 3.6,
      ambientColor: 0x6a7282, ambientIntensity: 1.4,
      hemiGround: 0x685c50,
      fog: { color: 0x8a7b74, near: 16, far: 110 },
      exposure: 1.34,
      reverb: 'hall',
      wind: 0.7, rain: 0, dustMotes: 1.4
    }
  });

  const C = SURFACE.CONCRETE, P = SURFACE.PLASTER, M = SURFACE.METAL, T = SURFACE.TILE;
  const F2 = 4.2, H = 3.6;

  // --- ground plane / plaza ------------------------------------------------
  b.floor(0, 0, 70, 58, 0, C, 0.8);
  b.floor(0, 22, 70, 14, 0.02, T, 0.1);

  // --- floor 1 shell (south wall destroyed) --------------------------------
  b.floor(0, -4, 44, 34, 0.05, T, 0.3);
  b.wall(-22, -21, 22, -21, F2 - 0.05, { mat: C, thick: 0.4 });
  b.wallWindow(-22, -21, 22, -21, F2 - 0.05, { mat: C, thick: 0.4, at: 0.3, gap: 6, sill: 0.9, top: 2.8 });
  b.wall(-22, -21, -22, 13, F2 - 0.05, { mat: C, thick: 0.4 });
  b.wall(22, -21, 22, 13, F2 - 0.05, { mat: C, thick: 0.4 });
  // south face: only stubs remain
  b.wall(-22, 13, -14, 13, F2 - 0.05, { mat: C, thick: 0.4 });
  b.wall(16, 13, 22, 13, F2 - 0.05, { mat: C, thick: 0.4 });
  b.box(-9, 3.6, 13, 4, 0.9, 0.5, { mat: C });     // hanging slab fragment
  b.zone(0, F2 / 2, -4, 44, F2, 34, 'hall');

  // core: lift shaft + stairwell
  b.room(0, -14, 8, 8, F2 + H + 2, { doors: [{ side: 's', at: 0.5 }], mat: C, floor: false, ceil: false, reverb: 'stair' });
  b.stairs(-3.4, 0.05, -17.4, 2.4, 'z', 16, F2 - 0.05, 6.4, C);
  b.box(2.4, F2 - 0.2, -14, 3.2, 0.4, 8, { mat: C });

  // --- floor 2 slab, with a collapsed section ------------------------------
  b.box(-13, F2 - 0.2, -8, 18, 0.4, 26, { mat: C });
  b.box(13, F2 - 0.2, -8, 18, 0.4, 26, { mat: C });
  b.box(0, F2 - 0.2, -18, 44, 0.4, 6, { mat: C });
  b.box(-16, F2 - 0.2, 8, 12, 0.4, 10, { mat: C });
  b.box(16, F2 - 0.2, 8, 12, 0.4, 10, { mat: C });
  // rubble slope from the hole down to floor 1
  for (let i = 0; i < 7; i++) {
    b.box(0, (F2 - 0.4) * (1 - i / 7) * 0.5, 2 + i * 1.5, 8 - i * 0.5, (F2 - 0.4) * (1 - i / 7), 1.6, { mat: C, yaw: rng() * 0.1 });
  }
  b.prop('rubble', -2, 0.05, 6, { yaw: 0.4 });
  b.prop('debris_pile', 2, 0.05, 3, { yaw: 1.1 });
  b.prop('rubble', 0.5, 1.6, 5, { yaw: 2.2, scale: 0.8 });

  b.wall(-22, -21, 22, -21, H, { y: F2, mat: C, thick: 0.4 });
  b.wallWindow(-22, -21, 22, -21, H, { y: F2, mat: C, thick: 0.4, at: 0.7, gap: 7, sill: 0.9, top: 2.6 });
  b.wall(-22, -21, -22, 13, H, { y: F2, mat: C, thick: 0.4 });
  b.wall(22, -21, 22, 13, H, { y: F2, mat: C, thick: 0.4 });
  b.wall(-22, 13, -16, 13, H, { y: F2, mat: C, thick: 0.4 });
  b.ceiling(0, -8, 44, 30, F2 + H, C, 0.4);
  b.zone(0, F2 + H / 2, -8, 44, H, 30, 'hall');

  // --- cubicle farm --------------------------------------------------------
  const cubicles = (cx, cz, cols, rows, y) => {
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = cx + i * 3.6, z = cz + j * 3.2;
        b.wall(x - 1.5, z - 1.4, x + 1.5, z - 1.4, 1.25, { y, mat: SURFACE.FABRIC, thick: 0.1 });
        if (i === 0) b.wall(x - 1.5, z - 1.4, x - 1.5, z + 1.4, 1.25, { y, mat: SURFACE.FABRIC, thick: 0.1 });
        b.prop('desk', x, y + 0.02, z, { yaw: 0 });
        if (rng() > 0.3) b.prop('monitor', x, y + 0.76, z - 0.15, { solid: false });
        if (rng() > 0.5) b.prop('office_chair', x, y + 0.02, z + 1.0, { yaw: rng() * 6 });
      }
    }
  };
  cubicles(-17, -16, 3, 3, 0.05);
  cubicles(8, -16, 3, 3, 0.05);
  cubicles(-17, -15, 3, 2, F2);
  cubicles(9, -15, 3, 2, F2);

  b.prop('printer', -6, 0.05, -18, { yaw: 0.2, solid: false });
  b.prop('cabinet', 20, 0.05, -6, { yaw: -Math.PI / 2 });
  b.prop('cabinet', 20, 0.05, -4.6, { yaw: -Math.PI / 2 });
  b.prop('bookshelf', -20.8, 0.05, 2, { yaw: Math.PI / 2 });
  b.prop('whiteboard', -21.5, 1.6, -8, { yaw: Math.PI / 2, solid: false });
  b.prop('sofa', 16, 0.05, 9, { yaw: Math.PI });
  b.prop('plant', 18, 0.05, 6, { solid: false });
  b.prop('plant', -18, F2, 10, { solid: false });
  b.prop('locker', -20, F2, -2, { yaw: Math.PI / 2 });
  b.prop('table', 14, F2, -20, { yaw: 0 });
  b.prop('whiteboard', 21.4, F2 + 1.6, -12, { yaw: -Math.PI / 2, solid: false });

  // ceiling grid + failing lights
  for (let i = -2; i <= 2; i++) {
    for (const y of [F2 - 0.55, F2 + H - 0.4]) {
      b.light('point', i * 8, y, -10 + (i % 2) * 8, {
        color: 0xd8e8ff, intensity: 7.0, distance: 13, flicker: (i + 2) % 3 === 0 ? 0.75 : 0.08
      });
    }
  }
  b.light('point', 0, 2.4, 8, { color: 0xff8a4a, intensity: 4, distance: 14, flicker: 0.9 });  // fire glow in the hole

  // --- plaza / exterior ----------------------------------------------------
  b.wall(-35, 28, 35, 28, 4.0, { mat: C });
  b.wall(-35, -28, -35, 28, 4.0, { mat: C });
  b.wall(35, -28, 35, 28, 4.0, { mat: C });
  b.wall(-35, -28, 35, -28, 4.0, { mat: C });
  b.prop('car', -26, 0, 18, { yaw: 0.3 });
  b.prop('car', -20, 0, 24, { yaw: 1.8 });
  b.prop('van', 26, 0, 20, { yaw: -0.4 });
  b.prop('dumpster', 30, 0, -10, { yaw: Math.PI / 2 });
  b.prop('barrier', -10, 0, 18, { yaw: 0.1 });
  b.prop('barrier', -7.4, 0, 18.3, { yaw: 0.05 });
  b.prop('jersey', 6, 0, 18, { yaw: 0 });
  b.prop('debris_pile', -14, 0, 15, { yaw: 0.8 });
  b.prop('rubble', 12, 0, 16, { yaw: 2.0 });
  b.prop('rubble', -3, 0, 20, { yaw: 0.3 });
  b.propLine('streetlight', -28, 26, 28, 26, 4, 0, {});
  for (let i = 0; i < 4; i++) b.light('point', -28 + i * 18.6, 6.2, 26, { color: 0xffd9a0, intensity: 6, distance: 22, fixture: 'street' });
  for (let i = 0; i < 14; i++) {
    b.prop(['rubble', 'cone', 'tire_stack', 'toolbox'][Math.floor(rng() * 4)],
      -32 + rng() * 64, 0, 12 + rng() * 14, { yaw: rng() * 6.28, solid: rng() > 0.4, scale: 0.7 + rng() * 0.6 });
  }
  // lobby annex across the plaza
  b.room(-28, 6, 12, 12, 3.4, {
    doors: [{ side: 'e', at: 0.5 }], windows: [{ side: 's', at: 0.5, gap: 5, sill: 0.9, top: 2.6 }],
    mat: C, floorMat: T, ceil: true, reverb: 'room'
  });
  b.light('point', -28, 3.1, 6, { color: 0xcfe0ff, intensity: 4.5, distance: 14, flicker: 0.3 });
  b.prop('counter', -28, 0, 2.5, { yaw: 0 });
  b.prop('sofa', -31, 0, 9, { yaw: Math.PI / 2 });

  // --- spawns / sites ------------------------------------------------------
  b.spawn('alpha', 0, 0, 24, Math.PI);
  b.spawn('alpha', -6, 0, 25, Math.PI);
  b.spawn('alpha', 6, 0, 25, Math.PI);
  b.spawn('alpha', -28, 0, 6, -1.5);
  b.spawn('bravo', 0, F2, -19, 0);
  b.spawn('bravo', -8, F2, -19, 0);
  b.spawn('bravo', 8, F2, -19, 0);
  b.spawn('bravo', 0, 0, -19, 0);
  b.spawn('ffa', -16, 0, -14, 0.6);
  b.spawn('ffa', 16, 0, -14, 2.6);
  b.spawn('ffa', -16, F2, -14, 1.0);
  b.spawn('ffa', 16, F2, 6, 3.0);
  b.spawn('ffa', 0, 0, 8, 0);
  b.spawn('ffa', 26, 0, 20, -2.0);

  b.site('A', -16, 0, -10, 3.4);
  b.site('B', 14, F2, -10, 3.4);

  b.ambient('wind', 0, 10, 0, 70, 0.5);
  b.ambient('fire', 0, 1, 8, 14, 0.5);
  b.ambient('metal_creak', 0, F2, 0, 30, 0.4);
  b.ambient('electric_hum', -8, F2, -12, 12, 0.3);
  return b.build();
}
