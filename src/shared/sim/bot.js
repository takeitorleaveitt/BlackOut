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
        this.burstLeft -= 1;
        fire = true;
        if (this.burstLeft <= 0) this.pauseT = lerp(sk.pause[0], sk.pause[1], this.rng());
      } else if (this.pauseT <= 0) {
        this.burstLeft = Math.round(lerp(sk.burst[0], sk.burst[1], this.rng()));
      }
      // aim down sights at range
      if (bestD > 12 && this.rng() < 0.7) buttons |= BTN.ADS;
      if (bestD < 5.5 && this.rng() < 0.02) buttons |= BTN.CROUCH;
    }
    if (ctx.ammo === 0 || (ctx.ammo !== undefined && ctx.ammo <= 2 && !engaging)) reload = true;

    // --- movement ----------------------------------------------------------
    this.repathT -= dt;
    const moved = Math.hypot(self.x - this.lastX, self.z - this.lastZ);
    this.lastX = self.x; this.lastZ = self.z;
    if (moved < 0.012 && !engaging) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);

    if (!this.target || this.repathT <= 0 || this.stuckT > 0.9) {
      this.pickTarget(self, map, ctx);
      this.repathT = 3.0 + this.rng() * 4;
      if (this.stuckT > 0.9) { this.stuckT = 0; this.jumpT = 0.2; }
    }

    if (this.target) {
      const dx = this.target.x - self.x, dz = this.target.z - self.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.8) { this.target = null; this.repathT = 0; }
      else {
        // move relative to where the bot is *looking*
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        const fwd = (dx * fx + dz * fz) / d;
        const side = (dx * rx + dz * rz) / d;
        if (fwd > 0.30) buttons |= BTN.FORWARD;
        else if (fwd < -0.30) buttons |= BTN.BACK;
        if (side > 0.30) buttons |= BTN.RIGHT;
        else if (side < -0.30) buttons |= BTN.LEFT;
        if (!engaging && fwd > 0.7 && d > 8) buttons |= BTN.SPRINT;
      }
    }

    // combat strafing
    if (engaging) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = 0.5 + this.rng() * 1.1;
        this.strafe = this.rng() < 0.5 ? -1 : 1;
      }
      buttons &= ~(BTN.LEFT | BTN.RIGHT | BTN.SPRINT);
      if (bestD > 4) buttons |= this.strafe > 0 ? BTN.RIGHT : BTN.LEFT;
      if (bestD < 3.0) buttons |= BTN.BACK;
      else if (bestD > 22) buttons |= BTN.FORWARD;
    }

    // simple obstacle avoidance: probe ahead and slide around
    if (buttons & BTN.FORWARD) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const probe = world.raycast(self.x, self.y + 0.9, self.z, fx, 0, fz, 1.5);
      if (probe) {
        buttons &= ~BTN.FORWARD;
        buttons |= this.strafe > 0 ? BTN.RIGHT : BTN.LEFT;
        if (probe.collider.maxY - self.y < 0.8) this.jumpT = 0.18;
      }
    }

    this.jumpT -= dt;
    if (this.jumpT > 0) buttons |= BTN.JUMP;

    return { buttons, yaw: this.yaw, pitch: this.pitch, fire, reload };
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
