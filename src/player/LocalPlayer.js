// The local operator: input sampling, client-side prediction with server
// reconciliation, weapon handling, and every piece of feedback that sells a
// hit — camera kick, muffled hearing, breathing, blood, decals, casings.

import * as THREE from 'three';
import { CameraRig } from './CameraRig.js';
import { Weapon, WS } from '../weapons/Weapon.js';
import { createMoveState, stepMovement, playerHeight, eyeHeight, stepInterval,
  cloneMoveState, restoreMoveState } from '../shared/movement.js';
import { BTN, MAX_HEALTH, PLAYER_RADIUS, clamp, lerp } from '../shared/constants.js';
import { simulateBullet, applySpread } from '../shared/ballistics.js';
import { mulberry32 } from '../shared/constants.js';
import { WEAPON_BY_KEY } from '../shared/weapons.js';
import { S } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';

const TICK = 1 / 60;

export class LocalPlayer {
  constructor(game) {
    this.game = game;
    this.rig = new CameraRig(game.engine.camera);
    this.state = createMoveState(0, 0, 0);
    this.health = MAX_HEALTH;
    this.alive = true;
    this.team = 0;
    this.id = -1;

    this.weapons = [];
    this.slot = 0;
    this.pendingSlot = -1;

    this.seq = 1;
    this.pending = [];         // unacknowledged commands for replay
    this.acc = 0;
    this.lastButtons = 0;
    this.stepAccum = 0;
    this.hurtTimer = 0;
    this.damageFx = 0;
    this.lastHitDirs = [];
    this.canAct = true;
    this.spawnProtect = 0;
    this.frozen = false;

    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._ejectPos = new THREE.Vector3();
    this._muzzle = {};
    this._lastShotTime = 0;
    this._wallProbe = 2;

    // The weapon-light attachment used to only exist as a light inside the
    // isolated view-model scene (a separate render pass for the first-person
    // gun/arms) — it made the gun's own barrel glow but, because that scene
    // never touches the actual world geometry, it never lit up a single wall
    // or hallway. That's what read as "the flashlight doesn't work": it
    // visually did something, just not the thing a flashlight is for. This
    // is the real one, living in the world scene the player actually walks
    // through, aimed along the camera and gated on the same lightOn/attachment
    // state so it only comes on when the equipped weapon actually has the
    // attachment.
    this.flashlight = new THREE.SpotLight(0xfff4dd, 0, 48, 0.36, 0.45, 1.15);
    this.flashlight.target = new THREE.Object3D();
    game.engine.scene.add(this.flashlight, this.flashlight.target);
  }

  // -------------------------------------------------------------------------
  setLoadout(loadout) {
    const primary = WEAPON_BY_KEY[loadout.primary] || WEAPON_BY_KEY.m4a1;
    const secondary = WEAPON_BY_KEY[loadout.secondary] || WEAPON_BY_KEY.glock17;
    this.weapons = [
      new Weapon(primary, loadout.primaryAttachments || []),
      new Weapon(secondary, loadout.secondaryAttachments || []),
      new Weapon(WEAPON_BY_KEY.knife, [])
    ];
    this.slot = 0;
    this.game.viewmodel.equip(this.weapon);
    this.weapon.draw();
    bus.emit('hud:weapon', this.weapon);
  }

  get weapon() { return this.weapons[this.slot]; }

  spawn(pos, yaw, opts = {}) {
    if (!this.weapons.length) this.setLoadout(S.loadout);
    this.state = createMoveState(pos[0], pos[1], pos[2]);
    this.state.yaw = yaw;
    this.rig.reset(pos[0], pos[1], pos[2], yaw);
    this.health = MAX_HEALTH;
    this.alive = true;
    this.damageFx = 0;
    this.hurtTimer = 0;
    this.spawnProtect = opts.protect ?? 1.6;
    this.pending.length = 0;
    for (const w of this.weapons) { w.refill(); w.setState(WS.IDLE); }
    this.slot = 0;
    this.game.viewmodel.equip(this.weapon);
    this.weapon.draw();
    bus.emit('hud:health', this.health);
    bus.emit('hud:weapon', this.weapon);
  }

