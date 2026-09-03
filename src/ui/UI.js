// Screen manager and DOM helpers.
//
// Screens are plain objects with build()/enter()/exit(); the manager cross-fades
// between them, plays the interface sounds and keeps a back stack so ESC always
// does the obvious thing.

import { audio } from '../audio/AudioEngine.js';

/** Tiny hyperscript helper: el('div.card', {onclick}, children...) */
export function el(spec, props, ...children) {
  const [tagPart, ...classes] = String(spec).split('.');
  const [tag, id] = tagPart.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className += ' ' + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(add); return; }
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** Button that plays the interface sounds. */
export function button(label, onClick, opts = {}) {
  return el('button.btn' + (opts.cls ? '.' + opts.cls : ''), {
    onclick: (e) => { audio.ui(opts.sound || 'click'); onClick?.(e); },
    onmouseenter: () => audio.ui('hover'),
    disabled: opts.disabled
  }, label);
}

export function toggle(value, onChange) {
  const node = el('div.toggle' + (value ? '.on' : ''), {
    onclick: () => {
      const on = !node.classList.contains('on');
      node.classList.toggle('on', on);
      audio.ui('tick');
      onChange(on);
    }
  }, el('i'));
  return node;
}

export function slider(value, min, max, step, onChange, format) {
  const val = el('div.val', format ? format(value) : String(value));
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => {
      const v = +e.target.value;
      val.textContent = format ? format(v) : String(v);
      onChange(v);
    },
    onchange: () => audio.ui('tick')
  });
  return { input, val };
}

export function settingRow(label, control, valueNode, hint) {
  return el('div.setting',
    el('label', label, hint ? el('small', hint) : null),
    control,
    valueNode || el('div.val'));
}

export class UI {
  constructor(root) {
    this.root = root;
    this.screens = new Map();
    this.current = null;
    this.stack = [];
    this.toasts = el('div#toasts');
    document.body.appendChild(this.toasts);
  }

  register(name, screen) {
    screen.name = name;
    this.screens.set(name, screen);
    return screen;
  }

  get(name) { return this.screens.get(name); }

  show(name, params = {}, opts = {}) {
    const next = this.screens.get(name);
    if (!next) { console.warn('no screen', name); return; }
    if (this.current === next && !opts.force) {
      next.refresh?.(params);
      return;
    }
    const prev = this.current;
    if (prev) {
      prev.node.classList.remove('active');
      prev.exit?.();
      setTimeout(() => { if (prev !== this.current) prev.node.remove(); }, 320);
    }
    if (!next.node) {
      next.node = el('div.screen', { id: 'screen-' + name });
      next.build?.(next.node, this);
    }
    if (!next.node.isConnected) this.root.appendChild(next.node);
    next.enter?.(params);
    // force a reflow so the transition runs
    void next.node.offsetWidth;
    next.node.classList.add('active');
    this.current = next;
    if (!opts.noStack && prev && prev.name !== name) this.stack.push(prev.name);
    if (opts.resetStack) this.stack.length = 0;
    if (!opts.silent) audio.ui(opts.sound || 'open');
  }

  back(fallback = 'main') {
    const prev = this.stack.pop();
    audio.ui('back');
    this.show(prev || fallback, {}, { noStack: true, silent: true });
  }

  hide() {
    if (this.current) {
      this.current.node.classList.remove('active');
      this.current.exit?.();
      this.current = null;
    }
    this.root.classList.add('hidden');
  }

  showRoot() { this.root.classList.remove('hidden'); }

  toast(message, kind = '') {
    const node = el('div.toast' + (kind ? '.' + kind : ''), message);
    this.toasts.appendChild(node);
    if (kind === 'err') audio.ui('error');
    setTimeout(() => {
      node.style.transition = 'opacity .35s, transform .35s';
      node.style.opacity = '0';
      node.style.transform = 'translateX(20px)';
      setTimeout(() => node.remove(), 400);
    }, kind === 'err' ? 5200 : 3600);
  }
}

/** Shared header used by every sub-screen. */
export function header(title, right) {
  return el('div.hdr',
    el('div.brand', 'BLACKOUT ', el('b', 'PROTOCOL')),
    el('div.telemetry',
      el('span', title),
      right || null,
      el('div.rec', el('i'), 'REC')));
}

export function footer(left, right) {
  return el('div.ftr', el('div.flex.gap8', left || []), el('div.flex.gap8', right || []));
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function pingClass(p) {
  return p < 60 ? 'good' : p < 120 ? 'ok' : 'bad';
}
