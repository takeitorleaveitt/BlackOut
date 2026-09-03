// A room is one running match: an authoritative MatchSim plus the set of
// sockets watching it.  Rooms tick at TICK_RATE and broadcast snapshots at
// SNAPSHOT_RATE; bots are topped up so a match is never empty.

import { MatchSim } from '../src/shared/sim/MatchSim.js';
import { botName } from '../src/shared/sim/bot.js';
import { writeSnapshot, MSG } from '../src/shared/protocol.js';
import { MODES } from '../src/shared/modes.js';
import { getMap } from '../src/shared/maps/index.js';
import { TICK_MS, SNAPSHOT_MS, TEAM, INTERP_DELAY_MS, clamp } from '../src/shared/constants.js';

const CODE_CHARS = 'ACDEFGHJKLMNPQRTUVWXYZ2346789';

export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

let roomSeq = 1;

export class Room {
  constructor(opts = {}) {
    this.id = 'r' + (roomSeq++);
    this.name = opts.name || 'PUBLIC MATCH';
    this.private = !!opts.private;
    this.code = this.private ? (opts.code || makeRoomCode()) : null;
    this.region = opts.region || 'eu-west';
    this.hostId = opts.hostId || null;
    this.persistent = !!opts.persistent;
    this.mapRotation = opts.rotation || null;
    this.fillBots = opts.fillBots ?? (this.private ? 0 : 6);
    this.botSkill = opts.botSkill || 'normal';
    this.clients = new Map();          // clientId -> client
    this.lastTick = Date.now();
    this.accum = 0;
    this.snapAccum = 0;
    this.stateAccum = 0;
    this.closed = false;
    this.createdAt = Date.now();
    this.startRequested = !this.private;
    this.newMatch(opts.map, opts.mode, opts.options);
  }

  newMatch(map, mode, options) {
    const modeKey = MODES[mode] ? mode : 'tdm';
    this.sim = new MatchSim({ map, mode: modeKey, options });
    this.mapKey = this.sim.mapKey;
    this.modeKey = modeKey;
    this.options = this.sim.options;
    this.botCounter = 0;
    for (const c of this.clients.values()) {
      c.entity = this.sim.addPlayer({
        id: c.id, name: c.name, team: c.team, loadout: c.loadout
      });
      c.team = c.entity.team;
    }
    this.topUpBots();
    if (this.startRequested) this.sim.start();
    this.broadcastJson({ t: 'matchStart', ...this.info(), state: this.sim.matchState() });
  }

  get maxPlayers() { return this.options.maxPlayers; }
  get humanCount() { return this.clients.size; }
  get playerCount() { return this.sim.players.size; }

  info() {
    const map = getMap(this.mapKey);
    return {
      id: this.id,
      name: this.name,
      code: this.code,
      private: this.private,
      map: this.mapKey,
      mapName: map.name,
      mapSubtitle: map.subtitle,
      mode: this.modeKey,
      modeName: MODES[this.modeKey].name,
      region: this.region,
      players: this.humanCount,
      bots: this.playerCount - this.humanCount,
      maxPlayers: this.maxPlayers,
      friendlyFire: this.options.friendlyFire,
      scoreLimit: this.options.scoreLimit,
      roundTime: this.options.roundTimeSec,
      phase: this.sim.phase,
      host: this.hostId
    };
  }

  // -------------------------------------------------------------------------
  addClient(client) {
    if (this.clients.size >= this.maxPlayers) return false;
    this.clients.set(client.id, client);
    client.room = this;
    const entity = this.sim.addPlayer({
      id: client.id,
      name: client.name,
      team: client.preferredTeam,
      loadout: client.loadout
    });
    client.entity = entity;
    client.team = entity.team;
    // remove a bot to make room for the human
    this.trimBots();
    this.broadcastJson({
      t: 'playerJoined', id: client.id, name: client.name, team: entity.team
    });
    return true;
  }

  removeClient(client) {
    this.clients.delete(client.id);
    this.sim.removePlayer(client.id);
    client.room = null;
    this.broadcastJson({ t: 'playerLeft', id: client.id });
    if (this.private && this.hostId === client.id) {
      // hand the room over, or close it
      const next = this.clients.values().next().value;
      this.hostId = next ? next.id : null;
      if (this.hostId) this.broadcastJson({ t: 'roomInfo', ...this.info() });
    }
    if (!this.persistent && this.clients.size === 0) this.closed = true;
    else this.topUpBots();
  }

  topUpBots() {
    if (this.fillBots <= 0) return;
    const target = Math.min(this.maxPlayers, Math.max(this.fillBots, this.humanCount + 1));
    let guard = 0;
    while (this.sim.players.size < target && guard++ < 32) {
      this.sim.addPlayer({
        name: botName(this.botCounter++),
        bot: true,
        skill: this.botSkill
      });
    }
  }

