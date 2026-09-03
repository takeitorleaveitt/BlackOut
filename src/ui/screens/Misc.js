// Friends, pause menu and the end-of-match report.

import { el, clear, button, header, footer, fmtTime } from '../UI.js';
import { audio } from '../../audio/AudioEngine.js';
import { S, settings } from '../../core/Settings.js';

// ---------------------------------------------------------------------------
// FRIENDS — local roster plus invite codes
// ---------------------------------------------------------------------------
const KEY = 'bp.friends.v1';

function loadFriends() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
}
function saveFriends(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

export function createFriends(game) {
  let ui = null, listNode = null;

  function render() {
    const friends = loadFriends();
    clear(listNode);
    if (!friends.length) {
      listNode.appendChild(el('p.sub', { style: { textTransform: 'none', letterSpacing: '.06em' } },
        'No one on your roster yet. Add a callsign, then send them your room code from a private match.'));
    }
    for (const f of friends) {
      listNode.appendChild(el('div.pl-row',
        el('span.nm', f.name),
        el('span.st', f.code ? 'CODE ' + f.code : 'OFFLINE'),
        button('JOIN', () => {
          if (!f.code) { ui.toast('No room code saved for ' + f.name, 'warn'); return; }
          game.joinCode(f.code);
        }, { cls: 'sm' }),
        button('REMOVE', () => {
          saveFriends(loadFriends().filter((x) => x.name !== f.name));
          render();
        }, { cls: 'sm danger' })));
    }
  }

  return {
    build(node, _ui) {
      ui = _ui;
      listNode = el('div.playerlist');
      const nameInput = el('input', { type: 'text', placeholder: 'CALLSIGN', maxlength: 18 });
      const codeInput = el('input', { type: 'text', placeholder: 'ROOM CODE (OPTIONAL)', maxlength: 6 });

      node.appendChild(header('FRIENDS'));
      node.appendChild(el('div.body',
        el('div.pane', { style: { flex: '1' } },
          el('h1.title', 'Roster'),
          el('p.sub', 'Saved on this device'),
          listNode),
        el('div.pane', { style: { flex: '0.8', borderLeft: '1px solid var(--line)' } },
          el('h3.sec', 'Add operator'),
          nameInput,
          el('div', { style: { height: '8px' } }),
          codeInput,
          el('div', { style: { height: '12px' } }),
          button('ADD', () => {
            const name = nameInput.value.trim().toUpperCase();
            if (!name) { ui.toast('Enter a callsign', 'warn'); return; }
            const list = loadFriends().filter((x) => x.name !== name);
            list.push({ name, code: codeInput.value.trim().toUpperCase() || null });
            saveFriends(list);
            nameInput.value = ''; codeInput.value = '';
            render();
          }, { cls: 'primary' }),
          el('div.divider'),
          el('h3.sec', 'Your callsign'),
          el('div.roomcode', { style: { fontSize: '22px', letterSpacing: '.2em' } }, S.name))));
      node.appendChild(footer([button('BACK', () => ui.back('main'))]));
      render();
    },
    enter() { render(); }
  };
}

// ---------------------------------------------------------------------------
// PAUSE
// ---------------------------------------------------------------------------
export function createPause(game) {
  let ui = null;
  return {
    build(node, _ui) {
      ui = _ui;
      node.appendChild(header('PAUSED'));
      node.appendChild(el('div.body',
        el('div.pane', {
          style: { flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '10px' }
        },
          el('h1.title', 'Match paused'),
          el('p.sub', 'The match continues without you — get back in'),
          el('div.flex.gap8', { style: { flexDirection: 'column', width: '320px' } },
            button('RESUME', () => game.resume(), { cls: 'primary' }),
            button('LOADOUT', () => ui.show('loadout')),
            button('SETTINGS', () => ui.show('settings')),
            button('LEAVE MATCH', () => game.leaveMatch(), { cls: 'danger' })))));
    },
    enter() { game.onPauseEnter?.(); }
  };
}

// ---------------------------------------------------------------------------
// END OF MATCH
// ---------------------------------------------------------------------------
export function createEndMatch(game) {
  let ui = null, titleNode, subNode, tableNode;

  return {
    build(node, _ui) {
      ui = _ui;
      titleNode = el('h1.title', 'Match complete');
      subNode = el('p.sub', '');
      tableNode = el('div');
      node.appendChild(header('AFTER ACTION REPORT'));
      node.appendChild(el('div.body', el('div.pane', { style: { flex: '1' } },
        titleNode, subNode, tableNode)));
      node.appendChild(footer(
        [button('MAIN MENU', () => game.toMenu())],
        [button('PLAY AGAIN', () => game.quickMatch(), { cls: 'primary' })]));
    },

    enter(params = {}) {
      const st = params.state || game.matchState;
      if (!st) return;
      const teams = st.mode !== 'ffa';
      const a = st.scores?.[1] ?? 0, b = st.scores?.[2] ?? 0;
      titleNode.textContent = teams
        ? (a === b ? 'DRAW' : a > b ? 'ALPHA WINS' : 'BRAVO WINS')
        : 'MATCH COMPLETE';
      subNode.textContent = `${st.mapName} · ${st.modeName} · ${a} — ${b}`;
      clear(tableNode);
      const rows = (st.board || []).map((r) => el('tr' + (r.id === game.playerId ? '.row.sel' : ''),
        el('td', r.name, r.bot ? el('span.dim', ' · BOT') : null),
        el('td', r.team === 1 ? 'ALPHA' : r.team === 2 ? 'BRAVO' : '—'),
        el('td', String(r.kills)),
        el('td', String(r.deaths)),
        el('td', r.deaths ? (r.kills / r.deaths).toFixed(2) : r.kills.toFixed(2)),
        el('td', String(r.damage)),
        el('td', r.acc + '%'),
        el('td', String(r.hs)),
        el('td', String(r.score))));
      tableNode.appendChild(el('table.list',
        el('thead', el('tr',
          el('th', 'Operator'), el('th', 'Team'), el('th', 'K'), el('th', 'D'), el('th', 'K/D'),
          el('th', 'Damage'), el('th', 'Acc'), el('th', 'HS'), el('th', 'Score'))),
        el('tbody', ...rows)));
    }
  };
}
