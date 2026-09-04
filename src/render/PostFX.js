// Post-processing chain.
//
//   scene -> bloom -> temporal motion blur -> bodycam pass -> FXAA -> screen
//
// Every stage can be switched off from the graphics settings; the chain is
// rebuilt when the relevant settings change so low-end machines pay nothing
// for effects they disabled.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { BodycamShader } from './passes/BodycamShader.js';
import { MotionBlurShader } from './passes/MotionBlurShader.js';
import { makeNoiseTexture } from './Textures.js';
import { S } from '../core/Settings.js';
import { clamp } from '../shared/constants.js';

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.noise = makeNoiseTexture(256);
    this.enabled = true;
    this.size = new THREE.Vector2(1, 1);
    this.prevTarget = null;
    this.blurTarget = null;
    this.offset = new THREE.Vector2();
    this.gain = 1;
    this.damage = 0;
    this.flash = 0;
    this.build();
  }

  build() {
    this.dispose(false);
    const r = this.renderer;
    r.getSize(this.size);
    const dpr = r.getPixelRatio();
    const w = Math.max(2, Math.floor(this.size.x * dpr));
    const h = Math.max(2, Math.floor(this.size.y * dpr));

    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, samples: 0
    }));
    this.composer.setSize(this.size.x, this.size.y);
    this.composer.setPixelRatio(dpr);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // The first-person weapon lives in its own scene rendered on a cleared
    // depth buffer, so it can never clip through walls while still receiving
    // bloom, grain and the rest of the bodycam chain.
    if (this.viewmodelScene) {
      this.viewmodelPass = new RenderPass(
        this.viewmodelScene,
        this.viewmodelCamera || this.camera
      );
      this.viewmodelPass.clear = false;
      this.viewmodelPass.clearDepth = true;
      this.composer.addPass(this.viewmodelPass);
    }

    if (S.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.62, 1.05);
      this.bloom.threshold = 1.05;
      this.bloom.strength = 0.42;
      this.bloom.radius = 0.62;
      this.composer.addPass(this.bloom);
    } else this.bloom = null;

    if (S.motionBlur) {
      this.motion = new ShaderPass(MotionBlurShader);
      this.motion.uniforms.uOffset.value = this.offset;
      this.prevTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
      this.motion.uniforms.tPrev.value = this.prevTarget.texture;
      this.composer.addPass(this.motion);
    } else this.motion = null;

    this.bodycam = new ShaderPass(BodycamShader);
    this.bodycam.uniforms.tNoise.value = this.noise;
    this.bodycam.uniforms.uResolution.value = new THREE.Vector2(w, h);
    this.composer.addPass(this.bodycam);

    if (S.aa === 'fxaa') {
      this.fxaa = new ShaderPass(FXAAShader);
      this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
      this.composer.addPass(this.fxaa);
    } else this.fxaa = null;

    this.composer.passes[this.composer.passes.length - 1].renderToScreen = true;
    this.applySettings();
  }

  /** Attach the first-person weapon scene + its camera (rebuilds the chain). */
  setViewmodelScene(scene, camera) {
    this.viewmodelScene = scene;
    this.viewmodelCamera = camera;
    this.build();
  }

  applySettings() {
    const u = this.bodycam.uniforms;
    const strength = S.bodycam ?? 1;
    u.uStrength.value = strength;
    u.uDistortion.value = S.lensDistortion ? 0.30 : 0.0;
    u.uChroma.value = S.chromatic ? 0.75 : 0.0;
    u.uGrain.value = S.filmGrain ? 0.55 : 0.0;
    u.uScanline.value = S.compression ? 0.32 : 0.0;
    u.uCompression.value = S.compression ? 0.45 : 0.0;
    u.uGlare.value = S.lensFlare ? 0.4 : 0.0;
    u.uVignette.value = 0.68 * (S.vignette ?? 1);
    u.uExposure.value = S.exposure ?? 1;
    if (this.bloom) {
      this.bloom.strength = 0.42;
      this.bloom.threshold = 1.05;
      this.bloom.radius = 0.62;
    }
  }

  setSize(w, h, dpr) {
    this.size.set(w, h);
    if (!this.composer) return;
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    const pw = Math.max(2, Math.floor(w * dpr)), ph = Math.max(2, Math.floor(h * dpr));
    this.bodycam.uniforms.uResolution.value.set(pw, ph);
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
    if (this.bloom) this.bloom.setSize(pw, ph);
    if (this.prevTarget) this.prevTarget.setSize(pw, ph);
  }

  /** Per-frame driving values from the camera rig and player state. */
  update(dt, ctx = {}) {
    const t = performance.now() / 1000;
    const u = this.bodycam.uniforms;
    u.uTime.value = t;

    // auto gain: cameras ride their AGC, so dark scenes lift and bright ones clamp
    const target = ctx.indoor ? 1.18 : 1.0;
    this.gain += (target - this.gain) * (1 - Math.exp(-1.6 * dt));
    u.uGain.value = this.gain * (S.brightness ?? 1);

    this.damage += ((ctx.damage || 0) - this.damage) * (1 - Math.exp(-6 * dt));
    u.uDamage.value = this.damage;
    this.flash *= Math.exp(-9 * dt);
    if (ctx.flash) this.flash = Math.max(this.flash, ctx.flash);
    u.uFlash.value = this.flash;

    if (this.motion) {
      const yawRate = ctx.yawRate || 0, pitchRate = ctx.pitchRate || 0;
      const amt = clamp((Math.abs(yawRate) + Math.abs(pitchRate)) * 0.09, 0, 1) * (S.motionBlur ? 1 : 0);
      this.motion.uniforms.uAmount.value = amt * 0.7;
      this.offset.set(clamp(yawRate * 0.0055, -0.05, 0.05), clamp(-pitchRate * 0.0055, -0.05, 0.05));
    }
  }

  render() {
    this.composer.render();
    // The smear copy is a full extra render pass — skip it whenever the blur
    // amount is too small to see (standing still, aiming, menus), which is
    // most frames. Doing this unconditionally was costing a full second
    // full-screen pass on every single frame motion blur was enabled.
    if (this.motion && this.prevTarget && this.motion.uniforms.uAmount.value > 0.004) {
      const rt = this.composer.readBuffer;
      const old = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.prevTarget);
      this.copyQuad(rt.texture);
      this.renderer.setRenderTarget(old);
    }
  }

  copyQuad(texture) {
    if (!this._copyScene) {
      this._copyScene = new THREE.Scene();
      this._copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this._copyMat = new THREE.MeshBasicMaterial({ map: texture, depthTest: false, depthWrite: false });
      this._copyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._copyMat);
      this._copyMesh.frustumCulled = false;
      this._copyScene.add(this._copyMesh);
    }
    this._copyMat.map = texture;
    this.renderer.render(this._copyScene, this._copyCam);
  }

  dispose(full = true) {
    this.composer?.dispose?.();
    this.prevTarget?.dispose();
    this.prevTarget = null;
    this.composer = null;
    if (full) {
      this.noise?.dispose();
      this._copyMesh?.geometry.dispose();
      this._copyMat?.dispose();
    }
  }
}
