// Procedural sound synthesis.
//
// Every sound in the game is generated as an AudioBuffer at runtime — gunshots,
// impacts, footsteps, mechanical action, breathing, ambience.  Nothing is
// downloaded, and each weapon's report is built from its own spectral profile
// so an AK and an MP7 are unmistakable even with your eyes shut.

const cache = new Map();

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------
function noise(n, rng = Math.random) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = rng() * 2 - 1;
  return a;
}

/** One-pole low-pass, in place. */
function lowpass(buf, cutoff, sr) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sr;
  const a = dt / (rc + dt);
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; }
  return buf;
}

/** One-pole high-pass, in place. */
function highpass(buf, cutoff, sr) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sr;
  const a = rc / (rc + dt);
  let prevIn = buf[0], prevOut = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    prevOut = a * (prevOut + x - prevIn);
    prevIn = x;
    buf[i] = prevOut;
  }
  return buf;
}

/** State-variable band-pass, in place. */
function bandpass(buf, freq, q, sr) {
  const f = 2 * Math.sin(Math.PI * Math.min(freq, sr * 0.45) / sr);
  const damp = 1 / Math.max(0.5, q);
  let low = 0, band = 0;
  for (let i = 0; i < buf.length; i++) {
    const inp = buf[i];
    low += f * band;
    const high = inp - low - damp * band;
    band += f * high;
    buf[i] = band;
  }
  return buf;
}

function normalize(buf, peak = 1) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m < 1e-6) return buf;
  const g = peak / m;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

function toBuffer(ctx, channels) {
  const len = channels[0].length;
  const b = ctx.createBuffer(channels.length, len, ctx.sampleRate);
  for (let c = 0; c < channels.length; c++) b.copyToChannel(channels[c], c);
  return b;
}

const env = (i, n, attack, decay, curve = 2) => {
  const t = i / n;
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  const d = Math.exp(-t / Math.max(0.0001, decay) * curve);
  return a * d;
};

// ---------------------------------------------------------------------------
// impulse responses
// ---------------------------------------------------------------------------
const SPACES = {
  outdoor: { time: 0.55, damp: 5200, density: 0.24, pre: 0.004, spread: 0.9, level: 0.30 },
  forest: { time: 1.05, damp: 2600, density: 0.55, pre: 0.010, spread: 1.0, level: 0.42 },
  hall: { time: 1.85, damp: 3200, density: 0.90, pre: 0.014, spread: 0.85, level: 0.85 },
  garage: { time: 2.40, damp: 2200, density: 0.95, pre: 0.018, spread: 0.8, level: 0.95 },
  room: { time: 0.62, damp: 2800, density: 0.85, pre: 0.005, spread: 0.7, level: 0.62 },
  house: { time: 0.48, damp: 2400, density: 0.80, pre: 0.004, spread: 0.65, level: 0.58 },
  office: { time: 0.72, damp: 2600, density: 0.82, pre: 0.006, spread: 0.7, level: 0.60 },
  stair: { time: 1.55, damp: 3600, density: 0.92, pre: 0.010, spread: 0.75, level: 0.88 }
};

export function makeImpulse(ctx, spaceKey) {
  const key = 'ir:' + spaceKey;
  if (cache.has(key)) return cache.get(key);
  const s = SPACES[spaceKey] || SPACES.room;
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * s.time);
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const buf = new Float32Array(n);
    const preN = Math.floor(sr * s.pre * (1 + c * 0.12));
    for (let i = 0; i < n; i++) {
      if (i < preN) { buf[i] = 0; continue; }
      const t = (i - preN) / (n - preN);
      const decay = Math.exp(-t * (6.5 - s.density * 2.5));
      // sparse early reflections then diffuse tail
      const sparse = t < 0.12 ? (Math.random() < 0.06 + s.density * 0.2 ? 1 : 0.08) : 1;
      buf[i] = (Math.random() * 2 - 1) * decay * sparse;
    }
    lowpass(buf, s.damp, sr);
    highpass(buf, 90, sr);
    normalize(buf, 0.85 * (c === 0 ? 1 : s.spread));
    chans.push(buf);
  }
  const b = toBuffer(ctx, chans);
  b.userLevel = s.level;
  cache.set(key, b);
  return b;
}

