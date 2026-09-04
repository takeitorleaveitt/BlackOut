// SETTINGS: graphics, bodycam, audio, controls and gameplay — everything the
// brief asks to be adjustable, with live preview and presets for weak machines.

import { el, clear, button, header, footer, toggle, slider, settingRow } from '../UI.js';
import { audio } from '../../audio/AudioEngine.js';
import { S, settings, PRESETS, DEFAULT_BINDS } from '../../core/Settings.js';
import { Input } from '../../core/Input.js';

const TABS = ['GRAPHICS', 'BODYCAM', 'AUDIO', 'CONTROLS', 'GAMEPLAY'];

const NAME_MIN = 3;
const NAME_MAX = 17;
const NAME_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** null when acceptable, otherwise the reason to show the player. */
export function validateName(v) {
  if (v.length < NAME_MIN) return `TOO SHORT — MIN ${NAME_MIN}`;
  if (v.length > NAME_MAX) return `TOO LONG — MAX ${NAME_MAX}`;
  if (!/^[A-Z0-9 _-]+$/.test(v)) return 'LETTERS, NUMBERS, - _ ONLY';
  return null;
}

/** Milliseconds remaining before the callsign may be changed again. */
export function nameChangeCooldownMs() {
  const last = S.nameChangedAt || 0;
  if (!last) return 0;
  return Math.max(0, NAME_COOLDOWN_MS - (Date.now() - last));
}

