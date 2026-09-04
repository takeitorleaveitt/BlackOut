import { MapBuilder } from './kit.js';
import { SURFACE } from '../constants.js';

/**
 * DISTRICT 9 — the sole Siege map. A two-floor building attackers (Tan)
 * assault from three sides while defenders (Blue) hold one of two sites on
 * the top floor. A single stairwell (south end) is the only way up.
 *
 * Floor 1: y 0 .. 3.2, open hall + cover, three exterior doorways.
 * Floor 2: y 3.35 .. 6.55, split by a central wall into Site ALPHA (west)
 * and Site BRAVO (east), joined by one doorway; the stairwell opens into
 * the hallway south of that wall.
 */
export function buildDistrict9() {
  const b = new MapBuilder({
    key: 'district9',
    name: 'District 9',
    subtitle: 'Siege — Two-Floor Compound',
    desc: 'Tan attacks from three sides. Blue holds Site Alpha or Site Bravo on the top floor — the only way up is the south stairwell.',
    size: [48, 48],
    env: {
      sky: 'overcast',
      sunDir: [0.35, 0.75, 0.25],
      sunColor: 0xcdd6de, sunIntensity: 1.05,
      ambientColor: 0x4a525c, ambientIntensity: 1.3,
      hemiGround: 0x23211d,
      fog: { color: 0x555f68, near: 20, far: 95 },
      exposure: 1.1,
      reverb: 'hall',
      wind: 0.5, rain: 0, dustMotes: 0.5
    }
  });

  const C = SURFACE.CONCRETE, P = SURFACE.PLASTER, M = SURFACE.METAL, W = SURFACE.WOOD;
  const F1_Y = 0, F1_H = 3.2;
  const F2_Y = 3.35, F2_H = 3.2;

  // --- ground plane around the building (attackers cross open yard) -------
  b.floor(0, 0, 90, 90, -0.02, SURFACE.DIRT, 0.6);

  // --- floor 1 slab + exterior shell, three attacker doorways -------------
  b.floor(0, 0, 24, 20, F1_Y, C, 0.4);
  b.wallDoor(-12, -10, 12, -10, F1_H, 0.5, 3.0, { mat: C, thick: 0.32 });          // north wall — door
  b.wallDoor(-12, -10, -12, 10, F1_H, 0.72, 2.6, { mat: C, thick: 0.32 });         // west wall — door (south end)
  b.wallDoor(12, -10, 12, 10, F1_H, 0.72, 2.6, { mat: C, thick: 0.32 });           // east wall — door (south end)
  b.wall(-12, 10, 12, 10, F1_H, { mat: C, thick: 0.32 });                          // south wall — solid

  // floor 1 interior cover
  b.prop('crate_large', -6, F1_Y, -2, { yaw: 0.3 });
  b.prop('crate_large', 6, F1_Y, -2, { yaw: -0.3 });
  b.prop('shelf_rack', -9, F1_Y, 6, { yaw: 1.5708 });
  b.prop('shelf_rack', 9, F1_Y, 6, { yaw: -1.5708 });
  b.prop('crate_wood', -2.5, F1_Y, 4, { yaw: 0.2 });
  b.prop('crate_wood', 2.5, F1_Y, 4, { yaw: -0.2 });
  b.prop('sandbags', 0, F1_Y, -6, { yaw: 0 });
  b.prop('pillar_round', -6, F1_Y, 0, {});
  b.prop('pillar_round', 6, F1_Y, 0, {});
  b.light('point', 0, F1_H - 0.3, 0, { color: 0xdfe8f0, intensity: 1.3, distance: 22, shadow: true });
  b.light('point', -8, F1_H - 0.3, -6, { color: 0xd8e0ec, intensity: 1.0, distance: 14 });
  b.light('point', 8, F1_H - 0.3, -6, { color: 0xd8e0ec, intensity: 1.0, distance: 14 });
  b.light('point', 0, F1_H - 0.3, 6, { color: 0xe8dcc0, intensity: 1.0, distance: 14 });
  b.zone(0, F1_H / 2, 0, 24, F1_H, 20, 'hall');

  // --- stairwell: rises from floor 1 south end into the floor-2 hallway ---
  b.stairs(0, F1_Y, -10, 3.0, 'z', 16, F2_Y - F1_Y, 4.0, C);
  b.wall(-1.5, -10, -1.5, -6, F2_H + F2_Y - F1_Y, { mat: C, thick: 0.2, y: F1_Y });   // stairwell side rail
  b.wall(1.5, -10, 1.5, -6, F2_H + F2_Y - F1_Y, { mat: C, thick: 0.2, y: F1_Y });
  b.light('point', 0, 1.8, -8, { color: 0xc8d4e0, intensity: 0.9, distance: 10 });

  // --- floor 2 slab, with a stairwell opening at the south end ------------
  b.floor(0, 2, 24, 16, F2_Y, C, 0.3);            // main slab, z: -6..10
  // (z: -10..-6 is left open above the stairwell)

  // floor 2 exterior shell (no exterior doors up here — the stairwell is
  // the only way up)
  b.wall(-12, -6, 12, -6, F2_H, { mat: C, thick: 0.32, y: F2_Y });
  b.wall(-12, -6, -12, 10, F2_H, { mat: C, thick: 0.32, y: F2_Y });
  b.wall(12, -6, 12, 10, F2_H, { mat: C, thick: 0.32, y: F2_Y });
  b.wall(-12, 10, 12, 10, F2_H, { mat: C, thick: 0.32, y: F2_Y });
  b.ceiling(0, 2, 24, 16, F2_Y + F2_H, M, 0.35);

  // central divider — Site Alpha (west) / Site Bravo (east), one doorway
  b.wallDoor(0, -6, 0, 10, F2_H, 0.75, 2.4, { mat: P, thick: 0.2, y: F2_Y });

  // site rooms: light interior dressing, no full sub-walls (keeps sightlines
  // readable and avoids boxing either site into an unreachable corner)
  b.prop('crate_metal', -8, F2_Y, 5, { yaw: 0.4 });
  b.prop('locker', -10.5, F2_Y, -3, { yaw: 1.5708 });
  b.prop('desk', -7, F2_Y, -2, { yaw: 0.2 });
  b.prop('cabinet', 10.3, F2_Y, 6, { yaw: -1.5708 });
  b.prop('crate_wood', 8, F2_Y, -2, { yaw: -0.3 });
  b.prop('table', 6.5, F2_Y, 5, { yaw: 0 });
  b.wallWindow(-12, 2, -12, -1, F2_H, { mat: C, thick: 0.28, y: F2_Y, sill: 1.0, top: 2.3 });
  b.wallWindow(12, 2, 12, -1, F2_H, { mat: C, thick: 0.28, y: F2_Y, sill: 1.0, top: 2.3 });
  b.light('point', -6, F2_Y + F2_H - 0.3, 2, { color: 0xf0e6c8, intensity: 1.3, distance: 16, shadow: true });
  b.light('point', 6, F2_Y + F2_H - 0.3, 2, { color: 0xf0e6c8, intensity: 1.3, distance: 16, shadow: true });
  b.light('point', 0, F2_Y + F2_H - 0.3, 8, { color: 0xd8e0ec, intensity: 0.9, distance: 10 });
  b.zone(-6, F2_Y + F2_H / 2, 2, 11, F2_H, 15, 'office');
  b.zone(6, F2_Y + F2_H / 2, 2, 11, F2_H, 15, 'office');

  b.site('ALPHA', -6, F2_Y, 2, 3.4, { floor: 2 });
  b.site('BRAVO', 6, F2_Y, 2, 3.4, { floor: 2 });

  // --- attacker exteriors: three approach sides ----------------------------
  for (const [x, z] of [[-3, -16], [0, -17], [3, -16]]) b.spawn('bravo', x, 0, z, 0, { side: 'north' });
  for (const [x, z] of [[-17, 3], [-18, 5.5], [-17, 8]]) b.spawn('bravo', x, 0, z, -1.5708, { side: 'west' });
  for (const [x, z] of [[17, 3], [18, 5.5], [17, 8]]) b.spawn('bravo', x, 0, z, 1.5708, { side: 'east' });

  // --- defender interior: floor 1 or floor 2 landing -----------------------
  for (const [x, z] of [[-2, 6], [0, 7], [2, 6]]) b.spawn('alpha', x, F1_Y, z, Math.PI, { floor: 1 });
  for (const [x, z] of [[-2, -4], [0, -3], [2, -4]]) b.spawn('alpha', x, F2_Y, z, Math.PI, { floor: 2 });

  b.spawn('ffa', 0, F1_Y, 0, 0);

  b.ambient('wind', 0, 6, 0, 40, 0.5);
  b.ambient('electric_hum', -6, 5, 2, 14, 0.35);
  b.ambient('electric_hum', 6, 5, 2, 14, 0.35);
  return b.build();
}
