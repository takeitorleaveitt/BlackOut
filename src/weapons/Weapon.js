// Runtime weapon state machine: firing, cycling, reloading, ADS, spread growth
// and recoil.  Owns no rendering — the view model reads this state and the
// local player asks it for shots.

import { resolveWeapon } from '../shared/attachments.js';
import { fireInterval, recoilStep } from '../shared/weapons.js';
import { clamp, lerp, smoothDamp } from '../shared/constants.js';

export const WS = {
  IDLE: 'idle',
  FIRING: 'firing',
  CYCLING: 'cycling',       // pump action between shells
  RELOADING: 'reloading',
  RELOAD_LOOP: 'reloadLoop', // shell-by-shell
  DRAWING: 'drawing',
  HOLSTERING: 'holstering',
  INSPECTING: 'inspecting'
};

export class Weapon {
  constructor(base, attachments = []) {
    this.base = base;
    this.attachments = attachments.slice();
    this.def = resolveWeapon(base, attachments);
    this.ammo = this.def.magSize;
    this.reserve = this.def.reserve;
    this.chambered = true;
    this.state = WS.DRAWING;
    this.stateT = 0;
    this.stateDur = this.def.drawTime;
    this.cooldown = 0;
    this.adsT = 0;
    this.wantAds = false;
    this.shotIndex = 0;
    this.sinceShot = 99;
    this.spread = this.def.spreadHip;
    this.kick = { x: 0, y: 0 };      // visual recoil offset (recovers)
    this.kickVel = { x: 0, y: 0 };
    this.punch = 0;                  // weapon push-back along Z
    this.punchVel = 0;
    this.triggerHeld = false;
    this.wasTriggerHeld = false;
    this.emptyReload = false;
    this.pendingShells = 0;
    this.events = [];                // consumed by the owner each frame
    this.lightOn = false;
    this.heat = 0;
  }

  get isReloading() { return this.state === WS.RELOADING || this.state === WS.RELOAD_LOOP; }
  get isBusy() { return this.state !== WS.IDLE && this.state !== WS.FIRING; }
  get canFire() {
    return this.ammo > 0 && this.cooldown <= 0 &&
      (this.state === WS.IDLE || this.state === WS.FIRING);
  }
  get magFraction() { return this.ammo / this.def.magSize; }

  setAttachments(list) {
    this.attachments = list.slice();
    this.def = resolveWeapon(this.base, this.attachments);
    this.ammo = Math.min(this.ammo, this.def.magSize);
  }

  emit(type, data) { this.events.push({ type, ...data }); }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Effective look sensitivity multiplier while aiming. */
  adsFovScale() { return lerp(1, this.def.adsFov, this.adsT); }

