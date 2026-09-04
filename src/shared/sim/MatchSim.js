// Authoritative match simulation.
//
// Runs on the Node server for online play and, unchanged, inside the browser
// for offline Training — the client just feeds it local input instead of
// packets.  It owns movement, hit validation with lag compensation, health,
// scoring, respawns and the per-mode round flow.

import { World } from '../physics.js';
import { getMap } from '../maps/index.js';
import { createMoveState, stepMovement, playerHeight, eyeHeight } from '../movement.js';
import { simulateBullet, applySpread } from '../ballistics.js';
import { WEAPON_BY_KEY, WEAPON_BY_ID, fireInterval, PRIMARIES, SECONDARIES } from '../weapons.js';
import { resolveWeapon } from '../attachments.js';
import { MODES } from '../modes.js';
import { BotBrain, botName } from './bot.js';
import { EV, SF } from '../protocol.js';
import {
  MAX_HEALTH, RESPAWN_DELAY_MS, HEAL_DELAY_MS, HEAL_RATE, TEAM, BTN,
  LAG_COMP_MAX_MS, HISTORY_SECONDS, clamp, mulberry32, lerp
} from '../constants.js';

const PHASE = { WARMUP: 'warmup', FREEZE: 'freeze', LIVE: 'live', ROUND_END: 'roundEnd', MATCH_END: 'matchEnd' };

let nextEntityId = 1;

export class MatchSim {
  constructor(opts = {}) {
    this.mapKey = opts.map || 'warehouse';
    this.map = getMap(this.mapKey);
    this.world = new World(this.map.brushes, { key: this.mapKey });
    this.modeKey = opts.mode || 'tdm';
    this.mode = MODES[this.modeKey] || MODES.tdm;

    const o = opts.options || {};
    this.options = {
      scoreLimit: o.scoreLimit ?? this.mode.scoreLimit ?? 75,
      timeLimitSec: o.timeLimitSec ?? this.mode.timeLimitSec ?? 600,
      roundsToWin: o.roundsToWin ?? this.mode.roundsToWin ?? 7,
      roundTimeSec: o.roundTimeSec ?? this.mode.roundTimeSec ?? 150,
      freezeSec: o.freezeSec ?? this.mode.freezeSec ?? 5,
      friendlyFire: o.friendlyFire ?? this.mode.friendlyFireDefault ?? false,
      maxPlayers: o.maxPlayers ?? this.mode.maxPlayers ?? 12,
      botSkill: o.botSkill || 'normal',
      respawnDelay: o.respawnDelay ?? RESPAWN_DELAY_MS
    };

    this.players = new Map();
    this.time = 0;                 // seconds since sim start
    this.tickCount = 0;
    this.events = [];
    this.scores = { 1: 0, 2: 0 };
    this.round = 0;
    this.roundWins = { 1: 0, 2: 0 };
    this.phase = PHASE.WARMUP;
    this.phaseEnd = 0;
    this.matchEndsAt = 0;
    this.bomb = null;
    this.rng = mulberry32(opts.seed || (Date.now() & 0xffffffff));
    this.spawnCursor = { 1: 0, 2: 0, ffa: 0 };
    this.started = false;
  }

  // -------------------------------------------------------------------------
  now() { return this.time * 1000; }

