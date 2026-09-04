// Pooled combat effects: bullet decals, impact particles, tracers, ejected
// casings and muzzle flashes.  Everything is instanced or pooled so a firefight
// never allocates and never spikes the frame time.

import * as THREE from 'three';
import { makeDecalTexture, makeRadialTexture } from './Textures.js';
import { S } from '../core/Settings.js';
import { SURFACE, clamp, rand } from '../shared/constants.js';

// ---------------------------------------------------------------------------
// Decals
// ---------------------------------------------------------------------------
const DECAL_KINDS = ['concrete', 'metal', 'wood', 'glass'];
const KIND_FOR = {
  [SURFACE.CONCRETE]: 'concrete', [SURFACE.PLASTER]: 'concrete', [SURFACE.TILE]: 'concrete',
  [SURFACE.GRAVEL]: 'concrete', [SURFACE.DIRT]: 'concrete', [SURFACE.GRASS]: 'concrete',
  [SURFACE.METAL]: 'metal', [SURFACE.WOOD]: 'wood', [SURFACE.CARPET]: 'wood',
  [SURFACE.FABRIC]: 'wood', [SURFACE.GLASS]: 'glass', [SURFACE.WATER]: 'glass'
};

const decalVert = /* glsl */`
  attribute float aAlpha;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vAlpha = aAlpha;
    #ifdef USE_INSTANCING
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    #else
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
    #endif
    gl_Position = projectionMatrix * mv;
  }
`;
const decalFrag = /* glsl */`
  uniform sampler2D map;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(map, vUv);
    float a = t.a * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(t.rgb, a);
  }
`;

class DecalSystem {
  constructor(scene, max = 200) {
    this.scene = scene;
    this.max = max;
    this.groups = {};
    const geoBase = new THREE.PlaneGeometry(1, 1);
    for (const kind of DECAL_KINDS) {
      const geo = geoBase.clone();
      const alphas = new Float32Array(max);
      geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(alphas, 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: decalVert, fragmentShader: decalFrag,
        uniforms: { map: { value: makeDecalTexture(kind, 64) } },
        transparent: true, depthWrite: false, depthTest: true,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
      });
      const mesh = new THREE.InstancedMesh(geo, mat, max);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      this.groups[kind] = { mesh, alphas, list: [] };
    }
    geoBase.dispose();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._spin = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 0, 1);
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  add(point, normal, surface, size = 0.12) {
    const kind = KIND_FOR[surface] || 'concrete';
    const g = this.groups[kind];
    if (!g) return;
    const cap = Math.min(this.max, S.decals || 120);
    let idx;
    if (g.list.length < cap) { idx = g.list.length; g.list.push({}); }
    else {
      let oldest = 0, t = Infinity;
      for (let i = 0; i < g.list.length; i++) if (g.list[i].born < t) { t = g.list[i].born; oldest = i; }
      idx = oldest;
    }
    const e = g.list[idx];
    e.born = performance.now() / 1000;
    e.life = (S.decalLife || 18) * rand(0.8, 1.2);

    this._v.set(normal[0], normal[1], normal[2]);
    this._q.setFromUnitVectors(this._up, this._v);
    this._spin.setFromAxisAngle(this._up, Math.random() * Math.PI * 2);
    this._q.multiply(this._spin);
    const sc = size * rand(0.8, 1.35);
    this._s.set(sc, sc, sc);
    this._p.set(
      point[0] + normal[0] * 0.012,
      point[1] + normal[1] * 0.012,
      point[2] + normal[2] * 0.012
    );
    this._m.compose(this._p, this._q, this._s);
    g.mesh.setMatrixAt(idx, this._m);
    g.alphas[idx] = 1;
    g.mesh.count = g.list.length;
    g.mesh.instanceMatrix.needsUpdate = true;
    g.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }

  update() {
    const now = performance.now() / 1000;
    for (const kind of DECAL_KINDS) {
      const g = this.groups[kind];
      if (!g.list.length) continue;
      let dirty = false;
      for (let i = 0; i < g.list.length; i++) {
        const e = g.list[i];
        const age = now - e.born;
        const a = age > e.life ? 0 : age > e.life - 3 ? (e.life - age) / 3 : 1;
        if (g.alphas[i] !== a) { g.alphas[i] = a; dirty = true; }
      }
      if (dirty) g.mesh.geometry.attributes.aAlpha.needsUpdate = true;
    }
  }

  clear() {
    for (const kind of DECAL_KINDS) {
      const g = this.groups[kind];
      g.list.length = 0;
      g.mesh.count = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Particles: one normal-blended cloud for debris/dust, one additive for sparks
// ---------------------------------------------------------------------------
const partVert = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / max(-mv.z, 0.1));
    gl_Position = projectionMatrix * mv;
  }
