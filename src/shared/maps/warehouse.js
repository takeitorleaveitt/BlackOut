import { MapBuilder } from './kit.js';
import { SURFACE } from '../constants.js';

/**
 * DISTRICT 9 — abandoned distribution warehouse.
 *
 * Same idea it always had: a racking hall with a mezzanine and offices,
 * wrapped by a loading yard. What it did not have was a shape. The hall was a
 * regular four-by-five grid of shelving with props scattered over it, and the
 * yard was a big empty rectangle with a dumpster and some cars dropped in it —
 * so every fight happened wherever two people happened to collide, and nothing
 * on the map told you where to go or where someone would be coming from.
 *
 * It is laid out on purpose now. Three routes run the length of the map, west
 * to east, between the two spawns:
 *
 *   NORTH   the loading apron — outdoors, containers and trailers for hard
 *           cover, and the dock doors back into the hall
 *   MIDDLE  the main aisle — the long one, racking down both sides, the
 *           sightline that decides most rounds
 *   SOUTH   the office row — three connected interiors with windows onto the
 *           hall, the flank you take when the middle is held
 *
 * Four cross-corridors tie them together (west, mid-west, mid-east, east), so
 * a route is a choice rather than a commitment, and the mid one is the middle
 * of the map in every sense. Over the top of the south side runs the mezzanine
 * — stairs at BOTH ends, because a catwalk with one way up is a trap, not a
 * position.
 *
 * Cover is placed at the mouths of the cross-corridors and at the midpoint of
 * each lane: the places where you are about to be shot at, rather than
 * wherever a random number generator put a barrel.
 */