export const spaceLevel = (k) => (SPACES[k] || SPACES.room).level;

// ---------------------------------------------------------------------------
// gunshots
// ---------------------------------------------------------------------------
/**
 * Build one gunshot variant.
 * profile: { punch, body, crack, tail, level, tone } from the weapon table.
 */
export function makeGunshot(ctx, profile, variant = 0, opts = {}) {
  const key = `gun:${profile.punch}:${profile.body}:${profile.crack}:${profile.tail}:${variant}:${opts.suppressed ? 's' : ''}:${opts.distant ? 'd' : ''}`;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const suppressed = !!opts.suppressed;
  const distant = !!opts.distant;
  const dur = distant ? 0.85 : suppressed ? 0.28 : 0.55 + profile.tail * 0.55;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const vr = 1 + (variant - 1.5) * 0.035;      // per-variant pitch drift

  // 1. muzzle blast: broadband noise, extremely fast attack
  const blast = noise(Math.floor(sr * (suppressed ? 0.05 : 0.14)));
  for (let i = 0; i < blast.length; i++) {
    blast[i] *= env(i, blast.length, 0.0008, suppressed ? 0.09 : 0.13, 3.2);
  }
  const crackF = profile.crack * vr * (suppressed ? 0.42 : 1) * (distant ? 0.25 : 1);
  const blastCopy = blast.slice();
  bandpass(blastCopy, crackF, 0.9, sr);
  for (let i = 0; i < blast.length; i++) blast[i] = blast[i] * 0.35 + blastCopy[i] * 1.5;
  if (distant) lowpass(blast, 900, sr);

  // 2. body: pitched thump that gives each calibre its weight
  const bodyN = Math.floor(sr * (suppressed ? 0.10 : 0.22));
  const body = new Float32Array(bodyN);
  let phase = 0;
  for (let i = 0; i < bodyN; i++) {
    const t = i / bodyN;
    const f = profile.punch * vr * (1 - t * 0.55) + profile.body * 0.12 * (1 - t);
    phase += (2 * Math.PI * f) / sr;
    const e = env(i, bodyN, 0.0012, 0.20, 2.6);
    body[i] = (Math.sin(phase) * 0.75 + Math.sin(phase * 2.02) * 0.28 + (Math.random() * 2 - 1) * 0.20) * e;
  }

  // 3. resonant "body of the gun" ring
  const ringN = Math.floor(sr * 0.16);
  const ring = noise(ringN);
  for (let i = 0; i < ringN; i++) ring[i] *= env(i, ringN, 0.001, 0.10, 3);
  bandpass(ring, profile.body * vr, 5.5, sr);

  // 4. tail — the shot leaving, before any room reverb is applied
  const tailN = Math.floor(sr * dur * 0.9);
  const tail = noise(tailN);
  for (let i = 0; i < tailN; i++) tail[i] *= env(i, tailN, 0.004, distant ? 0.55 : 0.22, 2.2);
  lowpass(tail, distant ? 620 : 1500 + profile.tone * 1800, sr);

  // 5. mechanical action (bolt slamming) — absent on a distant report
  const mechN = Math.floor(sr * 0.09);
  const mech = noise(mechN);
  for (let i = 0; i < mechN; i++) {
    const d = Math.max(0, i - Math.floor(sr * 0.018));
    mech[i] *= env(d, mechN, 0.0005, 0.035, 4);
  }
  bandpass(mech, 2600 * vr, 2.2, sr);

  const blastGain = suppressed ? 0.42 : distant ? 0.55 : 1.0;
  const bodyGain = suppressed ? 0.30 : distant ? 0.85 : 0.95;
  const tailGain = (suppressed ? 0.22 : distant ? 1.0 : 0.42) * (0.6 + profile.tail);
  const mechGain = distant ? 0.0 : suppressed ? 0.55 : 0.30;

  for (let i = 0; i < n; i++) {
    let v = 0;
    if (i < blast.length) v += blast[i] * blastGain;
    if (i < bodyN) v += body[i] * bodyGain;
    if (i < ringN) v += ring[i] * 0.35;
    if (i < tailN) v += tail[i] * tailGain;
    if (i < mechN) v += mech[i] * mechGain;
    out[i] = v;
  }
  highpass(out, distant ? 45 : 70, sr);
  // soft clip: real recordings of gunfire always slam the preamp
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 1.35) * 0.92;
  normalize(out, distant ? 0.55 : suppressed ? 0.5 : 0.95);

  const b = toBuffer(ctx, [out]);
  cache.set(key, b);
  return b;
}

