// Renderer, scene graph and frame loop.
//
// The engine owns the WebGL context and the post chain; everything else
// (world, players, weapons, HUD) plugs in through update hooks so the menu
// and the match share one persistent renderer and never reload the page.

import * as THREE from 'three';
import { PostFX } from '../render/PostFX.js';
import { Sky } from '../render/Sky.js';
import { S, settings } from './Settings.js';
import { perf } from './Perf.js';
import { bus } from './EventBus.js';
import { clamp } from '../shared/constants.js';

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const ctxAttrs = {
      canvas, antialias: false, alpha: false, stencil: false,
      powerPreference: 'high-performance', depth: true,
      failIfMajorPerformanceCaveat: false
    };
    this.renderer = new THREE.WebGLRenderer(ctxAttrs);
    this.renderer.setClearColor(0x05070a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = S.shadows !== 'off';
    this.renderer.shadowMap.type = S.shadows === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(S.fov, 1, 0.02, 600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.sky = new Sky(this.scene);
    // A second sky, rendered into a PMREM cube, provides image-based ambient
    // light.  Without it every metal surface renders black and interiors have
    // no bounce at all.
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(this.envScene);
    this.envSky.mesh.scale.setScalar(50);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.castShadow = S.shadows !== 'off';
    this.configureShadow();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8fa8c0, 0x2b2823, 0.6);
    this.scene.add(this.hemi);

    this.postfx = new PostFX(this.renderer, this.scene, this.camera);

    this.updaters = new Set();
    this.lateUpdaters = new Set();
    this.running = false;
    this.time = 0;
    this.renderScale = S.renderScale;
    this.postCtx = {};
    this._accum = 0;

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    this.onResize();

    bus.on('settings:changed', (k) => this.onSettingsChanged(k));
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      bus.emit('engine:contextlost');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.postfx.build();
      bus.emit('engine:contextrestored');
    });
  }

  configureShadow() {
    const res = S.shadowRes || 2048;
    this.sun.shadow.mapSize.set(res, res);
    const d = S.shadows === 'low' ? 26 : S.shadows === 'medium' ? 38 : 52;
    const c = this.sun.shadow.camera;
    c.left = -d; c.right = d; c.top = d; c.bottom = -d;
    c.near = 0.5; c.far = 190;
    c.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.035;
    this.sun.castShadow = S.shadows !== 'off';
  }

  onSettingsChanged(key) {
    if (key === 'fov' || key === '*') {
      this.camera.fov = S.fov;
      this.camera.updateProjectionMatrix();
    }
    if (['shadows', 'shadowRes', 'preset', '*'].includes(key)) {
      this.renderer.shadowMap.enabled = S.shadows !== 'off';
      this.renderer.shadowMap.type = S.shadows === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      this.configureShadow();
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (['bloom', 'motionBlur', 'aa', 'preset', 'renderScale', '*'].includes(key)) {
      this.renderScale = S.renderScale;
      this.onResize();
      this.postfx.build();
    }
    if (['bodycam', 'filmGrain', 'chromatic', 'lensDistortion', 'compression', 'lensFlare',
      'vignette', 'exposure', 'brightness', 'preset'].includes(key) || key === '*') {
      this.postfx.applySettings();
    }
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const scale = clamp(this.renderScale || 1, 0.4, 1.0);
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postfx.setSize(w, h, dpr);
  }

  applyEnvironment(env) {
    this.sky.apply(env);
    this.envSky.apply(env);
    this.buildEnvMap(env);
    this.sun.color.setHex(env.sunColor ?? 0xffffff);
    this.sun.intensity = env.sunIntensity ?? 1.5;
    const d = new THREE.Vector3(env.sunDir[0], env.sunDir[1], env.sunDir[2]).normalize();
    this.sunDir = d;
    this.hemi.color.setHex(env.ambientColor ?? 0x8fa8c0);
    this.hemi.groundColor.setHex(env.hemiGround ?? 0x2b2823);
    this.hemi.intensity = env.ambientIntensity ?? 0.6;
    if (env.fog && S.fog) {
      this.scene.fog = new THREE.Fog(env.fog.color, env.fog.near * (S.viewDistance || 1), env.fog.far * (S.viewDistance || 1));
      this.renderer.setClearColor(env.fog.color, 1);
    } else {
      this.scene.fog = null;
    }
    this.renderer.toneMappingExposure = (env.exposure ?? 1) * (S.exposure ?? 1) * 1.02;
    this.camera.far = Math.max(220, (env.fog?.far ?? 200) * 1.6);
    this.camera.updateProjectionMatrix();
  }

  /** Bake the sky into an irradiance/reflection probe. */
  buildEnvMap(env) {
    try {
      this.envRT?.dispose();
      this.envSky.mesh.material.uniforms.uTime.value = 0;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = env.sky === 'night' ? 0.7
        : env.sky === 'interior' ? 0.9 : 1.0;
    } catch (e) {
      console.warn('env probe failed', e);
    }
  }

  /** Keep the shadow frustum centred on the player. */
  updateSun(target) {
    if (!this.sunDir || !this.sun.castShadow) return;
    const dist = 60;
    this.sun.position.set(
      target.x + this.sunDir.x * dist,
      target.y + this.sunDir.y * dist,
      target.z + this.sunDir.z * dist
    );
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }

  addUpdater(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }
  addLateUpdater(fn) { this.lateUpdaters.add(fn); return () => this.lateUpdaters.delete(fn); }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.frameHandle = requestAnimationFrame(loop);
      this.frame();
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
  }

  frame() {
    let dt = perf.begin();
    if (S.fpsCap > 0) {
      this._accum += dt;
      const step = 1 / S.fpsCap;
      if (this._accum < step) return;
      dt = this._accum;
      this._accum = 0;
    }
    dt = Math.min(dt, 0.1);
    this.time += dt;

    for (const fn of this.updaters) fn(dt, this.time);
    for (const fn of this.lateUpdaters) fn(dt, this.time);

    this.sky.update(this.time, this.camera);
    this.postfx.update(dt, this.postCtx);

    this.renderer.info.reset();
    this.postfx.render();
    perf.drawCalls = this.renderer.info.render.calls;
    perf.triangles = this.renderer.info.render.triangles;

    const suggest = perf.suggestScale(this.renderScale, dt);
    if (suggest) {
      this.renderScale = suggest;
      this.onResize();
    }
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.postfx.dispose();
    this.sky.dispose();
    this.envSky.dispose();
    this.envRT?.dispose();
    this.pmrem?.dispose();
    this.renderer.dispose();
  }
}
