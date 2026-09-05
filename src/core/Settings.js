// User settings: graphics, audio, controls and gameplay.  Persisted to
// localStorage, exposed as a flat object, and broadcast on change so systems
// can react live (post-FX rebuild, sensitivity, volumes...).

import { bus } from './EventBus.js';
import { DEFAULT_ATTACHMENTS } from '../shared/attachments.js';

const KEY = 'bp.settings.v1';

export const PRESETS = {
  low: {
    renderScale: 0.72, shadows: 'off', shadowRes: 512, textureQuality: 'low', aa: 'off',
    bloom: false, lensDistortion: false,
    lensFlare: false, ssao: false, particles: 0.25, decals: 40, decalLife: 8,
    lights: 'low', fog: true, anisotropy: 1, viewDistance: 0.7, compression: false, dustMotes: false
  },
  medium: {
    renderScale: 0.85, shadows: 'low', shadowRes: 1024, textureQuality: 'medium', aa: 'fxaa',
    bloom: true, lensDistortion: false,
    lensFlare: false, ssao: false, particles: 0.4, decals: 90, decalLife: 14,
    lights: 'medium', fog: true, anisotropy: 4, viewDistance: 0.85, compression: false, dustMotes: true
  },
  high: {
    renderScale: 1.0, shadows: 'high', shadowRes: 2048, textureQuality: 'high', aa: 'fxaa',
    bloom: true, lensDistortion: false,
    lensFlare: false, ssao: false, particles: 0.6, decals: 160, decalLife: 22,
    lights: 'high', fog: true, anisotropy: 8, viewDistance: 1.0, compression: false, dustMotes: true
  },
  ultra: {
    renderScale: 1.0, shadows: 'ultra', shadowRes: 4096, textureQuality: 'high', aa: 'fxaa',
    bloom: true, lensDistortion: false,
    lensFlare: false, ssao: true, particles: 0.8, decals: 260, decalLife: 30,
    lights: 'ultra', fog: true, anisotropy: 16, viewDistance: 1.25, compression: false, dustMotes: true
  }
};