/** Supersonic crack heard when a round passes close by. */
export function makeBulletCrack(ctx, variant = 0) {
  const key = 'crack:' + variant;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.10);
  const out = noise(n);
  for (let i = 0; i < n; i++) out[i] *= env(i, n, 0.0003, 0.035, 5);
  bandpass(out, 2600 + variant * 700, 1.1, sr);
  highpass(out, 900, sr);
  normalize(out, 0.85);
  const b = toBuffer(ctx, [out]);
  cache.set(key, b);
  return b;
}

/** Bullet snapping past — the whip that follows the crack. */
export function makeWhizz(ctx, variant = 0) {
  const key = 'whizz:' + variant;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.22);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = 1800 * (1 - t * 0.8) + 260;      // doppler down-sweep
    phase += (2 * Math.PI * f) / sr;
    out[i] = (Math.sin(phase) * 0.5 + (Math.random() * 2 - 1) * 0.5) * Math.exp(-t * 6) * (t < 0.05 ? t / 0.05 : 1);
  }
  bandpass(out, 1400 + variant * 250, 1.4, sr);
  normalize(out, 0.6);
  const b = toBuffer(ctx, [out]);
  cache.set(key, b);
  return b;
}

// ---------------------------------------------------------------------------
// impacts, footsteps, casings
// ---------------------------------------------------------------------------
const IMPACT = {
  concrete: { f: 1500, q: 1.1, d: 0.055, lp: 5200, tone: 0 },
  plaster: { f: 1100, q: 1.2, d: 0.07, lp: 3600, tone: 0 },
  tile: { f: 2600, q: 2.4, d: 0.06, lp: 8000, tone: 0.2 },
  metal: { f: 3200, q: 7.0, d: 0.22, lp: 11000, tone: 0.8 },
  wood: { f: 800, q: 2.2, d: 0.09, lp: 3400, tone: 0.15 },
  glass: { f: 5200, q: 5.0, d: 0.30, lp: 14000, tone: 0.9 },
  dirt: { f: 420, q: 0.9, d: 0.06, lp: 1500, tone: 0 },
  grass: { f: 700, q: 0.8, d: 0.05, lp: 2200, tone: 0 },
  gravel: { f: 1800, q: 1.4, d: 0.08, lp: 6000, tone: 0.1 },
  carpet: { f: 500, q: 0.8, d: 0.045, lp: 1200, tone: 0 },
  fabric: { f: 600, q: 0.7, d: 0.05, lp: 1400, tone: 0 },
  water: { f: 900, q: 1.0, d: 0.12, lp: 2600, tone: 0.3 },
  flesh: { f: 260, q: 1.4, d: 0.08, lp: 900, tone: 0 }
};

