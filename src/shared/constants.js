// Shared tuning constants. Imported by both the browser client and the Node
// authoritative server, so nothing in here may touch DOM or three.js.

export const TICK_RATE = 30;                  // authoritative server ticks / second
export const TICK_MS = 1000 / TICK_RATE;
// Snapshots used to broadcast at 20Hz against a 30Hz sim, so remote players
// (teammates, enemies, bots) only got fresh authoritative state every 1.5
// ticks — every other tick just replayed stale data through interpolation,
// which read as extra input lag on anything you didn't control yourself.
// Matching it to the tick rate means every simulated tick actually reaches
// the network.
export const SNAPSHOT_RATE = 30;              // state broadcasts / second
export const SNAPSHOT_MS = 1000 / SNAPSHOT_RATE;
export const MAX_INPUTS_PER_PACKET = 12;
// Remote entities are rendered this far in the past so there are always two
// real snapshots to interpolate between. At 20Hz, 100ms was exactly two
// snapshot intervals — the minimum safe buffer, but with nothing to spare.
// Now that snapshots arrive every ~33ms, 70ms is still a comfortable margin
// (~2 intervals) while shaving 30ms of pure added latency off every remote
// player's visible position.
export const INTERP_DELAY_MS = 70;            // remote entity render delay
export const LAG_COMP_MAX_MS = 260;           // how far back the server will rewind hitboxes
export const HISTORY_SECONDS = 1.0;

// --- player dimensions (metres) ---
export const PLAYER_RADIUS = 0.34;
export const PLAYER_HEIGHT_STAND = 1.80;
export const PLAYER_HEIGHT_CROUCH = 1.16;
export const EYE_OFFSET = 0.14;               // eye height below the top of the capsule
export const STEP_HEIGHT = 0.42;

// --- movement ---
// Tuned for a Call-of-Duty pace and feel rather than a slow milsim one:
// faster base speeds, near-instant acceleration and a hard stop, so the
// player arrives at full speed on the first frame of input and stops on the
// frame they release it. ACCEL_GROUND is multiplied by the target speed in
// accelerate(), so this value is "reach target speed within one tick".
// Lower gravity + a stronger push gives a jump you can actually see and
// use: ~1.2m of clearance over ~0.73s of air, instead of a 0.73m twitch
// that was over in half a second.
export const GRAVITY = 18.0;
export const SPEED_WALK = 4.05;
export const SPEED_SPRINT = 6.60;
export const SPEED_CROUCH = 2.00;
export const SPEED_TACTICAL = 2.20;           // slow "tactical" walk
export const SPEED_ADS_MULT = 0.52;
export const ACCEL_GROUND = 95.0;
export const ACCEL_AIR = 14.0;
export const FRICTION_GROUND = 16.0;
export const FRICTION_AIR = 0.15;
export const JUMP_VELOCITY = 6.60;

// --- slide (sprint + hold crouch) ---
export const SLIDE_SPEED = 9.20;              // launch speed out of the sprint
export const SLIDE_MIN_SPEED = 3.60;          // must already be moving this fast
export const SLIDE_TIME = 1.00;               // longest a slide can last
export const SLIDE_END_SPEED = 2.60;          // slide ends once it decays to this
// Glide drag, far below ground friction. Sized so the slide decays from
// SLIDE_SPEED down to SLIDE_END_SPEED just as SLIDE_TIME runs out, which
// makes the slide end because it naturally ran out of momentum rather than
// being cut short by the timer — about four metres of ground covered.
export const SLIDE_FRICTION = 1.28;
export const SLIDE_COOLDOWN = 0.60;           // gap before another slide can start
export const SLIDE_STEER = 0.30;              // how much you can still steer mid-slide
export const MAX_LEAN = 0.62;                 // radians of body roll when leaning
export const LEAN_OFFSET = 0.46;              // lateral metres the head shifts when leaning
export const LEAN_SPEED = 10.5;
export const CROUCH_SPEED = 9.0;
export const SPRINT_MIN_FORWARD = 0.55;       // stick must be pushed this far forward to sprint

// --- jump ---
// A hard one-second gate between jumps. Deliberately long: it removes bunny
// hopping as a movement option entirely rather than merely making it awkward,
// so ground speed is the only way to cross open space.
export const JUMP_COOLDOWN = 1.0;

// --- combat ---
export const MAX_HEALTH = 100;
export const RESPAWN_DELAY_MS = 4200;
export const HEAL_DELAY_MS = 6500;            // out-of-combat before regen starts
export const HEAL_RATE = 11;                  // hp / second, only up to segment cap
export const HEAL_CAP = 100;

