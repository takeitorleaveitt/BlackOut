import { MapBuilder } from './kit.js';
import { SURFACE, mulberry32 } from '../constants.js';

/**
 * SUBLEVEL 3 — underground parking garage.
 * Two decks joined by a vehicle ramp. Pillars everywhere, strip lighting that
 * half works, and cars that stop bullets in the body but not through glass.
 */
export function buildGarage() {
  const rng = mulberry32(0x64246);
  const b = new MapBuilder({
    key: 'garage',
    name: 'Sublevel 3',
    subtitle: 'Underground Parking Structure',
    desc: 'Two decks of concrete and dead strip lights. Pillars break every angle; the ramp is a killzone.',
    size: [72, 60],
    compact: false,
    env: {
      sky: 'interior',
      sunDir: [0.2, 0.9, 0.3],
      sunColor: 0x9fb0c4, sunIntensity: 0.25,
      ambientColor: 0x1b2027, ambientIntensity: 0.42,
      hemiGround: 0x0d0f12,
      fog: { color: 0x14181e, near: 6, far: 58 },
      exposure: 1.28,
      reverb: 'garage',
      wind: 0, rain: 0, dustMotes: 0.9
    }
  });

  const C = SURFACE.CONCRETE, M = SURFACE.METAL;
  const W = 68, D = 56, H = 3.05;
  const L2 = 4.6;   // upper deck height

  // --- lower deck ----------------------------------------------------------
  b.floor(0, 0, W, D, 0, C, 0.8);
  b.wall(-34, -28, 34, -28, L2 + H, { mat: C, thick: 0.6 });
  b.wall(-34, 28, 34, 28, L2 + H, { mat: C, thick: 0.6 });
  b.wall(-34, -28, -34, 28, L2 + H, { mat: C, thick: 0.6 });
  b.wall(34, -28, 34, 28, L2 + H, { mat: C, thick: 0.6 });
  b.zone(0, H / 2, 0, W, H, D, 'garage');

  // --- upper deck slab, with a stairwell + ramp hole ------------------------
  // deck covers the west 2/3, leaving the east bay open to full height
  b.box(-14, L2 - 0.2, -16, 40, 0.4, 24, { mat: C });
  b.box(-14, L2 - 0.2, 14, 40, 0.4, 28, { mat: C });
  b.box(-30, L2 - 0.2, 0, 8, 0.4, 4, { mat: C });
  b.ceiling(0, 0, W, D, L2 + H, C, 0.5);
  b.zone(-14, L2 + H / 2, 0, 40, H, D, 'garage');

  // ramp connecting the decks (open slot between z -4..4 on the east of the slab)
  b.ramp(2, 0, 0, 7.0, 22, L2, 'z', C, 14);
  b.wall(-1.6, -11, -1.6, 11, 1.0, { y: L2 - 0.2, mat: C, thick: 0.25 });
  b.wall(5.6, -11, 5.6, 11, 1.0, { y: L2 - 0.2, mat: C, thick: 0.25 });

  // stairwell (enclosed, links both decks)
  b.room(-30, -22, 7, 8, L2 + H, { doors: [{ side: 'e', at: 0.6 }], mat: C, floorMat: C, ceil: false, reverb: 'stair' });
  b.stairs(-32.6, 0.02, -25, 2.6, 'z', 14, L2 - 0.02, 5.6, C);
  b.wallDoor(-33.5, -18, -26.5, -18, H, 0.5, 1.2, { y: L2, mat: C, thick: 0.25 });
  b.light('point', -30, L2 + 2.4, -22, { color: 0xd6e4ff, intensity: 4, distance: 10, flicker: 0.55 });
  b.light('point', -30, 2.4, -22, { color: 0xd6e4ff, intensity: 3, distance: 9, flicker: 0.2 });

  // --- pillars -------------------------------------------------------------
  for (let ix = -3; ix <= 3; ix++) {
    for (let iz = -2; iz <= 2; iz++) {
      const x = ix * 9.5, z = iz * 11;
      if (Math.abs(x - 2) < 5 && Math.abs(z) < 12) continue;   // keep the ramp clear
      b.box(x, (L2 + H) / 2, z, 0.9, L2 + H, 0.9, { mat: C });
      if (ix % 2 === 0 && iz % 2 === 0) {
        b.light('point', x, H - 0.25, z + 3, { color: 0xbfe0ff, intensity: 7.5, distance: 12, flicker: (ix + iz) % 3 === 0 ? 0.7 : 0.05 });
      }
      if (x < 14) b.light('point', x, L2 + H - 0.25, z + 3, { color: 0xcfe6ff, intensity: 7.0, distance: 12, flicker: (ix * iz) % 4 === 0 ? 0.8 : 0 });
    }
  }

  // --- strip lighting ------------------------------------------------------
  // Independent of the pillar grid so the middle of the deck (and the ramp
  // mouth) is never a completely unlit hole.
  for (let iz = -2; iz <= 2; iz++) {
    for (let ix = -1; ix <= 1; ix++) {
      const x = ix * 16, z = iz * 11 + 5.5;
      b.box(x, H - 0.08, z, 2.6, 0.08, 0.3, { mat: SURFACE.GLASS, solid: false, opaque: false });
      b.light('point', x, H - 0.3, z, {
        color: 0xcfe2ff, intensity: 9, distance: 18, fixture: 'strip',
        flicker: (ix + iz) % 4 === 0 ? 0.6 : 0.04
      });
      if (x < 8) {
        b.light('point', x, L2 + H - 0.3, z, {
          color: 0xd8e8ff, intensity: 8, distance: 17, fixture: 'strip',
          flicker: (ix * 2 + iz) % 5 === 0 ? 0.75 : 0.03
        });
      }
    }
  }

  // --- parked cars ---------------------------------------------------------
  const carRow = (z, y, x0, x1, n, yaw) => {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      if (rng() > 0.78) continue;   // empty bays
      b.prop(rng() > 0.85 ? 'van' : 'car', x0 + (x1 - x0) * t, y, z, { yaw: yaw + (rng() - 0.5) * 0.06 });
    }
  };
  carRow(-22, 0, -28, 28, 8, 0);
  carRow(-9, 0, -28, -6, 4, 0);
  carRow(9, 0, -28, -6, 4, Math.PI);
  carRow(22, 0, -28, 28, 8, Math.PI);
  carRow(-22, L2, -30, -4, 5, 0);
  carRow(22, L2, -30, -4, 5, Math.PI);
  carRow(9, L2, -30, -8, 4, Math.PI);

  // bay markings and clutter
  b.prop('jersey', 14, 0, -6, { yaw: 0 });
  b.prop('jersey', 14, 0, 6, { yaw: 0 });
  b.prop('cone', 8, 0, -12, { solid: false });
  b.prop('cone', 9.4, 0, -13.2, { solid: false });
  b.prop('dumpster', 30, 0, 24, { yaw: Math.PI / 2 });
  b.prop('dumpster', 30, 0, -24, { yaw: Math.PI / 2 });
  b.prop('barrier', 24, 0, 0, { yaw: Math.PI / 2 });
  b.prop('crate_wood', 26, 0, 2, { yaw: 0.4 });
  b.prop('debris_pile', -20, L2, 24, { yaw: 0.9 });
  b.prop('rubble', 18, 0, -26, { yaw: 1.4 });
  b.prop('toolbox', -26, L2, -6, { yaw: 0.2 });
  b.prop('generator', -32, 0, 20, { yaw: -Math.PI / 2 });
  b.prop('vent', 30, L2, 12, {});

  // maintenance room + attendant booth (interior pockets)
  b.room(28, 18, 10, 10, H, { doors: [{ side: 'w', at: 0.5 }], mat: C, ceil: true, reverb: 'room' });
  b.light('point', 28, H - 0.3, 18, { color: 0xffe0a0, intensity: 4, distance: 10 });
  b.prop('shelf_rack', 31, 0, 18, { yaw: Math.PI / 2 });
  b.prop('barrel', 25, 0, 21, {});
  b.room(-30, 12, 6, 6, H, { doors: [{ side: 'e', at: 0.5 }], windows: [{ side: 's', at: 0.5, gap: 3, sill: 1.0, top: 2.2 }], mat: C, ceil: true, reverb: 'room' });
  b.prop('desk', -31, 0, 12, { yaw: Math.PI / 2 });
  b.light('point', -30, H - 0.3, 12, { color: 0xfff2c0, intensity: 3, distance: 8, flicker: 0.25 });

  // vehicle entrance ramp to the surface — the only daylight in the map
  b.box(31, L2 + H + 0.4, 26, 8, 0.4, 8, { mat: C, solid: false, opaque: false });
  b.light('point', 31, L2 + 1.5, 26, { color: 0x9dc8ff, intensity: 8, distance: 20 });

  // --- spawns / sites ------------------------------------------------------
  b.spawn('alpha', -30, 0, -24, 0.4);
  b.spawn('alpha', -26, 0, -20, 0.4);
  b.spawn('alpha', -30, 0, -16, 0.4);
  b.spawn('alpha', -22, 0, -24, 0.4);
  b.spawn('bravo', 30, 0, 22, -2.6);
  b.spawn('bravo', 26, 0, 18, -2.6);
  b.spawn('bravo', 30, 0, 14, -2.6);
  b.spawn('bravo', 22, 0, 24, -2.6);
  b.spawn('ffa', 0, 0, 0, 0);
  b.spawn('ffa', -20, L2, 0, 1.2);
  b.spawn('ffa', 20, 0, -10, 2.8);
  b.spawn('ffa', -28, L2, 20, 0.5);
  b.spawn('ffa', 10, 0, 20, 3.1);
  b.spawn('ffa', -10, 0, -20, 0.2);

  b.site('A', -20, 0, 18, 3.4);
  b.site('B', 20, 0, -18, 3.4);

  b.ambient('electric_hum', 0, 2.5, 0, 40, 0.55);
  b.ambient('dripping', -18, 2, 8, 12, 0.6);
  b.ambient('dripping', 16, 2, -14, 12, 0.5);
  b.ambient('vent_rumble', 30, 4, 12, 20, 0.45);
  return b.build();
}
