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
    minPlayers: opts.minPlayers,
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
    ['ffa', 'killhouse', 'eu-north', 6],
    ['elimination', 'suburb', 'eu-west', 5],
    ['snd', 'refinery', 'na-west', 6],
    ['tdm', 'suburb', 'ap-se', 6],
    ['ffa', 'warehouse', 'oce', 5]
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

function findQuickMatch(modeKey, opts = {}) {
  // `opts.bots === false` marks a player-only playlist (Quick Match and
  // Standard). Those must not be matched into a room that is padded with
  // bots, and any room opened for them starts empty so it fills with humans.
  const wantBots = opts.bots !== false;
  // A squad needs one seat per member, not just one for the leader.
  const seats = Math.max(1, opts.seats | 0 || 1);
  let best = null, bestScore = -1;
  for (const r of rooms.values()) {
    if (r.private || r.closed) continue;
    if (modeKey && r.modeKey !== modeKey) continue;
    if (r.humanCount + seats > r.maxPlayers) continue;
    if (!wantBots && r.botCount > 0) continue;
    // prefer rooms that already have people, but are not full
    const score = r.humanCount * 10 - (r.humanCount >= r.maxPlayers - 1 ? 50 : 0) + Math.random() * 3;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (!best) {
    const mode = modeKey || 'tdm';
    const maps = mapsForMode(mode);
    best = createPublicRoom(mode, maps[(Math.random() * maps.length) | 0], {
      fillBots: wantBots ? undefined : 0,
      // A player-only playlist holds in warmup until this many humans have
      // arrived, rather than starting a lopsided match.
      minPlayers: opts.minPlayers
    });
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
    squad: null,
    ip: req.socket.remoteAddress
  };
  clients.add(client);
  createSquad(client);

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
    leaveSquad(client);
    clients.delete(client);
  });
  ws.on('error', () => { /* handled by close */ });
});

function send(client, obj) {
  if (client.ws.readyState !== 1) return;
  try { client.ws.send(JSON.stringify(obj)); } catch (e) { /* dropped */ }
}

/**
 * Callsigns must be unique across everyone currently connected, and 3-17
 * characters. The server is the only place that can enforce uniqueness, since
 * it is the only party that can see the other players. A name already in use
 * gets a numeric suffix rather than being rejected outright, so a duplicate
 * never blocks someone from playing.
 */
