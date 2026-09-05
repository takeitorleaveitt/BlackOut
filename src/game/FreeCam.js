// Free-look spectator camera.
//
// In a round-based mode you are out for the rest of the round when you die,
// so rather than staring at a corpse you get to fly. Mouse looks, WASD moves,
// space and control change height, shift is a sprint. Nothing here touches
// the simulation — it is a camera and nothing else, and it is thrown away the
// moment you respawn.

import * as THREE from 'three';
import { S } from '../core/Settings.js';
import { clamp } from '../shared/constants.js';

const SPEED = 9.0;
const SPRINT = 22.0;
const ACCEL = 12.0;

export class FreeCam {
  constructor(from, yaw, pitch) {
    this.pos = new THREE.Vector3().copy(from);
    this.vel = new THREE.Vector3();
    this.yaw = yaw;
    this.pitch = pitch;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  look(dx, dy) {
    const sens = (S.sensitivity ?? 0.85) * 0.0022;
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens * (S.invertY ? -1 : 1), -1.5, 1.5);
  }

  update(dt, input) {
    const b = S.binds;
    const held = (k) => input.rawDown(k);
    let f = 0, r = 0, u = 0;
    if (held(b.forward)) f += 1;
    if (held(b.back)) f -= 1;
    if (held(b.right)) r += 1;
    if (held(b.left)) r -= 1;
    if (held(b.jump)) u += 1;
    if (held(b.crouch)) u -= 1;
    const speed = held(b.sprint) ? SPRINT : SPEED;

    this._fwd.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const want = this._fwd.clone().multiplyScalar(f).addScaledVector(this._right, r);
    want.y += u;
    if (want.lengthSq() > 1e-6) want.normalize().multiplyScalar(speed);

    // Ease toward the target velocity so the camera glides rather than
    // snapping — a spectator cam that starts and stops instantly is unwatchable.
    const k = 1 - Math.exp(-ACCEL * dt);
    this.vel.lerp(want, k);
    this.pos.addScaledVector(this.vel, dt);
  }

  applyTo(camera) {
    camera.position.copy(this.pos);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
