import { MapBuilder } from './kit.js';
import { SURFACE } from '../constants.js';

/**
 * AIRSOFT RANGE — a run-down indoor site, weeks off being shut for good.
 *
 * Twice the footprint it used to be: 60 metres square against 30. The old one
 * was a single 26-metre box with two plywood dividers and a small block in the
 * middle, which meant three lanes that all looked the same and a round that
 * was over before you had decided anything. At this size it is a course you
 * can actually clear — rooms with doors, a corridor spine, a stack of
 * shipping containers to fight over and a raised observation gantry down one
 * side — while staying what it is: close, fast, no long angles.
 *
 * The fiction is an operator who stopped spending money on the place a while
 * ago: plywood that has been shot through and patched, a gantry going to rust,
 * half the strip lights on a bad ballast.
 *
 * The plan is a spine and two wings, mirrored north to south so neither spawn
 * has the better side:
 *
 *   SPINE     the centre corridor, running the length of the house. Fastest
 *             route and the one everyone can hear you take.
 *   WEST      four small rooms off the spine, each with two doors. Where you
 *             go when the spine is held.
 *   EAST      the container yard — hard cover you can climb, overlooked by
 *             the gantry.
 *   GANTRY    a walkway at 3.6 m down the east wall, stairs at both ends,
 *             looking over the containers and into the spine's far door.
 *
 * Everything interior is plywood at 2.8 m: shootable through, and low enough
 * that the ceiling still reads as one space rather than a warren.
 */