// Hitboxes are sized to the *visible* blocky player model rather than to an
// idealised human, because a round that visually connects with the model and
// deals no damage is what reads as "broken hit detection". The rendered torso
// is 0.42 wide and, once the chest plate and backpack are counted, ~0.43 deep;
// the helmet is 0.23 x 0.25. The depths in particular used to be well under
// the geometry a player can actually see and shoot at.
/**
 * Hit zones, as fractions of the player's current height (yMin/yMax) plus the
 * half-width and half-depth of each box in metres.
 *
 * hx/hz used to be hardcoded in hitZones() while this table carried an unused
 * `radius`, so editing the table changed nothing about where bullets actually
 * landed. They live here now, and hitZones() reads them, so this is the one
 * place hit volumes are defined.
 *
 * Widened about 10% over the previous values: enough that a shot which looked
 * like it connected usually does, without turning anyone into a barn door.
 * The multipliers are untouched, so what a hit is worth has not changed.
 */
export const HITBOX = {
  head:  { yMin: 0.840, yMax: 1.010, hx: 0.138, hz: 0.148, mult: 3.35 },
  torso: { yMin: 0.530, yMax: 0.870, hx: 0.248, hz: 0.226, mult: 1.00 },
  arms:  { yMin: 0.530, yMax: 0.870, hx: 0.440, hz: 0.220, mult: 0.78 },
  legs:  { yMin: 0.000, yMax: 0.530, hx: 0.248, hz: 0.204, mult: 0.72 }
};

// button bitmask packed into the input command
export const BTN = {
  FORWARD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  CROUCH: 1 << 5,
  SPRINT: 1 << 6,
  ADS: 1 << 7,
  FIRE: 1 << 8,
  LEAN_L: 1 << 9,
  LEAN_R: 1 << 10,
  WALK: 1 << 11
};

export const TEAM = { NONE: 0, ALPHA: 1, BRAVO: 2 };

export const SURFACE = {
  CONCRETE: 'concrete',
  METAL: 'metal',
  WOOD: 'wood',
  GLASS: 'glass',
  DIRT: 'dirt',
  GRASS: 'grass',
  GRAVEL: 'gravel',
  CARPET: 'carpet',
  TILE: 'tile',
  WATER: 'water',
  PLASTER: 'plaster',
  FABRIC: 'fabric',
  FLESH: 'flesh'
};

// Per-surface ballistic behaviour. `density` scales penetration cost,
// `maxPen` is the thickest slab (metres) a full-power round can defeat.
export const SURFACE_PROPS = {
  concrete: { density: 2.30, maxPen: 0.10, spark: 0.0, dust: 1.0, footVol: 1.00, hard: 1.0 },
  metal:    { density: 3.10, maxPen: 0.06, spark: 1.0, dust: 0.2, footVol: 1.15, hard: 1.0 },
  wood:     { density: 0.72, maxPen: 0.26, spark: 0.0, dust: 0.6, footVol: 0.90, hard: 0.7 },
  glass:    { density: 0.28, maxPen: 0.40, spark: 0.0, dust: 0.3, footVol: 0.95, hard: 0.5 },
  dirt:     { density: 1.55, maxPen: 0.16, spark: 0.0, dust: 1.0, footVol: 0.62, hard: 0.3 },
  grass:    { density: 1.30, maxPen: 0.18, spark: 0.0, dust: 0.5, footVol: 0.50, hard: 0.2 },
  gravel:   { density: 1.85, maxPen: 0.12, spark: 0.1, dust: 1.0, footVol: 0.88, hard: 0.5 },
  carpet:   { density: 0.90, maxPen: 0.22, spark: 0.0, dust: 0.4, footVol: 0.40, hard: 0.2 },
  tile:     { density: 2.05, maxPen: 0.11, spark: 0.0, dust: 0.9, footVol: 1.05, hard: 0.9 },
  water:    { density: 1.00, maxPen: 0.50, spark: 0.0, dust: 0.0, footVol: 0.70, hard: 0.1 },
  plaster:  { density: 0.55, maxPen: 0.34, spark: 0.0, dust: 1.0, footVol: 0.85, hard: 0.5 },
  fabric:   { density: 0.40, maxPen: 0.30, spark: 0.0, dust: 0.3, footVol: 0.45, hard: 0.1 },
  flesh:    { density: 1.05, maxPen: 0.30, spark: 0.0, dust: 0.0, footVol: 0.50, hard: 0.1 }
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothDamp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

// Deterministic 32-bit PRNG so client and server can agree on spread patterns.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
