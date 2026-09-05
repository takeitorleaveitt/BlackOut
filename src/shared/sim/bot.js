// Bot AI.  Produces the same input commands a human would send, so bots are
// simulated by exactly the same movement code and validated by exactly the same
// hit detection — there is no separate "bot physics".

import { BTN, clamp, mulberry32, lerp } from '../constants.js';
import { eyeHeight, playerHeight } from '../movement.js';

// Bots were tracking and correcting onto target so fast, with so little
// jitter, that even "normal" read as an aimbot. Reaction time roughly
// doubled, aim jitter roughly doubled-to-tripled, and tracking speed cut by
// nearly half across every tier — the ordering (easy < normal < hard <
// elite) is unchanged, the whole curve just got more human.
const SKILLS = {
  easy: { react: 0.62, aimError: 0.150, aimSpeed: 2.6, burst: [2, 5], pause: [0.55, 1.3], range: 38, hearing: 20 },
  normal: { react: 0.42, aimError: 0.095, aimSpeed: 4.2, burst: [3, 7], pause: [0.4, 0.9], range: 52, hearing: 26 },
  hard: { react: 0.26, aimError: 0.055, aimSpeed: 6.8, burst: [4, 9], pause: [0.25, 0.6], range: 70, hearing: 34 },
  elite: { react: 0.16, aimError: 0.030, aimSpeed: 10.0, burst: [5, 12], pause: [0.15, 0.4], range: 90, hearing: 40 }
};

export class BotBrain {
  constructor(seed = 1, skill = 'normal') {
    this.rng = mulberry32(seed);
    this.skill = SKILLS[skill] || SKILLS.normal;
    this.skillName = skill;
    this.target = null;          // waypoint {x,z}
    this.enemyId = -1;
    this.seenT = 0;
    this.lostT = 0;
    this.reactT = 0;
    this.fireT = 0;
    this.burstLeft = 0;
    this.pauseT = 0;
    this.yaw = this.rng() * Math.PI * 2;
    this.pitch = 0;
    this.strafe = 0;
    this.strafeT = 0;
    this.stuckT = 0;
    this.lastX = 0;
    this.lastZ = 0;
    this.jumpT = 0;
    this.crouch = false;
    this.crouchT = 0;
    this.repathT = 0;
    this.investigate = null;
    this.objective = null;
    // --- navigation ---
    this.path = null;            // array of {x,y,z} waypoints from the nav grid
    this.pathIdx = 0;
    this.pathFails = 0;          // consecutive destinations we could not path to
    this.unstickT = 0;           // seconds left of the "back out and go round" nudge
    this.unstickDir = 1;
  }

  /** Called when this bot is hit: turn and look for whoever did it. */
  takeFire(x, z) {
    this.investigate = { x, z };
    this.repathT = 0;
    this.target = null;
    // snap the aim roughly toward the incoming fire
    this.yaw = Math.atan2(-(x - this.lastX), -(z - this.lastZ));
  }

  /** Called when a shot is heard nearby, so bots react to noise. */
  hearNoise(x, z, strength = 1) {
    if (this.enemyId >= 0) return;
    if (this.rng() > 0.55 * strength) return;
    this.investigate = { x, z };
    this.repathT = 0;
  }

  /**
   * @returns { buttons, yaw, pitch, fire, reload }
   */
  think(dt, self, world, enemies, map, ctx = {}) {
    const sk = this.skill;
    const ex = self.x, ey = self.y + eyeHeight(self), ez = self.z;

    // --- target selection --------------------------------------------------
    let best = null, bestD = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - ex, dz = e.z - ez;
      const d = Math.hypot(dx, dz);
      if (d > sk.range) continue;
      // line of sight to the chest
      const ty = e.y + playerHeight(e) * 0.68;
      const dy = ty - ey;
      const len = Math.hypot(dx, dy, dz) || 1;
      const hit = world.raycast(ex, ey, ez, dx / len, dy / len, dz / len, len - 0.35);
      if (hit) continue;
      // rough field of view — bots are not omniscient
      const facing = Math.cos(this.yaw) * (-dz / d) + (-Math.sin(this.yaw)) * (dx / d);
      if (facing < 0.05 && d > 6) continue;
      if (d < bestD) { bestD = d; best = e; }
    }

