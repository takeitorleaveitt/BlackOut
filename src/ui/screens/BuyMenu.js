// Buy menu — the Counter-Strike loop, minus the bomb.
//
// Only up during the freeze phase of an economy match. The columns are
// numbered so the whole thing is driveable from the keyboard: press the
// category number, then the item number. The server owns the wallet — every
// tile here just asks, and redraws from whatever answer comes back.

import { el, clear, header } from '../UI.js';
import { audio } from '../../audio/AudioEngine.js';
import { WEAPON_BY_KEY } from '../../shared/weapons.js';
import { ATTACHMENTS } from '../../shared/attachments.js';
import { BUY_CATEGORIES, priceOf, attachmentPrice } from '../../shared/economy.js';

export function createBuyMenu(game) {
  let ui = null;
  let moneyNode, timerNode, colsNode, kitNode;
  let cat = -1;                       // which category column is expanded

  const money = () => game.economy?.money ?? 0;

  function itemsFor(c) {
    if (c.slot === 'attachment') {
      // only attachments the gun you are actually holding can take
      const primary = WEAPON_BY_KEY[game.economy?.loadout?.primary];
      const allowed = new Set(primary ? primary.attachments || [] : []);
      return c.items.filter((k) => allowed.has(k)).map((k) => ({
        key: k, name: ATTACHMENTS[k]?.name || k, price: attachmentPrice(k), kind: 'attachment'
      }));
    }
    return c.items.map((k) => ({
      key: k, name: WEAPON_BY_KEY[k]?.name || k, price: priceOf(k), kind: 'weapon',
      slot: c.slot
    }));
  }

  function buy(item) {
    if (item.price > money()) { audio.ui('deny'); ui.toast('Not enough money', 'warn'); return; }
    audio.ui('accept');
    game.buy(item.kind === 'attachment'
      ? { attachment: item.key, slot: 'primary' }
      : { weapon: item.key, slot: item.slot });
  }

  function render() {
    if (!colsNode) return;
    const e = game.economy;
    moneyNode.textContent = '$' + money();
    moneyNode.classList.toggle('broke', money() < 450);

    clear(colsNode);
    BUY_CATEGORIES.forEach((c, ci) => {
      const items = itemsFor(c);
      const col = el('div.buy-col' + (cat === ci ? '.open' : ''), {
        onmouseenter: () => { if (cat !== ci) { cat = ci; audio.ui('hover'); render(); } }
      },
        el('div.buy-col-head', el('span.n', String(ci + 1)), c.name));
      if (!items.length) {
        col.appendChild(el('div.buy-empty', c.slot === 'attachment' ? 'Buy a primary first' : '—'));
      }
      items.forEach((it, ii) => {
        const owned = it.kind === 'attachment'
          ? (e?.loadout?.primaryAttachments || []).includes(it.key)
          : e?.loadout?.primary === it.key || e?.loadout?.secondary === it.key;
        const afford = it.price <= money();
        col.appendChild(el('div.buy-item' + (owned ? '.owned' : '') + (afford ? '' : '.poor'), {
          onclick: () => { if (!owned) buy(it); },
          onmouseenter: () => audio.ui('hover')
        },
          el('span.n', String(ii + 1)),
          el('span.nm', it.name),
          el('span.pr', owned ? 'OWNED' : it.price === 0 ? 'FREE' : '$' + it.price)));
      });
      colsNode.appendChild(col);
    });

    // what you are walking out with
    clear(kitNode);
    const l = e?.loadout || {};
    const line = (label, key, atts) => {
      const d = WEAPON_BY_KEY[key];
      return el('div.kit-row',
        el('span.k', label),
        el('span.v', d ? d.name : '—'),
        el('span.a', (atts || []).map((a) => ATTACHMENTS[a]?.name || a).join(' · ')));
    };
    kitNode.appendChild(line('PRIMARY', l.primary, l.primaryAttachments));
    kitNode.appendChild(line('SECONDARY', l.secondary, l.secondaryAttachments));
    kitNode.appendChild(line('MELEE', 'knife', []));
  }

  function onKey(ev) {
    if (ui.current?.name !== 'buy') return;
    const n = +ev.key;
    if (!(n >= 1 && n <= 9)) return;
    ev.preventDefault();
    if (cat < 0 || ev.shiftKey) { cat = Math.min(n - 1, BUY_CATEGORIES.length - 1); render(); return; }
    const items = itemsFor(BUY_CATEGORIES[cat]);
    if (n <= items.length) buy(items[n - 1]);
    else { cat = Math.min(n - 1, BUY_CATEGORIES.length - 1); render(); }
  }

  return {
    build(node, _ui) {
      ui = _ui;
      moneyNode = el('div.buy-money', '$0');
      timerNode = el('div.buy-timer', 'BUY TIME 0:00');
      colsNode = el('div.buy-cols');
      kitNode = el('div.buy-kit');

      node.appendChild(header('BUY', timerNode));
      node.appendChild(el('div.body.buy-body',
        el('div.buy-left',
          colsNode,
          el('div.buy-foot',
            el('div.buy-hint', '1-4 CATEGORY · 1-5 ITEM · ESC CLOSE'),
            moneyNode)),
        // The operator stands to the right, idling, the way a buy screen does.
        el('div.buy-right',
          el('div.buy-op', el('div.buy-op-inner',
            el('i.op-head'), el('i.op-visor'), el('i.op-torso'), el('i.op-vest'),
            el('i.op-arm.l'), el('i.op-arm.r'),
            el('i.op-leg.l'), el('i.op-leg.r'))),
          el('h3.sec', 'Your kit'),
          kitNode)));
    },

    enter() {
      cat = 0;
      render();
      this.unsub = game.onEconomy(() => render());
      this.timer = setInterval(() => {
        const left = game.buyTimeLeft();
        timerNode.textContent = `BUY TIME ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (left <= 0) game.closeBuyMenu();
      }, 250);
      window.addEventListener('keydown', onKey);
      game.setBuyPreview(true);
    },

    exit() {
      clearInterval(this.timer);
      this.unsub?.();
      window.removeEventListener('keydown', onKey);
      game.setBuyPreview(false);
    }
  };
}
