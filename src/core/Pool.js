/**
 * Generic object pool.  Used for decals, particles, tracers, casings and
 * audio voices so gameplay never allocates during a firefight.
 */
export class Pool {
  constructor(factory, reset, size = 64) {
    this.factory = factory;
    this.resetFn = reset;
    this.free = [];
    this.active = [];
    for (let i = 0; i < size; i++) this.free.push(factory(i));
  }

  acquire() {
    let o = this.free.pop();
    if (!o) o = this.factory(this.active.length + this.free.length);
    this.active.push(o);
    return o;
  }

  release(o) {
    const i = this.active.indexOf(o);
    if (i >= 0) this.active.splice(i, 1);
    if (this.resetFn) this.resetFn(o);
    this.free.push(o);
  }

  releaseAt(i) {
    const o = this.active[i];
    this.active.splice(i, 1);
    if (this.resetFn) this.resetFn(o);
    this.free.push(o);
    return o;
  }

  releaseAll() {
    while (this.active.length) this.releaseAt(this.active.length - 1);
  }

  get count() { return this.active.length; }
}
