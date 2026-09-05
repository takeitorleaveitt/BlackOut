// Procedural first-person weapon models.
//
// Each gun is a Group with *named* sub-objects so the view model can animate
// them individually: the magazine drops out on a reload, the charging handle
// cycles, the bolt reciprocates, the optic sits on its own rail. Proportions,
// materials and silhouettes differ per weapon so they read apart instantly.
//
// Built to match the "Block Guns" low-poly reference sheets: every gun is a
// small stack of flat axis-aligned rectangular prisms (no cylindrical
// barrels/rails, no fine greebles like selector switches or sling loops) —
// a clean, chunky, minimal silhouette per weapon class rather than a
// detailed replica.

import * as THREE from 'three';

// Lightened and warmed up from the original near-black set — against the
// game's lighting those read as a murky, low-contrast silhouette instead of
// a clean blocky gun. A few shades lighter with a touch more warmth reads
// far closer to the clean low-poly look the guns are going for.
const M = {
  polymer: new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 0.68, metalness: 0.10 }),
  polymerTan: new THREE.MeshStandardMaterial({ color: 0x615a45, roughness: 0.70, metalness: 0.06 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x474b4f, roughness: 0.34, metalness: 0.85 }),
  steelWorn: new THREE.MeshStandardMaterial({ color: 0x666b70, roughness: 0.28, metalness: 0.9 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x86593a, roughness: 0.62, metalness: 0.04 }),
  black: new THREE.MeshStandardMaterial({ color: 0x232629, roughness: 0.55, metalness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x2c4560, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 }),
  // Optic glass is barely there on purpose — a sight you cannot see the
  // target through is not a sight. Just enough tint to read as coated glass.
  lens: new THREE.MeshBasicMaterial({
    color: 0x8fb4c8, transparent: true, opacity: 0.13,
    depthWrite: false, toneMapped: false
  }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc39a45, roughness: 0.32, metalness: 0.9 })
};

/**
 * One unlit reticle element. Unaffected by scene lighting, drawn after
 * everything else and without depth testing so it always sits visibly in the
 * sight window rather than being swallowed by the optic housing.
 */
function reticle(size, color, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: false, depthWrite: false })
  );
  m.position.set(x, y, z);
  m.renderOrder = 999;
  return m;
}

/** A flat reticle bar — same rules as reticle(), but not a cube. */
function reticleBar(w, h, color, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.0018),
    new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: false, depthWrite: false })
  );
  m.position.set(x, y, z);
  m.renderOrder = 999;
  return m;
}

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

/** Flat top-rail bar — a single chunky block, not individual rail teeth. */
function topRail(g, len, y, z0, mat = M.black) {
  g.add(part(b(0.040, 0.010, len), mat, 0, y, z0 - len / 2));
}