export function makeImpact(ctx, surface, variant = 0) {
  const key = `imp:${surface}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const p = IMPACT[surface] || IMPACT.concrete;
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * (p.d + 0.12));
  const out = noise(n);
  const vr = 1 + (variant - 1.5) * 0.09;
  for (let i = 0; i < n; i++) out[i] *= env(i, n, 0.0006, p.d * 1.6, 3);
  const ring = out.slice();
  bandpass(ring, p.f * vr, p.q, sr);
  lowpass(out, p.lp, sr);
  for (let i = 0; i < n; i++) out[i] = out[i] * (1 - p.tone) * 0.7 + ring[i] * (0.6 + p.tone * 1.4);
  if (surface === 'glass') {
    // a couple of tinkling shards after the break
    for (let k = 0; k < 5; k++) {
      const off = Math.floor(sr * (0.04 + Math.random() * 0.22));
      const sn = Math.floor(sr * 0.05);
      for (let i = 0; i < sn && off + i < n; i++) {
        out[off + i] += (Math.random() * 2 - 1) * Math.exp(-i / sn * 5) * 0.35;
      }
    }
    bandpass(out, 6200, 3.0, sr);
  }
  normalize(out, 0.8);
  const b = toBuffer(ctx, [out]);
  cache.set(key, b);
  return b;
}

const FOOT = {
  concrete: { f: 900, q: 1.2, d: 0.05, lp: 4200, grit: 0.5 },
  tile: { f: 1800, q: 2.0, d: 0.045, lp: 7000, grit: 0.35 },
  metal: { f: 2400, q: 4.5, d: 0.16, lp: 9000, grit: 0.3 },
  wood: { f: 420, q: 2.0, d: 0.075, lp: 2600, grit: 0.25 },
  carpet: { f: 260, q: 0.8, d: 0.05, lp: 900, grit: 0.15 },
  grass: { f: 480, q: 0.7, d: 0.06, lp: 1800, grit: 0.9 },
  dirt: { f: 340, q: 0.8, d: 0.05, lp: 1300, grit: 0.7 },
  gravel: { f: 1400, q: 1.0, d: 0.09, lp: 6500, grit: 1.0 },
  water: { f: 700, q: 0.9, d: 0.14, lp: 2400, grit: 0.6 },
  glass: { f: 4200, q: 3.0, d: 0.12, lp: 12000, grit: 0.9 },
  plaster: { f: 800, q: 1.2, d: 0.05, lp: 3600, grit: 0.4 },
  fabric: { f: 300, q: 0.8, d: 0.05, lp: 1100, grit: 0.2 }
};

export function makeFootstep(ctx, surface, variant = 0) {
  const key = `foot:${surface}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const p = FOOT[surface] || FOOT.concrete;
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * (p.d + 0.14));
  const out = new Float32Array(n);
  const vr = 1 + (variant - 1.5) * 0.12;

  // heel strike
  const heel = noise(Math.floor(sr * (p.d + 0.05)));
  for (let i = 0; i < heel.length; i++) heel[i] *= env(i, heel.length, 0.0012, p.d * 1.2, 3);
  bandpass(heel, p.f * vr, p.q, sr);

  // grit / scuff
  const gritN = Math.floor(sr * 0.11);
  const grit = noise(gritN);
  for (let i = 0; i < gritN; i++) {
    grit[i] *= env(i, gritN, 0.02, 0.10, 2) * (0.4 + Math.random() * 0.6);
  }
  bandpass(grit, 3800 * vr, 0.9, sr);

  for (let i = 0; i < n; i++) {
    let v = 0;
    if (i < heel.length) v += heel[i] * 0.9;
    const gi = i - Math.floor(sr * 0.012);
    if (gi >= 0 && gi < gritN) v += grit[gi] * p.grit * 0.55;
    out[i] = v;
  }
  lowpass(out, p.lp, sr);
  highpass(out, 65, sr);
  normalize(out, 0.7);
  const b = toBuffer(ctx, [out]);
  cache.set(key, b);
  return b;
}

