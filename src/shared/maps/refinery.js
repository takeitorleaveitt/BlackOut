import { MapBuilder } from './kit.js';
import { SURFACE } from '../constants.js';

/**
 * REFINERY — daylight petrochemical plant.
 *
 * The landmarks are the ones it always had: a process hall under catwalks, a
 * glass-fronted control room, a tank farm and a pipe maze. What it did not
 * have was any relationship between them. The tanks sat at four arbitrary
 * points, the "pipe maze" was a single row of eight posts, twelve props were
 * placed by a random number generator across the whole 96 by 80 metres, and
 * the two spawns faced each other down the longest open diagonal on the map.
 *
 * Same four landmarks, arranged so they mean something. The map runs west to
 * east between the spawns, with three routes:
 *
 *   NORTH   the tank farm — four tanks on a grid with lanes between them,
 *           into the shadow under the control room and on to the hall
 *   MIDDLE  the plant yard — open, fast, and overlooked by the control room
 *           glass, which is the price of using it
 *   SOUTH   the pipe maze — an actual maze now, tight and blind, the flank
 *
 * The catwalk is a fourth route above all three: it runs from the control
 * room's back door out over the yard and into the hall's ring, with stairs at
 * both ends. Taking the high ground means giving up the ability to leave it
 * quickly, which is the trade the map is built around.
 */
