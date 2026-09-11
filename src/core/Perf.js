// Frame timing, FPS history and the adaptive render-scale.
//
// Two clocks, and the difference between them is the whole point:
//
//   frameMs   how far apart two RENDERED frames are. This is what the FPS
//             counter reports and what the 1% low is computed from. It
//             includes everything — our work, the driver's, the compositor's,
//             and the wait for vsync.
//   workMs    how long begin()..endFrame() took, i.e. the CPU cost of one
//             frame's updates plus issuing its draw calls. It does NOT
//             include GPU execution, which runs on after the last call
//             returns, so it is a floor on the true cost, never a ceiling.
//
// The adaptive scaler reads both, because either one alone lies. workMs alone
// misses a GPU-bound frame entirely (the CPU finishes early and waits).
// frameMs alone is pinned at the vsync interval on any machine with headroom,
// so it can never say "there is room to give the image back". Wanting the
// image back is why we look at workMs at all.
export class Perf {
  constructor() {
    this.frames = 0;
    this.fps = 0;
    this.frameMs = 16.7;
    this.avgMs = 16.7;
    this.workMs = 0;
    this.avgWorkMs = 0;
    this.min = 999; this.max = 0;
    this.history = new Float32Array(120);
    this.hi = 0;
    this._last = performance.now();
    this._sec = performance.now();
    this._frameStart = this._last;
    this._rendered = this._last;
    this.drawCalls = 0;
    this.triangles = 0;
    // budgetMs is how long one frame is allowed to take. The engine sets it
    // from the FPS limit; with no limit we aim at 60, because a stable 60 with
    // a slightly softer image beats a jittery 45 with a sharp one.
    this.budgetMs = 1000 / 60;
    this.adaptive = { enabled: true, cooldown: 0 };
  }

  /** Start of a frame. Returns dt in seconds since the last call. */
  begin() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this._last) / 1000);
    this._last = now;
    this._frameStart = now;
    return dt;
  }

  /**
   * End of a frame that actually rendered.
   *
   * Frames skipped by the FPS limiter must NOT come through here. They cost
   * nothing and arrive at the display's rate, so counting them made the FPS
   * readout report the refresh rate instead of the frame rate, and left the
   * adaptive scaler convinced every capped machine had all the headroom in
   * the world.
   */
  endFrame() {
    const now = performance.now();
    this.workMs = now - this._frameStart;
    this.avgWorkMs += (this.workMs - this.avgWorkMs) * 0.06;
    this.frameMs = Math.min(250, now - this._rendered);
    this._rendered = now;
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
  }

  onePercentLow() {
    const arr = Array.from(this.history).filter((v) => v > 0).sort((a, b) => b - a);
    if (!arr.length) return 0;
    return Math.round(1000 / arr[Math.floor(arr.length * 0.01)] || 0);
  }

  /**
   * A new render scale, or 0 for "leave it alone".
   *
   * `ceiling` is the player's own Render scale setting: adaptive only ever
   * takes resolution AWAY from what they asked for and gives it back up to
   * that line. Driving it past the slider would make the slider a suggestion.
   *
   * Down is fast and up is slow on purpose. Dropping late costs a stutter in
   * a firefight; climbing early costs a second stutter when the firefight
   * resumes, so the climb waits twice as long and steps a third as far.
   */
  suggestScale(current, dt, ceiling = 1) {
    if (!this.adaptive.enabled) return 0;
    this.adaptive.cooldown -= dt;
    if (this.adaptive.cooldown > 0) return 0;
    const budget = this.budgetMs;
    const cap = clampScale(Math.min(1, ceiling));
    if (current > cap + 1e-6) { this.adaptive.cooldown = 0.5; return cap; }
    const i = nearestStep(current);
    // Missing the target frame rate, or about to: on the CPU alone we are
    // already inside 8% of the whole budget, so the GPU half cannot fit.
    const struggling = this.avgMs > budget * 1.22 || this.avgWorkMs > budget * 0.92;
    if (struggling && i > 0) {
      this.adaptive.cooldown = 1.4;
      return STEPS[i - 1];
    }
    // Hitting the target with the CPU side costing under half of it. Two
    // separate conditions: the second is what stops us climbing back up on a
    // machine that is only keeping pace because we scaled down.
    if (!struggling && this.avgMs < budget * 1.06 && this.avgWorkMs < budget * 0.5 &&
        i < STEPS.length - 1 && STEPS[i + 1] <= cap) {
      this.adaptive.cooldown = 4.0;
      return STEPS[i + 1];
    }
    return 0;
  }
}

/**
 * The rungs the adaptive scaler is allowed to stand on.
 *
 * It used to move in free 0.05 and 0.07 increments, which meant a machine
 * hovering near the budget could visit a dozen different resolutions in a
 * minute. Every one of those costs a reallocation of the whole post chain's
 * render targets — a real hitch, in the middle of exactly the firefight that
 * triggered the drop. Five rungs, and a machine settles onto one and stays
 * there. The bottom rung is where the image turns to mush and a player would
 * rather have the stutter.
 */
const STEPS = [0.55, 0.65, 0.75, 0.85, 1.0];

const clampScale = (v) => STEPS.reduce((best, s) => (s <= v + 1e-6 && s > best ? s : best), STEPS[0]);

/** Index of the rung nearest `v`, so a hand-set scale still steps sensibly. */
function nearestStep(v) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < STEPS.length; i++) {
    const d = Math.abs(STEPS[i] - v);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

export const perf = new Perf();
