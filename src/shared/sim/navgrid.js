// Navigation grid and A* pathfinding for the bots.
//
// Before this the bots did not navigate at all: they picked a point on the map
// and walked straight at it, with one 1.5 m ray in front as the whole of their
// obstacle handling. On the open maps that mostly works; on the tight ones it
// does not, and the measurements said so — a bot on Killhouse spent 54% of its
// life pressed against something, covered 110 m in a minute and a half, and
// reached fifteen distinct four-metre cells of a map with dozens of them.
//
// So: sample the collision world into walkable columns, link the ones a player
// could actually walk between, and A* over that. The grid is built once per
// map and shared by every bot in the match.
//
// Columns rather than a flat grid because several of these maps have a walkway
// or a second storey over ground you can also stand on, and a single height
// per (x, z) makes the upper floor either unreachable or a hole in the lower
// one.

import { PLAYER_RADIUS, PLAYER_HEIGHT_STAND, STEP_HEIGHT } from '../constants.js';

// Roughly one and a half player widths. Fine enough to find a doorway, coarse
// enough that a whole map is a few thousand nodes rather than a hundred
// thousand.
const CELL = 0.9;
// Clearance a node needs to count as standable. A shade under full height so a
// low doorway or a beam does not delete an otherwise fine route.
const CLEAR_HEIGHT = PLAYER_HEIGHT_STAND - 0.06;
// Exactly the player's own radius for deciding whether a spot is standable:
// anything wider deletes places a player genuinely fits, and on these maps
// that meant losing floor next to furniture and inside the tighter rooms.
const CLEAR_RADIUS = PLAYER_RADIUS;
// A hair wider when testing the gap BETWEEN two cells, which keeps a path from
// threading a seam a bot cannot actually walk through.
const LINK_RADIUS = PLAYER_RADIUS + 0.02;
// The largest drop a bot will path down on purpose. There is no fall damage in
// this game, so the limit is about not stranding a bot somewhere it cannot
// climb back out of rather than about survival — a storey and a half, which
// covers stepping off the catwalks and the low roofs. Note these edges are
// one-way by construction: the node at the bottom does not get a link back up.
const MAX_DROP = 4.0;
// The most a link may climb when the surface between the two cells is
// continuous. A player walks up a ramp or a stair flight fine even though a
// 0.9 m sample across a 35-degree slope shows more rise than one step: the
// movement code climbs it in tick-sized increments, not one 0.9 m stride.
// Sampling at cell spacing and applying the raw step height is what
// disconnected every ramp on the map from everything at the top of it.
const MAX_RISE = 0.78;
// Give up rather than burn a frame on a hopeless search.
const MAX_EXPANSIONS = 9000;
// How far off a requested height a node may be and still count as "the same
// floor" when resolving a world point onto the grid.
const SAME_FLOOR = 1.2;

const cache = new Map();

/**
 * Build (or reuse) the nav grid for a map. Keyed by map key: every World built
 * from the same map key has identical geometry, so one grid serves every match
 * on that map in this process. Building costs 15-180 ms depending on the map,
 * which is why it happens once, at match construction, behind the loading
 * screen rather than on the first bot that needs a path.
 */
export function getNavGrid(world, mapKey) {
  let g = cache.get(mapKey);
  if (!g) {
    g = new NavGrid(world);
    cache.set(mapKey, g);
  }
  return g;
}

