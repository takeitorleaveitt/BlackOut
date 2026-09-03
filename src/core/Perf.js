// Frame timing, FPS history and adaptive render-scale.  The adaptive step is
// deliberately slow and hysteretic so it never oscillates mid-firefight.

export class Perf {
  constructor() {
    this.frames = 0;
    this.fps = 0;
    this.frameMs = 0;
    this.avgMs = 16.7;
    this.min = 999; this.max = 0;
    this.history = new Float32Array(120);
    this.hi = 0;
    this._acc = 0;
    this._last = performance.now();
    this._sec = performance.now();
    this.drawCalls = 0;
    this.triangles = 0;
    this.adaptive = { enabled: false, scale: 1, cooldown: 0 };
  }

  begin() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this._last) / 1000);
    this._last = now;
    this.frameMs = dt * 1000;
    this.avgMs += (this.frameMs - this.avgMs) * 0.06;
    this.history[this.hi] = this.frameMs;
    this.hi = (this.hi + 1) % this.history.length;
    this.frames++;
    if (now - this._sec >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this._sec));
      this.frames = 0;
      this._sec = now;
      this.min = 999; this.max = 0;
      for (let i = 0; i < this.history.length; i++) {
        const v = this.history[i];
        if (v > 0) { if (v < this.min) this.min = v; if (v > this.max) this.max = v; }
      }
    }
    return dt;
  }

  onePercentLow() {
    const arr = Array.from(this.history).filter((v) => v > 0).sort((a, b) => b - a);
    if (!arr.length) return 0;
    return Math.round(1000 / arr[Math.floor(arr.length * 0.01)] || 0);
  }

  /** Returns a new render scale suggestion, or 0 for "leave it alone". */
  suggestScale(current, dt, targetMs = 16.7) {
    if (!this.adaptive.enabled) return 0;
    this.adaptive.cooldown -= dt;
    if (this.adaptive.cooldown > 0) return 0;
    if (this.avgMs > targetMs * 1.35 && current > 0.6) {
      this.adaptive.cooldown = 1.6;
      return Math.max(0.6, current - 0.07);
    }
    if (this.avgMs < targetMs * 0.78 && current < 1.0) {
      this.adaptive.cooldown = 3.0;
      return Math.min(1.0, current + 0.05);
    }
    return 0;
  }
}

export const perf = new Perf();
