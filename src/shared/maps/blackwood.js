import { MapBuilder } from './kit.js';
import { SURFACE, mulberry32 } from '../constants.js';

/**
 * BLACKWOOD — night forest compound.
 * Almost no ambient light. Floodlights make hard pools of visibility and
 * everything between them is a coin flip. Cabins give brief, brutal interiors.
 */
export function buildBlackwood() {
  const rng = mulberry32(0xB1ACC);
  const b = new MapBuilder({
    key: 'blackwood',
    name: 'Blackwood',
    subtitle: 'Forest Compound — 0300 Hours',
    desc: 'Floodlit compound in dead woodland. Move between the light pools or stay in the dark and listen.',
    size: [110, 100],
    compact: false,
    env: {
      sky: 'night',
      sunDir: [-0.3, 0.5, -0.7],
      sunColor: 0x4d6a9a, sunIntensity: 0.28,
      ambientColor: 0x141c2c, ambientIntensity: 0.30,
      hemiGround: 0x0a0d0f,
      fog: { color: 0x0b1018, near: 8, far: 74 },
      exposure: 1.35,
      reverb: 'forest',
      wind: 0.8, rain: 0.25, dustMotes: 0.3, moon: true
    }
  });

  const W = SURFACE.WOOD, C = SURFACE.CONCRETE, D = SURFACE.DIRT, M = SURFACE.METAL;

  b.floor(0, 0, 110, 100, 0, SURFACE.GRASS, 1.0);
  b.floor(0, 0, 44, 44, 0.02, D, 0.1);          // compound pad
  b.floor(0, -34, 12, 40, 0.03, SURFACE.GRAVEL, 0.1);  // access track

  // --- fence line ----------------------------------------------------------
  const fence = (x1, z1, x2, z2, gapAt = -1) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.round(len / 3));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (gapAt >= 0 && Math.abs(t - gapAt) < 0.08) continue;
      b.prop('fence_panel', x1 + (x2 - x1) * t, 0, z1 + (z2 - z1) * t, { yaw: Math.atan2(z2 - z1, x2 - x1) });
    }
  };
  fence(-24, -24, 24, -24, 0.5);
  fence(-24, 24, 24, 24, 0.5);
  fence(-24, -24, -24, 24, 0.32);
  fence(24, -24, 24, 24, 0.68);

  // --- cabins --------------------------------------------------------------
  const cabin = (cx, cz, w, d, yaw, doors, windows) => {
    b.room(cx, cz, w, d, 2.9, {
      doors, windows, mat: W, floorMat: W, ceil: true, reverb: 'room', thick: 0.24
    });
    b.light('point', cx, 2.6, cz, { color: 0xffcf94, intensity: 3.4, distance: 9, flicker: 0.3 });
    // roof
    b.box(cx, 3.25, cz, w + 0.8, 0.35, d + 0.8, { mat: W });
  };
  cabin(-13, -12, 11, 9, 0, [{ side: 'e', at: 0.55 }], [{ side: 's', at: 0.35, gap: 1.8 }, { side: 'n', at: 0.6, gap: 1.6 }]);
  cabin(13, -12, 9, 9, 0, [{ side: 'w', at: 0.45 }], [{ side: 'n', at: 0.5, gap: 1.8 }]);
  cabin(-13, 13, 10, 10, 0, [{ side: 'n', at: 0.5 }], [{ side: 'e', at: 0.5, gap: 2.0 }]);
  cabin(14, 12, 12, 8, 0, [{ side: 'w', at: 0.35 }, { side: 'n', at: 0.7 }], [{ side: 's', at: 0.5, gap: 2.4 }]);

  b.prop('bed', -16, 0.05, -14, { yaw: 0 });
  b.prop('table', -10, 0.05, -10, { yaw: 0.2 });
  b.prop('chair', -10, 0.05, -8.8, { yaw: 0.4 });
  b.prop('locker', -17.2, 0.05, -9, { yaw: Math.PI / 2 });
  b.prop('shelf_rack', 15.6, 0.05, -12, { yaw: Math.PI / 2, scale: 0.85 });
  b.prop('crate_wood', 11, 0.05, -14, { yaw: 0.7 });
  b.prop('bookshelf', -16.6, 0.05, 15, { yaw: Math.PI / 2 });
  b.prop('sofa', -11, 0.05, 15.6, { yaw: Math.PI });
  b.prop('desk', 16, 0.05, 10, { yaw: 0 });
  b.prop('computer', 16, 0.79, 10, { solid: false });
  b.prop('cabinet', 10.4, 0.05, 14, { yaw: 0 });

  // --- watchtower ----------------------------------------------------------
  const TY = 6.0;
  for (const [ox, oz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    b.box(ox, TY / 2, oz, 0.3, TY, 0.3, { mat: W });
  }
  b.box(0, TY, 0, 4.6, 0.25, 4.6, { mat: W });
  b.wall(-2.3, -2.3, 2.3, -2.3, 1.05, { y: TY + 0.12, mat: W, thick: 0.12, opaque: false });
  b.wall(-2.3, 2.3, 2.3, 2.3, 1.05, { y: TY + 0.12, mat: W, thick: 0.12, opaque: false });
  b.wall(-2.3, -2.3, -2.3, 2.3, 1.05, { y: TY + 0.12, mat: W, thick: 0.12, opaque: false });
  b.wall(2.3, -2.3, 2.3, 2.3, 1.05, { y: TY + 0.12, mat: W, thick: 0.12, opaque: false });
  b.box(0, TY + 2.4, 0, 5.2, 0.2, 5.2, { mat: M });
  b.stairs(-4.6, 0.02, 0, 1.4, 'x', 18, TY - 0.02, 6.6, W);
  b.light('spot', 0, TY + 2.1, 0, { color: 0xfff4d8, intensity: 40, distance: 46, angle: 0.62, penumbra: 0.42, target: [0, 0, 14], shadow: true, fixture: 'flood' });
  b.zone(0, TY + 1, 0, 4.6, 2.2, 4.6, 'room');

  // --- floodlights ---------------------------------------------------------
  const floods = [[-22, -22, 0.9], [22, -22, 2.3], [-22, 22, -0.7], [22, 22, 3.9]];
  for (const [fx, fz, fyaw] of floods) {
    b.prop('streetlight', fx, 0, fz, {});
    b.light('spot', fx, 6.4, fz, {
      color: 0xffe8bc, intensity: 26, distance: 34, angle: 0.72, penumbra: 0.5,
      target: [fx + Math.cos(fyaw) * 12, 0, fz + Math.sin(fyaw) * 12], shadow: false, fixture: 'flood'
    });
  }

  // --- compound clutter ----------------------------------------------------
  b.prop('van', 6, 0, -20, { yaw: 0.15 });
  b.prop('car', -6, 0, -20, { yaw: -0.2 });
  b.prop('generator', 20, 0, 4, { yaw: -Math.PI / 2 });
  b.prop('fuel_drum', 21.4, 0, 6.2, {});
  b.prop('fuel_drum', 20.4, 0, 7.4, {});
  b.prop('sandbags', -4, 0, 8, { yaw: 0.1 });
  b.prop('sandbags', -2.4, 0, 8.3, { yaw: 0.35 });
  b.prop('sandbags', -0.8, 0, 8.1, { yaw: 0.05 });
  b.prop('crate_stack', 5, 0, 6, {});
  b.prop('crate_large', 7, 0, 5.2, { yaw: 0.6 });
  b.prop('dumpster', -20, 0, 2, { yaw: 1.6 });
  b.prop('tire_stack', 18, 0, -4, {});
  b.prop('barrier', -8, 0, -18, { yaw: 0.4 });

  // --- forest --------------------------------------------------------------
  for (let i = 0; i < 150; i++) {
    const a = rng() * Math.PI * 2;
    const r = 30 + rng() * 24;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.9;
    if (Math.abs(x) > 52 || Math.abs(z) > 46) continue;
    b.prop(rng() > 0.45 ? 'pine' : 'tree', x, 0, z, { yaw: rng() * 6.28, scale: 0.75 + rng() * 0.7 });
  }
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2, r = 26 + rng() * 26;
    b.prop(rng() > 0.5 ? 'bush' : 'rock', Math.cos(a) * r, 0, Math.sin(a) * r * 0.9,
      { yaw: rng() * 6.28, scale: 0.7 + rng() * 0.8, solid: rng() > 0.6 });
  }
  // outlying ruin gives the woods an objective
  b.room(-38, 26, 12, 10, 3.0, { doors: [{ side: 'e', at: 0.4 }, { side: 'n', at: 0.6 }], mat: C, floorMat: C, ceil: false, reverb: 'room' });
  b.prop('rubble', -38, 0, 26, { yaw: 0.5 });
  b.prop('debris_pile', -35, 0, 23, { yaw: 1.2 });
  b.light('point', -38, 2.4, 26, { color: 0x9fb8ff, intensity: 2.2, distance: 10, flicker: 0.8 });

  // --- spawns / sites ------------------------------------------------------
  b.spawn('alpha', 0, 0, -38, 0);
  b.spawn('alpha', -4, 0, -36, 0);
  b.spawn('alpha', 4, 0, -36, 0);
  b.spawn('alpha', 0, 0, -42, 0);
  b.spawn('bravo', 0, 0, 38, Math.PI);
  b.spawn('bravo', -4, 0, 36, Math.PI);
  b.spawn('bravo', 4, 0, 36, Math.PI);
  b.spawn('bravo', 0, 0, 42, Math.PI);
  b.spawn('ffa', -13, 0, -12, 1.0);
  b.spawn('ffa', 13, 0, -12, 2.4);
  b.spawn('ffa', -13, 0, 13, 0.2);
  b.spawn('ffa', 14, 0, 12, 3.4);
  b.spawn('ffa', 0, 6, 0, 0.8);
  b.spawn('ffa', -38, 0, 26, 1.4);

  b.site('A', -13, 0, -12, 3.2);
  b.site('B', 14, 0, 12, 3.2);

  b.ambient('crickets', 0, 2, 0, 90, 0.55);
  b.ambient('owl', -30, 6, 20, 50, 0.3);
  b.ambient('wind_trees', 0, 8, 0, 90, 0.5);
  b.ambient('electric_hum', 20, 1, 4, 10, 0.4);
  return b.build();
}
