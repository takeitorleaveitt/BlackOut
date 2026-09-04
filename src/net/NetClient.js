// WebSocket client.
//
// Input commands go out at 30Hz carrying the last few commands for redundancy
// (so a dropped packet does not stall prediction), snapshots come back as
// binary at the server's tick rate, and everything else is JSON.  Tracks RTT,
// jitter and packet loss for the net graph.

import { bus } from '../core/EventBus.js';
import { writeInput, readSnapshot, MSG } from '../shared/protocol.js';
import { SNAPSHOT_MS } from '../shared/constants.js';

const REDUNDANCY = 3;
const SEND_HZ = 30;

export class NetClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.id = -1;
    this.room = null;
    this.url = '';
    this.outbox = [];
    this.sendAccum = 0;
    this.pingSeq = 1;
    this.pingSentAt = new Map();
    this.rtt = 0;
    this.jitter = 0;
    this.loss = 0;
    this.lastTick = -1;
    this.recvWindow = [];
    this.serverTimeOffset = 0;
    this.lastSnapshotAt = 0;
    this.snapshotGap = SNAPSHOT_MS;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.rateWindow = { t: performance.now(), in: 0, out: 0, kbpsIn: 0, kbpsOut: 0 };
    this.handlers = new Map();
    this.reconnectAttempts = 0;
    this.wantConnected = false;
  }

  static defaultUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In vite dev the client runs on :5173 and the game server on :8787.
    if (location.port === '5173') return `${proto}//${location.hostname}:8787/ws`;
    return `${proto}//${location.host}/ws`;
  }

  connect(url) {
    this.url = url || NetClient.defaultUrl();
    this.wantConnected = true;
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws.binaryType = 'arraybuffer';
      const timeout = setTimeout(() => {
        if (!settled) { settled = true; try { this.ws.close(); } catch (e) { /* ignore */ } reject(new Error('timeout')); }
      }, 8000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.connected = true;
        this.reconnectAttempts = 0;
        this.startPingLoop();
        bus.emit('net:open');
        if (!settled) { settled = true; resolve(this); }
      };
      this.ws.onclose = () => {
        this.connected = false;
        bus.emit('net:close');
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('closed')); }
      };
      this.ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('error')); }
      };
      this.ws.onmessage = (ev) => this.onMessage(ev);
    });
  }

  /** RTT is sampled off a wall-clock timer, not the render loop. */
  startPingLoop() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      if (!this.connected) return;
      const c = this.pingSeq++;
      this.pingSentAt.set(c, performance.now());
      if (this.pingSentAt.size > 8) this.pingSentAt.delete(this.pingSentAt.keys().next().value);
      this.send({ t: 'ping', c });
      this.send({ t: 'rtt', rtt: Math.round(this.rtt) });
    }, 1000);
  }

  disconnect() {
    clearInterval(this._pingTimer);
    this.wantConnected = false;
    if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } }
    this.ws = null;
    this.connected = false;
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

  onMessage(ev) {
    if (ev.data instanceof ArrayBuffer) {
      this.bytesIn += ev.data.byteLength;
      const dv = new DataView(ev.data);
      if (dv.getUint8(0) === MSG.SNAPSHOT) {
        const snap = readSnapshot(ev.data);
        this.trackSnapshot(snap);
        this.emit('snapshot', snap);
      }
      return;
    }
    this.bytesIn += ev.data.length;
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.t === 'pong') {
      const sent = this.pingSentAt.get(msg.c);
      if (sent !== undefined) {
        const rtt = performance.now() - sent;
        this.jitter = this.jitter * 0.8 + Math.abs(rtt - this.rtt) * 0.2;
        this.rtt = this.rtt ? this.rtt * 0.75 + rtt * 0.25 : rtt;
        this.pingSentAt.delete(msg.c);
        this.serverTimeOffset = msg.s + rtt / 2 - Date.now();
      }
      return;
    }
    if (msg.t === 'welcome' || msg.t === 'hello') {
      this.id = msg.id;
      if (msg.snapshotRate) this.snapshotRate = msg.snapshotRate;
    }
    if (msg.t === 'joined') this.room = msg;
    this.emit(msg.t, msg);
  }

  /**
   * Loss is measured as arrival rate against the server's advertised snapshot
   * rate over a two second window — robust to the server ticking unevenly,
   * which a tick-delta estimate is not.
   */
  trackSnapshot(snap) {
    const now = performance.now();
    if (this.lastSnapshotAt) this.snapshotGap = this.snapshotGap * 0.85 + (now - this.lastSnapshotAt) * 0.15;
    this.lastSnapshotAt = now;
    this.recvWindow.push(now);
    const cutoff = now - 2000;
    while (this.recvWindow.length && this.recvWindow[0] < cutoff) this.recvWindow.shift();
    const span = Math.min(2000, now - (this.firstSnapshotAt ||= now));
    if (span > 700) {
      const expected = (span / 1000) * (this.snapshotRate || 20);
      this.loss = Math.max(0, Math.min(1, 1 - this.recvWindow.length / Math.max(1, expected)));
    }
    this.lastTick = snap.tick;
  }

  send(obj) {
    if (!this.connected || !this.ws) return;
    const s = JSON.stringify(obj);
    this.bytesOut += s.length;
    try { this.ws.send(s); } catch (e) { /* dropped */ }
  }

  sendBinary(buf) {
    if (!this.connected || !this.ws) return;
    this.bytesOut += buf.byteLength;
    try { this.ws.send(buf); } catch (e) { /* dropped */ }
  }

  hello(name, loadout) { this.send({ t: 'hello', name, loadout }); }
  quickMatch(mode) { this.send({ t: 'quickMatch', mode }); }
  joinRoom(roomId) { this.send({ t: 'join', roomId }); }
  joinCode(code) { this.send({ t: 'join', code }); }
  createRoom(settings) { this.send({ t: 'roomCreate', settings }); }
  roomSettings(settings) { this.send({ t: 'roomSettings', settings }); }
  startRoom() { this.send({ t: 'roomStart' }); }
  requestRooms() { this.send({ t: 'roomList' }); }
  leave() { this.send({ t: 'leave' }); }
  setLoadout(loadout) { this.send({ t: 'loadout', loadout }); }
  chat(text) { this.send({ t: 'chat', text }); }
  sendShot(shot) { this.send({ t: 'shot', ...shot }); }
  sendEvent(kind, data = {}) { this.send({ t: kind, ...data }); }
  requestRespawn() { this.send({ t: 'respawn' }); }
  setTeam(team) { this.send({ t: 'team', team }); }

  /** Queue an input command; flushed on the next send tick. */
  sendInput(cmd) {
    this.outbox.push(cmd);
    if (this.outbox.length > 40) this.outbox.shift();
  }

  update(dt) {
    if (!this.connected) return;
    this.sendAccum += dt;
    if (this.sendAccum >= 1 / SEND_HZ) {
      this.sendAccum = 0;
      if (this.outbox.length) {
        const batch = this.outbox.slice(-REDUNDANCY);
        this.sendBinary(writeInput(batch));
        this.outbox.length = 0;
      }
    }
    const w = this.rateWindow;
    const now = performance.now();
    if (now - w.t > 1000) {
      const secs = (now - w.t) / 1000;
      w.kbpsIn = ((this.bytesIn - w.in) / 1024 / secs) * 8;
      w.kbpsOut = ((this.bytesOut - w.out) / 1024 / secs) * 8;
      w.in = this.bytesIn; w.out = this.bytesOut; w.t = now;
    }
  }

  /** Server clock estimate in ms, used to time-align interpolation. */
  serverNow() { return Date.now() + this.serverTimeOffset; }

  stats() {
    return {
      ping: Math.round(this.rtt),
      jitter: Math.round(this.jitter),
      loss: Math.round(this.loss * 100),
      inKbps: Math.round(this.rateWindow.kbpsIn),
      outKbps: Math.round(this.rateWindow.kbpsOut),
      connected: this.connected
    };
  }
}
