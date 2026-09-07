// The top-right corner of the main menu: your operator card, and under it the
// four-slot squad. Both are always visible — the card is the way into your
// profile, and the squad is the thing you deploy with.

import { el, clear, button } from '../UI.js';
import { settings } from '../../core/Settings.js';
import { audio } from '../../audio/AudioEngine.js';
import { S } from '../../core/Settings.js';
import { account } from '../../core/Account.js';
import { avatarSvg, avatarForName } from '../Avatar.js';
import { bus } from '../../core/EventBus.js';

/**
 * @param {object} game the Game instance
 * @param {object} ui   the screen manager, for show()/toast()
 * @returns {{node: HTMLElement, refresh: function, attach: function, detach: function}}
 */
export function createSquadPanel(game, ui) {
  const av = account.avatar;

  const portrait = el('div.op-portrait', { html: avatarSvg(av, 54) });
  const nameNode = el('div.op-name', S.name);
  const lvlNum = el('b', String(account.level));
  const xpFill = el('i');
  const lvlNode = el('div.op-level', el('span', 'LEVEL '), lvlNum);
  const xpBar = el('div.op-xp', xpFill);

  // The chevron that folds the squad away. It lives INSIDE the operator card,
  // which is itself a button into the profile, so its click has to stop
  // propagating — otherwise collapsing the roster would also navigate you off
  // the menu, which is the obvious way to get this wrong.
  const caret = el('button.op-caret', {
    type: 'button',
    title: 'Show or hide your squad',
    onclick: (e) => { e.stopPropagation(); toggleSquad(); },
    onmouseenter: () => audio.ui('hover')
  }, el('i'));

  const card = el('div.op-card', {
    onclick: () => { audio.ui('accept'); ui.show('profile'); },
    onmouseenter: () => audio.ui('hover'),
    title: 'View your profile and stats'
  },
    portrait,
    el('div.op-meta', nameNode, lvlNode, xpBar, el('div.op-hint', 'VIEW STATS')),
    caret);

  const slotRow = el('div.squad-slots');
  const countNode = el('span.squad-count', '1/4');
  const inviteInput = el('input.squad-invite', {
    type: 'text', placeholder: 'CALLSIGN', maxlength: 17,
    onkeydown: (e) => { if (e.key === 'Enter') doInvite(); }
  });
  const leaveBtn = button('LEAVE', () => { audio.ui('back'); game.squadLeave(); }, { cls: 'sm danger' });
  const inviteBanner = el('div.squad-invite-banner', { hidden: true });

  function doInvite() {
    const name = inviteInput.value.trim().toUpperCase();
    if (name.length < 3) { ui.toast('Enter their callsign', 'warn'); return; }
    inviteInput.value = '';
    game.squadInvite(name);
  }

  const panel = el('div.squad-panel',
    el('div.squad-head', el('span', 'SQUAD'), countNode),
    slotRow,
    inviteBanner,
    el('div.squad-actions',
      inviteInput,
      el('div.squad-buttons',
        button('INVITE', doInvite, { cls: 'sm' }),
        leaveBtn)));

  // The panel is wrapped in a grid row that animates from 1fr to 0fr. That is
  // the one way to transition to a element's NATURAL height in plain CSS —
  // max-height has to guess a ceiling, and measuring scrollHeight in JS goes
  // stale the moment the roster changes size.
  const collapser = el('div.squad-collapse', el('div.squad-collapse-inner', panel));
  const node = el('div.op-block', card, collapser);

  function applySquadOpen(open, animate) {
    node.classList.toggle('squad-closed', !open);
    // Skip the transition when restoring the saved state on first paint:
    // the panel should already be folded when the menu appears, not fold
    // itself in front of you every time you open the game.
    if (!animate) {
      node.classList.add('no-anim');
      // two frames, because one is not enough to guarantee the class landed
      // before the transition property is restored
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove('no-anim')));
    }
    caret.setAttribute('aria-expanded', String(open));
    caret.title = open ? 'Hide your squad' : 'Show your squad';
  }

  function toggleSquad() {
    const open = node.classList.contains('squad-closed');
    audio.ui(open ? 'accept' : 'back');
    settings.set('squadOpen', open);
    applySquadOpen(open, true);
  }

  function refresh() {
    nameNode.textContent = S.name;
    lvlNum.textContent = String(account.level);
    const pct = Math.max(2, Math.min(100, Math.round((account.xp / account.xpToNext) * 100)));
    xpFill.style.width = pct + '%';

    const slots = game.squadSlots();
    const filled = slots.filter(Boolean).length;
    countNode.textContent = `${filled}/${slots.length}`;

    // One slot per row, stacked: four names side by side had to be truncated
    // to nine characters to fit, and a 17-character callsign is the whole
    // point of the roster.
    clear(slotRow);
    slots.forEach((m, i) => {
      if (!m) {
        slotRow.appendChild(el('div.squad-slot.empty', {
          onclick: () => { audio.ui('click'); inviteInput.focus(); },
          onmouseenter: () => audio.ui('hover'),
          title: 'Invite a friend'
        },
          el('div.pic', el('span.plus', '+')),
          el('div.lbl', 'EMPTY SLOT'),
          el('div.role', 'INVITE')));
        return;
      }
      const you = m.name === S.name || m.id === game.onlineNet?.id;
      const row = el('div.squad-slot' + (m.leader ? '.leader' : '') + (you ? '.you' : ''),
        el('div.pic', { html: avatarSvg(you ? av : avatarForName(m.name), 30) }),
        el('div.lbl', m.name),
        el('div.role', m.leader ? '★ LEADER' : you ? 'YOU' : 'SQUAD'));
      // The leader can drop anyone but themselves.
      if (!you && game.isSquadLeader) {
        row.title = 'Click to remove from squad';
        row.classList.add('kickable');
        row.addEventListener('click', () => { audio.ui('back'); game.squadKick(m.id); });
      }
      slotRow.appendChild(row);
    });

    leaveBtn.disabled = filled < 2;
    panel.classList.toggle('follower', !game.isSquadLeader);

    // A pending invite sits above the actions until it is taken or dropped.
    const inv = game.pendingInvite;
    clear(inviteBanner);
    inviteBanner.hidden = !inv;
    if (inv) {
      inviteBanner.appendChild(el('span', `${inv.from} INVITED YOU`));
      inviteBanner.appendChild(button('ACCEPT', () => {
        game.squadJoin(inv.code);
      }, { cls: 'sm primary' }));
      inviteBanner.appendChild(button('✕', () => {
        game.pendingInvite = null;
        refresh();
      }, { cls: 'sm' }));
    }
  }

  let unsub = null;
  let unsubAccount = null;
  return {
    node,
    refresh,
    attach() {
      unsub = game.onSquadUpdate(() => refresh());
      // The level and XP bar on this card come off the account, so it has to
      // redraw when a finished match pays out — otherwise the bar only moves
      // on the next reload and the whole thing looks like it does not work.
      unsubAccount = bus.on('account:changed', () => refresh());
      // Connect quietly so invites can reach us while sat in the menu.
      game.connectForSquad();
      applySquadOpen(S.squadOpen !== false, false);
      refresh();
    },
    detach() { unsub?.(); unsub = null; unsubAccount?.(); unsubAccount = null; }
  };
}
