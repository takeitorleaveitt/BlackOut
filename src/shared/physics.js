// Collision world shared by client prediction and the authoritative server.
//
// Geometry is a set of yaw-rotated boxes ("brushes").  That keeps the level
// format small enough to ship to both sides, makes broadphase trivial, and
// gives exact entry/exit distances for the penetration solver.

import { SURFACE, SURFACE_PROPS } from './constants.js';

const EPS = 1e-6;

export class Collider {
  constructor(def, index) {
    this.index = index;
    this.cx = def.p[0]; this.cy = def.p[1]; this.cz = def.p[2];
    this.hx = def.s[0] * 0.5; this.hy = def.s[1] * 0.5; this.hz = def.s[2] * 0.5;
    this.yaw = def.yaw || 0;
    this.sin = Math.sin(this.yaw);
    this.cos = Math.cos(this.yaw);
    this.surface = def.mat || SURFACE.CONCRETE;
    this.solid = def.solid !== false;
    this.opaque = def.opaque !== false;
    this.breakable = !!def.breakable;
    this.climb = !!def.climb;
    // world-space AABB for broadphase
    const ex = Math.abs(this.cos) * this.hx + Math.abs(this.sin) * this.hz;
    const ez = Math.abs(this.sin) * this.hx + Math.abs(this.cos) * this.hz;
    this.minX = this.cx - ex; this.maxX = this.cx + ex;
    this.minY = this.cy - this.hy; this.maxY = this.cy + this.hy;
    this.minZ = this.cz - ez; this.maxZ = this.cz + ez;
  }

  toLocal(x, y, z, out) {
    const dx = x - this.cx, dz = z - this.cz;
    out[0] = dx * this.cos + dz * this.sin;
    out[1] = y - this.cy;
    out[2] = -dx * this.sin + dz * this.cos;
    return out;
  }

  dirToLocal(x, z, out) {
    out[0] = x * this.cos + z * this.sin;
    out[1] = -x * this.sin + z * this.cos;
    return out;
  }

  normalToWorld(nx, ny, nz, out) {
    out[0] = nx * this.cos - nz * this.sin;
    out[1] = ny;
    out[2] = nx * this.sin + nz * this.cos;
    return out;
  }
}

const CELL = 6;
const key = (ix, iz) => ix * 73856093 ^ iz * 19349663;

export class World {
  constructor(brushes = [], meta = {}) {
    this.meta = meta;
    this.colliders = [];
    this.grid = new Map();
    this.bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const b of brushes) this.add(b);
  }

  add(def) {
    const c = new Collider(def, this.colliders.length);
    this.colliders.push(c);
    if (!c.solid && !c.opaque) return c;
    const ix0 = Math.floor(c.minX / CELL), ix1 = Math.floor(c.maxX / CELL);
    const iz0 = Math.floor(c.minZ / CELL), iz1 = Math.floor(c.maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(c);
      }
    }
    const b = this.bounds;
    b.minX = Math.min(b.minX, c.minX); b.maxX = Math.max(b.maxX, c.maxX);
    b.minY = Math.min(b.minY, c.minY); b.maxY = Math.max(b.maxY, c.maxY);
    b.minZ = Math.min(b.minZ, c.minZ); b.maxZ = Math.max(b.maxZ, c.maxZ);
    return c;
  }

  /** Colliders whose AABB may overlap the given XZ box. */
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const ix0 = Math.floor(minX / CELL), ix1 = Math.floor(maxX / CELL);
    const iz0 = Math.floor(minZ / CELL), iz1 = Math.floor(maxZ / CELL);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const arr = this.grid.get(key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (seen.has(c.index)) continue;
          seen.add(c.index);
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Ray vs world. Returns the nearest hit, or null.
   * `filter` may reject colliders (used to skip glass we already broke, etc).
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, filter = null, wantSolid = true) {
    const minX = Math.min(ox, ox + dx * maxDist) - 0.5;
    const maxX = Math.max(ox, ox + dx * maxDist) + 0.5;
    const minZ = Math.min(oz, oz + dz * maxDist) - 0.5;
    const maxZ = Math.max(oz, oz + dz * maxDist) + 0.5;
    const cands = this.query(minX, minZ, maxX, maxZ, this._rcOut || (this._rcOut = []));
    let best = null;
    const lo = [0, 0, 0], ld = [0, 0];
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (wantSolid && !c.solid && !c.opaque) continue;
      if (filter && !filter(c)) continue;
      c.toLocal(ox, oy, oz, lo);
      c.dirToLocal(dx, dz, ld);
      const r = raySlab(lo[0], lo[1], lo[2], ld[0], dy, ld[1], c.hx, c.hy, c.hz);
      if (!r) continue;
      if (r.tmin > maxDist) continue;
      const t = r.tmin >= 0 ? r.tmin : 0;
      if (best && t >= best.t) continue;
      best = { t, tExit: r.tmax, axis: r.axis, sign: r.sign, collider: c, inside: r.tmin < 0 };
    }
    if (!best) return null;
    const n = [0, 0, 0];
    const c = best.collider;
    if (best.axis === 0) c.normalToWorld(best.sign, 0, 0, n);
    else if (best.axis === 1) { n[0] = 0; n[1] = best.sign; n[2] = 0; }
    else c.normalToWorld(0, 0, best.sign, n);
    return {
      t: best.t,
      distance: best.t,
      thickness: Math.max(0, best.tExit - best.t),
      point: [ox + dx * best.t, oy + dy * best.t, oz + dz * best.t],
      normal: n,
      collider: c,
      surface: c.surface,
      props: SURFACE_PROPS[c.surface] || SURFACE_PROPS.concrete
    };
  }

  /** True when a vertical cylinder at (x,y,z) with the given size is clear. */
  isClear(x, y, z, radius, height) {
    const cands = this.query(x - radius, z - radius, x + radius, z + radius, this._clearOut || (this._clearOut = []));
    const lo = [0, 0, 0];
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c.solid) continue;
      if (y + height <= c.minY + EPS || y >= c.maxY - EPS) continue;
      c.toLocal(x, y, z, lo);
      const px = clampf(lo[0], -c.hx, c.hx);
      const pz = clampf(lo[2], -c.hz, c.hz);
      const ddx = lo[0] - px, ddz = lo[2] - pz;
      if (ddx * ddx + ddz * ddz < radius * radius - EPS) return false;
    }
    return true;
  }

  /**
   * Support test for a cylinder: the highest collider top that the cylinder
   * laterally overlaps and that sits at (or just below) the feet.  Using this
   * instead of a single downward ray means a player standing on the very lip
   * of a crate is still supported, which is what a capsule controller expects.
   */
  supportY(x, y, z, radius, maxDrop = 0.35) {
    const cands = this.query(x - radius, z - radius, x + radius, z + radius, this._supOut || (this._supOut = []));
    const lo = [0, 0, 0];
    let best = -Infinity, surface = null;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c.solid) continue;
      if (c.maxY > y + 0.03 || c.maxY < y - maxDrop) continue;
      if (c.maxY <= best) continue;
      c.toLocal(x, y, z, lo);
      const px = clampf(lo[0], -c.hx, c.hx);
      const pz = clampf(lo[2], -c.hz, c.hz);
      const ddx = lo[0] - px, ddz = lo[2] - pz;
      if (ddx * ddx + ddz * ddz >= radius * radius) continue;
      best = c.maxY; surface = c.surface;
    }
    return { y: best, surface };
  }

  /** Height of the highest surface under (x,z) below `fromY`. */
  groundHeight(x, z, fromY) {
    const hit = this.raycast(x, fromY, z, 0, -1, 0, 60);
    return hit ? hit.point[1] : -Infinity;
  }
}