  // -------------------------------------------------------------------------
  buildButtons(input) {
    let b = 0;
    if (!this.canAct || this.frozen) return b;
    if (input.down('forward')) b |= BTN.FORWARD;
    if (input.down('back')) b |= BTN.BACK;
    if (input.down('left')) b |= BTN.LEFT;
    if (input.down('right')) b |= BTN.RIGHT;
    if (input.down('jump')) b |= BTN.JUMP;
    if (S.toggleCrouch ? this.crouchToggle : input.down('crouch')) b |= BTN.CROUCH;
    if (input.down('walk')) b |= BTN.WALK;
    if (input.down('leanLeft')) b |= BTN.LEAN_L;
    if (input.down('leanRight')) b |= BTN.LEAN_R;
    const sprint = S.toggleSprint ? this.sprintToggle : input.down('sprint');
    if (sprint) b |= BTN.SPRINT;   // auto-sprint removed
    if (this.adsHeld) b |= BTN.ADS;
    if (this.fireHeld) b |= BTN.FIRE;
    return b;
  }

  handleKey(code, down, input) {
    if (!down) return;
    const binds = S.binds;
    if (code === binds.reload) this.weapon?.reload();
    if (code === binds.primary) this.switchTo(0);
    if (code === binds.secondary) this.switchTo(1);
    if (code === binds.melee) this.switchTo(2);
    if (code === binds.inspect) this.weapon?.inspect();
    if (code === binds.flashlight) {
      if (this.weapon?.toggleLight()) this.game.audio.mech('safety');
      else this.game.audio.mech('safety', null, 0.5);
    }
    if (code === binds.crouch && S.toggleCrouch) this.crouchToggle = !this.crouchToggle;
    if (code === binds.sprint && S.toggleSprint) this.sprintToggle = !this.sprintToggle;
  }

  switchTo(slot) {
    if (slot === this.slot || slot >= this.weapons.length) return;
    if (this.weapon.state === WS.HOLSTERING) return;
    this.pendingSlot = slot;
    this.weapon.holster();
    this.game.audio.mech('select', null, 0.7);
  }

  nextWeapon(dir) {
    this.switchTo((this.slot + (dir > 0 ? 1 : this.weapons.length - 1)) % this.weapons.length);
  }

  // -------------------------------------------------------------------------
  update(dt, input) {
    const g = this.game;

    // --- look ---------------------------------------------------------------
    const m = input.takeMouse();
    if (input.locked && this.canAct) {
      this.rig.look(m.dx, m.dy, this.weapon ? this.weapon.adsT : 0);
      if (m.wheel) this.nextWeapon(m.wheel);
    }

    this.adsHeld = this.forceAds || (input.locked && (S.toggleAds ? this.adsToggle : input.rawDown('Mouse2')));
    this.fireHeld = input.locked && input.rawDown('Mouse0') && this.alive && this.canAct && !this.frozen;

    // --- cheat codes (offline matches only) ---------------------------------
    if (g.cheatsActive && this.alive && this.canAct && !this.frozen) {
      if (g.cheats.aimbot) this.runAimbot(dt);
      if (g.cheats.auto && this.enemyUnderCrosshair()) this.fireHeld = true;
    }

    // --- fixed-step movement prediction --------------------------------------
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK && steps < 5) {
      this.acc -= TICK;
      steps++;
      const buttons = this.buildButtons(input);
      // `t` is a monotonic clock stamped ON the command. Cooldowns compare
      // against it rather than counting down, so replaying an unacknowledged
      // command during reconciliation cannot advance them a second time.
      this.simTime = (this.simTime || 0) + TICK;
      const cmd = {
        seq: this.seq++,
        buttons,
        yaw: this.rig.targetYaw,
        pitch: this.rig.targetPitch,
        dt: TICK,
        t: this.simTime
      };
      // Mobility MUST be the exact value the server will use for this same
      // command, or prediction drifts and the reconciler yanks you back —
      // that is the rubber-banding. This used to also fold in a per-weapon
      // ADS mobility multiplier that neither the server nor the replay path
      // below applied, so every step taken while aiming diverged: the client
      // walked slow, the server walked fast, and the correction snapped you
      // backwards. The ADS slowdown itself is not lost — shared movement
      // already applies SPEED_ADS_MULT off the ADS button, which the server
      // sees in the same command.
      const mob = this.weapon ? this.weapon.def.mobility : 1;
      // The snapshot is taken BEFORE the command runs: reconciliation needs
      // the state as it was going in, so a replay reproduces the command
      // instead of stacking on top of what the live pass already did.
      const before = cloneMoveState(this.state);
      stepMovement(this.state, cmd, g.world, mob, this.alive && !this.frozen);
      this.pending.push({ cmd, before });
      if (this.pending.length > 200) this.pending.shift();
      g.net?.sendInput(cmd);
      this.onMoved(TICK);
    }