export function makeCasing(ctx, surface, isShell = false, variant = 0) {
  const key = `case:${surface}:${isShell}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * (isShell ? 0.22 : 0.34));
  const out = new Float32Array(n);
  const hard = surface === 'carpet' || surface === 'grass' || surface === 'dirt' || surface === 'fabric' ? 0.22 : 1;
  const bounces = isShell ? 2 : 3 + ((variant + surface.length) % 3);
  for (let k = 0; k < bounces; k++) {
    const off = Math.floor(sr * (k * (0.045 + Math.random() * 0.05)));
    const bn = Math.floor(sr * 0.09);
    const amp = Math.pow(0.55, k) * hard;
    const tmp = noise(bn);
    for (let i = 0; i < bn; i++) tmp[i] *= env(i, bn, 0.0004, isShell ? 0.02 : 0.05, 4);
    bandpass(tmp, (isShell ? 1400 : 4200) * (0.85 + Math.random() * 0.35), isShell ? 2 : 9, sr);
    for (let i = 0; i < bn && off + i < n; i++) out[off + i] += tmp[i] * amp;
  }
  highpass(out, isShell ? 300 : 1200, sr);
  normalize(out, 0.5);
  const b = toBuffer(ctx, [out]);
  cache.set(key, b);
  return b;
}

// ---------------------------------------------------------------------------
// mechanical / body / UI
// ---------------------------------------------------------------------------
const MECH = {
  magOut: { f: 900, q: 3, d: 0.09, clicks: [[0, 1], [0.05, 0.5]], hp: 200 },
  magIn: { f: 700, q: 2.5, d: 0.10, clicks: [[0, 0.8], [0.03, 1]], hp: 160 },
  boltBack: { f: 1800, q: 4, d: 0.07, clicks: [[0, 1]], hp: 400 },
  boltRelease: { f: 2400, q: 5, d: 0.09, clicks: [[0, 1], [0.02, 0.7]], hp: 500 },
  pumpBack: { f: 1200, q: 3, d: 0.10, clicks: [[0, 1]], hp: 250 },
  pumpForward: { f: 1500, q: 4, d: 0.11, clicks: [[0, 1], [0.04, 0.85]], hp: 300 },
  shell: { f: 800, q: 2, d: 0.06, clicks: [[0, 1]], hp: 180 },
  dryfire: { f: 3200, q: 8, d: 0.04, clicks: [[0, 1]], hp: 900 },
  select: { f: 2800, q: 7, d: 0.03, clicks: [[0, 1]], hp: 800 },
  safety: { f: 2000, q: 6, d: 0.035, clicks: [[0, 1], [0.025, 0.6]], hp: 700 },
  cloth: { f: 420, q: 0.6, d: 0.16, clicks: [[0, 1]], hp: 120 },
  gearRattle: { f: 1600, q: 1.4, d: 0.20, clicks: [[0, 0.7], [0.06, 0.9], [0.13, 0.5]], hp: 380 }
};

export function makeMech(ctx, kind, variant = 0) {
  const key = `mech:${kind}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const p = MECH[kind] || MECH.select;
  const sr = ctx.sampleRate;
  const total = p.clicks[p.clicks.length - 1][0] + p.d + 0.06;
  const n = Math.floor(sr * total);
  const out = new Float32Array(n);
  const vr = 1 + (variant - 1.5) * 0.07;
  for (const [off, amp] of p.clicks) {
    const o = Math.floor(sr * off);
    const cn = Math.floor(sr * (p.d + 0.04));
    const tmp = noise(cn);
    for (let i = 0; i < cn; i++) tmp[i] *= env(i, cn, 0.0004, p.d * 0.8, 3.5);
    bandpass(tmp, p.f * vr * (0.92 + Math.random() * 0.16), p.q, sr);
    for (let i = 0; i < cn && o + i < n; i++) out[o + i] += tmp[i] * amp;
  }
  highpass(out, p.hp, sr);
  normalize(out, 0.55);
  const b = toBuffer(ctx, [out]);
  cache.set(key, b);
  return b;
}