  emit(type, data) { this.events.push({ e: type, ...data }); }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // -------------------------------------------------------------------------
  addPlayer(info = {}) {
    // A client-supplied id (the human player, always id 1 in offline/training
    // sims) doesn't advance this counter — so the very first auto-assigned
    // bot id also came out as 1, colliding with and silently overwriting the
    // human's own entry in `this.players` (same Map key). Advancing the
    // counter past any explicit id, not just auto-assigned ones, closes that
    // off for good.
    const id = info.id ?? nextEntityId++;
    if (id >= nextEntityId) nextEntityId = id + 1;
    const teamed = this.mode.teams;
    let team = info.team;
    if (team === undefined || team === null) team = teamed ? this.autoTeam() : TEAM.NONE;
    const p = {
      id,
      name: info.name || 'OPERATOR',
      team,
      bot: !!info.bot,
      brain: info.bot ? new BotBrain(id * 7919 + 13, info.skill || this.options.botSkill) : null,
      skill: info.skill || this.options.botSkill,
      state: createMoveState(0, 0, 0),
      health: MAX_HEALTH,
      alive: false,
      slot: 0,
      weapons: [],
      lastFire: -999,
      lastDamage: -999,
      lastCmdSeq: 0,
      inputQueue: [],
      history: [],
      respawnAt: 0,
      kills: 0, deaths: 0, assists: 0, score: 0, streak: 0,
      damageDealt: 0, shotsFired: 0, hits: 0, headshots: 0,
      ping: 0, packetLoss: 0,
      connected: true,
      firing: false, reloading: false, reloadEnd: 0,
      planting: false, plantProgress: 0,
      lastShotAt: 0,
      joinedAt: this.time
    };
    this.setLoadout(p, info.loadout);
    this.players.set(id, p);
    if (this.phase === PHASE.LIVE || this.phase === PHASE.WARMUP || this.mode.respawn) {
      this.respawn(p, true);
    }
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  autoTeam() {
    let a = 0, b = 0;
    for (const p of this.players.values()) {
      if (p.team === TEAM.ALPHA) a++;
      else if (p.team === TEAM.BRAVO) b++;
    }
    return a <= b ? TEAM.ALPHA : TEAM.BRAVO;
  }

  setLoadout(p, loadout) {
    let primaryKey = loadout?.primary;
    let secondaryKey = loadout?.secondary;
    let pAtt = loadout?.primaryAttachments || [];
    let sAtt = loadout?.secondaryAttachments || [];
    if (this.mode.randomLoadout) {
      const pr = PRIMARIES[Math.floor(this.rng() * PRIMARIES.length)];
      const se = SECONDARIES[Math.floor(this.rng() * SECONDARIES.length)];
      primaryKey = pr.key; secondaryKey = se.key;
      pAtt = this.rng() > 0.5 ? ['reddot'] : [];
      sAtt = [];
    }
    const primary = WEAPON_BY_KEY[primaryKey] || WEAPON_BY_KEY.m4a1;
    const secondary = WEAPON_BY_KEY[secondaryKey] || WEAPON_BY_KEY.glock17;
    p.loadout = {
      primary: primary.key, secondary: secondary.key,
      primaryAttachments: pAtt, secondaryAttachments: sAtt
    };
    const knife = WEAPON_BY_KEY.knife;
    p.weapons = [
      { def: resolveWeapon(primary, pAtt), ammo: primary.magSize, reserve: primary.reserve },
      { def: resolveWeapon(secondary, sAtt), ammo: secondary.magSize, reserve: secondary.reserve },
      { def: resolveWeapon(knife, []), ammo: knife.magSize, reserve: knife.reserve }
    ];
    p.slot = 0;
  }

  // -------------------------------------------------------------------------
  spawnPointFor(p) {
    const sp = this.map.spawns;
    let list;
    if (this.mode.teams && p.team === TEAM.ALPHA && sp.alpha.length) list = sp.alpha;
    else if (this.mode.teams && p.team === TEAM.BRAVO && sp.bravo.length) list = sp.bravo;
    else list = sp.ffa;
    if (!list.length) list = sp.ffa;

    // pick the spawn furthest from the nearest living enemy
    let best = list[0], bestScore = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = list[(i + Math.floor(this.rng() * list.length)) % list.length];
      let nearest = Infinity;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        if (this.mode.teams && o.team === p.team) continue;
        const d = Math.hypot(o.state.x - s.p[0], o.state.z - s.p[2]);
        if (d < nearest) nearest = d;
      }
      const score = (nearest === Infinity ? 100 : Math.min(nearest, 60)) + this.rng() * 6;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  respawn(p, immediate = false) {
    const s = this.spawnPointFor(p);
    p.state = createMoveState(s.p[0], s.p[1] + 0.05, s.p[2]);
    p.state.yaw = s.yaw;
    p.health = MAX_HEALTH;
    p.alive = true;
    p.firing = false;
    p.reloading = false;
    p.planting = false;
    p.lastDamage = -999;
    p.slot = 0;
    if (this.mode.randomLoadout) this.setLoadout(p, p.loadout);
    for (const w of p.weapons) { w.ammo = w.def.magSize; w.reserve = w.def.reserve; }
    if (p.brain) { p.brain.target = null; p.brain.enemyId = -1; }
    this.emit(EV.SPAWN, { p: p.id, x: s.p[0], y: s.p[1], z: s.p[2], yaw: s.yaw });
  }

  // -------------------------------------------------------------------------
  queueInput(id, cmds) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    for (const c of cmds) {
      if (c.seq <= p.lastCmdSeq) continue;
      p.inputQueue.push(c);
    }
    if (p.inputQueue.length > 40) p.inputQueue.splice(0, p.inputQueue.length - 40);
  }

