// Level authoring kit.  Maps are authored as data: brushes (yaw-rotated boxes),
// props (from a shared catalogue that carries its own collision), lights,
// audio zones and spawn points.  The client turns this into meshes; the server
// turns the exact same data into a collision world.

import { SURFACE } from '../constants.js';

/** Prop catalogue: size + collision boxes, shared by renderer and server. */
export const PROPS = {
  crate_wood:   { size: [0.9, 0.9, 0.9], mat: SURFACE.WOOD, col: [[0, 0.45, 0, 0.9, 0.9, 0.9]] },
  crate_large:  { size: [1.4, 1.4, 1.4], mat: SURFACE.WOOD, col: [[0, 0.7, 0, 1.4, 1.4, 1.4]] },
  crate_metal:  { size: [1.0, 0.8, 1.0], mat: SURFACE.METAL, col: [[0, 0.4, 0, 1.0, 0.8, 1.0]] },
  pallet:       { size: [1.2, 0.14, 1.0], mat: SURFACE.WOOD, col: [[0, 0.07, 0, 1.2, 0.14, 1.0]] },
  barrel:       { size: [0.58, 0.88, 0.58], mat: SURFACE.METAL, col: [[0, 0.44, 0, 0.58, 0.88, 0.58]] },
  fuel_drum:    { size: [0.62, 0.94, 0.62], mat: SURFACE.METAL, col: [[0, 0.47, 0, 0.62, 0.94, 0.62]] },
  shelf_rack:   { size: [2.6, 2.4, 0.8], mat: SURFACE.METAL, col: [[0, 1.2, 0, 2.6, 2.4, 0.8]] },
  table:        { size: [1.6, 0.76, 0.9], mat: SURFACE.WOOD, col: [[0, 0.38, 0, 1.6, 0.76, 0.9]] },
  desk:         { size: [1.5, 0.74, 0.72], mat: SURFACE.WOOD, col: [[0, 0.37, 0, 1.5, 0.74, 0.72]] },
  chair:        { size: [0.5, 0.9, 0.5], mat: SURFACE.WOOD, col: [[0, 0.25, 0, 0.5, 0.5, 0.5]] },
  office_chair: { size: [0.6, 1.0, 0.6], mat: SURFACE.FABRIC, col: [[0, 0.25, 0, 0.6, 0.5, 0.6]] },
  sofa:         { size: [2.0, 0.8, 0.9], mat: SURFACE.FABRIC, col: [[0, 0.4, 0, 2.0, 0.8, 0.9]] },
  bed:          { size: [1.4, 0.55, 2.0], mat: SURFACE.FABRIC, col: [[0, 0.28, 0, 1.4, 0.55, 2.0]] },
  wardrobe:     { size: [1.2, 2.0, 0.6], mat: SURFACE.WOOD, col: [[0, 1.0, 0, 1.2, 2.0, 0.6]] },
  fridge:       { size: [0.72, 1.75, 0.7], mat: SURFACE.METAL, col: [[0, 0.88, 0, 0.72, 1.75, 0.7]] },
  counter:      { size: [2.0, 0.92, 0.65], mat: SURFACE.WOOD, col: [[0, 0.46, 0, 2.0, 0.92, 0.65]] },
  locker:       { size: [0.9, 1.9, 0.5], mat: SURFACE.METAL, col: [[0, 0.95, 0, 0.9, 1.9, 0.5]] },
  cabinet:      { size: [1.0, 1.35, 0.48], mat: SURFACE.METAL, col: [[0, 0.68, 0, 1.0, 1.35, 0.48]] },
  bookshelf:    { size: [1.1, 1.8, 0.35], mat: SURFACE.WOOD, col: [[0, 0.9, 0, 1.1, 1.8, 0.35]] },
  tv:           { size: [1.1, 0.65, 0.08], mat: SURFACE.GLASS, col: [] },
  monitor:      { size: [0.55, 0.42, 0.18], mat: SURFACE.GLASS, col: [] },
  computer:     { size: [0.22, 0.45, 0.48], mat: SURFACE.METAL, col: [] },
  printer:      { size: [0.6, 0.4, 0.5], mat: SURFACE.PLASTER, col: [] },
  whiteboard:   { size: [1.8, 1.1, 0.06], mat: SURFACE.PLASTER, col: [] },
  dumpster:     { size: [2.0, 1.25, 1.1], mat: SURFACE.METAL, col: [[0, 0.63, 0, 2.0, 1.25, 1.1]] },
  car:          { size: [1.85, 1.45, 4.4], mat: SURFACE.METAL, col: [[0, 0.5, 0, 1.85, 1.0, 4.4], [0, 1.15, -0.2, 1.6, 0.6, 2.2]] },
  van:          { size: [2.1, 2.3, 5.2], mat: SURFACE.METAL, col: [[0, 1.15, 0, 2.1, 2.3, 5.2]] },
  tire_stack:   { size: [0.9, 0.8, 0.9], mat: SURFACE.FABRIC, col: [[0, 0.4, 0, 0.9, 0.8, 0.9]] },
  toolbox:      { size: [0.7, 0.5, 0.4], mat: SURFACE.METAL, col: [[0, 0.25, 0, 0.7, 0.5, 0.4]] },
  sandbags:     { size: [1.6, 0.75, 0.8], mat: SURFACE.FABRIC, col: [[0, 0.38, 0, 1.6, 0.75, 0.8]] },
  jersey:       { size: [1.6, 0.85, 0.6], mat: SURFACE.CONCRETE, col: [[0, 0.43, 0, 1.6, 0.85, 0.6]] },
  cone:         { size: [0.35, 0.6, 0.35], mat: SURFACE.PLASTER, col: [] },
  generator:    { size: [1.6, 1.2, 0.9], mat: SURFACE.METAL, col: [[0, 0.6, 0, 1.6, 1.2, 0.9]] },
  ac_unit:      { size: [1.1, 0.85, 1.1], mat: SURFACE.METAL, col: [[0, 0.43, 0, 1.1, 0.85, 1.1]] },
  pipe_run:     { size: [0.3, 0.3, 6.0], mat: SURFACE.METAL, col: [[0, 0, 0, 0.3, 0.3, 6.0]] },
  girder:       { size: [0.35, 0.35, 8.0], mat: SURFACE.METAL, col: [[0, 0, 0, 0.35, 0.35, 8.0]] },
  rubble:       { size: [1.6, 0.6, 1.6], mat: SURFACE.CONCRETE, col: [[0, 0.28, 0, 1.6, 0.55, 1.6]] },
  debris_pile:  { size: [2.2, 0.9, 2.2], mat: SURFACE.CONCRETE, col: [[0, 0.4, 0, 2.0, 0.8, 2.0]] },
  tree:         { size: [3.0, 7.0, 3.0], mat: SURFACE.WOOD, col: [[0, 3.5, 0, 0.5, 7.0, 0.5]] },
  pine:         { size: [2.4, 9.0, 2.4], mat: SURFACE.WOOD, col: [[0, 4.5, 0, 0.42, 9.0, 0.42]] },
  bush:         { size: [1.6, 1.1, 1.6], mat: SURFACE.GRASS, col: [] },
  rock:         { size: [1.3, 0.9, 1.2], mat: SURFACE.CONCRETE, col: [[0, 0.4, 0, 1.2, 0.8, 1.1]] },
  streetlight:  { size: [0.3, 6.5, 0.3], mat: SURFACE.METAL, col: [[0, 3.2, 0, 0.24, 6.5, 0.24]] },
  fence_panel:  { size: [3.0, 2.2, 0.1], mat: SURFACE.METAL, col: [[0, 1.1, 0, 3.0, 2.2, 0.12]] },
  plant:        { size: [0.7, 1.2, 0.7], mat: SURFACE.GRASS, col: [] },
  lamp:         { size: [0.4, 1.5, 0.4], mat: SURFACE.METAL, col: [] },
  vent:         { size: [0.8, 0.5, 0.8], mat: SURFACE.METAL, col: [[0, 0.25, 0, 0.8, 0.5, 0.8]] },
  pillar_round: { size: [0.7, 3.0, 0.7], mat: SURFACE.CONCRETE, col: [[0, 1.5, 0, 0.7, 3.0, 0.7]] },
  barrier:      { size: [2.4, 1.0, 0.5], mat: SURFACE.PLASTER, col: [[0, 0.5, 0, 2.4, 1.0, 0.5]] },
  crate_stack:  { size: [1.0, 2.0, 1.0], mat: SURFACE.WOOD, col: [[0, 1.0, 0, 1.0, 2.0, 1.0]] }
};