    // --- weapon --------------------------------------------------------------
    const w = this.weapon;
    if (w) {
      w.wantAds = !!this.adsHeld && this.alive;
      w.setTrigger(!!this.fireHeld);
      w.update(dt, {
        moving: this.state.speed > 0.4,
        sprinting: this.state.sprinting,
        crouching: this.state.crouchT > 0.5,
        grounded: this.state.grounded,
        speed: this.state.speed,
        canAct: this.alive && this.canAct && !this.frozen
      });
      this.processWeaponEvents(w);
    }

    // --- camera --------------------------------------------------------------
    this.spawnProtect = Math.max(0, this.spawnProtect - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.damageFx = Math.max(0, this.damageFx - dt * 0.75);
    this.rig.update(dt, this.state, {
      eyeHeight: eyeHeight(this.state),
      ads: w ? w.adsT > 0.5 : false,
      health: this.health,
      recoilRecovery: w ? w.def.recoil.recovery : 8
    });

    // --- view model ----------------------------------------------------------
    this.updateWallProbe();
    g.viewmodel.update(dt, {
      camera: g.engine.camera,
      yawRate: this.rig.yawRate,
      pitchRate: this.rig.pitchRate,
      speed: this.state.speed,
      sprinting: this.state.sprinting,
      crouching: this.state.crouchT > 0.5,
      grounded: this.state.grounded,
      moving: this.state.speed > 0.4,
      landImpact: Math.max(0, -this.rig.landDip * 3),
      wallDistance: this._wallProbe,
      dead: !this.alive
    });

    // --- flashlight (real world-space light, not the cosmetic viewmodel one) -
    const wantLight = !!w && !!w.lightOn && !!g.viewmodel.model?.attached?.light && this.alive;
    this.flashlight.intensity = wantLight ? 44 : 0;
    if (wantLight) {
      const cam = g.engine.camera;
      this._dir.set(0, 0, -1).applyQuaternion(cam.quaternion);
      this.flashlight.position.copy(cam.position);
      this.flashlight.target.position.set(
        cam.position.x + this._dir.x * 16,
        cam.position.y + this._dir.y * 16,
        cam.position.z + this._dir.z * 16
      );
    }

    // Breathing used to be audible here — a swell of bandpassed noise every
    // 1.15 seconds while hurt or winded. It is gone. It was reported as a
    // scraping noise three separate times: as a lone unexplained sound while
    // standing still, and then as a repeated rasp after every sprint and any
    // time health dropped below 55. The camera still breathes (see
    // CameraRig), which carries the same information without the noise.

    // --- audio muffling from damage -----------------------------------------
    g.audio.setMuffle(clamp(this.damageFx * 0.75 + (this.alive ? 0 : 0.55), 0, 0.9));
    g.engine.postCtx.damage = this.damageFx;
    g.engine.postCtx.yawRate = this.rig.yawRate;
    g.engine.postCtx.pitchRate = this.rig.pitchRate;
    g.engine.postCtx.indoor = !!g.worldRenderer.zoneAt(this.state.x, this.state.y + 1.2, this.state.z);
  }