/** Knife swing — a bright cutting transient sweeping down into a soft air tail. */
export function makeSwing(ctx, variant = 0) {
  const key = 'swing:' + variant;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.22);
  const vr = 1 + (variant - 1.5) * 0.06;
  const raw = noise(n);
  const hi = raw.slice(), lo = raw.slice();
  bandpass(hi, 2600 * vr, 1.1, sr);
  bandpass(lo, 850 * vr, 1.0, sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const mix = i / n; // sweep from the sharp cut transient into the lower tail
    out[i] = (hi[i] * (1 - mix) + lo[i] * mix) * env(i, n, 0.008, 0.13, 2.6);
  }
  highpass(out, 260, sr);
  normalize(out, 0.5);
  const b = toBuffer(ctx, [out]);
  cache.set(key, b);
  return b;
}

export function makePain(ctx, variant = 0) {
  const key = 'pain:' + variant;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.42);
  const out = new Float32Array(n);
  let phase = 0;
  const base = 132 * (1 + (variant - 1.5) * 0.16);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = base * (1 - t * 0.32);
    phase += (2 * Math.PI * f) / sr;
    const g = Math.sin(Math.PI * Math.pow(t, 0.6));
    out[i] = (Math.sin(phase) * 0.35 + Math.sin(phase * 2.3) * 0.18 + (Math.random() * 2 - 1) * 0.55) * g;
  }
  bandpass(out, 700, 0.8, sr);
  lowpass(out, 3200, sr);
  normalize(out, 0.6);
  const b = toBuffer(ctx, [out]);
  cache.set(key, b);
  return b;
}

export function makeUi(ctx, kind = 'hover') {
  const key = 'ui:' + kind;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const map = {
    hover: { f: 2200, d: 0.035, n: 0.06, tone: 0.3 },
    click: { f: 900, d: 0.06, n: 0.10, tone: 0.55 },
    back: { f: 520, d: 0.09, n: 0.14, tone: 0.5 },
    open: { f: 320, d: 0.28, n: 0.34, tone: 0.7 },
    error: { f: 180, d: 0.22, n: 0.26, tone: 0.8 },
    accept: { f: 1400, d: 0.16, n: 0.22, tone: 0.6 },
    tick: { f: 4200, d: 0.02, n: 0.04, tone: 0.2 }
  };
  const p = map[kind] || map.hover;
  const n = Math.floor(sr * p.n);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = p.f * (kind === 'error' ? 1 - t * 0.4 : kind === 'accept' ? 1 + t * 0.6 : 1);
    phase += (2 * Math.PI * f) / sr;
    const e = Math.exp(-t / p.d * 2.2) * Math.min(1, t / 0.02);
    out[i] = (Math.sin(phase) * p.tone + (Math.random() * 2 - 1) * (1 - p.tone) * 0.7) * e;
  }
  highpass(out, 160, sr);
  normalize(out, 0.42);
  const b = toBuffer(ctx, [out]);
  cache.set(key, b);
  return b;
}