export function createSettings(game) {
  let ui = null, pane = null, active = 'GRAPHICS';

  const set = (k, v) => { settings.set(k, v); };

  function sliderRow(label, key, min, max, step, fmt, hint) {
    const s = slider(S[key], min, max, step, (v) => set(key, v), fmt);
    return settingRow(label, s.input, s.val, hint);
  }

  function toggleRow(label, key, hint, onChange) {
    return settingRow(label, toggle(S[key], (v) => { set(key, v); onChange?.(v); }), el('div.val'), hint);
  }

  function selectRow(label, key, options, hint) {
    const sel = el('select', {
      onchange: (e) => { audio.ui('tick'); set(key, e.target.value); }
    }, ...options.map(([v, t]) => el('option', { value: v, selected: String(S[key]) === String(v) }, t)));
    return settingRow(label, sel, el('div.val'), hint);
  }

  function graphics() {
    const presetRow = el('div.grid.c4', { style: { marginBottom: '20px' } },
      ...Object.keys(PRESETS).map((p) => el('div.card' + (S.preset === p ? '.sel' : ''), {
        onclick: () => {
          audio.ui('accept');
          settings.applyPreset(p);
          render();
        },
        onmouseenter: () => audio.ui('hover')
      }, el('div.n', p.toUpperCase()), el('div.d', presetBlurb(p)))));

    return el('div',
      el('h3.sec', 'Quality preset'), presetRow,
      el('h3.sec', 'Renderer'),
      sliderRow('Render scale', 'renderScale', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`,
        'Internal resolution. The single biggest performance lever.'),
      selectRow('Shadows', 'shadows', [['off', 'OFF'], ['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']]),
      selectRow('Shadow resolution', 'shadowRes', [[512, '512'], [1024, '1024'], [2048, '2048'], [4096, '4096']]),
      selectRow('Texture quality', 'textureQuality', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']],
        'Regenerates the procedural material set.'),
      selectRow('Anti-aliasing', 'aa', [['off', 'OFF'], ['fxaa', 'FXAA']]),
      selectRow('Anisotropic filtering', 'anisotropy', [[1, 'OFF'], [4, '4x'], [8, '8x'], [16, '16x']]),
      selectRow('Dynamic lights', 'lights', [['low', 'LOW (4)'], ['medium', 'MEDIUM (8)'], ['high', 'HIGH (14)'], ['ultra', 'ULTRA (22)']]),
      sliderRow('View distance', 'viewDistance', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`),
      sliderRow('Particle density', 'particles', 0.2, 1.5, 0.1, (v) => `${Math.round(v * 100)}%`),
      sliderRow('Bullet decals', 'decals', 20, 260, 10, (v) => String(v)),
      sliderRow('Decal lifetime', 'decalLife', 4, 40, 1, (v) => `${v}s`),
      toggleRow('Fog', 'fog'),
      toggleRow('Dust motes', 'dustMotes'),
      el('h3.sec', 'Frame pacing'),
      selectRow('FPS limit', 'fpsCap', [[0, 'UNLIMITED'], [30, '30'], [60, '60'], [75, '75'], [120, '120'], [144, '144'], [240, '240']]));
  }

  function bodycam() {
    return el('div',
      el('h3.sec', 'Camera'),
      sliderRow('Field of view', 'fov', 65, 110, 1, (v) => `${v}°`),
      sliderRow('Bodycam intensity', 'bodycam', 0, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`,
        'Master strength of the whole body-worn camera look.'),
      sliderRow('Camera shake', 'cameraShake', 0, 2, 0.05, (v) => `${Math.round(v * 100)}%`),
      sliderRow('Head bob', 'headBob', 0, 2, 0.05, (v) => `${Math.round(v * 100)}%`),
      el('h3.sec', 'Post-processing'),
      toggleRow('Bloom', 'bloom'),
      toggleRow('Motion blur', 'motionBlur'),
      toggleRow('Lens distortion', 'lensDistortion', 'The fisheye barrel of a wide-angle body camera.'),
      toggleRow('Lens glare', 'lensFlare'),
      toggleRow('Compression artefacts', 'compression', 'Macroblocking and scanlines from a cheap recorder.'),
      sliderRow('Vignette', 'vignette', 0, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`),
      sliderRow('Exposure', 'exposure', 0.5, 1.8, 0.05, (v) => v.toFixed(2)),
      sliderRow('Brightness', 'brightness', 0.6, 1.6, 0.05, (v) => v.toFixed(2)),
      el('h3.sec', 'Telemetry'),
      toggleRow('FPS counter', 'showFps'),
      toggleRow('Ping counter', 'showPing'),
      toggleRow('Net graph', 'showNetGraph', 'Packet loss, jitter and bandwidth.'),
      toggleRow('Performance stats', 'showPerf', 'Draw calls, triangles, frame times.'));
  }

  function audioTab() {
    return el('div',
      el('h3.sec', 'Levels'),
      sliderRow('Master', 'masterVolume', 0, 1, 0.01, pct),
      sliderRow('Weapons', 'weaponVolume', 0, 1, 0.01, pct),
      sliderRow('Effects', 'effectsVolume', 0, 1, 0.01, pct),
      sliderRow('Ambience', 'ambienceVolume', 0, 1, 0.01, pct),
      sliderRow('Voice chat', 'voiceVolume', 0, 1, 0.01, pct),
      sliderRow('Music', 'musicVolume', 0, 1, 0.01, pct),
      sliderRow('Interface', 'uiVolume', 0, 1, 0.01, pct),
      el('div.mt16', button('TEST GUNSHOT', () => game.testGunshot())),
      el('p.sub.mt16', { style: { textTransform: 'none', letterSpacing: '.06em' } },
        'Every sound is synthesised in the browser — the report you hear indoors is convolved with an impulse response generated for that space.'));
  }

  function controls() {
    const wrap = el('div');
    wrap.appendChild(el('h3.sec', 'Aim'));
    wrap.appendChild(sliderRow('Mouse sensitivity', 'sensitivity', 0.05, 3, 0.01, (v) => v.toFixed(2)));
    wrap.appendChild(sliderRow('ADS sensitivity', 'adsSensitivity', 0.1, 1.5, 0.01, (v) => v.toFixed(2)));
    wrap.appendChild(toggleRow('Invert vertical', 'invertY'));
    wrap.appendChild(toggleRow('Raw input', 'rawInput', 'Bypasses OS pointer acceleration where supported.'));
    wrap.appendChild(el('h3.sec', 'Behaviour'));
    wrap.appendChild(toggleRow('Toggle ADS', 'toggleAds'));
    wrap.appendChild(toggleRow('Toggle crouch', 'toggleCrouch'));
    wrap.appendChild(toggleRow('Toggle sprint', 'toggleSprint'));

    wrap.appendChild(el('h3.sec', 'Key bindings'));
    const grid = el('div.grid.c2');
    for (const [action, code] of Object.entries(S.binds)) {
      const label = action.replace(/([A-Z])/g, ' $1').toUpperCase();
      const key = el('div.keybind', game.input.bindLabel(code));
      key.addEventListener('click', () => {
        key.classList.add('listening');
        key.textContent = 'PRESS A KEY';
        audio.ui('tick');
        game.input.captureNext((newCode) => {
          key.classList.remove('listening');
          S.binds[action] = newCode;
          settings.save();
          key.textContent = game.input.bindLabel(newCode);
          audio.ui('accept');
        });
      });
      grid.appendChild(el('div.setting', { style: { gridTemplateColumns: '1fr 120px' } },
        el('label', label), key));
    }
    wrap.appendChild(grid);
    wrap.appendChild(el('div.mt16', button('RESET BINDINGS', () => { settings.resetBinds(); render(); })));
    return wrap;
  }

  function gameplay() {
    // Callsigns are 3-17 characters and may only be changed once a day. The
    // day limit is enforced against the timestamp of the last accepted change;
    // uniqueness is checked by the server when joining, since only it can see
    // the other players.
    const nameStatus = el('div.val');
    const nameInput = el('input', {
      type: 'text', value: S.name, maxlength: 17,
      onchange: (e) => {
        const v = e.target.value.trim().toUpperCase().slice(0, 17);
        const err = validateName(v);
        if (err) {
          nameStatus.textContent = err;
          e.target.value = S.name;
          audio.ui('deny');
          return;
        }
        const wait = nameChangeCooldownMs();
        if (wait > 0) {
          const hrs = Math.ceil(wait / 3600000);
          nameStatus.textContent = `LOCKED — ${hrs}H LEFT`;
          e.target.value = S.name;
          audio.ui('deny');
          return;
        }
        set('name', v);
        set('nameChangedAt', Date.now());
        e.target.value = v;
        nameStatus.textContent = 'SAVED — LOCKED FOR 24H';
        game.onNameChanged();
      }
    });
    {
      const wait = nameChangeCooldownMs();
      nameStatus.textContent = wait > 0
        ? `LOCKED — ${Math.ceil(wait / 3600000)}H LEFT`
        : '3-17 CHARACTERS · ONE CHANGE PER DAY';
    }
    const urlInput = el('input', {
      type: 'text', value: S.serverUrl, placeholder: 'auto (same host)',
      onchange: (e) => set('serverUrl', e.target.value.trim())
    });
    return el('div',
      el('h3.sec', 'Profile'),
      settingRow('Callsign', nameInput, nameStatus),
      el('h3.sec', 'Network'),
      settingRow('Server URL', urlInput, el('div.val'), 'Leave blank to use the server this page came from.'),
      selectRow('Preferred region', 'region', [['auto', 'AUTO'], ...['eu-west', 'eu-north', 'na-east', 'na-west', 'sa-east', 'ap-se', 'ap-ne', 'oce'].map((r) => [r, r.toUpperCase()])]),
      el('div.divider'),
      el('div.flex.gap8',
        button('RESET ALL SETTINGS', () => {
          settings.reset();
          render();
          ui.toast('Settings restored to defaults');
        }, { cls: 'danger' })));
  }

  function render() {
    clear(pane);
    const tabs = el('div.tabs', ...TABS.map((t) => el('div.tab' + (t === active ? '.active' : ''), {
      onclick: () => { active = t; audio.ui('click'); render(); },
      onmouseenter: () => audio.ui('hover')
    }, t)));
    pane.appendChild(tabs);
    pane.appendChild(
      active === 'GRAPHICS' ? graphics()
        : active === 'BODYCAM' ? bodycam()
          : active === 'AUDIO' ? audioTab()
            : active === 'CONTROLS' ? controls()
              : gameplay());
  }

  return {
    build(node, _ui) {
      ui = _ui;
      pane = el('div.pane', { style: { flex: '1', maxWidth: '980px', margin: '0 auto', width: '100%' } });
      node.appendChild(header('SETTINGS'));
      node.appendChild(el('div.body', pane));
      node.appendChild(footer(
        [button('BACK', () => ui.back('main'))],
        [button('DONE', () => ui.back('main'), { cls: 'primary' })]));
      render();
    },
    enter() { render(); }
  };
}

const pct = (v) => `${Math.round(v * 100)}%`;

function presetBlurb(p) {
  return {
    low: 'Integrated graphics. No shadows or post.',
    medium: 'Laptop dGPU. Core bodycam look on.',
    high: 'Desktop GPU. Everything except SSAO.',
    ultra: 'Full effect stack at native resolution.'
  }[p] || '';
}
