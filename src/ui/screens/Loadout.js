// LOADOUT: pick a primary and secondary, fit attachments, and see the effect
// each one has on the weapon's real handling numbers.

import { el, clear, button, header, footer } from '../UI.js';
import { audio } from '../../audio/AudioEngine.js';
import { S, settings } from '../../core/Settings.js';
import { PRIMARIES, SECONDARIES, WEAPON_BY_KEY } from '../../shared/weapons.js';
import { ATTACHMENTS, resolveWeapon } from '../../shared/attachments.js';

const STATS = [
  { k: 'damage', label: 'Damage', max: 50, fmt: (w) => w.damage.toFixed(0) },
  { k: 'rpm', label: 'Fire rate', max: 1000, fmt: (w) => w.rpm + ' rpm' },
  { k: 'recoil', label: 'Recoil', max: 0.055, inv: true, get: (w) => w.recoil.vert + w.recoil.horiz, fmt: (w) => ((w.recoil.vert + w.recoil.horiz) * 1000).toFixed(1) },
  { k: 'accuracy', label: 'Accuracy', max: 1, get: (w) => 1 - Math.min(1, w.spreadAds / 0.5), fmt: (w) => (100 - w.spreadAds * 120).toFixed(0) + '%' },
  { k: 'range', label: 'Range', max: 80, get: (w) => w.falloffEnd, fmt: (w) => w.falloffEnd + ' m' },
  { k: 'velocity', label: 'Velocity', max: 950, get: (w) => w.muzzleVelocity, fmt: (w) => Math.round(w.muzzleVelocity) + ' m/s' },
  { k: 'mobility', label: 'Mobility', max: 1.15, get: (w) => w.mobility, fmt: (w) => (w.mobility * 100).toFixed(0) + '%' },
  { k: 'handling', label: 'Handling', max: 1, inv: true, get: (w) => w.adsTime, fmt: (w) => (w.adsTime * 1000).toFixed(0) + ' ms' },
  { k: 'mag', label: 'Magazine', max: 40, get: (w) => w.magSize, fmt: (w) => w.magSize + ' rds' },
  { k: 'reload', label: 'Reload', max: 3.5, inv: true, get: (w) => w.reloadEmpty ?? w.reloadTactical, fmt: (w) => (w.reloadEmpty ?? w.reloadTactical).toFixed(2) + ' s' }
];

export function createLoadout(game) {
  let ui = null;
  let slot = 'primary';
  let listNode, statsNode, attNode, titleNode, descNode;

  const cur = () => (slot === 'primary'
    ? WEAPON_BY_KEY[S.loadout.primary] || PRIMARIES[0]
    : WEAPON_BY_KEY[S.loadout.secondary] || SECONDARIES[0]);
  const attKey = () => (slot === 'primary' ? 'primaryAttachments' : 'secondaryAttachments');

  function renderList() {
    clear(listNode);
    const list = slot === 'primary' ? PRIMARIES : SECONDARIES;
    for (const w of list) {
      const on = w.key === cur().key;
      listNode.appendChild(el('div.wpn-row' + (on ? '.sel' : ''), {
        onclick: () => {
          audio.ui('click');
          if (slot === 'primary') { S.loadout.primary = w.key; S.loadout.primaryAttachments = []; }
          else { S.loadout.secondary = w.key; S.loadout.secondaryAttachments = []; }
          settings.save();
          game.onLoadoutChanged();
          renderAll();
        },
        onmouseenter: () => audio.ui('hover')
      },
        el('span.nm', w.name),
        el('span.cl', w.class)));
    }
  }

  function renderStats() {
    clear(statsNode);
    const base = cur();
    const resolved = resolveWeapon(base, S.loadout[attKey()]);
    titleNode.textContent = resolved.fullName;
    descNode.textContent = resolved.desc;
    for (const s of STATS) {
      const val = s.get ? s.get(resolved) : resolved[s.k];
      const baseVal = s.get ? s.get(base) : base[s.k];
      let pct = Math.min(1, val / s.max);
      if (s.inv) pct = 1 - Math.min(1, val / s.max);
      const changed = Math.abs(val - baseVal) > 1e-6;
      statsNode.appendChild(el('div.stat',
        el('span', s.label),
        el('div.bar', el('i', {
          style: {
            width: `${Math.max(3, pct * 100)}%`,
            background: changed ? 'var(--accent)' : 'var(--accent-dim)'
          }
        })),
        el('div.v', s.fmt(resolved))));
    }
    statsNode.appendChild(el('div.mt16.mono.dim', { style: { fontSize: '10px', letterSpacing: '.12em' } },
      `${resolved.caliber} · ${resolved.magSize} + ${resolved.reserve} carried`));
  }

  function renderAttachments() {
    clear(attNode);
    const base = cur();
    const list = S.loadout[attKey()];
    const bySlot = {};
    for (const key of base.attachments) {
      const a = ATTACHMENTS[key];
      (bySlot[a.slot] ||= []).push(a);
    }
    for (const [slotName, items] of Object.entries(bySlot)) {
      attNode.appendChild(el('h3.sec', slotName));
      const row = el('div.grid.c2');
      for (const a of items) {
        const on = list.includes(a.key);
        row.appendChild(el('div.att' + (on ? '.on' : ''), {
          onclick: () => {
            audio.ui(on ? 'back' : 'accept');
            const next = list.filter((k) => ATTACHMENTS[k]?.slot !== a.slot);
            if (!on) next.push(a.key);
            S.loadout[attKey()] = next;
            settings.save();
            game.onLoadoutChanged();
            renderAll();
          },
          onmouseenter: () => audio.ui('hover'),
          title: a.desc
        }, a.name));
      }
      attNode.appendChild(row);
    }
    attNode.appendChild(el('p.sub.mt16', { style: { textTransform: 'none', letterSpacing: '.06em' } },
      'Attachments change real handling values — check the bars on the left.'));
  }

  function renderAll() {
    renderList();
    renderStats();
    renderAttachments();
    game.previewWeapon(resolveWeapon(cur(), S.loadout[attKey()]));
  }

  return {
    build(node, _ui) {
      ui = _ui;
      listNode = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
      statsNode = el('div');
      attNode = el('div');
      titleNode = el('h1.title');
      descNode = el('p.sub', { style: { textTransform: 'none', letterSpacing: '.06em' } });

      const tabs = el('div.tabs',
        el('div.tab.active', {
          onclick: (e) => { slot = 'primary'; audio.ui('click'); setTab(e.target); renderAll(); }
        }, 'PRIMARY'),
        el('div.tab', {
          onclick: (e) => { slot = 'secondary'; audio.ui('click'); setTab(e.target); renderAll(); }
        }, 'SECONDARY'));
      function setTab(node2) {
        [...tabs.children].forEach((n) => n.classList.toggle('active', n === node2));
      }

      node.appendChild(header('LOADOUT'));
      node.appendChild(el('div.body',
        el('div.pane', { style: { flex: '0.9' } }, tabs, listNode),
        el('div.pane', { style: { flex: '1.1', borderLeft: '1px solid var(--line)' } },
          titleNode, descNode, el('div.divider'), statsNode),
        el('div.pane', { style: { flex: '0.9', borderLeft: '1px solid var(--line)' } }, attNode)));
      node.appendChild(footer(
        [button('BACK', () => { game.previewWeapon(null); ui.back('main'); })],
        [button('CONFIRM', () => { game.previewWeapon(null); ui.back('main'); }, { cls: 'primary' })]));
    },

    enter() { renderAll(); },
    exit() { game.previewWeapon(null); }
  };
}