  /**
   * Enemies the local player could plausibly shoot: alive, on another team,
   * and with clear line of sight from the eye to their chest.
   */
  visibleEnemies() {
    const g = this.game;
    const out = [];
    const ex = this.state.x, ey = this.state.y + eyeHeight(this.state), ez = this.state.z;
    for (const r of g.remotes.values()) {
      if (r.render.dead) continue;
      if (this.team && r.team === this.team) continue;
      const tx = r.render.x, ty = r.render.y + 1.2, tz = r.render.z;
      const dx = tx - ex, dy = ty - ey, dz = tz - ez;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.001 || dist > 90) continue;
      const hit = g.world?.raycast(ex, ey, ez, dx / dist, dy / dist, dz / dist, dist - 0.35);
      if (hit) continue;                       // wall in the way
      out.push({ x: tx, y: ty, z: tz, dist });
    }
    return out;
  }

  /** True when an enemy sits within a small cone of where we are aiming. */
  enemyUnderCrosshair() {
    const aim = this.rig.getAimDir(this._dir);
    const ex = this.state.x, ey = this.state.y + eyeHeight(this.state), ez = this.state.z;
    for (const e of this.visibleEnemies()) {
      const dx = (e.x - ex) / e.dist, dy = (e.y - ey) / e.dist, dz = (e.z - ez) / e.dist;
      // ~2.5 degrees of tolerance, so it triggers on the body rather than
      // anywhere in the general direction.
      if (aim.x * dx + aim.y * dy + aim.z * dz > 0.999) return true;
    }
    return false;
  }

  /**
   * Deliberately mediocre aimbot: it drags aim toward the nearest visible
   * enemy at a capped angular rate and stops once it is roughly on target,
   * so it wobbles and overshoots rather than snapping perfectly.
   */
  runAimbot(dt) {
    const targets = this.visibleEnemies();
    if (!targets.length) return;
    let best = targets[0];
    for (const t of targets) if (t.dist < best.dist) best = t;

    const ex = this.state.x, ey = this.state.y + eyeHeight(this.state), ez = this.state.z;
    const dx = best.x - ex, dy = best.y - ey, dz = best.z - ez;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));

    let dYaw = wantYaw - this.rig.targetYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = wantPitch - this.rig.targetPitch;

    // capped turn rate + a dead zone, which is what keeps it "kinda bad"
    const rate = 4.2 * dt;
    if (Math.abs(dYaw) > 0.012) this.rig.targetYaw += clamp(dYaw, -rate, rate);
    if (Math.abs(dPitch) > 0.012) this.rig.targetPitch += clamp(dPitch, -rate, rate);
  }

  /** Distance to the wall the muzzle is pointing at (drives the low-ready pose). */
  updateWallProbe() {
    const g = this.game;
    if (!g.world) return;
    const cam = g.engine.camera;
    this._dir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = g.world.raycast(
      cam.position.x, cam.position.y, cam.position.z,
      this._dir.x, this._dir.y, this._dir.z, 1.2
    );
    this._wallProbe = hit ? hit.distance : 2;
  }

  /** Footsteps and landing, driven by predicted movement. */
  onMoved(dt) {
    const st = this.state;
    const g = this.game;
    if (st.landed && st.landImpact > 0.06) {
      g.audio.footstep(st.groundSurface, [st.x, st.y, st.z], clamp(st.landImpact * 1.4, 0.3, 1.4), true);
      g.net?.sendEvent('land');
    }
    // A slide is one long scrape, not a run of footfalls: play a single heavy
    // scuff as it launches and then stay quiet until it ends.
    if (st.slideStarted) {
      g.audio.footstep(st.groundSurface, [st.x, st.y, st.z], 1.25, true);
      this.rig.addShake(0.35 * (S.cameraShake ?? 1));
    }
    if (st.sliding) { this.stepAccum = st.stepDistance; return; }
    if (!st.grounded || st.speed < 0.4) return;
    const interval = stepInterval(st);
    if (st.stepDistance - this.stepAccum >= interval) {
      this.stepAccum = st.stepDistance;
      const vol = st.crouchT > 0.5 ? 0.3 : st.walking ? 0.42 : st.sprinting ? 1.0 : 0.7;
      g.audio.footstep(st.groundSurface, [st.x, st.y, st.z], vol, true);
    }
  }

  // -------------------------------------------------------------------------
  processWeaponEvents(w) {
    const g = this.game;
    for (const e of w.takeEvents()) {
      switch (e.type) {
        case 'fired': this.onFired(w, e); break;
        case 'dryfire': g.audio.mech('dryfire', null, 0.8); break;
        case 'reloadStart':
          g.audio.mech(e.shell ? 'pumpBack' : 'magOut');
          g.net?.sendEvent('reload', { empty: e.empty });
          bus.emit('hud:reloading', true);
          break;
        case 'shellLoaded': g.audio.mech('shell'); break;
        case 'reloadEnd':
          g.audio.mech('magIn');
          if (w.emptyReload && !w.def.shellReload) {
            setTimeout(() => g.audio.mech('boltRelease'), 90);
          }
          bus.emit('hud:reloading', false);
          bus.emit('hud:weapon', w);
          break;
        case 'draw': g.audio.mech('select'); break;
        case 'inspect': g.audio.mech('safety', null, 0.6); break;
        case 'holstered':
          if (this.pendingSlot >= 0) {
            this.slot = this.pendingSlot;
            this.pendingSlot = -1;
            g.viewmodel.equip(this.weapon);
            this.weapon.draw();
            g.net?.sendEvent('switch', { slot: this.slot });
            bus.emit('hud:weapon', this.weapon);
          }
          break;
        default: break;
      }
    }
  }

  onFired(w, shot) {
    const g = this.game;
    const cam = g.engine.camera;
    const def = w.def;

    // camera + aim kick
    this.rig.addRecoil(
      shot.aimKick.y * 0.55 * def.recoil.viewKick,
      -shot.aimKick.x * 0.5,
      def.recoil.camShake * (S.cameraShake ?? 1) * 0.6
    );
    this.rig.addAimKick(shot.aimKick.y * 0.55, shot.aimKick.x * 0.5);

    // muzzle flash at the actual muzzle (guns only — a knife has neither a
    // muzzle nor a casing to eject)
    const mz = g.viewmodel.getMuzzle(this._muzzle, cam);
    const suppressed = !!def.flags?.suppressed;
    if (mz && !def.melee) {
      g.effects.flashes.flash(mz.pos, def.pellets > 1 ? 1.5 : 1.0, suppressed);
      // No full-screen white flash per shot — on an auto weapon that stacked
      // into a permanent haze over the middle of the screen.
    }

    // ejected casing
    if (mz && !def.melee) {
      // Scratch vectors, not fresh ones: an automatic weapon runs this ~13
      // times a second, and allocating four Vector3s per round is exactly the
      // kind of steady garbage that shows up later as a GC stutter mid-fight.
      const right = this._v.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      const dir = this._fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const ejectPos = g.viewmodel.toWorld(g.viewmodel.model.eject, this._ejectPos, cam);
      const delay = def.pumpTime ? def.pumpTime * 0.5 : 0;
      const onLand = (p, surface, isShell) => g.audio.casing(surface, [p.x, p.y, p.z], isShell);
      if (delay) {
        // The pump-action ejects on a timer, so this call outlives the frame.
        // It gets its own copies — handing the shared scratch vectors to a
        // deferred callback would let a later shot rewrite them first.
        const p = ejectPos.clone(), d = dir.clone(), u = up.clone(), r = right.clone();
        setTimeout(() => g.effects.casings.eject(p, d, u, r, def.pellets > 1, onLand), delay * 1000);
      } else {
        g.effects.casings.eject(ejectPos, dir, up, right, def.pellets > 1, onLand);
      }
    }

    // report
    if (def.melee) g.audio.swing([cam.position.x, cam.position.y, cam.position.z]);
    else g.audio.gunshot(def.audio, [cam.position.x, cam.position.y, cam.position.z], {
      own: true, suppressed
    });

    // --- ballistics --------------------------------------------------------
    const aim = this.rig.getAimDir(this._dir);
    const origin = [cam.position.x, cam.position.y, cam.position.z];
    const rng = mulberry32(shot.seed);
    const pellets = def.pellets || 1;
    const targets = g.remoteTargets();
    const dirs = [];

    for (let i = 0; i < pellets; i++) {
      const spreadDeg = pellets > 1
        ? def.pelletSpread * (0.35 + rng() * 0.8)
        : shot.spread * (0.55 + rng() * 0.5);
      const d = applySpread(aim.x, aim.y, aim.z, spreadDeg, rng);
      dirs.push(d);
      const res = simulateBullet({
        world: g.world,
        origin,
        dir: d,
        weapon: def,
        shooterId: this.id,
        shooterTeam: g.friendlyFire ? 0 : this.team,
        targetsAt: () => targets,
        friendlyFire: g.friendlyFire,
        rng
      });
      this.spawnBulletFx(res, d, def, mz);
    }

    g.net?.sendShot({
      seed: shot.seed,
      spread: shot.spread,
      origin,
      dir: [aim.x, aim.y, aim.z],
      weapon: def.id,
      slot: this.slot
    });
    bus.emit('hud:weapon', w);
    this._lastShotTime = performance.now();
  }

  /** Local visual prediction of a round's flight and impacts. */
  spawnBulletFx(res, dir, def, mz) {
    const g = this.game;
    const start = mz ? [mz.pos.x, mz.pos.y, mz.pos.z] : res.path.slice(0, 3);
    const end = res.impacts.length
      ? res.impacts[0].point
      : res.endPoint;
    const dx = end[0] - start[0], dy = end[1] - start[1], dz = end[2] - start[2];
    const dist = Math.hypot(dx, dy, dz) || 0.001;
    if (!def.melee && Math.random() < (def.pellets > 1 ? 0.34 : 0.62)) {
      g.effects.tracers.fire(
        start, [dx / dist, dy / dist, dz / dist],
        Math.min(def.muzzleVelocity, 620), dist,
        def.pellets > 1 ? 0.012 : 0.016,
        def.caliber.startsWith('7.62') ? 0xffc078 : 0xffe0a8
      );
    }
    for (const imp of res.impacts) {
      // Deliberately no predicted blood: flesh hits are drawn from the
      // authoritative HIT event instead. Predicting them here meant a shot
      // the server scored as a miss still sprayed blood, so blood stopped
      // being a reliable signal that you actually damaged someone.
      if (imp.surface === 'flesh') continue;
      g.effects.impact(imp.point, imp.normal, imp.surface, imp.energy ?? 1);
      g.audio.impact(imp.surface, imp.point, imp.energy ?? 1);
    }
  }

  // -------------------------------------------------------------------------
  // networking
  // -------------------------------------------------------------------------
  /** Reconcile prediction against the authoritative state. */
  applyServerState(self, ackSeq) {
    // drop acknowledged commands
    while (this.pending.length && this.pending[0].cmd.seq <= ackSeq) this.pending.shift();

    const dx = self.x - this.state.x;
    const dy = self.y - this.state.y;
    const dz = self.z - this.state.z;
    const err = Math.hypot(dx, dy, dz);
    // The client predicts at a fixed 60Hz while the server steps at 30Hz, so
    // even perfectly-matched physics will disagree by a few centimetres on
    // ordinary continuous movement just from the two integration step sizes
    // — that is expected numerical noise, not desync. Correcting on every
    // snapshot at a few-cm threshold snapped the camera constantly during
    // normal play. Only reconcile once the gap is large enough to actually
    // matter (a real misprediction, not integration rounding).
    if (err < 0.12) return;

    // Remember where the camera was before the correction. The simulation is
    // snapped to the server immediately (so control stays authoritative and
    // there is zero added input delay), but the *view* is carried across on
    // a short decaying offset instead of teleporting. A correction you cannot
    // see is a correction that does not feel like rubber-banding.
    const preX = this.state.x, preY = this.state.y, preZ = this.state.z;

    // Rewind to the state the first unacknowledged command started from, then
    // snap position and velocity to the server and replay from there.
    //
    // Rewinding matters as much as the snap does. The server only sends
    // position, velocity and grounded, so everything else stepMovement()
    // accumulates — step distance, crouch blend, slide and air timers —
    // used to carry the live pass's value into the replay and get advanced a
    // second time. Footsteps were the visible symptom: every correction
    // pushed stepDistance forward by the whole pending window, so the cadence
    // ran fast and jumped phase.
    restoreMoveState(this.state, this.pending[0]?.before);
    this.state.x = self.x; this.state.y = self.y; this.state.z = self.z;
    this.state.vx = self.vx; this.state.vy = self.vy; this.state.vz = self.vz;
    this.state.grounded = !!(self.flags & 64);
    const mob = this.weapon ? this.weapon.def.mobility : 1;
    for (const p of this.pending) {
      cloneMoveState(this.state, p.before);
      stepMovement(this.state, p.cmd, this.game.world, mob, this.alive);
    }
    if (err > 2.5) {
      // a teleport (spawn / round reset): show it instantly, no smoothing
      this.rig.smoothPos.set(this.state.x, this.state.y + eyeHeight(this.state), this.state.z);
      this.rig.clearCorrection();
    } else {
      // an ordinary correction: hand the camera the leftover difference so it
      // slides the last few centimetres over ~150ms instead of jumping.
      this.rig.addCorrection(
        preX - this.state.x,
        preY - this.state.y,
        preZ - this.state.z
      );
    }
  }

  onDamage(amount, dir, zone) {
    this.health = clamp(this.health - amount, 0, MAX_HEALTH);
    this.hurtTimer = 1.2;
    this.damageFx = clamp(this.damageFx + amount / 55, 0, 1);
    this.rig.addShake(clamp(amount / 22, 0.25, 1.6) * (S.cameraShake ?? 1));
    const kick = clamp(amount / 300, 0.004, 0.05);
    this.rig.addRecoil(kick, (Math.random() - 0.5) * kick * 2, 0);
    this.game.audio.pain(null, clamp(amount / 45, 0.35, 1));
    bus.emit('hud:health', this.health);
    bus.emit('hud:damage', dir);
  }

  onDeath() {
    this.alive = false;
    this.fireHeld = false;
    this.adsHeld = false;
    this.damageFx = 1;
    this.rig.addShake(2.2);
    this.game.audio.setMuffle(0.8);
    bus.emit('hud:health', 0);
  }

  serialize() {
    const st = this.state;
    return {
      x: st.x, y: st.y, z: st.z, yaw: st.yaw, pitch: st.pitch,
      crouchT: st.crouchT, leanT: st.leanT, speed: st.speed,
      grounded: st.grounded, height: playerHeight(st)
    };
  }
}


