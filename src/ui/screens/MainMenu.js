// Main menu: PLAY / FRIENDS / LOADOUT / SETTINGS / SERVERS / QUIT.
// The 3D scene keeps rendering behind it, so the menu is literally a bodycam
// feed of a live map with the interface overlaid.

import { el, button, header } from '../UI.js';
import { audio } from '../../audio/AudioEngine.js';
import { S, settings } from '../../core/Settings.js';
import { account } from '../../core/Account.js';
import { MAP_INFO } from '../../shared/maps/index.js';
import { PRIMARIES, SECONDARIES } from '../../shared/weapons.js';

const ITEMS = [
  { key: 'play', label: 'PLAY', desc: 'DEPLOY TO A MATCH' },
  { key: 'friends', label: 'FRIENDS', desc: 'SQUAD & INVITES' },
  { key: 'loadout', label: 'LOADOUT', desc: 'WEAPONS & ATTACHMENTS' },
  { key: 'settings', label: 'SETTINGS', desc: 'GRAPHICS · AUDIO · CONTROLS' },
  { key: 'servers', label: 'SERVERS', desc: 'BROWSE ACTIVE MATCHES' },
  { key: 'quit', label: 'QUIT', desc: 'END SESSION' }
];

/**
 * Cheat console. Type a code and press enter to toggle it.
 *
 * These are deliberately restricted to offline play against bots. The game
 * has an online mode against real people, and Quick Match and Standard are
 * player-only playlists by design — shipping a working aimbot into those
 * would be building a tool for cheating against other players rather than a
 * cheat code for your own game. Offline, they do exactly what they say.
 */
function codeBox(game) {
  const status = el('span.dim', { style: { minWidth: '150px', fontSize: '11px' } }, 'CODE');
  const input = el('input', {
    type: 'text', placeholder: 'ENTER CODE',
    style: { width: '150px', textTransform: 'uppercase' },
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const code = String(e.target.value || '').trim().toUpperCase();
      e.target.value = '';
      const res = game.applyCheatCode(code);
      status.textContent = res.message;
      status.style.color = res.ok ? 'var(--accent, #c8ff4d)' : '';
      audio.ui(res.ok ? 'accept' : 'deny');
    }
  });
  return el('div.flex.gap8.center', input, status);
}

export function createMainMenu(game) {
  let ui = null;
  let clock = null;
  let sel = 0;
  let items = [];

  return {
    build(node, _ui) {
      ui = _ui;
      const nav = el('div.menu-left');
      items = ITEMS.map((it, i) => {
        const row = el('div.menu-item', {
          onmouseenter: () => { audio.ui('hover'); select(i); },
          onclick: () => activate(it.key)
        },
          el('span.idx', String(i + 1).padStart(2, '0')),
          el('span.lbl', it.label),
          el('span.desc', it.desc));
        nav.appendChild(row);
        return row;
      });

      this.tcNode = el('span', '00:00:00');
      // The callsign block doubles as the profile button: level on the face
      // of it, full record behind a click.
      const profileBtn = el('div', {
        style: { cursor: 'pointer' },
        onclick: () => { audio.ui('accept'); _ui.show('profile'); },
        onmouseenter: () => audio.ui('hover'),
        title: 'View profile'
      }, el('b', 'OPERATOR '), S.name, el('span.dim', `  ·  LVL ${account.level}`));
      const version = el('div.menu-badge',
        el('div', el('b', 'FEED '), this.tcNode),
        el('div', el('b', 'BUILD '), '1.0.0 · WEBGL2'),
        profileBtn,
        el('div', el('b', 'MAPS '), String(MAP_INFO.length), ' · ', el('b', 'WEAPONS '), String(PRIMARIES.length + SECONDARIES.length)));

      const right = el('div.menu-right', version);

      node.appendChild(header('MAIN MENU', el('span', el('b', 'CH '), '01')));
      node.appendChild(el('div.body', nav, right));
      node.appendChild(el('div.ftr',
        el('div.telemetry',
          el('span', el('b', '↑↓ '), 'NAVIGATE'),
          el('span', el('b', 'ENTER '), 'SELECT'),
          el('span', el('b', 'ESC '), 'BACK')),
        // Quick Match and Training live on the PLAY screen now; this slot is
        // the cheat console instead. Codes: WALLS, AUTO, AIMBOT.
        el('div.flex.gap8', codeBox(game))));

      select(0);
    },

    enter() {
      audio.startMenuMusic();
      game.setMenuCamera(true);
      const tick = () => {
        if (!this.tcNode) return;
        const d = new Date();
        this.tcNode.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()]
          .map((v) => String(v).padStart(2, '0')).join(':');
      };
      tick();
      clock = setInterval(tick, 1000);
      window.addEventListener('keydown', onKey);
    },

    exit() {
      clearInterval(clock);
      window.removeEventListener('keydown', onKey);
    },

    refresh() {
      // Rebuild the callsign row wholesale. It used to poke at lastChild,
      // which now belongs to the level chip rather than the name.
      const badge = document.querySelector('#screen-main .menu-badge');
      const row = badge?.children[2];
      if (!row) return;
      row.textContent = '';
      row.appendChild(el('b', 'OPERATOR '));
      row.appendChild(document.createTextNode(S.name));
      row.appendChild(el('span.dim', `  ·  LVL ${account.level}`));
    }
  };

  function select(i) {
    sel = (i + ITEMS.length) % ITEMS.length;
    items.forEach((n, k) => n.classList.toggle('sel', k === sel));
  }

  function activate(key) {
    switch (key) {
      case 'play': ui.show('play'); break;
      case 'friends': ui.show('friends'); break;
      case 'loadout': ui.show('loadout'); break;
      case 'settings': ui.show('settings'); break;
      case 'servers': ui.show('browser'); break;
      case 'quit': game.quit(); break;
      default: break;
    }
  }

  function onKey(e) {
    if (ui.current?.name !== 'main') return;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { audio.ui('hover'); select(sel + 1); e.preventDefault(); }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { audio.ui('hover'); select(sel - 1); e.preventDefault(); }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { audio.ui('click'); activate(ITEMS[sel].key); e.preventDefault(); }
    const n = +e.key;
    if (n >= 1 && n <= ITEMS.length) { select(n - 1); audio.ui('click'); activate(ITEMS[n - 1].key); }
  }
}
