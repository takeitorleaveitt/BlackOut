// Map pings — the Siege "tag that spot" call, on Z.
//
// A ping is a red arrow driven into a point in the world. It is squad comms,
// not a world object: only the pinger's own side ever sees one, it draws
// through geometry so it still reads from the far side of a wall, and it
// stays put until that player marks somewhere else or the round turns over.
//
// One marker per player, deliberately. Letting a key that is this cheap to
// press stack markers turns four teammates into a screen full of arrows, and
// "where I want you looking" only means anything if there is one of them.

import * as THREE from 'three';

const PING_COLOR = 0xff3b30;

/** A stubby arrow: a shaft with a head, pointing straight down at the mark. */
function buildArrow() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: PING_COLOR, toneMapped: false,
    // Through walls, like every callout marker in the genre. A ping you can
    // only see when you are already looking at the thing is not a callout.
    depthTest: false, depthWrite: false, transparent: true
  });

  const head = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.30, 4), mat);
  head.rotation.x = Math.PI;          // point down
  head.rotation.y = Math.PI / 4;      // flat face toward the viewer
  head.position.y = 0.15;

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.34, 0.055), mat);
  shaft.position.y = 0.47;
  shaft.rotation.y = Math.PI / 4;

  // A ring on the ground under it, so the arrow reads as attached to a place
  // rather than floating in front of one.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.20, 0.26, 16), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;

  g.add(head, shaft, ring);
  for (const m of g.children) { m.frustumCulled = false; m.renderOrder = 16; }
  g.userData.mat = mat;
  return g;
}

export class Pings {
  constructor(scene) {
    this.scene = scene;
    this.byPlayer = new Map();   // playerId -> { group, mat, x, y, z, born, bob }
    this.t = 0;
  }

  /**
   * Place (or move) a player's mark. `team` is compared against the local
   * player's by the caller — this class only draws what it is given.
   */
  set(playerId, x, y, z) {
    let m = this.byPlayer.get(playerId);
    if (!m) {
      const group = buildArrow();
      this.scene.add(group);
      m = { group, mat: group.userData.mat, bob: Math.random() * 10 };
      this.byPlayer.set(playerId, m);
    }
    m.x = x; m.y = y; m.z = z;
    m.born = this.t;
    m.group.visible = true;
  }

  remove(playerId) {
    const m = this.byPlayer.get(playerId);
    if (!m) return;
    this.scene.remove(m.group);
    for (const c of m.group.children) c.geometry.dispose();
    m.mat.dispose();
    this.byPlayer.delete(playerId);
  }

  /** Drop every mark — a new round starts with a clean map. */
  clear() {
    for (const id of [...this.byPlayer.keys()]) this.remove(id);
  }

  update(dt, camera) {
    this.t += dt;
    for (const m of this.byPlayer.values()) {
      m.bob += dt * 2.2;
      const age = this.t - m.born;
      // A short pop on arrival so a new mark catches the eye even if it lands
      // somewhere you were already looking.
      const pop = age < 0.28 ? 1 + (1 - age / 0.28) * 0.7 : 1;
      m.group.position.set(m.x, m.y + Math.sin(m.bob) * 0.04, m.z);
      m.group.scale.setScalar(pop);
      // Face the camera on the vertical axis only: the arrow stays upright and
      // planted, it just never shows the viewer its thin edge.
      m.group.rotation.y = Math.atan2(
        camera.position.x - m.x, camera.position.z - m.z
      );
      // Far marks fade back rather than crowding the middle of the screen at
      // full strength from across the map.
      const d = Math.hypot(camera.position.x - m.x, camera.position.y - m.y, camera.position.z - m.z);
      m.mat.opacity = d < 6 ? 0.55 + (d / 6) * 0.45 : Math.max(0.42, 1 - (d - 6) / 90);
    }
  }

  dispose() { this.clear(); }
}
