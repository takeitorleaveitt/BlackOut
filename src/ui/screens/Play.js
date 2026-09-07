// PLAY flow: mode picker, server browser, private match creation and lobby.

import { el, clear, button, header, footer, toggle, pingClass, fmtTime } from '../UI.js';
import { audio } from '../../audio/AudioEngine.js';
import { PICKABLE_MODES, MODES, REGIONS, PLAYLIST_LIST, PLAYLISTS } from '../../shared/modes.js';
import { MAP_INFO, mapsForMode } from '../../shared/maps/index.js';
import { S, settings } from '../../core/Settings.js';

// ---------------------------------------------------------------------------
// PLAY
// ---------------------------------------------------------------------------
export function createPlayMenu(game) {
  let ui = null;
  return {
    build(node, _ui) {
      ui = _ui;
      const cards = [
        ...PLAYLIST_LIST.map((pl) => ({
          k: pl.key === 'quickmatch' ? 'QM' : 'ST',
          n: pl.name, d: pl.desc,
          go: () => game.playPlaylist(pl.key)
        })),
        {
          k: 'PM', n: 'PRIVATE MATCH', d: 'Create a room, get a code, invite your friends.',
          go: () => ui.show('private')
        },
        {
          k: 'TR', n: 'TRAINING', d: 'Offline shoothouse against bots. No server required.',
          go: () => ui.show('training')
        }
      ];
      const grid = el('div.grid.c2');
      for (const c of cards) {
        grid.appendChild(el('div.card', {
          onclick: () => { audio.ui('accept'); c.go(); },
          onmouseenter: () => audio.ui('hover')
        }, el('div.tag', c.k), el('div.k', 'DEPLOYMENT'), el('div.n', c.n), el('div.d', c.d)));
      }

      node.appendChild(header('PLAY'));
      node.appendChild(el('div.body', el('div.pane', { style: { flex: '1' } },
        el('h1.title', 'Deployment'),
        el('p.sub', 'Select how you want to get into the fight'),
        grid)));
      node.appendChild(footer([button('BACK', () => ui.back('main'))]));
    }
  };
}