    if (best) {
      if (this.enemyId !== best.id) {
        this.enemyId = best.id;
        this.reactT = sk.react * (0.7 + this.rng() * 0.6);
      }
      this.lostT = 0;
      this.seenT += dt;
      this.reactT = Math.max(0, this.reactT - dt);
    } else {
      this.lostT += dt;
      this.seenT = 0;
      if (this.lostT > 1.6) this.enemyId = -1;
    }

    let buttons = 0;
    let fire = false;
    let reload = false;
    const engaging = best && this.reactT <= 0;

    // --- aiming ------------------------------------------------------------
    if (best) {
      const aimY = best.y + playerHeight(best) * (this.rng() < 0.18 ? 0.90 : 0.66);
      const dx = best.x - ex, dy = aimY - ey, dz = best.z - ez;
      const dist = Math.hypot(dx, dy, dz) || 1;
      // lead the target a little at range
      const lead = clamp(dist / 320, 0, 0.25);
      const tx = dx + (best.vx || 0) * lead;
      const tz = dz + (best.vz || 0) * lead;
      const wantYaw = Math.atan2(-tx, -tz);
      const wantPitch = Math.asin(clamp(dy / dist, -1, 1));
      const err = sk.aimError * (1 + clamp(dist / 40, 0, 1.5)) * (this.seenT < 0.35 ? 2.4 : 1);
      const rate = 1 - Math.exp(-sk.aimSpeed * dt);
      this.yaw = lerpAngle(this.yaw, wantYaw + (this.rng() - 0.5) * err, rate);
      this.pitch = lerp(this.pitch, wantPitch + (this.rng() - 0.5) * err * 0.7, rate);
    } else if (this.target) {
      const wantYaw = Math.atan2(-(this.target.x - ex), -(this.target.z - ez));
      this.yaw = lerpAngle(this.yaw, wantYaw, 1 - Math.exp(-4.5 * dt));
      this.pitch = lerp(this.pitch, 0, 1 - Math.exp(-3 * dt));
    }

    // --- firing ------------------------------------------------------------
    if (engaging) {
      this.pauseT -= dt;
      if (this.burstLeft > 0) {
        fire = true;
        // Count DOWN the burst per round fired, not per think(). This ran once
        // a tick, so a "seven round burst" was seven ticks — a fifth of a
        // second — during which the weapon's own fire interval let maybe two
        // rounds out. Every bot on every skill fired the same ragged
        // double-tap and then paused, and none of the burst tuning did
        // anything at all. ctx.canShoot is the sim telling us the interval has
        // actually elapsed and this trigger pull becomes a bullet.
        if (ctx.canShoot !== false) {
          this.burstLeft -= 1;
          if (this.burstLeft <= 0) this.pauseT = lerp(sk.pause[0], sk.pause[1], this.rng());
        }
      } else if (this.pauseT <= 0) {
        this.burstLeft = Math.round(lerp(sk.burst[0], sk.burst[1], this.rng()));
      }
      // aim down sights at range
      if (bestD > 12 && this.rng() < 0.7) buttons |= BTN.ADS;
      // Crouch to steady a long shot, not in a knife fight. This was the wrong
      // way round: a 2% chance of crouching only when the enemy was inside
      // five metres, which is the one range where you want to be mobile.
      if (bestD > 14 && this.crouchT <= 0 && this.rng() < 0.012) this.crouchT = 1.2 + this.rng() * 1.6;
      this.crouchT -= dt;
      if (this.crouchT > 0 && bestD > 10) buttons |= BTN.CROUCH;
    } else {
      this.crouchT = 0;
    }
    // Top up between fights rather than being caught on an empty magazine.
    // Reloading in contact is how a bot dies holding a full gun it never fired.
    if (ctx.ammo === 0) reload = true;
    else if (!engaging && this.lostT > 1.2 && ctx.magSize && ctx.ammo < ctx.magSize * 0.65) reload = true;

