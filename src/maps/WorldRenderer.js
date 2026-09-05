// Turns shared map data into renderable geometry and a collision world.
//
// Brushes are merged per surface material (a whole level lands in ~10 draw
// calls), props become one InstancedMesh per type, and lights are managed by a
// distance-prioritised pool so only the nearest N are ever active.

import * as THREE from 'three';
import { World } from '../shared/physics.js';
import { surfaceMaterial, propMaterial } from '../render/Materials.js';
import { boxGeo } from '../render/Geo.js';
import { propGeometry } from '../render/Props.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { S } from '../core/Settings.js';
import { SURFACE } from '../shared/constants.js';

const LIGHT_BUDGET = { low: 6, medium: 10, high: 16, ultra: 24 };
// Map light intensities are authored as relative "fixture brightness"; this
// converts them into the renderer's physical units.  Decay is deliberately
// below the physical 2.0 so a ceiling fixture still reaches the floor of a
// 9-metre warehouse without blowing out everything directly beneath it.
const LIGHT_SCALE = 7.6;
const POINT_DECAY = 1.5;
const SPOT_DECAY = 1.35;

export class WorldRenderer {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.lights = [];
    this.meshes = [];
    this.instanced = [];
    this.zones = [];
    this.data = null;
    this.world = null;
    this.motes = null;
    this._tmp = new THREE.Vector3();
  }

  /** Build everything for one map. Safe to call repeatedly. */
  build(map) {
    this.clear();
    this.data = map;
    this.world = new World(map.brushes, { key: map.key });
    this.zones = map.zones || [];

    this.buildBrushes(map);
    this.buildProps(map);
    this.buildLights(map);
    this.buildDetail(map);

    this.engine.scene.add(this.group);
    this.engine.applyEnvironment(map.env);
    return this.world;
  }

  buildBrushes(map) {
    const bySurface = new Map();
    for (const b of map.brushes) {
      if (b.render === false) continue;
      const mat = b.mat || SURFACE.CONCRETE;
      let arr = bySurface.get(mat);
      if (!arr) bySurface.set(mat, (arr = []));
      arr.push(b);
    }
    for (const [surface, brushes] of bySurface) {
      const material = surfaceMaterial(surface);
      const scale = material.userData.texScale ?? 0.3;
      const geos = [];
      for (const b of brushes) {
        const g = boxGeo(b.s[0], b.s[1], b.s[2], scale);
        const m = new THREE.Matrix4();
        m.makeRotationY(b.yaw || 0);
        m.setPosition(b.p[0], b.p[1], b.p[2]);
        g.applyMatrix4(m);
        geos.push(g);
      }
      if (!geos.length) continue;
      // Merge in chunks so frustum culling still does something useful on
      // very large levels.
      const CHUNK = 90;
      for (let i = 0; i < geos.length; i += CHUNK) {
        const slice = geos.slice(i, i + CHUNK);
        const merged = mergeGeometries(slice, false);
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = surface !== SURFACE.GLASS;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
        this.meshes.push(mesh);
      }
      for (const g of geos) g.dispose();
    }
  }

  buildProps(map) {
    const byType = new Map();
    for (const p of map.props) {
      let arr = byType.get(p.type);
      if (!arr) byType.set(p.type, (arr = []));
      arr.push(p);
    }
    const mat = propMaterial();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sv = new THREE.Vector3();
    for (const [type, list] of byType) {
      const geo = propGeometry(type);
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.castShadow = S.shadows !== 'off';
      inst.receiveShadow = true;
      inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw || 0);
        v.set(p.p[0], p.p[1], p.p[2]);
        sv.setScalar(p.scale || 1);
        m4.compose(v, q, sv);
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.frustumCulled = true;
      this.group.add(inst);
      this.instanced.push(inst);
    }
  }

  buildLights(map) {
    const budget = LIGHT_BUDGET[S.lights] ?? 12;
    const fixtureGeo = new THREE.BoxGeometry(0.36, 0.06, 0.5);
    const fixtureMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0, toneMapped: false });
    for (const def of map.lights) {
      const isSpot = def.type === 'spot';
      const intensity = def.intensity * LIGHT_SCALE;
      const light = isSpot
        ? new THREE.SpotLight(def.color, intensity, def.distance, def.angle, def.penumbra, SPOT_DECAY)
        : new THREE.PointLight(def.color, intensity, def.distance, POINT_DECAY);
      light.position.set(def.p[0], def.p[1], def.p[2]);
      light.castShadow = false;
      if (isSpot) {
        light.target.position.set(def.target[0], def.target[1], def.target[2]);
        this.group.add(light.target);
      }
      light.visible = false;
      this.group.add(light);
      const entry = {
        light, def, base: intensity, flicker: def.flicker || 0,
        phase: Math.random() * 100, wantShadow: !!def.shadow, dist2: 0, active: false
      };
      this.lights.push(entry);
      if (def.fixture && def.fixture !== 'none') {
        const f = new THREE.Mesh(fixtureGeo, fixtureMat);
        f.position.set(def.p[0], def.p[1] - 0.06, def.p[2]);
        f.matrixAutoUpdate = false;
        f.updateMatrix();
        this.group.add(f);
        entry.fixture = f;
      }
    }
    this.budget = budget;
  }

  /** Dust motes / floating particulate — cheap, sells the air in a room. */
  buildDetail(map) {
    if (!S.dustMotes || !(map.env.dustMotes > 0)) return;
    const count = Math.floor(700 * (map.env.dustMotes || 1) * (S.particles || 1));
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const [w, d] = map.size;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * w * 0.75;
      pos[i * 3 + 1] = Math.random() * 9 + 0.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * d * 0.75;
      seed[i] = Math.random() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } },
      vertexShader: `
        attribute float aSeed;
        uniform float uTime; uniform vec3 uCam;
        varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.19 + aSeed) * 0.6;
          p.y += sin(uTime * 0.13 + aSeed * 1.7) * 0.35;
          p.z += cos(uTime * 0.16 + aSeed * 0.7) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = length(mv.xyz);
          vA = smoothstep(26.0, 3.0, dist) * (0.35 + 0.65 * sin(uTime * 1.3 + aSeed * 3.0) * 0.5 + 0.32);
          gl_PointSize = clamp(9.0 / dist, 0.7, 3.2);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(c)) * vA * 0.5;
          if (a < 0.01) discard;
          gl_FragColor = vec4(0.85, 0.87, 0.9, a);
        }`
    });
    this.motes = new THREE.Points(g, m);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  /** Distance-prioritised light activation + flicker. */
  update(dt, time, camPos) {
    if (this.motes) this.motes.material.uniforms.uTime.value = time;
    const lights = this.lights;
    if (!lights.length) return;
    for (let i = 0; i < lights.length; i++) {
      const e = lights[i];
      const p = e.light.position;
      e.dist2 = (p.x - camPos.x) ** 2 + (p.y - camPos.y) ** 2 + (p.z - camPos.z) ** 2;
    }
    // partial selection: only re-sort a few times a second
    this._sortT = (this._sortT || 0) - dt;
    if (this._sortT <= 0) {
      this._sortT = 0.25;
      this._order = lights.slice().sort((a, b) => a.dist2 - b.dist2);
      const budget = this.budget;
      for (let i = 0; i < this._order.length; i++) {
        const e = this._order[i];
        const want = i < budget && e.dist2 < (e.def.distance * 2.2) ** 2;
        if (want !== e.active) {
          e.active = want;
          e.light.visible = want;
          if (e.fixture) e.fixture.visible = want;
        }
      }
    }
    for (let i = 0; i < lights.length; i++) {
      const e = lights[i];
      if (!e.active) continue;
      if (e.flicker > 0) {
        const t = time * (2.2 + e.flicker * 5) + e.phase;
        const n = Math.sin(t) * Math.sin(t * 2.37) * Math.sin(t * 5.13);
        const drop = n > 0.72 - e.flicker * 0.5 ? 0.12 : 1;
        e.light.intensity = e.base * (0.78 + 0.22 * n) * drop;
        if (e.fixture) e.fixture.visible = drop > 0.5;
      } else e.light.intensity = e.base;
    }
  }

  /** Is this point inside an interior zone? Drives reverb + camera auto-gain. */
  zoneAt(x, y, z) {
    for (let i = 0; i < this.zones.length; i++) {
      const zn = this.zones[i];
      const [px, py, pz] = zn.p, [sx, sy, sz] = zn.s;
      if (Math.abs(x - px) <= sx / 2 && Math.abs(y - py) <= sy / 2 && Math.abs(z - pz) <= sz / 2) return zn;
    }
    return null;
  }

  clear() {
    for (const m of this.meshes) m.geometry.dispose();
    for (const i of this.instanced) i.dispose();
    if (this.motes) { this.motes.geometry.dispose(); this.motes.material.dispose(); }
    this.group.clear();
    this.group.parent?.remove(this.group);
    this.meshes.length = 0;
    this.instanced.length = 0;
    this.lights.length = 0;
    this.motes = null;
    this._order = null;
  }
}