// ---------------------------------------------------------------------------
// SERVER BROWSER
export function createPrivateMatch(game) {
  let ui = null;
  const cfg = {
    mode: 'tdm', map: 'warehouse', maxPlayers: 10, scoreLimit: 75,
    roundTimeSec: 150, timeLimitSec: 600, friendlyFire: false, bots: 4, botSkill: 'normal'
  };

  return {
    build(node, _ui) {
      ui = _ui;
      const mapGrid = el('div.grid.c3');
      const rebuildMaps = () => {
        clear(mapGrid);
        const allowed = mapsForMode(cfg.mode);
        for (const m of MAP_INFO.filter((x) => allowed.includes(x.key))) {
          const card = el('div.card' + (m.key === cfg.map ? '.sel' : ''), {
            onclick: () => { audio.ui('click'); cfg.map = m.key; rebuildMaps(); },
            onmouseenter: () => audio.ui('hover')
          }, el('div.k', m.sky.toUpperCase()), el('div.n', m.name), el('div.d', m.subtitle));
          mapGrid.appendChild(card);
        }
      };

      const modeGrid = el('div.grid.c3');
      for (const m of PICKABLE_MODES) {
        const card = el('div.card' + (m.key === cfg.mode ? '.sel' : ''), {
          onclick: () => {
            audio.ui('click');
            cfg.mode = m.key;
            cfg.maxPlayers = m.maxPlayers;
            cfg.scoreLimit = m.scoreLimit || m.roundsToWin || 7;
            cfg.friendlyFire = m.friendlyFireDefault;
            const allowed = mapsForMode(m.key);
            if (!allowed.includes(cfg.map)) cfg.map = allowed[0];
            [...modeGrid.children].forEach((n, i) => n.classList.toggle('sel', PICKABLE_MODES[i].key === cfg.mode));
            rebuildMaps();
            syncFields();
          },
          onmouseenter: () => audio.ui('hover')
        }, el('div.tag', m.short), el('div.k', m.teams ? 'TEAM' : 'SOLO'), el('div.n', m.name), el('div.d', m.desc));
        modeGrid.appendChild(card);
      }

      const num = (label, key, min, max, step = 1) => {
        const input = el('input', {
          type: 'number', min, max, step, value: cfg[key],
          onchange: (e) => { cfg[key] = Math.max(min, Math.min(max, +e.target.value)); audio.ui('tick'); }
        });
        input.dataset.key = key;
        return el('div.setting', el('label', label), input, el('div.val'));
      };

      const ffToggle = toggle(cfg.friendlyFire, (v) => { cfg.friendlyFire = v; });
      const botSkill = el('select', {
        onchange: (e) => { cfg.botSkill = e.target.value; audio.ui('tick'); }
      }, ...['easy', 'normal', 'hard', 'elite'].map((k) =>
        el('option', { value: k, selected: k === cfg.botSkill }, k.toUpperCase())));

      const settingsPane = el('div',
        el('h3.sec', 'Match rules'),
        num('Max players', 'maxPlayers', 2, 16),
        num('Score limit', 'scoreLimit', 5, 250),
        num('Round duration (s)', 'roundTimeSec', 30, 600, 10),
        num('Time limit (s)', 'timeLimitSec', 60, 1800, 30),
        num('Bots', 'bots', 0, 15),
        el('div.setting', el('label', 'Bot skill'), botSkill, el('div.val')),
        el('div.setting', el('label', 'Friendly fire'), ffToggle, el('div.val')));

      function syncFields() {
        for (const input of settingsPane.querySelectorAll('input[data-key]')) {
          input.value = cfg[input.dataset.key];
        }
        ffToggle.classList.toggle('on', cfg.friendlyFire);
      }

      const codeInput = el('input', {
        type: 'text', maxlength: 6, placeholder: 'ENTER ROOM CODE',
        style: { textTransform: 'uppercase', letterSpacing: '0.3em', textAlign: 'center' }
      });

      rebuildMaps();

      node.appendChild(header('PRIVATE MATCH'));
      node.appendChild(el('div.body',
        el('div.pane', { style: { flex: '1.4' } },
          el('h1.title', 'Host a match'),
          el('p.sub', 'Configure the room, then send the code to your friends'),
          el('h3.sec', 'Mode'), modeGrid,
          el('div', { style: { height: '20px' } }),
          el('h3.sec', 'Map'), mapGrid),
        el('div.pane', { style: { flex: '1', borderLeft: '1px solid var(--line)' } },
          settingsPane,
          el('div.divider'),
          el('h3.sec', 'Join with a code'),
          codeInput,
          el('div', { style: { height: '10px' } }),
          button('JOIN ROOM', () => {
            const code = codeInput.value.trim().toUpperCase();
            if (code.length < 4) { ui.toast('Enter a valid room code', 'warn'); return; }
            game.joinCode(code);
          }))));
      node.appendChild(footer(
        [button('BACK', () => ui.back('play'))],
        [button('CREATE ROOM', () => game.createRoom({ ...cfg }), { cls: 'primary' })]));
    }
  };
}