const BUILD = {
  m4a1(g) {
    g.add(part(b(0.062, 0.085, 0.30), M.polymer, 0, 0, -0.02));                 // lower receiver
    g.add(part(b(0.05, 0.055, 0.26), M.polymer, 0, 0.052, -0.10));              // upper receiver
    topRail(g, 0.24, 0.086, -0.02);
    g.add(part(b(0.022, 0.022, 0.40), M.steel, 0, 0.035, -0.36));               // barrel block
    g.add(part(b(0.056, 0.056, 0.24), M.polymer, 0, 0.035, -0.28));             // quad-rail handguard
    g.add(part(b(0.030, 0.030, 0.06), M.black, 0, 0.035, -0.585));              // flash hider block
    g.add(part(b(0.05, 0.12, 0.05), M.polymer, 0, -0.10, 0.03, 0.22));          // pistol grip
    g.add(part(b(0.036, 0.036, 0.16), M.polymer, 0, -0.005, 0.16));             // buffer tube
    g.add(part(b(0.07, 0.11, 0.13), M.polymer, 0, -0.015, 0.26));               // stock block
    g.add(part(b(0.03, 0.055, 0.02), M.steel, 0, -0.055, -0.03));               // trigger guard
    g.name = 'm4a1';
  },
  ak74(g) {
    g.add(part(b(0.066, 0.10, 0.28), M.steel, 0, 0, -0.01));
    g.add(part(b(0.058, 0.05, 0.20), M.wood, 0, 0.05, -0.24));                  // upper handguard
    g.add(part(b(0.062, 0.062, 0.22), M.wood, 0, -0.008, -0.24));               // lower handguard
    g.add(part(b(0.024, 0.024, 0.42), M.steel, 0, 0.03, -0.40));                // barrel block
    g.add(part(b(0.034, 0.034, 0.075), M.steel, 0, 0.03, -0.62));               // muzzle brake block
    g.add(part(b(0.03, 0.06, 0.05), M.steel, 0, 0.07, -0.30));                  // gas block
    g.add(part(b(0.048, 0.13, 0.05), M.wood, 0, -0.11, 0.02, 0.20));            // grip
    g.add(part(b(0.05, 0.075, 0.24), M.wood, 0, -0.02, 0.20, -0.06));           // fixed stock
    g.add(part(b(0.028, 0.05, 0.02), M.steel, 0, -0.06, -0.02));                // trigger guard
    g.name = 'ak74';
  },
  mp5(g) {
    g.add(part(b(0.056, 0.082, 0.26), M.polymer, 0, 0, -0.01));
    g.add(part(b(0.048, 0.048, 0.20), M.polymer, 0, 0.012, -0.22));             // handguard block
    g.add(part(b(0.020, 0.020, 0.22), M.steel, 0, 0.012, -0.28));               // barrel block
    g.add(part(b(0.028, 0.028, 0.03), M.steel, 0, 0.012, -0.395));              // muzzle cap
    g.add(part(b(0.044, 0.11, 0.05), M.polymer, 0, -0.09, 0.02, 0.18));         // grip
    g.add(part(b(0.03, 0.03, 0.20), M.steel, 0, 0.0, 0.16));                    // retractable stock rod
    g.add(part(b(0.05, 0.07, 0.03), M.polymer, 0, 0.0, 0.27));                  // stock plate
    g.add(part(b(0.028, 0.05, 0.02), M.steel, 0, -0.05, -0.02));                // trigger guard
    g.name = 'mp5';
  },
  mp7(g) {
    g.add(part(b(0.05, 0.075, 0.20), M.polymer, 0, 0, 0.0));
    g.add(part(b(0.044, 0.04, 0.14), M.polymer, 0, 0.045, -0.10));
    topRail(g, 0.14, 0.068, -0.04);
    g.add(part(b(0.018, 0.018, 0.18), M.steel, 0, 0.028, -0.19));               // barrel block
    g.add(part(b(0.04, 0.04, 0.09), M.polymer, 0, 0.028, -0.17));               // shroud
    g.add(part(b(0.042, 0.10, 0.045), M.polymer, 0, -0.075, 0.01, 0.12));       // grip
    g.add(part(b(0.03, 0.075, 0.04), M.polymer, 0, -0.05, -0.15, -0.35));       // folding foregrip
    g.add(part(b(0.026, 0.026, 0.13), M.steel, 0, 0.005, 0.13));                // stock rod
    g.add(part(b(0.046, 0.06, 0.025), M.polymer, 0, 0.005, 0.20));              // stock plate
    g.name = 'mp7';
  },
  m40(g) {
    // Bolt gun on a full wood stock: long barrel, cheek comb behind the
    // action, and a bolt handle standing off the right of the receiver.
    g.add(part(b(0.052, 0.070, 0.30), M.steel, 0, 0.010, -0.04));               // receiver
    g.add(part(b(0.058, 0.055, 0.30), M.wood, 0, -0.035, -0.04));               // stock belly under the action
    g.add(part(b(0.020, 0.020, 0.62), M.steelWorn, 0, 0.026, -0.48));           // barrel
    g.add(part(b(0.056, 0.050, 0.30), M.wood, 0, -0.010, -0.30));               // forend
    g.add(part(b(0.030, 0.030, 0.05), M.black, 0, 0.026, -0.80));               // muzzle crown
    g.add(part(b(0.044, 0.045, 0.06), M.steel, 0, -0.052, -0.02));              // magazine housing
    g.add(part(b(0.046, 0.110, 0.055), M.wood, 0, -0.098, 0.045, 0.16));        // pistol grip / wrist
    g.add(part(b(0.052, 0.075, 0.26), M.wood, 0, -0.012, 0.22, -0.05));         // butt stock
    g.add(part(b(0.054, 0.030, 0.13), M.wood, 0, 0.038, 0.16, -0.05));          // cheek comb
    g.add(part(b(0.056, 0.030, 0.03), M.black, 0, -0.030, 0.345));              // recoil pad
    g.add(part(b(0.026, 0.048, 0.02), M.steel, 0, -0.048, -0.02));              // trigger guard
    // bolt handle, standing proud of the right side
    g.add(part(b(0.052, 0.016, 0.016), M.steelWorn, 0.040, 0.030, 0.055));
    g.add(part(b(0.020, 0.020, 0.020), M.steelWorn, 0.066, 0.030, 0.055));      // bolt knob
    // scope rings sit on the receiver whether or not a scope is fitted
    g.add(part(b(0.030, 0.022, 0.016), M.black, 0, 0.052, -0.14));
    g.add(part(b(0.030, 0.022, 0.016), M.black, 0, 0.052, 0.02));
    g.name = 'm40';
  },
  m870(g) {
    g.add(part(b(0.058, 0.09, 0.24), M.steelWorn, 0, 0, -0.02));
    g.add(part(b(0.030, 0.030, 0.50), M.steelWorn, 0, 0.036, -0.40));           // barrel block
    g.add(part(b(0.022, 0.022, 0.42), M.steel, 0, -0.005, -0.36));              // magazine tube block
    g.add(part(b(0.048, 0.11, 0.05), M.wood, 0, -0.085, 0.02, 0.22));           // grip
    g.add(part(b(0.052, 0.085, 0.26), M.wood, 0, -0.03, 0.20, -0.10));          // stock
    g.name = 'm870';
  },
  glock17(g) {
    g.add(part(b(0.032, 0.045, 0.14), M.polymer, 0, -0.02, -0.01));            // frame
    g.add(part(b(0.030, 0.115, 0.045), M.polymer, 0, -0.085, 0.03, 0.19));     // grip
    g.add(part(b(0.02, 0.035, 0.018), M.black, 0, -0.035, -0.015));            // trigger guard
    g.name = 'glock17';
  },
  deagle(g) {
    g.add(part(b(0.040, 0.052, 0.20), M.steelWorn, 0, -0.008, -0.05));         // slide/frame
    g.add(part(b(0.034, 0.026, 0.16), M.steel, 0, 0.026, -0.11));              // barrel shroud block
    g.add(part(b(0.036, 0.135, 0.05), M.polymer, 0, -0.10, 0.035, 0.17));      // grip, slight rake
    g.add(part(b(0.022, 0.038, 0.02), M.black, 0, -0.04, -0.02));              // trigger guard
    g.name = 'deagle';
  },
  scarh(g) {
    g.add(part(b(0.07, 0.095, 0.32), M.polymerTan, 0, 0, -0.02));
    g.add(part(b(0.062, 0.05, 0.26), M.polymerTan, 0, 0.056, -0.14));
    topRail(g, 0.30, 0.088, -0.02, M.polymerTan);
    g.add(part(b(0.026, 0.026, 0.44), M.steel, 0, 0.032, -0.40));              // barrel block
    g.add(part(b(0.062, 0.06, 0.26), M.polymerTan, 0, 0.03, -0.30));           // handguard
    g.add(part(b(0.036, 0.036, 0.08), M.black, 0, 0.032, -0.62));              // muzzle device
    g.add(part(b(0.052, 0.125, 0.05), M.polymer, 0, -0.105, 0.04, 0.20));      // grip
    g.add(part(b(0.058, 0.10, 0.20), M.polymerTan, 0, -0.012, 0.20));          // folding stock
    g.add(part(b(0.032, 0.055, 0.02), M.steel, 0, -0.06, -0.03));              // trigger guard
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
  scarh: () => { const m = new THREE.Mesh(b(0.034, 0.15, 0.06), M.polymerTan); m.position.set(0, -0.11, -0.03); return m; },
  m40: () => { const m = new THREE.Mesh(b(0.036, 0.075, 0.05), M.steel); m.position.set(0, -0.088, -0.02); return m; }
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
    g.add(part(b(0.014, 0.014, 0.10), M.steelWorn, 0, 0.022, -0.11));
    g.add(part(b(0.008, 0.012, 0.008), M.black, 0, 0.05, -0.105));
    g.add(part(b(0.024, 0.012, 0.01), M.black, 0, 0.05, 0.05));
    return g;
  },
  deagle: () => {
    const g = new THREE.Group();
    g.add(part(b(0.038, 0.06, 0.20), M.steel, 0, 0.024, -0.06));
    g.add(part(b(0.016, 0.016, 0.11), M.steelWorn, 0, 0.026, -0.14));
    g.add(part(b(0.009, 0.014, 0.009), M.black, 0, 0.055, -0.13));
    g.add(part(b(0.026, 0.014, 0.012), M.black, 0, 0.055, 0.05));
    return g;
  },
  scarh: () => part(b(0.022, 0.022, 0.055), M.steelWorn, 0.038, 0.055, 0.03),
  m40: () => part(b(0.026, 0.026, 0.09), M.steelWorn, 0.0, 0.030, 0.06)
};

