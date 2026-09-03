// BLACKOUT PROTOCOL — entry point.
//
// Boots the renderer, builds the menu over a live map, and moves between menu
// and match without ever reloading the page.

import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { perf } from './core/Perf.js';
import { bus } from './core/EventBus.js';
import { S, settings } from './core/Settings.js';
import { WorldRenderer } from './maps/WorldRenderer.js';
import { Effects } from './render/Effects.js';
import { ViewModel } from './weapons/ViewModel.js';
import { LocalPlayer } from './player/LocalPlayer.js';
import { RemotePlayer } from './player/RemotePlayer.js';
import { HUD } from './game/HUD.js';
import { audio } from './audio/AudioEngine.js';
import { NetClient } from './net/NetClient.js';
import { LocalNet } from './net/LocalNet.js';
import { UI } from './ui/UI.js';
import { createMainMenu } from './ui/screens/MainMenu.js';
import { createPlayMenu, createServerBrowser, createPrivateMatch, createLobby, createTraining } from './ui/screens/Play.js';
import { createLoadout } from './ui/screens/Loadout.js';
import { createSettings } from './ui/screens/SettingsScreen.js';
import { createFriends, createPause, createEndMatch } from './ui/screens/Misc.js';
import { getMap, MAP_INFO } from './shared/maps/index.js';
import { WEAPON_BY_ID, WEAPON_BY_KEY } from './shared/weapons.js';
import { resolveWeapon } from './shared/attachments.js';
import { buildWeaponModel } from './weapons/WeaponModels.js';
import { EV, SF } from './shared/protocol.js';
import { INTERP_DELAY_MS, TEAM, clamp, lerp } from './shared/constants.js';
import { REGIONS } from './shared/modes.js';

