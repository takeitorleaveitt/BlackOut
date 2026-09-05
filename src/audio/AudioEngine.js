// Spatial audio engine.
//
// Buses (weapons / effects / ambience / voice / music / UI) feed a master
// compressor.  Positional sounds are panned with HRTF, attenuated by distance,
// low-passed when geometry blocks the line of sight, and fed to a convolution
// reverb whose impulse response follows the space the listener is standing in —
// so the same rifle sounds completely different in a stairwell and a car park.

import * as THREE from 'three';
import {
  makeImpulse, makeGunshot, makeBulletCrack, makeWhizz, makeImpact, makeFootstep,
  makeCasing, makeMech, makeBreath, makePain, makeUi, makeAmbience, makeMenuBed,
  makeSwing, spaceLevel
} from './Synth.js';
import { S } from '../core/Settings.js';
import { clamp, rand, SURFACE } from '../shared/constants.js';

const MAX_VOICES = 40;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.voices = 0;
    this.space = 'outdoor';
    this.world = null;
    this.listenerPos = new THREE.Vector3();
    this.ambienceNodes = [];
    this.muffle = 0;
    this._lastFootstep = 0;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) return this.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));

    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 4.5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    // global muffle (concussion, death, menus over gameplay)
    this.muffleFilter = ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass';
    this.muffleFilter.frequency.value = 22000;
    this.master.connect(this.muffleFilter);
    this.muffleFilter.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.bus = {};
    for (const name of ['weapons', 'effects', 'ambience', 'voice', 'music', 'ui']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.bus[name] = g;
    }

    // reverb: dry buses stay direct, wet goes through the convolver
    this.convolver = ctx.createConvolver();
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.6;
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.master);
    this.setSpace('outdoor');

    // pre-render the common buffers so the first shot never stutters
    this.warm();
    this.applyVolumes();
    this.ready = true;
    return true;
  }

  warm() {
    const c = this.ctx;
    makeImpulse(c, 'outdoor');
    makeImpulse(c, 'hall');
    makeImpulse(c, 'room');
    for (const k of ['select', 'magOut', 'magIn', 'boltRelease', 'dryfire']) makeMech(c, k, 0);
    for (const k of ['hover', 'click', 'back', 'open', 'accept']) makeUi(c, k);
    makeFootstep(c, 'concrete', 0);
    makeBulletCrack(c, 0);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return !!this.ctx;
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  applyVolumes() {
    if (!this.ready && !this.ctx) return;
    const m = S.masterVolume ?? 0.85;
    this.master.gain.value = m;
    this.bus.weapons.gain.value = (S.weaponVolume ?? 1) * 0.9;
    this.bus.effects.gain.value = (S.effectsVolume ?? 0.9);
    this.bus.ambience.gain.value = (S.ambienceVolume ?? 0.7) * 0.52;
    this.bus.voice.gain.value = (S.voiceVolume ?? 0.8);
    this.bus.music.gain.value = (S.musicVolume ?? 0.45) * 0.7;
    this.bus.ui.gain.value = (S.uiVolume ?? 0.6);
  }

  setWorld(world) { this.world = world; }

  setSpace(key) {
    if (!this.ctx || key === this.space) return;
    this.space = key;
    try {
      this.convolver.buffer = makeImpulse(this.ctx, key);
      this.reverbGain.gain.setTargetAtTime(spaceLevel(key) * 0.85, this.ctx.currentTime, 0.35);
    } catch (e) { /* ignore */ }
  }

  /** Global muffling 0..1 (hit concussion, death, being in the menu). */
  setMuffle(v, immediate = false) {
    if (!this.ctx) return;
    this.muffle = v;
    const f = 22000 * Math.pow(1 - clamp(v, 0, 0.98), 2.2) + 320;
    if (immediate) this.muffleFilter.frequency.value = f;
    else this.muffleFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
  }

  updateListener(camera, dt) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    camera.getWorldPosition(this.listenerPos);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      const k = 0.02;
      l.positionX.setTargetAtTime(this.listenerPos.x, t, k);
      l.positionY.setTargetAtTime(this.listenerPos.y, t, k);
      l.positionZ.setTargetAtTime(this.listenerPos.z, t, k);
      l.forwardX.setTargetAtTime(f.x, t, k);
      l.forwardY.setTargetAtTime(f.y, t, k);
      l.forwardZ.setTargetAtTime(f.z, t, k);
      l.upX.setTargetAtTime(u.x, t, k);
      l.upY.setTargetAtTime(u.y, t, k);
      l.upZ.setTargetAtTime(u.z, t, k);
    } else {
      l.setPosition(this.listenerPos.x, this.listenerPos.y, this.listenerPos.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  /** How much geometry sits between the listener and a point (0..1). */
  occlusion(x, y, z) {
    if (!this.world) return 0;
    const lp = this.listenerPos;
    const dx = x - lp.x, dy = y - lp.y, dz = z - lp.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.6) return 0;
    const hit = this.world.raycast(lp.x, lp.y, lp.z, dx / d, dy / d, dz / d, d - 0.3);
    if (!hit) return 0;
    // thicker / denser cover muffles more
    const t = clamp(hit.thickness / 0.6, 0.25, 1);
    return clamp(0.45 + t * 0.5, 0, 0.95);
  }

  /**
   * Play a buffer.
   * opts: { pos, bus, volume, rate, reverb, refDistance, maxDistance,
   *         rolloff, occlude, loop, delay }
   */
  play(buffer, opts = {}) {
    if (!this.ctx || !buffer) return null;
    if (this.voices > MAX_VOICES && !opts.important) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.rate ?? 1;
    src.loop = !!opts.loop;

    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    let node = src;
    node.connect(gain);
    node = gain;

    let out = node;
    if (opts.pos) {
      const [x, y, z] = opts.pos;
      const occ = opts.occlude === false ? 0 : this.occlusion(x, y, z);
      if (occ > 0.02) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 20000 * Math.pow(1 - occ, 2.6) + 260;
        const g2 = ctx.createGain();
        g2.gain.value = 1 - occ * 0.55;
        out.connect(f); f.connect(g2);
        out = g2;
      }
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = opts.refDistance ?? 3.5;
      p.maxDistance = opts.maxDistance ?? 220;
      p.rolloffFactor = opts.rolloff ?? 1.15;
      p.positionX ? (p.positionX.value = x, p.positionY.value = y, p.positionZ.value = z)
        : p.setPosition(x, y, z);
      out.connect(p);
      out = p;
    }

    const busNode = this.bus[opts.bus || 'effects'];
    out.connect(busNode);

    const wet = opts.reverb ?? 0.35;
    if (wet > 0.01) {
      const w = ctx.createGain();
      w.gain.value = wet;
      out.connect(w);
      w.connect(this.convolver);
    }

    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(ctx.currentTime + (opts.delay || 0));
    return { src, gain };
  }

  /**
   * Pre-synthesise the sounds a match is about to need. Every make* call is
   * cache-keyed and cheap on a hit, but the *first* call for a given
   * (sound, variant) pair does real synthesis work — without this, that
   * first-time cost landed randomly during play (the first footstep on a
   * surface, the first shot of a weapon variant), reading as a stutter for
   * no obvious reason. Spread across idle callbacks so warming the cache
   * doesn't itself cause the hitch it's trying to avoid.
   */
  warmup(weaponDefs = []) {
    if (!this.ctx) return;
    const jobs = [];
    for (const surface of Object.values(SURFACE)) {
      jobs.push(() => makeFootstep(this.ctx, surface, 0));
      jobs.push(() => makeImpact(this.ctx, surface, 0));
      jobs.push(() => makeCasing(this.ctx, surface, false, 0));
    }
    for (const def of weaponDefs) {
      if (!def?.audio || def.melee) continue;
      jobs.push(() => makeGunshot(this.ctx, def.audio, 0, {}));
      jobs.push(() => makeGunshot(this.ctx, def.audio, 0, { suppressed: true }));
    }
    jobs.push(() => makeSwing(this.ctx, 0));
    jobs.push(() => makeBulletCrack(this.ctx, 0), () => makeWhizz(this.ctx, 0));
    jobs.push(() => makeBreath(this.ctx, 'normal', 0), () => makeBreath(this.ctx, 'heavy', 0));
    jobs.push(() => makePain(this.ctx, 0));
    jobs.push(() => makeMech(this.ctx, 'select', 0), () => makeMech(this.ctx, 'magOut', 0), () => makeMech(this.ctx, 'magIn', 0));

    const runNext = (deadline) => {
      while (jobs.length && (!deadline || deadline.timeRemaining() > 2)) {
        try { jobs.shift()(); } catch (e) { /* never let a warmup miss break the match */ }
      }
      if (jobs.length) schedule(runNext);
    };
    const schedule = window.requestIdleCallback
      ? (fn) => window.requestIdleCallback(fn, { timeout: 200 })
      : (fn) => setTimeout(() => fn(null), 16);
    schedule(runNext);
  }

  // -------------------------------------------------------------------------
  // game sounds
  // -------------------------------------------------------------------------
  gunshot(profile, pos, opts = {}) {
    if (!this.ctx) return;
    const variant = (Math.random() * 4) | 0;
    const suppressed = !!opts.suppressed;
    const own = !!opts.own;
    const buf = makeGunshot(this.ctx, profile, variant, { suppressed });
    const lvl = (profile.level ?? 1) * (own ? 1.0 : 0.92);
    const indoor = this.space !== 'outdoor' && this.space !== 'forest';
    this.play(buf, {
      pos: own ? null : pos,
      bus: 'weapons',
      volume: lvl * (own ? 0.85 : 1.0),
      rate: rand(0.97, 1.03),
      reverb: (indoor ? 0.85 : 0.30) * (suppressed ? 0.4 : 1),
      refDistance: 6,
      maxDistance: 300,
      rolloff: suppressed ? 1.9 : 0.85,
      important: true
    });
    // tail slap: a delayed, filtered copy that reads as the report leaving the room
    if (!suppressed) {
      const tail = makeGunshot(this.ctx, profile, (variant + 1) % 4, { distant: true });
      this.play(tail, {
        pos: own ? null : pos,
        bus: 'weapons',
        volume: lvl * (indoor ? 0.32 : 0.18),
        rate: rand(0.94, 1.0),
        reverb: indoor ? 0.9 : 0.5,
        delay: indoor ? 0.055 : 0.10,
        refDistance: 10, rolloff: 0.6, maxDistance: 400
      });
    }
  }

  /** A shot heard from far away — rolling, low-passed, no mechanical detail. */
  distantShot(profile, pos, distance) {
    if (!this.ctx) return;
    const buf = makeGunshot(this.ctx, profile, (Math.random() * 4) | 0, { distant: true });
    this.play(buf, {
      pos, bus: 'weapons',
      volume: clamp(1 - distance / 260, 0.05, 0.8) * (profile.level ?? 1),
      rate: rand(0.9, 1.02),
      reverb: 0.55,
      delay: Math.min(0.7, distance / 340),
      refDistance: 30, rolloff: 0.5, maxDistance: 400
    });
  }

  bulletCrack(pos, close = 1) {
    if (!this.ctx) return;
    this.play(makeBulletCrack(this.ctx, (Math.random() * 3) | 0), {
      pos, bus: 'effects', volume: 0.55 * close, rate: rand(0.9, 1.15),
      reverb: 0.25, refDistance: 2.5, rolloff: 2.4, maxDistance: 40, important: true
    });
    this.play(makeWhizz(this.ctx, (Math.random() * 3) | 0), {
      pos, bus: 'effects', volume: 0.35 * close, rate: rand(0.85, 1.2),
      reverb: 0.15, refDistance: 2.5, rolloff: 2.6, maxDistance: 36, delay: 0.012
    });
  }

  impact(surface, pos, energy = 1) {
    if (!this.ctx) return;
    this.play(makeImpact(this.ctx, surface, (Math.random() * 4) | 0), {
      pos, bus: 'effects', volume: 0.65 * clamp(energy, 0.3, 1.2), rate: rand(0.88, 1.14),
      reverb: 0.4, refDistance: 3, rolloff: 1.5, maxDistance: 70
    });
  }

  footstep(surface, pos, volume = 1, own = false) {
    if (!this.ctx) return;
    this.play(makeFootstep(this.ctx, surface, (Math.random() * 4) | 0), {
      pos: own ? null : pos,
      // Your own steps sit well back in the mix — they are constant, so at the
      // old level they dominated everything you actually needed to hear.
      // Enemy steps stay loud enough to locate, which is the only footstep
      // that matters competitively.
      bus: 'effects',
      volume: (own ? 0.14 : 0.52) * volume,
      rate: rand(0.9, 1.12),
      // Your own footfalls are exempt from the voice cap. They are the one
      // sound whose absence is immediately obvious — a firefight would fill
      // the 40 voices with shots, casings and impacts and silently swallow
      // them, which reads as "the footsteps sometimes don't play".
      important: !!own,
      reverb: 0.3, refDistance: 2.5, rolloff: 2.0, maxDistance: 42
    });
    if (Math.random() < (own ? 0.18 : 0.2)) {
      this.play(makeMech(this.ctx, 'cloth', (Math.random() * 4) | 0), {
        pos: own ? null : pos, bus: 'effects',
        volume: (own ? 0.08 : 0.22) * volume, rate: rand(0.85, 1.2),
        reverb: 0.2, refDistance: 2, rolloff: 2.4, maxDistance: 26
      });
    }
  }

  casing(surface, pos, isShell = false) {
    if (!this.ctx) return;
    this.play(makeCasing(this.ctx, surface || 'concrete', isShell, (Math.random() * 4) | 0), {
      pos, bus: 'effects', volume: 0.42, rate: rand(0.88, 1.18),
      reverb: 0.45, refDistance: 1.6, rolloff: 2.6, maxDistance: 22
    });
  }

  swing(pos = null, volume = 1) {
    if (!this.ctx) return;
    this.play(makeSwing(this.ctx, (Math.random() * 4) | 0), {
      pos, bus: 'weapons', volume: 0.85 * volume, rate: rand(0.92, 1.1),
      reverb: 0.2, refDistance: 2, rolloff: 2.2, maxDistance: 20
    });
  }

  mech(kind, pos = null, volume = 1) {
    if (!this.ctx) return;
    this.play(makeMech(this.ctx, kind, (Math.random() * 4) | 0), {
      pos, bus: 'weapons', volume: 0.75 * volume, rate: rand(0.94, 1.07),
      reverb: 0.25, refDistance: 2, rolloff: 2.2, maxDistance: 26
    });
  }

  breath(heavy = false, volume = 1) {
    if (!this.ctx) return;
    this.play(makeBreath(this.ctx, heavy ? 'heavy' : 'normal', (Math.random() * 3) | 0), {
      bus: 'voice', volume: (heavy ? 0.5 : 0.24) * volume, rate: rand(0.94, 1.08), reverb: 0.1
    });
  }

  pain(pos = null, volume = 1) {
    if (!this.ctx) return;
    this.play(makePain(this.ctx, (Math.random() * 4) | 0), {
      pos, bus: 'voice', volume: 0.7 * volume, rate: rand(0.92, 1.1),
      reverb: 0.35, refDistance: 4, rolloff: 1.6, maxDistance: 44
    });
  }

  ui(kind) {
    if (!this.ctx) return;
    this.play(makeUi(this.ctx, kind), { bus: 'ui', volume: 0.8, reverb: 0.04 });
  }

  // -------------------------------------------------------------------------
  // ambience
  // -------------------------------------------------------------------------
  startAmbience(list) {
    this.stopAmbience();
    if (!this.ctx || !list) return;
    for (const a of list) {
      const buf = makeAmbience(this.ctx, a.sound);
      const v = this.play(buf, {
        pos: a.p, loop: true, bus: 'ambience', volume: 0,
        reverb: 0.12, refDistance: a.radius * 0.35, rolloff: 1.0,
        maxDistance: a.radius * 2.4, occlude: false, important: true
      });
      if (v) {
        v.gain.gain.setTargetAtTime(a.volume, this.ctx.currentTime, 1.2);
        this.ambienceNodes.push(v);
      }
    }
  }

  stopAmbience() {
    for (const v of this.ambienceNodes) {
      try {
        v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
        v.src.stop(this.ctx.currentTime + 0.8);
      } catch (e) { /* already stopped */ }
    }
    this.ambienceNodes.length = 0;
  }

  startMenuMusic() {
    if (!this.ctx || this.menuMusic) return;
    const v = this.play(makeMenuBed(this.ctx), {
      loop: true, bus: 'music', volume: 0, reverb: 0.25, important: true
    });
    if (v) {
      v.gain.gain.setTargetAtTime(0.9, this.ctx.currentTime, 2.0);
      this.menuMusic = v;
    }
  }

  stopMenuMusic() {
    if (!this.menuMusic) return;
    try {
      this.menuMusic.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.7);
      this.menuMusic.src.stop(this.ctx.currentTime + 2.4);
    } catch (e) { /* ignore */ }
    this.menuMusic = null;
  }
}

export const audio = new AudioEngine();