/** Attachment meshes, parented to the rail / muzzle / side nodes. */
export function buildAttachment(key) {
  const g = new THREE.Group();
  g.name = key;
  switch (key) {
    // Both optics are built as an OPEN frame — four thin bars around an empty
    // middle — rather than the solid block they used to be. That is what lets
    // you actually look through the sight when aimed instead of pressing your
    // eye against a lump of geometry. The reticle is unlit, drawn last and
    // with depth testing off, so it reads as a projected dot floating in the
    // window at any range. The view model renders in its own isolated pass,
    // so drawing it "through" geometry only means through the gun, not the
    // world.
    case 'reddot': {
      const H = 0.030;                 // reticle height above the rail
      const r = 0.026, t = 0.005, d = 0.042;
      g.add(part(b(r * 2 + t, t, d), M.black, 0, H + r, 0));      // hood top
      g.add(part(b(r * 2 + t, t, d), M.black, 0, H - r, 0));      // hood bottom
      g.add(part(b(t, r * 2, d), M.black, -r, H, 0));             // left wall
      g.add(part(b(t, r * 2, d), M.black, r, H, 0));              // right wall
      // Riser: a base plate that clamps the rail, then the post up to the
      // hood. Without the plate the optic reads as hovering rather than
      // bolted on, even when it is sitting at the right height.
      g.add(part(b(0.042, 0.010, 0.050), M.steelWorn, 0, 0.005, 0));     // rail clamp
      g.add(part(b(0.046, 0.005, 0.014), M.black, 0, 0.004, 0.020));     // clamp lever
      g.add(part(b(0.030, H - r - 0.010, 0.028), M.black, 0, 0.010 + (H - r - 0.010) * 0.5, 0)); // post
      g.add(part(b(r * 2, r * 2, 0.0015), M.lens, 0, H, -0.018)); // glass
      g.add(reticle(0.0050, 0xff2a1a, 0, H, 0.004));
      g.userData.opticHeight = H;
      break;
    }
    case 'holo': {
      const H = 0.034;                 // taller window, sits a touch higher
      const rx = 0.034, ry = 0.028, t = 0.005, d = 0.052;
      g.add(part(b(rx * 2 + t, t, d), M.black, 0, H + ry, 0));
      g.add(part(b(rx * 2 + t, t, d), M.black, 0, H - ry, 0));
      g.add(part(b(t, ry * 2, d), M.black, -rx, H, 0));
      g.add(part(b(t, ry * 2, d), M.black, rx, H, 0));
      // Same riser as the red dot, sized to the wider housing.
      g.add(part(b(0.050, 0.010, 0.060), M.steelWorn, 0, 0.005, 0));     // rail clamp
      g.add(part(b(0.054, 0.005, 0.016), M.black, 0, 0.004, 0.026));     // clamp lever
      g.add(part(b(0.038, H - ry - 0.010, 0.036), M.black, 0, 0.010 + (H - ry - 0.010) * 0.5, 0)); // post
      g.add(part(b(rx * 2, ry * 2, 0.0015), M.lens, 0, H, -0.024));
      // ringed reticle: centre dot inside a broken circle of segments
      g.add(reticle(0.0045, 0xff2a1a, 0, H, 0.006));
      const rr = 0.013;
      for (const [dx, dy] of [[0, rr], [0, -rr], [rr, 0], [-rr, 0]]) {
        g.add(reticle(0.0030, 0xff2a1a, dx, H + dy, 0.006));
      }
      g.userData.opticHeight = H;
      break;
    }
    // A short prismatic 2x. Stubbier than the telescopic sight and mounted low
    // enough to look through with the weapon still filling the lower screen —
    // the reticle is a chevron with a stadia line under it, which is the shape
    // that makes an ACOG read as an ACOG rather than another red dot.
    case 'acog': {
      const H = 0.042;
      const r = 0.024, len = 0.135;
      g.add(part(b(r * 2, r * 2, len), M.black, 0, H, -0.012));            // body
      g.add(part(b(0.056, 0.052, 0.030), M.black, 0, H, -0.086));          // objective housing
      g.add(part(b(0.050, 0.046, 0.026), M.black, 0, H, 0.062));           // ocular housing
      g.add(part(b(0.020, 0.014, 0.052), M.steelWorn, 0, H + 0.026, -0.02)); // fibre-optic ridge
      g.add(part(b(0.030, 0.022, 0.018), M.steelWorn, 0.028, H, -0.02));   // windage turret
      g.add(part(b(0.044, 0.012, 0.062), M.steelWorn, 0, 0.006, 0));       // rail clamp
      g.add(part(b(0.048, 0.006, 0.018), M.black, 0, 0.005, 0.026));       // clamp lever
      g.add(part(b(0.028, H - 0.014, 0.046), M.black, 0, 0.012 + (H - 0.014) * 0.5, 0)); // riser
      g.add(part(b(0.048, 0.044, 0.0015), M.lens, 0, H, -0.101));          // objective glass
      g.add(part(b(0.040, 0.038, 0.0015), M.lens, 0, H, 0.075));           // ocular glass
      // Chevron: a tapered stack of segments meeting at a point, with the
      // stadia line dropping away below it.
      const RZ = 0.066;
      for (let i = 0; i < 5; i++) {
        const wdt = 0.0022 + i * 0.0022;
        const yy = H + 0.0075 + i * 0.0022;
        g.add(reticleBar(wdt, 0.0020, 0xff2a1a, 0, yy, RZ));
      }
      g.add(reticle(0.0022, 0xff2a1a, 0, H + 0.0052, RZ));                 // tip
      for (let i = 1; i <= 4; i++) {
        g.add(reticleBar(0.0060 - i * 0.0008, 0.0016, 0xff2a1a, 0, H - i * 0.0075, RZ));
      }
      g.userData.opticHeight = H;
      break;
    }
    // A telescopic scope, not a red dot: a long tube on two rings with an
    // objective bell at the front. The reticle here is only what you see with
    // the weapon unscoped or mid-transition — once the aim settles, the HUD
    // takes over with the full-screen scope picture.
    case 'scope': {
      const H = 0.055;                 // optical axis above the rail
      const r = 0.021, len = 0.30;
      g.add(part(b(r * 2, r * 2, len), M.black, 0, H, -0.05));            // main tube
      g.add(part(b(0.052, 0.052, 0.062), M.black, 0, H, -0.205));         // objective bell
      g.add(part(b(0.046, 0.046, 0.050), M.black, 0, H, 0.078));          // ocular bell
      g.add(part(b(0.050, 0.050, 0.030), M.steelWorn, 0, H, -0.02));      // elevation turret housing
      g.add(part(b(0.020, 0.030, 0.020), M.steelWorn, 0, H + 0.032, -0.02)); // elevation turret
      g.add(part(b(0.030, 0.020, 0.020), M.steelWorn, 0.032, H, -0.02));  // windage turret
      g.add(part(b(0.026, H - 0.010, 0.022), M.black, 0, (H - 0.010) * 0.5 + 0.005, -0.11)); // front ring
      g.add(part(b(0.026, H - 0.010, 0.022), M.black, 0, (H - 0.010) * 0.5 + 0.005, 0.030)); // rear ring
      g.add(part(b(0.040, 0.010, 0.048), M.steelWorn, 0, 0.006, -0.04));  // rail clamp
      g.add(part(b(0.044, 0.044, 0.0015), M.lens, 0, H, -0.232));         // objective glass
      g.add(part(b(0.038, 0.038, 0.0015), M.lens, 0, H, 0.100));          // ocular glass
      // simple crosshair for the unscoped/transition view
      g.add(reticle(0.0030, 0xff2a1a, 0, H, 0.086));
      g.userData.opticHeight = H;
      break;
    }
    case 'suppressor':
      g.add(part(b(0.042, 0.042, 0.17), M.black, 0, 0, -0.06));
      g.add(part(b(0.048, 0.048, 0.012), M.steel, 0, 0, 0.018));
      break;
    case 'compensator':
      g.add(part(b(0.040, 0.040, 0.055), M.steelWorn, 0, 0, -0.01));
      g.add(part(b(0.044, 0.006, 0.03), M.steelWorn, 0, 0.014, -0.01));
      g.add(part(b(0.044, 0.006, 0.03), M.steelWorn, 0, -0.014, -0.01));
      break;
    case 'grip':
      g.add(part(b(0.026, 0.085, 0.028), M.polymer, 0, -0.045, 0));
      g.add(part(b(0.034, 0.012, 0.034), M.black, 0, -0.004, 0));
      break;
    case 'flashlight':
      g.add(part(b(0.032, 0.032, 0.07), M.black, 0, 0, -0.01));
      g.add(part(b(0.028, 0.028, 0.004), new THREE.MeshBasicMaterial({ color: 0xfff6dd }), 0, 0, -0.046));
      break;
    case 'laser':
      g.add(part(b(0.018, 0.018, 0.05), M.black, 0, 0, 0));
      g.add(part(b(0.006, 0.006, 0.004), new THREE.MeshBasicMaterial({ color: 0xff2a1a }), 0, 0, -0.026));
      break;
    default: break;
  }
  return g;
}