    // --- movement ----------------------------------------------------------
    this.repathT -= dt;
    const moved = Math.hypot(self.x - this.lastX, self.z - this.lastZ);
    this.lastX = self.x; this.lastZ = self.z;
    // Stuck means "trying to get somewhere and not getting there". A bot
    // standing still because it is holding an angle is not stuck.
    const wantsToMove = !!this.target && !engaging;
    if (wantsToMove && moved < 0.012) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);

    if (!this.target || this.repathT <= 0 || this.stuckT > 0.8) {
      const stuck = this.stuckT > 0.8;
      this.retarget(self, map, ctx);
      this.repathT = 3.0 + this.rng() * 4;
      if (stuck) {
        this.stuckT = 0;
        // Back off and go round rather than grinding into the same corner:
        // a short reverse-and-strafe, and a hop in case it is a lip the
        // pathfinder thought was walkable.
        this.unstickT = 0.45;
        this.unstickDir = this.rng() < 0.5 ? -1 : 1;
        this.jumpT = 0.18;
      }
    }

    // Follow the path if we have one; otherwise head straight at the
    // destination, which is what the bots always used to do and is still the
    // right fallback when a point turns out to be off the grid entirely.
    const goal = this.currentWaypoint(self);
    if (goal) {
      const dx = goal.x - self.x, dz = goal.z - self.z;
      const d = Math.hypot(dx, dz);
      // move relative to where the bot is *looking*
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const fwd = (dx * fx + dz * fz) / d;
      const side = (dx * rx + dz * rz) / d;
      if (fwd > 0.30) buttons |= BTN.FORWARD;
      else if (fwd < -0.30) buttons |= BTN.BACK;
      if (side > 0.30) buttons |= BTN.RIGHT;
      else if (side < -0.30) buttons |= BTN.LEFT;
      // Sprint on a long straight leg only. Sprinting into a corner is how a
      // bot ends up hugging it.
      if (!engaging && fwd > 0.80 && d > 6 && this.stuckT < 0.2) buttons |= BTN.SPRINT;
      // Step up onto whatever the path is climbing.
      if (goal.y - self.y > 0.45) this.jumpT = Math.max(this.jumpT, 0.14);
    }

    // A bot that is not looking where it is going walks into things. Off the
    // trigger, face along the path.
    if (goal && !best) {
      const wantYaw = Math.atan2(-(goal.x - self.x), -(goal.z - self.z));
      this.yaw = lerpAngle(this.yaw, wantYaw, 1 - Math.exp(-5.5 * dt));
    }

    // combat strafing
    if (engaging) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = 0.5 + this.rng() * 1.1;
        this.strafe = this.rng() < 0.5 ? -1 : 1;
      }
      buttons &= ~(BTN.LEFT | BTN.RIGHT | BTN.SPRINT);
      // Do not strafe into a wall. The bots used to pick a side at random and
      // hold it for a second whatever was there, so half of every firefight
      // was spent grinding along the nearest surface.
      if (bestD > 4) {
        if (this.blocked(world, self, this.strafe > 0 ? 'right' : 'left')) this.strafe *= -1;
        if (!this.blocked(world, self, this.strafe > 0 ? 'right' : 'left')) {
          buttons |= this.strafe > 0 ? BTN.RIGHT : BTN.LEFT;
        }
      }
      if (bestD < 3.0) buttons |= BTN.BACK;
      else if (bestD > 22 && !this.blocked(world, self, 'fwd')) buttons |= BTN.FORWARD;
    }

    // Unstick nudge: reverse out and slide sideways for a moment.
    this.unstickT -= dt;
    if (this.unstickT > 0 && !engaging) {
      buttons &= ~(BTN.FORWARD | BTN.LEFT | BTN.RIGHT | BTN.SPRINT);
      buttons |= BTN.BACK;
      buttons |= this.unstickDir > 0 ? BTN.RIGHT : BTN.LEFT;
    }

    // Last-resort obstacle probe. With a real path this almost never fires,
    // but map geometry is not perfectly represented by a 0.9 m grid and a bot
    // that clips a door frame should slide off it rather than lean on it.
    if ((buttons & BTN.FORWARD) && this.blocked(world, self, 'fwd')) {
      buttons &= ~BTN.FORWARD;
      buttons |= this.strafe > 0 ? BTN.RIGHT : BTN.LEFT;
    }

    this.jumpT -= dt;
    if (this.jumpT > 0) buttons |= BTN.JUMP;

    return { buttons, yaw: this.yaw, pitch: this.pitch, fire, reload };
  }

  /** Is there something within a stride in that direction, at chest height? */
  blocked(world, self, dir) {
    let dx, dz;
    if (dir === 'fwd') { dx = -Math.sin(this.yaw); dz = -Math.cos(this.yaw); }
    else if (dir === 'right') { dx = Math.cos(this.yaw); dz = -Math.sin(this.yaw); }
    else { dx = -Math.cos(this.yaw); dz = Math.sin(this.yaw); }
    const hit = world.raycast(self.x, self.y + 0.95, self.z, dx, 0, dz, 1.1);
    if (!hit) return false;
    // Something low enough to step onto is not a blockage.
    return hit.collider.maxY - self.y > 0.55;
  }

  /**
   * The point to walk at right now: the next waypoint on the path, or the
   * destination itself when there is no path.
   */
  currentWaypoint(self) {
    if (this.path) {
      while (this.pathIdx < this.path.length) {
        const w = this.path[this.pathIdx];
        const d = Math.hypot(w.x - self.x, w.z - self.z);
        // Reached it when we are close horizontally AND roughly at its height
        // — otherwise a bot standing under a walkway ticks off the waypoint on
        // the walkway and skips the stairs that get it up there.
        if (d < 1.1 && Math.abs(w.y - self.y) < 1.4) { this.pathIdx++; continue; }
        return w;
      }
      this.path = null;
      this.target = null;
      this.repathT = 0;
      return null;
    }
    if (!this.target) return null;
    const d = Math.hypot(this.target.x - self.x, this.target.z - self.z);
    if (d < 1.8) { this.target = null; this.repathT = 0; return null; }
    return this.target;
  }

  /**
   * Pick a destination and a route to it. Tries a few destinations, because a
   * point picked at random on a map with catwalks and locked-off pockets is
   * not always somewhere you can actually walk to.
   */
  retarget(self, map, ctx) {
    const nav = ctx.nav;
    this.path = null;
    this.pathIdx = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.target = null;
      this.pickTarget(self, map, ctx);
      if (!this.target) return;
      if (!nav) return;                       // no grid: walk at it directly
      const path = nav.findPath(
        self.x, self.y, self.z,
        this.target.x, self.y, this.target.z
      );
      if (path && path.length) {
        this.path = path;
        this.pathFails = 0;
        return;
      }
      this.pathFails++;
    }
    // Nothing reachable came up. Keep the last destination and walk at it —
    // the direct approach still works in the open, and the stuck detector
    // will pull us off it if it does not.
  }

  pickTarget(self, map, ctx) {
    // Prefer, in order: something we just heard, the objective, a rough guess
    // at where the enemy is, then a patrol point.  Without the enemy hint the
    // bots simply never run into each other on a 90-metre map.
    const pool = [];
    if (ctx.objective) pool.push({ x: ctx.objective[0], z: ctx.objective[2], w: 6 });
    if (ctx.enemyHints) {
      for (const h of ctx.enemyHints) {
        pool.push({
          x: h[0] + (this.rng() - 0.5) * 9,
          z: h[2] + (this.rng() - 0.5) * 9,
          w: 9
        });
      }
    }
    if (map.sites) for (const s of map.sites) pool.push({ x: s.p[0], z: s.p[2], w: 2 });
    const sp = map.spawns.ffa;
    for (let i = 0; i < sp.length; i++) pool.push({ x: sp[i].p[0], z: sp[i].p[2], w: 1 });
    if (this.investigate) pool.push({ x: this.investigate.x, z: this.investigate.z, w: 22 });
    if (!pool.length) return;
    let total = 0;
    for (const p of pool) {
      const d = Math.hypot(p.x - self.x, p.z - self.z);
      p.score = p.w * (d > 4 ? 1 : 0.05) / (1 + d * 0.03);
      total += p.score;
    }
    let r = this.rng() * total;
    for (const p of pool) {
      r -= p.score;
      if (r <= 0) { this.target = { x: p.x, z: p.z }; break; }
    }
    if (!this.target) this.target = { x: pool[0].x, z: pool[0].z };
    this.investigate = null;
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const CALLSIGNS = [
  'VIPER', 'HOUND', 'RAVEN', 'SABLE', 'KILO', 'ORION', 'DELTA', 'ZULU', 'CRANE',
  'MAKO', 'BISHOP', 'FALCON', 'ONYX', 'RIFT', 'TALON', 'VECTOR', 'NOMAD', 'ASHER',
  'GRIM', 'HOLLOW', 'JACKAL', 'PIKE', 'STRAY', 'WARDEN', 'CINDER', 'DUSK'
];

export function botName(i) {
  return CALLSIGNS[i % CALLSIGNS.length] + (i >= CALLSIGNS.length ? '-' + Math.floor(i / CALLSIGNS.length) : '');
}

export const SKILL_NAMES = Object.keys(SKILLS);