export function buildWarehouse() {
  const b = new MapBuilder({
    key: 'warehouse',
    name: 'District 9',
    subtitle: 'Abandoned Distribution Warehouse',
    desc: 'Three routes from end to end: the apron, the main aisle, the offices. Take the mezzanine and you hold the middle.',
    size: [86, 70],
    compact: false,
    env: {
      sky: 'overcast',
      sunDir: [-0.35, 0.72, 0.6],
      sunColor: 0xd4dce4, sunIntensity: 4.0,
      ambientColor: 0xa8b4c2, ambientIntensity: 2.5,
      hemiGround: 0x605a50,
      fog: { color: 0xa8afb6, near: 60, far: 220 },
      exposure: 1.45,
      reverb: 'outdoor',
      wind: 0.5, rain: 0.0,
      dustMotes: 0.0
    }
  });

  // --- the grid the whole map is laid out on -------------------------------
  // Everything below is placed against these, so the lanes stay parallel and
  // the cross-corridors actually line up with the gaps in the racking.
  const HALL_W = 60, HALL_H = 9.5;
  const HALL_X0 = -30, HALL_X1 = 30;          // hall runs west-east
  const Z_DOCK = -15;                          // north lane, inside
  const Z_MAIN = -3;                           // main aisle
  const Z_RACK = 6;                            // second aisle
  const Z_OFFICE = 16;                         // office row centre
  const HALL_Z0 = -22, HALL_Z1 = 22;
  const CROSS = [-20, -7, 7, 20];              // cross-corridor centres
  const MZ_Y = 4.2;

  // --- ground --------------------------------------------------------------
  b.floor(0, 0, 86, 70, 0, SURFACE.CONCRETE, 0.6);
  b.floor(0, -28, 86, 14, 0.02, SURFACE.GRAVEL, 0.1);   // the apron
  b.floor(0, 29, 86, 12, 0.02, SURFACE.GRAVEL, 0.1);    // south alley

  // --- hall shell ----------------------------------------------------------
  b.floor(0, 0, HALL_W, 44, 0.05, SURFACE.CONCRETE, 0.3);
  b.ceiling(0, 0, HALL_W + 1, 45, HALL_H, SURFACE.METAL, 0.5);
  b.zone(0, HALL_H / 2, 0, HALL_W, HALL_H, 44, 'hall');

  // North wall: three roller doors, one per cross-corridor that reaches it.
  // Standing on the apron you can see, and be seen from, exactly three places.
  b.wallOpenings(HALL_X0, HALL_Z0, HALL_X1, HALL_Z0, HALL_H,
    [-20, 0, 20].map((x) => ({ at: (x - HALL_X0) / HALL_W, gap: 6.0, kind: 'door', doorH: 5.0 })),
    { mat: SURFACE.METAL, thick: 0.4 });

  // South wall: two personnel doors into the alley, and a window band high up
  // that lets the alley be lit without being a firing position into the hall.
  b.wallOpenings(HALL_X0, HALL_Z1, HALL_X1, HALL_Z1, HALL_H,
    [{ at: 0.18, gap: 1.6, kind: 'door' }, { at: 0.82, gap: 1.6, kind: 'door' }],
    { mat: SURFACE.METAL, thick: 0.4 });
  b.wallWindow(HALL_X0, HALL_Z1, HALL_X1, HALL_Z1, HALL_H,
    { mat: SURFACE.METAL, thick: 0.4, at: 0.5, gap: 10, sill: 6.0, top: 8.0 });

  // West and east ends: the spawn rooms open straight into the hall through a
  // wide mouth, so nobody starts a round staring at a wall.
  b.wallOpenings(HALL_X0, HALL_Z0, HALL_X0, HALL_Z1, HALL_H,
    [{ at: 0.30, gap: 4.5, kind: 'door', doorH: 3.6 }, { at: 0.72, gap: 3.0, kind: 'door', doorH: 3.0 }],
    { mat: SURFACE.METAL, thick: 0.4 });
  b.wallOpenings(HALL_X1, HALL_Z0, HALL_X1, HALL_Z1, HALL_H,
    [{ at: 0.30, gap: 4.5, kind: 'door', doorH: 3.6 }, { at: 0.72, gap: 3.0, kind: 'door', doorH: 3.0 }],
    { mat: SURFACE.METAL, thick: 0.4 });

  // --- the loading dock ----------------------------------------------------
  // A raised platform along the north wall, inside. It overlooks the dock lane
  // and the mouths of the north cross-corridors, and it has a ramp at each end
  // so it is a position you can be pushed off rather than a perch.
  const DOCK_Z = -19, DOCK_Y = 1.2;
  b.box(0, DOCK_Y / 2, DOCK_Z, 52, DOCK_Y, 5.2, { mat: SURFACE.CONCRETE });
  b.ramp(-27.5, 0, DOCK_Z, 4.6, 4.4, DOCK_Y, 'x', SURFACE.CONCRETE, 8);
  b.ramp(27.5, 0, DOCK_Z, 4.6, 4.4, DOCK_Y, '-x', SURFACE.CONCRETE, 8);
  // Waist-high cover along the dock lip, broken so it is not a solid parapet.
  for (const x of [-22, -16, -4, 4, 16, 22]) {
    b.prop('crate_metal', x, DOCK_Y, DOCK_Z + 1.1, { yaw: 0.02 });
  }
  b.prop('pallet', -10, DOCK_Y, DOCK_Z + 0.6, { yaw: 0.1 });
  b.prop('pallet', 10, DOCK_Y, DOCK_Z + 0.6, { yaw: -0.1 });

  // --- racking -------------------------------------------------------------
  // Two long runs down the hall, each cut into three segments so the gaps line
  // up with the cross-corridors. The upper decks are shootable-through gaps at
  // head height, which is what makes the aisles readable from beside them.
  const rackRun = (z) => {
    for (const [x0, x1] of [[-26, -10], [-4, 4], [10, 26]]) {
      const cx = (x0 + x1) / 2, len = x1 - x0;
      for (let x = x0 + 1.3; x < x1; x += 2.7) b.prop('shelf_rack', x, 0.05, z, {});
      b.box(cx, 2.42, z, len, 0.12, 2.6, { mat: SURFACE.METAL });
    }
  };
  rackRun((Z_DOCK + Z_MAIN) / 2 + 0.5);    // between the dock lane and the main aisle
  rackRun((Z_MAIN + Z_RACK) / 2 + 0.5);    // between the main aisle and the rack aisle

  // A collapsed run at the middle: the mid cross-corridor is the most exposed
  // place on the map, and it needs something to break the line.
  b.prop('debris_pile', -1.2, 0.05, Z_MAIN - 4.6, { yaw: 0.9 });
  b.prop('rubble', 1.6, 0.05, Z_MAIN - 5.4, { yaw: 2.1 });
  b.box(0.4, 1.1, Z_MAIN - 5.0, 5.2, 0.2, 0.9, { mat: SURFACE.METAL, yaw: 0.4 });

  // --- cover at the cross-corridor mouths ----------------------------------
  // Each junction gets one piece you can take cover behind and one you can
  // shoot over. Placed, not scattered.
  for (const x of CROSS) {
    const s = x < 0 ? 1 : -1;
    b.prop('crate_stack', x - 1.6 * s, 0.05, Z_MAIN - 1.9, { yaw: 0.1 });
    b.prop('crate_large', x + 1.9 * s, 0.05, Z_MAIN + 2.2, { yaw: 0.3 });
    b.prop('barrel', x + 0.2, 0.05, Z_RACK + 2.6, {});
    b.prop('barrel', x + 0.9, 0.05, Z_RACK + 3.3, {});
  }
  // Mid-lane cover, so the long sightlines have one place to break them.
  b.prop('van', -13, 0.05, Z_MAIN + 0.4, { yaw: 0.03 });
  b.prop('crate_stack', 13.5, 0.05, Z_MAIN - 0.6, {});
  b.prop('crate_large', 14.2, 0.05, Z_MAIN + 1.4, { yaw: 0.5 });
  b.prop('tire_stack', -6.5, 0.05, Z_RACK - 1.0, {});
  b.prop('tire_stack', -6.6, 0.8, Z_RACK - 1.1, {});
  b.prop('toolbox', 6.0, 0.05, Z_DOCK + 2.2, { yaw: 0.7 });
  b.prop('generator', -19.5, 0.05, Z_DOCK + 2.6, { yaw: -Math.PI / 2 });
  b.prop('fuel_drum', 20.4, 0.05, Z_DOCK + 2.4, {});
  b.prop('fuel_drum', 21.2, 0.05, Z_DOCK + 3.1, {});

  // --- office row ----------------------------------------------------------
  // Three rooms along the south wall, connected to each other so the row is a
  // route rather than three dead ends, with windows onto the hall.
  const office = (cx, doorAt) => {
    b.room(cx, Z_OFFICE, 16, 9, 3.2, {
      doors: [{ side: 'n', at: doorAt, gap: 1.5 }, { side: 'w', at: 0.5, gap: 1.5 }, { side: 'e', at: 0.5, gap: 1.5 }],
      windows: [{ side: 'n', at: doorAt > 0.5 ? 0.22 : 0.78, gap: 3.2, sill: 1.0, top: 2.4 }],
      mat: SURFACE.PLASTER, floorMat: SURFACE.TILE, floor: false, ceil: true, reverb: 'office'
    });
    b.light('point', cx, 2.9, Z_OFFICE, { color: 0xd8e2ff, intensity: 6, distance: 13, flicker: 0.18 });
  };
  office(-18, 0.62);
  office(0, 0.38);
  office(18, 0.62);
  b.prop('desk', -21, 0.05, Z_OFFICE - 2.4, { yaw: 0.1 });
  b.prop('office_chair', -21, 0.05, Z_OFFICE - 1.3, { yaw: 2.8 });
  b.prop('monitor', -21, 0.79, Z_OFFICE - 2.6, { yaw: 0.1, solid: false });
  b.prop('cabinet', -13.4, 0.05, Z_OFFICE + 3.6, { yaw: Math.PI });
  b.prop('table', -2, 0.05, Z_OFFICE + 2.6, { yaw: 0 });
  b.prop('chair', -2, 0.05, Z_OFFICE + 3.7, { yaw: 0.2 });
  b.prop('whiteboard', 0, 1.6, Z_OFFICE + 4.3, { yaw: 0, solid: false });
  b.prop('locker', 4.6, 0.05, Z_OFFICE + 3.7, { yaw: Math.PI });
  b.prop('locker', 5.6, 0.05, Z_OFFICE + 3.7, { yaw: Math.PI });
  b.prop('counter', 21, 0.05, Z_OFFICE + 3.4, { yaw: 0 });
  b.prop('fridge', 24.2, 0.05, Z_OFFICE + 3.2, { yaw: 0 });
  b.prop('printer', 14.4, 0.05, Z_OFFICE - 3.2, { yaw: 0.4 });

  // --- mezzanine -----------------------------------------------------------
  // A deck over the office row, looking down the main aisle. Stairs at both
  // ends, and a gap in the middle of the railing to drop through.
  b.box(0, MZ_Y - 0.15, Z_OFFICE - 4.5, 58, 0.3, 9, { mat: SURFACE.METAL });
  // Railing along the deck's north edge, with a gap in the middle to drop
  // through and a gap at each end where the stairs arrive.
  b.wall(-26, Z_OFFICE - 9.0, -3, Z_OFFICE - 9.0, 1.05, { y: MZ_Y, mat: SURFACE.METAL, thick: 0.12, opaque: false });
  b.wall(3, Z_OFFICE - 9.0, 26, Z_OFFICE - 9.0, 1.05, { y: MZ_Y, mat: SURFACE.METAL, thick: 0.12, opaque: false });
  // The flights climb up to the deck's north EDGE, out of the main aisle —
  // not up underneath the deck, which is where they were and why nothing
  // could reach the mezzanine at all: the last steps were buried in the slab
  // and the ones before them had a metre of headroom.
  b.stairs(-28, 0.05, Z_OFFICE - 16.4, 3.2, 'z', 14, MZ_Y - 0.05, 7.4, SURFACE.METAL);
  b.stairs(28, 0.05, Z_OFFICE - 16.4, 3.2, 'z', 14, MZ_Y - 0.05, 7.4, SURFACE.METAL);
  // Sandbags on the deck: the mezzanine should be a position, not a balcony.
  b.prop('sandbags', -14, MZ_Y, Z_OFFICE - 8.4, { yaw: 0 });
  b.prop('sandbags', -12.4, MZ_Y, Z_OFFICE - 8.4, { yaw: 0 });
  b.prop('sandbags', 13, MZ_Y, Z_OFFICE - 8.4, { yaw: 0 });
  b.prop('crate_wood', 0, MZ_Y, Z_OFFICE - 6.0, { yaw: 0.3 });
  b.prop('barrel', 7.5, MZ_Y, Z_OFFICE - 7.6, {});

  // --- roof ----------------------------------------------------------------
  for (let i = -4; i <= 4; i++) {
    b.box(0, HALL_H - 0.6, i * 5, HALL_W, 0.3, 0.35, { mat: SURFACE.METAL });
  }
  // Lamps down the two aisles rather than in a grid: the light follows the
  // routes, so a lit lane reads as a lane.
  for (const z of [Z_DOCK, Z_MAIN, Z_RACK]) {
    for (const x of [-21, -7, 7, 21]) {
      b.light('point', x, HALL_H - 1.4, z, {
        color: 0xfff0d0, intensity: 18, distance: 20,
        shadow: x === -7 && z === Z_MAIN, flicker: x === 21 && z === Z_RACK ? 0.5 : 0,
        fixture: 'hilo'
      });
    }
  }
  // Skylights over the main aisle, so the long lane is the bright one.
  for (let i = -3; i <= 3; i++) {
    b.box(i * 8, HALL_H - 0.15, Z_MAIN, 5.0, 0.12, 3.4, { mat: SURFACE.GLASS, solid: false, opaque: false });
  }

  // --- north apron ---------------------------------------------------------
  // Containers and trailers parked in rows that continue the hall's lanes
  // outside, so the apron is a route with cover rather than a car park.
  b.wall(-43, -35, 43, -35, 3.4, { mat: SURFACE.METAL });
  b.wall(-43, 35, 43, 35, 3.4, { mat: SURFACE.METAL });
  b.wall(-43, -35, -43, 35, 3.4, { mat: SURFACE.METAL });
  b.wall(43, -35, 43, 35, 3.4, { mat: SURFACE.METAL });

  // Containers: solid blocks placed to leave a walkable lane at z = -27 and a
  // covered approach to each roller door.
  const container = (x, z, yaw = 0) => {
    b.box(x, 1.3, z, 12, 2.6, 2.6, { mat: SURFACE.METAL, yaw });
  };
  container(-26, -31);
  container(-8, -31);
  container(10, -31);
  container(28, -31);
  container(-17, -24.5);
  container(17, -24.5);
  b.prop('van', -33, 0, -26, { yaw: 1.55 });
  b.prop('van', 33, 0, -26, { yaw: 1.55 });
  b.prop('car', 0, 0, -26.5, { yaw: 1.6 });
  b.prop('dumpster', -12.5, 0, -22.5, { yaw: 0.02 });
  b.prop('dumpster', 12.5, 0, -22.5, { yaw: 0.02 });
  b.prop('jersey', -21, 0, -22.4, { yaw: 0 });
  b.prop('jersey', 21, 0, -22.4, { yaw: 0 });
  b.propLine('streetlight', -34, -33, 34, -33, 5, 0, {});
  for (let i = 0; i < 5; i++) {
    b.light('point', -34 + i * 17, 6.2, -33, { color: 0xffd9a0, intensity: 9, distance: 24, fixture: 'street' });
  }

  // --- south alley ---------------------------------------------------------
  // Deliberately narrow and mostly empty: it is the fast flank, and its price
  // is that there is nothing to hide behind once you are committed to it.
  b.wall(-40, 33, 40, 33, 3.0, { mat: SURFACE.CONCRETE });
  b.prop('fence_panel', -30, 0, 30.5, { yaw: 0 });
  b.prop('fence_panel', 30, 0, 30.5, { yaw: 0 });
  b.prop('barrel', -8.5, 0, 27.5, {});
  b.prop('barrel', -7.7, 0, 28.2, {});
  b.prop('rubble', 9, 0, 28, { yaw: 1.2 });
  b.prop('bush', -20, 0, 31, {});
  b.prop('bush', 20, 0, 31, {});

  // --- spawn rooms ---------------------------------------------------------
  // Each side starts under a roof with cover in front of it and three ways
  // out: into the hall, north onto the apron, south into the alley. Nobody
  // opens a round standing in the middle of an empty yard.
  // Built against the hall's own end wall rather than as a separate room beside
  // it: the two openings in that wall ARE the way in, so they cannot end up
  // misaligned with a door of their own. (They were, first time round — a
  // one-metre slot between two walls that nearly no route could use.)
  const spawnHall = (sx) => {
    const inner = sx * HALL_X1, outer = sx * 43, cx = (inner + outer) / 2;
    const H = 4.8;
    b.floor(cx, 0, 13, 30, 0.05, SURFACE.CONCRETE, 0.3);
    b.ceiling(cx, 0, 13, 30, H, SURFACE.METAL, 0.4);
    b.zone(cx, H / 2, 0, 13, H, 30, 'room');
    // Out onto the apron to the north, into the alley to the south.
    b.wallDoor(inner, -15, outer, -15, H, 0.5, 3.2, { mat: SURFACE.METAL, thick: 0.35, doorH: 3.4 });
    b.wallDoor(inner, 15, outer, 15, H, 0.5, 3.2, { mat: SURFACE.METAL, thick: 0.35, doorH: 3.4 });
    b.wall(outer, -15, outer, 15, H, { mat: SURFACE.METAL, thick: 0.4 });
    b.light('point', cx, H - 1.2, -7, { color: 0xffe9c4, intensity: 9, distance: 17 });
    b.light('point', cx, H - 1.2, 7, { color: 0xffe9c4, intensity: 9, distance: 17 });
    // Cover in front of the spawn, not in the doorway.
    b.prop('crate_large', cx - sx * 2.2, 0.05, -11, { yaw: 0.2 });
    b.prop('crate_stack', cx - sx * 2.4, 0.05, 11, {});
    b.prop('shelf_rack', outer - sx * 1.0, 0.05, 0, { yaw: Math.PI / 2 });
    b.prop('pallet', cx, 0.05, -2, { yaw: 0.3 });
    b.prop('barrel', cx + sx * 2.0, 0.05, 4, {});
  };
  spawnHall(-1);
  spawnHall(1);

  // --- spawns / sites ------------------------------------------------------
  // Inside the spawn rooms, facing the hall.
  b.spawn('alpha', -38, 0, -8, Math.PI / 2);
  b.spawn('alpha', -38, 0, -3, Math.PI / 2);
  b.spawn('alpha', -38, 0, 3, Math.PI / 2);
  b.spawn('alpha', -38, 0, 8, Math.PI / 2);
  b.spawn('bravo', 38, 0, -8, -Math.PI / 2);
  b.spawn('bravo', 38, 0, -3, -Math.PI / 2);
  b.spawn('bravo', 38, 0, 3, -Math.PI / 2);
  b.spawn('bravo', 38, 0, 8, -Math.PI / 2);

  // Free-for-all drops people onto each of the three routes and the mezzanine.
  b.spawn('ffa', -24, 0, Z_MAIN, Math.PI / 2);
  b.spawn('ffa', 24, 0, Z_MAIN, -Math.PI / 2);
  b.spawn('ffa', -20, 0, Z_OFFICE, 0);
  b.spawn('ffa', 20, 0, Z_OFFICE, Math.PI);
  b.spawn('ffa', -24, 0, -27, 0.6);
  b.spawn('ffa', 24, 0, -27, 2.5);
  b.spawn('ffa', -14, MZ_Y, Z_OFFICE - 6.5, Math.PI / 2);
  b.spawn('ffa', 14, MZ_Y, Z_OFFICE - 6.5, -Math.PI / 2);

  // Diagonally opposed, one on each of the two routes worth fighting over.
  b.site('A', -20, 0, Z_DOCK, 3.6);
  b.site('B', 18, 0, Z_OFFICE, 3.6);

  b.ambient('wind', 0, 8, -28, 60, 0.35);
  b.ambient('metal_creak', 0, 8, 0, 44, 0.5);
  b.ambient('electric_hum', 0, 8, Z_OFFICE, 20, 0.4);
  b.ambient('dripping', -18, 1, Z_OFFICE, 10, 0.5);
  return b.build();
}
