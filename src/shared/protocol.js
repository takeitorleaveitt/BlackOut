// Wire protocol shared by client and server.
//
// Hot paths (input commands @ client tick rate, state snapshots @ 20Hz) are
// packed into binary ArrayBuffers.  Low frequency lobby traffic and batched
// per-tick events travel as JSON, which keeps the interesting parts compact
// without hand-rolling a codec for every lobby field.

export const MSG = {
  // binary
  INPUT: 1,
  SNAPSHOT: 2,
  // JSON (string frames) use a `t` field instead:
  HELLO: 'hello',
  WELCOME: 'welcome',
  JOIN: 'join',
  JOINED: 'joined',
  LEAVE: 'leave',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
  EVENTS: 'ev',
  MATCH: 'match',            // match state / scoreboard / round info
  SPAWN: 'spawn',
  CHAT: 'chat',
  LOADOUT: 'loadout',
  ROOM_CREATE: 'roomCreate',
  ROOM_LIST: 'roomList',
  ROOM_INFO: 'roomInfo',
  ROOM_SETTINGS: 'roomSettings',
  ROOM_START: 'roomStart',
  QUICK_MATCH: 'quickMatch',
  READY: 'ready',
  SHOT: 'shot',              // client -> server: a round left the muzzle
  RELOAD: 'reload',
  SWITCH: 'switch',
  PLANT: 'plant',
  DEFUSE: 'defuse',
  RESPAWN: 'respawn'
};

// Event ids inside the batched EVENTS message.
export const EV = {
  SHOT: 1,       // {p:playerId, w:weaponId, o:[x,y,z], d:[x,y,z], s:seed}
  IMPACT: 2,     // {p:[x,y,z], n:[x,y,z], m:surface, w:weaponId}
  HIT: 3,        // {a:attacker, v:victim, z:zone, d:damage, k:killed, p:point, dir} — p/dir drive blood
  DAMAGE: 4,     // to the victim only: {a, d, dir:[x,y,z], z}
  KILL: 5,       // {a, v, w:weaponId, z:zone, hs:bool}
  DEATH: 6,
  RELOAD: 7,     // {p, w, empty:bool}
  SWITCH: 8,     // {p, w}
  JUMP: 9,
  LAND: 10,
  FOOTSTEP: 11,
  SPAWN: 12,
  PLANT_START: 13,
  PLANTED: 14,
  DEFUSE_START: 15,
  DEFUSED: 16,
  ROUND_START: 17,
  ECONOMY: 30,
  ROUND_END: 18,
  MATCH_END: 19,
  BOMB_TICK: 20,
  MELEE: 21,
  // A map ping. `t` is the pinging player's team, and the client only draws
  // pings from its own side — the whole point is that it is squad comms.
  PING: 22       // {p:playerId, t:team, x, y, z}
};

// --- state flag bits -------------------------------------------------------
export const SF = {
  CROUCH: 1 << 0,
  SPRINT: 1 << 1,
  ADS: 1 << 2,
  FIRING: 1 << 3,
  RELOADING: 1 << 4,
  DEAD: 1 << 5,
  GROUNDED: 1 << 6,
  LEAN_L: 1 << 7,
  LEAN_R: 1 << 8,
  WALK: 1 << 9,
  MOVING: 1 << 10,
  BOT: 1 << 11,
  PLANTING: 1 << 12
};

const PI = Math.PI;
const q16 = (v, range) => Math.max(-32767, Math.min(32767, Math.round((v / range) * 32767)));
const dq16 = (v, range) => (v / 32767) * range;

// ---------------------------------------------------------------------------
// Input commands: client -> server
// layout: [u8 type][u8 count][ per cmd: u32 seq, u16 buttons, i16 yaw, i16 pitch, u8 dtMs ]
// ---------------------------------------------------------------------------
export const INPUT_CMD_BYTES = 11;

export function writeInput(cmds) {
  const n = Math.min(cmds.length, 255);
  const buf = new ArrayBuffer(2 + n * INPUT_CMD_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, MSG.INPUT);
  dv.setUint8(1, n);
  let o = 2;
  for (let i = cmds.length - n; i < cmds.length; i++) {
    const c = cmds[i];
    dv.setUint32(o, c.seq >>> 0); o += 4;
    dv.setUint16(o, c.buttons & 0xffff); o += 2;
    dv.setInt16(o, q16(c.yaw, PI)); o += 2;
    dv.setInt16(o, q16(c.pitch, PI / 2)); o += 2;
    dv.setUint8(o, Math.max(1, Math.min(60, Math.round(c.dt * 1000)))); o += 1;
  }
  return buf;
}

