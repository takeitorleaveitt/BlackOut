/** Minimal synchronous pub/sub used to keep systems decoupled. */
export class EventBus {
  constructor() { this.map = new Map(); }
  on(evt, fn) {
    let a = this.map.get(evt);
    if (!a) this.map.set(evt, (a = []));
    a.push(fn);
    return () => this.off(evt, fn);
  }
  once(evt, fn) {
    const off = this.on(evt, (...args) => { off(); fn(...args); });
    return off;
  }
  off(evt, fn) {
    const a = this.map.get(evt);
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  emit(evt, ...args) {
    const a = this.map.get(evt);
    if (!a) return;
    for (let i = 0; i < a.length; i++) {
      try { a[i](...args); } catch (e) { console.error('[bus]', evt, e); }
    }
  }
}

export const bus = new EventBus();
