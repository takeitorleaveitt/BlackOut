// Ballistics shared by client (visuals + prediction) and server (authoritative
// damage).  Bullets are stepped through the world with travel time and drop,
// they lose energy punching through materials, and they resolve against
// per-zone hitboxes.

import { HITBOX, SURFACE_PROPS, mulberry32, clamp } from './constants.js';
import { damageAtRange } from './weapons.js';

const GRAV_BULLET = 9.81;
const MAX_TIME = 1.6;          // seconds a round stays alive
const STEP = 1 / 240;          // integration step

/** Build an orthonormal basis around `dir`. */
function basis(dx, dy, dz, out) {
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(dy) > 0.95) { ux = 1; uy = 0; uz = 0; }
  // right = dir x up
  let rx = dy * uz - dz * uy;
  let ry = dz * ux - dx * uz;
  let rz = dx * uy - dy * ux;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  // realUp = right x dir
  const vx = ry * dz - rz * dy;
  const vy = rz * dx - rx * dz;
  const vz = rx * dy - ry * dx;
  out[0] = rx; out[1] = ry; out[2] = rz;
  out[3] = vx; out[4] = vy; out[5] = vz;
  return out;
}

const _b = new Float64Array(6);

/** Cone spread. `spreadDeg` is the full cone half-angle in degrees. */
export function applySpread(dx, dy, dz, spreadDeg, rng) {
  if (spreadDeg <= 0.0001) return [dx, dy, dz];
  basis(dx, dy, dz, _b);
  const ang = (spreadDeg * Math.PI) / 180;
  // sqrt for a uniform disc distribution -> natural looking grouping
  const r = Math.sqrt(rng()) * Math.tan(ang);
  const th = rng() * Math.PI * 2;
  const ox = Math.cos(th) * r, oy = Math.sin(th) * r;
  let nx = dx + _b[0] * ox + _b[3] * oy;
  let ny = dy + _b[1] * ox + _b[4] * oy;
  let nz = dz + _b[2] * ox + _b[5] * oy;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** Ray vs a yaw-aligned box centred on a player's local frame. */
function rayBoxLocal(ox, oy, oz, dx, dy, dz, hx, hy, hz, cy) {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy - cy, oz], d = [dx, dy, dz], h = [hx, hy, hz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < -h[i] || o[i] > h[i]) return -1;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (-h[i] - o[i]) * inv, t2 = (h[i] - o[i]) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}

/** Zone boxes for a player of the given height, in player-local space. */
export function hitZones(height) {
  return [
    { zone: 'head', hx: 0.115, hy: (HITBOX.head.yMax - HITBOX.head.yMin) * height * 0.5, hz: 0.125, cy: (HITBOX.head.yMin + HITBOX.head.yMax) * 0.5 * height, mult: HITBOX.head.mult },
    { zone: 'torso', hx: 0.215, hy: (HITBOX.torso.yMax - HITBOX.torso.yMin) * height * 0.5, hz: 0.155, cy: (HITBOX.torso.yMin + HITBOX.torso.yMax) * 0.5 * height, mult: HITBOX.torso.mult },
    { zone: 'arms', hx: 0.40, hy: (HITBOX.arms.yMax - HITBOX.arms.yMin) * height * 0.44, hz: 0.17, cy: (HITBOX.arms.yMin + HITBOX.arms.yMax) * 0.5 * height, mult: HITBOX.arms.mult },
    { zone: 'legs', hx: 0.215, hy: (HITBOX.legs.yMax - HITBOX.legs.yMin) * height * 0.5, hz: 0.165, cy: (HITBOX.legs.yMin + HITBOX.legs.yMax) * 0.5 * height, mult: HITBOX.legs.mult }
  ];
}

/**
 * Simulate one projectile.
 *
 * targetsAt(t) -> array of { id, x, y, z, yaw, height, team, alive }
 * sampled at `t` seconds after the shot (lets the server walk its lag
 * compensation history forward as the bullet flies).
 */
