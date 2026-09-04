// Procedural operator model with a simple skeleton driven by movement state:
// legs swing with the gait, the torso counter-rotates against the aim, the head
// tracks pitch, the body compresses when crouching and rolls when leaning, and
// the whole thing topples on death.

import * as THREE from 'three';
import { buildWorldWeapon } from '../weapons/WeaponModels.js';
import { lerp, clamp } from '../shared/constants.js';

const TEAM_COLORS = {
  1: { kit: 0x2c3947, trim: 0x4a7ba8, pouch: 0x1f2833 },
  2: { kit: 0x453529, trim: 0xa8703c, pouch: 0x2a2019 },
  0: { kit: 0x33383c, trim: 0x5a6166, pouch: 0x24282b }
};

const mat = (c, rough = 0.82, metal = 0.05) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });

export class PlayerModel {
  constructor(team = 0) {
    const col = TEAM_COLORS[team] || TEAM_COLORS[0];
    this.root = new THREE.Group();
    this.materials = [];

    const kit = mat(col.kit);
    const trim = mat(col.trim, 0.7);
    const pouch = mat(col.pouch, 0.9);
    const skin = mat(0x8a6b52, 0.9);
    const black = mat(0x1a1c1e, 0.7);
    this.materials.push(kit, trim, pouch, skin, black);

    // hips: everything below the waist rotates with movement, not with aim
    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    this.root.add(this.hips);

    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    for (const [g, sx] of [[this.legL, -1], [this.legR, 1]]) {
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.44, 0.17), kit);
      thigh.position.y = -0.22;
      const shin = new THREE.Group();
      shin.position.y = -0.44;
      const shinMesh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.44, 0.15), kit);
      shinMesh.position.y = -0.22;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.26), black);
      boot.position.set(0, -0.45, 0.04);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.025, 0.27), black);
      sole.position.set(0, -0.495, 0.04);
      const kneePad = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.09, 0.06), trim);
      kneePad.position.set(0, -0.19, -0.12);
      shin.add(shinMesh, boot, sole);
      thigh.add(kneePad);
      g.add(thigh, shin);
      g.position.set(sx * 0.11, 0, 0);
      g.userData.shin = shin;
      this.hips.add(g);
    }

    // torso follows the aim yaw
    this.torso = new THREE.Group();
    this.torso.position.y = 0.02;
    this.hips.add(this.torso);

    // Forward is -Z at yaw 0 throughout movement/aim (see movement.js), and
    // the weapon mount below is correctly built on that -Z side. All the
    // "front of body" detail meshes here were mistakenly authored on +Z
    // instead — the model's face/plate/pouches pointed the way the character
    // came from, not the way they were walking or aiming, so every bot and
    // remote player visually looked like they were facing backwards even
    // though their underlying yaw was always correct. Mirrored onto -Z (and
    // the backpack, which belongs on the back, onto +Z) to match.
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.24), kit);
    chest.position.y = 0.26;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.10), trim);
    plate.position.set(0, 0.28, -0.13);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.10, 0.24), pouch);
    belt.position.y = 0.03;
    const pouchL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.09), pouch);
    pouchL.position.set(-0.13, 0.12, -0.16);
    const pouchR = pouchL.clone();
    pouchR.position.x = 0.13;
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.14), pouch);
    backpack.position.set(0, 0.30, 0.18);
    this.torso.add(chest, plate, belt, pouchL, pouchR, backpack);

    // head + helmet
    this.neck = new THREE.Group();
    this.neck.position.y = 0.52;
    this.torso.add(this.neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.22, 0.21), skin);
    head.position.y = 0.10;
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.14, 0.25), black);
    helmet.position.y = 0.18;
    const nvg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.10), black);
    nvg.position.set(0, 0.20, -0.15);
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), mat(0x101214, 0.4, 0.6));
    cam.position.set(-0.13, 0.30, -0.10);   // the chest cam on the shoulder strap, facing forward
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.06), black);
    mask.position.set(0, 0.05, -0.10);
    const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.10, 0.025), black);
    strapL.position.set(-0.10, 0.10, -0.03);
    const strapR = strapL.clone();
    strapR.position.x = 0.10;
    this.neck.add(head, helmet, nvg, mask, strapL, strapR);
    this.torso.add(cam);

    // arms
    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    for (const [g, sx] of [[this.armL, -1], [this.armR, 1]]) {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.30, 0.12), kit);
      upper.position.y = -0.15;
      const shoulderPad = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.10, 0.14), trim);
      shoulderPad.position.y = 0.03;
      upper.add(shoulderPad);
      const fore = new THREE.Group();
      fore.position.y = -0.30;
      const foreMesh = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.28, 0.11), kit);
      foreMesh.position.y = -0.14;
      const elbowPad = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.07, 0.05), trim);
      elbowPad.position.set(0, -0.01, -0.075);
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.10, 0.10), black);
      glove.position.y = -0.30;
      fore.add(foreMesh, elbowPad, glove);
      g.add(upper, fore);
      g.position.set(sx * 0.26, 0.44, 0);
      g.userData.fore = fore;
      this.torso.add(g);
    }

    // weapon carried in the right hand
    this.weaponMount = new THREE.Group();
    this.weaponMount.position.set(0.20, 0.30, -0.22);
    this.torso.add(this.weaponMount);

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    this.gait = 0;
    this.deathT = 0;
    this.weaponKey = null;
  }

  setWeapon(weaponDef) {
    if (this.weaponKey === weaponDef.key) return;
    this.weaponKey = weaponDef.key;
    this.weaponMount.clear();
    const w = buildWorldWeapon(weaponDef);
    w.rotation.set(0, 0, 0);
    w.position.set(0, 0, 0);
    w.scale.setScalar(1.0);
    w.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.weaponMount.add(w);
  }

  /**
   * @param st { x, y, z, yaw, pitch, speed, crouchT, leanT, grounded, dead,
   *             firing, reloading, sprinting }
   */
  update(dt, st) {
    const r = this.root;
    r.position.set(st.x, st.y, st.z);

    if (st.dead) {
      this.deathT = Math.min(1, this.deathT + dt * 2.2);
      const t = this.deathT;
      r.rotation.set(t * 1.45, st.yaw, t * 0.35);
      r.position.y = st.y + Math.sin(t * Math.PI) * 0.05;
      this.hips.position.y = lerp(0.92, 0.30, t);
      this.armL.rotation.set(lerp(0, -0.9, t), 0, lerp(0, 0.6, t));
      this.armR.rotation.set(lerp(0, -1.1, t), 0, lerp(0, -0.5, t));
      this.legL.rotation.x = lerp(0, 0.5, t);
      this.legR.rotation.x = lerp(0, -0.35, t);
      return;
    }
    // Blend out of the ragdoll pose instead of snapping straight to standing
    // the instant a respawn flips `dead` false — the snap was reading as a
    // broken/skipped animation.
    if (this.deathT > 0) {
      this.deathT = Math.max(0, this.deathT - dt * 5);
      const t = this.deathT;
      r.rotation.set(t * 1.45, st.yaw, t * 0.35);
      if (t > 0.02) return;
    }
    r.rotation.set(0, 0, 0);

    // hips face the movement direction, torso faces the aim
    const crouch = st.crouchT || 0;
    this.hips.position.y = lerp(0.92, 0.58, crouch);
    this.hips.rotation.y = st.yaw;
    this.hips.rotation.z = -(st.leanT || 0) * 0.30;
    this.aimT = lerp(this.aimT ?? 0, st.aiming && !st.sprinting ? 1 : 0, 1 - Math.exp(-10 * dt));
    const aim = this.aimT;
    this.torso.rotation.x = lerp(0, 0.28, crouch) + clamp(-(st.pitch || 0) * 0.28, -0.2, 0.2) + aim * 0.05;
    this.torso.rotation.z = -(st.leanT || 0) * 0.22;
    this.neck.rotation.x = clamp((st.pitch || 0) * 0.72, -0.9, 0.9);

    // gait
    const speed = st.speed || 0;
    const moving = speed > 0.3 && st.grounded;
    const rate = st.sprinting ? 8.6 : crouch > 0.5 ? 5.0 : 6.6;
    if (moving) this.gait += dt * rate * clamp(speed / 3.2, 0.4, 2.0);
    else this.gait = lerp(this.gait, Math.round(this.gait / Math.PI) * Math.PI, 1 - Math.exp(-9 * dt));

    const amp = clamp(speed / 4.4, 0, 1.2) * (1 - crouch * 0.35);
    const s = Math.sin(this.gait), cS = Math.cos(this.gait);
    this.legL.rotation.x = s * 0.75 * amp - crouch * 0.6;
    this.legR.rotation.x = -s * 0.75 * amp - crouch * 0.6;
    this.legL.userData.shin.rotation.x = Math.max(0, -cS) * 0.85 * amp + crouch * 1.1;
    this.legR.userData.shin.rotation.x = Math.max(0, cS) * 0.85 * amp + crouch * 1.1;

    // arms: weapon-ready pose, with sprint carrying the gun down and across
    const sprintT = st.sprinting && moving ? 1 : 0;
    this.sprintT = lerp(this.sprintT ?? 0, sprintT, 1 - Math.exp(-8 * dt));
    const sp = this.sprintT;
    const recoil = st.firing ? Math.sin(performance.now() * 0.06) * 0.05 : 0;

    // Reload used to be an endless per-frame sine wiggle that never actually
    // went anywhere — it looked like a nervous tremor, not a reload. Track
    // elapsed time in the state instead and shape it into one clean
    // rise-then-fall arc (support hand drops for the mag, then comes back
    // up to seat it) so teammates read as actually doing something.
    if (st.reloading) this.reloadT = (this.reloadT ?? 0) + dt;
    else this.reloadT = 0;
    const reload = st.reloading ? Math.sin(clamp(this.reloadT / 1.7, 0, 1) * Math.PI) : 0;

    // The torso only leans a capped +-11 degrees for pitch, which made a
    // teammate aiming up at a balcony or down at their feet look almost
    // identical from outside — the actual "where are they looking" signal
    // needs to be on the gun and arms, not buried in a subtle body lean.
    const pitchLook = clamp(-(st.pitch || 0), -1.1, 1.1) * (1 - sp * 0.7);

    this.armR.rotation.set(
      lerp(-1.30 + sp * 0.5 + recoil, -0.95, aim) + reload * 0.15 + pitchLook * 0.32,
      lerp(-0.30 + sp * 0.4, -0.08, aim),
      lerp(0.16, 0.06, aim)
    );
    this.armL.rotation.set(-1.45 + sp * 0.75 + recoil + reload * 0.95 + pitchLook * 0.30, 0.55 - sp * 0.2 - aim * 0.4, -0.32 + reload * 0.2);
    this.armL.userData.fore.rotation.x = -0.55 - sp * 0.35 + reload * 0.85;
    this.armR.userData.fore.rotation.x = lerp(-0.35, -0.55, aim);

    this.weaponMount.rotation.set(
      lerp(-0.12 + sp * 0.55 + recoil * 1.4, -0.02, aim) + reload * 0.1 + pitchLook * 0.55,
      lerp(-0.26 + sp * 0.55, -0.05, aim),
      sp * 0.35
    );
    this.weaponMount.position.set(
      lerp(0.20 - sp * 0.03, 0.10, aim),
      lerp(0.30 - sp * 0.10, 0.40, aim) - reload * 0.03,
      lerp(-0.22 + sp * 0.05, -0.14, aim)
    );
  }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
  }
}
