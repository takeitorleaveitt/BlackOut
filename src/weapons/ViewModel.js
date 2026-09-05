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

// Per-weapon hip pose. Heavier guns sit lower and further out.
const HIP = {
  m4a1: { p: [0.150, -0.148, -0.62], r: [0.03, -0.07, 0.0] },
  ak74: { p: [0.158, -0.156, -0.62], r: [0.035, -0.08, 0.0] },
  mp5: { p: [0.144, -0.138, -0.56], r: [0.03, -0.07, 0.0] },
  mp7: { p: [0.136, -0.130, -0.52], r: [0.03, -0.08, 0.0] },
  m870: { p: [0.156, -0.156, -0.66], r: [0.04, -0.08, 0.0] },
  glock17: { p: [0.120, -0.126, -0.48], r: [0.03, -0.09, 0.0] },
  deagle: { p: [0.128, -0.132, -0.50], r: [0.03, -0.09, 0.0] },
  scarh: { p: [0.162, -0.162, -0.68], r: [0.04, -0.075, 0.0] },
  knife: { p: [0.096, -0.110, -0.28], r: [0.10, -0.14, 0.0] }
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
    if (this.model) {
      this.holder.remove(this.model.root);
      disposeWeaponModel(this.model);
    }
    this.weapon = weapon;
    this.model = buildWeaponModel(weapon.def, weapon.attachments);
    this.holder.add(this.model.root);
    this.pose = HIP[weapon.def.key] || HIP.m4a1;
    this.reloadPhase = 0;
    this.placeArms(weapon.def);
    return this.model;
  }

  /** Seat the hands on the newly-equipped weapon's grip and handguard. */
  placeArms(def) {
    const grip = GRIP_ANCHOR[def.key] || GRIP_ANCHOR.m4a1;
    this.rightArm.position.set(grip.p[0], grip.p[1], grip.p[2]);
    this.rightArm.rotation.set(grip.r[0], grip.r[1], grip.r[2]);

    if (def.key === 'glock17' || def.key === 'deagle') {
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
    // ADS target: sight sits on the camera axis, slightly forward
    const adsP = [0, -sight, -0.40];
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
      sz + this.bob.z + this.animOffset.z + punch * 0.85 + this.wallT * 0.14
    );

    const hipR = hip.r;
    this.holder.rotation.set(
      lerp(hipR[0], 0, ads) + this.rotLag.x * (1 - ads * 0.6) + this.animRot.x
        + this.sprintT * 0.28 + punch * 1.5 - this.wallT * 0.15,
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

  /** Drives the animated parts: magazine, bolt, pump, and the hand motion. */
  updateAnim(dt, w) {
    const m = this.model;
    const t = w.stateT;
    const dur = Math.max(0.001, w.stateDur);
    const k = clamp(t / dur, 0, 1);
    let ox = 0, oy = 0, oz = 0, rx = 0, ry = 0, rz = 0;
    let magY = 0, magR = 0, magVisible = true, boltZ = 0, pumpZ = 0;
    // left (support) hand reach, local to its resting anchor on the handguard
    let lox = 0, loy = 0, loz = 0, lrx = 0, lry = 0, lrz = 0;

    const ease = (x) => x * x * (3 - 2 * x);
    const pulse = (x) => Math.sin(x * Math.PI);

    switch (w.state) {
      case WS.DRAWING: {
        const e = 1 - ease(k);
        oy = -0.24 * e;
        oz = 0.10 * e;
        rx = 0.75 * e;
        rz = -0.35 * e;
        break;
      }
      case WS.HOLSTERING: {
        const e = ease(k);
        oy = -0.26 * e;
        rx = 0.85 * e;
        rz = -0.4 * e;
        break;
      }
      case WS.RELOADING: {
        // three beats: drop the mag, bring the new one up, seat it (+ bolt if empty)
        const dropEnd = w.emptyReload ? 0.30 : 0.34;
        const insertEnd = w.emptyReload ? 0.68 : 0.78;
        if (k < dropEnd) {
          const a = k / dropEnd;
          oy = -0.075 * a; rz = -0.30 * a; rx = 0.18 * a; ox = -0.02 * a;
          magY = -0.32 * a * a;
          magR = a * 0.9;
          if (a > 0.55) magVisible = false;
          // left hand lets go of the handguard and drops to the mag pouch
          lox = -0.03 * a; loy = -0.34 * a; loz = 0.24 * a;
          lrx = 0.95 * a; lry = -0.18 * a;
        } else if (k < insertEnd) {
          const a = (k - dropEnd) / (insertEnd - dropEnd);
          oy = -0.075 - 0.035 * pulse(a); rz = -0.30 + 0.06 * a; rx = 0.18 - 0.05 * a;
          ox = -0.02 + 0.015 * a;
          magVisible = a > 0.42;
          magY = -0.22 * (1 - clamp((a - 0.42) / 0.5, 0, 1));
          magR = 0.5 * (1 - clamp((a - 0.42) / 0.5, 0, 1));
          // fresh mag rises from the pouch and seats in the well
          const rise = clamp(a / 0.65, 0, 1);
          lox = -0.03 * (1 - rise) - 0.01 * rise; loy = -0.34 + 0.31 * rise; loz = 0.24 - 0.22 * rise;
          lrx = 0.95 * (1 - rise) + 0.08 * rise; lry = -0.18 * (1 - rise);
        } else {
          const a = (k - insertEnd) / (1 - insertEnd);
          oy = -0.11 * (1 - ease(a)); rz = -0.24 * (1 - ease(a)); rx = 0.13 * (1 - ease(a));
          magY = 0; magR = 0;
          // hand settles back onto the handguard
          const back = ease(a);
          lox = -0.01 * (1 - back); loy = -0.03 * (1 - back); loz = 0.02 * (1 - back);
          lrx = 0.08 * (1 - back);
          if (w.emptyReload) {
            // charging handle yank at the end
            const b = clamp((a - 0.35) / 0.45, 0, 1);
            boltZ = pulse(b) * 0.075;
            rx += pulse(b) * 0.10;
            ox += pulse(b) * 0.03;
            lrx += pulse(b) * 0.12;
            loy -= pulse(b) * 0.02;
          }
        }
        break;
      }
      case WS.RELOAD_LOOP: {
        // shell-by-shell: hand dips to the pouch and back on every shell
        const a = k;
        oy = -0.055 * pulse(a);
        ox = -0.04 * pulse(a);
        rz = -0.22 * pulse(a);
        rx = 0.12 * pulse(a);
        lox = -0.02 * pulse(a); loy = -0.24 * pulse(a); loz = 0.16 * pulse(a);
        lrx = 0.62 * pulse(a);
        break;
      }
      case WS.CYCLING: {
        if (w.def.key === 'm40') {
          // Bolt worked by hand: lift, pull straight back, shove home, turn
          // down. The rifle rolls to the right as the hand comes off the grip.
          const up = clamp(k / 0.22, 0, 1);
          const back = clamp((k - 0.18) / 0.32, 0, 1);
          const fwd = clamp((k - 0.52) / 0.30, 0, 1);
          const down = clamp((k - 0.80) / 0.20, 0, 1);
          boltZ = (ease(back) - ease(fwd)) * 0.105;
          rz = ease(up) * 0.30 - ease(down) * 0.30;
          rx = (ease(back) - ease(fwd)) * 0.075;
          oz = (ease(back) - ease(fwd)) * 0.030;
          oy = -pulse(k) * 0.015;
          // the support hand comes off the forend to work the bolt and returns
          const off = ease(up) - ease(down);
          lox = off * 0.055; loy = off * -0.035; loz = off * 0.075;
          lrx = off * 0.35; lry = off * -0.22;
        } else {
          pumpZ = pulse(k) * 0.085;
          boltZ = pulse(k) * 0.05;
          oz = pulse(k) * 0.022;
          rx = pulse(k) * 0.055;
        }
        break;
      }
      case WS.INSPECTING: {
        const a = k;
        if (w.def.melee) {
          // The knife gets its own inspect: it is brought up close, spun once
          // in the fingers and flipped over to show the other face of the
          // blade, then dropped back to the ready pose. Nothing here checks a
          // chamber or racks a bolt, because a knife has neither.
          const bring = Math.sin(a * Math.PI);
          oz = bring * 0.10;                       // pull it toward the eye
          oy = bring * 0.035;
          ox = bring * -0.03;
          rz = Math.sin(a * Math.PI * 2) * 1.65;   // spin in the fingers
          ry = Math.sin(a * Math.PI) * 0.75;       // turn to show the flat
          rx = Math.sin(a * Math.PI * 3) * 0.18;   // small wrist flick
          boltZ = 0;
        } else {
          // Three beats instead of one continuous wobble: tip the gun over to
          // read the left side of the receiver, roll it back the other way to
          // check the ejection port and thumb the bolt, then let it settle.
          // The old version just rotated the whole thing back and forth twice,
          // which read as the gun swimming rather than being looked at.
          if (a < 0.38) {
            const e = ease(a / 0.38);
            oz = 0.085 * e; oy = 0.020 * e; ox = -0.030 * e;
            ry = 0.95 * e;                       // turn the left flat into view
            rz = 0.30 * e;
            rx = -0.16 * e;
          } else if (a < 0.74) {
            const e = ease((a - 0.38) / 0.36);
            oz = 0.085 - 0.020 * e; oy = 0.020 - 0.045 * e; ox = -0.030 + 0.075 * e;
            ry = 0.95 - 1.55 * e;                // roll across to the other side
            rz = 0.30 - 0.82 * e;
            rx = -0.16 + 0.42 * e;
            // thumb the bolt back and let it run home, once, mid-roll
            const bolt = clamp((e - 0.35) / 0.5, 0, 1);
            boltZ = pulse(bolt) * 0.085;
            rx += pulse(bolt) * 0.07;
          } else {
            const e = ease((a - 0.74) / 0.26);
            const back = 1 - e;
            oz = 0.065 * back; oy = -0.025 * back; ox = 0.045 * back;
            ry = -0.60 * back; rz = -0.52 * back; rx = 0.26 * back;
          }
        }
        break;
      }
      default: {
        // idle breathing
        const bt = performance.now() / 1000;
        oy = Math.sin(bt * 1.15) * 0.0022 * (1 - w.adsT * 0.75);
        ox = Math.cos(bt * 0.83) * 0.0018 * (1 - w.adsT * 0.75);
        rz = Math.sin(bt * 0.71) * 0.006 * (1 - w.adsT * 0.7);
        break;
      }
    }

    // --- melee slash -------------------------------------------------------
    // A knife swing is the whole attack, so it gets a real arc rather than the
    // recoil punch a gun gets. Wind up back and to the right, sweep down and
    // across to the left, then recover. This overrides the pose outright: the
    // swing is the animation, not a modifier on top of an idle.
    const SLASH = 0.34;
    if (w.def.melee && w.sinceShot < SLASH) {
      const a = clamp(w.sinceShot / SLASH, 0, 1);
      const windEnd = 0.22;
      if (a < windEnd) {
        const e = ease(a / windEnd);            // cock back and out
        ox = 0.075 * e; oy = 0.055 * e; oz = 0.070 * e;
        rz = -0.85 * e; ry = -0.60 * e; rx = -0.45 * e;
      } else {
        const e = ease((a - windEnd) / (1 - windEnd));
        // the cut itself: right-to-left and down, overshooting past centre
        ox = 0.075 - 0.30 * e;
        oy = 0.055 - 0.145 * e;
        oz = 0.070 - 0.155 * e;
        rz = -0.85 + 2.35 * e;
        ry = -0.60 + 1.30 * e;
        rx = -0.45 + 0.95 * e;
        // ease the follow-through back toward the ready pose over the last third
        const settle = clamp((e - 0.62) / 0.38, 0, 1);
        const back = 1 - ease(settle);
        ox *= back; oy *= back; oz *= back;
        rz *= back; ry *= back; rx *= back;
      }
      magVisible = true;
      boltZ = 0;
    } else if (w.sinceShot < 0.09 && !w.def.pumpTime && !w.def.melee) {
      // firing bolt cycle (guns only — a blade has no action to cycle)
      const a = 1 - w.sinceShot / 0.09;
      boltZ = Math.max(boltZ, a * (w.def.key === 'deagle' ? 0.065 : w.def.key === 'glock17' ? 0.05 : 0.035));
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

    this.animOffset.set(
      lerp(this.animOffset.x, ox, 1 - Math.exp(-30 * dt)),
      lerp(this.animOffset.y, oy, 1 - Math.exp(-30 * dt)),
      lerp(this.animOffset.z, oz, 1 - Math.exp(-30 * dt))
    );
    this.animRot.set(
      lerp(this.animRot.x, rx, 1 - Math.exp(-28 * dt)),
      lerp(this.animRot.y, ry, 1 - Math.exp(-28 * dt)),
      lerp(this.animRot.z, rz, 1 - Math.exp(-28 * dt))
    );

    if (m.mag) {
      m.mag.position.y = (m.mag.userData.baseY ??= m.mag.position.y) + magY;
      m.mag.rotation.z = magR;
      m.mag.visible = magVisible;
    }
    if (m.bolt) {
      m.bolt.position.z = (m.bolt.userData.baseZ ??= m.bolt.position.z) + boltZ;
    }
    if (m.pump) {
      m.pump.position.z = (m.pump.userData.baseZ ??= m.pump.position.z) + pumpZ;
    }
  }

  dispose() {
    if (this.model) disposeWeaponModel(this.model);
    this.scene.clear();
  }
}
