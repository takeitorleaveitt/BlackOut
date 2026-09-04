// User settings: graphics, audio, controls and gameplay.  Persisted to
// localStorage, exposed as a flat object, and broadcast on change so systems
// can react live (post-FX rebuild, sensitivity, volumes...).

import { bus } from './EventBus.js';

const KEY = 'bp.settings.v1';

export const PRESETS = {
  low: {
    renderScale: 0.72, shadows: 'off', shadowRes: 512, textureQuality: 'low', aa: 'off',
    bloom: false, motionBlur: false, lensDistortion: false,
    lensFlare: false, ssao: false, particles: 0.25, decals: 40, decalLife: 8,
    lights: 'low', fog: true, anisotropy: 1, viewDistance: 0.7, compression: false, dustMotes: false
  },
  medium: {
    renderScale: 0.85, shadows: 'low', shadowRes: 1024, textureQuality: 'medium', aa: 'fxaa',
    bloom: true, motionBlur: false, lensDistortion: false,
    lensFlare: false, ssao: false, particles: 0.4, decals: 90, decalLife: 14,
    lights: 'medium', fog: true, anisotropy: 4, viewDistance: 0.85, compression: false, dustMotes: true
  },
  high: {
    renderScale: 1.0, shadows: 'high', shadowRes: 2048, textureQuality: 'high', aa: 'fxaa',
    bloom: true, motionBlur: false, lensDistortion: false,
    lensFlare: false, ssao: false, particles: 0.6, decals: 160, decalLife: 22,
    lights: 'high', fog: true, anisotropy: 8, viewDistance: 1.0, compression: false, dustMotes: true
  },
  ultra: {
    renderScale: 1.0, shadows: 'ultra', shadowRes: 4096, textureQuality: 'high', aa: 'fxaa',
    bloom: true, motionBlur: false, lensDistortion: false,
    lensFlare: false, ssao: true, particles: 0.8, decals: 260, decalLife: 30,
    lights: 'ultra', fog: true, anisotropy: 16, viewDistance: 1.25, compression: false, dustMotes: true
  }
};

export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'KeyC', sprint: 'ShiftLeft', walk: 'AltLeft',
  reload: 'KeyR', use: 'KeyF', leanLeft: 'KeyQ', leanRight: 'KeyE',
  primary: 'Digit1', secondary: 'Digit2', melee: 'Digit3', inspect: 'KeyI',
  scoreboard: 'Tab', flashlight: 'KeyT', chat: 'KeyY', ping: 'KeyG'
};

const DEFAULTS = {
  // profile
  name: '',
  nameChangedAt: 0,      // last accepted callsign change (one per day)
  // graphics — first-run default is the "low" preset (so a fresh install
  // never opens into a stutter on weak hardware) but with render scale
  // pushed to full resolution, since that's cheap on its own and the
  // preset's other cuts (shadows, particles, effects) do the heavy lifting.
  preset: 'low',
  fov: 84,
  ...PRESETS.low,
  renderScale: 1.0,
  bodycam: 0.35,          // master strength of the bodycam look
  cameraShake: 1.0,
  headBob: 1.0,
  exposure: 1.0,
  brightness: 1.0,
  vignette: 0.30,
  fpsCap: 0,
  showFps: true,
  showPing: true,
  showNetGraph: false,
  showPerf: false,
  // audio
  masterVolume: 0.85,
  weaponVolume: 1.0,
  effectsVolume: 0.9,
  ambienceVolume: 0.7,
  musicVolume: 0.45,
  voiceVolume: 0.8,
  uiVolume: 0.6,
  dynamicRange: 1.0,
  // controls
  sensitivity: 0.85,
  adsSensitivity: 0.72,
  invertY: false,
  rawInput: true,
  toggleAds: false,
  toggleCrouch: false,
  toggleSprint: false,
  binds: { ...DEFAULT_BINDS },
  // loadout (persisted so it survives reloads)
  loadout: {
    primary: 'm4a1',
    secondary: 'glock17',
    primaryAttachments: ['reddot'],
    secondaryAttachments: []
  },
  // network
  serverUrl: '',
  region: 'auto'
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) out[k] = v;
  }
  return out;
}

class SettingsStore {
  constructor() {
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = deepMerge(DEFAULTS, JSON.parse(raw));
    } catch (e) { /* storage may be unavailable; defaults are fine */ }
    if (!this.data.name) this.data.name = randomCallsign();
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }

  get(k) { return this.data[k]; }

  set(k, v) {
    if (this.data[k] === v) return;
    this.data[k] = v;
    this.save();
    bus.emit('settings:changed', k, v);
  }

  setMany(obj) {
    let any = false;
    for (const [k, v] of Object.entries(obj)) {
      if (this.data[k] !== v) { this.data[k] = v; any = true; }
    }
    if (any) { this.save(); bus.emit('settings:changed', '*', obj); }
  }

  applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.assign(this.data, p);
    this.data.preset = name;
    this.save();
    bus.emit('settings:changed', 'preset', name);
  }

  resetBinds() {
    this.data.binds = { ...DEFAULT_BINDS };
    this.save();
    bus.emit('settings:changed', 'binds', this.data.binds);
  }

  reset() {
    this.data = { ...DEFAULTS, name: this.data.name };
    this.save();
    bus.emit('settings:changed', '*', this.data);
  }
}

const ADJ = ['GHOST', 'IRON', 'NIGHT', 'BLACK', 'SILENT', 'RAZOR', 'GREY', 'HOLLOW', 'COLD', 'WOLF', 'STORM', 'ASH'];
const NOUN = ['HOUND', 'VIPER', 'SIX', 'WRAITH', 'ECHO', 'DELTA', 'NINE', 'WARDEN', 'CROW', 'FOX', 'REAPER', 'SABLE'];
export function randomCallsign() {
  return ADJ[(Math.random() * ADJ.length) | 0] + '-' + NOUN[(Math.random() * NOUN.length) | 0];
}

export const settings = new SettingsStore();
export const S = settings.data;
