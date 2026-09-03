import { MapBuilder } from './kit.js';
import { SURFACE, mulberry32 } from '../constants.js';

/**
 * WILLOW LANE — a two-storey suburban house at dusk.
 * Tight interior CQB: hallways, a staircase choke, a garage flank and a
 * back garden that lets you rotate around the whole building.
 */
export function buildSuburb() {
  const rng = mulberry32(0x51B12);
  const b = new MapBuilder({
    key: 'suburb',
    name: 'Willow Lane',
    subtitle: 'Suburban Residence — Dusk',
    desc: 'A family home turned killhouse. Two floors, a garage flank and a garden that never lets you settle.',
    size: [62, 62],
    compact: false,
    env: {
      sky: 'dusk',
      sunDir: [0.75, 0.16, -0.4],
      sunColor: 0xff9d5c, sunIntensity: 1.35,
      ambientColor: 0x3a4560, ambientIntensity: 0.5,
      hemiGround: 0x241f1b,
      fog: { color: 0x6a5a63, near: 18, far: 96 },
      exposure: 1.05,
      reverb: 'outdoor',
      wind: 0.3, rain: 0.0, dustMotes: 0.4
    }
  });

  const WALL = { mat: SURFACE.PLASTER, thick: 0.22 };
  const H = 2.75;          // storey height
  const F2 = 3.05;         // first floor level

  // --- terrain -------------------------------------------------------------
  b.floor(0, 0, 62, 62, 0, SURFACE.GRASS, 0.6);
  b.floor(0, -24, 62, 12, 0.02, SURFACE.CONCRETE, 0.12);   // street
  b.floor(-2, -14, 10, 10, 0.03, SURFACE.CONCRETE, 0.1);   // driveway
  b.floor(0, 14, 26, 8, 0.03, SURFACE.WOOD, 0.1);          // patio decking

  // --- ground floor --------------------------------------------------------
  // exterior shell 20 x 16
  b.floor(0, 0, 20, 16, 0.05, SURFACE.WOOD, 0.3);
  b.wallDoor(-10, -8, 10, -8, H, 0.62, 1.15, { mat: SURFACE.PLASTER, thick: 0.3 });   // front door
  b.wallWindow(-10, -8, 10, -8, H, { mat: SURFACE.PLASTER, thick: 0.3, at: 0.25, gap: 2.2 });
  b.wallWindow(-10, 8, 10, 8, H, { mat: SURFACE.PLASTER, thick: 0.3, at: 0.3, gap: 2.6 });
  b.wallDoor(-10, 8, 10, 8, H, 0.75, 1.3, { mat: SURFACE.PLASTER, thick: 0.3 });      // back door
  b.wallWindow(-10, -8, -10, 8, H, { mat: SURFACE.PLASTER, thick: 0.3, at: 0.4, gap: 2.0 });
  b.wall(10, -8, 10, 8, H, { mat: SURFACE.PLASTER, thick: 0.3 });
  b.ceiling(0, 0, 20.6, 16.6, H, SURFACE.PLASTER, 0.3);
  b.zone(0, H / 2, 0, 20, H, 16, 'house');

  // interior partitions: living | hall | kitchen  /  dining
  b.wallDoor(-1.5, -8, -1.5, 2, H, 0.55, 1.1, WALL);      // living <-> hall
  b.wallDoor(-1.5, 2, -1.5, 8, H, 0.5, 1.1, WALL);
  b.wallDoor(4.5, -8, 4.5, 1, H, 0.6, 1.15, WALL);        // hall <-> kitchen
  b.wall(4.5, 1, 4.5, 8, H, WALL);
  b.wallDoor(4.5, 1, 10, 1, H, 0.45, 1.2, WALL);
  b.light('point', -5.5, H - 0.35, -3, { color: 0xffd9a8, intensity: 4.5, distance: 10, shadow: true });
  b.light('point', 7.2, H - 0.35, 4.5, { color: 0xfff2d4, intensity: 3.6, distance: 9 });
  b.light('point', 1.5, H - 0.35, 5, { color: 0xffe0b0, intensity: 2.4, distance: 7, flicker: 0.15 });

  // living room
  b.prop('sofa', -6, 0.05, -5.4, { yaw: 0 });
  b.prop('sofa', -8.6, 0.05, -1.5, { yaw: Math.PI / 2 });
  b.prop('table', -6, 0.05, -2.6, { yaw: 0, scale: 0.8 });
  b.prop('tv', -6, 1.1, 1.6, { yaw: Math.PI, solid: false });
  b.prop('bookshelf', -9.1, 0.05, 3.4, { yaw: Math.PI / 2 });
  b.prop('plant', -3, 0.05, 6.4, { solid: false });
  b.prop('lamp', -9, 0.05, -6.8, { solid: false });

  // kitchen
  b.prop('counter', 7.4, 0.05, -5.6, { yaw: 0 });
  b.prop('counter', 9.2, 0.05, -3.2, { yaw: Math.PI / 2 });
  b.prop('fridge', 5.6, 0.05, -6.8, { yaw: 0 });
  b.prop('table', 7.2, 0.05, 4.4, { yaw: 0.1 });
  b.prop('chair', 7.2, 0.05, 5.6, { yaw: 0.2 });
  b.prop('chair', 7.2, 0.05, 3.2, { yaw: 3.3 });

  // hall + stairs (up along +z, landing at the back)
  b.stairs(1.5, 0.05, -6.5, 2.6, 'z', 14, F2 - 0.05, 4.6, SURFACE.WOOD);
  b.box(1.5, F2 - 0.15, -0.4, 2.6, 0.3, 4.0, { mat: SURFACE.WOOD });
  b.wall(0.2, -6.5, 0.2, 1.6, 1.0, { y: F2 - 0.1, mat: SURFACE.WOOD, thick: 0.08, opaque: false });
  b.prop('cabinet', 3.6, 0.05, -7.2, { yaw: Math.PI });

  // --- first floor ---------------------------------------------------------
  b.floor(0, 0, 20, 16, F2, SURFACE.CARPET, 0.3);
  // stairwell hole
  b.brushes.pop();
  b.box(-5.2, F2 - 0.15, 0, 9.6, 0.3, 16, { mat: SURFACE.CARPET });
  b.box(5.2, F2 - 0.15, 0, 9.6, 0.3, 16, { mat: SURFACE.CARPET });
  b.box(0, F2 - 0.15, 5.6, 1.0, 0.3, 4.8, { mat: SURFACE.CARPET });
  b.box(0, F2 - 0.15, -6.6, 1.0, 0.3, 2.8, { mat: SURFACE.CARPET });

  b.wall(-10, -8, 10, -8, H, { y: F2, mat: SURFACE.PLASTER, thick: 0.3 });
  b.wallWindow(-10, -8, 10, -8, H, { y: F2, mat: SURFACE.PLASTER, thick: 0.3, at: 0.3, gap: 2.0 });
  b.wallWindow(-10, 8, 10, 8, H, { y: F2, mat: SURFACE.PLASTER, thick: 0.3, at: 0.65, gap: 2.4 });
  b.wall(-10, -8, -10, 8, H, { y: F2, mat: SURFACE.PLASTER, thick: 0.3 });
  b.wall(10, -8, 10, 8, H, { y: F2, mat: SURFACE.PLASTER, thick: 0.3 });
  b.ceiling(0, 0, 20.6, 16.6, F2 + H, SURFACE.PLASTER, 0.35);
  b.zone(0, F2 + H / 2, 0, 20, H, 16, 'house');

  // bedrooms
  b.wallDoor(-3.4, -8, -3.4, 8, H, 0.32, 1.0, { ...WALL, y: F2 });
  b.wallDoor(3.4, -8, 3.4, 8, H, 0.30, 1.0, { ...WALL, y: F2 });
  b.wallDoor(-10, 1.5, -3.4, 1.5, H, 0.55, 1.0, { ...WALL, y: F2 });
  b.prop('bed', -7.4, F2, -4.6, { yaw: 0 });
  b.prop('wardrobe', -9.0, F2, 0.2, { yaw: Math.PI / 2 });
  b.prop('bed', -6.6, F2, 5.4, { yaw: 0.1, scale: 0.85 });
  b.prop('desk', 6.8, F2, -6.2, { yaw: Math.PI });
  b.prop('office_chair', 6.8, F2, -5.0, {});
  b.prop('monitor', 6.8, F2 + 0.74, -6.6, { yaw: Math.PI, solid: false });
  b.prop('wardrobe', 8.8, F2, 3.4, { yaw: -Math.PI / 2 });
  b.prop('bed', 6.4, F2, 5.0, { yaw: 0 });
  b.light('point', -6.5, F2 + H - 0.3, -3, { color: 0xffd0a0, intensity: 3.2, distance: 8 });
  b.light('point', 6.5, F2 + H - 0.3, 2, { color: 0xbfd4ff, intensity: 2.6, distance: 8, flicker: 0.6 });

  // --- garage --------------------------------------------------------------
  b.room(-16, -2, 10, 12, 2.9, {
    doors: [{ side: 'e', at: 0.28 }],
    mat: SURFACE.CONCRETE, floorMat: SURFACE.CONCRETE, ceil: true, reverb: 'garage'
  });
  b.wallDoor(-21, -8, -11, -8, 2.9, 0.5, 4.2, { mat: SURFACE.METAL, thick: 0.2, doorH: 2.4 });
  b.prop('car', -16, 0.05, -2.5, { yaw: 0.02 });
  b.prop('shelf_rack', -20, 0.05, 2.4, { yaw: 0 });
  b.prop('toolbox', -13.2, 0.05, 2.6, { yaw: 0.3 });
  b.prop('barrel', -19.6, 0.05, -6.2, {});
  b.light('point', -16, 2.6, -2, { color: 0xe8f0ff, intensity: 4, distance: 12, flicker: 0.45 });

  // --- garden / street -----------------------------------------------------
  b.wall(-30, -18, -30, 26, 2.3, { mat: SURFACE.WOOD });
  b.wall(30, -18, 30, 26, 2.3, { mat: SURFACE.WOOD });
  b.wall(-30, 26, 30, 26, 2.3, { mat: SURFACE.WOOD });
  b.propLine('tree', -26, 22, 26, 22, 6, 0, {});
  b.prop('bush', -12, 0, 12, { solid: false });
  b.prop('bush', 12, 0, 11, { solid: false });
  b.prop('bush', -14, 0, -10, { solid: false });
  b.prop('table', 3, 0, 14, { yaw: 0.2 });
  b.prop('chair', 3, 0, 15.4, { yaw: 0.4 });
  b.prop('rock', -20, 0, 16, { yaw: 0.8 });
  b.prop('rock', 21, 0, 6, { yaw: 2.1 });
  b.prop('car', -2, 0, -14, { yaw: 0.02 });
  b.prop('car', 16, 0, -22, { yaw: Math.PI / 2 });
  b.prop('dumpster', -24, 0, -22, { yaw: 0.2 });
  b.propLine('streetlight', -22, -26, 22, -26, 3, 0, {});
  for (let i = 0; i < 3; i++) b.light('point', -22 + i * 22, 6.2, -26, { color: 0xffc178, intensity: 8, distance: 24, fixture: 'street' });
  b.prop('fence_panel', 24, 0, 14, { yaw: 0 });
  b.prop('fence_panel', 27, 0, 14, { yaw: 0 });
  for (let i = 0; i < 7; i++) {
    b.prop(rng() > 0.5 ? 'bush' : 'plant', -28 + rng() * 56, 0, 4 + rng() * 20, { solid: false, scale: 0.8 + rng() * 0.6 });
  }

  // shed — second interior in the garden
  b.room(20, 16, 6, 6, 2.6, { doors: [{ side: 'w', at: 0.5 }], mat: SURFACE.WOOD, floorMat: SURFACE.WOOD, ceil: true, reverb: 'room' });
  b.prop('shelf_rack', 22, 0, 16, { yaw: Math.PI / 2, scale: 0.8 });

  // --- spawns / sites ------------------------------------------------------
  b.spawn('alpha', -2, 0, -22, 0);
  b.spawn('alpha', -6, 0, -21, 0);
  b.spawn('alpha', 3, 0, -23, 0);
  b.spawn('alpha', -24, 0, -18, 0.6);
  b.spawn('bravo', 0, 0, 21, Math.PI);
  b.spawn('bravo', -6, 0, 20, Math.PI);
  b.spawn('bravo', 8, 0, 22, Math.PI);
  b.spawn('bravo', 20, 0, 19, Math.PI);
  b.spawn('ffa', -16, 0, -2, 1.6);
  b.spawn('ffa', -7, F2, -4, 0.4);
  b.spawn('ffa', 7, F2, 4, 3.0);
  b.spawn('ffa', 22, 0, 2, -1.2);
  b.spawn('ffa', -22, 0, 12, 0.8);
  b.spawn('ffa', 6, 0, -4, 2.4);

  b.site('A', -6, 0, -4, 3.0);
  b.site('B', 7, 0, 4.5, 3.0);

  b.ambient('crickets', 0, 2, 12, 40, 0.4);
  b.ambient('wind', 0, 6, 0, 60, 0.22);
  b.ambient('tv_static', -6, 1.2, 1.6, 7, 0.35);
  return b.build();
}