`;
const partFrag = /* glsl */`
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.05, d) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

class ParticleSystem {
  constructor(scene, max = 900) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: partVert, fragmentShader: partFrag,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);

    // sparks
    this.sMax = 400;
    this.sN = 0;
    this.sPos = new Float32Array(this.sMax * 3);
    this.sVel = new Float32Array(this.sMax * 3);
    this.sCol = new Float32Array(this.sMax * 3);
    this.sSize = new Float32Array(this.sMax);
    this.sAlpha = new Float32Array(this.sMax);
    this.sLife = new Float32Array(this.sMax);
    this.sMaxLife = new Float32Array(this.sMax);
    this.sGeo = new THREE.BufferGeometry();
    this.sGeo.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    this.sGeo.setAttribute('aColor', new THREE.BufferAttribute(this.sCol, 3));
    this.sGeo.setAttribute('aSize', new THREE.BufferAttribute(this.sSize, 1));
    this.sGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.sAlpha, 1));
    this.sGeo.setDrawRange(0, 0);
    const sMat = this.mat.clone();
    sMat.blending = THREE.AdditiveBlending;
    this.sparks = new THREE.Points(this.sGeo, sMat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 5;
    scene.add(this.sparks);
  }

  spawn(x, y, z, vx, vy, vz, color, size, life, gravity = 6, drag = 1.4) {
    // Once the pool is full, steal the slot nearest death instead of a random
    // one — that way an unlucky overwrite never cuts off a particle that just
    // started its life.
    const i = this.n < this.max ? this.n++ : this.oldest(this.life, this.n);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color[0]; this.col[i * 3 + 1] = color[1]; this.col[i * 3 + 2] = color[2];
    this.size[i] = size;
    this.alpha[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
    this.drag[i] = drag;
  }

  spark(x, y, z, vx, vy, vz, size, life) {
    const i = this.sN < this.sMax ? this.sN++ : this.oldest(this.sLife, this.sN);
    this.sPos[i * 3] = x; this.sPos[i * 3 + 1] = y; this.sPos[i * 3 + 2] = z;
    this.sVel[i * 3] = vx; this.sVel[i * 3 + 1] = vy; this.sVel[i * 3 + 2] = vz;
    this.sCol[i * 3] = 1.0; this.sCol[i * 3 + 1] = 0.72; this.sCol[i * 3 + 2] = 0.32;
    this.sSize[i] = size;
    this.sAlpha[i] = 1;
    this.sLife[i] = life;
    this.sMaxLife[i] = life;
  }

  oldest(lifeArr, n) {
    let idx = 0, best = Infinity;
    for (let i = 0; i < n; i++) { if (lifeArr[i] < best) { best = lifeArr[i]; idx = i; } }
    return idx;
  }

  /** Swap a dead slot with the last active one so the live range shrinks. */
  swapOut(i, last, pos, vel, col, size, alpha, life, maxLife, grav, drag) {
    pos[i * 3] = pos[last * 3]; pos[i * 3 + 1] = pos[last * 3 + 1]; pos[i * 3 + 2] = pos[last * 3 + 2];
    vel[i * 3] = vel[last * 3]; vel[i * 3 + 1] = vel[last * 3 + 1]; vel[i * 3 + 2] = vel[last * 3 + 2];
    col[i * 3] = col[last * 3]; col[i * 3 + 1] = col[last * 3 + 1]; col[i * 3 + 2] = col[last * 3 + 2];
    size[i] = size[last]; alpha[i] = alpha[last]; life[i] = life[last]; maxLife[i] = maxLife[last];
    if (grav) grav[i] = grav[last];
    if (drag) drag[i] = drag[last];
  }

  update(dt) {
    // Live particles occupy [0, n) — a dead one is swapped with the last
    // live slot and n shrinks, so the GPU buffer upload below only ever
    // covers particles that are actually on screen, not the pool's max size.
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = this.n - 1;
        if (i !== last) {
          this.swapOut(i, last, this.pos, this.vel, this.col, this.size, this.alpha, this.life, this.maxLife, this.grav, this.drag);
        }
        this.n--;
        continue;
      }
      const t = clamp(this.life[i] / this.maxLife[i], 0, 1);
      this.alpha[i] = t * t * 0.85;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += dt * 1.5;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    if (this.n > 0) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
    }

    let si = 0;
    while (si < this.sN) {
      this.sLife[si] -= dt;
      if (this.sLife[si] <= 0) {
        const last = this.sN - 1;
        if (si !== last) {
          this.swapOut(si, last, this.sPos, this.sVel, this.sCol, this.sSize, this.sAlpha, this.sLife, this.sMaxLife, null, null);
        }
        this.sN--;
        continue;
      }
      const t = clamp(this.sLife[si] / this.sMaxLife[si], 0, 1);
      this.sAlpha[si] = t;
      this.sVel[si * 3 + 1] -= 13 * dt;
      this.sVel[si * 3] *= Math.exp(-2.2 * dt);
      this.sVel[si * 3 + 2] *= Math.exp(-2.2 * dt);
      this.sPos[si * 3] += this.sVel[si * 3] * dt;
      this.sPos[si * 3 + 1] += this.sVel[si * 3 + 1] * dt;
      this.sPos[si * 3 + 2] += this.sVel[si * 3 + 2] * dt;
      this.sCol[si * 3 + 1] = 0.72 * t;
      this.sCol[si * 3 + 2] = 0.32 * t * t;
      si++;
    }
    this.sGeo.setDrawRange(0, this.sN);
    if (this.sN > 0) {
      this.sGeo.attributes.position.needsUpdate = true;
      this.sGeo.attributes.aAlpha.needsUpdate = true;
      this.sGeo.attributes.aColor.needsUpdate = true;
    }
  }

  clear() {
    this.n = 0; this.sN = 0;
    this.geo.setDrawRange(0, 0);
    this.sGeo.setDrawRange(0, 0);
  }
}

