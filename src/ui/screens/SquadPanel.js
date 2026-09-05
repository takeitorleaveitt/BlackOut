// The top-right corner of the main menu: your operator card, and under it the
// four-slot squad. Both are always visible — the card is the way into your
// profile, and the squad is the thing you deploy with.

import { el, clear, button } from '../UI.js';
import { audio } from '../../audio/AudioEngine.js';
import { S } from '../../core/Settings.js';
import { account } from '../../core/Account.js';
import { avatarSvg, avatarForName } from '../Avatar.js';

/**
 * @param {object} game the Game instance
 * @param {object} ui   the screen manager, for show()/toast()
 * @returns {{node: HTMLElement, refresh: function, attach: function, detach: function}}
 */
export function createSquadPanel(game, ui) {
  const av = account.avatar;

  const portrait = el('div.op-portrait', { html: avatarSvg(av, 76) });
  const nameNode = el('div.op-name', S.name);
  const lvlNum = el('b', String(account.level));
  const xpFill = el('i');
  const lvlNode = el('div.op-level', el('span', 'LEVEL '), lvlNum);
  const xpBar = el('div.op-xp', xpFill);

  const card = el('div.op-card', {
    onclick: () => { audio.ui('accept'); ui.show('profile'); },
    onmouseenter: () => audio.ui('hover'),
    title: 'View your profile and stats'
  },
    portrait,
    el('div.op-meta', nameNode, lvlNode, xpBar, el('div.op-hint', 'VIEW STATS')));

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
      button('INVITE', doInvite, { cls: 'sm' }),
      leaveBtn));

  const node = el('div.op-block', card, panel);

  function refresh() {
    nameNode.textContent = S.name;
    lvlNum.textContent = String(account.level);
    const pct = Math.max(2, Math.min(100, Math.round((account.xp / account.xpToNext) * 100)));
    xpFill.style.width = pct + '%';

    const slots = game.squadSlots();
    const filled = slots.filter(Boolean).length;
    countNode.textContent = `${filled}/${slots.length}`;

    clear(slotRow);
    for (const m of slots) {
      if (!m) {
        slotRow.appendChild(el('div.squad-slot.empty', {
          onclick: () => { audio.ui('click'); inviteInput.focus(); },
          onmouseenter: () => audio.ui('hover'),
          title: 'Invite a friend'
        }, el('div.plus', '+'), el('div.lbl', 'INVITE')));
        continue;
      }
      const you = m.name === S.name || m.id === game.onlineNet?.id;
      const tile = el('div.squad-slot' + (m.leader ? '.leader' : '') + (you ? '.you' : ''),
        el('div.pic', { html: avatarSvg(you ? av : avatarForName(m.name), 40) }),
        el('div.lbl', m.name.length > 9 ? m.name.slice(0, 9) : m.name),
        m.leader ? el('div.crown', '★') : null);
      // The leader can drop anyone but themselves.
      if (!you && game.isSquadLeader) {
        tile.title = 'Click to remove from squad';
        tile.addEventListener('click', () => { audio.ui('back'); game.squadKick(m.id); });
      }
      slotRow.appendChild(tile);
    }

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
  return {
    node,
    refresh,
    attach() {
      unsub = game.onSquadUpdate(() => refresh());
      // Connect quietly so invites can reach us while sat in the menu.
      game.connectForSquad();
      refresh();
    },
    detach() { unsub?.(); unsub = null; }
  };
}
