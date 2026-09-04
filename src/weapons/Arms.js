// First-person arms.
//
// Deliberately simple, blocky geometry consistent with the weapon models'
// procedural aesthetic — the point isn't anatomical accuracy, it's that the
// operator visibly has hands on the gun. Both arms are parented to the
// ViewModel's `holder` group, the same node the weapon sits in, so they
// inherit every bit of sway/recoil/reload/ADS/sprint animation for free —
// there is no separate arm-specific animation code.

import * as THREE from 'three';

const MAT = {
  sleeve: new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.8, metalness: 0.04 }),
  cuff: new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.72, metalness: 0.04 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.08 }),
  strap: new THREE.MeshStandardMaterial({ color: 0x3a3f34, roughness: 0.75, metalness: 0.02 })
};

/** One arm: forearm + wrist cuff + gloved hand with a simple curled grip. */
export function buildArm(mirrored = false) {
  const g = new THREE.Group();
  const s = mirrored ? -1 : 1;

  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.10, 0.36), MAT.sleeve);
  forearm.position.set(0, -0.01, 0.23);
  g.add(forearm);

  // a strap/patch breaks up the flat sleeve
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.09), MAT.strap);
  strap.position.set(0, 0.03, 0.28);
  g.add(strap);

  const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.04), MAT.cuff);
  cuff.position.set(0, -0.01, 0.065);
  g.add(cuff);

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.085, 0.11), MAT.glove);
  palm.position.set(0, 0, 0.005);
  g.add(palm);

  // curled fingers wrapping the grip/handguard
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.024, 0.026), MAT.glove);
    f.position.set(0, -0.048 - i * 0.001, 0.045 - i * 0.018);
    f.rotation.x = -0.62 - i * 0.05;
    g.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.055, 0.024), MAT.glove);
  thumb.position.set(s * 0.046, 0.018, -0.02);
  thumb.rotation.z = s * 0.35;
  g.add(thumb);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  return g;
}

// Right (trigger) hand grip centre per weapon — taken directly from the
// pistol-grip mesh coordinates each weapon model already uses, so the hand
// sits exactly where the grip actually is instead of an eyeballed guess.
export const GRIP_ANCHOR = {
  m4a1: { p: [0, -0.135, 0.025], r: [0.30, 0.06, -0.12] },
  ak74: { p: [0, -0.145, 0.015], r: [0.28, 0.06, -0.12] },
  mp5: { p: [0, -0.115, 0.015], r: [0.30, 0.05, -0.12] },
  mp7: { p: [0, -0.095, 0.005], r: [0.30, 0.05, -0.12] },
  m870: { p: [0, -0.110, 0.015], r: [0.30, 0.06, -0.12] },
  glock17: { p: [0, -0.110, 0.025], r: [0.30, 0.04, -0.12] },
  deagle: { p: [0, -0.108, 0.030], r: [0.30, 0.04, -0.12] },
  scarh: { p: [0, -0.135, 0.035], r: [0.28, 0.06, -0.12] },
  knife: { p: [0, -0.06, 0.06], r: [0.20, 0.10, -0.05] }
};

// Support-hand offset relative to each weapon's `underMount` node (already
// positioned at the handguard by buildWeaponModel). Pistols have no support
// hand position on the gun itself, so they use a two-handed cup instead.
// The X offset pulls the forearm out to the side of the handguard rather
// than tucking it directly underneath — sitting dead-centre left it almost
// entirely hidden behind the gun's own body from the camera's angle.
export const SUPPORT_OFFSET = { p: [-0.052, -0.015, -0.02], r: [0.34, -0.10, 0.0] };
export const PISTOL_SUPPORT = { p: [-0.01, -0.15, 0.13], r: [0.34, -0.20, -0.1] };