function clampf(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Slab test in box-local space. Returns tmin/tmax plus the entry axis+sign. */
export function raySlab(ox, oy, oz, dx, dy, dz, hx, hy, hz) {
  let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 1;
  const o = [ox, oy, oz], d = [dx, dy, dz], h = [hx, hy, hz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < -h[i] || o[i] > h[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (-h[i] - o[i]) * inv;
    let t2 = (h[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { tmin, tmax, axis, sign };
}

/**
 * Push a vertical cylinder out of the world.  Returns the accumulated
 * correction and which directions were blocked.
 */
export function depenetrate(world, pos, radius, height, out) {
  const cands = world.query(pos.x - radius - 0.1, pos.z - radius - 0.1, pos.x + radius + 0.1, pos.z + radius + 0.1, world._depOut || (world._depOut = []));
  const lo = [0, 0, 0], nrm = [0, 0, 0];
  out.groundY = -Infinity;
  out.hitGround = false;
  out.hitCeiling = false;
  out.hitWall = false;
  out.lateralTopY = -Infinity;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c.solid) continue;
      const top = pos.y + height, bot = pos.y;
      if (top <= c.minY + EPS || bot >= c.maxY - EPS) continue;
      c.toLocal(pos.x, pos.y, pos.z, lo);
      const px = clampf(lo[0], -c.hx, c.hx);
      const pz = clampf(lo[2], -c.hz, c.hz);
      let ddx = lo[0] - px, ddz = lo[2] - pz;
      let d2 = ddx * ddx + ddz * ddz;
      if (d2 >= radius * radius - EPS) continue;

      // vertical overlap distances
      const upPush = c.maxY - bot;              // move player up to stand on top
      const downPush = top - c.minY;            // move player down below the box
      let lateral;
      if (d2 > EPS) {
        const d = Math.sqrt(d2);
        lateral = radius - d;
        ddx /= d; ddz /= d;
      } else {
        // centre is inside the rect: pick the cheapest face
        const ox2 = c.hx - Math.abs(lo[0]), oz2 = c.hz - Math.abs(lo[2]);
        if (ox2 < oz2) { ddx = Math.sign(lo[0]) || 1; ddz = 0; lateral = ox2 + radius; }
        else { ddx = 0; ddz = Math.sign(lo[2]) || 1; lateral = oz2 + radius; }
      }
      if (upPush <= lateral && upPush <= downPush) {
        pos.y += upPush; out.hitGround = true;
        out.groundY = Math.max(out.groundY, c.maxY);
        out.groundSurface = c.surface;
        moved = true;
      } else if (downPush < lateral) {
        pos.y -= downPush; out.hitCeiling = true; moved = true;
      } else {
        c.normalToWorld(ddx, 0, ddz, nrm);
        pos.x += nrm[0] * lateral;
        pos.z += nrm[2] * lateral;
        out.hitWall = true;
        if (c.maxY > out.lateralTopY) out.lateralTopY = c.maxY;
        out.wallNormal = [nrm[0], nrm[1], nrm[2]];
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}
