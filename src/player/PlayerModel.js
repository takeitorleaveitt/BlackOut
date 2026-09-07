// Procedural operator model with a simple skeleton driven by movement state:
// legs swing with the gait, the torso counter-rotates against the aim, the head
// tracks pitch, the body compresses when crouching and rolls when leaning, and
// the whole thing topples on death.

import * as THREE from 'three';
import { buildWorldWeapon } from '../weapons/WeaponModels.js';
import { lerp, clamp } from '../shared/constants.js';

// The arm hangs straight down when unrotated.
const REST_AXIS = new THREE.Vector3(0, -1, 0);
// Upper arm plus forearm, minus the sliver the solver keeps back so the
// elbow does not degenerate at full extension.
const ARM_REACH = 0.60 * 0.995;
// How far each elbow is swung outboard, around the shoulder-to-hand line.
// See solveArm(): rolling about that axis moves the elbow and provably not
// the hand, so the grip stays on the gun whatever these are set to.
//
// Signs are opposite because the arms mirror. Measured against the torso the
// firing elbow travels about 25 cm across the usable range and the support
// elbow only two or three: the support arm is nearly straight once it is out
// on the handguard, and a straight arm's elbow has almost no circle left to
// swing around. So the firing side is what actually reads as "arms out", and
// these put that elbow out level with the shoulder and behind it, where a
// shooter's is, rather than tucked down against the ribs.
const ELBOW_ROLL_R = -0.45;
const ELBOW_ROLL_L = 0.50;

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
      // Forward is -Z for this model (same convention the arms and the knee
      // pad below use). The boot and sole were offset to +Z, i.e. the toes
      // stuck out behind the ankle — the feet were literally on backwards,
      // which is what makes the legs read as facing the wrong way.
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.26), black);
      boot.position.set(0, -0.45, -0.05);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.025, 0.27), black);
      sole.position.set(0, -0.495, -0.05);
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

    // Grip anchors, filled in by setWeapon(), and scratch for the IK.
    this.gripLocal = new THREE.Vector3(0, -0.10, 0.04);
    this.foreLocal = new THREE.Vector3();
    this._ikV = new THREE.Vector3();
    this._ikU = new THREE.Vector3();
    this._ikB = new THREE.Vector3();
    this._ikQ = new THREE.Quaternion();
    this._ikQ2 = new THREE.Quaternion();

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
    // Where this weapon is actually held, in weapon space. The arms are
    // driven onto these points by IK below, which is the difference between
    // a soldier holding a rifle and a soldier standing next to one.
    const barrel = weaponDef.model?.barrel ?? 0.3;
    const pistol = weaponDef.key === 'glock17' || weaponDef.key === 'deagle'
      || weaponDef.key === 'revolver';
    this.gripLocal.set(0, -0.10, 0.04);
    if (weaponDef.melee) {
      // one-handed: the support arm has nothing to hold
      this.foreLocal = null;
    } else if (pistol) {
      // both hands cupped around the grip, a little forward of it
      this.foreLocal = this.foreLocal || new THREE.Vector3();
      this.foreLocal.set(-0.04, -0.09, -0.02);
    } else {
      this.foreLocal = this.foreLocal || new THREE.Vector3();
      // Far enough down the handguard to look like a two-handed hold, but
      // never further than an arm from a torso that cannot rotate: the
      // sniper's barrel would otherwise put the support hand out past the
      // muzzle, where the solver has to drag it back anyway.
      this.foreLocal.set(0, -0.02, Math.max(-0.32, -barrel * 0.55 - 0.05));
    }
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
    // A knee only folds one way: the heel comes up and BACK, which with
    // forward = -Z means a negative rotation. These were positive, bending
    // the shins forward like a bird's leg — the other half of why the legs
    // looked like they were on backwards.
    this.legL.userData.shin.rotation.x = -(Math.max(0, -cS) * 0.85 * amp + crouch * 1.1);
    this.legR.userData.shin.rotation.x = -(Math.max(0, cS) * 0.85 * amp + crouch * 1.1);

    // Torso used to be completely rigid while walking — only the legs swung,
    // so a teammate jogging past read as gliding on rails from the waist up.
    // A small vertical bob (double the leg's stride frequency, since both
    // feet land once per full gait cycle) plus a hip-driven shoulder sway
    // gives the upper body some actual weight, eased out during ADS/sprint
    // where their own poses should read as steadier instead.
    const walkBob = amp * (1 - aim * 0.6) * (1 - (this.sprintT || 0) * 0.4);
    this.torso.position.y = 0.02 + Math.abs(cS) * 0.020 * walkBob;
    this.torso.rotation.x = lerp(0, 0.28, crouch) + clamp(-(st.pitch || 0) * 0.28, -0.2, 0.2) + aim * 0.05;
    this.torso.rotation.z = -(st.leanT || 0) * 0.22 + s * 0.03 * walkBob;
    this.torso.rotation.y = s * 0.035 * walkBob;

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

    // Rotation.x here swings the whole down-hanging arm group; positive
    // values swing the hand toward world -Z (forward, where the weapon
    // mount and the model's own face/chest actually are). This used to be
    // negative, which put the gun-hand a full ~0.8 units behind the torso
    // on the opposite side of the body from the weapon it's meant to be
    // holding — from the front the arm read as reaching backward while the
    // gun floated out in front on its own, which is what made the whole
    // rig look like it was facing the wrong way.
    this.armR.rotation.set(
      lerp(1.30 - sp * 0.5 - recoil, 0.95, aim) - reload * 0.15 - pitchLook * 0.32,
      lerp(-0.30 + sp * 0.4, -0.08, aim),
      lerp(0.16, 0.06, aim)
    );
    this.armL.rotation.set(1.45 - sp * 0.75 - recoil - reload * 0.95 - pitchLook * 0.30, 0.55 - sp * 0.2 - aim * 0.4, -0.32 + reload * 0.2);
    this.armL.userData.fore.rotation.x = 0.55 + sp * 0.35 - reload * 0.85;
    this.armR.userData.fore.rotation.x = lerp(0.35, 0.55, aim);

    this.weaponMount.rotation.set(
      lerp(-0.12 + sp * 0.55 + recoil * 1.4, -0.02, aim) + reload * 0.1 + pitchLook * 0.55,
      lerp(-0.26 + sp * 0.55, -0.05, aim),
      sp * 0.35
    );
    const wmX = lerp(0.20 - sp * 0.03, 0.10, aim);
    const wmY = lerp(0.30 - sp * 0.10, 0.40, aim) - reload * 0.03;
    const wmZ = lerp(-0.22 + sp * 0.05, -0.14, aim);
    this.weaponMount.position.set(wmX, wmY, wmZ);

    // The shoulders used to sit at a fixed torso-relative spot and only ever
    // rotate, while the gun they're supposedly holding translates all over
    // the place above (ADS pulls it in and up, sprint drops it down and
    // across). A rotation-only shoulder can't follow a moving target, so
    // teammates read as having their arms just floating out somewhere near
    // a gun rather than actually gripping it. Dragging both shoulders along
    // by the same delta the weapon mount moves — on top of their normal
    // torso-relative rest spot — keeps the hands visually locked to the gun
    // through ADS/sprint/reload instead of drifting apart from it.
    const wmDX = wmX - 0.20, wmDY = wmY - 0.30, wmDZ = wmZ - (-0.22);
    // The support shoulder also sits wider and further forward than the
    // firing one. It is what a person does to get their hand onto a
    // handguard forty centimetres in front of them without turning their
    // chest, and it is most of what "the arms stick out" means from outside:
    // the support arm reads as extended along the weapon instead of folded
    // in against the ribs.
    this.armR.position.set(0.28 + wmDX * 0.75, 0.44 + wmDY * 0.75, wmDZ * 0.75);
    this.armL.position.set(-0.30 + wmDX * 0.55, 0.45 + wmDY * 0.55, -0.09 + wmDZ * 0.55);

    // Then put the HANDS on the gun. Shoulders that only follow the weapon
    // still leave the hands wherever the arm's rest angles happen to point,
    // which is what "not actually holding it" looks like from outside. Two
    // bones, solved: the shoulder aims at the grip and the elbow bends by
    // exactly as much as the distance requires.
    if (!st.dead) {
      this.solveArm(this.armR, this.weaponPoint(this.gripLocal), 0.30, 0.30, ELBOW_ROLL_R);
      if (this.foreLocal) {
        this.solveArm(this.armL, this.reachable(this.weaponPoint(this.foreLocal), this.armL, ARM_REACH),
          0.30, 0.30, ELBOW_ROLL_L);
      }
    }
  }

  /**
   * Slide a hold point back along the weapon until the arm can actually get
   * to it.
   *
   * The support hand is anchored to the handguard, which on the sniper and
   * the shotgun is further from the left shoulder than an arm is long. The
   * solver clamps at full extension and the hand hangs a hand's width short
   * of the gun — which is exactly what "not really holding it" looks like.
   * Walking the anchor back toward the weapon's own origin puts the hand
   * somewhere on the handguard it CAN reach, which is what a shooter does
   * with a long rifle anyway.
   *
   * Closed form: the point where the segment from the anchor to the weapon
   * origin crosses the sphere of the arm's reach.
   */
  reachable(target, arm, reach) {
    const ax = target.x - arm.position.x;
    const ay = target.y - arm.position.y;
    const az = target.z - arm.position.z;
    if (ax * ax + ay * ay + az * az <= reach * reach) return target;
    const m = this.weaponMount.position;
    const bx = m.x - target.x, by = m.y - target.y, bz = m.z - target.z;
    const bb = bx * bx + by * by + bz * bz;
    if (bb < 1e-9) return target;
    const ab = ax * bx + ay * by + az * bz;
    const c = ax * ax + ay * ay + az * az - reach * reach;
    const disc = ab * ab - bb * c;
    // No crossing means the weapon origin is out of reach too; go as far as
    // the segment allows and let the solver clamp the rest.
    const f = disc < 0 ? 1 : Math.min(1, Math.max(0, (-ab - Math.sqrt(disc)) / bb));
    return target.set(target.x + bx * f, target.y + by * f, target.z + bz * f);
  }

  /** A point in weapon space, expressed in the torso space the arms live in. */
  weaponPoint(local) {
    return this._ikV.copy(local)
      .applyEuler(this.weaponMount.rotation)
      .add(this.weaponMount.position);
  }

  /**
   * Two-bone IK for an arm that hangs along -Y at rest.
   *
   * The shoulder is rotated so its own -Y axis points at the target, then
   * tilted back by the angle the law of cosines says the upper arm needs, and
   * the elbow takes the remainder. Reach is clamped just short of full
   * extension: at exactly L1+L2 the triangle degenerates and the elbow snaps.
   *
   * `roll` swings the elbow around the shoulder-to-hand line. Two bones and a
   * target under-determine an arm — the elbow can sit anywhere on a circle —
   * and the bare solve puts it wherever the maths lands, which was tight in
   * against the ribs. Rolling about that exact line is the one move that
   * cannot disturb the grip: the hand is ON the axis, so it stays put while
   * the elbow swings out.
   */
  solveArm(arm, target, L1, L2, roll = 0) {
    const dx = target.x - arm.position.x;
    const dy = target.y - arm.position.y;
    const dz = target.z - arm.position.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return;
    // Reach is clamped just short of full extension: at exactly L1+L2 the
    // triangle degenerates and the elbow snaps.
    const cl = Math.min(Math.max(d, 0.12), (L1 + L2) * 0.995);
    const u = this._ikU.set(dx / d, dy / d, dz / d);

    // Aim: the shortest rotation taking the arm's rest axis onto the line to
    // the target. Doing this as a quaternion rather than as Euler angles is
    // what makes the rest of the solve exact. The Euler version tilted the
    // upper arm about the PARENT's x axis, which is only perpendicular to the
    // aim when the target is straight ahead — every other time the hand
    // landed a few centimetres off the grip, and the support hand, reaching
    // furthest across the body, was off by ten.
    const q = this._ikQ.setFromUnitVectors(REST_AXIS, u);
    // Elbow roll about the aim line. It cannot move the hand: the hand is on
    // that line, and every point of an axis is fixed by a rotation about it.
    if (roll) q.premultiply(this._ikQ2.setFromAxisAngle(u, roll));
    // The bend axis is the arm's own x after aiming, which the construction
    // above guarantees is perpendicular to the aim.
    const bend = this._ikB.set(1, 0, 0).applyQuaternion(q);

    // Law of cosines on the triangle shoulder-elbow-hand.
    const cosA = (L1 * L1 + cl * cl - L2 * L2) / (2 * L1 * cl);
    const cosT = (L1 * L1 + L2 * L2 - cl * cl) / (2 * L1 * L2);
    const a = Math.acos(Math.min(1, Math.max(-1, cosA)));
    const t = Math.acos(Math.min(1, Math.max(-1, cosT)));

    arm.quaternion.copy(q).premultiply(this._ikQ2.setFromAxisAngle(bend, -a));
    arm.userData.fore.rotation.x = Math.PI - t;
  }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
  }
}