export class NavGrid {
  constructor(world) {
    this.world = world;
    const b = world.bounds;
    // A margin so a column centred on the very edge of the map still has
    // neighbours to link to.
    this.minX = b.minX - CELL;
    this.minZ = b.minZ - CELL;
    this.nx = Math.max(1, Math.ceil((b.maxX - b.minX) / CELL) + 2);
    this.nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / CELL) + 2);
    this.top = b.maxY + 2;
    this.bottom = b.minY - 1;

    this.nodes = [];             // flat list; index is the node id
    this.columns = new Array(this.nx * this.nz);   // (ix,iz) -> node ids, low to high
    this.build();
    this.link();

    // Scratch used by every search, so pathfinding allocates nothing per call.
    this.g = new Float32Array(this.nodes.length);
    this.f = new Float32Array(this.nodes.length);
    this.from = new Int32Array(this.nodes.length);
    this.stamp = new Int32Array(this.nodes.length);
    this.closed = new Uint8Array(this.nodes.length);
    this.searchId = 0;
    this.open = [];
  }

  colIndex(ix, iz) { return iz * this.nx + ix; }
  cellX(ix) { return this.minX + (ix + 0.5) * CELL; }
  cellZ(iz) { return this.minZ + (iz + 0.5) * CELL; }

  /** Find every standable surface in every column. */
  build() {
    const w = this.world;
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.cellX(ix), z = this.cellZ(iz);
        const ids = [];
        // Walk down the column, taking each solid top as a candidate floor.
        let y = this.top;
        for (let guard = 0; guard < 12 && y > this.bottom; guard++) {
          const hit = w.raycast(x, y, z, 0, -1, 0, y - this.bottom);
          if (!hit) break;
          const surfaceY = hit.point[1];
          // Stand on it only if a player actually fits there.
          if (w.isClear(x, surfaceY + 0.04, z, CLEAR_RADIUS, CLEAR_HEIGHT)) {
            ids.push(this.nodes.length);
            this.nodes.push({ ix, iz, x, y: surfaceY, z, edges: null });
          }
          // Continue below this surface. Step past the collider's own
          // thickness so a floor slab is not re-hit forever.
          y = Math.min(surfaceY - 0.05, hit.point[1] - (hit.thickness || 0) - 0.05);
        }
        this.columns[this.colIndex(ix, iz)] = ids;
      }
    }
  }

  /** Link nodes a player could walk between. */
  link() {
    const w = this.world;
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];
    for (const n of this.nodes) {
      const edges = [];
      for (const [dx, dz] of dirs) {
        const jx = n.ix + dx, jz = n.iz + dz;
        if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
        const diagonal = dx !== 0 && dz !== 0;
        const col = this.columns[this.colIndex(jx, jz)];
        if (!col) continue;
        for (const id of col) {
          const m = this.nodes[id];
          const dy = m.y - n.y;
          // Up is a step or a slope; down is either of those or a short drop.
          if (dy > MAX_RISE || dy < -MAX_DROP) continue;
          if (dy > STEP_HEIGHT && !this.continuous(n, m)) continue;
          // The player has to fit at the higher of the two heights all the way
          // across, or the "link" runs through a wall.
          const midX = (n.x + m.x) / 2, midZ = (n.z + m.z) / 2;
          const hiY = Math.max(n.y, m.y);
          if (!w.isClear(midX, hiY + 0.06, midZ, LINK_RADIUS, CLEAR_HEIGHT)) continue;
          if (!w.isClear(m.x, hiY + 0.06, m.z, LINK_RADIUS, CLEAR_HEIGHT)) continue;
          // A diagonal must not cut a corner: both orthogonal neighbours have
          // to be open at this height too, or bots shave through door jambs.
          if (diagonal && !(
            w.isClear(this.cellX(n.ix + dx), hiY + 0.06, this.cellZ(n.iz), LINK_RADIUS, CLEAR_HEIGHT) &&
            w.isClear(this.cellX(n.ix), hiY + 0.06, this.cellZ(n.iz + dz), LINK_RADIUS, CLEAR_HEIGHT)
          )) continue;
          const cost = (diagonal ? 1.4142 : 1) * CELL
            + (dy > 0.05 ? dy * 1.5 : 0)      // stepping up is work
            + (dy < -0.6 ? -dy * 0.6 : 0);    // so is dropping any distance
          edges.push({ id, cost });
        }
      }
      n.edges = edges;
    }
  }

  /**
   * Is the ground between two cells a continuous slope rather than a ledge?
   * Checked by the height halfway across: on a ramp it sits between the two
   * ends, on a wall it is level with the bottom one.
   */
  continuous(n, m) {
    const midY = this.world.groundHeight(
      (n.x + m.x) / 2, (n.z + m.z) / 2, Math.max(n.y, m.y) + 0.6
    );
    if (midY === -Infinity) return false;
    return Math.abs(midY - n.y) <= STEP_HEIGHT + 0.02
      && Math.abs(m.y - midY) <= STEP_HEIGHT + 0.02;
  }

  get size() { return this.nodes.length; }

  /**
   * Nearest usable node to a world point. Searches outward in rings so a
   * destination that lands inside a crate still resolves to the floor beside
   * it rather than failing.
   */
  nodeAt(x, y, z, maxRings = 6) {
    const ix = Math.round((x - this.minX) / CELL - 0.5);
    const iz = Math.round((z - this.minZ) / CELL - 0.5);
    // Two candidates, because height is not just a tiebreak. A point standing
    // beside a wall samples a column whose only node is the ROOF of that wall,
    // and taking the nearest node in the nearest non-empty ring hands back a
    // rooftop three metres up — which is how ground-level spawns on Willow
    // Lane ended up in their own unreachable component. A node at the right
    // height a metre away is always the better answer than one directly
    // overhead, so keep the best of each and only fall back to the wrong
    // floor when there is no right one anywhere nearby.
    let best = -1, bestD = Infinity;              // right height
    let any = -1, anyD = Infinity;                // anything at all
    for (let r = 0; r <= maxRings; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          // ring only — the inner square was covered by a previous r
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const cx = ix + dx, cz = iz + dz;
          if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
          const col = this.columns[this.colIndex(cx, cz)];
          if (!col) continue;
          for (const id of col) {
            const n = this.nodes[id];
            const dxz = (n.x - x) ** 2 + (n.z - z) ** 2;
            const dyv = Math.abs(n.y - y);
            const d = dxz + (dyv * 3) ** 2;
            if (d < anyD) { anyD = d; any = id; }
            if (dyv <= SAME_FLOOR && d < bestD) { bestD = d; best = id; }
          }
        }
      }
      if (best >= 0) return best;
    }
    return best >= 0 ? best : any;
  }

  heuristic(a, b) {
    const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
    // Octile: exact for 8-connected movement, so A* expands far fewer nodes
    // than it would on a straight Euclidean estimate.
    const lo = Math.min(dx, dz), hi = Math.max(dx, dz);
    return hi + 0.4142 * lo + Math.abs(a.y - b.y) * 0.5;
  }

  /**
   * A* between two world points.
   * @returns array of {x,y,z} waypoints (destination last), or null.
   */
  findPath(sx, sy, sz, tx, ty, tz) {
    const start = this.nodeAt(sx, sy, sz);
    const goal = this.nodeAt(tx, ty, tz);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, y: ty, z: tz }];

    const id = ++this.searchId;
    const { g, f, from, stamp, closed, nodes } = this;
    const open = this.open;
    open.length = 0;

    stamp[start] = id; closed[start] = 0;
    g[start] = 0;
    f[start] = this.heuristic(nodes[start], nodes[goal]);
    from[start] = -1;
    open.push(start);

    let expansions = 0;
    while (open.length) {
      // Linear scan for the cheapest open node. The frontier on these maps is
      // small enough that a binary heap costs more in bookkeeping than it saves.
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === goal) return this.rebuild(cur, tx, ty, tz);
      if (closed[cur] === 1 && stamp[cur] === id) continue;
      closed[cur] = 1;
      if (++expansions > MAX_EXPANSIONS) return null;

      for (const e of nodes[cur].edges) {
        const nid = e.id;
        const fresh = stamp[nid] !== id;
        if (fresh) { stamp[nid] = id; closed[nid] = 0; g[nid] = Infinity; }
        if (closed[nid] === 1) continue;
        const ng = g[cur] + e.cost;
        if (ng >= g[nid]) continue;
        g[nid] = ng;
        f[nid] = ng + this.heuristic(nodes[nid], nodes[goal]);
        from[nid] = cur;
        open.push(nid);
      }
    }
    return null;
  }

  rebuild(goalId, tx, ty, tz) {
    const out = [];
    let cur = goalId;
    while (cur >= 0) {
      const n = this.nodes[cur];
      out.push({ x: n.x, y: n.y, z: n.z });
      cur = this.from[cur];
    }
    out.reverse();
    // The first node is where the bot already is.
    if (out.length > 1) out.shift();
    // Finish on the real destination rather than the cell centre near it.
    out[out.length - 1] = { x: tx, y: ty, z: tz };
    return this.smooth(out);
  }

  /**
   * Drop waypoints the bot can see straight past. A grid path is a staircase;
   * walking a staircase looks exactly like a bot walking a staircase.
   */
  smooth(path) {
    if (path.length < 3) return path;
    const w = this.world;
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      for (; j > i + 1; j--) {
        if (this.walkable(w, path[i], path[j])) break;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  /** Is the straight line between two waypoints clear at walking height? */
  walkable(w, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-3) return true;
    // Only shortcut across ground at a similar height: a straight line between
    // two floors goes through the ceiling.
    if (Math.abs(b.y - a.y) > STEP_HEIGHT) return false;
    const steps = Math.ceil(dist / (CELL * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + dx * t, z = a.z + dz * t;
      const y = a.y + (b.y - a.y) * t;
      if (!w.isClear(x, y + 0.06, z, LINK_RADIUS, CLEAR_HEIGHT)) return false;
      // ...and there is still floor under it.
      const sup = w.supportY(x, y + 0.2, z, PLAYER_RADIUS, 0.6);
      if (sup.y === -Infinity) return false;
    }
    return true;
  }
}
