// Procedural sky dome: horizon gradient, sun/moon disc with glow, drifting
// cloud layer and stars at night.  Driven entirely by the map's env block.

import * as THREE from 'three';

const vert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w;   // always at the far plane
  }
`;

const frag = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uTop, uHorizon, uBottom, uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunSize, uSunIntensity, uStars, uClouds, uTime, uHaze, uSkyIntensity;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
               mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a*noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0
      ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55))
      : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.5));

    // haze band just above the horizon
    col = mix(col, uHorizon * 1.12, uHaze * exp(-abs(h) * 9.0));

    // sun / moon: angular sizes, so the disc stays a disc instead of
    // swallowing a third of the sky
    float sd = clamp(dot(d, normalize(uSunDir)), -1.0, 1.0);
    float ang = acos(sd);
    float disc = 1.0 - smoothstep(uSunSize * 0.85, uSunSize * 1.25, ang);
    float halo = exp(-ang * ang / 0.0035) * 0.24 + exp(-ang * ang / 0.10) * 0.05;
    col += uSunColor * (disc * uSunIntensity * 2.0 + halo * uSunIntensity * 0.7);

    // stars
    if (uStars > 0.01 && h > -0.05) {
      vec2 sp = d.xz / max(d.y + 0.35, 0.08) * 12.0;
      float s = hash(floor(sp * 22.0));
      float tw = 0.5 + 0.5 * sin(uTime * 2.0 + s * 60.0);
      float star = smoothstep(0.9965, 0.9995, s) * tw;
      col += vec3(star) * uStars * clamp(h * 2.5, 0.0, 1.0);
    }

    // clouds
    if (uClouds > 0.01 && h > 0.0) {
      vec2 cp = d.xz / max(h + 0.12, 0.12) * 1.3 + vec2(uTime * 0.006, uTime * 0.003);
      float c = fbm(cp * 1.6);
      c = smoothstep(0.44, 0.86, c) * clamp(h * 3.2, 0.0, 1.0);
      vec3 cloudCol = mix(uHorizon * 1.35, uTop * 1.5, 0.4) + uSunColor * 0.16;
      col = mix(col, cloudCol, c * uClouds);
    }

    gl_FragColor = vec4(col * uSkyIntensity, 1.0);
  }
`;

const PRESETS = {
  day: { top: 0x3a74c4, horizon: 0xc2d6e6, bottom: 0x4a555e, sunSize: 0.0125, stars: 0, clouds: 0.35, haze: 0.35, intensity: 1.9 },
  overcast: { top: 0x8b959f, horizon: 0xc8d0d6, bottom: 0x6a6f75, sunSize: 0.030, stars: 0, clouds: 0.85, haze: 0.6, intensity: 1.6 },
  dusk: { top: 0x24356a, horizon: 0xe08a44, bottom: 0x33262e, sunSize: 0.017, stars: 0.25, clouds: 0.5, haze: 0.7, intensity: 1.35 },
  night: { top: 0x080d18, horizon: 0x18243a, bottom: 0x05080c, sunSize: 0.011, stars: 1.0, clouds: 0.25, haze: 0.2, intensity: 1.0 },
  // 'interior' doubles as the image-based light for enclosed maps, and the IBL
  // is where most of a surface's fill actually comes from — a near-black one
  // meant Killhouse rendered nearly black no matter how far its hemisphere and
  // point lights were pushed. It is a lit room, not an unlit one.
  interior: { top: 0x4c545c, horizon: 0x6e777e, bottom: 0x383d42, sunSize: 0.0, stars: 0, clouds: 0, haze: 0, intensity: 1.5 }
};

export class Sky {
  constructor(scene) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: vert, fragmentShader: frag, side: THREE.BackSide,
        depthWrite: false, depthTest: true, fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x2f68b8) },
          uHorizon: { value: new THREE.Color(0xa9c2d8) },
          uBottom: { value: new THREE.Color(0x39424a) },
          uSunColor: { value: new THREE.Color(0xfff0d0) },
          uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
          uSunSize: { value: 0.006 },
          uSunIntensity: { value: 1 },
          uStars: { value: 0 },
          uClouds: { value: 0.3 },
          uHaze: { value: 0.3 },
          uSkyIntensity: { value: 2.2 },
          uTime: { value: 0 }
        }
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(1);
    scene.add(this.mesh);
  }

  apply(env) {
    const p = PRESETS[env.sky] || PRESETS.day;
    const u = this.mesh.material.uniforms;
    u.uTop.value.setHex(p.top);
    u.uHorizon.value.setHex(p.horizon);
    u.uBottom.value.setHex(typeof p.bottom === 'number' ? p.bottom : 0x39424a);
    u.uSunColor.value.setHex(env.sunColor ?? 0xfff0d0);
    u.uSunDir.value.set(env.sunDir[0], env.sunDir[1], env.sunDir[2]).normalize();
    u.uSunSize.value = p.sunSize;
    u.uSunIntensity.value = env.sky === 'night' ? 0.5 : 1.0;
    u.uStars.value = p.stars;
    u.uClouds.value = p.clouds;
    u.uHaze.value = p.haze;
    u.uSkyIntensity.value = p.intensity ?? 2.0;
  }

  update(t, camera) {
    this.mesh.material.uniforms.uTime.value = t;
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.9);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