export function readInput(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint8(1);
  const out = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    out.push({
      seq: dv.getUint32(o),
      buttons: dv.getUint16(o + 4),
      yaw: dq16(dv.getInt16(o + 6), PI),
      pitch: dq16(dv.getInt16(o + 8), PI / 2),
      dt: dv.getUint8(o + 10) / 1000
    });
    o += INPUT_CMD_BYTES;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snapshot: server -> client
// header: [u8 type][u32 tick][u32 ackSeq][u16 selfId]
// self  : [f32 x,y,z][f32 vx,vy,vz][u16 flags][u8 health][u8 armour][f32 lean][f32 crouchT]
// others: [u8 count][ per: u16 id, f32 x,y,z, i16 yaw, i16 pitch, u16 flags,
//                     u8 health, u8 team, u8 weapon, i16 lean, u8 speed ]
// ---------------------------------------------------------------------------
export function writeSnapshot(tick, ackSeq, selfId, self, others) {
  const n = Math.min(others.length, 255);
  const size = 1 + 4 + 4 + 2 + (12 + 12 + 2 + 1 + 1 + 4 + 4) + 1 + n * 25;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint8(o, MSG.SNAPSHOT); o += 1;
  dv.setUint32(o, tick >>> 0); o += 4;
  dv.setUint32(o, ackSeq >>> 0); o += 4;
  dv.setUint16(o, selfId); o += 2;
  dv.setFloat32(o, self.x); o += 4;
  dv.setFloat32(o, self.y); o += 4;
  dv.setFloat32(o, self.z); o += 4;
  dv.setFloat32(o, self.vx); o += 4;
  dv.setFloat32(o, self.vy); o += 4;
  dv.setFloat32(o, self.vz); o += 4;
  dv.setUint16(o, self.flags); o += 2;
  dv.setUint8(o, Math.max(0, Math.round(self.health))); o += 1;
  dv.setUint8(o, Math.max(0, Math.round(self.armour || 0))); o += 1;
  dv.setFloat32(o, self.lean || 0); o += 4;
  dv.setFloat32(o, self.crouchT || 0); o += 4;
  dv.setUint8(o, n); o += 1;
  for (let i = 0; i < n; i++) {
    const p = others[i];
    dv.setUint16(o, p.id); o += 2;
    dv.setFloat32(o, p.x); o += 4;
    dv.setFloat32(o, p.y); o += 4;
    dv.setFloat32(o, p.z); o += 4;
    dv.setInt16(o, q16(p.yaw, PI)); o += 2;
    dv.setInt16(o, q16(p.pitch, PI / 2)); o += 2;
    dv.setUint16(o, p.flags); o += 2;
    dv.setUint8(o, Math.max(0, Math.round(p.health))); o += 1;
    dv.setUint8(o, p.team); o += 1;
    dv.setUint8(o, p.weapon); o += 1;
    dv.setInt16(o, q16(p.lean || 0, 1)); o += 2;
  }
  return buf;
}

export function readSnapshot(buf) {
  const dv = new DataView(buf);
  let o = 1;
  const tick = dv.getUint32(o); o += 4;
  const ackSeq = dv.getUint32(o); o += 4;
  const selfId = dv.getUint16(o); o += 2;
  const self = {
    x: dv.getFloat32(o), y: dv.getFloat32(o + 4), z: dv.getFloat32(o + 8),
    vx: dv.getFloat32(o + 12), vy: dv.getFloat32(o + 16), vz: dv.getFloat32(o + 20),
    flags: dv.getUint16(o + 24), health: dv.getUint8(o + 26), armour: dv.getUint8(o + 27),
    lean: dv.getFloat32(o + 28), crouchT: dv.getFloat32(o + 32)
  };
  o += 36;
  const count = dv.getUint8(o); o += 1;
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push({
      id: dv.getUint16(o),
      x: dv.getFloat32(o + 2), y: dv.getFloat32(o + 6), z: dv.getFloat32(o + 10),
      yaw: dq16(dv.getInt16(o + 14), PI),
      pitch: dq16(dv.getInt16(o + 16), PI / 2),
      flags: dv.getUint16(o + 18),
      health: dv.getUint8(o + 20),
      team: dv.getUint8(o + 21),
      weapon: dv.getUint8(o + 22),
      lean: dq16(dv.getInt16(o + 23), 1)
    });
    o += 25;
  }
  return { tick, ackSeq, selfId, self, players };
}