// ---------------------------------------------------------------------------
// Tracers — stretched quads that actually travel at the round's velocity
// ---------------------------------------------------------------------------
class TracerSystem {
  constructor(scene, max = 56) {
    this.free = [];
    this.active = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd8a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide
    });
    this.group = new THREE.Group();
    scene.add(this.group);
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 6;
      this.group.add(m);
      this.free.push(m);
    }
    this._dir = new THREE.Vector3();
    this._toCam = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();
  }

  fire(origin, dir, speed, distance, width = 0.016, color = 0xffd8a0) {
    const m = this.free.pop();
    if (!m) return;
    m.visible = true;
    m.material.color.setHex(color);
    m.material.opacity = 0.9;
    m.userData = {
      ox: origin[0], oy: origin[1], oz: origin[2],
      dx: dir[0], dy: dir[1], dz: dir[2],
      speed, distance, width, travelled: 0
    };
    this.active.push(m);
  }

  update(dt, camera) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      const u = m.userData;
      u.travelled += u.speed * dt;
      const tail = Math.max(0, u.travelled - 3.2);
      if (tail >= u.distance) {
        m.visible = false;
        this.active.splice(i, 1);
        this.free.push(m);
        continue;
      }
      const head = Math.min(u.travelled, u.distance);
      const len = Math.max(0.05, head - tail);
      m.position.set(u.ox + u.dx * tail, u.oy + u.dy * tail, u.oz + u.dz * tail);
      this._dir.set(u.dx, u.dy, u.dz);
      this._toCam.copy(camera.position).sub(m.position).normalize();
      this._right.copy(this._dir).cross(this._toCam);
      if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0);
      this._right.normalize();
      this._fwd.copy(this._right).cross(this._dir).normalize();
      this._m4.makeBasis(this._right, this._dir, this._fwd);
      m.quaternion.setFromRotationMatrix(this._m4);
      m.scale.set(u.width, len, 1);
      m.material.opacity = 0.85 * (1 - head / Math.max(u.distance, 0.001)) + 0.15;
    }
  }

  clear() {
    while (this.active.length) {
      const m = this.active.pop();
      m.visible = false;
      this.free.push(m);
    }
  }
}