export class MapBuilder {
  constructor(meta) {
    this.meta = meta;
    this.brushes = [];
    this.props = [];
    this.lights = [];
    this.zones = [];
    this.spawns = { alpha: [], bravo: [], ffa: [] };
    this.sites = [];
    this.decor = [];
    this.ambientSounds = [];
  }

  box(px, py, pz, sx, sy, sz, opts = {}) {
    this.brushes.push({ p: [px, py, pz], s: [sx, sy, sz], yaw: opts.yaw || 0, mat: opts.mat || SURFACE.CONCRETE, ...opts });
    return this;
  }

  /** Floor slab; y is the walkable surface height. */
  floor(cx, cz, w, d, y = 0, mat = SURFACE.CONCRETE, thick = 0.4) {
    return this.box(cx, y - thick / 2, cz, w, thick, d, { mat });
  }

  ceiling(cx, cz, w, d, y, mat = SURFACE.CONCRETE, thick = 0.35) {
    return this.box(cx, y + thick / 2, cz, w, thick, d, { mat });
  }

  /** Wall from (x1,z1) to (x2,z2). */
  wall(x1, z1, x2, z2, h = 3.2, opts = {}) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return this;
    const yaw = Math.atan2(dz, dx);
    const t = opts.thick ?? 0.28;
    const y0 = opts.y ?? 0;
    this.brushes.push({
      p: [(x1 + x2) / 2, y0 + h / 2, (z1 + z2) / 2],
      s: [len, h, t],
      yaw: -yaw,
      mat: opts.mat || SURFACE.CONCRETE,
      opaque: opts.opaque !== false,
      solid: opts.solid !== false,
      breakable: !!opts.breakable
    });
    return this;
  }

  /**
   * Wall with a doorway.  `at` is the gap centre measured along the wall
   * (0..1 of its length), `gap` the opening width.
   */
  wallDoor(x1, z1, x2, z2, h = 3.2, at = 0.5, gap = 1.15, opts = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const t0 = Math.max(0, at - gap / (2 * len));
    const t1 = Math.min(1, at + gap / (2 * len));
    const lerpP = (t) => [x1 + (x2 - x1) * t, z1 + (z2 - z1) * t];
    const doorH = opts.doorH ?? 2.15;
    const a = lerpP(t0), b = lerpP(t1);
    if (t0 > 0.001) this.wall(x1, z1, a[0], a[1], h, opts);
    if (t1 < 0.999) this.wall(b[0], b[1], x2, z2, h, opts);
    if (h > doorH) {
      const lintelY = (opts.y ?? 0) + doorH;
      this.wall(a[0], a[1], b[0], b[1], h - doorH, { ...opts, y: lintelY });
    }
    this.decor.push({ type: 'doorframe', a, b, h: doorH, y: opts.y ?? 0 });
    return this;
  }

  /** Wall with a window band: solid below sill, solid above head, glass between. */
  wallWindow(x1, z1, x2, z2, h = 3.2, opts = {}) {
    const sill = opts.sill ?? 0.95;
    const top = opts.top ?? 2.25;
    const y0 = opts.y ?? 0;
    const at = opts.at ?? 0.5, gap = opts.gap ?? 1.8;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const t0 = Math.max(0, at - gap / (2 * len));
    const t1 = Math.min(1, at + gap / (2 * len));
    const lp = (t) => [x1 + (x2 - x1) * t, z1 + (z2 - z1) * t];
    const a = lp(t0), b = lp(t1);
    if (t0 > 0.001) this.wall(x1, z1, a[0], a[1], h, opts);
    if (t1 < 0.999) this.wall(b[0], b[1], x2, z2, h, opts);
    this.wall(a[0], a[1], b[0], b[1], sill, { ...opts, y: y0 });
    if (h > top) this.wall(a[0], a[1], b[0], b[1], h - top, { ...opts, y: y0 + top });
    this.wall(a[0], a[1], b[0], b[1], top - sill, {
      ...opts, y: y0 + sill, thick: 0.06, mat: SURFACE.GLASS, breakable: true, opaque: false
    });
    return this;
  }

  /** Four walls with optional openings. `doors` is an array of 'n'|'s'|'e'|'w'. */
  room(cx, cz, w, d, h, opts = {}) {
    const doors = opts.doors || [];
    const windows = opts.windows || [];
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const sides = [
      ['n', x0, z0, x1, z0],
      ['s', x0, z1, x1, z1],
      ['w', x0, z0, x0, z1],
      ['e', x1, z0, x1, z1]
    ];
    for (const [id, ax, az, bx, bz] of sides) {
      const door = doors.find((v) => (typeof v === 'string' ? v === id : v.side === id));
      const win = windows.find((v) => (typeof v === 'string' ? v === id : v.side === id));
      if (door) {
        const o = typeof door === 'object' ? door : {};
        this.wallDoor(ax, az, bx, bz, h, o.at ?? 0.5, o.gap ?? 1.2, opts);
      } else if (win) {
        const o = typeof win === 'object' ? win : {};
        this.wallWindow(ax, az, bx, bz, h, { ...opts, ...o });
      } else {
        this.wall(ax, az, bx, bz, h, opts);
      }
    }
    if (opts.floor !== false) this.floor(cx, cz, w, d, opts.y ?? 0, opts.floorMat || SURFACE.CONCRETE);
    if (opts.ceil) this.ceiling(cx, cz, w, d, (opts.y ?? 0) + h, opts.ceilMat || SURFACE.PLASTER);
    if (opts.zone !== false) {
      this.zone(cx, (opts.y ?? 0) + h / 2, cz, w, h, d, opts.reverb || 'room');
    }
    return this;
  }

  /** Straight staircase climbing along +axis. dir: 'x'|'-x'|'z'|'-z'. */
  stairs(cx, y0, cz, width, dir, steps, totalRise, run, mat = SURFACE.CONCRETE) {
    const rise = totalRise / steps;
    const stepRun = run / steps;
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      const off = stepRun * (i + 0.5);
      let px = cx, pz = cz, sx = width, sz = stepRun;
      if (dir === 'x') { px = cx + off; sx = stepRun; sz = width; }
      else if (dir === '-x') { px = cx - off; sx = stepRun; sz = width; }
      else if (dir === 'z') { pz = cz + off; }
      else { pz = cz - off; }
      this.box(px, y0 + h / 2, pz, sx, h, sz, { mat });
    }
    return this;
  }

  ramp(cx, y0, cz, w, len, rise, dir = 'z', mat = SURFACE.CONCRETE, segments = 10) {
    for (let i = 0; i < segments; i++) {
      const t = (i + 0.5) / segments;
      const h = y0 + rise * ((i + 1) / segments);
      const off = (t - 0.5) * len;
      const sl = len / segments + 0.02;
      if (dir === 'z' || dir === '-z') {
        const sign = dir === 'z' ? 1 : -1;
        this.box(cx, h / 2 + (y0 - y0) / 2, cz + off * sign, w, h, sl, { mat });
      } else {
        const sign = dir === 'x' ? 1 : -1;
        this.box(cx + off * sign, h / 2, cz, sl, h, w, { mat });
      }
    }
    return this;
  }

  prop(type, x, y, z, opts = {}) {
    const def = PROPS[type];
    if (!def) throw new Error('unknown prop ' + type);
    const yaw = opts.yaw || 0;
    const scale = opts.scale || 1;
    this.props.push({ type, p: [x, y, z], yaw, scale, tint: opts.tint, variant: opts.variant ?? ((Math.abs(Math.sin(x * 12.9898 + z * 78.233 + y * 37.719)) * 43758.5453) % 1) });
    if (opts.solid !== false) {
      for (const c of def.col) {
        const [ox, oy, oz, sx, sy, sz] = c;
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        const wx = x + (ox * cs - oz * sn) * scale;
        const wz = z + (ox * sn + oz * cs) * scale;
        this.brushes.push({
          p: [wx, y + oy * scale, wz],
          s: [sx * scale, sy * scale, sz * scale],
          yaw, mat: def.mat, opaque: opts.opaque !== false
        });
      }
    }
    return this;
  }

  /** Repeat a prop along a line. */
  propLine(type, x1, z1, x2, z2, count, y = 0, opts = {}) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      this.prop(type, x1 + (x2 - x1) * t, y, z1 + (z2 - z1) * t, opts);
    }
    return this;
  }

  light(type, x, y, z, opts = {}) {
    this.lights.push({
      type, p: [x, y, z],
      color: opts.color ?? 0xffe6c0,
      intensity: opts.intensity ?? 1,
      distance: opts.distance ?? 12,
      angle: opts.angle ?? 0.8,
      penumbra: opts.penumbra ?? 0.5,
      target: opts.target || [x, y - 3, z],
      shadow: opts.shadow ?? false,
      flicker: opts.flicker ?? 0,
      fixture: opts.fixture ?? 'none'
    });
    return this;
  }

  zone(cx, cy, cz, w, h, d, reverb = 'room', extra = {}) {
    this.zones.push({ p: [cx, cy, cz], s: [w, h, d], reverb, indoor: extra.indoor !== false, ...extra });
    return this;
  }

  spawn(team, x, y, z, yaw = 0) {
    const s = { p: [x, y, z], yaw };
    if (team === 'ffa') this.spawns.ffa.push(s);
    else {
      this.spawns[team].push(s);
      this.spawns.ffa.push(s);
    }
    return this;
  }

  site(name, x, y, z, radius = 3.2) {
    this.sites.push({ name, p: [x, y, z], radius });
    return this;
  }

  ambient(sound, x, y, z, radius = 14, volume = 0.5) {
    this.ambientSounds.push({ sound, p: [x, y, z], radius, volume });
    return this;
  }

  build() {
    return {
      ...this.meta,
      brushes: this.brushes,
      props: this.props,
      lights: this.lights,
      zones: this.zones,
      spawns: this.spawns,
      sites: this.sites,
      decor: this.decor,
      ambientSounds: this.ambientSounds
    };
  }
}

/** Deterministic scatter helper so maps look busy without hand-placing junk. */
export function scatter(rng, count, fn) {
  for (let i = 0; i < count; i++) fn(i, rng);
}
