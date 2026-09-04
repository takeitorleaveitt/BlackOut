// BLACKOUT PROTOCOL — authoritative game server.
//
// Serves the built client over HTTP and runs every match over a WebSocket.
// The server owns movement, hit validation and scoring: clients only send
// input commands and shot requests, and receive snapshots.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, makeRoomCode } from './Room.js';
import { readInput, MSG } from '../src/shared/protocol.js';
import { MODES, REGIONS } from '../src/shared/modes.js';
import { ROTATION, MAP_INFO, mapsForMode } from '../src/shared/maps/index.js';
import { INTERP_DELAY_MS, LAG_COMP_MAX_MS, TICK_RATE, SNAPSHOT_RATE, clamp } from '../src/shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = process.env.PORT ? +process.env.PORT : 8787;
const REGION = process.env.REGION || 'eu-west';

// ---------------------------------------------------------------------------
// static file serving
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json'
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(DIST, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(DIST, 'index.html'), (e2, html) => {
        if (e2) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('Client build not found. Run `npm run build` first.');
        } else {
          res.writeHead(200, { 'content-type': MIME['.html'] });
          res.end(html);
        }
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// room registry
// ---------------------------------------------------------------------------
const rooms = new Map();
const codes = new Map();

function createPublicRoom(mode, map, opts = {}) {
  // Fill to the mode's own capacity by default (Room.topUpBots() clamps to
  // maxPlayers anyway) rather than a flat 6 — Siege/Quickplay cap at 8
  // (4v4) and used to only ever fill to 6 (3v3) here.
  const room = new Room({
    name: `${MODES[mode].short} · ${map.toUpperCase()}`,
    mode, map, region: opts.region || REGION,
    persistent: true,
    fillBots: opts.fillBots ?? MODES[mode].maxPlayers ?? 6,
    botSkill: opts.botSkill || 'normal',
    options: opts.options
  });
  rooms.set(room.id, room);
  return room;
}

/** A handful of always-on public servers so the browser is never empty. */
function seedPublicRooms() {
  const seeds = [
    ['tdm', 'warehouse', 'eu-west', 7],
    ['tdm', 'refinery', 'na-east', 8],
    ['ffa', 'garage', 'eu-north', 6],
    ['elimination', 'suburb', 'eu-west', 5],
    ['snd', 'highrise', 'na-west', 6],
    ['gunfight', 'killhouse', 'eu-west', 3],
    ['tdm', 'blackwood', 'ap-se', 6],
    ['ffa', 'highrise', 'oce', 5],
    ['siege', 'district9', 'eu-west', 8],
    ['quickplay', 'district9', 'na-east', 8]
  ];
  for (const [mode, map, region, bots] of seeds) {
    createPublicRoom(mode, map, { region, fillBots: bots });
  }
}

function listRooms() {
  const out = [];
  for (const r of rooms.values()) {
    if (r.private || r.closed) continue;
    out.push(r.info());
  }
  return out;
}

function findQuickMatch(modeKey) {
  let best = null, bestScore = -1;
  for (const r of rooms.values()) {
    if (r.private || r.closed) continue;
    if (modeKey && r.modeKey !== modeKey) continue;
    if (r.humanCount >= r.maxPlayers) continue;
    // prefer rooms that already have people, but are not full
    const score = r.humanCount * 10 - (r.humanCount >= r.maxPlayers - 1 ? 50 : 0) + Math.random() * 3;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (!best) {
    const mode = modeKey || 'tdm';
    const maps = mapsForMode(mode);
    best = createPublicRoom(mode, maps[(Math.random() * maps.length) | 0]);
  }
  return best;
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/api/servers') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ region: REGION, rooms: listRooms(), regions: REGIONS, maps: MAP_INFO }));
    return;
  }
  if (url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, uptime: process.uptime(), rooms: rooms.size,
      players: [...rooms.values()].reduce((a, r) => a + r.humanCount, 0)
    }));
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });

let clientSeq = 1;
const clients = new Set();