// How far the optic's base sinks into the receiver it clamps onto. The SCAR
// and M4 already overlapped by about this much and were the two weapons that
// looked right, so this reproduces that fit everywhere.
const RAIL_SINK = 0.004;

const _rtBox = new THREE.Box3();
/**
 * Highest point of the receiver in the slice of the weapon an optic sits over,
 * measured from the built geometry.
 *
 * The rail height used to be a hand-written constant — 0.088 for every
 * non-pistol except the AK and the shotgun. That happens to be right for the
 * M4 and the SCAR, whose receivers top out at 0.091 and 0.093, and wrong for
 * everything else: the MP5's receiver tops out at 0.041, so its sight floated
 * 4.7cm clear of the gun with nothing joining the two. The AK floated 2.5cm
 * and the MP7 1.5cm. Measuring the body means the sight lands on whatever is
 * actually under it, for every weapon and for any added later.
 *
 * Works on each part's bounding box rather than its vertices: a receiver is
 * one long box whose only vertices are at its two end caps, so sampling
 * vertices inside the optic's window finds nothing at all for most weapons.
 * Parts that sit off the centre line are skipped — a charging handle or a
 * side rail is not something you mount a sight on.
 */
function receiverTop(body, z0, z1, fallback) {
  body.updateWorldMatrix(true, true);
  let top = -Infinity;
  body.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _rtBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (_rtBox.max.z < z0 || _rtBox.min.z > z1) return;      // not under the optic
    if (_rtBox.min.x > 0.02 || _rtBox.max.x < -0.02) return;  // off the centre line
    if (_rtBox.max.y > top) top = _rtBox.max.y;
  });
  return Number.isFinite(top) ? top : fallback;
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

  // rail / mount nodes. The optic straddles roughly z -0.10..0.06, so that is
  // the slice of receiver it has to sit on.
  const railY = receiverTop(body, -0.10, 0.06, isPistol ? 0.05 : 0.088) - RAIL_SINK;
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
    if (key === 'reddot' || key === 'holo' || key === 'acog') {
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

  // Don't stomp a part that has deliberately asked to draw later (the optic
  // reticles use renderOrder 999 so they sit on top of their own housing).
  root.traverse((o) => {
    o.frustumCulled = false;
    if (o.isMesh && o.renderOrder < 10) o.renderOrder = 10;
  });

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