export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'KeyC', sprint: 'ShiftLeft', walk: 'AltLeft',
  reload: 'KeyR', use: 'KeyF', leanLeft: 'KeyQ', leanRight: 'KeyE',
  primary: 'Digit1', secondary: 'Digit2', melee: 'Digit3', inspect: 'KeyI',
  scoreboard: 'Tab', flashlight: 'KeyT', chat: 'KeyY', ping: 'KeyZ'
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
  //
  // `attachments` is the real memory: a map of weapon key -> fitted
  // attachments, so every gun keeps its own optic/muzzle/grip choices when
  // you switch away and come back. The two *Attachments arrays are mirrors of
  // whatever is currently equipped in each slot, kept because the netcode,
  // the sim and the server loadout validator all read them by that name.
  loadout: {
    primary: 'm4a1',
    secondary: 'glock17',
    primaryAttachments: ['reddot'],
    secondaryAttachments: [],
    attachments: { m4a1: ['reddot'] }
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

  // Settings that no longer exist. Saved data is merged OVER the defaults, so
  // without this a returning player keeps a removed feature switched on
  // forever — which is exactly what happened with motion blur: it stayed
  // enabled from an old save and kept ghosting a second copy of the weapon
  // across the screen during ADS, long after it was disabled in every preset.
  static REMOVED_KEYS = [
    'motionBlur', 'filmGrain', 'chromatic', 'weaponSway', 'autoSprint'
  ];

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = deepMerge(DEFAULTS, JSON.parse(raw));
    } catch (e) { /* storage may be unavailable; defaults are fine */ }
    let migrated = false;
    for (const k of SettingsStore.REMOVED_KEYS) {
      if (k in this.data) { delete this.data[k]; migrated = true; }
    }
    // The ping key used to be bound to G by a default that nothing read. Z is
    // where the genre puts it, and a saved binds object would otherwise pin a
    // returning player to a key that never did anything.
    if (this.data.binds && this.data.binds.ping === 'KeyG') {
      this.data.binds.ping = 'KeyZ';
      migrated = true;
    }
    if (!this.data.name) this.data.name = randomCallsign();
    if (this.syncLoadout()) migrated = true;
    if (migrated) this.save();
  }

  /**
   * Reconcile the per-weapon attachment map with the equipped slots.
   *
   * Saves from before the map existed only have primaryAttachments /
   * secondaryAttachments, so those seed the map for whatever is equipped;
   * after that the map is the source of truth and the slot arrays are just
   * mirrors of it. Returns true if anything had to be written back.
   */
  syncLoadout() {
    const l = this.data.loadout;
    if (!l) return false;
    if (!l.attachments || typeof l.attachments !== 'object') l.attachments = {};
    let changed = false;
    for (const [slot, mirror] of [['primary', 'primaryAttachments'], ['secondary', 'secondaryAttachments']]) {
      const key = l[slot];
      if (!key) continue;
      const fitted = Array.isArray(l[mirror]) ? l[mirror] : [];
      if (!Array.isArray(l.attachments[key])) {
        l.attachments[key] = [...fitted];   // first run after the upgrade
        changed = true;
      } else if (!sameList(l.attachments[key], fitted)) {
        l[mirror] = [...l.attachments[key]];
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Attachments remembered for one weapon (a copy — callers may mutate it).
   *
   * A weapon you have never customised falls back to what it ships with, so
   * the M40 arrives scoped. Once you have set its fitting even to nothing at
   * all, the stored array wins — an empty array is still an array, so taking
   * the scope off keeps it off across sessions.
   */
  attachmentsFor(weaponKey) {
    const map = this.data.loadout?.attachments || {};
    if (Array.isArray(map[weaponKey])) return [...map[weaponKey]];
    return [...(DEFAULT_ATTACHMENTS[weaponKey] || [])];
  }

  /**
   * Equip a weapon into a slot, restoring whatever was last fitted to it.
   * This is what makes attachments survive a weapon switch.
   */
  equipWeapon(slot, weaponKey) {
    const l = this.data.loadout;
    const mirror = slot === 'primary' ? 'primaryAttachments' : 'secondaryAttachments';
    l[slot] = weaponKey;
    l[mirror] = this.attachmentsFor(weaponKey);
    this.save();
    bus.emit('settings:changed', 'loadout', l);
  }

  /** Fit a set of attachments to a weapon and remember them for next time. */
  setAttachments(slot, weaponKey, list) {
    const l = this.data.loadout;
    const mirror = slot === 'primary' ? 'primaryAttachments' : 'secondaryAttachments';
    (l.attachments ||= {})[weaponKey] = [...list];
    if (l[slot] === weaponKey) l[mirror] = [...list];
    this.save();
    bus.emit('settings:changed', 'loadout', l);
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
    this.data = { ...DEFAULTS, name: this.data.name, loadout: { ...DEFAULTS.loadout, attachments: { ...DEFAULTS.loadout.attachments } } };
    this.save();
    bus.emit('settings:changed', '*', this.data);
  }
}

function sameList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const x = [...a].sort(); const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

const ADJ = ['GHOST', 'IRON', 'NIGHT', 'BLACK', 'SILENT', 'RAZOR', 'GREY', 'HOLLOW', 'COLD', 'WOLF', 'STORM', 'ASH'];
const NOUN = ['HOUND', 'VIPER', 'SIX', 'WRAITH', 'ECHO', 'DELTA', 'NINE', 'WARDEN', 'CROW', 'FOX', 'REAPER', 'SABLE'];
export function randomCallsign() {
  return ADJ[(Math.random() * ADJ.length) | 0] + '-' + NOUN[(Math.random() * NOUN.length) | 0];
}

export const settings = new SettingsStore();
export const S = settings.data;