const MENU_MAPS = ['warehouse', 'blackwood', 'refinery', 'highrise', 'garage', 'suburb'];

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.audio = audio;
    this.engine = new Engine(this.canvas);
    this.input = new Input(this.canvas);
    this.worldRenderer = new WorldRenderer(this.engine);
    this.effects = new Effects(this.engine.scene, this.engine);
    this.viewmodel = new ViewModel(this.engine);
    this.engine.postfx.setViewmodelScene(this.viewmodel.scene, this.viewmodel.camera);
    this.player = new LocalPlayer(this);
    this.remotes = new Map();
    this.world = null;
    this.net = null;
    this.onlineNet = null;
    this.mode = 'menu';               // menu | match
    this.matchState = null;
    this.roomInfo = null;
    this.roomPlayerList = [];
    this.serverList = [];
    this.serverListeners = new Set();
    this.roomListeners = new Set();
    this.playerId = -1;
    this.friendlyFire = false;
    this.paused = false;
    this.menuCam = { t: 0, mapIndex: 0, from: new THREE.Vector3(), to: new THREE.Vector3() };
    this.previewGroup = null;
    this.scoreboardOpen = false;
    this.pingCache = new Map();
    this._accumNet = 0;

    this.ui = new UI(document.getElementById('ui-root'));
    this.hud = new HUD(document.getElementById('hud-root'), this);
    this.hud.show(false);

    this.registerScreens();
    this.bindInput();

    this.engine.addUpdater((dt, t) => this.update(dt, t));
    this.engine.postCtx = {};
  }

  // -------------------------------------------------------------------------
  registerScreens() {
    const u = this.ui;
    u.register('main', createMainMenu(this));
    u.register('play', createPlayMenu(this));
    u.register('browser', createServerBrowser(this));
    u.register('private', createPrivateMatch(this));
    u.register('lobby', createLobby(this));
    u.register('training', createTraining(this));
    u.register('loadout', createLoadout(this));
    u.register('settings', createSettings(this));
    u.register('friends', createFriends(this));
    u.register('pause', createPause(this));
    u.register('end', createEndMatch(this));
  }

  bindInput() {
    bus.on('input:key', (code, down) => {
      if (!down) {
        if (code === S.binds.scoreboard) this.setScoreboard(false);
        if (code === S.binds.use) this.net?.sendEvent(this.matchState?.mode === 'snd' ? 'plant' : 'plant', { down: false });
        return;
      }
      if (code === 'Escape') { this.onEscape(); return; }
      if (this.mode !== 'match' || this.paused) return;
      if (code === S.binds.scoreboard) { this.setScoreboard(true); return; }
      if (code === S.binds.use) {
        this.net?.sendEvent('plant', { down: true });
        this.net?.sendEvent('defuse', { down: true });
        return;
      }
      this.player.handleKey(code, true, this.input);
    });

    bus.on('input:mouse', (btn, down) => {
      if (this.mode === 'match' && !this.paused && down && !this.input.locked && this.player.alive) {
        this.input.requestLock();
      }
      if (down && btn === 2 && S.toggleAds) this.player.adsToggle = !this.player.adsToggle;
      if (this.mode === 'match' && down && !this.player.alive) this.net?.requestRespawn();
    });

    bus.on('input:lock', (locked) => {
      // Only treat *losing* the lock as a pause. A failed request (no recent
      // user gesture — which is the normal case right after an async match
      // join) must not drop the player into the pause menu.
      if (this.mode === 'match' && !locked && this.wasLocked && !this.paused) this.pause();
      this.wasLocked = locked;
      if (locked) this.hud.setPrompt('');
      else if (this.mode === 'match' && !this.paused) this.hud.setPrompt('CLICK TO ENGAGE');
    });

    // the first gesture anywhere starts the audio context
    const startAudio = () => {
      audio.init();
      audio.applyVolumes();
      if (this.mode === 'menu') audio.startMenuMusic();
      window.removeEventListener('pointerdown', startAudio);
      window.removeEventListener('keydown', startAudio);
    };
    window.addEventListener('pointerdown', startAudio);
    window.addEventListener('keydown', startAudio);

    bus.on('settings:changed', (k) => {
      audio.applyVolumes();
      if (k === 'name' || k === '*') this.onNameChanged();
    });
  }

  onEscape() {
    if (this.mode === 'match') {
      if (this.paused) this.resume();
      else this.pause();
      return;
    }
    const cur = this.ui.current?.name;
    if (cur && cur !== 'main') this.ui.back('main');
  }

  // -------------------------------------------------------------------------
  // boot
  // -------------------------------------------------------------------------
  async boot() {
    const boot = document.getElementById('boot');
    const bar = boot.querySelector('.boot-bar i');
    const status = boot.querySelector('.boot-status');
    const step = async (pct, text, fn) => {
      status.textContent = text;
      bar.style.width = pct + '%';
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 16)));
      if (fn) await fn();
    };

    await step(12, 'GENERATING MATERIALS…');
    await step(34, 'BUILDING GEOMETRY…', () => {
      this.loadMenuMap(MENU_MAPS[0]);
    });
    await step(58, 'COMPILING SHADERS…', () => {
      this.engine.renderer.compile(this.engine.scene, this.engine.camera);
    });
    await step(76, 'ARMING OPTICS…');
    await step(92, 'READY');

    this.engine.start();
    this.ui.show('main', {}, { silent: true, resetStack: true });
    setTimeout(() => {
      boot.classList.add('hide');
      setTimeout(() => boot.remove(), 700);
    }, 240);
    window.__ready = true;
  }

  // -------------------------------------------------------------------------
  // menu presentation
  // -------------------------------------------------------------------------
  loadMenuMap(key) {
    const map = getMap(key);
    this.world = this.worldRenderer.build(map);
    this.menuMap = map;
    this.viewmodel.setEnvironment(this.engine.scene.environment);
    audio.setWorld(this.world);
    const spots = map.spawns.ffa;
    this.menuCam.spots = spots;
    this.menuCam.index = 0;
    this.menuCam.t = 0;
  }

  setMenuCamera(on) { this.menuCamActive = on; }

  updateMenuCamera(dt) {
    const cam = this.engine.camera;
    const mc = this.menuCam;
    mc.t += dt;
    const spots = mc.spots || [];
    if (!spots.length) return;
    const dwell = 11;
    const i = Math.floor(mc.t / dwell) % spots.length;
    const f = (mc.t % dwell) / dwell;
    const s = spots[i];
    const yaw = s.yaw + Math.sin(f * Math.PI * 0.6) * 0.32 - 0.16;
    const eye = s.p[1] + 1.62 + Math.sin(mc.t * 0.4) * 0.03;
    cam.position.set(
      s.p[0] + Math.sin(mc.t * 0.25) * 0.35,
      eye,
      s.p[2] + Math.cos(mc.t * 0.2) * 0.35
    );
    cam.rotation.set(-0.02 + Math.sin(mc.t * 0.33) * 0.018, yaw, Math.sin(mc.t * 0.21) * 0.012, 'YXZ');
    this.engine.updateSun(cam.position);
    this.engine.postCtx.yawRate = Math.cos(mc.t * 0.25) * 8;
    this.engine.postCtx.pitchRate = 0;
    this.engine.postCtx.indoor = !!this.worldRenderer.zoneAt(cam.position.x, cam.position.y, cam.position.z);
  }

  /** Loadout screen: float the selected weapon in front of the camera. */
  previewWeapon(def) {
    if (this.previewGroup) {
      this.viewmodel.scene.remove(this.previewGroup);
      this.previewGroup = null;
    }
    this.viewmodel.setPreviewLighting(!!def);
    if (!def) return;
    const model = buildWeaponModel(def, def.attached || []);
    const holder = new THREE.Group();
    holder.add(model.root);
    model.root.position.set(0.02, -0.30, -0.82);
    model.root.rotation.set(0.10, -0.62, 0.05);
    holder.scale.setScalar(1.35);
    this.viewmodel.setAspect(this.engine.camera.aspect);
    this.viewmodel.scene.add(holder);
    this.previewGroup = holder;
  }

  // -------------------------------------------------------------------------
  // matchmaking
  // -------------------------------------------------------------------------
  loadout() {
    return {
      primary: S.loadout.primary,
      secondary: S.loadout.secondary,
      primaryAttachments: S.loadout.primaryAttachments || [],
      secondaryAttachments: S.loadout.secondaryAttachments || []
    };
  }

  async ensureOnline() {
    if (this.onlineNet && this.onlineNet.connected) return this.onlineNet;
    const net = new NetClient();
    this.attachNetHandlers(net);
    const url = S.serverUrl || NetClient.defaultUrl();
    try {
      await net.connect(url);
    } catch (e) {
      this.ui.toast('Could not reach the game server. Training mode still works offline.', 'err');
      throw e;
    }
    net.hello(S.name, this.loadout());
    this.onlineNet = net;
    return net;
  }

  async quickMatch(mode) {
    try {
      const net = await this.ensureOnline();
      this.ui.toast('Searching for a match…');
      net.quickMatch(mode);
    } catch (e) { /* toast already shown */ }
  }

  async joinRoom(id) {
    try { (await this.ensureOnline()).joinRoom(id); } catch (e) { /* ignore */ }
  }

  async joinCode(code) {
    try { (await this.ensureOnline()).joinCode(code); } catch (e) { /* ignore */ }
  }

  async createRoom(settingsObj) {
    try { (await this.ensureOnline()).createRoom(settingsObj); } catch (e) { /* ignore */ }
  }

  startRoom() { this.onlineNet?.startRoom(); }
  switchTeam() {
    const t = this.player.team === TEAM.ALPHA ? TEAM.BRAVO : TEAM.ALPHA;
    this.onlineNet?.setTeam(t);
  }

  leaveRoom() {
    this.onlineNet?.leave();
    this.roomInfo = null;
    this.ui.show('play', {}, { noStack: true });
  }

  async refreshServers() {
    try {
      const base = S.serverUrl
        ? S.serverUrl.replace(/^ws/, 'http').replace(/\/ws$/, '')
        : (location.port === '5173' ? `${location.protocol}//${location.hostname}:8787` : '');
      const res = await fetch(base + '/api/servers', { cache: 'no-store' });
      const data = await res.json();
      this.serverList = data.rooms || [];
      this.serverRegion = data.region;
    } catch (e) {
      this.serverList = [];
    }
    for (const fn of this.serverListeners) fn(this.serverList);
  }

  onServerList(fn) {
    this.serverListeners.add(fn);
    return () => this.serverListeners.delete(fn);
  }

  onRoomUpdate(fn) {
    this.roomListeners.add(fn);
    return () => this.roomListeners.delete(fn);
  }

  notifyRoom() { for (const fn of this.roomListeners) fn(this.roomInfo); }

  roomPlayers() { return this.roomPlayerList; }

  /** Plausible ping for a region, stable per session. */
  pingFor(region) {
    if (this.pingCache.has(region)) return this.pingCache.get(region);
    const base = { 'eu-west': 18, 'eu-north': 32, 'na-east': 92, 'na-west': 148, 'sa-east': 186, 'ap-se': 214, 'ap-ne': 232, oce: 268 }[region] ?? 80;
    const v = Math.max(4, Math.round(base + (Math.random() - 0.5) * base * 0.35));
    this.pingCache.set(region, v);
    return v;
  }

  // -------------------------------------------------------------------------
  startOffline(cfg) {
    audio.init();
    const net = new LocalNet({
      map: cfg.map, mode: cfg.mode, bots: cfg.bots ?? 5,
      botSkill: cfg.botSkill, name: S.name, loadout: this.loadout()
    });
    this.attachNetHandlers(net);
    this.net = net;
    net.begin();
  }

  attachNetHandlers(net) {
    net.on('joined', (msg) => this.onJoined(net, msg));
    net.on('snapshot', (snap) => this.onSnapshot(snap));
    net.on('ev', (msg) => this.onEvents(msg.v || []));
    net.on('match', (msg) => this.onMatchState(msg.state));
    net.on('matchStart', (msg) => {
      this.roomInfo = msg;
      if (msg.map && msg.map !== this.currentMap) this.enterMatch(msg);
      this.onMatchState(msg.state);
    });
    net.on('roomInfo', (msg) => { this.roomInfo = msg; this.notifyRoom(); });
    net.on('roomList', (msg) => {
      this.serverList = msg.rooms || [];
      for (const fn of this.serverListeners) fn(this.serverList);
    });
    net.on('playerJoined', (msg) => {
      this.ui.toast(`${msg.name} joined`);
      this.roomPlayerList = this.roomPlayerList.filter((p) => p.id !== msg.id);
      this.roomPlayerList.push({ id: msg.id, name: msg.name, team: msg.team });
      this.notifyRoom();
    });
    net.on('playerLeft', (msg) => {
      const p = this.remotes.get(msg.id);
      if (p) { p.dispose(); this.remotes.delete(msg.id); }
      this.roomPlayerList = this.roomPlayerList.filter((x) => x.id !== msg.id);
      this.notifyRoom();
    });
    net.on('error', (msg) => this.ui.toast(msg.message || 'Server error', 'err'));
    net.on('chat', (msg) => this.ui.toast(`${msg.from}: ${msg.text}`));
    net.on('left', () => { this.roomInfo = null; });
    bus.on('net:close', () => {
      if (this.mode === 'match' && this.net === this.onlineNet) {
        this.ui.toast('Connection lost', 'err');
        this.toMenu();
      }
    });
  }

  onJoined(net, msg) {
    this.net = net;
    this.playerId = msg.you ?? net.id;
    this.player.id = this.playerId;
    this.player.team = msg.team ?? 0;
    this.roomInfo = msg;
    this.roomPlayerList = (msg.state?.board || []).map((r) => ({ id: r.id, name: r.name, team: r.team, bot: r.bot }));
    this.notifyRoom();
    if (msg.private && msg.phase === 'warmup' && !msg.offline) {
      this.ui.show('lobby', {}, { noStack: true });
      return;
    }
    this.enterMatch(msg);
    this.onMatchState(msg.state);
  }

  // -------------------------------------------------------------------------
  // match lifecycle
  // -------------------------------------------------------------------------
  enterMatch(info) {
    const mapKey = info.map || 'warehouse';
    this.currentMap = mapKey;
    const map = getMap(mapKey);
    this.world = this.worldRenderer.build(map);
    this.viewmodel.setEnvironment(this.engine.scene.environment);
    audio.setWorld(this.world);
    audio.stopMenuMusic();
    audio.startAmbience(map.ambientSounds);
    this.effects.clear();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.friendlyFire = !!info.friendlyFire;

    this.player.setLoadout(this.loadout());
    const spawn = map.spawns.ffa[0];
    this.player.spawn(spawn.p, spawn.yaw);
    this.player.canAct = true;

    this.mode = 'match';
    this.paused = false;
    this.menuCamActive = false;
    this.ui.hide();
    this.hud.show(true);
    this.hud.setWeapon(this.player.weapon);
    this.hud.setHealth(this.player.health);
    this.input.enabled = true;
    this.input.requestLock();
    if (!this.input.locked) this.hud.setPrompt('CLICK TO ENGAGE');
    bus.emit('match:enter', info);
  }

  pause() {
    if (this.mode !== 'match' || this.paused) return;
    this.paused = true;
    this.input.exitLock();
    this.ui.showRoot();
    this.ui.show('pause', {}, { noStack: true, resetStack: true });
    audio.setMuffle(0.55, false);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.ui.hide();
    this.input.requestLock();
    audio.setMuffle(0);
  }

  leaveMatch() {
    this.net?.leave?.();
    if (this.net && this.net !== this.onlineNet) this.net.disconnect?.();
    this.toMenu();
  }

  toMenu() {
    this.mode = 'menu';
    this.paused = false;
    this.net = null;
    this.hud.show(false);
    this.input.exitLock();
    this.input.enabled = false;
    audio.stopAmbience();
    audio.setMuffle(0, true);
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.effects.clear();
    this.loadMenuMap(MENU_MAPS[(Math.random() * MENU_MAPS.length) | 0]);
    this.menuCamActive = true;
    this.ui.showRoot();
    this.ui.show('main', {}, { resetStack: true });
    audio.startMenuMusic();
  }

  quit() {
    if (this.mode === 'match') { this.leaveMatch(); return; }
    this.ui.toast('Closing the session — you can close this tab now.', 'warn');
    audio.stopMenuMusic();
    audio.suspend();
    setTimeout(() => { window.close(); }, 400);
  }

  // -------------------------------------------------------------------------
  // network events
  // -------------------------------------------------------------------------
  onSnapshot(snap) {
    if (this.mode !== 'match' || !this.player.weapons.length) return;
    const serverTime = this.net?.offline ? performance.now() : Date.now() + (this.onlineNet?.serverTimeOffset || 0);
    this.player.applyServerState(snap.self, snap.ackSeq);

    const wasAlive = this.player.alive;
    const dead = !!(snap.self.flags & SF.DEAD);
    this.player.alive = !dead;
    if (dead && wasAlive) this.player.onDeath();
    if (!dead && !wasAlive) {
      this.player.alive = true;
      this.player.health = snap.self.health;
      this.player.damageFx = 0;
      audio.setMuffle(0);
    }
    if (!dead) {
      if (snap.self.health < this.player.health - 0.5) {
        // damage the client did not predict (falls, explosions)
        this.player.health = snap.self.health;
        bus.emit('hud:health', this.player.health);
      } else if (snap.self.health > this.player.health) {
        this.player.health = snap.self.health;
        bus.emit('hud:health', this.player.health);
      }
    }

    const seen = new Set();
    for (const p of snap.players) {
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        const info = this.roomPlayerList.find((x) => x.id === p.id);
        r = new RemotePlayer(p.id, this.engine.scene, { name: info?.name, team: p.team });
        this.remotes.set(p.id, r);
      }
      if (r.team !== p.team) r.setInfo({ team: p.team });
      r.push(p, serverTime);
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) { r.dispose(); this.remotes.delete(id); }
    }
  }

  onMatchState(state) {
    if (!state) return;
    this.matchState = state;
    this.roomPlayerList = (state.board || []).map((r) => ({ id: r.id, name: r.name, team: r.team, bot: r.bot }));
    if (state.phase === 'matchEnd' && this.mode === 'match' && !this._endShown) {
      this._endShown = true;
      this.input.exitLock();
      this.ui.showRoot();
      this.ui.show('end', { state }, { noStack: true, resetStack: true });
      this.hud.show(false);
    }
    if (state.phase !== 'matchEnd') this._endShown = false;
    if (this.scoreboardOpen) this.hud.toggleScoreboard(true, state);
  }

  onEvents(list) {
    // Room events keep arriving while we sit in the lobby; none of them may
    // touch match state that has not been built yet.
    if (this.mode !== 'match') return;
    for (const ev of list) {
      switch (ev.e) {
        case EV.SHOT: this.onRemoteShot(ev); break;
        case EV.IMPACT:
          if (ev.p) {
            this.effects.impact(ev.p, ev.n, ev.m, 1);
          }
          break;
        case EV.HIT:
          if (ev.a === this.playerId) {
            bus.emit('hud:hit', ev.k);
            audio.ui(ev.k ? 'accept' : 'tick');
            this.player.hits = (this.player.hits || 0) + 1;
          }
          break;
        case EV.DAMAGE:
          if (ev.v === this.playerId) {
            this.player.onDamage(ev.d, ev.dir, ev.z);
            this.hud.flashScreen(0.12);
          }
          break;
        case EV.KILL: this.onKill(ev); break;
        case EV.RELOAD: this.onRemoteReload(ev); break;
        case EV.SWITCH: break;
        case EV.SPAWN:
          if (ev.p === this.playerId) this.onSelfSpawn(ev);
          break;
        case EV.ROUND_START:
          bus.emit('hud:center', 'ROUND ' + ev.round, 'GET READY', 3);
          this.hud.setObjective('');
          break;
        case EV.ROUND_END: this.onRoundEnd(ev); break;
        case EV.PLANTED:
          bus.emit('hud:center', 'CHARGE PLANTED', 'SITE ' + ev.site, 3);
          this.hud.setObjective('CHARGE ARMED — SITE ' + ev.site);
          break;
        case EV.DEFUSED:
          bus.emit('hud:center', 'CHARGE DEFUSED', '', 3);
          this.hud.setObjective('');
          break;
        case EV.BOMB_TICK:
          if (ev.detonated) {
            this.hud.flashScreen(0.9);
            this.player.rig.addShake(3);
            audio.impact('metal', ev.pos, 1.6);
          }
          break;
        case EV.MATCH_END: break;
        default: break;
      }
    }
  }

  onRemoteShot(ev) {
    if (ev.p === this.playerId) return;
    const def = WEAPON_BY_ID[ev.w] || WEAPON_BY_ID[0];
    const pos = ev.o;
    const dir = ev.d;
    const dist = Math.hypot(
      pos[0] - this.engine.camera.position.x,
      pos[1] - this.engine.camera.position.y,
      pos[2] - this.engine.camera.position.z
    );
    if (dist > 110) {
      audio.distantShot(def.audio, pos, dist);
    } else {
      audio.gunshot(def.audio, pos, { suppressed: !!ev.sup });
    }
    // muzzle flash at the shooter
    const shooter = this.remotes.get(ev.p);
    if (shooter && dist < 90) {
      this.effects.flashes.flash(
        new THREE.Vector3(pos[0] + dir[0] * 0.35, pos[1] + dir[1] * 0.35, pos[2] + dir[2] * 0.35),
        def.pellets > 1 ? 1.4 : 1.0, !!ev.sup
      );
    }
    // tracer, and a supersonic crack if it passes close to us
    const hit = this.world?.raycast(pos[0], pos[1], pos[2], dir[0], dir[1], dir[2], 180);
    const travel = hit ? hit.distance : 180;
    if (dist < 140) {
      this.effects.tracers.fire(pos, dir, Math.min(def.muzzleVelocity, 640), travel, 0.014, 0xffd8a0);
    }
    const cam = this.engine.camera.position;
    const t = clamp((cam.x - pos[0]) * dir[0] + (cam.y - pos[1]) * dir[1] + (cam.z - pos[2]) * dir[2], 0, travel);
    const missBy = Math.hypot(pos[0] + dir[0] * t - cam.x, pos[1] + dir[1] * t - cam.y, pos[2] + dir[2] * t - cam.z);
    if (missBy < 3.2 && t > 2) {
      audio.bulletCrack([cam.x + dir[0] * 1.2, cam.y + dir[1] * 1.2, cam.z + dir[2] * 1.2], 1 - missBy / 3.2);
    }
  }

  onRemoteReload(ev) {
    if (ev.p === this.playerId) return;
    const r = this.remotes.get(ev.p);
    if (!r) return;
    const p = [r.render.x, r.render.y + 1.1, r.render.z];
    audio.mech('magOut', p, 0.8);
    setTimeout(() => audio.mech('magIn', p, 0.8), 600);
    if (ev.empty) setTimeout(() => audio.mech('boltRelease', p, 0.8), 1100);
  }

  onKill(ev) {
    const nameOf = (id) => {
      if (id === this.playerId) return S.name;
      const info = this.roomPlayerList.find((x) => x.id === id);
      return info?.name || this.remotes.get(id)?.name || 'OPERATOR';
    };
    const def = WEAPON_BY_ID[ev.w];
    bus.emit('hud:kill', {
      attacker: nameOf(ev.a), victim: nameOf(ev.v),
      weapon: def ? def.name : '', headshot: !!ev.hs, teamkill: !!ev.tk,
      mine: ev.a === this.playerId ? 'a' : ev.v === this.playerId ? 'v' : null
    });
    if (ev.v === this.playerId) {
      bus.emit('hud:center', 'YOU ARE DOWN', 'KILLED BY ' + nameOf(ev.a), 4);
    } else if (ev.a === this.playerId) {
      bus.emit('hud:hit', true);
    }
    const victim = this.remotes.get(ev.v);
    if (victim) audio.pain([victim.render.x, victim.render.y + 1.2, victim.render.z], 1);
  }

  onSelfSpawn(ev) {
    this.player.spawn([ev.x, ev.y, ev.z], ev.yaw);
    this.player.canAct = true;
    bus.emit('hud:center', '', '', 0);
    audio.setMuffle(0);
    if (!this.input.locked && !this.paused) this.input.requestLock();
  }

  onRoundEnd(ev) {
    const won = ev.winner === this.player.team;
    bus.emit('hud:center',
      ev.winner === 0 ? 'ROUND DRAW' : won ? 'ROUND WON' : 'ROUND LOST',
      `${ev.a} — ${ev.b}`, 4.5);
    this.hud.setObjective('');
  }

  // -------------------------------------------------------------------------
  onLoadoutChanged() {
    this.net?.setLoadout?.(this.loadout());
    if (this.mode === 'match') this.player.setLoadout(this.loadout());
  }

  onNameChanged() {
    if (this.hud?.unit) this.hud.unit.textContent = 'UNIT ' + S.name;
  }

  testGunshot() {
    audio.init();
    const w = resolveWeapon(WEAPON_BY_KEY[S.loadout.primary] || WEAPON_BY_KEY.m4a1, S.loadout.primaryAttachments);
    audio.gunshot(w.audio, [0, 0, 0], { own: true, suppressed: !!w.flags?.suppressed });
  }

  setScoreboard(open) {
    this.scoreboardOpen = open;
    this.hud.toggleScoreboard(open, this.matchState);
  }

  /** Targets used for local hit prediction (visual only). */
  remoteTargets() {
    const out = [];
    for (const r of this.remotes.values()) {
      if (r.render.dead) continue;
      out.push({
        id: r.id, x: r.render.x, y: r.render.y, z: r.render.z,
        yaw: r.render.yaw, height: r.height, team: r.team, alive: true
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  update(dt, time) {
    if (this.mode === 'menu') {
      if (this.menuCamActive !== false) this.updateMenuCamera(dt);
      this.worldRenderer.update(dt, time, this.engine.camera.position);
      this.effects.update(dt, this.engine.camera, this.world);
      if (this.previewGroup) {
        this.viewmodel.setAspect(this.engine.camera.aspect);
        this.previewGroup.rotation.y = Math.sin(time * 0.4) * 0.35;
        this.previewGroup.position.y = Math.sin(time * 0.8) * 0.008;
      }
      audio.updateListener(this.engine.camera, dt);
      return;
    }

    // --- match ------------------------------------------------------------
    this.net?.update(dt);
    if (!this.paused) this.player.update(dt, this.input);

    const serverTime = this.net?.offline ? performance.now() : Date.now() + (this.onlineNet?.serverTimeOffset || 0);
    const renderTime = serverTime - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      r.update(dt, renderTime, (rp, pos, vol) => {
        const surf = this.world?.supportY(pos[0], pos[1], pos[2], 0.34, 0.4).surface || 'concrete';
        audio.footstep(surf, pos, vol);
      });
    }

    this.worldRenderer.update(dt, time, this.engine.camera.position);
    this.effects.update(dt, this.engine.camera, this.world);
    this.engine.updateSun(this.engine.camera.position);
    audio.updateListener(this.engine.camera, dt);

    // reverb follows the space the listener is in
    const cam = this.engine.camera.position;
    const zone = this.worldRenderer.zoneAt(cam.x, cam.y, cam.z);
    audio.setSpace(zone ? zone.reverb : (this.worldRenderer.data?.env.reverb || 'outdoor'));

    const w = this.player.weapon;
    this.hud.update(dt, {
      spread: w ? w.spread : 2,
      ads: w ? w.adsT : 0,
      health: this.player.health,
      yaw: this.player.rig.yaw,
      lean: this.player.state.leanT,
      matchTime: time,
      net: this.net?.stats()
    });
    if (w) this.hud.setWeapon(w);
    if (this.matchState) {
      this.hud.timer.textContent = fmtClock(this.matchState.timeLeft);
      const s = this.matchState.scores || {};
      this.hud.scoreLine.children[0].textContent = String(s[1] ?? 0);
      this.hud.scoreLine.children[1].textContent = this.matchState.mode === 'ffa' ? 'FFA' : '—';
      this.hud.scoreLine.children[2].textContent = String(s[2] ?? 0);
      this.hud.modeLabel.textContent = `${this.matchState.modeName} · ${this.matchState.mapName}`;
      if (this.matchState.bomb?.planted) {
        this.hud.setObjective(`CHARGE ARMED · ${this.matchState.bomb.timer}s`);
      }
    }
  }
}

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
const game = new Game();
window.__game = game;
window.__W = WEAPON_BY_KEY;   // exposed for automated screenshots
game.boot().catch((e) => {
  console.error(e);
  const status = document.querySelector('#boot .boot-status');
  if (status) status.textContent = 'FAILED TO START — ' + e.message;
});
