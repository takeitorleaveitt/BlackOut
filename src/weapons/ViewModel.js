// First-person view model.
//
// The weapon is NOT welded to the middle of the screen.  It hangs off a
// simulated set of hands that lag behind the camera, gets pushed by walking,
// drops when you sprint, and swings on its own inertia when you turn.  ADS
// slides the actual sight (optic or irons) onto the camera axis.
//
// Rendered in a dedicated scene with a cleared depth buffer so the gun never
// clips through geometry.

import * as THREE from 'three';
import { buildWeaponModel, disposeWeaponModel } from './WeaponModels.js';
import { buildArm, GRIP_ANCHOR, SUPPORT_OFFSET, PISTOL_SUPPORT } from './Arms.js';
import { WS } from './Weapon.js';
import { S } from '../core/Settings.js';
import { clamp, lerp, smoothDamp } from '../shared/constants.js';

// Easing set. Every animation in the view model is authored against these
// rather than against raw linear time, because the difference between a
// motion that reads as a prop being slid around and one that reads as a
// weight being handled is almost entirely in the curve:
//   ease            smoothstep — accelerate in, decelerate out
//   easeOutCubic    fast start, long tail: things thrown or released
//   easeInCubic     slow start, fast end: things falling or driven
//   easeOutBack     overshoots the target and comes back — anything that
//                   arrives with momentum instead of parking
//   settle          a struck spring ringing down: the "and rest" that ends
//                   a motion instead of it simply stopping
const ease = (x) => x * x * (3 - 2 * x);
const easeOutCubic = (x) => 1 - (1 - x) ** 3;
const easeInCubic = (x) => x * x * x;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOutBack = (x, k = 1.7) => {
  const u = x - 1;
  return 1 + (k + 1) * u * u * u + k * u * u;
};
const pulse = (x) => Math.sin(x * Math.PI);
const settle = (x, freq = 2.6, damp = 5.5) =>
  Math.cos(x * Math.PI * freq) * Math.exp(-x * damp);

// How far below the sight line the weapon sits when aimed. See the compose
// step in update(): a gun whose own body eats the lower screen needs to come
// down, or aiming it means seeing less than hip fire did.
// How much of a weapon's recoil push-back the view model shows. The recoil
// itself — where the shots land, how far the aim climbs — is untouched by
// these; they only decide how much the gun visibly rocks while you hold the
// trigger. Both were about a third higher, which on a fast gun turned the
// screen into a see-saw and made it hard to read your own fire.
const PUNCH_POS = 0.58;     // metres of push-back per unit of punch
const PUNCH_ROT = 1.00;     // radians of muzzle rise per unit of punch

const ADS_DROP = {
  revolver: 0.052,
  deagle: 0.014,
  glock17: 0.012,
  m870: 0.010,
  default: 0.006
};

// Per-weapon hip pose. Heavier guns sit lower and further out.
const HIP = {
  m4a1: { p: [0.150, -0.148, -0.62], r: [0.03, -0.07, 0.0] },
  ak74: { p: [0.158, -0.156, -0.62], r: [0.035, -0.08, 0.0] },
  mp5: { p: [0.144, -0.138, -0.56], r: [0.03, -0.07, 0.0] },
  mp7: { p: [0.136, -0.130, -0.52], r: [0.03, -0.08, 0.0] },
  m870: { p: [0.156, -0.156, -0.66], r: [0.04, -0.08, 0.0] },
  glock17: { p: [0.120, -0.126, -0.48], r: [0.03, -0.09, 0.0] },
  deagle: { p: [0.128, -0.132, -0.50], r: [0.03, -0.09, 0.0] },
  revolver: { p: [0.126, -0.128, -0.50], r: [0.03, -0.09, 0.0] },
  scarh: { p: [0.162, -0.162, -0.68], r: [0.04, -0.075, 0.0] },
  knife: { p: [0.150, -0.190, -0.30], r: [0.02, -0.20, 0.0] }
};

export class ViewModel {
  constructor(engine) {
    this.engine = engine;
    this.scene = new THREE.Scene();
    // The weapon is rendered in view space by its own camera.  Real games do
    // this because the wide world FOV a body camera needs (85°+) would make a
    // real-scale rifle swallow half the screen.
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.008, 12);
    this.scene.add(this.camera);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.holder = new THREE.Group();    // the animated "hands"
    this.root.add(this.holder);

    // dedicated 3-point rig: the world lights do not reach this scene
    const key = new THREE.DirectionalLight(0xfff0dd, 3.2);
    key.position.set(-0.6, 1.0, 0.4);
    const fill = new THREE.DirectionalLight(0x8fa8c8, 1.3);
    fill.position.set(0.9, -0.2, 0.6);
    const rim = new THREE.DirectionalLight(0xbcd0ff, 2.0);
    rim.position.set(0.2, 0.4, -1.0);
    this.scene.add(key, fill, rim);
    this.ambient = new THREE.AmbientLight(0x404a55, 1.4);
    this.scene.add(this.ambient);
    this.rig = { key, fill, rim };
    this.rigBase = { key: 3.2, fill: 1.3, rim: 2.0, ambient: 1.4 };

    this.model = null;
    this.weapon = null;
    // key -> built model, in least-recently-used order (Map preserves it)
    this.modelCache = new Map();

    // Persistent arms — built once, repositioned per weapon in equip(). As
    // children of `holder` they ride along with every bit of animation the
    // weapon already gets (sway, recoil, reload, ADS, sprint) at no extra cost.
    this.rightArm = buildArm(false);
    this.leftArm = buildArm(true);
    this.holder.add(this.rightArm, this.leftArm);

