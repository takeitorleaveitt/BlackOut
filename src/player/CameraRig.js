// Body-worn camera rig.
//
// The camera is treated as a device strapped to the operator's chest rig, not
// a floating eyeball: it has mass, it lags the aim slightly, it rolls when you
// whip around, it bounces with the gait, it kicks with every round fired and
// it shakes when you take hits.
//
// Aim and camera share the same angles (so the crosshair stays honest) — the
// "weight" comes from smoothing the angles themselves, plus a decoupled roll
// and positional spring that never affect where bullets go.

import * as THREE from 'three';
import { S } from '../core/Settings.js';
import { clamp, lerp, smoothDamp } from '../shared/constants.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.yawRate = 0;
    this.pitchRate = 0;

    this.roll = 0;
    this.rollVel = 0;

    this.bobT = 0;
    this.bobPos = new THREE.Vector3();
    this.bobRot = new THREE.Vector3();

    this.shake = 0;
    this.shakeVec = new THREE.Vector3();
    this.shakeSeed = Math.random() * 1000;

    this.recoil = { pitch: 0, yaw: 0 };

    this.breath = 0;
    this.breathRate = 1.0;
    this.stamina = 1;

    this.landDip = 0;
    this.landVel = 0;

    this.leanRoll = 0;
    this.eyeY = 1.66;
    this.pos = new THREE.Vector3();
    this.smoothPos = new THREE.Vector3();
    // Leftover visual offset from a server correction, decayed to zero over a
    // few frames so reconciliation is felt as nothing rather than as a snap.
    this.correction = new THREE.Vector3();
    this._first = true;
  }

  /** Carry a reconciliation delta on the view instead of teleporting it. */
  addCorrection(dx, dy, dz) {
    // Cap it: a correction big enough to matter visually is better shown than
    // smeared, and an unbounded offset could hide a real desync.
    this.correction.x = clamp(this.correction.x + dx, -0.6, 0.6);
    this.correction.y = clamp(this.correction.y + dy, -0.6, 0.6);
    this.correction.z = clamp(this.correction.z + dz, -0.6, 0.6);
  }

  clearCorrection() { this.correction.set(0, 0, 0); }

  reset(x, y, z, yaw = 0) {
    this.targetYaw = this.yaw = yaw;
    this.targetPitch = this.pitch = 0;
    this.pos.set(x, y, z);
    this.smoothPos.copy(this.pos);
    this.roll = this.rollVel = 0;
    this.recoil.pitch = this.recoil.yaw = 0;
    this.shake = 0;
    this.landDip = 0;
    this._first = true;
  }

  /**
   * Raw mouse delta -> target angles.
   * `adsT` is the aim-down-sights blend (0 hip .. 1 aimed) and scales
   * sensitivity toward the player's ADS setting.
   */
  look(dx, dy, adsT = 0) {
    const sens = (S.sensitivity ?? 0.85) * 0.0022;
    const mult = sens * lerp(1, S.adsSensitivity ?? 0.72, clamp(adsT, 0, 1));
    this.targetYaw -= dx * mult;
    this.targetPitch -= dy * mult * (S.invertY ? -1 : 1);
    const lim = Math.PI / 2 - 0.015;
    this.targetPitch = clamp(this.targetPitch, -lim, lim);
    if (this.targetYaw > Math.PI) this.targetYaw -= Math.PI * 2;
    if (this.targetYaw < -Math.PI) this.targetYaw += Math.PI * 2;
  }

  /** Permanent aim displacement from recoil (the part you must pull down). */
  addAimKick(pitch, yaw) {
    this.targetPitch = clamp(this.targetPitch + pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    this.targetYaw -= yaw;
  }

  /** Visual-only recoil impulse (recovers to zero via the spring in update()). */
  addRecoil(pitch, yaw, shake = 0) {
    this.recoil.pitch += pitch;
    this.recoil.yaw += yaw;
    this.shake = Math.min(2.2, this.shake + shake);
  }

  addShake(amount) { this.shake = Math.min(3, this.shake + amount); }

  /**
   * @param st movement state { x, y, z, speed, crouchT, leanT, grounded,
   *                            sprinting, walking, landImpact }
   */
  update(dt, st, ctx = {}) {
    // --- aim angles: 1:1 with the mouse, no smoothing ----------------------
    // These used to be chased with an exponential spring (stiffness ~34, i.e.
    // only ~43% of the remaining mouse delta applied per frame at 60fps). That
    // is what made aiming feel laggy and mushy: the crosshair was always a
    // frame or two behind the hand. Call of Duty — and every shooter that
    // feels tight — moves the view exactly as far as the mouse moved, on the
    // same frame. The camera's "weight" now lives purely in the decoupled
    // roll / bob / shake / spring terms below, none of which touch where the
    // gun is actually pointed, so the aim stays honest and instant while the
    // motion still reads as smooth.
    const prevYaw = this.yaw, prevPitch = this.pitch;
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    // unwrap for rate computation
    let dYaw = this.yaw - prevYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.yawRate = lerp(this.yawRate, dYaw / Math.max(dt, 0.0001), 0.45);
    this.pitchRate = lerp(this.pitchRate, (this.pitch - prevPitch) / Math.max(dt, 0.0001), 0.45);

    // --- recoil spring -----------------------------------------------------
    // addRecoil() bumps recoil.pitch/yaw by the kick amount directly (an
    // instant snap-up, which is the point), and this is the only place that
    // brings it back down — a single dt-correct smoothDamp. (This used to be
    // a two-stage velocity+position spring where the velocity was added to
    // position every frame without scaling by dt, so the total kick size
    // silently scaled with framerate — worse the higher your FPS. One spring
    // is both simpler and actually frame-rate independent.)
    const rec = ctx.recoilRecovery ?? 8;
    this.recoil.pitch = smoothDamp(this.recoil.pitch, 0, rec, dt);
    this.recoil.yaw = smoothDamp(this.recoil.yaw, 0, rec, dt);

    // --- camera roll: torso torque when turning + leaning ------------------
    // st.leanT is -1 for a left lean (Q), +1 for right (E). A positive
    // camera rotation.z tilts the world "up" vector toward -X — i.e. the top
    // of the view rolls toward screen-left — which is the natural feel for
    // leaning left. That means the roll needs the OPPOSITE sign of leanT
    // (negative leanT -> positive roll), not the same sign: this term used
    // to roll the camera the same way as the positional shift is supposed to
    // counter, so leaning left slid the camera left but rolled the view as
    // if leaning right, and the two fighting each other read as "backwards".
    const shakeScale = S.cameraShake ?? 1;
    // Turn-roll is scaled well down from what it was: now that yaw tracks the
    // mouse 1:1, yawRate spikes hard on a flick, and the old coefficient would
    // have tilted the whole world every time you turned quickly. A slide adds
    // its own bank, which is where the roll budget is better spent.
    const rollTarget = clamp(-this.yawRate * 0.004, -0.05, 0.05) * (S.bodycam ?? 1)
      - st.leanT * 0.42
      + (st.sliding ? 0.07 : 0);
    this.rollVel += (rollTarget - this.roll) * 90 * dt;
    this.rollVel *= Math.exp(-13 * dt);
    this.roll += this.rollVel * dt;

    // --- gait --------------------------------------------------------------
    const speedN = clamp(st.speed / 5.55, 0, 1.25);
    const rate = st.sprinting ? 10.4 : st.crouchT > 0.5 ? 5.2 : st.walking ? 6.2 : 7.8;
    if (st.grounded && st.speed > 0.35) this.bobT += dt * rate * (0.5 + speedN * 0.75);
    // No gait bob at all while sliding — you are not taking steps — and a
    // tamer sprint boost, which used to more than double an already fast bob.
    const amp = (S.headBob ?? 1) * speedN * (ctx.ads ? 0.35 : 1) *
      (st.grounded ? 1 : 0.1) * (st.sliding ? 0 : 1);
    const sprintBoost = st.sprinting ? 1.35 : 1;
    this.bobPos.set(
      Math.sin(this.bobT) * 0.020 * amp * sprintBoost,
      (Math.abs(Math.cos(this.bobT)) - 0.55) * 0.026 * amp * sprintBoost,
      0
    );
    this.bobRot.set(
      Math.cos(this.bobT * 2) * 0.0055 * amp * sprintBoost,
      Math.sin(this.bobT) * 0.0060 * amp * sprintBoost,
      Math.sin(this.bobT) * 0.0110 * amp * sprintBoost
    );

    // --- breathing (heavier when hurt or winded) ---------------------------
    const hurt = 1 - clamp((ctx.health ?? 100) / 100, 0, 1);
    this.breathRate = lerp(1.05, 2.6, Math.max(hurt, 1 - this.stamina));
    this.stamina = clamp(this.stamina + (st.sprinting ? -dt * 0.18 : dt * 0.22), 0, 1);
    this.breath += dt * this.breathRate;
    const breathAmp = (0.0016 + hurt * 0.0062 + (1 - this.stamina) * 0.0035) * (ctx.ads ? 1.5 : 1);

    // --- landing dip -------------------------------------------------------
    // A stiff, nearly critically-damped spring: knees absorbing a landing,
    // not a diving board. The old constants (k=90, damping 9) gave a damping
    // ratio of 0.47 and a 0.66s period, so every landing wallowed through two
    // visible bounces over about three quarters of a second — which is what
    // made hitting the ground feel laggy. k=225 with damping 27 is a ratio of
    // 0.90 and a 0.42s period: one clean compression, a hint of rebound, done
    // in about a fifth of the time. The impulse is scaled up to keep the same
    // depth of dip out of the stiffer spring: 2.7cm down and back in 0.43s,
    // against 2.8cm over 0.70s with two bounces before.
    if (st.landed && st.landImpact > 0.02) {
      this.landVel -= st.landImpact * 2.3;
      this.shake += st.landImpact * 0.30 * shakeScale;
    }
    this.landVel += -this.landDip * 225 * dt;
    this.landVel *= Math.exp(-27 * dt);
    this.landDip += this.landVel * dt;
    this.landDip = clamp(this.landDip, -0.16, 0.04);

    // --- shake -------------------------------------------------------------
    this.shake = Math.max(0, this.shake - dt * 3.4);
    const s = this.shake * this.shake * 0.016 * shakeScale;
    const t = performance.now() / 1000;
    this.shakeVec.set(
      (noise(t * 31 + this.shakeSeed) - 0.5) * s,
      (noise(t * 27 + this.shakeSeed + 33) - 0.5) * s,
      (noise(t * 23 + this.shakeSeed + 77) - 0.5) * s * 0.5
    );

    // --- assemble ----------------------------------------------------------
    const eye = st.y + ctx.eyeHeight;
    this.pos.set(st.x, eye, st.z);
    // lateral shift when leaning
    const lean = st.leanT * 0.44;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.pos.x += cy * lean;
    this.pos.z += -sy * lean;
    this.pos.y -= Math.abs(st.leanT) * 0.06;

    if (this._first) { this.smoothPos.copy(this.pos); this._first = false; }
    // Horizontally the camera now sits exactly where the player is: the old
    // chest-rig spring (rate 30) trailed the body by a few centimetres during
    // every strafe and stop, which is the positional half of the "laggy"
    // feel. Only the vertical axis is still damped, and stiffly, because that
    // is what keeps stairs, step-ups and the crouch transition from jolting —
    // it smooths geometry, not input.
    this.smoothPos.x = this.pos.x;
    this.smoothPos.z = this.pos.z;
    this.smoothPos.y = smoothDamp(this.smoothPos.y, this.pos.y, 60, dt);

    // Bleed off any server-correction offset (~150ms to effectively zero).
    const decay = Math.exp(-22 * dt);
    this.correction.multiplyScalar(decay);
    if (this.correction.lengthSq() < 1e-8) this.correction.set(0, 0, 0);
    this.smoothPos.add(this.correction);

    const cam = this.camera;
    cam.position.set(
      this.smoothPos.x + this.bobPos.x * cy + this.shakeVec.x,
      this.smoothPos.y + this.bobPos.y + this.landDip + this.shakeVec.y
        + Math.sin(this.breath) * breathAmp * 2.4,
      this.smoothPos.z - this.bobPos.x * sy + this.shakeVec.z
    );
    cam.rotation.set(
      this.pitch + this.recoil.pitch + this.bobRot.x + this.shakeVec.y * 0.6
        + Math.sin(this.breath * 1.03) * breathAmp,
      this.yaw + this.recoil.yaw + this.bobRot.y + this.shakeVec.x * 0.5
        + Math.cos(this.breath * 0.79) * breathAmp * 0.8,
      this.roll + this.bobRot.z + this.shakeVec.z * 0.8,
      'YXZ'
    );
  }

  /** Forward vector of the actual aim (recoil included). */
  getAimDir(out = new THREE.Vector3()) {
    const p = this.pitch + this.recoil.pitch;
    const y = this.yaw + this.recoil.yaw;
    out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
    return out.normalize();
  }
}

function noise(x) {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
