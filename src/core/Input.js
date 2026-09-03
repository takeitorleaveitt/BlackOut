// Keyboard / mouse input with pointer lock, rebindable actions and
// accumulated mouse deltas (so a 240Hz mouse doesn't lose motion between
// frames).

import { bus } from './EventBus.js';
import { S } from './Settings.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0, wheel: 0 };
    this.locked = false;
    this.enabled = false;
    this.captureBind = null;      // set to a fn while rebinding
    this._onKeyDown = this.onKeyDown.bind(this);
    this._onKeyUp = this.onKeyUp.bind(this);
    this._onMove = this.onMove.bind(this);
    this._onDown = this.onDown.bind(this);
    this._onUp = this.onUp.bind(this);
    this._onWheel = this.onWheel.bind(this);
    this._onLock = this.onLockChange.bind(this);
    this._onBlur = () => { this.keys.clear(); this.mouse.buttons = 0; };
    window.addEventListener('keydown', this._onKeyDown, { capture: true });
    window.addEventListener('keyup', this._onKeyUp, { capture: true });
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mousedown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLock);
    document.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
  }

  requestLock() {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: !!S.rawInput });
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
  }

  exitLock() { if (this.locked) document.exitPointerLock(); }

  onLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    bus.emit('input:lock', this.locked);
    if (!this.locked) { this.keys.clear(); this.mouse.buttons = 0; }
  }

  onKeyDown(e) {
    if (this.captureBind) {
      e.preventDefault();
      const fn = this.captureBind;
      this.captureBind = null;
      fn(e.code);
      return;
    }
    if (e.repeat) { if (this.blocksBrowser(e.code)) e.preventDefault(); return; }
    this.keys.add(e.code);
    bus.emit('input:key', e.code, true, e);
    if (this.blocksBrowser(e.code)) e.preventDefault();
  }

  blocksBrowser(code) {
    if (!this.enabled) return false;
    return code === 'Tab' || code === 'Space' || code === 'Slash' ||
      code === 'Quote' || code.startsWith('Arrow');
  }

  onKeyUp(e) {
    this.keys.delete(e.code);
    bus.emit('input:key', e.code, false, e);
  }

  onMove(e) {
    if (!this.locked) return;
    this.mouse.dx += e.movementX || 0;
    this.mouse.dy += e.movementY || 0;
  }

  onDown(e) {
    if (this.captureBind) {
      e.preventDefault();
      const fn = this.captureBind;
      this.captureBind = null;
      fn('Mouse' + e.button);
      return;
    }
    this.mouse.buttons |= 1 << e.button;
    this.keys.add('Mouse' + e.button);
    bus.emit('input:mouse', e.button, true);
  }

  onUp(e) {
    this.mouse.buttons &= ~(1 << e.button);
    this.keys.delete('Mouse' + e.button);
    bus.emit('input:mouse', e.button, false);
  }

  onWheel(e) {
    this.mouse.wheel += Math.sign(e.deltaY);
    if (this.locked) bus.emit('input:wheel', Math.sign(e.deltaY));
  }

  /** Consume accumulated mouse motion for this frame. */
  takeMouse() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    return d;
  }

  down(action) {
    const code = S.binds[action];
    return code ? this.keys.has(code) : false;
  }

  rawDown(code) { return this.keys.has(code); }

  bindLabel(code) {
    if (!code) return '—';
    if (code.startsWith('Mouse')) return ['LMB', 'MMB', 'RMB', 'M4', 'M5'][+code.slice(5)] || code;
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
    return code.replace('Left', ' L').replace('Right', ' R').replace('Control', 'CTRL').toUpperCase();
  }

  captureNext(fn) { this.captureBind = fn; }
}
