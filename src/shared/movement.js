// Deterministic player movement, run identically by client prediction and the
// authoritative server.  Acceleration-based with ground friction, air control,
// crouch/stand interpolation with headroom checks, leaning, step-up and a
// weight feel that differs by stance.

import {
  BTN, GRAVITY, SPEED_WALK, SPEED_SPRINT, SPEED_CROUCH, SPEED_TACTICAL, SPEED_ADS_MULT,
  ACCEL_GROUND, ACCEL_AIR, FRICTION_GROUND, JUMP_VELOCITY, PLAYER_RADIUS,
  PLAYER_HEIGHT_STAND, PLAYER_HEIGHT_CROUCH, STEP_HEIGHT, MAX_LEAN, LEAN_SPEED,
  CROUCH_SPEED, SPRINT_MIN_FORWARD,
  SLIDE_SPEED, SLIDE_MIN_SPEED, SLIDE_TIME, SLIDE_END_SPEED, SLIDE_FRICTION,
  SLIDE_COOLDOWN, SLIDE_STEER, JUMP_COOLDOWN,
  clamp, lerp
} from './constants.js';
import { depenetrate } from './physics.js';

export function createMoveState(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    crouchT: 0,          // 0 stand .. 1 crouched
    leanT: 0,            // -1 left .. +1 right
    grounded: true,
    groundSurface: 'concrete',
    sprinting: false,
    walking: false,
    ads: false,
    wasGrounded: true,
    landImpact: 0,
    stepDistance: 0,     // accumulated ground distance, drives footsteps
    airTime: 0,
    lastJump: 0,
    // --- slide ---
    sliding: false,
    slideT: 0,           // seconds into the current slide
    slideReadyAt: 0,     // absolute time the next slide is allowed
    slideStarted: false, // true for the single tick a slide begins (drives fx)
    prevCrouchHeld: false,
    // --- jump ---
    clock: 0,            // fallback clock for callers that don't stamp cmd.t
    jumpReadyAt: 0,      // absolute time the next jump is allowed
    jumpSeq: -1          // command seq that produced the current jump
  };
}

export function playerHeight(s) {
  return lerp(PLAYER_HEIGHT_STAND, PLAYER_HEIGHT_CROUCH, s.crouchT);
}

export function eyeHeight(s) {
  return playerHeight(s) - 0.14;
}

const scratch = { groundY: 0, hitGround: false, hitCeiling: false, hitWall: false, groundSurface: 'concrete', wallNormal: null };

/**
 * Advance one movement command.  Mutates `s`.
 * `mobility` is the current weapon's speed multiplier (1 = unencumbered).
 */