    // motion state
    this.sway = new THREE.Vector2();
    this.swayVel = new THREE.Vector2();
    this.bobT = 0;
    this.bob = new THREE.Vector3();
    this.lag = new THREE.Vector3();
    this.rotLag = new THREE.Vector3();
    this.sprintT = 0;
    this.animOffset = new THREE.Vector3();
    this.animRot = new THREE.Vector3();
    // The left (support) hand gets its own reach animation on top of the
    // holder transform — it lets go of the handguard to run the reload and
    // tightens up on it when aiming, instead of just riding along rigidly.
    this.leftArmBaseP = new THREE.Vector3();
    this.leftArmBaseR = new THREE.Vector3();
    this.leftArmOffset = new THREE.Vector3();
    this.leftArmOffsetRot = new THREE.Vector3();
    this.leftArmTargetOffset = new THREE.Vector3();
    this.leftArmTargetRot = new THREE.Vector3();
    this.wallT = 0;
    this.tmpV = new THREE.Vector3();
    this.tmpQ = new THREE.Quaternion();
    this.muzzleWorld = new THREE.Vector3();
    this.muzzleDir = new THREE.Vector3();
    this.visible = true;
  }

  setEnvironment(envTex) { this.scene.environment = envTex; }

  /**
   * Inspection lighting for the loadout screen: gun metal is nearly black, so
   * the in-game rig leaves it unreadable against a dark interface.
   */
  setPreviewLighting(on) {
    const m = on ? 3.4 : 1;
    this.rig.key.intensity = this.rigBase.key * m;
    this.rig.fill.intensity = this.rigBase.fill * m;
    this.rig.rim.intensity = this.rigBase.rim * m;
    this.ambient.intensity = this.rigBase.ambient * (on ? 2.6 : 1);
  }

  setAspect(aspect) {
    if (this.camera.aspect === aspect) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  equip(weapon) {
    if (!weapon || !weapon.def) return null;
    if (this.model) this.holder.remove(this.model.root);
    this.weapon = weapon;
    // Weapon models are CACHED, not rebuilt. Every switch used to throw away
    // a few hundred box geometries and build a few hundred more, mid-match,
    // in the frame the key was pressed — for a set of models that never
    // changes. Keyed by weapon plus its fitted attachments, because an optic
    // changes the geometry.
    const cacheKey = weapon.def.key + '|' + weapon.attachments.slice().sort().join(',');
    let model = this.modelCache.get(cacheKey);
    if (model) {
      // freshen the LRU order
      this.modelCache.delete(cacheKey);
    } else {
      model = buildWeaponModel(weapon.def, weapon.attachments);
      // Bound it. A session only ever sees a handful of combinations, but a
      // cache with no ceiling is a leak waiting for someone to find it.
      while (this.modelCache.size >= 12) {
        const oldest = this.modelCache.keys().next().value;
        disposeWeaponModel(this.modelCache.get(oldest));
        this.modelCache.delete(oldest);
      }
    }
    this.modelCache.set(cacheKey, model);
    this.model = model;
    // A reused model still carries whatever pose it was left in.
    model.root.position.set(0, 0, 0);
    model.root.rotation.set(0, 0, 0);
    if (model.mag) {
      model.mag.position.y = model.mag.userData.baseY ?? model.mag.position.y;
      model.mag.rotation.set(0, 0, 0);
      model.mag.visible = true;
    }
    if (model.bolt) {
      model.bolt.position.z = model.bolt.userData.baseZ ?? model.bolt.position.z;
      model.bolt.rotation.set(0, 0, 0);
    }
    if (model.pump) model.pump.position.z = model.pump.userData.baseZ ?? model.pump.position.z;
    if (model.cylinder) { model.cylinder.rotation.set(0, 0, 0); model.cylinderCore.rotation.set(0, 0, 0); }
    this.holder.add(model.root);
    this.pose = HIP[weapon.def.key] || HIP.m4a1;
    this.reloadPhase = 0;
    // Revolver bookkeeping is per-weapon: carrying a spin target across a
    // weapon switch would snap the next cylinder to wherever the last one was.
    this.lastAmmo = weapon.ammo;
    this.cylTarget = 0;
    this.cylSpin = 0;
    this.cylOut = 0;
    this.spinX = 0;
    if (this.model.root) this.model.root.rotation.set(0, 0, 0);
    this.placeArms(weapon.def);
    return this.model;
  }

  /** Seat the hands on the newly-equipped weapon's grip and handguard. */
  placeArms(def) {
    const grip = GRIP_ANCHOR[def.key] || GRIP_ANCHOR.m4a1;
    this.rightArm.position.set(grip.p[0], grip.p[1], grip.p[2]);
    this.rightArm.rotation.set(grip.r[0], grip.r[1], grip.r[2]);

    if (def.key === 'glock17' || def.key === 'deagle' || def.key === 'revolver') {
      // pistols get a two-handed cup instead of a handguard grip
      this.leftArmBaseP.set(PISTOL_SUPPORT.p[0], PISTOL_SUPPORT.p[1], PISTOL_SUPPORT.p[2]);
      this.leftArmBaseR.set(PISTOL_SUPPORT.r[0], PISTOL_SUPPORT.r[1], PISTOL_SUPPORT.r[2]);
      this.leftArm.visible = true;
    } else if (def.key === 'knife') {
      // a knife is held one-handed
      this.leftArm.visible = false;
    } else if (this.model.underMount) {
      const um = this.model.underMount.position;
      this.leftArmBaseP.set(um.x + SUPPORT_OFFSET.p[0], um.y + SUPPORT_OFFSET.p[1], um.z + SUPPORT_OFFSET.p[2]);
      this.leftArmBaseR.set(SUPPORT_OFFSET.r[0], SUPPORT_OFFSET.r[1], SUPPORT_OFFSET.r[2]);
      this.leftArm.visible = true;
    } else {
      this.leftArm.visible = false;
    }
    this.leftArm.position.copy(this.leftArmBaseP);
    this.leftArm.rotation.set(this.leftArmBaseR.x, this.leftArmBaseR.y, this.leftArmBaseR.z);
    this.leftArmOffset.set(0, 0, 0);
    this.leftArmOffsetRot.set(0, 0, 0);
  }

  /**
   * Muzzle position/direction in WORLD space.  The view model lives in view
   * space, so its transform is pushed back out through the main camera.
   */
  getMuzzle(out = {}, worldCamera) {
    if (!this.model) return null;
    this.model.muzzle.updateWorldMatrix(true, false);
    this.muzzleWorld.setFromMatrixPosition(this.model.muzzle.matrixWorld);
    this.muzzleDir.set(0, 0, -1).applyQuaternion(
      this.model.muzzle.getWorldQuaternion(this.tmpQ)
    );
    const cam = worldCamera || this.worldCamera;
    if (cam) {
      this.muzzleWorld.applyMatrix4(cam.matrixWorld);
      this.muzzleDir.transformDirection(cam.matrixWorld);
    }
    out.pos = this.muzzleWorld;
    out.dir = this.muzzleDir;
    return out;
  }

  /** Same conversion for any node in the view-model scene. */
  toWorld(object3d, out = new THREE.Vector3(), worldCamera) {
    object3d.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(object3d.matrixWorld);
    const cam = worldCamera || this.worldCamera;
    if (cam) out.applyMatrix4(cam.matrixWorld);
    return out;
  }

  /**
   * @param ctx {
   *   dt, camera, yawRate, pitchRate, speed, sprinting, crouching, grounded,
   *   moving, landImpact, dead
   * }
   */
  update(dt, ctx) {
    if (!this.model) return;
    const w = this.weapon;
    const cam = ctx.camera;
    this.worldCamera = cam;
    this.setAspect(cam.aspect);
    // The root stays at the origin: everything below is already view space.

    // Weapon sway is no longer a setting: it is fixed at half strength for
    // everyone, so it stays a bit of weapon weight rather than something
    // that can be tuned away for an advantage.
    const swayScale = 0.5 * (w.def.sway.amp || 1);
    const inertia = w.def.sway.inertia || 1;
    const ads = w.adsT;

    // --- turn inertia: the muzzle trails the camera ------------------------
    const targetSwayX = clamp(-ctx.yawRate * 0.0022 * inertia, -0.055, 0.055);
    const targetSwayY = clamp(ctx.pitchRate * 0.0018 * inertia, -0.045, 0.045);
    this.swayVel.x += (targetSwayX - this.sway.x) * 42 * dt;
    this.swayVel.y += (targetSwayY - this.sway.y) * 42 * dt;
    this.swayVel.multiplyScalar(Math.exp(-11 * dt));
    this.sway.x += this.swayVel.x * dt * 8;
    this.sway.y += this.swayVel.y * dt * 8;
    this.sway.x = clamp(this.sway.x, -0.10, 0.10);
    this.sway.y = clamp(this.sway.y, -0.09, 0.09);

    // --- positional lag ----------------------------------------------------
    const lagTarget = this.tmpV.set(
      this.sway.x * (1 - ads * 0.72) * swayScale,
      this.sway.y * (1 - ads * 0.72) * swayScale,
      0
    );
    this.lag.lerp(lagTarget, 1 - Math.exp(-16 * dt));
    this.rotLag.x = smoothDamp(this.rotLag.x, -this.sway.y * 2.6 * inertia, 14, dt);
    this.rotLag.y = smoothDamp(this.rotLag.y, this.sway.x * 3.1 * inertia, 14, dt);
    this.rotLag.z = smoothDamp(this.rotLag.z, -this.sway.x * 2.2 * inertia, 10, dt);

    // --- walk bob ----------------------------------------------------------
    const speedN = clamp(ctx.speed / 5.5, 0, 1.3);
    const bobRate = ctx.sprinting ? 11.5 : ctx.crouching ? 5.5 : 8.2;
    if (ctx.moving && ctx.grounded) this.bobT += dt * bobRate * (0.55 + speedN * 0.7);
    const bobAmt = (S.headBob ?? 1) * speedN * (1 - ads * 0.82) * (ctx.grounded ? 1 : 0.15);
    const freq = w.def.sway.freq || 1;
    this.bob.set(
      Math.sin(this.bobT * freq) * 0.022 * bobAmt,
      (Math.abs(Math.cos(this.bobT * freq)) - 0.5) * 0.020 * bobAmt,
      Math.sin(this.bobT * freq * 0.5) * 0.010 * bobAmt
    );

    // --- sprint pose -------------------------------------------------------
    const wantSprint = ctx.sprinting && ctx.moving && !w.isBusy ? 1 : 0;
    this.sprintT = smoothDamp(this.sprintT, wantSprint, 9, dt);

    // --- animations (reload / draw / inspect / cycle) -----------------------
    this.updateAnim(dt, w);

    // --- wall proximity: pull the gun in so it stops poking through --------
    const wallTarget = ctx.wallDistance !== undefined && ctx.wallDistance < 0.9 && !ads
      ? clamp(1 - ctx.wallDistance / 0.9, 0, 1) : 0;
    this.wallT = smoothDamp(this.wallT, wallTarget, 12, dt);

    // --- compose -----------------------------------------------------------
    const hip = this.pose;
    const sight = this.model.sightHeight;
    // ADS target: the sight sits on the camera axis, slightly forward.
    //
    // ADS_DROP pulls the whole weapon down from there. A revolver sighted
    // over its rib puts a lot of steel between you and the target — frame,
    // cylinder, shroud and hand all sit in the lower half of the screen —
    // so it drops furthest. The others get a token amount, which reads as
    // holding the gun slightly below eyeline rather than welded to it.
    const drop = ADS_DROP[w.def.key] ?? ADS_DROP.default;
    const adsP = [0, -sight - drop, -0.40];
    const px = lerp(hip.p[0], adsP[0], ads);
    const py = lerp(hip.p[1], adsP[1], ads);
    const pz = lerp(hip.p[2], adsP[2], ads);

    const sprintP = [0.055, -0.075, 0.045];
    const sx = lerp(px, px + sprintP[0], this.sprintT);
    const sy = lerp(py, py + sprintP[1], this.sprintT);
    const sz = lerp(pz, pz + sprintP[2], this.sprintT);

    const punch = w.punch;
    this.holder.position.set(
      sx + this.lag.x + this.bob.x + this.animOffset.x - this.wallT * 0.05,
      sy + this.lag.y + this.bob.y + this.animOffset.y - this.wallT * 0.10,
      sz + this.bob.z + this.animOffset.z + punch * PUNCH_POS + this.wallT * 0.14
    );

    const hipR = hip.r;
    this.holder.rotation.set(
      lerp(hipR[0], 0, ads) + this.rotLag.x * (1 - ads * 0.6) + this.animRot.x
        + this.sprintT * 0.28 + punch * PUNCH_ROT - this.wallT * 0.15,
      lerp(hipR[1], 0, ads) + this.rotLag.y * (1 - ads * 0.6) + this.animRot.y
        + this.sprintT * 0.42 + this.wallT * 0.5,
      lerp(hipR[2], 0, ads) + this.rotLag.z * (1 - ads * 0.5) + this.animRot.z
        + this.sprintT * 0.55 + Math.sin(this.bobT * freq * 0.5) * 0.02 * bobAmt,
      'XYZ'
    );

    // land impact dip
    if (ctx.landImpact > 0.01) {
      this.holder.position.y -= ctx.landImpact * 0.07;
      this.holder.rotation.x += ctx.landImpact * 0.16;
    }

    // weapon light follows the flashlight attachment automatically (child of it)
    const lightAttach = this.model.attached.light;
    if (lightAttach) lightAttach.intensity = w.lightOn ? 34 : 0;

    this.root.visible = this.visible && !ctx.dead;
  }

  /** Drives the animated parts: magazine, bolt, pump, cylinder, and the hands. */
  updateAnim(dt, w) {
    const m = this.model;
    const t = w.stateT;
    const dur = Math.max(0.001, w.stateDur);
    const k = clamp(t / dur, 0, 1);
    let ox = 0, oy = 0, oz = 0, rx = 0, ry = 0, rz = 0;
    let magY = 0, magR = 0, magRX = 0, magVisible = true, boltZ = 0, pumpZ = 0;
    // Revolver: how far the cylinder is swung out of the frame (0..1), and a
    // whole-gun spin used only by its inspect.
    let cylOut = 0, spinX = 0;
    // left (support) hand reach, local to its resting anchor on the handguard
    let lox = 0, loy = 0, loz = 0, lrx = 0, lry = 0, lrz = 0;

    const isRevolver = w.def.key === 'revolver';

    switch (w.state) {
      case WS.DRAWING: {
        // Comes up fast, overshoots a few degrees past level, then rings down.
        // The old draw interpolated to the rest pose and stopped dead, which
        // is the single thing that made every animation in the game read as a
        // slider being dragged rather than a weight being moved.
        const e = 1 - easeOutBack(k, 1.15);
        oy = -0.24 * e; oz = 0.10 * e; ox = 0.05 * e;
        rx = 0.75 * e; rz = -0.35 * e; ry = -0.20 * e;
        const s = settle(clamp((k - 0.5) / 0.5, 0, 1), 2.2, 6.0) * (1 - k);
        rx += s * 0.075; rz += s * 0.045; ry += s * 0.030; oy += s * 0.008;
        // the support hand arrives a beat after the gun does
        const grab = ease(clamp((k - 0.22) / 0.55, 0, 1));
        lox = -0.045 * (1 - grab); loy = -0.075 * (1 - grab); loz = 0.055 * (1 - grab);
        lrx = 0.42 * (1 - grab);
        break;
      }
      case WS.HOLSTERING: {
        // A beat of anticipation — the muzzle lifts — before it drops away.
        // Motion that starts by going the other way reads as intended; motion
        // that just starts reads as a cut.
        const anti = pulse(clamp(k / 0.20, 0, 1));
        const e = easeInCubic(clamp((k - 0.12) / 0.88, 0, 1));
        oy = 0.022 * anti - 0.30 * e;
        oz = -0.012 * anti + 0.050 * e;
        ox = 0.030 * e;
        rx = -0.12 * anti + 0.95 * e;
        rz = 0.07 * anti - 0.46 * e;
        ry = 0.32 * e;
        lrx = 0.35 * e; loy = -0.06 * e;
        break;
      }
      case WS.RELOADING: {
        // Four beats now, not three: roll the gun over and break the mag out,
        // let it tumble clear, bring the fresh one up and seat it with a shove,
        // then let the whole thing ring back to level instead of arriving there.
        const dropEnd = w.emptyReload ? 0.30 : 0.34;
        const insertEnd = w.emptyReload ? 0.68 : 0.78;
        if (k < dropEnd) {
          const a = k / dropEnd;
          const e = easeOutCubic(a);
          oy = -0.078 * e; rz = -0.32 * e; rx = 0.20 * e; ox = -0.026 * e;
          ry = 0.16 * e;
          // the mag is pushed, then falls under its own weight and tumbles
          magY = -0.42 * a * a;
          magR = a * 1.1;
          magRX = a * a * 0.9;
          if (a > 0.55) magVisible = false;
          // left hand lets go of the handguard and drops to the mag pouch
          const reach = easeInOutCubic(a);
          lox = -0.035 * reach; loy = -0.36 * reach; loz = 0.26 * reach;
          lrx = 1.02 * reach; lry = -0.20 * reach; lrz = 0.18 * reach;
        } else if (k < insertEnd) {
          const a = (k - dropEnd) / (insertEnd - dropEnd);
          const shove = pulse(clamp((a - 0.55) / 0.45, 0, 1));
          oy = -0.078 - 0.040 * shove; rz = -0.32 + 0.07 * a; rx = 0.20 - 0.055 * a;
          ox = -0.026 + 0.018 * a; ry = 0.16 - 0.10 * a;
          oz = -0.020 * shove;                     // the gun takes the push back
          magVisible = a > 0.42;
          const seat = clamp((a - 0.42) / 0.5, 0, 1);
          magY = -0.24 * (1 - easeOutCubic(seat));
          magR = 0.55 * (1 - seat);
          magRX = 0.35 * (1 - seat);
          // fresh mag rises out of the pouch on an arc, not a straight line
          const rise = easeOutCubic(clamp(a / 0.65, 0, 1));
          lox = -0.035 * (1 - rise) - 0.012 * rise;
          loy = -0.36 + 0.33 * rise;
          loz = 0.26 - 0.24 * rise + 0.03 * pulse(rise);
          lrx = 1.02 * (1 - rise) + 0.09 * rise; lry = -0.20 * (1 - rise);
          lrz = 0.18 * (1 - rise);
        } else {
          const a = (k - insertEnd) / (1 - insertEnd);
          const e = easeOutCubic(a);
          const s = settle(a, 2.4, 5.2) * (1 - a);
          oy = -0.115 * (1 - e) + s * 0.010;
          rz = -0.25 * (1 - e) + s * 0.055;
          rx = 0.14 * (1 - e) + s * 0.045;
          ry = 0.06 * (1 - e);
          magY = 0; magR = 0; magRX = 0;
          const back = e;
          lox = -0.012 * (1 - back); loy = -0.035 * (1 - back); loz = 0.025 * (1 - back);
          lrx = 0.09 * (1 - back);
          if (w.emptyReload) {
            // charging handle yanked back and released — it snaps home faster
            // than it was pulled, which is the whole character of the motion
            const b = clamp((a - 0.30) / 0.45, 0, 1);
            const pull = b < 0.55 ? easeOutCubic(b / 0.55) : 1 - easeInCubic((b - 0.55) / 0.45);
            boltZ = pull * 0.080;
            rx += pull * 0.11; ox += pull * 0.032; ry += pull * 0.05;
            lrx += pull * 0.14; loy -= pull * 0.024; lox += pull * 0.02;
          }
        }
        break;
      }
      case WS.RELOAD_LOOP: {
        if (isRevolver) {
          // The revolver has two different beats sharing this state: the long
          // first one that breaks the cylinder out and punches the ejector,
          // and the short repeating one that feeds a single round. They are
          // told apart by their duration — reload() opens with reloadStart and
          // loadShell() then re-enters with the per-round time.
          const opening = w.stateDur > w.def.reloadTactical + 0.05;
          cylOut = 1;
          if (opening) {
            const swing = easeOutBack(clamp(k / 0.55, 0, 1), 1.1);
            cylOut = swing;
            // gun rolls left and tips up so the empties fall out of it
            oy = -0.045 * swing; ox = -0.030 * swing; oz = 0.035 * swing;
            rz = -0.62 * swing; rx = -0.34 * swing; ry = 0.30 * swing;
            // left hand comes across, cups the cylinder and slaps the ejector
            const eject = pulse(clamp((k - 0.5) / 0.5, 0, 1));
            lox = -0.055 * swing + 0.02 * eject;
            loy = -0.045 * swing - 0.03 * eject;
            loz = 0.020 * swing - 0.05 * eject;
            lrx = 0.30 * swing + 0.25 * eject; lry = -0.35 * swing;
            rx += eject * 0.06;
          } else {
            // One round: hand dips to the belt, comes back, pushes it home.
            const feed = pulse(k);
            const push = pulse(clamp((k - 0.62) / 0.38, 0, 1));
            oy = -0.045 - 0.012 * feed; ox = -0.030; oz = 0.035;
            rz = -0.62 + 0.05 * feed; rx = -0.34; ry = 0.30;
            rx += push * 0.05;
            lox = -0.055 - 0.055 * feed;
            loy = -0.045 - 0.30 * feed + 0.04 * push;
            loz = 0.020 + 0.22 * feed - 0.06 * push;
            lrx = 0.30 + 0.72 * feed; lry = -0.35 - 0.16 * feed; lrz = 0.20 * feed;
          }
        } else {
          // shell-by-shell: hand dips to the pouch and back on every shell,
          // and the gun rocks with it rather than hanging still
          const a = k;
          const feed = pulse(a);
          const push = pulse(clamp((a - 0.6) / 0.4, 0, 1));
          oy = -0.060 * feed; ox = -0.045 * feed; oz = 0.014 * push;
          rz = -0.24 * feed; rx = 0.13 * feed + 0.05 * push; ry = 0.10 * feed;
          lox = -0.024 * feed; loy = -0.26 * feed; loz = 0.17 * feed - 0.03 * push;
          lrx = 0.66 * feed; lrz = 0.14 * feed;
        }
        break;
      }
      case WS.CYCLING: {
        if (isRevolver) {
          // Snapping the cylinder shut: a flick of the wrist, then the whole
          // gun rings back to level.
          const shut = easeOutCubic(clamp(k / 0.42, 0, 1));
          cylOut = 1 - shut;
          const s = settle(clamp((k - 0.35) / 0.65, 0, 1), 2.6, 5.0);
          const hold = 1 - easeOutCubic(clamp((k - 0.3) / 0.7, 0, 1));
          oy = -0.045 * hold + s * 0.008;
          ox = -0.030 * hold;
          oz = 0.035 * hold;
          rz = -0.62 * hold + s * 0.09;
          rx = -0.34 * hold + s * 0.06;
          ry = 0.30 * hold;
          const off = hold;
          lox = -0.055 * off; loy = -0.045 * off; loz = 0.020 * off;
          lrx = 0.30 * off; lry = -0.35 * off;
        } else if (w.def.key === 'm40') {
          // Bolt worked by hand: lift, pull straight back, shove home, turn
          // down. The rifle rolls to the right as the hand comes off the grip.
          const up = clamp(k / 0.22, 0, 1);
          const back = clamp((k - 0.18) / 0.32, 0, 1);
          const fwd = clamp((k - 0.52) / 0.30, 0, 1);
          const down = clamp((k - 0.80) / 0.20, 0, 1);
          boltZ = (easeOutCubic(back) - easeInCubic(fwd)) * 0.105;
          rz = ease(up) * 0.30 - ease(down) * 0.30;
          rx = (ease(back) - ease(fwd)) * 0.075;
          ry = ease(up) * 0.10 - ease(down) * 0.10;
          oz = (ease(back) - ease(fwd)) * 0.030;
          oy = -pulse(k) * 0.015;
          const off = ease(up) - ease(down);
          lox = off * 0.055; loy = off * -0.035; loz = off * 0.075;
          lrx = off * 0.35; lry = off * -0.22;
        } else {
          // Pump: rack back hard, slam forward, and let the gun buck with it.
          const back = easeOutCubic(clamp(k / 0.42, 0, 1));
          const fwd = easeInCubic(clamp((k - 0.42) / 0.38, 0, 1));
          const s = settle(clamp((k - 0.78) / 0.22, 0, 1), 2.4, 5.5) * 0.6;
          pumpZ = (back - fwd) * 0.095;
          boltZ = (back - fwd) * 0.05;
          oz = (back - fwd) * 0.026;
          rx = (back - fwd) * 0.062 + s * 0.05;
          rz = (back - fwd) * -0.05;
          loz = (back - fwd) * 0.070; lrx = (back - fwd) * 0.14;
        }
        break;
      }
      case WS.INSPECTING: {
        const a = k;
        if (w.def.melee) {
          // Brought up close, spun in the fingers, flipped to show the other
          // face of the blade, then dropped back to the ready pose.
          const bring = pulse(a);
          const soft = pulse(easeInOutCubic(a));
          oz = soft * 0.105; oy = bring * 0.038; ox = bring * -0.032;
          rz = Math.sin(easeInOutCubic(a) * Math.PI * 2) * 1.75;
          ry = soft * 0.80;
          rx = Math.sin(a * Math.PI * 3) * 0.20 + settle(a, 3, 4) * 0.05 * a;
        } else if (isRevolver) {
          // Twirled on the trigger guard. Two turns, a look at the cylinder
          // with it swung out, then a second twirl to catch it. Every phase
          // lands on a whole rotation, so the spin never has to unwind.
          if (a < 0.40) {
            const e = easeInOutCubic(a / 0.40);
            spinX = e * Math.PI * 2;
            const p = pulse(a / 0.40);
            oy = p * 0.050; oz = p * 0.055; ox = p * -0.022;
            rz = Math.sin(e * Math.PI * 2) * 0.24;
            ry = p * 0.18;
          } else if (a < 0.78) {
            const e = (a - 0.40) / 0.38;
            spinX = Math.PI * 2;
            const look = pulse(e);
            cylOut = ease(clamp(e * 1.8, 0, 1)) * (1 - ease(clamp((e - 0.6) / 0.4, 0, 1)));
            oz = 0.070 * look; oy = 0.030 * look; ox = -0.028 * look;
            ry = 0.62 * look; rz = -0.34 * look; rx = -0.20 * look;
            lox = -0.050 * look; loy = -0.030 * look; lry = -0.40 * look;
            lrx = 0.28 * look;
          } else {
            const e = easeInOutCubic((a - 0.78) / 0.22);
            spinX = Math.PI * 2 + e * Math.PI * 2;
            const p = pulse((a - 0.78) / 0.22);
            oy = p * 0.042; oz = p * 0.040;
            rz = Math.sin(e * Math.PI) * -0.18;
          }
        } else {
          // Three beats: tip the gun over to read the left side of the
          // receiver, roll it back the other way to check the ejection port
          // and thumb the bolt, then let it ring down to level.
          if (a < 0.38) {
            const e = easeOutCubic(a / 0.38);
            oz = 0.090 * e; oy = 0.024 * e; ox = -0.034 * e;
            ry = 1.00 * e; rz = 0.32 * e; rx = -0.18 * e;
            lox = -0.030 * e; loy = -0.020 * e; lrz = 0.20 * e;
          } else if (a < 0.74) {
            const e = easeInOutCubic((a - 0.38) / 0.36);
            oz = 0.090 - 0.022 * e; oy = 0.024 - 0.050 * e; ox = -0.034 + 0.080 * e;
            ry = 1.00 - 1.62 * e; rz = 0.32 - 0.86 * e; rx = -0.18 + 0.45 * e;
            lox = -0.030 + 0.050 * e; loy = -0.020 - 0.020 * e; lrz = 0.20 - 0.34 * e;
            // thumb the bolt back and let it run home, once, mid-roll
            const b = clamp((e - 0.35) / 0.5, 0, 1);
            const pull = b < 0.5 ? easeOutCubic(b / 0.5) : 1 - easeInCubic((b - 0.5) / 0.5);
            boltZ = pull * 0.090;
            rx += pull * 0.075; lrx += pull * 0.18;
          } else {
            const e = (a - 0.74) / 0.26;
            const back = 1 - easeOutCubic(e);
            const s = settle(e, 2.2, 5.0) * (1 - e) * 0.5;
            oz = 0.068 * back; oy = -0.026 * back; ox = 0.046 * back;
            ry = -0.62 * back + s * 0.06; rz = -0.54 * back + s * 0.05; rx = 0.27 * back + s * 0.04;
            lox = 0.020 * back; loy = -0.040 * back; lrz = -0.14 * back;
          }
        }
        break;
      }
      default: {
        // Idle breathing, on two frequencies that never line up, plus a very
        // slow figure-eight drift. One sine wave reads as a machine; two that
        // beat against each other read as a person holding something heavy.
        const bt = performance.now() / 1000;
        const calm = 1 - w.adsT * 0.75;
        oy = (Math.sin(bt * 1.15) * 0.0022 + Math.sin(bt * 2.37) * 0.0007) * calm;
        ox = (Math.cos(bt * 0.83) * 0.0018 + Math.sin(bt * 1.91) * 0.0006) * calm;
        oz = Math.sin(bt * 0.61) * 0.0012 * calm;
        rz = (Math.sin(bt * 0.71) * 0.006 + Math.sin(bt * 1.63) * 0.0018) * calm;
        rx = Math.sin(bt * 0.94) * 0.0035 * calm;
        ry = Math.cos(bt * 0.55) * 0.0040 * calm;
        break;
      }
    }

    // --- melee attacks -----------------------------------------------------
    // Three animations, not one: the trigger alternates a right-to-left and a
    // left-to-right slash so repeated swings never look like a loop, and the
    // aim button throws a straight stab with a longer wind-up. Each overrides
    // the pose outright — the attack IS the animation, not a modifier layered
    // on an idle.
    const isStab = w.slashIndex === 2;
    const MELEE_DUR = isStab ? 0.52 : 0.30;
    if (w.def.melee && w.sinceShot < MELEE_DUR) {
      const a = clamp(w.sinceShot / MELEE_DUR, 0, 1);
      if (isStab) {
        // Draw the blade back beside the head, hold for an instant, then
        // drive it straight forward and let the arm ring out at the end.
        const windEnd = 0.42;
        if (a < windEnd) {
          const e = easeOutCubic(a / windEnd);
          ox = 0.095 * e; oy = 0.075 * e; oz = 0.140 * e;
          rx = -0.58 * e; ry = -0.44 * e; rz = -0.32 * e;
        } else {
          const e = easeOutCubic((a - windEnd) / (1 - windEnd));
          ox = 0.095 - 0.112 * e;
          oy = 0.075 - 0.092 * e;
          oz = 0.140 - 0.360 * e;         // punch forward, past the rest pose
          rx = -0.58 + 0.76 * e;
          ry = -0.44 + 0.52 * e;
          rz = -0.32 + 0.38 * e;
          const st = clamp((e - 0.5) / 0.5, 0, 1);
          const back = 1 - easeOutCubic(st);
          const s = settle(st, 2.4, 5.5) * (1 - st) * 0.35;
          ox = ox * back + s * 0.02; oy = oy * back; oz = oz * back;
          rx = rx * back + s * 0.10; ry = ry * back; rz = rz * back + s * 0.08;
        }
      } else {
        // Slash. dir flips per swing so the two cuts mirror each other.
        const dir = w.slashIndex === 0 ? 1 : -1;
        const windEnd = 0.24;
        if (a < windEnd) {
          const e = easeOutCubic(a / windEnd);
          ox = 0.085 * dir * e; oy = 0.055 * e; oz = 0.065 * e;
          rz = -0.95 * dir * e; ry = -0.66 * dir * e; rx = -0.42 * e;
        } else {
          const e = easeOutCubic((a - windEnd) / (1 - windEnd));
          ox = (0.085 - 0.335 * e) * dir;
          oy = 0.055 - 0.148 * e;
          oz = 0.065 - 0.158 * e;
          rz = (-0.95 + 2.55 * e) * dir;
          ry = (-0.66 + 1.42 * e) * dir;
          rx = -0.42 + 0.96 * e;
          const st = clamp((e - 0.55) / 0.45, 0, 1);
          const back = 1 - easeOutCubic(st);
          const s = settle(st, 2.6, 6.0) * (1 - st) * 0.30;
          ox *= back; oy *= back; oz *= back;
          rz = rz * back + s * 0.12 * dir; ry = ry * back; rx = rx * back + s * 0.08;
        }
      }
      magVisible = true;
      boltZ = 0;
    } else if (w.sinceShot < 0.12 && !w.def.pumpTime && !w.def.melee) {
      // Firing action. The moving part is thrown back hard and returns on a
      // slower curve, rather than fading linearly out of a single impulse.
      const a = clamp(w.sinceShot / 0.12, 0, 1);
      const throwBack = a < 0.30 ? easeOutCubic(a / 0.30) : 1 - easeInCubic((a - 0.30) / 0.70);
      const amt = isRevolver ? 0.030 : w.def.key === 'deagle' ? 0.075
        : w.def.key === 'glock17' ? 0.058 : 0.040;
      boltZ = Math.max(boltZ, throwBack * amt);
    }

    // --- revolver cylinder -------------------------------------------------
    // It indexes a sixth of a turn every time a round leaves or enters the
    // gun, in opposite directions, so firing and loading do not look alike.
    if (m.cylinderCore) {
      if (this.lastAmmo === undefined) this.lastAmmo = w.ammo;
      if (w.ammo !== this.lastAmmo) {
        this.cylTarget = (this.cylTarget || 0) +
          (w.ammo < this.lastAmmo ? Math.PI / 3 : -Math.PI / 3);
        this.lastAmmo = w.ammo;
      }
      this.cylSpin = smoothDamp(this.cylSpin || 0, this.cylTarget || 0, 22, dt);
      m.cylinderCore.rotation.z = this.cylSpin;
      this.cylOut = smoothDamp(this.cylOut || 0, cylOut, 26, dt);
      m.cylinder.rotation.y = this.cylOut * 1.30;
      m.cylinder.rotation.z = this.cylOut * 0.10;
    }
    // The inspect twirl is applied to the weapon itself, not the hands, so the
    // gun turns over in a grip that stays put. Every phase of it lands on a
    // whole rotation; when the inspect ends — or is cut short by a shot or a
    // weapon switch — the spin unwinds to the nearest whole turn instead of
    // snapping back to zero, which would pop mid-twirl.
    if (m.root) {
      if (w.state === WS.INSPECTING) this.spinX = spinX;
      else if (this.spinX) {
        const turn = Math.PI * 2;
        const nearest = Math.round(this.spinX / turn) * turn;
        this.spinX = Math.abs(this.spinX - nearest) < 0.004
          ? 0 : lerp(this.spinX, nearest, 1 - Math.exp(-16 * dt));
      }
      m.root.rotation.x = this.spinX || 0;
    }

    // aiming grip: the support hand tightens up and shifts forward when ADS,
    // independent of whatever the reload phase above is doing to it
    const adsGrip = w.adsT;
    lox += adsGrip * 0.012;
    loy += adsGrip * 0.016;
    loz += adsGrip * -0.028;
    lry += adsGrip * 0.09;

    this.leftArmTargetOffset.set(lox, loy, loz);
    this.leftArmTargetRot.set(lrx, lry, lrz);
    const leftK = 1 - Math.exp(-24 * dt);
    this.leftArmOffset.lerp(this.leftArmTargetOffset, leftK);
    this.leftArmOffsetRot.lerp(this.leftArmTargetRot, leftK);
    this.leftArm.position.set(
      this.leftArmBaseP.x + this.leftArmOffset.x,
      this.leftArmBaseP.y + this.leftArmOffset.y,
      this.leftArmBaseP.z + this.leftArmOffset.z
    );
    this.leftArm.rotation.set(
      this.leftArmBaseR.x + this.leftArmOffsetRot.x,
      this.leftArmBaseR.y + this.leftArmOffsetRot.y,
      this.leftArmBaseR.z + this.leftArmOffsetRot.z
    );
    // A knife is held in one hand. There is no handguard for a support hand
    // to sit on, and parking it in mid-air next to the blade looked exactly
    // as odd as it sounds.
    this.leftArm.visible = !w.def.melee;

    // Rotation chases a little softer than position, so the gun's angle
    // trails its travel by a frame or two. That lag is most of what reads as
    // weight — matched rates make the whole thing move like one rigid prop.
    const pk = 1 - Math.exp(-32 * dt);
    const rk = 1 - Math.exp(-24 * dt);
    this.animOffset.set(
      lerp(this.animOffset.x, ox, pk),
      lerp(this.animOffset.y, oy, pk),
      lerp(this.animOffset.z, oz, pk)
    );
    this.animRot.set(
      lerp(this.animRot.x, rx, rk),
      lerp(this.animRot.y, ry, rk),
      lerp(this.animRot.z, rz, rk)
    );

    if (m.mag) {
      m.mag.position.y = (m.mag.userData.baseY ??= m.mag.position.y) + magY;
      m.mag.rotation.z = magR;
      m.mag.rotation.x = magRX;
      m.mag.visible = magVisible;
    }
    if (m.bolt) {
      // The revolver's "bolt" is its hammer: it rocks back on its pin rather
      // than sliding, so the same drive value becomes a rotation there.
      if (isRevolver) m.bolt.rotation.x = -boltZ * 14;
      else m.bolt.position.z = (m.bolt.userData.baseZ ??= m.bolt.position.z) + boltZ;
    }
    if (m.pump) {
      m.pump.position.z = (m.pump.userData.baseZ ??= m.pump.position.z) + pumpZ;
    }
  }

  dispose() {
    for (const m of this.modelCache.values()) disposeWeaponModel(m);
    this.modelCache.clear();
    this.model = null;
    this.scene.clear();
  }
}
