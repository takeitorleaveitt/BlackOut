// Friends, pause menu and the end-of-match report.

import { el, clear, button, header, footer, fmtTime } from '../UI.js';
import { audio } from '../../audio/AudioEngine.js';
import { S, settings } from '../../core/Settings.js';
import { account, fmtDuration } from '../../core/Account.js';
import { PLAYLISTS } from '../../shared/modes.js';
import { avatarSvg } from '../Avatar.js';

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
        'No one on your roster yet. Add a callsign, then invite them into your squad from here.'));
    }
    for (const f of friends) {
      listNode.appendChild(el('div.pl-row',
        el('span.nm', f.name),
        el('span.st', f.code ? 'CODE ' + f.code : 'OFFLINE'),
        // Pulls them straight into your four-slot squad, which then travels
        // with you into Quick Match, Standard and private rooms.
        button('INVITE', () => game.squadInvite(f.name), { cls: 'sm primary' }),
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

// ---------------------------------------------------------------------------
// QUEUE — the player-only playlists hold here until the lobby is full
// ---------------------------------------------------------------------------
export function createQueue(game) {
  let ui = null, countNode = null, statusNode = null, timerNode = null;
  let timer = null, started = 0, playlist = null;

  function refresh() {
    // The server's own lobbyStatus is authoritative when we have it; the
    // room list is the fallback for the moment before the first one lands.
    const st = game.lobbyStatus;
    const need = st?.need || PLAYLISTS[playlist]?.minPlayers || 8;
    const have = st?.have ?? (game.roomPlayerList?.filter((p) => !p.bot).length ?? 0);
    if (countNode) countNode.textContent = `${have} / ${need}`;
    if (statusNode) {
      statusNode.textContent = have >= need
        ? 'LOBBY FULL — STARTING'
        : 'WAITING FOR PLAYERS';
    }
    if (timerNode) {
      const secs = Math.floor((Date.now() - started) / 1000);
      timerNode.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    }
  }

  return {
    build(node, _ui) {
      ui = _ui;
      countNode = el('div', { style: { fontSize: '46px', fontWeight: '700', letterSpacing: '.04em' } }, '0 / 8');
      statusNode = el('p.sub', 'WAITING FOR PLAYERS');
      timerNode = el('div.dim', { style: { fontSize: '13px' } }, '00:00');
      node.appendChild(header('MATCHMAKING'));
      node.appendChild(el('div.body',
        el('div.pane', {
          style: { flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '12px' }
        },
          el('h1.title', 'Searching'),
          countNode, statusNode, timerNode,
          el('p.sub', { style: { textTransform: 'none', maxWidth: '460px', textAlign: 'center' } },
            'This playlist is real players only, so it waits for a full lobby rather than filling the match with bots.'))));
      node.appendChild(footer([button('CANCEL', () => {
        game.cancelQueue();
        ui.back('play');
      })]));
    },
    enter(props = {}) {
      playlist = props.playlist || game.currentPlaylist || 'quickmatch';
      started = Date.now();
      refresh();
      timer = setInterval(refresh, 500);
      this.unsub = game.onRoomUpdate?.(() => refresh());
    },
    exit() {
      clearInterval(timer);
      timer = null;
      this.unsub?.();
    }
  };
}

// ---------------------------------------------------------------------------
// PROFILE — level, account age, per-playlist K/D and the friends roster
// ---------------------------------------------------------------------------
export function createProfile(game) {
  let ui = null;

  function statBlock(label, value, sub) {
    return el('div.card', { style: { textAlign: 'center' } },
      el('div.k', label),
      el('div.n', { style: { fontSize: '26px' } }, value),
      sub ? el('div.d', sub) : el('div.d', ''));
  }

  function playlistRow(key, label) {
    const s = account.statsFor(key) || { kills: 0, deaths: 0, matches: 0, wins: 0 };
    const kd = account.kd(key);
    return el('tr',
      el('td', el('b', label)),
      el('td', String(s.kills)),
      el('td', String(s.deaths)),
      el('td', el('b', kd.toFixed(2))),
      el('td', String(s.matches)),
      el('td', String(s.wins)));
  }

  return {
    build(node, _ui) {
      ui = _ui;
      const created = new Date(account.createdAt);
      const ageDays = Math.max(0, Math.floor((Date.now() - account.createdAt) / 86400000));
      const pct = Math.round((account.xp / account.xpToNext) * 100);

      const friends = loadFriends();
      const friendList = friends.length
        ? el('div', ...friends.map((f) => el('div.setting',
            el('label', f.name),
            el('div.val', f.code || ''))))
        : el('p.sub', { style: { textTransform: 'none' } }, 'No friends added yet — add them on the FRIENDS screen.');

      const ban = account.banRemainingMs();

      const av = account.avatar;

      node.appendChild(header('PROFILE'));
      node.appendChild(el('div.body', el('div.pane', { style: { flex: '1' } },
        el('div.profile-head',
          el('div.profile-pic', { html: avatarSvg(av, 104) }),
          el('div',
            el('h1.title', { style: { margin: '0 0 8px' } }, S.name || 'OPERATOR'),
            el('p.sub', { style: { margin: '0 0 6px' } },
              `ACCOUNT CREATED ${created.toLocaleDateString()} · ${ageDays} DAY${ageDays === 1 ? '' : 'S'} OLD`),
            el('p.sub', { style: { margin: 0 } }, `TODAY'S KIT · ${av.name}`))),

        el('div.grid.c3', { style: { marginBottom: '18px' } },
          statBlock('LEVEL', String(account.level), `${account.xp} / ${account.xpToNext} XP`),
          statBlock('PROGRESS', `${pct}%`, 'TO NEXT LEVEL'),
          statBlock('STATUS', ban > 0 ? 'PENALISED' : 'CLEAR',
            ban > 0 ? `${fmtDuration(ban)} REMAINING` : 'NO ACTIVE PENALTY')),

        el('h3.sec', 'Record'),
        el('table.list',
          el('thead', el('tr',
            el('th', 'Playlist'), el('th', 'Kills'), el('th', 'Deaths'),
            el('th', 'K/D'), el('th', 'Matches'), el('th', 'Wins'))),
          el('tbody',
            playlistRow('standard', 'STANDARD'),
            playlistRow('quickmatch', 'QUICK MATCH'))),

        el('h3.sec', 'Friends'),
        friendList)));
      node.appendChild(footer([button('BACK', () => ui.back('main'))]));
    }
  };
}
