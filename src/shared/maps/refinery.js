import { MapBuilder } from './kit.js';
import { SURFACE, mulberry32 } from '../constants.js';

/**
 * REFINERY — daylight industrial facility.
 * Open plant floor with catwalks overhead, a control room, storage tanks and
 * a pipe maze. Verticality everywhere; almost every angle has a counter-angle.
 */
export function buildRefinery() {
  const rng = mulberry32(0x2EF19);
  const b = new MapBuilder({
    key: 'refinery',
    name: 'Refinery',
    subtitle: 'Petrochemical Facility — Midday',
    desc: 'Catwalks over an open plant floor. Storage tanks, a control room and a pipe maze with no safe lane.',
    size: [96, 80],
    compact: false,
    env: {
      sky: 'day',
      sunDir: [0.45, 0.82, 0.35],
      sunColor: 0xfff3dd, sunIntensity: 2.6,
      ambientColor: 0x7d8ea8, ambientIntensity: 0.7,
      hemiGround: 0x4a463f,
      fog: { color: 0xa9b4bf, near: 40, far: 190 },
      exposure: 1.12,
      reverb: 'outdoor',
      wind: 0.6, rain: 0, dustMotes: 0.7, heatHaze: 0.5
    }
  });

  const M = SURFACE.METAL, C = SURFACE.CONCRETE;

  b.floor(0, 0, 96, 80, 0, C, 0.8);
  b.floor(-20, 0, 34, 60, 0.03, SURFACE.GRAVEL, 0.1);

  // --- perimeter -----------------------------------------------------------
  b.wall(-48, -40, 48, -40, 4.0, { mat: M });
  b.wall(-48, 40, 48, 40, 4.0, { mat: M });
  b.wall(-48, -40, -48, 40, 4.0, { mat: M });
  b.wall(48, -40, 48, 40, 4.0, { mat: M });

  // --- main process hall ---------------------------------------------------
  const HW = 40, HD = 30, HH = 11;
  b.floor(14, 0, HW, HD, 0.06, C, 0.3);
  b.ceiling(14, 0, HW + 1, HD + 1, HH, M, 0.5);
  b.wallDoor(-6, -15, 34, -15, HH, 0.35, 5.0, { mat: M, thick: 0.35, doorH: 4.5 });
  b.wallWindow(-6, -15, 34, -15, HH, { mat: M, thick: 0.35, at: 0.75, gap: 8, sill: 6.5, top: 9.0 });
  b.wallDoor(-6, 15, 34, 15, HH, 0.5, 3.0, { mat: M, thick: 0.35, doorH: 3.4 });
  b.wallDoor(-6, -15, -6, 15, HH, 0.5, 4.0, { mat: M, thick: 0.35, doorH: 4.0 });
  b.wall(34, -15, 34, 15, HH, { mat: M, thick: 0.35 });
  b.zone(14, HH / 2, 0, HW, HH, HD, 'hall');

  // catwalk ring at 5.2m
  const CW = 5.2;
  const cwSeg = (x1, z1, x2, z2, w = 1.6) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const yaw = -Math.atan2(z2 - z1, x2 - x1);
    b.brushes.push({ p: [(x1 + x2) / 2, CW - 0.1, (z1 + z2) / 2], s: [len, 0.2, w], yaw, mat: M });
    b.brushes.push({ p: [(x1 + x2) / 2, CW + 0.5, (z1 + z2) / 2], s: [len, 1.0, 0.08], yaw, mat: M, opaque: false });
  };
  cwSeg(-4, -12, 32, -12);
  cwSeg(-4, 12, 32, 12);
  cwSeg(32, -12, 32, 12);
  cwSeg(-4, -12, -4, 12);
  b.stairs(-2.0, 0.06, -11.0, 1.6, 'x', 16, CW - 0.06, 5.4, M);
  b.stairs(30, 0.06, 10.0, 1.6, '-x', 16, CW - 0.06, 5.4, M);

  // process equipment on the hall floor
  for (let i = 0; i < 5; i++) {
    const x = 0 + i * 7.5;
    b.prop('generator', x, 0.06, -6 + (i % 2) * 12, { yaw: (i % 2) * Math.PI });
    b.prop('fuel_drum', x + 1.6, 0.06, -3 + (i % 3) * 4, {});
    if (i % 2 === 0) b.prop('pipe_run', x, 3.4, 0, { yaw: 0 });
  }
  b.prop('pipe_run', 6, 7.4, 0, { yaw: 0 });
  b.prop('pipe_run', 22, 7.4, 0, { yaw: 0 });
  b.prop('crate_metal', 30, 0.06, -10, { yaw: 0.2 });
  b.prop('crate_metal', 30, 0.86, -10, { yaw: 0.9 });
  b.prop('shelf_rack', 32, 0.06, 6, { yaw: Math.PI / 2 });
  b.prop('sandbags', 12, 0.06, 9, { yaw: 0.1 });

  for (let i = -1; i <= 1; i++) {
    b.light('point', 14 + i * 13, HH - 1.6, 0, { color: 0xfff6e0, intensity: 30, distance: 26, shadow: i === 0 });
    b.light('point', 14 + i * 13, CW + 2.2, i * 9, { color: 0xffe0b0, intensity: 9, distance: 14, flicker: i === 1 ? 0.4 : 0 });
  }

  // roof skylights — the reason the hall reads as daytime inside
  for (let i = -1; i <= 1; i++) {
    b.box(14, HH - 0.2, i * 9, 26, 0.12, 2.2, { mat: SURFACE.GLASS, solid: false, opaque: false });
    b.light('point', 14, HH - 1.0, i * 9, { color: 0xdfeaff, intensity: 26, distance: 30 });
  }

  // --- control room (elevated, glass front) --------------------------------
  const CR = 5.4;
  b.box(-24, CR - 0.2, -18, 16, 0.4, 12, { mat: C });
  b.room(-24, -18, 16, 12, 3.2, {
    y: CR, doors: [{ side: 'e', at: 0.7 }],
    windows: [{ side: 's', at: 0.5, gap: 11, sill: 0.9, top: 2.6 }],
    mat: C, floor: false, ceil: true, reverb: 'office'
  });
  b.stairs(-16.6, 0.03, -21.5, 1.8, 'x', 16, CR - 0.03, 6.0, M);
  b.prop('desk', -27, CR, -20, { yaw: 0 });
  b.prop('desk', -24, CR, -20, { yaw: 0 });
  b.prop('desk', -21, CR, -20, { yaw: 0 });
  b.prop('monitor', -27, CR + 0.74, -20.2, { solid: false });
  b.prop('monitor', -24, CR + 0.74, -20.2, { solid: false });
  b.prop('monitor', -21, CR + 0.74, -20.2, { solid: false });
  b.prop('office_chair', -24, CR, -18.8, { yaw: Math.PI });
  b.prop('cabinet', -30.4, CR, -15, { yaw: Math.PI / 2 });
  b.light('point', -24, CR + 2.9, -18, { color: 0xdce8ff, intensity: 5, distance: 14 });
  b.zone(-24, CR + 1.6, -18, 16, 3.2, 12, 'office');

  // --- storage tanks -------------------------------------------------------
  const tanks = [[-30, 14], [-18, 22], [-34, 28], [-8, 30]];
  for (const [tx, tz] of tanks) {
    b.box(tx, 4.5, tz, 8.4, 9, 8.4, { mat: M });
    b.prop('pipe_run', tx + 4.6, 3.0, tz, { yaw: Math.PI / 2 });
    b.light('point', tx, 9.8, tz, { color: 0xff5a3c, intensity: 3, distance: 8, flicker: 0.9 });
  }
  b.box(-24, 5.6, 18, 12, 0.2, 1.4, { mat: M });
  b.stairs(-30, 0.03, 9.0, 1.6, 'z', 16, 5.6, 5.4, M);

  // --- pipe maze -----------------------------------------------------------
  for (let i = 0; i < 8; i++) {
    const x = -44 + i * 3.4;
    b.box(x, 1.6, 4 + (i % 3) * 3, 0.5, 3.2, 0.5, { mat: M });
    b.prop('pipe_run', x, 3.4, 6, { yaw: 0 });
  }
  b.prop('barrier', -40, 0, -6, { yaw: 0.2 });
  b.prop('barrier', -37.4, 0, -6.6, { yaw: 0.5 });
  b.prop('jersey', -42, 0, -14, { yaw: 0.1 });
  b.prop('dumpster', -44, 0, 20, { yaw: 0.4 });

  // --- yard clutter --------------------------------------------------------
  b.prop('van', 40, 0, -30, { yaw: 0.3 });
  b.prop('car', 44, 0, -22, { yaw: -0.2 });
  b.prop('van', -44, 0, -32, { yaw: 1.4 });
  b.propLine('streetlight', -40, 36, 40, 36, 5, 0, {});
  for (let i = 0; i < 5; i++) b.light('point', -40 + i * 20, 6.2, 36, { color: 0xfff0c8, intensity: 5, distance: 22, fixture: 'street' });
  for (let i = 0; i < 12; i++) {
    b.prop(['barrel', 'fuel_drum', 'tire_stack', 'pallet', 'cone'][Math.floor(rng() * 5)],
      -46 + rng() * 92, 0, -38 + rng() * 76, { yaw: rng() * 6.28, solid: rng() > 0.25 });
  }
  b.prop('debris_pile', 26, 0, 26, { yaw: 0.7 });
  b.prop('rubble', 30, 0, 22, { yaw: 1.9 });

  // small pump house
  b.room(30, 30, 10, 9, 3.2, { doors: [{ side: 'w', at: 0.4 }], windows: [{ side: 'n', at: 0.5, gap: 2.4 }], mat: C, ceil: true, reverb: 'room' });
  b.light('point', 30, 2.9, 30, { color: 0xd8f0ff, intensity: 4, distance: 11, flicker: 0.3 });
  b.prop('generator', 32, 0, 31, { yaw: Math.PI });

  // --- spawns / sites ------------------------------------------------------
  b.spawn('alpha', -42, 0, -34, 0.6);
  b.spawn('alpha', -38, 0, -30, 0.6);
  b.spawn('alpha', -44, 0, -26, 0.6);
  b.spawn('alpha', -34, 0, -36, 0.6);
  b.spawn('bravo', 42, 0, 34, -2.5);
  b.spawn('bravo', 38, 0, 30, -2.5);
  b.spawn('bravo', 44, 0, 26, -2.5);
  b.spawn('bravo', 34, 0, 36, -2.5);
  b.spawn('ffa', 14, 0, 0, 0);
  b.spawn('ffa', -24, CR, -18, 1.5);
  b.spawn('ffa', 0, CW, -12, 0);
  b.spawn('ffa', -30, 0, 14, 2.0);
  b.spawn('ffa', 30, 0, 30, 3.0);
  b.spawn('ffa', -42, 0, 6, 0.4);

  b.site('A', 14, 0, 0, 4.0);
  b.site('B', -26, 0, 20, 4.0);

  b.ambient('machinery', 14, 3, 0, 30, 0.5);
  b.ambient('steam', -30, 3, 14, 16, 0.45);
  b.ambient('wind', 0, 10, 0, 80, 0.3);
  b.ambient('electric_hum', -24, 6, -18, 12, 0.35);
  return b.build();
}