wss.on('connection', (ws, req) => {
  const client = {
    id: clientSeq++,
    ws,
    name: 'OPERATOR',
    room: null,
    entity: null,
    team: null,
    preferredTeam: null,
    loadout: null,
    ping: 60,
    lastPing: Date.now(),
    alive: true,
    ip: req.socket.remoteAddress
  };
  clients.add(client);

  send(client, { t: 'welcome', id: client.id, region: REGION, tickRate: TICK_RATE, snapshotRate: SNAPSHOT_RATE });

  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        const view = new DataView(buf);
        if (view.getUint8(0) === MSG.INPUT && client.room) {
          client.room.sim.queueInput(client.id, readInput(buf));
        }
        return;
      }
      const msg = JSON.parse(data.toString());
      handle(client, msg);
    } catch (e) {
      // a malformed frame must never take the server down
      console.warn('[ws] bad message from', client.id, e.message);
    }
  });

  ws.on('close', () => {
    if (client.room) client.room.removeClient(client);
    clients.delete(client);
  });
  ws.on('error', () => { /* handled by close */ });
});

function send(client, obj) {
  if (client.ws.readyState !== 1) return;
  try { client.ws.send(JSON.stringify(obj)); } catch (e) { /* dropped */ }
}

function handle(client, msg) {
  switch (msg.t) {
    case 'hello': {
      client.name = String(msg.name || 'OPERATOR').slice(0, 18).toUpperCase();
      client.loadout = sanitizeLoadout(msg.loadout);
      send(client, { t: 'hello', id: client.id, region: REGION });
      break;
    }
    case 'ping':
      send(client, { t: 'pong', c: msg.c, s: Date.now() });
      break;
    case 'rtt':
      client.ping = clamp(msg.rtt | 0, 0, 999);
      if (client.entity) client.entity.ping = client.ping;
      break;
    case 'loadout':
      client.loadout = sanitizeLoadout(msg.loadout);
      if (client.room && client.entity) client.room.sim.setLoadout(client.entity, client.loadout);
      break;
    case 'roomList':
      send(client, { t: 'roomList', rooms: listRooms(), region: REGION });
      break;
    case 'quickMatch': {
      const room = findQuickMatch(msg.mode);
      joinRoom(client, room);
      break;
    }
    case 'join': {
      let room = null;
      if (msg.code) room = codes.get(String(msg.code).toUpperCase());
      else if (msg.roomId) room = rooms.get(msg.roomId);
      if (!room || room.closed) { send(client, { t: 'error', code: 'no_room', message: 'That match no longer exists.' }); break; }
      if (room.humanCount >= room.maxPlayers) { send(client, { t: 'error', code: 'full', message: 'That match is full.' }); break; }
      joinRoom(client, room);
      break;
    }
    case 'roomCreate': {
      const s = msg.settings || {};
      const mode = MODES[s.mode] ? s.mode : 'tdm';
      const maps = mapsForMode(mode);
      const map = maps.includes(s.map) ? s.map : maps[0];
      const code = makeRoomCode();
      const room = new Room({
        name: s.name || `${client.name}'S MATCH`,
        private: true, code, hostId: client.id, region: REGION,
        mode, map, fillBots: clamp(s.bots | 0, 0, 15),
        botSkill: s.botSkill || 'normal',
        options: {
          maxPlayers: clamp(s.maxPlayers | 0 || MODES[mode].maxPlayers, 2, 16),
          scoreLimit: clamp(s.scoreLimit | 0 || MODES[mode].scoreLimit || 75, 5, 250),
          roundTimeSec: clamp(s.roundTimeSec | 0 || MODES[mode].roundTimeSec || 150, 30, 600),
          timeLimitSec: clamp(s.timeLimitSec | 0 || MODES[mode].timeLimitSec || 600, 60, 1800),
          friendlyFire: !!s.friendlyFire
        }
      });
      rooms.set(room.id, room);
      codes.set(code, room);
      joinRoom(client, room);
      break;
    }
    case 'roomSettings':
      if (client.room && client.room.hostId === client.id) client.room.setSettings(msg.settings || {});
      break;
    case 'roomStart':
      if (client.room && client.room.hostId === client.id) client.room.start();
      break;
    case 'leave':
      if (client.room) client.room.removeClient(client);
      send(client, { t: 'left' });
      break;
    case 'shot': {
      if (!client.room) break;
      const rewind = clamp(client.ping / 2 + INTERP_DELAY_MS, 0, LAG_COMP_MAX_MS);
      client.room.sim.handleShot(client.id, {
        seed: msg.seed >>> 0,
        spread: +msg.spread || 0,
        origin: sanitizeVec(msg.origin),
        dir: normalizeVec(sanitizeVec(msg.dir)),
        slot: msg.slot | 0
      }, rewind);
      break;
    }
    case 'reload':
      client.room?.sim.handleReload(client.id);
      break;
    case 'switch':
      client.room?.sim.handleSwitch(client.id, msg.slot | 0);
      break;
    case 'plant':
      client.room?.sim.handlePlant(client.id, !!msg.down);
      break;
    case 'defuse':
      client.room?.sim.handleDefuse(client.id, !!msg.down);
      break;
    case 'operator':
      client.room?.sim.handleOperatorPick(client.id, msg.key || null, {
        floor: msg.floor | 0 || undefined, side: msg.side || undefined
      });
      break;
    case 'respawn': {
      const p = client.room?.sim.players.get(client.id);
      if (p && !p.alive && client.room.sim.mode.respawn) {
        p.respawnAt = Math.min(p.respawnAt, client.room.sim.time);
      }
      break;
    }
    case 'chat': {
      if (!client.room) break;
      const text = String(msg.text || '').slice(0, 140);
      if (!text.trim()) break;
      client.room.broadcastJson({ t: 'chat', from: client.name, team: client.team, text });
      break;
    }
    case 'team': {
      if (!client.room || !client.entity) break;
      const t = msg.team | 0;
      if (t === 1 || t === 2) {
        client.entity.team = t;
        client.team = t;
        client.preferredTeam = t;
        client.room.broadcastJson({ t: 'roomInfo', ...client.room.info() });
      }
      break;
    }
    default:
      break;
  }
}