export function buildKillhouse() {
  const b = new MapBuilder({
    key: 'killhouse',
    name: 'Airsoft Range',
    subtitle: 'Indoor Site — Closing Down',
    desc: 'An old airsoft site a fortnight from being shut for good: sagging plywood, a corridor spine, four cleared rooms, a container yard and a rusting gantry over it. Close, fast, no long angles.',
    size: [60, 60],
    compact: true,
    env: {
      sky: 'interior',
      sunDir: [0.3, 0.9, 0.2],
      sunColor: 0xe4ecf6, sunIntensity: 3.4,
      ambientColor: 0xc2cddc, ambientIntensity: 5.6,
      hemiGround: 0x6e6a62,
      fog: { color: 0x6b737d, near: 45, far: 170 },
      exposure: 1.86,
      reverb: 'hall',
      wind: 0, rain: 0, dustMotes: 0.0
    }
  });

  const W = SURFACE.WOOD, C = SURFACE.CONCRETE, M = SURFACE.METAL;
  const H = 5.4;                 // shell height
  const IW = 2.8;                // interior plywood height
  const R = 28;                  // half the shell
  const GY = 3.6;                // gantry height

  // --- shell ---------------------------------------------------------------
  b.floor(0, 0, 60, 60, 0, C, 0.6);
  b.ceiling(0, 0, 60, 60, H, M, 0.4);
  b.zone(0, H / 2, 0, 60, H, 60, 'hall');
  for (const [x1, z1, x2, z2] of [[-R, -R, R, -R], [-R, R, R, R], [-R, -R, -R, R], [R, -R, R, R]]) {
    b.wall(x1, z1, x2, z2, H, { mat: C, thick: 0.4 });
  }

  // --- the spine -----------------------------------------------------------
  // Two plywood walls running north-south, 8 m apart, with a cross-opening at
  // the middle so the corridor is not a shooting gallery end to end.
  for (const sx of [-1, 1]) {
    const x = sx * 5;
    b.wallOpenings(x, -R + 2, x, -4, IW,
      [{ at: 0.35, gap: 1.4, kind: 'door' }, { at: 0.8, gap: 1.4, kind: 'door' }],
      { mat: W, thick: 0.16, breakable: true });
    b.wallOpenings(x, 4, x, R - 2, IW,
      [{ at: 0.2, gap: 1.4, kind: 'door' }, { at: 0.65, gap: 1.4, kind: 'door' }],
      { mat: W, thick: 0.16, breakable: true });
  }
  // The middle: a hard block you fight around rather than through.
  b.wall(-2.6, -2.0, 2.6, -2.0, IW, { mat: C, thick: 0.3 });
  b.wall(-2.6, 2.0, 2.6, 2.0, IW, { mat: C, thick: 0.3 });
  b.wall(-2.6, -2.0, -2.6, 2.0, IW, { mat: C, thick: 0.3 });
  b.wall(2.6, -2.0, 2.6, 2.0, IW, { mat: C, thick: 0.3 });
  b.prop('crate_stack', 0, 0, -6, {});
  b.prop('crate_stack', 0, 0, 6, {});
  b.prop('sandbags', -2.2, 0, -9, { yaw: 0 });
  b.prop('sandbags', 2.2, 0, 9, { yaw: 0 });

  // --- west wing: four cleared rooms ---------------------------------------
  // Each has a door onto the spine and a door to its neighbour, so the wing is
  // a route rather than four dead ends you can be trapped in.
  // The corridors BETWEEN the rooms are the connections — 3 m of clear floor,
  // not a 1 m slot and a door. A room with one door is a box you die in, and a
  // 1 m gap between two plywood walls is the kind of thing that looks passable
  // and turns out not to be.
  const ROOM_X = -16, ROOM_W = 16;
  for (let i = 0; i < 4; i++) {
    const cz = -19 + i * 12.7;
    b.room(ROOM_X, cz, ROOM_W, 9.7, IW, {
      doors: [{ side: 'e', at: 0.5, gap: 2.0 }],
      windows: i % 2 === 0
        ? [{ side: 'w', at: 0.5, gap: 2.6, sill: 1.0, top: 2.2 }]
        : [{ side: 'e', at: 0.16, gap: 2.2, sill: 1.0, top: 2.2 }],
      mat: W, thick: 0.16, breakable: true, floor: false, ceil: false, zone: false
    });
    // One piece of cover per room, alternating side so no two clear the same.
    if (i % 2 === 0) {
      b.prop('crate_large', ROOM_X - 4.5, 0, cz - 2.4, { yaw: 0.2 });
      b.prop('table', ROOM_X + 3.6, 0, cz + 2.4, { yaw: 0.1 });
    } else {
      b.prop('crate_wood', ROOM_X + 4.4, 0, cz + 2.4, { yaw: -0.3 });
      b.prop('crate_wood', ROOM_X + 4.4, 0.9, cz + 2.4, { yaw: 0.4 });
      b.prop('locker', ROOM_X - 5.4, 0, cz - 2.4, { yaw: Math.PI / 2 });
    }
  }
  // A corridor between the rooms and the west wall, so the wing has a bypass.
  b.propLine('barrel', -26, -16, -26, 16, 5, 0, {});

  // --- east wing: container yard -------------------------------------------
  // Containers are hard cover AND a second level: 2.6 m tall, close enough to
  // step between, and reachable from the gantry.
  const container = (x, z, yaw = 0) => b.box(x, 1.3, z, 9, 2.6, 2.6, { mat: M, yaw });
  container(14, -20);
  container(20, -12);
  container(13, -4);
  container(20, 4);
  container(14, 12);
  container(20, 20);
  b.prop('tire_stack', 10, 0, -16, {});
  b.prop('tire_stack', 10.1, 0.8, -16.1, {});
  b.prop('tire_stack', 10, 0, 16, {});
  b.prop('pallet', 17, 0, 0, { yaw: 0.4 });
  b.prop('crate_metal', 24, 0, -8, { yaw: 0.1 });
  b.prop('crate_metal', 24, 0, 8, { yaw: -0.1 });
  b.prop('barrier', 9, 0, 0, { yaw: 0 });

  // --- gantry --------------------------------------------------------------
  // Down the east wall at 3.6 m, with a flight at each end. It overlooks the
  // containers and both spine doors; the price is that the two ways off it are
  // at the ends, where everyone knows to look.
  b.box(25.4, GY - 0.15, 0, 4.4, 0.3, 44, { mat: M });
  for (const sgn of [-1, 1]) {
    // Rail on the inner edge only — the wall is the outer one — and BROKEN
    // where the stairs land. A continuous rail here is a railing across the
    // top of your own staircase: the flight looks like a way up and is not.
    b.wall(23.2, sgn * 4, 23.2, sgn * 17.6, 1.05, { y: GY, mat: M, thick: 0.1, opaque: false });
    b.wall(23.2, sgn * 20.6, 23.2, sgn * 22, 1.05, { y: GY, mat: M, thick: 0.1, opaque: false });
    b.stairs(23.2 - 5.6, 0.03, sgn * 19, 2.4, 'x', 14, GY - 0.03, 5.6, M);
  }
  b.prop('sandbags', 25.4, GY, -12, { yaw: 0 });
  b.prop('sandbags', 25.4, GY, 12, { yaw: 0 });
  b.prop('crate_wood', 25.4, GY, 0, { yaw: 0.2 });

  // --- lighting ------------------------------------------------------------
  // Only the six lights nearest the camera are switched on at a time, so at
  // this size the fixtures have to be a coarse grid of strong, far-reaching
  // ones rather than a lamp in every room: a dozen local lights just means the
  // six nearest are all behind you and the room you are in is black. Hung at
  // 4.5 m, above the 2.8 m plywood, so each one spills into the rooms below it.
  b.light('point', 0, H - 0.9, 0, { color: 0xfff4e0, intensity: 2.6, distance: 34, shadow: true });
  for (const x of [-22, -8, 8, 22]) {
    for (const z of [-24, -8, 8, 24]) {
      const warm = x < 0;
      b.light('point', x, H - 0.9, z, {
        color: warm ? 0xfff0d8 : 0xe6f0ff,
        intensity: warm ? 2.2 : 2.0,
        distance: 30,
        flicker: (x === -8 && z === 8) || (x === 22 && z === -24) ? 0.3 : 0
      });
    }
  }

  // --- spawns / sites ------------------------------------------------------
  // Behind the last plywood wall at each end, three abreast, facing in.
  // In the open ground at each end of the house, across the mouth of the spine
  // and both shoulders, so a team fans out into three routes rather than
  // filing down one.
  for (const [team, sgn, yaw] of [['alpha', -1, 0], ['bravo', 1, Math.PI]]) {
    for (const dx of [-16, -2, 2, 16]) b.spawn(team, dx, 0, sgn * 26.5, yaw);
  }
  b.spawn('ffa', -16, 0, -19, 1.5);
  b.spawn('ffa', -16, 0, 19, 1.5);
  b.spawn('ffa', 18, 0, -20, -1.5);
  b.spawn('ffa', 18, 0, 20, -1.5);
  b.spawn('ffa', 25.4, GY, 0, -Math.PI / 2);
  b.spawn('ffa', 0, 0, -8.5, 0);      // in the spine, NOT inside the centre block
  b.spawn('ffa', 0, 0, 8.5, Math.PI);

  b.site('A', ROOM_X, 0, -6.3, 3.0);
  b.site('B', 18, 0, 8, 3.0);

  b.ambient('electric_hum', 0, 4, 0, 26, 0.4);
  b.ambient('vent_rumble', 0, 4, -18, 20, 0.3);
  b.ambient('vent_rumble', 0, 4, 18, 20, 0.3);
  return b.build();
}