  trimBots() {
    while (this.sim.players.size > this.maxPlayers) {
      let victim = null;
      for (const p of this.sim.players.values()) if (p.bot) victim = p;
      if (!victim) break;
      this.sim.removePlayer(victim.id);
    }
  }

  setSettings(settings) {
    const o = this.sim.options;
    if (settings.map && settings.map !== this.mapKey) this.pendingMap = settings.map;
    if (settings.mode && settings.mode !== this.modeKey) this.pendingMode = settings.mode;
    if (settings.maxPlayers) o.maxPlayers = clamp(settings.maxPlayers | 0, 2, 16);
    if (settings.scoreLimit) o.scoreLimit = clamp(settings.scoreLimit | 0, 5, 250);
    if (settings.roundTimeSec) o.roundTimeSec = clamp(settings.roundTimeSec | 0, 30, 600);
    if (settings.timeLimitSec) o.timeLimitSec = clamp(settings.timeLimitSec | 0, 60, 1800);
    if (settings.friendlyFire !== undefined) o.friendlyFire = !!settings.friendlyFire;
    if (settings.botSkill) this.botSkill = settings.botSkill;
    if (settings.bots !== undefined) { this.fillBots = clamp(settings.bots | 0, 0, 15); this.topUpBots(); }
    if (settings.name) this.name = String(settings.name).slice(0, 32);
    this.broadcastJson({ t: 'roomInfo', ...this.info(), pendingMap: this.pendingMap, pendingMode: this.pendingMode });
  }

  start() {
    this.startRequested = true;
    if (this.pendingMap || this.pendingMode) {
      const map = this.pendingMap || this.mapKey;
      const mode = this.pendingMode || this.modeKey;
      this.pendingMap = null;
      this.pendingMode = null;
      this.newMatch(map, mode, { ...this.options, friendlyFire: this.options.friendlyFire });
    } else if (this.sim.phase === 'warmup') {
      this.sim.start();
      this.broadcastJson({ t: 'matchStart', ...this.info(), state: this.sim.matchState() });
    }
  }

  // -------------------------------------------------------------------------
  update(now) {
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.accum += dt;

    let events = [];
    let guard = 0;
    while (this.accum >= TICK_MS / 1000 && guard++ < 6) {
      this.accum -= TICK_MS / 1000;
      const ev = this.sim.tick(TICK_MS / 1000);
      if (ev.length) events = events.length ? events.concat(ev) : ev;
    }

    if (events.length) this.broadcastJson({ t: 'ev', v: events });

    this.snapAccum += dt;
    if (this.snapAccum >= SNAPSHOT_MS / 1000) {
      // subtract rather than zero: zeroing quantises the send rate to the
      // update grid and silently turns 20Hz into 15Hz
      this.snapAccum -= SNAPSHOT_MS / 1000;
      if (this.snapAccum > SNAPSHOT_MS / 1000) this.snapAccum = 0;
      this.sendSnapshots();
    }

    this.stateAccum += dt;
    if (this.stateAccum >= 1.0) {
      this.stateAccum -= 1.0;
      const state = this.sim.matchState();
      for (const c of this.clients.values()) {
        c.entity = this.sim.players.get(c.id) || c.entity;
        if (c.entity) c.entity.ping = c.ping;
      }
      this.broadcastJson({ t: 'match', state });
    }

    // rotate to the next map once a match is over
    if (this.sim.phase === 'matchEnd' && this.sim.time >= this.sim.phaseEnd) {
      this.rotate();
    }
  }

  rotate() {
    const rotation = this.mapRotation || ['warehouse', 'suburb', 'refinery', 'blackwood', 'garage', 'highrise'];
    const i = rotation.indexOf(this.mapKey);
    const next = rotation[(i + 1) % rotation.length];
    this.startRequested = true;
    this.newMatch(next, this.modeKey, { ...this.options });
  }

  sendSnapshots() {
    const tick = this.sim.tickCount;
    for (const c of this.clients.values()) {
      if (c.ws.readyState !== 1) continue;
      const snap = this.sim.snapshotFor(c.id);
      const buf = writeSnapshot(tick, snap.ack, c.id, snap.self, snap.players);
      try { c.ws.send(buf, { binary: true }); } catch (e) { /* dropped */ }
    }
  }

  broadcastJson(obj, except = null) {
    const s = JSON.stringify(obj);
    for (const c of this.clients.values()) {
      if (c === except || c.ws.readyState !== 1) continue;
      try { c.ws.send(s); } catch (e) { /* dropped */ }
    }
  }
}
