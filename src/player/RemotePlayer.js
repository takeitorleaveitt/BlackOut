// Other players.  Snapshots arrive at the server tick rate, so positions are
// buffered and rendered slightly in the past (INTERP_DELAY_MS), interpolated
// between the two states that bracket the render time.  Falls back to short
// extrapolation if the buffer runs dry (a hitch, or packet loss).

import * as THREE from 'three';
import { PlayerModel } from './PlayerModel.js';
import { SF } from '../shared/protocol.js';
import { INTERP_DELAY_MS, PLAYER_HEIGHT_STAND, PLAYER_HEIGHT_CROUCH, SPEED_WALK, SPEED_SPRINT, lerp, clamp } from '../shared/constants.js';
import { WEAPON_BY_ID } from '../shared/weapons.js';

const BUFFER = 24;

// Alpha reads as the "blue" team, Bravo as "tan" — matches PlayerModel's
// kit tint for each team, just bright and unlit so the marker actually pops
// against the map instead of blending into it.
const MARKER_COLOR = { 1: 0x4aa8ff, 2: 0xe0b070 };

// Callsign plate. The canvas is drawn at four times the size it is shown at so
// the text stays crisp when a teammate is close; the sprite's world size is
// LABEL_W x LABEL_H metres at the reference distance and scales from there.
const LABEL_PX = 256, LABEL_PY = 64;
const LABEL_W = 1.15, LABEL_H = LABEL_W * (LABEL_PY / LABEL_PX);

/** The chevron's material. Exported so the shader warm-up builds the identical one. */
export function makeMarkerMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false });
}

/** The callsign plate's material, ditto. */
export function makeLabelMaterial(name) {
  return new THREE.SpriteMaterial({
    map: makeLabelTexture(name), transparent: true, depthTest: false, toneMapped: false
  });
}

/** The chevron's geometry, ditto. */
export function makeMarkerGeometry() {
  return new THREE.ConeGeometry(0.085, 0.16, 4);
}

function makeLabelTexture(name) {
  const c = document.createElement('canvas');
  c.width = LABEL_PX; c.height = LABEL_PY;
  const ctx = c.getContext('2d');
  const text = String(name || 'OPERATOR').toUpperCase().slice(0, 17);
  ctx.font = '600 30px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A dark halo rather than a filled plate: a box behind every teammate's head
  // is a lot of screen furniture, but bare white text vanishes against a pale
  // wall. The stroke is what makes it readable on any background.
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, LABEL_PX / 2, LABEL_PY / 2 + 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, LABEL_PX / 2, LABEL_PY / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

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

    // Teammate marker: a small downward-pointing chevron that floats above
    // the head, team-coloured, shown only when this player is on the local
    // player's team. Kept as a scene child (not parented under model.root)
    // so a team swap that rebuilds the model doesn't take it with it.
    this.markerMat = makeMarkerMaterial();
    this.marker = new THREE.Mesh(makeMarkerGeometry(), this.markerMat);
    this.marker.rotation.x = Math.PI;
    this.marker.rotation.y = Math.PI / 4;
    this.marker.renderOrder = 15;
    this.marker.visible = false;
    this.marker.frustumCulled = false;
    scene.add(this.marker);
    this._markerBob = Math.random() * 10;

    // The callsign, under the chevron, so a teammate is a name and not just a
    // coloured arrow. Drawn into a canvas once and carried on a sprite: one
    // small texture per player, rebuilt only when the name changes.
    this.labelMat = makeLabelMaterial(this.name);
    this.label = new THREE.Sprite(this.labelMat);
    this.label.renderOrder = 16;
    this.label.visible = false;
    this.label.frustumCulled = false;
    scene.add(this.label);
  }

  /**
   * Show, colour and place the teammate chevron and its callsign. Called once
   * a frame from the game with the local player's team and the world camera.
   *
   * The `!!` is not decoration. `myTeam` is 0 in Free For All, so the chain
   * below evaluated to the NUMBER 0, and three.js skips an object only when
   * `visible === false` — 0 is not false. Every marker in every FFA and
   * training match was therefore drawn: never coloured and never positioned,
   * because the early return below also treats 0 as hidden. The result was one
   * white chevron sitting at the world origin, in the middle of the map, seen
   * through walls because this material does not depth-test.
   */
  updateMarker(myTeam, dt, camera) {
    const friendly = !!myTeam && this.team === myTeam;
    const show = friendly && this.visible && !this.render.dead;
    this.marker.visible = show;
    this.label.visible = show;
    if (!show) return;
    this.markerMat.color.setHex(MARKER_COLOR[this.team] || 0xffffff);
    this._markerBob += dt * 2.4;
    const bob = Math.sin(this._markerBob) * 0.03;
    const y = this.render.y + this.height + 0.34 + bob;
    this.marker.position.set(this.render.x, y, this.render.z);
    this.label.position.set(this.render.x, y + 0.30, this.render.z);
    // A name tag has to stay readable across a map without becoming a
    // billboard up close, so it grows with distance but only to a point.
    const d = camera ? camera.position.distanceTo(this.label.position) : 12;
    const k = clamp(d / 9, 0.75, 3.0);
    this.label.scale.set(LABEL_W * k, LABEL_H * k, 1);
    this.labelMat.opacity = clamp(1 - (d - 55) / 25, 0.18, 1);
  }

  /** Rebuild the callsign texture (the name arrives after construction). */
  refreshLabel() {
    this.labelMat.map?.dispose();
    this.labelMat.map = makeLabelTexture(this.name);
    this.labelMat.needsUpdate = true;
  }

  setInfo(info) {
    if (info.name && info.name !== this.name) { this.name = info.name; this.refreshLabel(); }
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
    r.aiming = !!(f & SF.ADS);
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
    this.scene.remove(this.marker);
    this.marker.geometry.dispose();
    this.markerMat.dispose();
    this.scene.remove(this.label);
    this.labelMat.map?.dispose();
    this.labelMat.dispose();
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