// ---------------------------------------------------------------------------
// Ejected casings — they bounce, they roll, they make a noise when they land
// ---------------------------------------------------------------------------
class CasingSystem {
  constructor(scene, max = 44) {
    this.free = [];
    this.active = [];
    const geo = new THREE.CylinderGeometry(0.0045, 0.005, 0.019, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb98f3c, roughness: 0.3, metalness: 0.95 });
    const shellGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.032, 8);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x8c2a24, roughness: 0.7, metalness: 0.1 });
    this.group = new THREE.Group();
    scene.add(this.group);
    for (let i = 0; i < max; i++) {
      const shell = i % 5 === 0;
      const m = new THREE.Mesh(shell ? shellGeo : geo, shell ? shellMat : mat);
      m.visible = false;
      m.userData = {};
      this.group.add(m);
      this.free.push(m);
    }
  }

  eject(pos, dir, up, right, isShell, onLand) {
    const m = this.free.pop();
    if (!m) return;
    m.visible = true;
    m.position.copy(pos);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.userData = {
      vx: right.x * rand(1.6, 2.9) + dir.x * rand(-0.4, 0.5) + up.x * rand(0.6, 1.4),
      vy: right.y * rand(1.6, 2.9) + up.y * rand(1.2, 2.2),
      vz: right.z * rand(1.6, 2.9) + dir.z * rand(-0.4, 0.5) + up.z * rand(0.6, 1.4),
      rx: rand(-14, 14), ry: rand(-14, 14), rz: rand(-14, 14),
      life: 3.6, landed: false, onLand, isShell
    };
    this.active.push(m);
  }

  update(dt, world) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      const u = m.userData;
      u.life -= dt;
      if (u.life <= 0) {
        m.visible = false;
        this.active.splice(i, 1);
        this.free.push(m);
        continue;
      }
      if (u.landed) continue;
      u.vy -= 19 * dt;
      const nx = m.position.x + u.vx * dt;
      const ny = m.position.y + u.vy * dt;
      const nz = m.position.z + u.vz * dt;
      if (world && u.vy < 0) {
        const sup = world.supportY(nx, ny, nz, 0.02, 0.14);
        if (sup.y > -Infinity && ny <= sup.y + 0.02) {
          m.position.set(nx, sup.y + 0.012, nz);
          u.landed = true;
          u.life = Math.min(u.life, 2.8);
          if (u.onLand) u.onLand(m.position, sup.surface, u.isShell);
          continue;
        }
      }
      m.position.set(nx, ny, nz);
      m.rotation.x += u.rx * dt;
      m.rotation.y += u.ry * dt;
      m.rotation.z += u.rz * dt;
    }
  }

  clear() {
    while (this.active.length) { const m = this.active.pop(); m.visible = false; this.free.push(m); }
  }
}

