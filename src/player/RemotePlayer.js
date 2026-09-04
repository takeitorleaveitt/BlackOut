// Other players.  Snapshots arrive at 20Hz, so positions are buffered and
// rendered ~100ms in the past, interpolated between the two states that
// bracket the render time.  Falls back to short extrapolation if the buffer
// runs dry (a hitch, or packet loss).

import * as THREE from 'three';
import { PlayerModel } from './PlayerModel.js';
import { SF } from '../shared/protocol.js';
import { INTERP_DELAY_MS, PLAYER_HEIGHT_STAND, PLAYER_HEIGHT_CROUCH, SPEED_WALK, SPEED_SPRINT, lerp, clamp } from '../shared/constants.js';
import { WEAPON_BY_ID } from '../shared/weapons.js';

const BUFFER = 24;

export class RemotePlayer {
  constructor(id, scene, info = {}) {
    this.id = id;
    this.scene = scene;
    this.name = info.name || 'OPERATOR';
    this.team = info.team ?? 0;
    this.model = new PlayerModel(this.team);
    scene.add(this.model.root);
    this.states = [];
    this.render = {
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouchT: 0, leanT: 0,
      speed: 0, grounded: true, dead: false, firing: false, reloading: false, sprinting: false
    };
    this.health = 100;
    this.weaponId = 0;
    this.flags = 0;
    this.lastFootstep = 0;
    this.stepPhase = 0;
    this.visible = true;
    this.lastSeen = performance.now();
    this.model.setWeapon(WEAPON_BY_ID[0]);
  }

  setInfo(info) {
    if (info.name) this.name = info.name;
    if (info.team !== undefined && info.team !== this.team) {
      this.team = info.team;
      const old = this.model;
      this.model = new PlayerModel(this.team);
      this.model.setWeapon(WEAPON_BY_ID[this.weaponId] || WEAPON_BY_ID[0]);
      this.scene.add(this.model.root);
      this.scene.remove(old.root);
      old.dispose();
    }
  }

  /** Push an authoritative state (already unpacked from the snapshot). */
  push(state, serverTime) {
    this.states.push({ ...state, t: serverTime });
    if (this.states.length > BUFFER) this.states.shift();
    this.health = state.health;
    this.weaponId = state.weapon;
    this.flags = state.flags;
    this.lastSeen = performance.now();
  }

  /** @param renderTime server clock in ms, already delayed by INTERP_DELAY_MS */
  update(dt, renderTime, onFootstep) {
    const st = this.states;
    if (!st.length) return;

    let a = null, b = null;
    for (let i = st.length - 1; i >= 0; i--) {
      if (st[i].t <= renderTime) { a = st[i]; b = st[i + 1] || null; break; }
    }
    if (!a) { a = st[0]; b = st[1] || null; }

    let x, y, z, yaw, pitch, lean, speed;
    if (b && b.t > a.t) {
      const t = clamp((renderTime - a.t) / (b.t - a.t), 0, 1);
      x = lerp(a.x, b.x, t);
      y = lerp(a.y, b.y, t);
      z = lerp(a.z, b.z, t);
      yaw = lerpAngle(a.yaw, b.yaw, t);
      pitch = lerp(a.pitch, b.pitch, t);
      lean = lerp(a.lean, b.lean, t);
      const dtAB = (b.t - a.t) / 1000;
      speed = dtAB > 0 ? Math.hypot(b.x - a.x, b.z - a.z) / dtAB : 0;
    } else {
      // extrapolate briefly from the last two states
      const prev = st.length > 1 ? st[st.length - 2] : null;
      const last = st[st.length - 1];
      const ahead = clamp((renderTime - last.t) / 1000, 0, 0.22);
      let vx = 0, vz = 0;
      if (prev && last.t > prev.t) {
        const d = (last.t - prev.t) / 1000;
        vx = (last.x - prev.x) / d;
        vz = (last.z - prev.z) / d;
      }
      x = last.x + vx * ahead;
      y = last.y;
      z = last.z + vz * ahead;
      yaw = last.yaw; pitch = last.pitch; lean = last.lean;
      speed = Math.hypot(vx, vz);
    }

    const f = a.flags;
    const r = this.render;
    r.x = x; r.y = y; r.z = z;
    r.yaw = yaw; r.pitch = pitch;
    r.leanT = lean;
    // Numerically differentiating interpolated/extrapolated positions is
    // fragile — it can read near-zero for a frame or two from clamped
    // extrapolation, a duplicate snapshot, or a single-sample buffer right
    // after this player entered view, which used to freeze the gait mid-
    // stride even though the player was genuinely moving. The server already
    // knows the truth for this exact tick, so use its MOVING/SPRINT flags as
    // a floor underneath the derived speed instead of trusting the math alone.
    const flagMoving = !!(f & SF.MOVING);
    const flagSprint = !!(f & SF.SPRINT);
    if (flagMoving) speed = Math.max(speed, flagSprint ? SPEED_SPRINT * 0.85 : SPEED_WALK * 0.75);
    r.speed = speed;
    r.dead = !!(f & SF.DEAD);
    r.grounded = !!(f & SF.GROUNDED);
    r.firing = !!(f & SF.FIRING);
    r.reloading = !!(f & SF.RELOADING);
    r.sprinting = flagSprint;
    const wantCrouch = (f & SF.CROUCH) ? 1 : 0;
    r.crouchT = lerp(r.crouchT, wantCrouch, 1 - Math.exp(-11 * dt));

    const wdef = WEAPON_BY_ID[this.weaponId];
    if (wdef) this.model.setWeapon(wdef);
    this.model.update(dt, r);
    this.model.root.visible = this.visible;

    // footsteps driven by the interpolated ground speed
    if (!r.dead && r.grounded && speed > 0.4) {
      const walking = !!(f & SF.WALK);
      const stride = r.sprinting ? 1.32 : r.crouchT > 0.5 ? 1.05 : walking ? 1.15 : 0.92;
      this.stepPhase += speed * dt;
      if (this.stepPhase >= stride) {
        this.stepPhase = 0;
        const vol = r.crouchT > 0.5 ? 0.35 : walking ? 0.45 : r.sprinting ? 1.15 : 0.85;
        onFootstep?.(this, [x, y + 0.05, z], vol);
      }
    }
  }

  get height() {
    return lerp(PLAYER_HEIGHT_STAND, PLAYER_HEIGHT_CROUCH, this.render.crouchT);
  }

  eyePosition(out = new THREE.Vector3()) {
    return out.set(this.render.x, this.render.y + this.height - 0.14, this.render.z);
  }

  dispose() {
    this.scene.remove(this.model.root);
    this.model.dispose();
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
