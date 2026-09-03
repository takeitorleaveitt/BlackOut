import { MapBuilder } from './kit.js';
import { SURFACE, mulberry32 } from '../constants.js';

/**
 * DISTRICT 9 — abandoned distribution warehouse.
 * A tall racking hall with a mezzanine and offices, wrapped by a loading yard.
 * Long sightlines down the aisles, brutal close quarters between the racks.
 */
export function buildWarehouse() {
  const rng = mulberry32(0x5EA71);
  const b = new MapBuilder({
    key: 'warehouse',
    name: 'District 9',
    subtitle: 'Abandoned Distribution Warehouse',
    desc: 'Racking aisles, a rusted mezzanine and a loading yard. Fight for the catwalk or die in the lanes.',
    size: [86, 70],
    compact: false,
    env: {
      sky: 'overcast',
      sunDir: [-0.35, 0.72, 0.6],
      sunColor: 0xbcc4cc, sunIntensity: 1.5,
      ambientColor: 0x5a6470, ambientIntensity: 0.55,
      hemiGround: 0x2e2b28,
      fog: { color: 0x8e959c, near: 24, far: 132 },
      exposure: 1.0,
      reverb: 'outdoor',
      wind: 0.5, rain: 0.0,
      dustMotes: 1.0
    }
  });

  const HALL_W = 46, HALL_D = 42, HALL_H = 9.5;
  const hx = 0, hz = 0;

  // --- yard ground ---------------------------------------------------------
  b.floor(0, 0, 86, 70, 0, SURFACE.CONCRETE, 0.6);
  b.floor(0, -30, 86, 12, 0.02, SURFACE.GRAVEL, 0.1);

  // --- main hall shell -----------------------------------------------------
  b.floor(hx, hz, HALL_W, HALL_D, 0.05, SURFACE.CONCRETE, 0.3);
  b.ceiling(hx, hz, HALL_W + 1, HALL_D + 1, HALL_H, SURFACE.METAL, 0.5);
  // north wall with the big roller door
  b.wallDoor(-23, -21, 23, -21, HALL_H, 0.5, 6.5, { mat: SURFACE.METAL, thick: 0.4, doorH: 5.0 });
  // south wall, personnel door + windows
  b.wallDoor(-23, 21, 23, 21, HALL_H, 0.28, 1.6, { mat: SURFACE.METAL, thick: 0.4 });
  b.wallWindow(-23, 21, 23, 21, HALL_H, { mat: SURFACE.METAL, thick: 0.4, at: 0.72, gap: 5, sill: 5.5, top: 7.6 });
  // west / east
  b.wallDoor(-23, -21, -23, 21, HALL_H, 0.5, 3.2, { mat: SURFACE.METAL, thick: 0.4, doorH: 3.6 });
  b.wall(23, -21, 23, 21, HALL_H, { mat: SURFACE.METAL, thick: 0.4 });
  b.zone(hx, HALL_H / 2, hz, HALL_W, HALL_H, HALL_D, 'hall');

  // --- racking aisles ------------------------------------------------------
  for (let row = 0; row < 4; row++) {
    const x = -15 + row * 10;
    for (let i = 0; i < 5; i++) {
      const z = -16 + i * 8;
      b.prop('shelf_rack', x, 0.05, z, { yaw: Math.PI / 2 });
      if (rng() > 0.35) b.prop('crate_wood', x + (rng() - 0.5) * 0.6, 2.45, z + (rng() - 0.5) * 2, { yaw: rng() * 3 });
      if (rng() > 0.6) b.prop('pallet', x, 0.05, z + 2.6, { yaw: rng() * 3 });
    }
    // upper shelf deck players can shoot through the gaps of
    b.box(x, 2.42, 0, 2.6, 0.12, 38, { mat: SURFACE.METAL });
  }

  // --- mezzanine + offices -------------------------------------------------
  const MZ_Y = 4.2;
  b.box(14, MZ_Y - 0.15, 0, 18, 0.3, 40, { mat: SURFACE.METAL });          // deck
  b.wall(5, -20, 5, 20, 1.05, { y: MZ_Y, mat: SURFACE.METAL, thick: 0.12, opaque: false }); // railing
  b.stairs(9.4, 0.05, -18.5, 3.2, 'z', 14, MZ_Y - 0.05, 7.0, SURFACE.METAL);
  b.wall(7.8, -18.5, 7.8, -11.5, 1.0, { y: 2.2, mat: SURFACE.METAL, thick: 0.1, opaque: false });

  // office block on the mezzanine
  b.room(16, -12, 9, 8, 2.9, {
    y: MZ_Y, doors: [{ side: 'w', at: 0.6 }], windows: [{ side: 's', at: 0.5, gap: 4, sill: 1.0, top: 2.4 }],
    mat: SURFACE.PLASTER, floorMat: SURFACE.CARPET, floor: false, ceil: true, reverb: 'office'
  });
  b.prop('desk', 18, MZ_Y, -14, { yaw: 0.2 });
  b.prop('office_chair', 18, MZ_Y, -13, { yaw: 2.6 });
  b.prop('monitor', 18, MZ_Y + 0.74, -14.2, { yaw: 0.2, solid: false });
  b.prop('cabinet', 19.6, MZ_Y, -9.2, { yaw: Math.PI });
  b.prop('locker', 13.2, MZ_Y, -9.4, { yaw: Math.PI });

  // ground floor office / break room
  b.room(-16, 14, 12, 10, 3.4, {
    doors: [{ side: 'e', at: 0.35 }, { side: 'n', at: 0.7 }],
    windows: [{ side: 'n', at: 0.25, gap: 2.4 }],
    mat: SURFACE.PLASTER, floorMat: SURFACE.TILE, floor: false, ceil: true, reverb: 'office'
  });
  b.prop('table', -18, 0.05, 15, { yaw: 0.1 });
  b.prop('chair', -18, 0.05, 16.2, { yaw: 0.3 });
  b.prop('chair', -19.4, 0.05, 14.6, { yaw: 1.8 });
  b.prop('fridge', -20.4, 0.05, 11.2, { yaw: 0 });
  b.prop('counter', -13.5, 0.05, 11.0, { yaw: 0 });
  b.light('point', -16, 3.0, 14, { color: 0xd8e2ff, intensity: 5, distance: 12, flicker: 0.35 });

  // --- clutter -------------------------------------------------------------
  b.prop('crate_stack', -20, 0.05, -16, {});
  b.prop('crate_large', -20.5, 0.05, -13, { yaw: 0.4 });
  b.prop('crate_wood', -19.2, 1.45, -13.2, { yaw: 1.1 });
  b.prop('barrel', -21, 0.05, -8, {});
  b.prop('barrel', -21.6, 0.05, -9.1, {});
  b.prop('fuel_drum', -20.2, 0.05, -9.4, {});
  b.prop('toolbox', -18, 0.05, -6, { yaw: 0.7 });
  b.prop('generator', 20, 0.05, 16, { yaw: -Math.PI / 2 });
  b.prop('pallet', 0, 0.05, 19, { yaw: 0.2 });
  b.prop('pallet', 1.4, 0.05, 18.6, { yaw: 1.1 });
  b.prop('debris_pile', -6, 0.05, -18, { yaw: 0.9 });
  b.prop('tire_stack', 6, 0.05, -18.5, {});
  b.prop('van', -14, 0.05, -6, { yaw: 0.06 });

  // roof girders + hanging lamps
  for (let i = -3; i <= 3; i++) {
    b.box(0, HALL_H - 0.6, i * 6, 46, 0.3, 0.35, { mat: SURFACE.METAL });
    b.light('point', i * 6 > 0 ? 8 : -8, HALL_H - 1.4, i * 6, {
      color: 0xfff0d0, intensity: 24, distance: 22, shadow: i === 0, flicker: i === 2 ? 0.5 : 0, fixture: 'hilo'
    });
  }

  // roof lights + a run of skylights above the aisles
  for (let i = -2; i <= 2; i++) {
    b.box(i * 9, HALL_H - 0.15, 0, 3.0, 0.12, 30, { mat: SURFACE.GLASS, solid: false, opaque: false });
    if (i % 2 === 0) b.light('point', i * 9, HALL_H - 1.2, 0, { color: 0xd8e6f4, intensity: 18, distance: 28 });
  }

  // --- yard ----------------------------------------------------------------
  b.wall(-43, -35, 43, -35, 3.4, { mat: SURFACE.METAL });
  b.wall(-43, 35, 43, 35, 3.4, { mat: SURFACE.METAL });
  b.wall(-43, -35, -43, 35, 3.4, { mat: SURFACE.METAL });
  b.wall(43, -35, 43, 35, 3.4, { mat: SURFACE.METAL });
  // loading dock
  b.box(0, 0.6, -24.5, 30, 1.2, 5, { mat: SURFACE.CONCRETE });
  b.prop('pallet', -8, 1.25, -24, { yaw: 0.1 });
  b.prop('crate_metal', 8, 1.25, -24.6, { yaw: 0.3 });
  b.prop('dumpster', 17, 0, -26, { yaw: 0.15 });
  b.prop('car', -26, 0, -26, { yaw: 0.7 });
  b.prop('car', -30, 0, -20, { yaw: -0.4 });
  b.prop('van', 28, 0, 24, { yaw: 1.6 });
  b.propLine('jersey', -34, 8, -34, 24, 5, 0, { yaw: Math.PI / 2 });
  b.propLine('streetlight', -34, -28, 34, -28, 4, 0, {});
  for (let i = 0; i < 4; i++) {
    b.light('point', -34 + i * 22.6, 6.2, -28, { color: 0xffd9a0, intensity: 9, distance: 26, fixture: 'street' });
  }
  b.prop('fence_panel', 0, 0, 33, { yaw: 0 });
  b.prop('sandbags', 12, 0, 27, { yaw: 0.4 });
  b.prop('sandbags', 13.6, 0, 27.4, { yaw: 0.6 });
  b.prop('rubble', -20, 0, 28, { yaw: 1.2 });

  // outbuilding, gives the yard a second interior
  b.room(-28, 20, 11, 9, 3.2, {
    doors: [{ side: 'e', at: 0.5 }], windows: [{ side: 'n', at: 0.5, gap: 2 }],
    mat: SURFACE.CONCRETE, floorMat: SURFACE.CONCRETE, ceil: true, reverb: 'room'
  });
  b.light('point', -28, 2.8, 20, { color: 0xfff0cc, intensity: 5, distance: 11, flicker: 0.2 });
  b.prop('shelf_rack', -31.5, 0, 20, { yaw: Math.PI / 2 });
  b.prop('barrel', -25.5, 0, 22.5, {});

  // --- spawns / sites ------------------------------------------------------
  b.spawn('alpha', -34, 0, -14, Math.PI / 2);
  b.spawn('alpha', -36, 0, -8, Math.PI / 2);
  b.spawn('alpha', -32, 0, -20, Math.PI / 2);
  b.spawn('alpha', -38, 0, -2, Math.PI / 2);
  b.spawn('bravo', 34, 0, 14, -Math.PI / 2);
  b.spawn('bravo', 36, 0, 8, -Math.PI / 2);
  b.spawn('bravo', 32, 0, 20, -Math.PI / 2);
  b.spawn('bravo', 38, 0, 2, -Math.PI / 2);
  b.spawn('ffa', 0, 0, 0, 0);
  b.spawn('ffa', -18, 0, 0, 1.2);
  b.spawn('ffa', 16, 4.2, 6, 3.0);
  b.spawn('ffa', 0, 0, 28, Math.PI);
  b.spawn('ffa', -28, 0, 20, 0.4);
  b.spawn('ffa', 20, 0, -26, 2.2);

  b.site('A', -16, 0, -12, 3.4);
  b.site('B', 16, 0, 14, 3.4);

  b.ambient('wind', 0, 8, 0, 60, 0.35);
  b.ambient('metal_creak', 0, 8, 0, 40, 0.5);
  b.ambient('electric_hum', 8, 8, 0, 18, 0.4);
  b.ambient('dripping', -16, 1, 14, 10, 0.5);
  return b.build();
}