function uniqueName(raw, self) {
  let base = raw.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').trim().slice(0, 17);
  if (base.length < 3) base = 'OPERATOR';
  const taken = new Set();
  for (const c of clients) if (c !== self && c.name) taken.add(c.name);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const candidate = base.slice(0, 17 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

function handle(client, msg) {
  switch (msg.t) {
    case 'hello': {
      client.name = uniqueName(String(msg.name || 'OPERATOR'), client);
      client.loadout = sanitizeLoadout(msg.loadout);
      // Echo the name back: it may have been altered to keep it unique, and
      // the client needs to know what it is actually called.
      send(client, { t: 'hello', id: client.id, region: REGION, name: client.name });
      if (!client.squad) createSquad(client);
      broadcastSquad(client.squad);
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
      if (!requireLeader(client)) break;
      const room = findQuickMatch(msg.mode, {
        bots: msg.bots, roundsToWin: msg.roundsToWin, playlist: msg.playlist,
        minPlayers: msg.minPlayers,
        // Leave room for the rest of the squad rather than dropping the
        // leader into a lobby that only has one seat left.
        seats: 1 + squadFollowers(client).length
      });
      joinRoomWithSquad(client, room);
      break;
    }
    case 'join': {
      let room = null;
      if (msg.code) room = codes.get(String(msg.code).toUpperCase());
      else if (msg.roomId) room = rooms.get(msg.roomId);
      if (!room || room.closed) { send(client, { t: 'error', code: 'no_room', message: 'That match no longer exists.' }); break; }
      if (room.humanCount >= room.maxPlayers) { send(client, { t: 'error', code: 'full', message: 'That match is full.' }); break; }
      if (!requireLeader(client)) break;
      joinRoomWithSquad(client, room);
      break;
    }
    case 'roomCreate': {
      if (!requireLeader(client)) break;
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
      // A private match automatically pulls your squad in with you.
      joinRoomWithSquad(client, room);
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
    // --- squads -----------------------------------------------------------
    case 'squadInfo':
      if (!client.squad) createSquad(client);
      send(client, squadState(client.squad));
      break;
    case 'squadInvite': {
      const want = String(msg.name || '').toUpperCase().trim();
      const target = [...clients].find((c) => c !== client && c.name === want);
      if (!target) {
        send(client, { t: 'error', code: 'no_player', message: `${want || 'That operator'} is not online.` });
        break;
      }
      if (!client.squad) createSquad(client);
      if (client.squad.members.length >= SQUAD_MAX) {
        send(client, { t: 'error', code: 'squad_full', message: 'Your squad is already full.' });
        break;
      }
      send(target, {
        t: 'squadInvite', from: client.name, fromId: client.id, code: client.squad.code
      });
      send(client, { t: 'squadInviteSent', name: target.name });
      break;
    }
    case 'squadJoin': {
      const squad = squadCodes.get(String(msg.code || '').toUpperCase());
      if (!squad) {
        send(client, { t: 'error', code: 'no_squad', message: 'That squad no longer exists.' });
        break;
      }
      if (squad === client.squad) break;
      if (squad.members.length >= SQUAD_MAX) {
        send(client, { t: 'error', code: 'squad_full', message: 'That squad is full.' });
        break;
      }
      const old = client.squad;
      leaveSquad(client);
      squad.members.push(client);
      client.squad = squad;
      broadcastSquad(squad);
      if (old && old !== squad) broadcastSquad(old);
      break;
    }
    case 'squadLeave': {
      const old = client.squad;
      leaveSquad(client);
      const fresh = createSquad(client);
      broadcastSquad(fresh);
      if (old) broadcastSquad(old);
      break;
    }
    case 'squadKick': {
      const squad = client.squad;
      if (!squad || squad.leaderId !== client.id) break;
      const target = squad.members.find((c) => c.id === (msg.id | 0));
      if (!target || target === client) break;
      leaveSquad(target);
      const fresh = createSquad(target);
      broadcastSquad(fresh);
      broadcastSquad(squad);
      break;
    }
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

// ---------------------------------------------------------------------------
// SQUADS
//
// Every connected client belongs to a squad. On connect that squad is just
// them, and they are its leader. Invites bring other people in up to a cap of
// four, and from then on the leader is the only one who can put the squad
// into a match: matchmaking, private rooms and the server browser all pull
// the whole squad into the same room together.
// ---------------------------------------------------------------------------
const SQUAD_MAX = 4;
const squads = new Map();          // squadId -> squad
let squadSeq = 1;

function makeSquadCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += A[(Math.random() * A.length) | 0];
  return squadCodes.has(out) ? makeSquadCode() : out;
}
const squadCodes = new Map();      // code -> squad

function createSquad(client) {
  const code = makeSquadCode();
  const squad = { id: squadSeq++, code, leaderId: client.id, members: [client] };
  squads.set(squad.id, squad);
  squadCodes.set(code, squad);
  client.squad = squad;
  return squad;
}

function squadState(squad) {
  return {
    t: 'squad',
    id: squad.id,
    code: squad.code,
    leaderId: squad.leaderId,
    max: SQUAD_MAX,
    members: squad.members.map((c) => ({ id: c.id, name: c.name, leader: c.id === squad.leaderId }))
  };
}

function broadcastSquad(squad) {
  if (!squad) return;
  const msg = squadState(squad);
  for (const c of squad.members) send(c, msg);
}

function destroySquadIfEmpty(squad) {
  if (squad.members.length) return;
  squads.delete(squad.id);
  squadCodes.delete(squad.code);
}

/** Pull a client out of their squad, promoting a new leader if needed. */
function leaveSquad(client, { silent = false } = {}) {
  const squad = client.squad;
  if (!squad) return;
  squad.members = squad.members.filter((c) => c !== client);
  client.squad = null;
  if (squad.leaderId === client.id && squad.members.length) {
    squad.leaderId = squad.members[0].id;
  }
  destroySquadIfEmpty(squad);
  if (!silent) broadcastSquad(squad);
}

/** Everyone in the squad except the leader — the people who get dragged along. */
function squadFollowers(client) {
  const squad = client.squad;
  if (!squad || squad.members.length < 2) return [];
  return squad.members.filter((c) => c !== client);
}

/**
 * Only the leader starts matches. Returns true when the caller may proceed;
 * otherwise it has already told them why not.
 */
function requireLeader(client) {
  const squad = client.squad;
  if (!squad || squad.members.length < 2) return true;   // solo: you are the leader
  if (squad.leaderId === client.id) return true;
  send(client, {
    t: 'error', code: 'not_leader',
    message: 'Only the squad leader can start a match.'
  });
  return false;
}

/** Put the leader in a room, then follow the rest of the squad in after them. */
function joinRoomWithSquad(client, room) {
  joinRoom(client, room);
  if (client.room !== room) return;    // the join failed; do not drag anyone in
  for (const mate of squadFollowers(client)) {
    if (room.humanCount >= room.maxPlayers) {
      send(mate, { t: 'error', code: 'full', message: 'The squad did not fit in that match.' });
      continue;
    }
    joinRoom(mate, room);
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