function joinRoom(client, room) {
  if (client.room) client.room.removeClient(client);
  if (!room.addClient(client)) {
    send(client, { t: 'error', code: 'full', message: 'That match is full.' });
    return;
  }
  send(client, {
    t: 'joined',
    ...room.info(),
    you: client.id,
    team: client.team,
    state: room.sim.matchState()
  });
}

function sanitizeLoadout(l) {
  if (!l || typeof l !== 'object') return null;
  const arr = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 4) : []);
  return {
    primary: typeof l.primary === 'string' ? l.primary : 'm4a1',
    secondary: typeof l.secondary === 'string' ? l.secondary : 'glock17',
    primaryAttachments: arr(l.primaryAttachments),
    secondaryAttachments: arr(l.secondaryAttachments)
  };
}

function sanitizeVec(v) {
  if (!Array.isArray(v) || v.length < 3) return [0, 0, 0];
  return [safe(v[0]), safe(v[1]), safe(v[2])];
}
const safe = (n) => (Number.isFinite(n) ? clamp(n, -10000, 10000) : 0);

function normalizeVec(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, -1];
}

// ---------------------------------------------------------------------------
// main loop
// ---------------------------------------------------------------------------
seedPublicRooms();

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  last = now;
  for (const [id, room] of rooms) {
    if (room.closed) {
      if (room.code) codes.delete(room.code);
      rooms.delete(id);
      continue;
    }
    try { room.update(now); } catch (e) {
      console.error('[room]', room.id, e);
    }
  }
}, 1000 / 60);

// prune idle private rooms
setInterval(() => {
  for (const [id, room] of rooms) {
    if (room.private && room.clients.size === 0 && Date.now() - room.createdAt > 60_000) {
      room.closed = true;
    }
  }
}, 30_000);

server.listen(PORT, () => {
  const dist = fs.existsSync(DIST);
  console.log(`\n  BLACKOUT PROTOCOL server`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  http://localhost:${PORT}${dist ? '' : '   (no dist/ — run `npm run build`)'}`);
  console.log(`  ws://localhost:${PORT}/ws`);
  console.log(`  region: ${REGION}   public rooms: ${rooms.size}\n`);
});

process.on('SIGINT', () => { console.log('\nshutting down'); process.exit(0); });
process.on('uncaughtException', (e) => { console.error('[fatal]', e); });
