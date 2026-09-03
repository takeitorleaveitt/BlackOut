// PLAY flow: mode picker, server browser, private match creation and lobby.

import { el, clear, button, header, footer, toggle, pingClass, fmtTime } from '../UI.js';
import { audio } from '../../audio/AudioEngine.js';
import { MODE_LIST, MODES, REGIONS } from '../../shared/modes.js';
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
        {
          k: 'QM', n: 'QUICK MATCH', d: 'Drop into the first server with a free slot. Fastest way into a firefight.',
          go: () => game.quickMatch()
        },
        {
          k: 'SB', n: 'SERVER BROWSER', d: 'Pick your map, mode, region and ping by hand.',
          go: () => ui.show('browser')
        },
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
// ---------------------------------------------------------------------------
export function createServerBrowser(game) {
  let ui = null, tbody = null, statusNode = null, selected = null;
  let filterMode = 'all', filterRegion = 'all', refreshTimer = null;

  function rows(list) {
    clear(tbody);
    const filtered = list.filter((r) =>
      (filterMode === 'all' || r.mode === filterMode) &&
      (filterRegion === 'all' || r.region === filterRegion));
    if (!filtered.length) {
      tbody.appendChild(el('tr', el('td', { colspan: 7, style: { textAlign: 'center', padding: '38px' } },
        'NO MATCHES FOUND — TRY A DIFFERENT FILTER OR HOST YOUR OWN')));
      return;
    }
    for (const r of filtered) {
      const ping = game.pingFor(r.region);
      const tr = el('tr.row', {
        onclick: () => {
          audio.ui('click');
          selected = r;
          [...tbody.children].forEach((n) => n.classList.remove('sel'));
          tr.classList.add('sel');
        },
        ondblclick: () => game.joinRoom(r.id)
      },
        el('td', el('b', r.mapName), el('div', { style: { fontSize: '10px', opacity: 0.55 } }, r.mapSubtitle || '')),
        el('td', r.modeName),
        el('td', `${r.players + r.bots}/${r.maxPlayers}`,
          el('div.bar', { style: { marginTop: '4px' } },
            el('i', { style: { width: `${Math.min(100, ((r.players + r.bots) / r.maxPlayers) * 100)}%` } }))),
        el('td', String(r.players)),
        el('td.ping.' + pingClass(ping), `${ping} ms`),
        el('td', (REGIONS.find((x) => x.key === r.region) || {}).name || r.region),
        el('td', r.phase === 'live' ? 'IN PROGRESS' : r.phase.toUpperCase()));
      tbody.appendChild(tr);
    }
  }

  return {
    build(node, _ui) {
      ui = _ui;
      const modeSel = el('select', {
        onchange: (e) => { filterMode = e.target.value; audio.ui('tick'); rows(game.serverList); }
      }, el('option', { value: 'all' }, 'ALL MODES'),
        ...MODE_LIST.map((m) => el('option', { value: m.key }, m.name.toUpperCase())));
      const regionSel = el('select', {
        onchange: (e) => { filterRegion = e.target.value; audio.ui('tick'); rows(game.serverList); }
      }, el('option', { value: 'all' }, 'ALL REGIONS'),
        ...REGIONS.map((r) => el('option', { value: r.key }, r.name.toUpperCase())));

      tbody = el('tbody');
      statusNode = el('span.dim', 'READY');

      const table = el('table.list',
        el('thead', el('tr',
          el('th', 'Map'), el('th', 'Mode'), el('th', 'Slots'),
          el('th', 'Humans'), el('th', 'Ping'), el('th', 'Region'), el('th', 'Status'))),
        tbody);

      node.appendChild(header('SERVER BROWSER', statusNode));
      node.appendChild(el('div.body', el('div.pane', { style: { flex: '1' } },
        el('div.flex.between.center', { style: { marginBottom: '18px' } },
          el('div', el('h1.title', 'Servers'), el('p.sub', { style: { margin: 0 } }, 'Live matches on this region cluster')),
          el('div.flex.gap8', { style: { width: '420px' } }, modeSel, regionSel,
            button('REFRESH', () => game.refreshServers(), { cls: 'sm' }))),
        table)));
      node.appendChild(footer(
        [button('BACK', () => ui.back('play'))],
        [
          button('HOST PRIVATE', () => ui.show('private')),
          button('JOIN', () => { if (selected) game.joinRoom(selected.id); else ui.toast('Select a server first', 'warn'); }, { cls: 'primary' })
        ]));
    },

    enter() {
      game.refreshServers();
      rows(game.serverList);
      refreshTimer = setInterval(() => game.refreshServers(), 5000);
      this.unsub = game.onServerList((list) => {
        statusNode.textContent = `${list.length} SERVERS`;
        rows(list);
      });
    },

    exit() {
      clearInterval(refreshTimer);
      this.unsub?.();
    }
  };
}

// ---------------------------------------------------------------------------
// PRIVATE MATCH — create or join by code
// ---------------------------------------------------------------------------
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
      for (const m of MODE_LIST) {
        const card = el('div.card' + (m.key === cfg.mode ? '.sel' : ''), {
          onclick: () => {
            audio.ui('click');
            cfg.mode = m.key;
            cfg.maxPlayers = m.maxPlayers;
            cfg.scoreLimit = m.scoreLimit || m.roundsToWin || 7;
            cfg.friendlyFire = m.friendlyFireDefault;
            const allowed = mapsForMode(m.key);
            if (!allowed.includes(cfg.map)) cfg.map = allowed[0];
            [...modeGrid.children].forEach((n, i) => n.classList.toggle('sel', MODE_LIST[i].key === cfg.mode));
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
        ...MODE_LIST.map((m) => el('option', { value: m.key, selected: m.key === cfg.mode }, m.name.toUpperCase())));

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