  /** Validated shot. Returns the resulting events. */
  handleShot(id, shot, rewindMs = 0) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    if (this.phase === PHASE.FREEZE || this.phase === PHASE.ROUND_END) return;
    const w = p.weapons[clamp(shot.slot ?? p.slot, 0, p.weapons.length - 1)];
    if (!w) return;
    const now = this.time;
    // Rate limit. The window is deliberately looser than the weapon's true
    // cadence: shots are fired on the client's clock and arrive bunched by
    // jitter, so a gate set close to the exact interval silently discards
    // legitimate rounds — which the player experiences as shots that simply
    // do not register. 0.7 still blocks any real rapid-fire cheat while
    // leaving room for ordinary timing noise.
    const minInterval = fireInterval(w.def) * 0.70;
    if (now - p.lastFire < minInterval) return;
    // Melee never runs dry — magSize on the knife exists only to size the HUD
    // ammo readout, not to gate use. Without this guard the first stab of a
    // life would burn the knife's one "round" and every later swing that
    // life would be silently dropped here even though the client kept
    // predicting and animating them.
    if (!w.def.melee) {
      if (w.ammo <= 0) return;
      w.ammo--;
    }
    p.lastFire = now;
    p.shotsFired++;
    p.lastShotAt = now;
    p.firing = true;