export function stepMovement(s, cmd, world, mobility = 1, canAct = true) {
  const dt = clamp(cmd.dt, 0.001, 0.05);
  // Monotonic clock carried BY the command. Falls back to advancing the
  // state's own clock for callers that don't stamp one (bots), which is fine
  // because those are never replayed.
  const now = cmd.t !== undefined ? cmd.t : (s.clock = (s.clock || 0) + dt);
  const b = cmd.buttons;
  s.yaw = cmd.yaw;
  s.pitch = cmd.pitch;

  let fwd = 0, side = 0;
  if (b & BTN.FORWARD) fwd += 1;
  if (b & BTN.BACK) fwd -= 1;
  if (b & BTN.RIGHT) side += 1;
  if (b & BTN.LEFT) side -= 1;
  const len = Math.hypot(fwd, side);
  if (len > 1) { fwd /= len; side /= len; }
  if (!canAct) { fwd = 0; side = 0; }

  // --- slide --------------------------------------------------------------
  // Hold crouch while sprinting to slide, Call-of-Duty style: a one-off speed
  // launch that glides on low friction, forces the crouched stance, decays,
  // and then drops you into a normal crouch. `s.sprinting` here is last tick's
  // value, which is exactly the question being asked — "were you sprinting at
  // the moment you pressed crouch?". Runs in shared code so client prediction
  // and the authoritative sim slide identically.
  const crouchHeld = canAct && !!(b & BTN.CROUCH);
  const crouchPressed = crouchHeld && !s.prevCrouchHeld;
  s.prevCrouchHeld = crouchHeld;
  s.slideStarted = false;

  const hSpeed = Math.hypot(s.vx, s.vz);
  if (!s.sliding && crouchPressed && s.grounded && s.sprinting &&
      hSpeed > SLIDE_MIN_SPEED && now >= s.slideReadyAt) {
    s.sliding = true;
    s.slideT = 0;
    s.slideStarted = true;
    const inv = 1 / hSpeed;
    s.vx = s.vx * inv * SLIDE_SPEED;
    s.vz = s.vz * inv * SLIDE_SPEED;
  }
  if (s.sliding) {
    s.slideT += dt;
    if (!crouchHeld || !s.grounded || s.slideT >= SLIDE_TIME ||
        Math.hypot(s.vx, s.vz) < SLIDE_END_SPEED) {
      s.sliding = false;
      s.slideReadyAt = now + SLIDE_COOLDOWN;
    }
  }

  // --- stance -------------------------------------------------------------
  const wantCrouch = crouchHeld || s.sliding;
  const targetCrouch = wantCrouch ? 1 : 0;
  if (targetCrouch > s.crouchT) {
    // a slide drops you into the low stance much faster than a normal crouch
    s.crouchT = Math.min(1, s.crouchT + CROUCH_SPEED * dt * (s.sliding ? 2.2 : 0.75));
  } else if (targetCrouch < s.crouchT) {
    // only stand up if there is headroom
    const testT = Math.max(0, s.crouchT - CROUCH_SPEED * dt);
    const testH = lerp(PLAYER_HEIGHT_STAND, PLAYER_HEIGHT_CROUCH, testT);
    if (world.isClear(s.x, s.y + 0.05, s.z, PLAYER_RADIUS * 0.95, testH - 0.05)) s.crouchT = testT;
  }

  const ads = canAct && !!(b & BTN.ADS);
  const walkKey = canAct && !!(b & BTN.WALK);
  const wantSprint = canAct && !!(b & BTN.SPRINT) && fwd > SPRINT_MIN_FORWARD && !ads &&
    s.crouchT < 0.35 && !s.sliding;
  s.ads = ads && !wantSprint;
  s.sprinting = wantSprint;
  s.walking = walkKey && !wantSprint;

  // --- lean ---------------------------------------------------------------
  let leanTarget = 0;
  if (canAct && !wantSprint) {
    if (b & BTN.LEAN_L) leanTarget -= 1;
    if (b & BTN.LEAN_R) leanTarget += 1;
  }
  if (leanTarget !== 0) {
    // block the lean if the head would end up inside geometry
    const h = playerHeight(s);
    const off = leanTarget * 0.44;
    const lx = s.x + Math.cos(s.yaw) * off;
    const lz = s.z - Math.sin(s.yaw) * off;
    if (!world.isClear(lx, s.y + h * 0.5, lz, PLAYER_RADIUS * 0.45, h * 0.45)) leanTarget = 0;
  }
  s.leanT += (leanTarget - s.leanT) * (1 - Math.exp(-LEAN_SPEED * dt));

  // --- target speed -------------------------------------------------------
  let speed = SPEED_WALK;
  if (wantSprint) speed = SPEED_SPRINT;
  else if (s.crouchT > 0.5) speed = SPEED_CROUCH;
  else if (walkKey) speed = SPEED_TACTICAL;
  if (s.ads) speed *= SPEED_ADS_MULT + 0.2;
  speed *= mobility;
  if (fwd < 0) speed *= 0.82;                      // backpedal penalty
  if (s.crouchT > 0 && s.crouchT <= 0.5) speed *= lerp(1, 0.7, s.crouchT * 2);

  // --- acceleration -------------------------------------------------------
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  // forward is -Z at yaw 0 (three.js convention)
  const wishX = (-sy * fwd + cy * side);
  const wishZ = (-cy * fwd - sy * side);
  const wishLen = Math.hypot(wishX, wishZ);
  const wx = wishLen > 0 ? wishX / wishLen : 0;
  const wz = wishLen > 0 ? wishZ / wishLen : 0;
  const wishSpeed = wishLen > 0 ? speed : 0;

  if (s.grounded && s.sliding) {
    // A slide coasts: far lower drag than walking, and only a little steering
    // authority, so it commits you to the direction you launched in.
    const spd = Math.hypot(s.vx, s.vz);
    if (spd > 0.01) {
      const drop = spd * SLIDE_FRICTION * dt;
      const k = Math.max(0, spd - drop) / spd;
      s.vx *= k; s.vz *= k;
    }
    accelerate(s, wx, wz, wishSpeed * SLIDE_STEER, ACCEL_GROUND * 0.16, dt);
  } else if (s.grounded) {
    // Ground friction always applies. (There used to be a bunny-hop window
    // that skipped it on the tick a buffered jump fired, letting hops chain
    // with no speed loss — removed, along with jump buffering itself.)
    const spd = Math.hypot(s.vx, s.vz);
    if (spd > 0.01) {
      const drop = Math.max(spd, 2.0) * FRICTION_GROUND * dt;
      const k = Math.max(0, spd - drop) / spd;
      s.vx *= k; s.vz *= k;
    } else { s.vx = 0; s.vz = 0; }
    accelerate(s, wx, wz, wishSpeed, ACCEL_GROUND, dt);
  } else {
    accelerate(s, wx, wz, wishSpeed, ACCEL_AIR, dt);
    s.vy -= GRAVITY * dt;
  }

  // --- jump ---------------------------------------------------------------
  // One jump per JUMP_COOLDOWN, from the ground only. Jump buffering, coyote
  // time and the landing friction exemption are all gone, so hops cannot be
  // chained — bunny hopping is not a movement option any more. Jumping still
  // cancels a slide, which is the one movement combo that remains.
  //
  // The gate is an absolute DEADLINE compared against the command's own
  // clock, not a countdown ticked down by dt. A countdown is not replay-safe:
  // client reconciliation re-runs every unacknowledged command through this
  // function, so each replay subtracted dt again and the cooldown drained
  // several times faster than real time — which is why there was effectively
  // no cooldown at all. `cmd.t` is a property of the command, so replaying it
  // produces the same answer every time.
  //
  // Replaying a command must also REPRODUCE its jump, not suppress it. The
  // deadline alone did suppress it: the live pass set jumpReadyAt, so when
  // reconciliation replayed that same command the gate rejected it, the
  // predicted hop was thrown away, and the jump only reappeared once the
  // server's own snapshot arrived — a small hop followed by the real one.
  // Remembering which command did the jumping lets the replay redo exactly
  // that command while still refusing every later one.
  const sameCmdJumped = cmd.seq !== undefined && s.jumpSeq === cmd.seq;
  if (canAct && (b & BTN.JUMP) && s.grounded &&
      (now >= s.jumpReadyAt || sameCmdJumped) &&
      (s.crouchT < 0.4 || s.sliding)) {
    if (s.sliding) { s.sliding = false; s.slideReadyAt = now + SLIDE_COOLDOWN; }
    s.vy = JUMP_VELOCITY;
    s.grounded = false;
    s.jumped = true;
    s.jumpReadyAt = now + JUMP_COOLDOWN;
    if (cmd.seq !== undefined) s.jumpSeq = cmd.seq;
  } else s.jumped = false;

  // --- integrate + collide ------------------------------------------------
  const height = playerHeight(s);
  const wasGrounded = s.grounded;
  const startY = s.y;

  // horizontal first, with step-up
  const preX = s.x, preZ = s.z;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  depenetrate(world, s, PLAYER_RADIUS, height, scratch);
  if (scratch.hitWall && wasGrounded && scratch.lateralTopY > startY + 0.02 &&
      scratch.lateralTopY <= startY + STEP_HEIGHT) {
    // The obstacle we hit is low enough to walk up: place the feet on its top
    // if the body fits there.
    const ny = scratch.lateralTopY;
    const tx = preX + s.vx * dt, tz = preZ + s.vz * dt;
    if (world.isClear(tx, ny + 0.02, tz, PLAYER_RADIUS * 0.97, height - 0.05)) {
      s.x = tx; s.z = tz; s.y = ny;
    }
  }

  // vertical
  s.y += s.vy * dt;
  depenetrate(world, s, PLAYER_RADIUS, height, scratch);
  if (scratch.hitGround && s.vy <= 0.001) {
    s.grounded = true;
    s.groundSurface = scratch.groundSurface || 'concrete';
    if (!wasGrounded) {
      s.landImpact = clamp(-s.vy / 12, 0, 1.4);
      s.landed = true;
    } else s.landed = false;
    s.vy = 0;
    s.airTime = 0;
  } else {
    s.landed = false;
    if (scratch.hitCeiling && s.vy > 0) s.vy = 0;
    // Cylinder support test: keeps us glued to steps and ledges we are only
    // partially standing on instead of stuttering off the edge.
    const sup = s.vy <= 0.001 ? world.supportY(s.x, s.y, s.z, PLAYER_RADIUS, wasGrounded ? STEP_HEIGHT * 0.8 : 0.04) : { y: -Infinity };
    if (sup.y > -Infinity) {
      s.y = sup.y;
      s.vy = 0;
      s.grounded = true;
      s.groundSurface = sup.surface || s.groundSurface;
      if (!wasGrounded) { s.landImpact = 0; s.landed = false; }
    } else {
      s.grounded = false;
      s.airTime += dt;
    }
  }

  // world floor safety net
  if (s.y < -40) { s.y = -40; s.vy = 0; s.grounded = true; }

  const moved = Math.hypot(s.x - preX, s.z - preZ);
  if (s.grounded) s.stepDistance += moved;
  s.speed = Math.hypot(s.vx, s.vz);
  s.wasGrounded = wasGrounded;
  return s;
}

function accelerate(s, wx, wz, wishSpeed, accel, dt) {
  if (wishSpeed <= 0) return;
  const current = s.vx * wx + s.vz * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  let a = accel * wishSpeed * dt;
  if (a > add) a = add;
  s.vx += wx * a;
  s.vz += wz * a;
}

/**
 * Footstep cadence in metres, so sprinting steps land further apart.
 *
 * These were set for the old, slower base speeds; once the movement was sped
 * up toward a Call-of-Duty pace the same distances fired footfalls roughly
 * twice a second, which is why the steps sounded frantic. Longer strides put
 * the cadence back to something a human could actually run at.
 */
export function stepInterval(s) {
  if (s.crouchT > 0.5) return 1.60;
  if (s.sprinting) return 2.15;
  if (s.walking) return 1.75;
  return 1.55;
}