  /**
   * @param dt seconds
   * @param ctx { moving, sprinting, crouching, grounded, speed, canAct }
   */
  update(dt, ctx) {
    this.cooldown -= dt;
    this.sinceShot += dt;
    this.stateT += dt;

    // --- ADS ---------------------------------------------------------------
    // A knife has no sights to aim down, so it never enters ADS at all —
    // right-click on a blade should do nothing rather than zooming it like
    // a gun.
    const blockAds = this.def.melee || ctx.sprinting || this.state === WS.DRAWING ||
      this.state === WS.HOLSTERING || this.state === WS.INSPECTING;
    const target = this.wantAds && !blockAds && !this.isReloading ? 1 : 0;
    // Move toward the target and STOP there.
    //
    // This used to add or subtract a fixed step based on the sign of
    // (target - adsT), with the equal case falling into the subtract branch.
    // So the moment adsT reached 1 and the target stayed 1, every frame
    // stepped backwards and the next frame stepped forward again — a
    // permanent oscillation between fully aimed and several per cent back
    // toward the hip, for as long as the aim button was held. On screen that
    // is the weapon vibrating at half the frame rate, which reads as a
    // second ghosted copy of the gun. That is the "two guns while aiming"
    // bug, and it was never a post-processing filter: clamping the step to
    // the target is the whole fix.
    const diff = target - this.adsT;
    if (diff !== 0) {
      const rate = diff > 0
        ? 1 / Math.max(0.05, this.def.adsTime)
        : 1 / Math.max(0.05, this.def.adsTime * 0.8);
      const step = rate * dt;
      this.adsT = diff > 0
        ? Math.min(target, this.adsT + step)
        : Math.max(target, this.adsT - step);
    }

    // --- state machine -----------------------------------------------------
    switch (this.state) {
      case WS.DRAWING:
        if (this.stateT >= this.stateDur) this.setState(WS.IDLE);
        break;
      case WS.HOLSTERING:
        if (this.stateT >= this.stateDur) this.emit('holstered');
        break;
      case WS.CYCLING:
        if (this.stateT >= this.stateDur) this.setState(WS.IDLE);
        break;
      case WS.INSPECTING:
        if (this.stateT >= this.stateDur) this.setState(WS.IDLE);
        break;
      case WS.RELOADING:
        if (this.stateT >= this.stateDur) this.finishReload();
        break;
      case WS.RELOAD_LOOP:
        if (this.stateT >= this.stateDur) this.loadShell();
        break;
      default:
        break;
    }

    // --- spread ------------------------------------------------------------
    const d = this.def;
    let base = lerp(d.spreadHip, d.spreadAds, this.adsT);
    let mult = 1;
    if (!ctx.grounded) mult *= d.spreadJump / Math.max(0.01, d.spreadHip) * 0.5 + 1;
    else if (ctx.sprinting) mult *= 1 + d.spreadMove / Math.max(0.5, d.spreadHip);
    else if (ctx.speed > 0.6) mult *= 1 + (d.spreadMove / Math.max(0.5, d.spreadHip)) * clamp(ctx.speed / 4, 0, 1) * 0.55;
    if (ctx.crouching) mult *= 0.78;
    const targetSpread = clamp(base * mult, 0.02, d.spreadMax);
    // grows instantly with each shot, recovers smoothly
    this.spread = Math.max(targetSpread, smoothDamp(this.spread, targetSpread, d.spreadRecover, dt));

    // --- recoil recovery ---------------------------------------------------
    const rec = d.recoil.recovery;
    this.kick.x = smoothDamp(this.kick.x, 0, rec, dt);
    this.kick.y = smoothDamp(this.kick.y, 0, rec, dt);
    this.punch = smoothDamp(this.punch, 0, rec * 1.35, dt);
    if (this.sinceShot > 0.28) {
      this.shotIndex = Math.max(0, this.shotIndex - dt * 9);
    }
    this.heat = Math.max(0, this.heat - dt * 0.55);

    // --- automatic fire ----------------------------------------------------
    if (this.triggerHeld && ctx.canAct && !ctx.sprinting) {
      if (this.def.auto || !this.wasTriggerHeld) this.tryFire(ctx);
    }
    this.wasTriggerHeld = this.triggerHeld;

    // auto-reload on empty
    if (this.ammo === 0 && this.state === WS.IDLE && this.reserve > 0 && ctx.canAct) {
      this.reload();
    }
  }

  setState(s, dur = 0) {
    this.state = s;
    this.stateT = 0;
    this.stateDur = dur;
  }

  setTrigger(down) { this.triggerHeld = down; }