// ---------------------------------------------------------------------------
// Muzzle flashes
// ---------------------------------------------------------------------------
class FlashSystem {
  constructor(scene, max = 10) {
    this.free = [];
    this.active = [];
    const tex = makeRadialTexture(96, 'rgba(255,242,205,1)', 'rgba(255,140,40,0)', 1.6);
    for (let i = 0; i < max; i++) {
      const g = new THREE.Group();
      const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
        transparent: true, toneMapped: false
      }));
      core.renderOrder = 20;
      g.add(core);
      const star = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: tex, blending: THREE.AdditiveBlending, transparent: true,
          depthWrite: false, depthTest: false, toneMapped: false
        })
      );
      star.renderOrder = 20;
      g.add(star);
      const light = new THREE.PointLight(0xffca80, 0, 10, 1.6);
      g.add(light);
      g.visible = false;
      scene.add(g);
      this.free.push({ g, core, star, light, life: 0, maxLife: 1, scale: 1 });
    }
  }

  flash(pos, scale = 1, suppressed = false) {
    const f = this.free.pop();
    if (!f) return;
    f.g.position.copy(pos);
    f.g.visible = true;
    f.core.scale.setScalar(0.001);
    f.star.scale.setScalar(0.001);
    f.star.rotation.z = Math.random() * Math.PI;
    f.life = suppressed ? 0.035 : 0.06;
    f.maxLife = f.life;
    f.scale = scale * (suppressed ? 0.35 : 1);
    f.light.intensity = suppressed ? 4 : 40 * scale;
    this.active.push(f);
  }

  update(dt, camera) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.g.visible = false;
        f.light.intensity = 0;
        this.active.splice(i, 1);
        this.free.push(f);
        continue;
      }
      const t = f.life / f.maxLife;
      const s = f.scale * 0.14;
      f.core.scale.setScalar(s * 2.1 * t + 0.008);
      f.star.scale.set(s * 4.6 * t, s * 1.2 * t, 1);
      f.star.lookAt(camera.position);
      f.light.intensity *= 0.7;
    }
  }

  clear() {
    while (this.active.length) {
      const f = this.active.pop();
      f.g.visible = false;
      f.light.intensity = 0;
      this.free.push(f);
    }
  }
}

// ---------------------------------------------------------------------------
// Facade
// ---------------------------------------------------------------------------
const IMPACT_COLORS = {
  concrete: [0.62, 0.60, 0.57], plaster: [0.78, 0.76, 0.72], tile: [0.7, 0.7, 0.68],
  metal: [0.55, 0.55, 0.58], wood: [0.42, 0.28, 0.15], glass: [0.7, 0.85, 0.95],
  dirt: [0.36, 0.27, 0.18], grass: [0.28, 0.36, 0.18], gravel: [0.5, 0.48, 0.45],
  carpet: [0.32, 0.28, 0.24], fabric: [0.35, 0.32, 0.28], water: [0.5, 0.7, 0.85],
  flesh: [0.45, 0.05, 0.05]
};

export class Effects {
  constructor(scene, engine) {
    this.scene = scene;
    this.engine = engine;
    this.decals = new DecalSystem(scene, 200);
    this.particles = new ParticleSystem(scene, Math.max(200, Math.floor(900 * (S.particles || 1))));
    this.tracers = new TracerSystem(scene, 56);
    this.casings = new CasingSystem(scene, 44);
    this.flashes = new FlashSystem(scene, 10);
  }