// ---------------------------------------------------------------------------
// looping ambience beds
// ---------------------------------------------------------------------------
export function makeAmbience(ctx, kind) {
  const key = 'amb:' + kind;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const dur = 6;
  const n = Math.floor(sr * dur);
  const L = new Float32Array(n), R = new Float32Array(n);

  const fill = (buf, fn) => { for (let i = 0; i < n; i++) buf[i] = fn(i / sr, i); };

  switch (kind) {
    case 'wind': {
      fill(L, () => Math.random() * 2 - 1);
      fill(R, () => Math.random() * 2 - 1);
      lowpass(L, 380, sr); lowpass(R, 420, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const g = 0.55 + 0.45 * Math.sin(t * 0.35) * Math.sin(t * 0.11 + 1.7);
        L[i] *= g; R[i] *= g * 0.95;
      }
      break;
    }
    case 'wind_trees': {
      fill(L, () => Math.random() * 2 - 1);
      fill(R, () => Math.random() * 2 - 1);
      bandpass(L, 2400, 0.6, sr); bandpass(R, 2700, 0.6, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const g = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.22) * Math.sin(t * 0.07 + 0.9));
        L[i] *= g; R[i] *= g;
      }
      break;
    }
    case 'crickets': {
      for (let k = 0; k < 26; k++) {
        const rate = 3.4 + Math.random() * 3.4;
        const f = 3800 + Math.random() * 2600;
        const pan = Math.random();
        const off = Math.random() * dur;
        for (let c = 0; c < dur * rate; c++) {
          const start = Math.floor(((off + c / rate) % dur) * sr);
          const cn = Math.floor(sr * 0.022);
          for (let i = 0; i < cn; i++) {
            const idx = (start + i) % n;
            const v = Math.sin((2 * Math.PI * f * i) / sr) * Math.exp(-i / cn * 3) * 0.05;
            L[idx] += v * (1 - pan); R[idx] += v * pan;
          }
        }
      }
      break;
    }
    case 'electric_hum': {
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const v = Math.sin(2 * Math.PI * 100 * t) * 0.22 + Math.sin(2 * Math.PI * 200 * t) * 0.12
          + Math.sin(2 * Math.PI * 300 * t) * 0.05 + (Math.random() * 2 - 1) * 0.03;
        L[i] = v; R[i] = v * 0.94;
      }
      break;
    }
    case 'machinery': {
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const v = Math.sin(2 * Math.PI * 47 * t) * 0.28 + Math.sin(2 * Math.PI * 94 * t) * 0.12
          + Math.sin(2 * Math.PI * 12 * t) * 0.10 + (Math.random() * 2 - 1) * 0.16;
        L[i] = v; R[i] = v * 0.9 + (Math.random() * 2 - 1) * 0.05;
      }
      lowpass(L, 1800, sr); lowpass(R, 1600, sr);
      break;
    }
    case 'vent_rumble': {
      fill(L, () => Math.random() * 2 - 1);
      fill(R, () => Math.random() * 2 - 1);
      lowpass(L, 220, sr); lowpass(R, 240, sr);
      for (let i = 0; i < n; i++) { L[i] *= 1.6; R[i] *= 1.55; }
      break;
    }
    case 'dripping': {
      for (let k = 0; k < 9; k++) {
        const period = 0.7 + Math.random() * 2.4;
        const pan = Math.random();
        for (let c = 0; c * period < dur; c++) {
          const start = Math.floor(((c * period + Math.random() * 0.1) % dur) * sr);
          const cn = Math.floor(sr * 0.10);
          const f = 900 + Math.random() * 1400;
          for (let i = 0; i < cn; i++) {
            const idx = (start + i) % n;
            const t = i / cn;
            const v = Math.sin((2 * Math.PI * f * (1 + t * 1.6) * i) / sr) * Math.exp(-t * 7) * 0.22;
            L[idx] += v * (1 - pan); R[idx] += v * pan;
          }
        }
      }
      break;
    }
    case 'fire': {
      fill(L, () => Math.random() * 2 - 1);
      fill(R, () => Math.random() * 2 - 1);
      lowpass(L, 700, sr); lowpass(R, 760, sr);
      for (let k = 0; k < 60; k++) {
        const start = Math.floor(Math.random() * n);
        const cn = Math.floor(sr * 0.03);
        for (let i = 0; i < cn; i++) {
          const idx = (start + i) % n;
          const v = (Math.random() * 2 - 1) * Math.exp(-i / cn * 4) * 0.5;
          L[idx] += v; R[idx] += v * 0.8;
        }
      }
      break;
    }
    case 'metal_creak': {
      for (let k = 0; k < 7; k++) {
        const start = Math.floor(Math.random() * n);
        const cn = Math.floor(sr * (0.4 + Math.random() * 0.9));
        const f = 180 + Math.random() * 340;
        const pan = Math.random();
        for (let i = 0; i < cn; i++) {
          const idx = (start + i) % n;
          const t = i / cn;
          const wob = Math.sin(t * 40 + Math.sin(t * 9) * 3);
          const v = Math.sin((2 * Math.PI * f * (1 + wob * 0.04) * i) / sr) * Math.sin(Math.PI * t) * 0.16;
          L[idx] += v * (1 - pan); R[idx] += v * pan;
        }
      }
      break;
    }
    case 'steam': {
      fill(L, () => Math.random() * 2 - 1);
      fill(R, () => Math.random() * 2 - 1);
      bandpass(L, 5200, 0.8, sr); bandpass(R, 5600, 0.8, sr);
      for (let i = 0; i < n; i++) {
        const g = 0.5 + 0.5 * Math.sin((i / sr) * 0.9);
        L[i] *= g * 1.4; R[i] *= g * 1.35;
      }
      break;
    }
    case 'owl': {
      for (let k = 0; k < 3; k++) {
        const start = Math.floor(Math.random() * n);
        const cn = Math.floor(sr * 0.42);
        const f = 380 + Math.random() * 160;
        for (let i = 0; i < cn; i++) {
          const idx = (start + i) % n;
          const t = i / cn;
          const v = Math.sin((2 * Math.PI * f * i) / sr) * Math.sin(Math.PI * t) * 0.18
            * (t < 0.35 ? 1 : t < 0.5 ? 0 : 0.8);
          L[idx] += v; R[idx] += v * 0.9;
        }
      }
      break;
    }
    case 'tv_static': {
      fill(L, () => Math.random() * 2 - 1);
      fill(R, () => Math.random() * 2 - 1);
      highpass(L, 1800, sr); highpass(R, 2000, sr);
      for (let i = 0; i < n; i++) { L[i] *= 0.5; R[i] *= 0.48; }
      break;
    }
    default: {
      fill(L, () => Math.random() * 2 - 1);
      fill(R, () => Math.random() * 2 - 1);
      lowpass(L, 500, sr); lowpass(R, 520, sr);
    }
  }

  // crossfade the ends so the loop is seamless
  const fade = Math.floor(sr * 0.35);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    L[i] = L[i] * t + L[n - fade + i] * (1 - t);
    R[i] = R[i] * t + R[n - fade + i] * (1 - t);
  }
  normalize(L, 0.5); normalize(R, 0.5);
  const b = toBuffer(ctx, [L, R]);
  cache.set(key, b);
  return b;
}

