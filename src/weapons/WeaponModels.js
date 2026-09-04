// Procedural first-person weapon models.
//
// Each gun is a Group with *named* sub-objects so the view model can animate
// them individually: the magazine drops out on a reload, the charging handle
// cycles, the bolt reciprocates, the optic sits on its own rail. Proportions,
// materials and silhouettes differ per weapon so they read apart instantly.

import * as THREE from 'three';

const M = {
  polymer: new THREE.MeshStandardMaterial({ color: 0x1e2124, roughness: 0.72, metalness: 0.08 }),
  polymerTan: new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 0.74, metalness: 0.06 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.38, metalness: 0.86 }),
  steelWorn: new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.3, metalness: 0.92 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.66, metalness: 0.04 }),
  black: new THREE.MeshStandardMaterial({ color: 0x131517, roughness: 0.6, metalness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x203040, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.35, metalness: 0.9 })
};

const b = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const c = (r1, r2, h, s = 10) => new THREE.CylinderGeometry(r1, r2, h, s);

function part(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** Picatinny rail teeth — cheap detail that reads well up close. */
function railStack(group, len, y, z0, mat = M.black) {
  for (let i = 0; i < Math.floor(len / 0.022); i++) {
    group.add(part(b(0.028, 0.006, 0.012), mat, 0, y, z0 - i * 0.022));
  }
}

// Peep-and-post iron sights. Both ends sit on the weapon's centreline (x=0)
// at the same height the ADS pose centres on (see `ironHeight` below), so
// once aimed the rear aperture and front post land stacked under the
// crosshair with a real hole to look through — guns without an optic used
// to have no sight geometry at all, so ADS just zoomed the receiver up to
// fill the screen with nothing to actually aim with.
function ironSights(g, y, rearZ, frontZ, mat = M.steelWorn) {
  g.add(part(c(0.015, 0.015, 0.004, 8), mat, 0, y, rearZ, Math.PI / 2));   // rear aperture housing (disc)
  g.add(part(c(0.008, 0.008, 0.005, 8), M.black, 0, y, rearZ, Math.PI / 2)); // the actual peep hole
  g.add(part(b(0.006, 0.020, 0.012), mat, -0.017, y, rearZ));             // housing ears
  g.add(part(b(0.006, 0.020, 0.012), mat, 0.017, y, rearZ));
  g.add(part(b(0.022, 0.006, 0.016), mat, 0, y - 0.011, frontZ));         // front sight base
  g.add(part(b(0.006, 0.026, 0.006), M.black, 0, y + 0.005, frontZ));     // front post
}

/** Notch-and-post for pistols — same centreline convention as ironSights(). */
function pistolSights(g, y, rearZ, frontZ, mat = M.steelWorn) {
  g.add(part(b(0.026, 0.008, 0.010), mat, 0, y, rearZ));
  g.add(part(b(0.007, 0.010, 0.011), M.black, -0.008, y + 0.002, rearZ)); // notch walls
  g.add(part(b(0.007, 0.010, 0.011), M.black, 0.008, y + 0.002, rearZ));
  g.add(part(b(0.005, 0.018, 0.006), M.black, 0, y + 0.006, frontZ));     // front post
}

const BUILD = {
  m4a1(g) {
    g.add(part(b(0.062, 0.085, 0.30), M.polymer, 0, 0, -0.02));                 // lower receiver
    g.add(part(b(0.05, 0.055, 0.26), M.polymer, 0, 0.052, -0.10));              // upper receiver
    railStack(g, 0.24, 0.084, -0.02);
    g.add(part(c(0.014, 0.014, 0.40), M.steel, 0, 0.035, -0.36, Math.PI / 2));  // barrel
    g.add(part(b(0.056, 0.056, 0.24), M.polymer, 0, 0.035, -0.28));             // quad-rail handguard
    g.add(part(b(0.062, 0.062, 0.02), M.steel, 0, 0.035, -0.56));
    g.add(part(c(0.018, 0.020, 0.06, 8), M.black, 0, 0.035, -0.585, Math.PI / 2)); // flash hider
    g.add(part(b(0.05, 0.12, 0.05), M.polymer, 0, -0.10, 0.03, 0.22));          // pistol grip
    g.add(part(b(0.036, 0.036, 0.16), M.polymer, 0, -0.005, 0.16));             // buffer tube
    g.add(part(b(0.06, 0.09, 0.11), M.polymer, 0, -0.01, 0.21));                // collapsible stock
    g.add(part(b(0.055, 0.10, 0.03), M.polymer, 0, -0.015, 0.28));              // butt pad
    g.add(part(b(0.03, 0.055, 0.02), M.steel, 0, -0.055, -0.03));               // trigger guard
    g.add(part(b(0.010, 0.020, 0.014), M.black, -0.032, -0.015, 0.005));        // selector switch
    g.add(part(b(0.024, 0.024, 0.010), M.steel, 0, -0.02, 0.30));               // sling loop
    ironSights(g, 0.086, 0.02, -0.40);
    g.name = 'm4a1';
  },
  ak74(g) {
    g.add(part(b(0.066, 0.10, 0.28), M.steel, 0, 0, -0.01));
    g.add(part(b(0.058, 0.05, 0.20), M.wood, 0, 0.05, -0.24));                  // upper handguard
    g.add(part(b(0.062, 0.062, 0.22), M.wood, 0, -0.008, -0.24));               // lower handguard
    g.add(part(c(0.015, 0.015, 0.42), M.steel, 0, 0.03, -0.40, Math.PI / 2));
    g.add(part(c(0.023, 0.026, 0.075, 8), M.steel, 0, 0.03, -0.60, Math.PI / 2)); // muzzle brake
    g.add(part(b(0.03, 0.06, 0.05), M.steel, 0, 0.07, -0.30));                  // gas block
    g.add(part(b(0.048, 0.13, 0.05), M.wood, 0, -0.11, 0.02, 0.20));            // grip
    g.add(part(b(0.05, 0.075, 0.24), M.wood, 0, -0.02, 0.20, -0.06));           // fixed stock
    g.add(part(b(0.055, 0.10, 0.025), M.black, 0, -0.032, 0.315, -0.06));
    g.add(part(b(0.028, 0.05, 0.02), M.steel, 0, -0.06, -0.02));
    g.add(part(b(0.012, 0.052, 0.10), M.steel, -0.037, 0.02, 0.02, 0, 0, 0.15)); // AK safety lever
    g.add(part(b(0.026, 0.026, 0.012), M.steel, 0, -0.03, 0.34));               // sling loop
    ironSights(g, 0.086, 0.06, -0.36);
    g.name = 'ak74';
  },
  mp5(g) {
    g.add(part(b(0.056, 0.082, 0.26), M.polymer, 0, 0, -0.01));
    g.add(part(c(0.03, 0.03, 0.20, 12), M.polymer, 0, 0.012, -0.22, Math.PI / 2)); // tri-lug handguard
    g.add(part(c(0.012, 0.012, 0.22), M.steel, 0, 0.012, -0.28, Math.PI / 2));
    g.add(part(c(0.017, 0.017, 0.03, 8), M.steel, 0, 0.012, -0.395, Math.PI / 2));
    g.add(part(b(0.044, 0.11, 0.05), M.polymer, 0, -0.09, 0.02, 0.18));
    g.add(part(b(0.03, 0.03, 0.20), M.steel, 0, 0.0, 0.16));                    // retractable stock rod
    g.add(part(b(0.05, 0.07, 0.03), M.polymer, 0, 0.0, 0.27));
    g.add(part(c(0.014, 0.014, 0.07, 8), M.steel, 0.028, 0.03, -0.16, 0, 0, 0.4)); // cocking tube
    g.add(part(b(0.028, 0.05, 0.02), M.steel, 0, -0.05, -0.02));
    g.add(part(b(0.010, 0.018, 0.012), M.black, -0.030, -0.01, 0.0));           // selector switch
    g.add(part(b(0.022, 0.022, 0.010), M.steel, 0, 0.03, 0.02));                // sling loop
    ironSights(g, 0.086, 0.02, -0.32);
    g.name = 'mp5';
  },
  mp7(g) {
    g.add(part(b(0.05, 0.075, 0.20), M.polymer, 0, 0, 0.0));
    g.add(part(b(0.044, 0.04, 0.14), M.polymer, 0, 0.045, -0.10));
    railStack(g, 0.14, 0.068, -0.04);
    g.add(part(c(0.010, 0.010, 0.18), M.steel, 0, 0.028, -0.19, Math.PI / 2));
    g.add(part(b(0.04, 0.04, 0.09), M.polymer, 0, 0.028, -0.17));
    g.add(part(b(0.042, 0.10, 0.045), M.polymer, 0, -0.075, 0.01, 0.12));
    g.add(part(b(0.03, 0.075, 0.04), M.polymer, 0, -0.05, -0.15, -0.35));       // folding foregrip
    g.add(part(b(0.026, 0.026, 0.13), M.steel, 0, 0.005, 0.13));
    g.add(part(b(0.046, 0.06, 0.025), M.polymer, 0, 0.005, 0.20));
    g.add(part(b(0.008, 0.016, 0.010), M.black, -0.026, -0.005, 0.02));         // selector switch
    ironSights(g, 0.086, 0.04, -0.18);
    g.name = 'mp7';
  },
  m870(g) {
    g.add(part(b(0.058, 0.09, 0.24), M.steelWorn, 0, 0, -0.02));
    g.add(part(c(0.017, 0.017, 0.50), M.steelWorn, 0, 0.036, -0.40, Math.PI / 2)); // barrel
    g.add(part(c(0.014, 0.014, 0.42), M.steel, 0, -0.005, -0.36, Math.PI / 2));    // magazine tube
    g.add(part(b(0.048, 0.11, 0.05), M.wood, 0, -0.085, 0.02, 0.22));
    g.add(part(b(0.052, 0.085, 0.26), M.wood, 0, -0.03, 0.20, -0.10));
    g.add(part(b(0.056, 0.10, 0.028), M.black, 0, -0.056, 0.325, -0.10));
    g.add(part(b(0.02, 0.02, 0.02), M.steel, 0, 0.062, -0.60));                    // bead sight
    g.name = 'm870';
  },
  glock17(g) {
    g.add(part(b(0.032, 0.045, 0.14), M.polymer, 0, -0.02, -0.01));            // frame
    g.add(part(b(0.030, 0.115, 0.045), M.polymer, 0, -0.085, 0.03, 0.19));     // grip
    g.add(part(b(0.02, 0.035, 0.018), M.black, 0, -0.035, -0.015));            // trigger guard
    pistolSights(g, 0.052, 0.03, -0.075);
    g.name = 'glock17';
  },
  deagle(g) {
    g.add(part(b(0.040, 0.052, 0.20), M.steelWorn, 0, -0.008, -0.05));         // long slide/frame
    g.add(part(b(0.034, 0.026, 0.16), M.steel, 0, 0.026, -0.11));              // vented barrel shroud
    g.add(part(b(0.036, 0.006, 0.14), M.steelWorn, 0, 0.041, -0.11));          // vent rib
    g.add(part(b(0.036, 0.135, 0.05), M.polymer, 0, -0.10, 0.035, 0.17));      // grip, slight rake
    g.add(part(b(0.022, 0.038, 0.02), M.black, 0, -0.04, -0.02));              // trigger guard
    g.add(part(b(0.010, 0.012, 0.02), M.black, 0, 0.052, -0.20));              // front sight post
    g.add(part(b(0.026, 0.008, 0.010), M.steelWorn, 0, 0.052, 0.03));          // rear sight
    g.add(part(b(0.007, 0.010, 0.011), M.black, -0.008, 0.054, 0.03));
    g.add(part(b(0.007, 0.010, 0.011), M.black, 0.008, 0.054, 0.03));
    g.name = 'deagle';
  },
  scarh(g) {
    g.add(part(b(0.07, 0.095, 0.32), M.polymerTan, 0, 0, -0.02));
    g.add(part(b(0.062, 0.05, 0.26), M.polymerTan, 0, 0.056, -0.14));
    railStack(g, 0.30, 0.088, -0.02, M.polymerTan);
    g.add(part(c(0.016, 0.016, 0.44), M.steel, 0, 0.032, -0.40, Math.PI / 2));
    g.add(part(b(0.062, 0.06, 0.26), M.polymerTan, 0, 0.03, -0.30));
    g.add(part(c(0.022, 0.024, 0.08, 8), M.black, 0, 0.032, -0.62, Math.PI / 2));
    g.add(part(b(0.052, 0.125, 0.05), M.polymer, 0, -0.105, 0.04, 0.20));
    g.add(part(b(0.058, 0.10, 0.20), M.polymerTan, 0, -0.012, 0.20));          // folding stock
    g.add(part(b(0.06, 0.11, 0.03), M.polymer, 0, -0.02, 0.30));
    g.add(part(b(0.032, 0.055, 0.02), M.steel, 0, -0.06, -0.03));
    g.add(part(b(0.012, 0.022, 0.016), M.black, -0.038, -0.02, 0.01));          // selector switch
    g.add(part(b(0.026, 0.026, 0.012), M.steel, 0, -0.02, 0.36));               // sling loop
    ironSights(g, 0.086, 0.04, -0.44, M.polymerTan);
    g.name = 'scarh';
  },
  knife(g) {
    g.add(part(b(0.028, 0.032, 0.14), M.black, 0, -0.01, 0.06));            // grip
    g.add(part(b(0.030, 0.006, 0.020), M.black, 0, 0.010, 0.005));          // finger ridge
    g.add(part(b(0.052, 0.010, 0.028), M.steelWorn, 0, 0.016, -0.02));      // guard
    g.add(part(b(0.024, 0.005, 0.24), M.steel, 0, 0.020, -0.16));           // blade
    g.add(part(b(0.024, 0.005, 0.05), M.steelWorn, 0, 0.020, -0.045, 0, 0, 0.5)); // sharpened tip taper hint
    g.add(part(b(0.010, 0.010, 0.03), M.black, 0, -0.01, 0.15));            // pommel
    g.name = 'knife';
  }
};

const MAGS = {
  m4a1: () => { const m = new THREE.Mesh(b(0.03, 0.16, 0.05), M.polymer); m.position.set(0, -0.115, -0.02); return m; },
  ak74: () => {
    const g = new THREE.Group();
    g.add(part(b(0.032, 0.15, 0.055), M.polymerTan, 0, -0.075, 0, 0.35));
    g.position.set(0, -0.05, -0.05);
    return g;
  },
  mp5: () => { const m = new THREE.Mesh(b(0.026, 0.20, 0.04), M.polymer); m.position.set(0, -0.14, -0.03); return m; },
  mp7: () => { const m = new THREE.Mesh(b(0.024, 0.13, 0.035), M.polymer); m.position.set(0, -0.09, -0.02); return m; },
  m870: () => { const m = new THREE.Mesh(b(0.001, 0.001, 0.001), M.black); m.visible = false; return m; },
  glock17: () => { const m = new THREE.Mesh(b(0.022, 0.10, 0.035), M.black); m.position.set(0, -0.10, 0.03); return m; },
  deagle: () => { const m = new THREE.Mesh(b(0.028, 0.12, 0.045), M.black); m.position.set(0, -0.115, 0.03); return m; },
  scarh: () => { const m = new THREE.Mesh(b(0.034, 0.15, 0.06), M.polymerTan); m.position.set(0, -0.11, -0.03); return m; }
};

// The reciprocating part: a charging handle for rifles, the whole slide for
// the Glock, the forend for the shotgun.
const BOLTS = {
  m4a1: () => part(b(0.02, 0.02, 0.05), M.steelWorn, 0.032, 0.062, 0.06),
  ak74: () => part(b(0.024, 0.024, 0.05), M.steelWorn, 0.036, 0.048, -0.03),
  mp5: () => part(b(0.02, 0.02, 0.04), M.steelWorn, 0.03, 0.03, -0.13),
  mp7: () => part(b(0.018, 0.018, 0.035), M.steelWorn, 0.028, 0.04, -0.02),
  m870: () => part(b(0.02, 0.02, 0.04), M.steelWorn, 0.032, 0.0, -0.02),
  glock17: () => {
    const g = new THREE.Group();
    g.add(part(b(0.03, 0.055, 0.18), M.steel, 0, 0.02, -0.03));
    g.add(part(c(0.008, 0.008, 0.10, 8), M.steelWorn, 0, 0.022, -0.11, Math.PI / 2));
    g.add(part(b(0.008, 0.012, 0.008), M.black, 0, 0.05, -0.105));
    g.add(part(b(0.024, 0.012, 0.01), M.black, 0, 0.05, 0.05));
    return g;
  },
  deagle: () => {
    const g = new THREE.Group();
    g.add(part(b(0.038, 0.06, 0.20), M.steel, 0, 0.024, -0.06));
    g.add(part(c(0.009, 0.009, 0.11, 8), M.steelWorn, 0, 0.026, -0.14, Math.PI / 2));
    g.add(part(b(0.009, 0.014, 0.009), M.black, 0, 0.055, -0.13));
    g.add(part(b(0.026, 0.014, 0.012), M.black, 0, 0.055, 0.05));
    return g;
  },
  scarh: () => part(b(0.022, 0.022, 0.055), M.steelWorn, 0.038, 0.055, 0.03)
};

/** Attachment meshes, parented to the rail / muzzle / side nodes. */
export function buildAttachment(key) {
  const g = new THREE.Group();
  g.name = key;
  switch (key) {
    case 'reddot':
      g.add(part(b(0.032, 0.030, 0.055), M.black, 0, 0.024, 0));
      g.add(part(b(0.026, 0.026, 0.002), M.glass, 0, 0.028, -0.026));
      g.add(part(b(0.036, 0.012, 0.030), M.black, 0, 0.006, 0));
      g.userData.opticHeight = 0.052;
      break;
    case 'holo':
      g.add(part(b(0.040, 0.040, 0.075), M.black, 0, 0.028, 0));
      g.add(part(b(0.034, 0.034, 0.002), M.glass, 0, 0.030, -0.036));
      g.add(part(b(0.044, 0.012, 0.040), M.black, 0, 0.006, 0));
      g.userData.opticHeight = 0.058;
      break;
    case 'suppressor':
      g.add(part(c(0.021, 0.023, 0.17, 12), M.black, 0, 0, -0.06, Math.PI / 2));
      g.add(part(c(0.024, 0.024, 0.012, 12), M.steel, 0, 0, 0.018, Math.PI / 2));
      break;
    case 'compensator':
      g.add(part(c(0.020, 0.022, 0.055, 8), M.steelWorn, 0, 0, -0.01, Math.PI / 2));
      g.add(part(b(0.044, 0.006, 0.03), M.steelWorn, 0, 0.014, -0.01));
      g.add(part(b(0.044, 0.006, 0.03), M.steelWorn, 0, -0.014, -0.01));
      break;
    case 'grip':
      g.add(part(b(0.026, 0.085, 0.028), M.polymer, 0, -0.045, 0));
      g.add(part(b(0.034, 0.012, 0.034), M.black, 0, -0.004, 0));
      break;
    case 'flashlight':
      g.add(part(c(0.016, 0.016, 0.07, 10), M.black, 0, 0, -0.01, Math.PI / 2));
      g.add(part(c(0.014, 0.014, 0.004, 10), new THREE.MeshBasicMaterial({ color: 0xfff6dd }), 0, 0, -0.046, Math.PI / 2));
      break;
    case 'laser':
      g.add(part(b(0.018, 0.018, 0.05), M.black, 0, 0, 0));
      g.add(part(b(0.006, 0.006, 0.004), new THREE.MeshBasicMaterial({ color: 0xff2a1a }), 0, 0, -0.026));
      break;
    default: break;
  }
  return g;
}

/**
 * Build a complete weapon.  Returns the group plus the animatable handles the
 * view model needs.
 */
export function buildWeaponModel(weapon, attachments = []) {
  const root = new THREE.Group();
  root.name = 'weapon:' + weapon.key;
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  (BUILD[weapon.key] || BUILD.m4a1)(body);

  // A knife has no magazine or bolt to animate — skip both rather than
  // fall back to the M4's parts, which would float a rifle mag off a blade.
  const mag = weapon.melee ? null : (MAGS[weapon.key] || MAGS.m4a1)();
  if (mag) { mag.name = 'magazine'; root.add(mag); }

  const bolt = weapon.melee ? null : (BOLTS[weapon.key] || BOLTS.m4a1)();
  if (bolt) { bolt.name = 'bolt'; root.add(bolt); }

  // the shotgun's forend cycles on its own
  let pump = null;
  if (weapon.key === 'm870') {
    pump = part(b(0.052, 0.05, 0.15), M.wood, 0, -0.005, -0.28);
    pump.name = 'pump';
    root.add(pump);
  }

  // Both pistols share the same compact proportions (no stock/handguard rail
  // to hang the usual anchors off), so they take the same overrides below.
  const isPistol = weapon.key === 'glock17' || weapon.key === 'deagle';

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  const barrelLen = weapon.model.barrel + (isPistol ? 0.06 : 0.20);
  muzzle.position.set(0, isPistol ? 0.022 : 0.033, -barrelLen - 0.02);
  root.add(muzzle);

  const eject = new THREE.Object3D();
  eject.name = 'eject';
  eject.position.set(0.045, isPistol ? 0.03 : 0.045, -0.02);
  root.add(eject);

  // rail / mount nodes
  const railY = isPistol ? 0.05 : weapon.key === 'ak74' ? 0.10 : weapon.key === 'm870' ? 0.06 : 0.088;
  const optics = new THREE.Object3D();
  optics.position.set(0, railY, -0.02);
  root.add(optics);
  const underMount = new THREE.Object3D();
  underMount.position.set(0, isPistol ? -0.01 : 0.0, -weapon.model.barrel * 0.55 - 0.06);
  root.add(underMount);
  const sideMount = new THREE.Object3D();
  sideMount.position.set(0.036, 0.0, -weapon.model.barrel * 0.5 - 0.04);
  root.add(sideMount);

  const attached = {};
  let opticHeight = 0;
  let suppressed = false;
  for (const key of attachments) {
    const a = buildAttachment(key);
    if (!a) continue;
    if (key === 'reddot' || key === 'holo') {
      optics.add(a);
      opticHeight = railY + (a.userData.opticHeight || 0.05);
    } else if (key === 'suppressor' || key === 'compensator') {
      a.position.copy(muzzle.position);
      a.position.z += key === 'suppressor' ? -0.02 : 0.0;
      root.add(a);
      if (key === 'suppressor') { muzzle.position.z -= 0.16; suppressed = true; }
    } else if (key === 'grip') {
      underMount.add(a);
    } else if (key === 'flashlight') {
      underMount.add(a);
      const spot = new THREE.SpotLight(0xfff4dd, 0, 26, 0.42, 0.55, 1.2);
      spot.name = 'weaponLight';
      spot.position.set(0, 0, -0.05);
      spot.target.position.set(0, 0, -8);
      a.add(spot);
      a.add(spot.target);
      attached.light = spot;
    } else if (key === 'laser') {
      sideMount.add(a);
      attached.laserOrigin = a;
    }
    attached[key] = a;
  }

  // iron sight height when there is no optic fitted
  const ironHeight = isPistol ? 0.052 : weapon.key === 'm870' ? 0.064 : 0.086;

  root.traverse((o) => { o.frustumCulled = false; if (o.isMesh) o.renderOrder = 10; });

  return {
    root, body, mag, bolt, pump, muzzle, eject, optics, underMount, sideMount,
    attached, sightHeight: opticHeight || ironHeight, suppressed,
    hasOptic: opticHeight > 0
  };
}

export function disposeWeaponModel(model) {
  model.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
}

/** Lower-detail world-space copy used for other players' hands. */
export function buildWorldWeapon(weapon) {
  const g = new THREE.Group();
  (BUILD[weapon.key] || BUILD.m4a1)(g);
  if (!weapon.melee) {
    const mag = (MAGS[weapon.key] || MAGS.m4a1)();
    g.add(mag);
    if (BOLTS[weapon.key]) g.add(BOLTS[weapon.key]());
  }
  return g;
}