    const origin = shot.origin;
    // reject shots that claim to start far from where the server has the player
    const eye = [p.state.x, p.state.y + eyeHeight(p.state), p.state.z];
    if (Math.hypot(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]) > 1.8) {
      origin[0] = eye[0]; origin[1] = eye[1]; origin[2] = eye[2];
    }

    this.emit(EV.SHOT, {
      p: p.id, w: w.def.id, o: round3(origin), d: round3(shot.dir), s: shot.seed >>> 0,
      sup: w.def.flags?.suppressed ? 1 : 0
    });
    this.alertBots(p, origin, w.def.flags?.suppressed ? 0.35 : 1);

    const rewind = clamp(rewindMs, 0, LAG_COMP_MAX_MS);
    const targetsAt = (t) => this.rewoundTargets(p, rewind - t * 1000);
    const rng = mulberry32(shot.seed >>> 0);
    const pellets = w.def.pellets || 1;
    const spread = clamp(shot.spread ?? w.def.spreadHip, 0, w.def.spreadMax * 1.3);
    const victims = new Map();

    // --- melee: a slash, resolved on its own terms ------------------------
    // A blade sweeps an arc rather than firing a round down a single line, so
    // three rays are cast across the swing and only the NEAREST victim is cut
    // — the arc widens the swing without letting one slash deal damage three
    // times. A hit taken from behind is multiplied into an instant kill; from
    // the front the same slash takes two.
    if (w.def.melee) {
      let best = null;
      for (const off of [-0.16, 0, 0.16]) {
        const ca = Math.cos(off), sa = Math.sin(off);
        const d = [
          shot.dir[0] * ca - shot.dir[2] * sa,
          shot.dir[1],
          shot.dir[0] * sa + shot.dir[2] * ca
        ];
        const res = simulateBullet({
          world: this.world, origin, dir: d, weapon: w.def,
          shooterId: p.id, shooterTeam: this.options.friendlyFire ? 0 : p.team,
          targetsAt, friendlyFire: this.options.friendlyFire,
          recordPath: false, rng
        });
        for (const h of res.hits) {
          if (!best || h.distance < best.distance) best = { ...h, dir: d };
        }
      }
      if (best) {
        const victim = this.players.get(best.id);
        let dmg = best.damage;
        let zone = best.zone;
        if (victim) {
          // Victim's facing, in the same convention movement uses (forward is
          // -Z at yaw 0). If the attacker sits behind that facing, it's a
          // backstab.
          const vy = victim.state.yaw;
          const fx = -Math.sin(vy), fz = -Math.cos(vy);
          const tx = origin[0] - victim.state.x, tz = origin[2] - victim.state.z;
          if (fx * tx + fz * tz < 0) {
            dmg *= w.def.backstab || 1;
            zone = 'backstab';
          }
        }
        victims.set(best.id, { damage: dmg, zone, mult: best.mult, point: best.point, dir: best.dir });
      }
      for (const [vid, v] of victims) this.applyDamage(p, vid, v);
      return;
    }

    for (let i = 0; i < pellets; i++) {
      const deg = pellets > 1
        ? w.def.pelletSpread * (0.35 + rng() * 0.8)
        : spread * (0.55 + rng() * 0.5);
      const d = applySpread(shot.dir[0], shot.dir[1], shot.dir[2], deg, rng);
      const res = simulateBullet({
        world: this.world,
        origin,
        dir: d,
        weapon: w.def,
        shooterId: p.id,
        shooterTeam: this.options.friendlyFire ? 0 : p.team,
        targetsAt,
        friendlyFire: this.options.friendlyFire,
        recordPath: false,
        rng
      });
      for (const imp of res.impacts) {
        if (imp.surface !== 'flesh' && pellets === 1) {
          this.emit(EV.IMPACT, { p: round3(imp.point), n: round3(imp.normal), m: imp.surface });
        }
      }
      for (const h of res.hits) {
        const v = victims.get(h.id) || { damage: 0, zone: h.zone, mult: h.mult, point: h.point, dir: d };
        v.damage += h.damage;
        if (h.mult > v.mult) { v.mult = h.mult; v.zone = h.zone; }
        victims.set(h.id, v);
      }
    }

    for (const [vid, v] of victims) this.applyDamage(p, vid, v);
  }

  /** Gunfire is a position broadcast: bots within earshot go and look. */
  alertBots(shooter, origin, strength) {
    for (const o of this.players.values()) {
      if (!o.bot || !o.alive || o.id === shooter.id) continue;
      if (this.mode.teams && o.team === shooter.team) continue;
      const d = Math.hypot(o.state.x - origin[0], o.state.z - origin[2]);
      const range = (o.brain.skill.hearing || 30) * strength;
      if (d < range) o.brain.hearNoise(origin[0], origin[2], 1 - d / range);
    }
  }

  applyDamage(attacker, victimId, hit) {
    const v = this.players.get(victimId);
    if (!v || !v.alive) return;
    const dmg = Math.round(hit.damage * 10) / 10;
    v.health -= dmg;
    v.lastDamage = this.time;
    attacker.damageDealt += dmg;
    attacker.hits++;
    if (hit.zone === 'head') attacker.headshots++;

    // The hit point rides along so the client can put blood exactly where the
    // authoritative hit landed. Blood is spawned from this event and nowhere
    // else, which is what makes "blood came out" and "damage was dealt" the
    // same statement rather than two independent guesses.
    this.emit(EV.HIT, {
      a: attacker.id, v: v.id, z: hit.zone, d: Math.round(dmg),
      k: v.health <= 0 ? 1 : 0,
      p: round3(hit.point), dir: round3(hit.dir)
    });
    this.emit(EV.DAMAGE, {
      v: v.id, a: attacker.id, d: Math.round(dmg), z: hit.zone,
      dir: round3(hit.dir), pos: round3([attacker.state.x, attacker.state.y, attacker.state.z])
    });

    if (v.bot && v.brain) v.brain.takeFire(attacker.state.x, attacker.state.z);
    if (v.health <= 0) this.kill(attacker, v, hit.zone);
  }

  kill(attacker, victim, zone) {
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = this.time + this.options.respawnDelay / 1000;
    const self = attacker.id === victim.id;
    const friendly = this.mode.teams && attacker.team === victim.team && !self;
    if (!self && !friendly) {
      attacker.kills++;
      attacker.streak++;
      attacker.score += 100 + (zone === 'head' ? 50 : 0);
      if (!this.mode.rounds) this.addScore(attacker.team, 1);
    } else if (friendly) {
      attacker.score -= 50;
    }
    const w = attacker.weapons[attacker.slot];
    this.emit(EV.KILL, {
      a: attacker.id, v: victim.id, w: w ? w.def.id : 0, z: zone,
      hs: zone === 'head' ? 1 : 0, tk: friendly ? 1 : 0
    });
    this.checkRoundEnd();
    this.checkMatchEnd();
  }

  addScore(team, n) {
    if (this.mode.teams) this.scores[team] = (this.scores[team] || 0) + n;
    else {
      // FFA scores are per player; team slot 0 keeps the leader's score
      let top = 0;
      for (const p of this.players.values()) top = Math.max(top, p.kills);
      this.scores[1] = top;
    }
  }

  // -------------------------------------------------------------------------
  // lag compensation
  // -------------------------------------------------------------------------
  recordHistory() {
    const t = this.now();
    for (const p of this.players.values()) {
      p.history.push({
        t, x: p.state.x, y: p.state.y, z: p.state.z,
        yaw: p.state.yaw, crouchT: p.state.crouchT, alive: p.alive
      });
      const cutoff = t - HISTORY_SECONDS * 1000;
      while (p.history.length && p.history[0].t < cutoff) p.history.shift();
    }
  }

  rewoundTargets(shooter, rewindMs) {
    const t = this.now() - clamp(rewindMs, 0, LAG_COMP_MAX_MS);
    const out = [];
    for (const p of this.players.values()) {
      if (p.id === shooter.id) continue;
      let s = null;
      const h = p.history;
      if (!h.length || rewindMs <= 1) {
        s = { x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.state.yaw, crouchT: p.state.crouchT, alive: p.alive };
      } else {
        for (let i = h.length - 1; i >= 0; i--) {
          if (h[i].t <= t) {
            const a = h[i], b = h[i + 1];
            if (b && b.t > a.t) {
              const k = clamp((t - a.t) / (b.t - a.t), 0, 1);
              s = {
                x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k),
                yaw: a.yaw, crouchT: lerp(a.crouchT, b.crouchT, k), alive: a.alive
              };
            } else s = a;
            break;
          }
        }
        if (!s) s = h[0];
      }
      out.push({
        id: p.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw,
        height: lerp(1.80, 1.16, s.crouchT), team: p.team, alive: s.alive && p.alive,
        vx: p.state.vx, vz: p.state.vz
      });
    }
    return out;
  }

  visibleEnemies(p) {
    const out = [];
    for (const o of this.players.values()) {
      if (o.id === p.id || !o.alive) continue;
      if (this.mode.teams && o.team === p.team) continue;
      out.push({
        id: o.id, x: o.state.x, y: o.state.y, z: o.state.z,
        vx: o.state.vx, vz: o.state.vz, crouchT: o.state.crouchT, alive: o.alive
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // tick
  // -------------------------------------------------------------------------
  tick(dt) {
    this.time += dt;
    this.tickCount++;

    this.updatePhase(dt);

    const frozen = this.phase === PHASE.FREEZE || this.phase === PHASE.ROUND_END || this.phase === PHASE.MATCH_END;

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.mode.respawn && this.phase === PHASE.LIVE && this.time >= p.respawnAt) this.respawn(p);
        continue;
      }
      p.firing = false;

      if (p.bot) this.tickBot(p, dt, frozen);
      else this.tickHuman(p, dt, frozen);

      // health regeneration between engagements
      if (p.health < MAX_HEALTH && this.time - p.lastDamage > HEAL_DELAY_MS / 1000) {
        p.health = Math.min(MAX_HEALTH, p.health + HEAL_RATE * dt);
      }
      // reload completion
      if (p.reloading && this.time >= p.reloadEnd) {
        const w = p.weapons[p.slot];
        const need = w.def.magSize - w.ammo;
        const take = Math.min(need, w.reserve);
        w.ammo += take;
        w.reserve -= take;
        p.reloading = false;
      }
      // out of bounds safety
      if (p.state.y < -60) this.kill(p, p, 'torso');
    }

    if (this.modeKey === 'snd') this.tickBomb(dt);
    this.recordHistory();
    return this.takeEvents();
  }

  tickHuman(p, dt, frozen) {
    const q = p.inputQueue;
    let processed = 0;
    while (q.length && processed < 8) {
      const c = q.shift();
      const w = p.weapons[p.slot];
      const mobility = w ? w.def.mobility : 1;
      // Human commands carry their own clock (see LocalPlayer). Older or
      // malformed ones fall back to the sim clock so the cooldowns still work.
      const base = c.t !== undefined ? c : { ...c, t: this.time };
      const cmd = frozen
        ? { ...base, buttons: base.buttons & ~(BTN.FORWARD | BTN.BACK | BTN.LEFT | BTN.RIGHT | BTN.JUMP | BTN.FIRE) }
        : base;
      stepMovement(p.state, cmd, this.world, mobility, p.alive && !frozen);
      p.lastCmdSeq = c.seq;
      p.buttons = c.buttons;
      processed++;
    }
    if (!processed && q.length === 0) {
      // no input this tick: coast with the last known buttons so gravity applies
      stepMovement(p.state, {
        buttons: (p.buttons || 0) & ~(BTN.JUMP),
        yaw: p.state.yaw, pitch: p.state.pitch, dt
      }, this.world, 1, p.alive && !frozen);
    }
  }

  tickBot(p, dt, frozen) {
    const w = p.weapons[p.slot];
    const enemies = this.visibleEnemies(p);
    const objective = this.bomb && this.bomb.planted ? this.bomb.pos : null;
    const out = p.brain.think(dt, p.state, this.world, enemies, this.map, {
      ammo: w ? w.ammo : 0, objective, phase: this.phase,
      enemyHints: enemies.map((e) => [e.x, e.y, e.z])
    });
    const cmd = {
      seq: 0,
      buttons: frozen ? 0 : out.buttons,
      yaw: out.yaw, pitch: out.pitch, dt,
      t: this.time
    };
    stepMovement(p.state, cmd, this.world, w ? w.def.mobility : 1, p.alive && !frozen);

    if (frozen) return;
    if (out.reload && !p.reloading && w && w.reserve > 0 && w.ammo < w.def.magSize) {
      this.startReload(p);
    }
    if (out.fire && !p.reloading && w && w.ammo > 0) {
      const interval = fireInterval(w.def);
      if (this.time - p.lastFire >= interval) {
        const eye = [p.state.x, p.state.y + eyeHeight(p.state), p.state.z];
        const cy = Math.cos(out.pitch);
        const dir = [-Math.sin(out.yaw) * cy, Math.sin(out.pitch), -Math.cos(out.yaw) * cy];
        this.handleShot(p.id, {
          seed: (this.rng() * 0xffffffff) >>> 0,
          spread: w.def.spreadAds * 1.6,
          origin: eye, dir, slot: p.slot
        }, 0);
      }
    }
    if (w && w.ammo === 0 && !p.reloading) this.startReload(p);
  }

  startReload(p) {
    const w = p.weapons[p.slot];
    if (!w || p.reloading || w.reserve <= 0 || w.ammo >= w.def.magSize) return;
    const empty = w.ammo === 0;
    const dur = w.def.shellReload
      ? w.def.reloadStart + w.def.reloadTactical * Math.min(w.def.magSize - w.ammo, w.reserve) + w.def.reloadEnd
      : (empty ? w.def.reloadEmpty : w.def.reloadTactical);
    p.reloading = true;
    p.reloadEnd = this.time + dur;
    this.emit(EV.RELOAD, { p: p.id, w: w.def.id, empty: empty ? 1 : 0 });
  }

  handleReload(id) {
    const p = this.players.get(id);
    if (p && p.alive) this.startReload(p);
  }

  handleSwitch(id, slot) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const s = clamp(slot | 0, 0, p.weapons.length - 1);
    if (s === p.slot) return;
    p.slot = s;
    p.reloading = false;
    this.emit(EV.SWITCH, { p: p.id, w: p.weapons[s].def.id });
  }

  // -------------------------------------------------------------------------
  // phases / modes
  // -------------------------------------------------------------------------
  start() {
    this.started = true;
    if (this.mode.rounds) this.beginRound();
    else {
      this.phase = PHASE.LIVE;
      this.matchEndsAt = this.time + this.options.timeLimitSec;
      for (const p of this.players.values()) if (!p.alive) this.respawn(p);
    }
  }

  beginRound() {
    this.round++;
    this.phase = PHASE.FREEZE;
    this.phaseEnd = this.time + this.options.freezeSec;
    this.bomb = this.modeKey === 'snd'
      ? { planted: false, carrier: null, pos: null, site: null, timer: 0, defusing: null, defuseProgress: 0 }
      : null;
    for (const p of this.players.values()) this.respawn(p);
    // in S&D, alpha attacks
    this.emit(EV.ROUND_START, { round: this.round, freeze: this.options.freezeSec });
  }

  updatePhase(dt) {
    switch (this.phase) {
      case PHASE.WARMUP:
        if (this.started) return;
        break;
      case PHASE.FREEZE:
        if (this.time >= this.phaseEnd) {
          this.phase = PHASE.LIVE;
          this.phaseEnd = this.time + this.options.roundTimeSec;
        }
        break;
      case PHASE.LIVE:
        if (this.mode.rounds) {
          if (this.time >= this.phaseEnd && !(this.bomb && this.bomb.planted)) {
            this.endRound(this.modeKey === 'snd' ? TEAM.BRAVO : this.timeoutWinner(), 'time');
          }
        } else if (this.time >= this.matchEndsAt) {
          this.endMatch('time');
        }
        break;
      case PHASE.ROUND_END:
        if (this.time >= this.phaseEnd) {
          if (this.roundWins[1] >= this.options.roundsToWin || this.roundWins[2] >= this.options.roundsToWin) {
            this.endMatch('rounds');
          } else this.beginRound();
        }
        break;
      default: break;
    }
  }

  timeoutWinner() {
    let a = 0, b = 0;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.team === TEAM.ALPHA) a++; else if (p.team === TEAM.BRAVO) b++;
    }
    if (a > b) return TEAM.ALPHA;
    if (b > a) return TEAM.BRAVO;
    return TEAM.NONE;
  }

  checkRoundEnd() {
    if (!this.mode.rounds || this.phase !== PHASE.LIVE) return;
    let a = 0, b = 0;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.team === TEAM.ALPHA) a++; else if (p.team === TEAM.BRAVO) b++;
    }
    if (a === 0 && b === 0) this.endRound(TEAM.NONE, 'wipe');
    else if (a === 0) this.endRound(TEAM.BRAVO, 'wipe');
    else if (b === 0) {
      // in S&D a planted charge still has to be defused
      if (this.modeKey === 'snd' && this.bomb && this.bomb.planted) return;
      this.endRound(TEAM.ALPHA, 'wipe');
    }
  }

  endRound(winner, reason) {
    if (this.phase === PHASE.ROUND_END || this.phase === PHASE.MATCH_END) return;
    this.phase = PHASE.ROUND_END;
    this.phaseEnd = this.time + 5;
    if (winner === TEAM.ALPHA || winner === TEAM.BRAVO) {
      this.roundWins[winner]++;
      this.scores[winner] = this.roundWins[winner];
      for (const p of this.players.values()) if (p.team === winner) p.score += 200;
    }
    this.emit(EV.ROUND_END, {
      winner, reason, a: this.roundWins[1], b: this.roundWins[2], round: this.round
    });
  }

  checkMatchEnd() {
    if (this.mode.rounds) return;
    if (this.mode.teams) {
      if (this.scores[1] >= this.options.scoreLimit || this.scores[2] >= this.options.scoreLimit) this.endMatch('score');
    } else {
      for (const p of this.players.values()) {
        if (p.kills >= this.options.scoreLimit) { this.endMatch('score'); return; }
      }
    }
  }

  endMatch(reason) {
    if (this.phase === PHASE.MATCH_END) return;
    this.phase = PHASE.MATCH_END;
    this.phaseEnd = this.time + 15;
    const board = this.scoreboard();
    this.emit(EV.MATCH_END, { reason, scores: { ...this.scores }, rounds: { ...this.roundWins }, board });
  }

  // -------------------------------------------------------------------------
  // Search & Destroy objective
  // -------------------------------------------------------------------------
  handlePlant(id, down) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.modeKey !== 'snd' || !this.bomb || this.bomb.planted) return;
    if (p.team !== TEAM.ALPHA) return;
    const site = this.siteAt(p.state.x, p.state.y, p.state.z);
    p.planting = !!down && !!site;
    if (!p.planting) p.plantProgress = 0;
    else if (p.plantProgress === 0) this.emit(EV.PLANT_START, { p: p.id, site: site.name });
  }

  handleDefuse(id, down) {
    const p = this.players.get(id);
    if (!p || !p.alive || !this.bomb || !this.bomb.planted) return;
    if (p.team !== TEAM.BRAVO) return;
    const d = Math.hypot(p.state.x - this.bomb.pos[0], p.state.z - this.bomb.pos[2]);
    const ok = !!down && d < 2.0;
    if (ok && this.bomb.defusing !== p.id) {
      this.bomb.defusing = p.id;
      this.bomb.defuseProgress = 0;
      this.emit(EV.DEFUSE_START, { p: p.id });
    } else if (!ok && this.bomb.defusing === p.id) {
      this.bomb.defusing = null;
      this.bomb.defuseProgress = 0;
    }
  }

  siteAt(x, y, z) {
    for (const s of this.map.sites) {
      if (Math.hypot(x - s.p[0], z - s.p[2]) < s.radius && Math.abs(y - s.p[1]) < 3.5) return s;
    }
    return null;
  }

  tickBomb(dt) {
    const b = this.bomb;
    if (!b || this.phase !== PHASE.LIVE) return;
    if (!b.planted) {
      for (const p of this.players.values()) {
        if (!p.alive || !p.planting) continue;
        const site = this.siteAt(p.state.x, p.state.y, p.state.z);
        if (!site) { p.planting = false; p.plantProgress = 0; continue; }
        p.plantProgress += dt;
        if (p.plantProgress >= this.mode.plantTimeSec) {
          b.planted = true;
          b.pos = [p.state.x, p.state.y, p.state.z];
          b.site = site.name;
          b.timer = this.mode.bombTimerSec;
          p.planting = false;
          p.score += 150;
          this.phaseEnd = this.time + this.mode.bombTimerSec;
          this.emit(EV.PLANTED, { p: p.id, site: site.name, pos: round3(b.pos) });
          break;
        }
      }
      return;
    }
    b.timer -= dt;
    if (b.defusing !== null) {
      const d = this.players.get(b.defusing);
      if (!d || !d.alive) { b.defusing = null; b.defuseProgress = 0; }
      else {
        b.defuseProgress += dt;
        if (b.defuseProgress >= this.mode.defuseTimeSec) {
          d.score += 150;
          this.emit(EV.DEFUSED, { p: d.id });
          this.endRound(TEAM.BRAVO, 'defused');
          return;
        }
      }
    }
    if (b.timer <= 0) {
      this.emit(EV.BOMB_TICK, { detonated: 1, pos: round3(b.pos) });
      // everyone near the charge dies
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const d = Math.hypot(p.state.x - b.pos[0], p.state.z - b.pos[2]);
        if (d < 9) { p.alive = false; p.health = 0; p.deaths++; }
      }
      this.endRound(TEAM.ALPHA, 'detonated');
    }
  }

  // -------------------------------------------------------------------------
  // views
  // -------------------------------------------------------------------------
  flagsFor(p) {
    const st = p.state;
    let f = 0;
    if (st.crouchT > 0.5) f |= SF.CROUCH;
    if (st.sprinting) f |= SF.SPRINT;
    if (st.ads) f |= SF.ADS;
    if (p.firing || this.time - p.lastShotAt < 0.12) f |= SF.FIRING;
    if (p.reloading) f |= SF.RELOADING;
    if (!p.alive) f |= SF.DEAD;
    if (st.grounded) f |= SF.GROUNDED;
    if (st.leanT < -0.25) f |= SF.LEAN_L;
    if (st.leanT > 0.25) f |= SF.LEAN_R;
    if (st.walking) f |= SF.WALK;
    if (st.speed > 0.4) f |= SF.MOVING;
    if (p.bot) f |= SF.BOT;
    if (p.planting) f |= SF.PLANTING;
    return f;
  }

  snapshotFor(id) {
    const me = this.players.get(id);
    const others = [];
    for (const p of this.players.values()) {
      if (p.id === id) continue;
      others.push({
        id: p.id, x: p.state.x, y: p.state.y, z: p.state.z,
        yaw: p.state.yaw, pitch: p.state.pitch, flags: this.flagsFor(p),
        health: Math.max(0, Math.round(p.health)), team: p.team,
        weapon: p.weapons[p.slot] ? p.weapons[p.slot].def.id : 0,
        lean: p.state.leanT
      });
    }
    const self = me ? {
      x: me.state.x, y: me.state.y, z: me.state.z,
      vx: me.state.vx, vy: me.state.vy, vz: me.state.vz,
      flags: this.flagsFor(me), health: Math.max(0, Math.round(me.health)),
      armour: 0, lean: me.state.leanT, crouchT: me.state.crouchT
    } : { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, flags: 0, health: 0, armour: 0, lean: 0, crouchT: 0 };
    return { self, players: others, ack: me ? me.lastCmdSeq : 0 };
  }

  scoreboard() {
    const rows = [];
    for (const p of this.players.values()) {
      rows.push({
        id: p.id, name: p.name, team: p.team, bot: p.bot,
        kills: p.kills, deaths: p.deaths, assists: p.assists,
        score: p.score, ping: p.ping, alive: p.alive,
        damage: Math.round(p.damageDealt),
        acc: p.shotsFired ? Math.round((p.hits / p.shotsFired) * 100) : 0,
        hs: p.headshots, streak: p.streak
      });
    }
    rows.sort((a, b) => b.score - a.score || b.kills - a.kills);
    return rows;
  }

  matchState() {
    const timeLeft = this.phase === PHASE.LIVE && this.mode.rounds
      ? Math.max(0, this.phaseEnd - this.time)
      : this.phase === PHASE.FREEZE ? Math.max(0, this.phaseEnd - this.time)
        : this.mode.rounds ? 0 : Math.max(0, this.matchEndsAt - this.time);
    return {
      map: this.mapKey,
      mapName: this.map.name,
      mode: this.modeKey,
      modeName: this.mode.name,
      phase: this.phase,
      round: this.round,
      timeLeft: Math.round(timeLeft),
      scores: { ...this.scores },
      roundWins: { ...this.roundWins },
      scoreLimit: this.options.scoreLimit,
      roundsToWin: this.options.roundsToWin,
      friendlyFire: this.options.friendlyFire,
      bomb: this.bomb ? {
        planted: this.bomb.planted, site: this.bomb.site,
        timer: Math.max(0, Math.round(this.bomb.timer)),
        pos: this.bomb.pos, defusing: this.bomb.defusing !== null
      } : null,
      board: this.scoreboard()
    };
  }

  playerCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }
}

function round3(a) {
  return [Math.round(a[0] * 1000) / 1000, Math.round(a[1] * 1000) / 1000, Math.round(a[2] * 1000) / 1000];
}

export { PHASE };