export function buildRefinery() {
  const b = new MapBuilder({
    key: 'refinery',
    name: 'Refinery',
    subtitle: 'Petrochemical Facility — Midday',
    desc: 'Tank farm, plant yard and pipe maze run end to end, with a catwalk over all three. The control room sees everything and can leave from nowhere.',
    size: [96, 80],
    compact: false,
    env: {
      sky: 'day',
      sunDir: [0.45, 0.82, 0.35],
      sunColor: 0xfff3dd, sunIntensity: 4.4,
      ambientColor: 0xb8c6dc, ambientIntensity: 2.4,
      hemiGround: 0x7a7364,
      fog: { color: 0xb9c2cc, near: 80, far: 260 },
      exposure: 1.44,
      reverb: 'outdoor',
      wind: 0.6, rain: 0, dustMotes: 0.0, heatHaze: 0.0
    }
  });

  const M = SURFACE.METAL, C = SURFACE.CONCRETE;

  // --- footprints ----------------------------------------------------------
  // Every landmark gets an x/z band and nothing overlaps anything else. Writing
  // them down is the whole trick: the first pass at this map put a staircase
  // through a storage tank and another one underneath the deck it was meant to
  // reach, because the pieces were positioned one at a time by eye.
  //
  //   spawn compounds   x +/-40..48   z -18..18
  //   tank farm         x -37..-16    z -26..-16      deck at 6.5
  //   control room      x  -8..6      z -20..-8       floor at 5.4
  //   pipe maze         x -37..2      z  10..30
  //   pump house        x  -8..3      z  28..37
  //   process hall      x  12..40     z -26..26       catwalk at 5.2
  const Z_TANKS = -21, Z_YARD = 0, Z_PIPES = 20;
  const CW = 5.2, CR = 5.4, DECK_Y = 6.5;

  b.floor(0, 0, 96, 80, 0, C, 0.8);
  b.floor(0, Z_TANKS, 96, 22, 0.03, SURFACE.GRAVEL, 0.1);

  b.wall(-48, -40, 48, -40, 5.0, { mat: M });
  b.wall(-48, 40, 48, 40, 5.0, { mat: M });
  b.wall(-48, -40, -48, 40, 5.0, { mat: M });
  b.wall(48, -40, 48, 40, 5.0, { mat: M });

  // Deck plus a handrail down EACH edge. The original put a single rail along
  // the segment's centreline, which split the walkway into two strips with a
  // barrier between them — standable, barely, and useless to a pathfinder.
  //
  // `gaps` is a list of { at, w } along the segment where a rail is left out —
  // that is where a staircase arrives. A continuous rail is a wall across the
  // top step, which is exactly what stopped anything reaching the ring: the
  // flight climbed correctly and then delivered you into a handrail.
  const cwSeg = (x1, z1, x2, z2, w = 2.6, y = CW, gaps = []) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const yaw = -Math.atan2(z2 - z1, x2 - x1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const px = -(z2 - z1) / (len || 1), pz = (x2 - x1) / (len || 1);
    const dx = (x2 - x1) / (len || 1), dz = (z2 - z1) / (len || 1);
    b.brushes.push({ p: [cx, y - 0.1, cz], s: [len, 0.2, w], yaw, mat: M, solid: true });
    // Rail runs, split around the gaps, as spans of the 0..1 parameter.
    const cuts = gaps
      .map((g) => ({ a: Math.max(0, g.at - g.w / (2 * len)), b: Math.min(1, g.at + g.w / (2 * len)) }))
      .sort((a, c) => a.a - c.a);
    const runs = [];
    let cur = 0;
    for (const c of cuts) {
      if (c.a > cur + 0.001) runs.push([cur, c.a]);
      cur = Math.max(cur, c.b);
    }
    if (cur < 0.999) runs.push([cur, 1]);
    for (const sgn of [-1, 1]) {
      for (const [t0, t1] of runs) {
        const rl = (t1 - t0) * len;
        if (rl < 0.2) continue;
        const mt = (t0 + t1) / 2;
        b.brushes.push({
          p: [x1 + dx * len * mt + px * sgn * (w / 2), y + 0.5, z1 + dz * len * mt + pz * sgn * (w / 2)],
          s: [rl, 1.0, 0.08], yaw, mat: M, opaque: false, solid: true
        });
      }
    }
  };

  // --- process hall (east) -------------------------------------------------
  const HX0 = 12, HX1 = 40, HX = (HX0 + HX1) / 2, HH = 11;
  b.floor(HX, 0, HX1 - HX0, 52, 0.06, C, 0.3);
  b.ceiling(HX, 0, HX1 - HX0 + 1, 53, HH, M, 0.5);
  b.zone(HX, HH / 2, 0, HX1 - HX0, HH, 52, 'hall');
  // One door per route, so the lane you took decides which door you come in by.
  b.wallOpenings(HX0, -26, HX0, 26, HH,
    [Z_TANKS, Z_YARD, Z_PIPES].map((z) => ({ at: (z + 26) / 52, gap: 5.0, kind: 'door', doorH: 4.5 })),
    { mat: M, thick: 0.35 });
  b.wall(HX1, -26, HX1, 26, HH, { mat: M, thick: 0.35 });
  b.wallDoor(HX0, -26, HX1, -26, HH, 0.5, 4.0, { mat: M, thick: 0.35, doorH: 3.6 });
  b.wallDoor(HX0, 26, HX1, 26, HH, 0.5, 4.0, { mat: M, thick: 0.35, doorH: 3.6 });

  // Two rows of process gear leave a centre lane and two side lanes.
  for (const z of [-13, 13]) {
    for (let i = 0; i < 4; i++) {
      const x = HX0 + 4 + i * 6.5;
      b.box(x, 1.5, z, 3.0, 3.0, 3.0, { mat: M });
      b.prop('fuel_drum', x + 2.4, 0.06, z + (i % 2 ? 2.2 : -2.2), {});
    }
    b.prop('pipe_run', HX, 3.6, z, { yaw: Math.PI / 2 });
  }
  b.prop('crate_metal', HX0 + 2.5, 0.06, 0, { yaw: 0.2 });
  b.prop('crate_metal', HX0 + 2.5, 0.86, 0, { yaw: 0.9 });
  b.prop('shelf_rack', HX1 - 2, 0.06, 6, { yaw: Math.PI / 2 });
  b.prop('sandbags', HX - 2, 0.06, -3, { yaw: 0 });
  b.prop('sandbags', HX - 0.4, 0.06, -3, { yaw: 0 });
  b.prop('generator', HX1 - 3, 0.06, -20, { yaw: -Math.PI / 2 });
  b.prop('generator', HX1 - 3, 0.06, 20, { yaw: -Math.PI / 2 });

  // Catwalk ring against the hall's east wall, with a flight at each end that
  // lands ON the deck's near edge rather than under it.
  const CWX = HX1 - 3;                       // ring centreline
  const CW_EDGE = CWX - 1.3;                 // its west edge, where stairs land
  cwSeg(HX0 + 3, -21, CWX, -21, 2.6, CW, [{ at: 0.02, w: 3.4 }]);
  cwSeg(HX0 + 3, 21, CWX, 21);
  cwSeg(CWX, -21, CWX, 21, 2.6, CW, [{ at: ((-8) + 21) / 42, w: 3.2 }, { at: (8 + 21) / 42, w: 3.2 }]);
  b.stairs(CW_EDGE - 7.5, 0.06, -8, 2.4, 'x', 18, CW - 0.06, 7.5, M);
  b.stairs(CW_EDGE - 7.5, 0.06, 8, 2.4, 'x', 18, CW - 0.06, 7.5, M);
  b.prop('sandbags', CWX, CW, -21, { yaw: 0 });
  b.prop('sandbags', CWX, CW, 21, { yaw: 0 });

  for (const z of [-17, 0, 17]) {
    b.light('point', HX, HH - 1.6, z, { color: 0xfff6e0, intensity: 26, distance: 26, shadow: z === 0 });
    b.box(HX, HH - 0.2, z, 20, 0.12, 2.4, { mat: SURFACE.GLASS, solid: false, opaque: false });
  }

  // --- control room (centre-north) -----------------------------------------
  // Glass south onto the yard, stairs up its north face out of the tank lane,
  // catwalk east to the hall ring. It sees the middle route end to end and
  // every way out of it is slow.
  const CRX = -1, CRZ = -14, CRW = 14, CRD = 12;
  const CR_N = CRZ - CRD / 2, CR_E = CRX + CRW / 2;
  b.box(CRX, CR - 0.2, CRZ, CRW, 0.4, CRD, { mat: C });
  b.room(CRX, CRZ, CRW, CRD, 3.2, {
    y: CR,
    doors: [{ side: 'n', at: 0.5, gap: 2.2 }, { side: 'e', at: 0.5, gap: 2.2 }],
    windows: [{ side: 's', at: 0.5, gap: 10, sill: 0.9, top: 2.6 }],
    mat: C, floor: false, ceil: true, reverb: 'office'
  });
  // Climbs the open tank lane and stops at the slab's north edge.
  b.stairs(CRX, 0.03, CR_N - 7.5, 2.4, 'z', 18, CR - 0.03, 7.5, M);
  for (const dx of [-4, 0, 4]) {
    b.prop('desk', CRX + dx, CR, CRZ + 3.4, { yaw: Math.PI });
    b.prop('monitor', CRX + dx, CR + 0.74, CRZ + 3.6, { yaw: Math.PI, solid: false });
  }
  b.prop('office_chair', CRX, CR, CRZ + 2.0, { yaw: 0 });
  b.prop('cabinet', CRX - 5.8, CR, CRZ - 3.6, { yaw: Math.PI / 2 });
  b.light('point', CRX, CR + 2.9, CRZ, { color: 0xdce8ff, intensity: 6, distance: 15 });
  b.zone(CRX, CR + 1.6, CRZ, CRW, 3.2, CRD, 'office');

  // Spur east to the hall ring: control room -> over the yard -> north segment.
  cwSeg(CR_E, CRZ, HX0 + 3, CRZ, 3.0, CW, [{ at: 0, w: 3.4 }, { at: 1, w: 3.4 }]);
  cwSeg(HX0 + 3, CRZ, HX0 + 3, -21, 3.0, CW, [{ at: 1, w: 3.4 }, { at: 0, w: 3.4 }]);
  b.box(CR_E + 0.6, CR - 0.3, CRZ, 2.0, 0.3, 3.0, { mat: M });

  // --- tank farm (north route) ---------------------------------------------
  // Two tanks with a walkable gap between them, a deck across the top, and the
  // flight up sitting IN that gap so it never has to pass through a tank.
  const TR = 4.6, TANK_H = 6.4;
  const TANKS = [-32, -20];
  for (const tx of TANKS) {
    b.box(tx, TANK_H / 2, Z_TANKS, TR * 2, TANK_H, TR * 2, { mat: M });
    b.light('point', tx, TANK_H + 0.9, Z_TANKS, { color: 0xff5a3c, intensity: 3, distance: 8, flicker: 0.9 });
  }
  const GAP_X = (TANKS[0] + TANKS[1]) / 2;          // -26, the lane between them
  b.box(-26, DECK_Y, Z_TANKS, 24, 0.3, 5.0, { mat: M });          // deck over both
  b.stairs(GAP_X, 0.03, Z_TANKS - 11.5, 2.4, 'z', 20, DECK_Y + 0.12, 9.0, M);
  b.prop('pipe_run', -26, 3.2, Z_TANKS - 6, { yaw: Math.PI / 2 });
  b.prop('barrel', -14.6, 0, Z_TANKS - 1.2, {});
  b.prop('barrel', -13.8, 0, Z_TANKS - 0.4, {});
  b.prop('fuel_drum', -38, 0, Z_TANKS + 2.0, {});
  b.prop('jersey', -12, 0, Z_TANKS - 4.5, { yaw: 0 });
  b.prop('sandbags', -30, DECK_Y + 0.15, Z_TANKS, { yaw: 0 });
  b.prop('sandbags', -22, DECK_Y + 0.15, Z_TANKS, { yaw: 0 });

  // --- pipe maze (south route) ---------------------------------------------
  // Banks with staggered gaps, so crossing means committing to a slot and you
  // cannot see down the next one until you are in it.
  for (let i = 0; i < 5; i++) {
    const x = -35 + i * 9;
    const gapZ = Z_PIPES + (i % 2 ? 5 : -5);
    b.box(x, 1.1, gapZ - 9.5, 1.0, 2.2, 9, { mat: M });
    b.box(x, 1.1, gapZ + 4.5, 1.0, 2.2, 9, { mat: M });
    b.prop('pipe_run', x, 2.4, gapZ, { yaw: 0 });
  }
  b.prop('barrier', -30, 0, Z_PIPES - 8, { yaw: 0.1 });
  b.prop('barrier', -12, 0, Z_PIPES + 8, { yaw: 0.1 });
  b.prop('dumpster', -21, 0, Z_PIPES + 11, { yaw: 0.02 });
  b.prop('tire_stack', 6, 0, Z_PIPES - 2, {});
  b.prop('tire_stack', 6.1, 0.8, Z_PIPES - 2.1, {});

  b.room(-3, 32, 11, 9, 3.2, {
    doors: [{ side: 'w', at: 0.5, gap: 1.8 }, { side: 'e', at: 0.5, gap: 1.8 }],
    windows: [{ side: 'n', at: 0.5, gap: 3.0 }],
    mat: C, ceil: true, reverb: 'room'
  });
  b.light('point', -3, 2.9, 32, { color: 0xd8f0ff, intensity: 5, distance: 12, flicker: 0.3 });
  b.prop('generator', -0.6, 0, 34, { yaw: Math.PI });

  // --- the yard (middle route) ---------------------------------------------
  // The most open of the three, with cover only where you have to cross.
  b.prop('van', -30, 0, Z_YARD + 2, { yaw: 0.04 });
  b.prop('car', -16, 0, Z_YARD - 3, { yaw: -0.1 });
  b.prop('crate_stack', -22, 0, Z_YARD + 4, {});
  b.prop('crate_large', -21, 0, Z_YARD + 6, { yaw: 0.4 });
  b.prop('sandbags', 4, 0, Z_YARD + 3, { yaw: 0 });
  b.prop('sandbags', 5.6, 0, Z_YARD + 3, { yaw: 0 });
  b.prop('debris_pile', 7, 0, Z_YARD - 5, { yaw: 0.7 });
  b.prop('rubble', 9.5, 0, Z_YARD - 6.5, { yaw: 1.9 });
  for (const x of [-30, -10]) {
    b.prop('barrier', x, 0, Z_TANKS + 12, { yaw: 0 });
    b.prop('barrier', x, 0, Z_PIPES - 12, { yaw: 0 });
  }

  // --- spawn compounds -----------------------------------------------------
  const spawnYard = (sx) => {
    const inner = sx * 40, outer = sx * 48, cx = (inner + outer) / 2, H = 4.6;
    b.floor(cx, 0, 8, 36, 0.04, C, 0.3);
    b.ceiling(cx, 0, 8, 36, H, M, 0.4);
    b.zone(cx, H / 2, 0, 8, H, 36, 'room');
    b.wall(outer, -18, outer, 18, H, { mat: M, thick: 0.35 });
    b.wallDoor(inner, -18, outer, -18, H, 0.5, 3.2, { mat: M, thick: 0.3, doorH: 3.2 });
    b.wallDoor(inner, 18, outer, 18, H, 0.5, 3.2, { mat: M, thick: 0.3, doorH: 3.2 });
    b.wallOpenings(inner, -18, inner, 18, H,
      [-12, 0, 12].map((z) => ({ at: (z + 18) / 36, gap: 4.0, kind: 'door', doorH: 3.4 })),
      { mat: M, thick: 0.3 });
    b.light('point', cx, H - 1.1, -10, { color: 0xffeccc, intensity: 9, distance: 18 });
    b.light('point', cx, H - 1.1, 10, { color: 0xffeccc, intensity: 9, distance: 18 });
    b.prop('crate_large', cx + sx * 1.8, 0, -14, { yaw: 0.2 });
    b.prop('crate_stack', cx + sx * 1.9, 0, 14, {});
    b.prop('barrel', cx - sx * 1.4, 0, 4, {});
  };
  spawnYard(-1);
  spawnYard(1);

  b.propLine('streetlight', -40, 36, 40, 36, 5, 0, {});
  for (let i = 0; i < 5; i++) {
    b.light('point', -40 + i * 20, 6.2, 36, { color: 0xfff0c8, intensity: 6, distance: 22, fixture: 'street' });
  }

  // --- spawns / sites ------------------------------------------------------
  b.spawn('alpha', -44, 0, -10, Math.PI / 2);
  b.spawn('alpha', -44, 0, -3, Math.PI / 2);
  b.spawn('alpha', -44, 0, 3, Math.PI / 2);
  b.spawn('alpha', -44, 0, 10, Math.PI / 2);
  b.spawn('bravo', 44, 0, -10, -Math.PI / 2);
  b.spawn('bravo', 44, 0, -3, -Math.PI / 2);
  b.spawn('bravo', 44, 0, 3, -Math.PI / 2);
  b.spawn('bravo', 44, 0, 10, -Math.PI / 2);

  b.spawn('ffa', HX, 0, 0, Math.PI / 2);
  b.spawn('ffa', -26, 0, Z_TANKS, -Math.PI / 2);
  b.spawn('ffa', -22, 0, Z_PIPES, -Math.PI / 2);
  b.spawn('ffa', CRX, CR, CRZ, Math.PI);
  b.spawn('ffa', CWX, CW, 0, Math.PI / 2);
  b.spawn('ffa', -3, 0, 32, 0);
  b.spawn('ffa', -26, DECK_Y + 0.15, Z_TANKS, 0);
  b.spawn('ffa', 6, 0, Z_YARD, -Math.PI / 2);

  b.site('A', HX, 0, 0, 4.0);
  b.site('B', -26, 0, Z_TANKS, 4.0);

  b.ambient('machinery', HX, 3, 0, 30, 0.5);
  b.ambient('steam', -26, 3, Z_TANKS, 18, 0.45);
  b.ambient('wind', 0, 10, 0, 80, 0.3);
  b.ambient('electric_hum', CRX, CR + 1, CRZ, 14, 0.35);
  return b.build();
}
