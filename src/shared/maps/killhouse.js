import { MapBuilder } from './kit.js';
import { SURFACE } from '../constants.js';

/**
 * KILLHOUSE — compact CQB shoothouse used by Gunfight.
 * Symmetrical, roughly 26m across, three lanes, engagements inside 4 seconds.
 */
export function buildKillhouse() {
  const b = new MapBuilder({
    key: 'killhouse',
    name: 'Killhouse',
    subtitle: 'CQB Training Shoothouse',
    desc: 'A symmetrical 26-metre shoothouse. Three lanes, no long angles, rounds end in seconds.',
    size: [30, 30],
    compact: true,
    env: {
      sky: 'interior',
      sunDir: [0.3, 0.9, 0.2],
      sunColor: 0xd8e4f0, sunIntensity: 0.8,
      ambientColor: 0x39414d, ambientIntensity: 0.7,
      hemiGround: 0x1b1a18,
      fog: { color: 0x2a2f36, near: 12, far: 60 },
      exposure: 1.1,
      reverb: 'hall',
      wind: 0, rain: 0, dustMotes: 0.8
    }
  });

  const W = SURFACE.WOOD, C = SURFACE.CONCRETE, P = SURFACE.PLASTER;
  b.floor(0, 0, 30, 30, 0, C, 0.6);
  b.wall(-13, -13, 13, -13, 4.2, { mat: C, thick: 0.4 });
  b.wall(-13, 13, 13, 13, 4.2, { mat: C, thick: 0.4 });
  b.wall(-13, -13, -13, 13, 4.2, { mat: C, thick: 0.4 });
  b.wall(13, -13, 13, 13, 4.2, { mat: C, thick: 0.4 });
  b.ceiling(0, 0, 30, 30, 4.2, SURFACE.METAL, 0.4);
  b.zone(0, 2.1, 0, 30, 4.2, 30, 'hall');

  // plywood room dividers, mirrored north/south
  for (const s of [-1, 1]) {
    b.wallDoor(-13, 4 * s, -4, 4 * s, 2.6, 0.55, 1.2, { mat: W, thick: 0.16, breakable: true });
    b.wallDoor(4, 4 * s, 13, 4 * s, 2.6, 0.45, 1.2, { mat: W, thick: 0.16, breakable: true });
    b.wall(-4, 4 * s, -4, 10 * s, 2.6, { mat: W, thick: 0.16, breakable: true });
    b.wallDoor(4, 4 * s, 4, 10 * s, 2.6, 0.5, 1.1, { mat: W, thick: 0.16, breakable: true });
    b.prop('crate_wood', -8.5, 0, 8 * s, { yaw: 0.2 });
    b.prop('crate_large', 8.5, 0, 8 * s, { yaw: -0.3 });
    b.prop('barrel', 0, 0, 10 * s, {});
    b.prop('sandbags', 2.5, 0, 6.5 * s, { yaw: 0.1 });
    b.light('point', 0, 3.9, 8 * s, { color: 0xfff0d8, intensity: 6, distance: 16, shadow: false });
    b.light('point', -8, 3.9, 6 * s, { color: 0xe6f0ff, intensity: 4, distance: 12, flicker: s > 0 ? 0.3 : 0 });
    b.light('point', 8, 3.9, 6 * s, { color: 0xe6f0ff, intensity: 4, distance: 12 });
  }

  // central island
  b.wall(-2.5, -1.5, 2.5, -1.5, 2.6, { mat: C, thick: 0.3 });
  b.wall(-2.5, 1.5, 2.5, 1.5, 2.6, { mat: C, thick: 0.3 });
  b.wall(-2.5, -1.5, -2.5, 1.5, 2.6, { mat: C, thick: 0.3 });
  b.wall(2.5, -1.5, 2.5, 1.5, 2.6, { mat: C, thick: 0.3 });
  b.prop('crate_stack', -6, 0, 0, {});
  b.prop('crate_stack', 6, 0, 0, {});
  b.prop('pallet', -10, 0, 0, { yaw: 0.4 });
  b.prop('pallet', 10, 0, 0, { yaw: -0.4 });
  b.prop('tire_stack', -11, 0, -6, {});
  b.prop('tire_stack', 11, 0, 6, {});
  b.light('point', 0, 4.0, 0, { color: 0xfff4e0, intensity: 7, distance: 18, shadow: true });

  b.spawn('alpha', 0, 0, -11.5, 0);
  b.spawn('alpha', -3, 0, -11.5, 0);
  b.spawn('alpha', 3, 0, -11.5, 0);
  b.spawn('bravo', 0, 0, 11.5, Math.PI);
  b.spawn('bravo', -3, 0, 11.5, Math.PI);
  b.spawn('bravo', 3, 0, 11.5, Math.PI);
  b.spawn('ffa', -11, 0, -11, 0.8);
  b.spawn('ffa', 11, 0, 11, 3.9);
  b.spawn('ffa', -11, 0, 11, 2.4);
  b.spawn('ffa', 11, 0, -11, -0.8);

  b.site('A', -8, 0, 0, 2.8);
  b.site('B', 8, 0, 0, 2.8);

  b.ambient('electric_hum', 0, 4, 0, 20, 0.4);
  b.ambient('vent_rumble', 0, 4, -10, 16, 0.3);
  return b.build();
}