  /** Surface impact: decal plus material-appropriate debris. */
  impact(point, normal, surface, energy = 1) {
    const q = S.particles || 1;
    const col = IMPACT_COLORS[surface] || IMPACT_COLORS.concrete;
    const isFlesh = surface === 'flesh';
    if (!isFlesh) this.decals.add(point, normal, surface, surface === 'glass' ? 0.16 : 0.11);

    const n = Math.round((isFlesh ? 10 : 8) * q * clamp(energy, 0.3, 1.2));
    for (let i = 0; i < n; i++) {
      const sp = isFlesh ? rand(1.2, 3.4) : rand(1.4, 4.8) * energy;
      this.particles.spawn(
        point[0], point[1], point[2],
        normal[0] * sp + rand(-1.4, 1.4),
        normal[1] * sp + rand(-0.4, 2.2),
        normal[2] * sp + rand(-1.4, 1.4),
        col,
        isFlesh ? rand(1.4, 3.0) : rand(1.6, 4.2),
        isFlesh ? rand(0.4, 0.8) : rand(0.5, 1.3),
        isFlesh ? 9 : 7.5, isFlesh ? 2.6 : 1.6
      );
    }

    if (surface === 'concrete' || surface === 'plaster' || surface === 'gravel' || surface === 'tile') {
      for (let i = 0; i < Math.round(4 * q); i++) {
        this.particles.spawn(
          point[0] + rand(-0.06, 0.06), point[1] + rand(-0.06, 0.06), point[2] + rand(-0.06, 0.06),
          normal[0] * rand(0.2, 0.9) + rand(-0.3, 0.3), rand(0.2, 0.9),
          normal[2] * rand(0.2, 0.9) + rand(-0.3, 0.3),
          [col[0] * 1.1, col[1] * 1.1, col[2] * 1.1], rand(9, 18), rand(0.7, 1.5), 0.35, 2.4
        );
      }
    }
    if (surface === 'metal') {
      for (let i = 0; i < Math.round(9 * q); i++) {
        this.particles.spark(
          point[0], point[1], point[2],
          normal[0] * rand(1.5, 6) + rand(-2.4, 2.4),
          normal[1] * rand(1.5, 6) + rand(-0.5, 3.2),
          normal[2] * rand(1.5, 6) + rand(-2.4, 2.4),
          rand(1.1, 2.4), rand(0.25, 0.6)
        );
      }
    }
    if (surface === 'wood') {
      for (let i = 0; i < Math.round(5 * q); i++) {
        this.particles.spawn(
          point[0], point[1], point[2],
          normal[0] * rand(1, 3.4) + rand(-1, 1), rand(0.4, 2.4),
          normal[2] * rand(1, 3.4) + rand(-1, 1),
          [0.35, 0.22, 0.11], rand(1.4, 3.4), rand(0.8, 1.6), 8, 1.2
        );
      }
    }
    if (surface === 'glass') {
      for (let i = 0; i < Math.round(12 * q); i++) {
        this.particles.spawn(
          point[0], point[1], point[2],
          rand(-2.5, 2.5), rand(-0.5, 2.5), rand(-2.5, 2.5),
          [0.75, 0.9, 1.0], rand(1.0, 2.2), rand(0.9, 1.8), 11, 0.9
        );
      }
    }
    if (surface === 'water') {
      for (let i = 0; i < Math.round(10 * q); i++) {
        this.particles.spawn(
          point[0], point[1], point[2],
          rand(-1.4, 1.4), rand(1.5, 4), rand(-1.4, 1.4),
          [0.6, 0.78, 0.9], rand(1.8, 3.6), rand(0.4, 0.9), 10, 1.0
        );
      }
    }
  }

  bloodMist(point, dir) {
    const q = S.particles || 1;
    for (let i = 0; i < Math.round(9 * q); i++) {
      this.particles.spawn(
        point[0], point[1], point[2],
        dir[0] * rand(1.5, 4.5) + rand(-1, 1), rand(-0.5, 1.6),
        dir[2] * rand(1.5, 4.5) + rand(-1, 1),
        [0.42, 0.03, 0.03], rand(2.2, 5.0), rand(0.35, 0.8), 8, 2.2
      );
    }
  }

  update(dt, camera, world) {
    this.decals.update();
    this.particles.update(dt);
    this.tracers.update(dt, camera);
    this.casings.update(dt, world);
    this.flashes.update(dt, camera);
  }

  clear() {
    this.decals.clear();
    this.particles.clear();
    this.tracers.clear();
    this.casings.clear();
    this.flashes.clear();
  }
}