// ---------------------------------------------------------------------------
// LOBBY (private match waiting room)
// ---------------------------------------------------------------------------
export function createLobby(game) {
  let ui = null, codeNode = null, listNode = null, infoNode = null, startBtn = null;

  function render(info, players) {
    if (!info) return;
    codeNode.textContent = info.code || '——————';
    infoNode.textContent = `${info.mapName} · ${info.modeName} · ${info.players + info.bots}/${info.maxPlayers}`;
    clear(listNode);
    for (const p of players) {
      listNode.appendChild(el('div.pl-row' + (p.team === 1 ? '.alpha' : p.team === 2 ? '.bravo' : ''),
        el('span.nm', p.name),
        el('span.st', p.bot ? 'BOT' : p.id === info.host ? 'HOST' : 'READY')));
    }
    startBtn.disabled = info.host !== game.net?.id;
  }

  return {
    build(node, _ui) {
      ui = _ui;
      codeNode = el('div.roomcode', '——————');
      listNode = el('div.playerlist');
      infoNode = el('div.dim.mono');
      startBtn = button('START MATCH', () => game.startRoom(), { cls: 'primary' });

      node.appendChild(header('LOBBY'));
      node.appendChild(el('div.body',
        el('div.pane', { style: { flex: '1' } },
          el('h1.title', 'Room'),
          el('p.sub', 'Share this code — friends enter it from PLAY → PRIVATE MATCH'),
          codeNode,
          el('div.mt16', el('div.flex.gap8',
            button('COPY CODE', () => {
              navigator.clipboard?.writeText(codeNode.textContent).then(
                () => ui.toast('Room code copied'),
                () => ui.toast('Could not copy — read it out instead', 'warn'));
            }, { cls: 'sm' }),
            button('SWITCH TEAM', () => game.switchTeam(), { cls: 'sm' }))),
          el('div.divider'),
          infoNode),
        el('div.pane', { style: { flex: '1', borderLeft: '1px solid var(--line)' } },
          el('h3.sec', 'Operators'), listNode)));
      node.appendChild(footer(
        [button('LEAVE', () => game.leaveRoom())],
        [startBtn]));
    },

    enter() {
      render(game.roomInfo, game.roomPlayers());
      this.unsub = game.onRoomUpdate(() => render(game.roomInfo, game.roomPlayers()));
    },

    exit() { this.unsub?.(); }
  };
}

// ---------------------------------------------------------------------------
// TRAINING (offline)
// ---------------------------------------------------------------------------
export function createTraining(game) {
  let ui = null;
  const cfg = { map: 'killhouse', bots: 5, botSkill: 'normal', mode: 'tdm' };
  return {
    build(node, _ui) {
      ui = _ui;
      const mapGrid = el('div.grid.c3');
      for (const m of MAP_INFO) {
        const card = el('div.card' + (m.key === cfg.map ? '.sel' : ''), {
          onclick: () => {
            audio.ui('click'); cfg.map = m.key;
            [...mapGrid.children].forEach((n, i) => n.classList.toggle('sel', MAP_INFO[i].key === cfg.map));
          },
          onmouseenter: () => audio.ui('hover')
        }, el('div.k', m.sky.toUpperCase()), el('div.n', m.name), el('div.d', m.subtitle));
        mapGrid.appendChild(card);
      }
      const botsInput = el('input', {
        type: 'number', min: 0, max: 11, value: cfg.bots,
        onchange: (e) => { cfg.bots = Math.max(0, Math.min(11, +e.target.value)); }
      });
      const skill = el('select', { onchange: (e) => { cfg.botSkill = e.target.value; } },
        ...['easy', 'normal', 'hard', 'elite'].map((k) =>
          el('option', { value: k, selected: k === cfg.botSkill }, k.toUpperCase())));
      const mode = el('select', { onchange: (e) => { cfg.mode = e.target.value; } },
        ...PICKABLE_MODES.map((m) => el('option', { value: m.key, selected: m.key === cfg.mode }, m.name.toUpperCase())));

      node.appendChild(header('TRAINING'));
      node.appendChild(el('div.body',
        el('div.pane', { style: { flex: '1.5' } },
          el('h1.title', 'Training'),
          el('p.sub', 'Runs entirely in your browser — no server, no latency, no waiting'),
          mapGrid),
        el('div.pane', { style: { flex: '0.8', borderLeft: '1px solid var(--line)' } },
          el('h3.sec', 'Session'),
          el('div.setting', el('label', 'Mode'), mode, el('div.val')),
          el('div.setting', el('label', 'Bots'), botsInput, el('div.val')),
          el('div.setting', el('label', 'Bot skill'), skill, el('div.val')))));
      node.appendChild(footer(
        [button('BACK', () => ui.back('play'))],
        [button('BEGIN', () => game.startOffline({ ...cfg }), { cls: 'primary' })]));
    }
  };
}