export function simulateBullet(opts) {
  const {
    world, origin, dir, weapon, shooterId = -1, shooterTeam = 0,
    targetsAt = null, friendlyFire = false, maxTime = MAX_TIME,
    penetrationDepth = 0, recordPath = true, rng = null
  } = opts;
  const jitter = rng || Math.random;

  let [px, py, pz] = origin;
  const speed = weapon.muzzleVelocity;
  let vx = dir[0] * speed, vy = dir[1] * speed, vz = dir[2] * speed;
  const drop = GRAV_BULLET * (weapon.dropScale ?? 1);

  let t = 0;
  let travelled = 0;
  let energy = 1;               // 1 = full power, drops through materials
  let pens = penetrationDepth;
  const impacts = [];
  const hits = [];
  const path = recordPath ? [px, py, pz] : null;
  const alreadyHit = new Set();
  if (shooterId >= 0) alreadyHit.add(shooterId);

  let guard = 0;
  while (t < maxTime && energy > 0.06 && guard++ < 4000) {
    const dt = STEP;
    const nx = px + vx * dt;
    const ny = py + vy * dt - 0.5 * drop * dt * dt;
    const nz = pz + vz * dt;
    let sx = nx - px, sy = ny - py, sz = nz - pz;
    let segLen = Math.hypot(sx, sy, sz);
    if (segLen < 1e-6) break;
    const ix = sx / segLen, iy = sy / segLen, iz = sz / segLen;

    // --- players --------------------------------------------------------
    let bestPlayer = null, bestT = segLen;
    if (targetsAt) {
      const targets = targetsAt(t);
      for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        if (!p.alive || alreadyHit.has(p.id)) continue;
        if (!friendlyFire && shooterTeam && p.team === shooterTeam) continue;
        // cheap reject
        const dxp = p.x - px, dzp = p.z - pz;
        if (Math.abs(dxp) > 40 || Math.abs(dzp) > 40) continue;
        const cs = Math.cos(-p.yaw), sn = Math.sin(-p.yaw);
        const lx = dxp * cs - dzp * sn;
        const lz = dxp * sn + dzp * cs;
        const ldx = ix * cs - iz * sn;
        const ldz = ix * sn + iz * cs;
        const zones = hitZones(p.height);
        for (const z of zones) {
          const th = rayBoxLocal(-lx, py - p.y, -lz, ldx, iy, ldz, z.hx, z.hy, z.hz, z.cy);
          if (th < 0 || th > bestT) continue;
          // Zones overlap (the arm box wraps the torso).  Prefer the nearest
          // hit, but inside a 30cm tolerance prefer the more valuable zone so
          // an arm never shadows the chest or head behind it.
          if (!bestPlayer || th < bestPlayer.t - 0.3 ||
              (th < bestPlayer.t + 0.3 && z.mult > bestPlayer.mult)) {
            bestPlayer = { t: th, player: p, zone: z.zone, mult: z.mult };
            bestT = Math.max(th, bestPlayer.t);
          }
        }
      }
    }

    // --- world ----------------------------------------------------------
    const wh = world.raycast(px, py, pz, ix, iy, iz, segLen);

    if (bestPlayer && (!wh || bestPlayer.t <= wh.t)) {
      const p = bestPlayer.player;
      const hx = px + ix * bestPlayer.t, hy = py + iy * bestPlayer.t, hz = pz + iz * bestPlayer.t;
      const dist = travelled + bestPlayer.t;
      const dmg = damageAtRange(weapon, dist) * bestPlayer.mult * energy;
      hits.push({
        id: p.id, zone: bestPlayer.zone, damage: dmg, distance: dist,
        point: [hx, hy, hz], dir: [ix, iy, iz], mult: bestPlayer.mult, penetrated: energy < 0.999
      });
      impacts.push({ point: [hx, hy, hz], normal: [-ix, -iy, -iz], surface: 'flesh', distance: dist });
      alreadyHit.add(p.id);
      // rounds pass through soft targets but lose most of their energy
      energy *= 0.34 * (weapon.penetration ?? 0.5);
      px = hx + ix * 0.05; py = hy + iy * 0.05; pz = hz + iz * 0.05;
      travelled = dist + 0.05;
      if (path) path.push(px, py, pz);
      if (energy <= 0.06) break;
      continue;
    }

    if (wh) {
      const props = SURFACE_PROPS[wh.surface] || SURFACE_PROPS.concrete;
      const hp = wh.point;
      const dist = travelled + wh.t;
      impacts.push({
        point: [hp[0], hp[1], hp[2]], normal: wh.normal, surface: wh.surface,
        distance: dist, energy, collider: wh.collider, breakable: wh.collider.breakable
      });
      if (path) path.push(hp[0], hp[1], hp[2]);

      // penetration: thicker + denser costs more, weapon power pays for it
      const thickness = Math.min(wh.thickness, 2.0);
      const power = (weapon.penetration ?? 0.5) * energy;
      const cost = (thickness * props.density) / Math.max(0.05, props.maxPen * 4);
      if (pens < 3 && power > cost && thickness < props.maxPen * 6) {
        energy *= clamp(1 - cost / Math.max(power, 0.01) * 0.75, 0.12, 0.92);
        pens++;
        const exit = wh.t + thickness + 0.01;
        px += ix * exit; py += iy * exit; pz += iz * exit;
        travelled = dist + thickness;
        // slight deflection through material
        const dev = 0.006 * thickness * props.density;
        vx += (jitter() - 0.5) * dev * speed;
        vy += (jitter() - 0.5) * dev * speed;
        vz += (jitter() - 0.5) * dev * speed;
        if (path) path.push(px, py, pz);
        continue;
      }
      energy = 0;
      break;
    }

    px = nx; py = ny; pz = nz;
    vy -= drop * dt;
    travelled += segLen;
    t += dt;
    if (path && guard % 8 === 0) path.push(px, py, pz);
  }

  if (path && (path.length < 6 || path[path.length - 3] !== px)) path.push(px, py, pz);
  return { impacts, hits, path, endPoint: [px, py, pz], travelled };
}

/** Fire one trigger pull (handles shotgun pellets). */
export function fireWeapon(opts) {
  const { weapon, seed = 1, spreadDeg = 0, dir } = opts;
  const rng = mulberry32(seed);
  const pellets = weapon.pellets || 1;
  const results = [];
  for (let i = 0; i < pellets; i++) {
    const spread = pellets > 1 ? weapon.pelletSpread * (0.35 + rng() * 0.8) : spreadDeg;
    const d = i === 0 && pellets === 1 && spreadDeg <= 0.0001
      ? dir
      : applySpread(dir[0], dir[1], dir[2], spread, rng);
    results.push(simulateBullet({ ...opts, dir: d, rng }));
  }
  return results;
}
