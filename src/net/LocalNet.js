// Offline transport.
//
// Presents the same surface as NetClient but drives a MatchSim running in this
// tab.  Training therefore exercises the identical prediction, snapshot and
// event code path as an online match — there is no separate "single player"
// game loop to keep in sync.

import { MatchSim } from '../shared/sim/MatchSim.js';
import { botName } from '../shared/sim/bot.js';
import { bus } from '../core/EventBus.js';
import { TICK_MS, SNAPSHOT_MS } from '../shared/constants.js';

export class LocalNet {
  constructor(cfg = {}) {
    this.connected = true;
    this.id = 1;
    this.handlers = new Map();
    this.accum = 0;
    this.snapAccum = 0;
    this.stateAccum = 0;
    this.offline = true;
    this.sim = new MatchSim({
      map: cfg.map || 'killhouse',
      mode: cfg.mode || 'tdm',
      options: {
        friendlyFire: cfg.friendlyFire ?? false,
        botSkill: cfg.botSkill || 'normal',
        scoreLimit: cfg.scoreLimit,
        maxPlayers: Math.max(2, (cfg.bots || 0) + 1)
      }
    });
    this.player = this.sim.addPlayer({
      id: this.id, name: cfg.name || 'OPERATOR', loadout: cfg.loadout
    });
    for (let i = 0; i < (cfg.bots || 0); i++) {
      this.sim.addPlayer({ name: botName(i), bot: true, skill: cfg.botSkill || 'normal' });
    }
    this.sim.start();
    this.info = {
      id: 'offline', name: 'TRAINING', map: this.sim.mapKey, mapName: this.sim.map.name,
      mode: this.sim.modeKey, modeName: this.sim.mode.name, region: 'local',
      players: 1, bots: cfg.bots || 0, maxPlayers: (cfg.bots || 0) + 1, private: true,
      code: null, host: this.id, offline: true
    };
  }

  on(type, fn) {
    let a = this.handlers.get(type);
    if (!a) this.handlers.set(type, (a = []));
    a.push(fn);
  }

  emit(type, msg) {
    const a = this.handlers.get(type);
    if (a) for (const fn of a) fn(msg);
    bus.emit('net:' + type, msg);
  }

  /** Deliver the join message the game is waiting for. */
  begin() {
    this.emit('joined', {
      ...this.info, you: this.id, team: this.player.team,
      state: this.sim.matchState()
    });
  }

  sendInput(cmd) { this.sim.queueInput(this.id, [cmd]); }
  sendShot(shot) { this.sim.handleShot(this.id, shot, 0); }
  sendEvent(kind, data = {}) {
    if (kind === 'reload') this.sim.handleReload(this.id);
    else if (kind === 'switch') this.sim.handleSwitch(this.id, data.slot | 0);
    else if (kind === 'plant') this.sim.handlePlant(this.id, data.down);
    else if (kind === 'defuse') this.sim.handleDefuse(this.id, data.down);
  }
  requestRespawn() {
    const p = this.sim.players.get(this.id);
    if (p && !p.alive) p.respawnAt = Math.min(p.respawnAt, this.sim.time);
  }
  setLoadout(loadout) {
    const p = this.sim.players.get(this.id);
    if (p) this.sim.setLoadout(p, loadout);
  }
  setTeam(team) {
    const p = this.sim.players.get(this.id);
    if (p) p.team = team;
  }
  chat() { /* no-op offline */ }
  hello() { /* no-op offline */ }
  leave() { this.connected = false; }
  disconnect() { this.connected = false; }
  serverNow() { return Date.now(); }

  update(dt) {
    if (!this.connected) return;
    this.accum += dt;
    let guard = 0;
    let events = [];
    while (this.accum >= TICK_MS / 1000 && guard++ < 5) {
      this.accum -= TICK_MS / 1000;
      const ev = this.sim.tick(TICK_MS / 1000);
      if (ev.length) events = events.concat(ev);
    }
    if (events.length) this.emit('ev', { t: 'ev', v: events });

    this.snapAccum += dt;
    if (this.snapAccum >= SNAPSHOT_MS / 1000) {
      this.snapAccum -= SNAPSHOT_MS / 1000;
      if (this.snapAccum > SNAPSHOT_MS / 1000) this.snapAccum = 0;
      const snap = this.sim.snapshotFor(this.id);
      this.emit('snapshot', {
        tick: this.sim.tickCount,
        ackSeq: snap.ack,
        selfId: this.id,
        self: snap.self,
        players: snap.players
      });
    }

    this.stateAccum += dt;
    if (this.stateAccum >= 0.5) {
      this.stateAccum = 0;
      this.emit('match', { t: 'match', state: this.sim.matchState() });
    }
  }

  stats() {
    return { ping: 0, jitter: 0, loss: 0, inKbps: 0, outKbps: 0, connected: true, offline: true };
  }
}