  /** Attempt to fire one round. Returns the shot descriptor or null. */
  tryFire(ctx) {
    if (this.state === WS.RELOAD_LOOP && this.ammo > 0) {
      // interrupt a shell reload to shoot
      this.setState(WS.IDLE);
    }
    if (!this.canFire) {
      if (this.ammo === 0 && this.cooldown <= 0 && this.state === WS.IDLE) {
        this.cooldown = 0.28;
        this.emit('dryfire');
      }
      return null;
    }
    const d = this.def;
    if (!d.melee) this.ammo--;
    this.cooldown = fireInterval(d);
    this.sinceShot = 0;
    this.heat = Math.min(1, this.heat + 0.08);

    // recoil impulse
    const step = recoilStep(d, Math.floor(this.shotIndex));
    const rnd = (Math.random() - 0.5) * 2;
    this.kick.y += step.v * (1 + Math.abs(rnd) * 0.18) * (this.adsT > 0.5 ? 0.72 : 1);
    this.kick.x += (step.h + rnd * d.recoil.horiz * 0.35) * (this.adsT > 0.5 ? 0.72 : 1);
    this.punch += d.recoil.kickBack;
    this.shotIndex++;
    this.spread = Math.min(d.spreadMax, this.spread + d.spreadPerShot);

    const seed = (Math.random() * 0xffffffff) >>> 0;
    const shot = {
      seed,
      spread: this.spread,
      weapon: d,
      pellets: d.pellets || 1,
      empty: this.ammo === 0,
      // fraction of the kick that permanently moves the aim point
      aimKick: { x: this.kick.x * 0.34, y: step.v * 0.42 }
    };
    this.emit('fired', shot);

    if (d.pumpTime) this.setState(WS.CYCLING, d.pumpTime);
    return shot;
  }

  reload() {
    const d = this.def;
    // There is nothing to reload on a blade. Without this the knife would run
    // the whole magazine-swap state machine, which is a large part of why it
    // felt like a gun that happens to be shaped differently.
    if (d.melee) return false;
    if (this.isReloading || this.reserve <= 0 || this.ammo >= d.magSize) return false;
    if (this.state === WS.DRAWING || this.state === WS.HOLSTERING) return false;
    this.emptyReload = this.ammo === 0;
    if (d.shellReload) {
      this.pendingShells = Math.min(d.magSize - this.ammo, this.reserve);
      this.setState(WS.RELOAD_LOOP, d.reloadStart);
      this.emit('reloadStart', { empty: this.emptyReload, shell: true });
    } else {
      const dur = this.emptyReload ? d.reloadEmpty : d.reloadTactical;
      this.setState(WS.RELOADING, dur);
      this.emit('reloadStart', { empty: this.emptyReload, duration: dur });
    }
    this.adsT = Math.min(this.adsT, 0.35);
    return true;
  }

  finishReload() {
    const d = this.def;
    const need = d.magSize - this.ammo;
    const take = Math.min(need, this.reserve);
    this.ammo += take;
    this.reserve -= take;
    this.setState(WS.IDLE);
    this.emit('reloadEnd', {});
  }

  loadShell() {
    const d = this.def;
    if (this.pendingShells <= 0 || this.reserve <= 0 || this.ammo >= d.magSize) {
      this.setState(WS.CYCLING, d.reloadEnd);
      this.emit('reloadEnd', {});
      return;
    }
    this.ammo++;
    this.reserve--;
    this.pendingShells--;
    this.emit('shellLoaded', {});
    this.setState(WS.RELOAD_LOOP, d.reloadTactical);
  }

  cancelReload() {
    if (this.state === WS.RELOAD_LOOP) {
      this.setState(WS.CYCLING, this.def.reloadEnd);
      return true;
    }
    return false;
  }

  inspect() {
    if (this.state !== WS.IDLE) return;
    this.setState(WS.INSPECTING, 2.4);
    this.emit('inspect');
  }

  draw() {
    this.setState(WS.DRAWING, this.def.drawTime);
    this.emit('draw');
  }

  holster() {
    this.setState(WS.HOLSTERING, this.def.holsterTime);
    this.emit('holster');
  }

  refill() {
    this.ammo = this.def.magSize;
    this.reserve = this.def.reserve;
  }

  toggleLight() {
    if (!this.def.flags?.light) return false;
    this.lightOn = !this.lightOn;
    return this.lightOn;
  }
}