/** Low, slow menu drone — tense but out of the way. */
export function makeMenuBed(ctx) {
  if (cache.has('menuBed')) return cache.get('menuBed');
  const sr = ctx.sampleRate;
  const dur = 16;
  const n = Math.floor(sr * dur);
  const L = new Float32Array(n), R = new Float32Array(n);
  const roots = [55, 82.5, 110, 164.8];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (let k = 0; k < roots.length; k++) {
      const amp = (0.16 / (k + 1)) * (0.6 + 0.4 * Math.sin(t * (0.07 + k * 0.031) + k));
      v += Math.sin(2 * Math.PI * roots[k] * t + Math.sin(t * 0.13 + k) * 0.6) * amp;
    }
    v += (Math.random() * 2 - 1) * 0.012;
    L[i] = v;
    R[i] = v * 0.92 + Math.sin(2 * Math.PI * 55.4 * t) * 0.05;
  }
  lowpass(L, 1400, sr); lowpass(R, 1300, sr);
  const fade = Math.floor(sr * 1.2);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    L[i] = L[i] * t + L[n - fade + i] * (1 - t);
    R[i] = R[i] * t + R[n - fade + i] * (1 - t);
  }
  normalize(L, 0.42); normalize(R, 0.42);
  const b = toBuffer(ctx, [L, R]);
  cache.set('menuBed', b);
  return b;
}

export function clearSynthCache() { cache.clear(); }
