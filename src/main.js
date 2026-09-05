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
import { PlayerModel } from './player/PlayerModel.js';
import { HUD } from './game/HUD.js';
import { FreeCam } from './game/FreeCam.js';
import { audio } from './audio/AudioEngine.js';
import { NetClient } from './net/NetClient.js';
import { LocalNet } from './net/LocalNet.js';
import { UI, el } from './ui/UI.js';
import { createMainMenu } from './ui/screens/MainMenu.js';
import { createPlayMenu, createServerBrowser, createPrivateMatch, createLobby, createTraining } from './ui/screens/Play.js';
import { createLoadout } from './ui/screens/Loadout.js';
import { createSettings } from './ui/screens/SettingsScreen.js';
import { createFriends, createPause, createEndMatch, createQueue, createProfile } from './ui/screens/Misc.js';
import { createBuyMenu } from './ui/screens/BuyMenu.js';
import { getMap, MAP_INFO, MAP_KEYS } from './shared/maps/index.js';
import { WEAPON_BY_ID, WEAPON_BY_KEY } from './shared/weapons.js';
import { resolveWeapon } from './shared/attachments.js';
import { buildWeaponModel, buildWorldWeapon } from './weapons/WeaponModels.js';
import { EV, SF } from './shared/protocol.js';
import { INTERP_DELAY_MS, SURFACE, TEAM, clamp, lerp } from './shared/constants.js';
import { surfaceMaterial, propMaterial, propGlassMaterial } from './render/Materials.js';
import { REGIONS, PLAYLISTS } from './shared/modes.js';
import { account, fmtDuration } from './core/Account.js';

const MENU_MAPS = ['warehouse', 'refinery', 'suburb', 'killhouse'];

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
    this.squadListeners = new Set();
    // Solo until the server says otherwise. The panel is drawn from this even
    // before a connection exists, so it always has something to show.
    this.squad = { id: 0, code: '', leaderId: -1, max: 4, members: [], local: true };
    this.pendingInvite = null;
    this.playerId = -1;
    this.friendlyFire = false;
    this.paused = false;
    this.menuCam = { t: 0, mapIndex: 0, from: new THREE.Vector3(), to: new THREE.Vector3() };
    this.previewGroup = null;
    this.scoreboardOpen = false;
    this.pingCache = new Map();
    this._accumNet = 0;
    // Cheat codes, entered from the main menu. Offline-only (see applyCheatCode).
    this.cheats = { walls: false, auto: false, aimbot: false };
    this.currentPlaylist = null;   // which playlist this match came from
    // --- economy (TDM) ---
    this.economy = null;           // { money, loadout, canBuy } from the server
    this.economyListeners = new Set();
    this.buyOpen = false;
    this.freeCam = null;           // spectator camera while dead

    this.ui = new UI(document.getElementById('ui-root'));
    this.hud = new HUD(document.getElementById('hud-root'), this);
    this.hud.show(false);

    // While the scope picture fills the screen the weapon model behind it is
    // just noise poking into the surround.
    bus.on('hud:scoped', (on) => { this.viewmodel.visible = !on; });

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
    u.register('queue', createQueue(this));
    u.register('profile', createProfile(this));
    u.register('buy', createBuyMenu(this));
  }

  bindInput() {
    bus.on('input:key', (code, down) => {
      if (!down) {
        if (code === S.binds.scoreboard) this.setScoreboard(false);
        if (code === S.binds.use) this.net?.sendEvent(this.matchState?.mode === 'snd' ? 'plant' : 'plant', { down: false });
        return;
      }
      if (code === 'Escape') { this.onEscape(); return; }
      // B is the buy key, the way it is everywhere else.
      if (code === 'KeyB' && this.mode === 'match' && this.economyMode && !this.buyOpen) {
        this.openBuyMenu();
        return;
      }
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

    // The AudioContext can't exist before a user gesture (browser autoplay
    // policy), so it — and everything that depends on it, including the
    // procedural sound warmup — used to only start once a match began,
    // which is exactly when you don't want a synth hitch. Kicking warmup()
    // off the moment the context becomes available, on the player's very
    // first click or keypress on the boot/menu screen, gives it the whole
    // time spent in menus to finish before a match ever starts.
    const startAudio = () => {
      audio.init();
      audio.applyVolumes();
      audio.warmup(Object.values(WEAPON_BY_KEY));
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
    if (this.buyOpen) { this.closeBuyMenu(); return; }
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

    await step(8, 'GENERATING MATERIALS…');
    await step(20, 'BUILDING GEOMETRY…', () => {
      this.loadMenuMap(MENU_MAPS[0]);
    });
    // Build and cache every map's brush/prop data up front. getMap() memoises,
    // so the first time a match loads one of these it is a cache read instead
    // of a full level build — that build was a visible freeze on map change.
    await step(40, 'SURVEYING SECTORS…', () => {
      for (const key of MAP_KEYS) getMap(key);
    });
    // Surface textures are generated procedurally and cached globally, so
    // building every one now means the first match on a map with a surface
    // the menu map lacks doesn't stop to synthesise it mid-load.
    await step(50, 'PRINTING SURFACES…', () => {
      this.preloadMaterials();
    });
    await step(62, 'FABRICATING WEAPONS…', () => {
      this.preloadWeaponModels();
    });
    await step(74, 'BRIEFING OPERATORS…', () => {
      this.preloadPlayerModels();
    });
    // Every menu screen's DOM is built once here rather than on the first
    // time it is opened — the interface is large enough that building a
    // screen mid-session was a visible hitch on the first navigation.
    await step(84, 'DRAWING INTERFACE…', () => {
      this.preloadScreens();
    });
    await step(92, 'COMPILING SHADERS…', () => {
      this.engine.renderer.compile(this.engine.scene, this.engine.camera);
    });
    await step(97, 'READY');

    this.engine.start();
    this.ui.show('main', {}, { silent: true, resetStack: true });
    setTimeout(() => {
      boot.classList.add('hide');
      setTimeout(() => boot.remove(), 700);
    }, 240);
    window.__ready = true;
  }

  /**
   * Build one first-person and one world-space copy of every weapon into a
   * throwaway scene and force the renderer to compile their shaders now,
   * so the FIRST time a player actually equips a gun — or the first enemy
   * carrying one walks into view — isn't the moment that pipeline gets
   * built. Geometry is disposed immediately after; only the compiled
   * shader programs stick around, cached by the renderer.
   */
  preloadWeaponModels() {
    const tmp = new THREE.Group();
    this.engine.scene.add(tmp);
    for (const w of Object.values(WEAPON_BY_KEY)) {
      const fp = buildWeaponModel(w, w.attachments || []);
      tmp.add(fp.root);
      tmp.add(buildWorldWeapon(w));
    }
    this.engine.renderer.compile(this.engine.scene, this.engine.camera);
    tmp.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    this.engine.scene.remove(tmp);
  }

  /**
   * Force every surface material — and therefore every procedural texture —
   * into the shared cache while the loading bar is still up.
   */
  preloadMaterials() {
    for (const surface of Object.values(SURFACE)) surfaceMaterial(surface);
    propMaterial();
    propGlassMaterial();
  }

  /**
   * Build the DOM for every menu screen up front. UI.show() lazily builds a
   * screen the first time it is opened, which meant the first visit to the
   * loadout or settings screen paid for hundreds of nodes at once.
   */
  preloadScreens() {
    for (const [name, screen] of this.ui.screens) {
      if (screen.node) continue;
      screen.node = el('div.screen', { id: 'screen-' + name });
      try { screen.build?.(screen.node, this.ui); } catch (e) {
        // A screen that cannot pre-build is not fatal: drop the half-built
        // node and let UI.show() build it again on demand.
        console.warn('[preload] screen', name, e);
        screen.node = null;
      }
    }
  }

  /**
   * Same idea for the character models: build one of each team's operator so
   * their materials and shader programs are compiled before the first enemy
   * or teammate spawns in, rather than hitching the frame they appear.
   */
  preloadPlayerModels() {
    const tmp = new THREE.Group();
    this.engine.scene.add(tmp);
    const models = [new PlayerModel(1), new PlayerModel(2)];
    for (const m of models) tmp.add(m.root);
    this.engine.renderer.compile(this.engine.scene, this.engine.camera);
    this.engine.scene.remove(tmp);
    for (const m of models) m.dispose();
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
    try {
      return await this.ensureOnlineQuiet();
    } catch (e) {
      this.ui.toast('Could not reach the game server. Training mode still works offline.', 'err');
      throw e;
    }
  }

  /** ensureOnline() without the failure toast, for background connections. */
  async ensureOnlineQuiet() {
    if (this.onlineNet && this.onlineNet.connected) return this.onlineNet;
    if (this._connecting) return this._connecting;
    const net = new NetClient();
    this.attachNetHandlers(net);
    const url = S.serverUrl || NetClient.defaultUrl();
    this._connecting = (async () => {
      try {
        await net.connect(url);
        net.hello(S.name, this.loadout());
        this.onlineNet = net;
        return net;
      } finally {
        this._connecting = null;
      }
    })();
    return this._connecting;
  }

  async quickMatch(mode) {
    try {
      const net = await this.ensureOnline();
      this.ui.toast('Searching for a match…');
      net.quickMatch(mode);
    } catch (e) { /* toast already shown */ }
  }

  /**
   * Enter matchmaking for a named playlist. The playlist decides which modes
   * are eligible, the win target, and whether bots may fill the lobby at all
   * — Quick Match and Standard are player-only, so they queue for humans
   * rather than padding the match out with bots.
   */
  async playPlaylist(key) {
    const pl = PLAYLISTS[key];
    if (!pl) return;

    // In a squad, only the leader deploys. Everyone else gets pulled in.
    if (!this.isSquadLeader) {
      this.ui.toast('Only the squad leader can start a match', 'warn');
      return;
    }

    // A leave penalty locks every playlist; private matches stay open.
    const ban = account.banRemainingMs();
    if (ban > 0) {
      this.ui.toast(
        `Leave penalty active — ${fmtDuration(ban)} remaining. Private matches only.`,
        'warn'
      );
      return;
    }

    // An abandoned Standard match is offered back before starting a new queue.
    const pending = account.pendingReconnect;
    if (key === 'standard' && pending && (pending.roomId || pending.code)) {
      this.ui.toast('Rejoining your Standard match…');
      account.clearPendingReconnect();
      this.currentPlaylist = 'standard';
      try {
        if (pending.code) await this.joinCode(pending.code);
        else await this.joinRoom(pending.roomId);
        return;
      } catch (e) { /* fall through to a fresh queue */ }
    }

    const mode = pl.modes[(Math.random() * pl.modes.length) | 0];
    this.currentPlaylist = pl.key;
    try {
      const net = await this.ensureOnline();
      // The player-only playlists wait for a full 8-player lobby before they
      // load in, rather than dropping into a half-empty match.
      this.ui.show('queue', { playlist: pl.key });
      net.quickMatch(mode, {
        playlist: pl.key,
        roundsToWin: pl.roundsToWin,
        bots: pl.bots,
        minPlayers: pl.minPlayers
      });
    } catch (e) { /* toast already shown */ }
  }

  /**
   * Toggle a cheat by code. Returns { ok, message } for the console to show.
   *
   * WALLS  — enemies draw through geometry.
   * AUTO   — pulls the trigger by itself when an enemy is under the crosshair.
   * AIMBOT — drags aim toward the nearest visible enemy, deliberately sloppy.
   *
   * All three only take effect in offline matches against bots. They are
   * ignored online: two of the three playlists exist specifically to put you
   * against real people, and an aimbot that worked there would be a cheating
   * tool rather than a cheat code.
   */
  applyCheatCode(code) {
    const map = { WALLS: 'walls', AUTO: 'auto', AIMBOT: 'aimbot' };
    const key = map[code];
    if (!key) return { ok: false, message: code ? 'UNKNOWN CODE' : 'CODE' };
    this.cheats[key] = !this.cheats[key];
    if (key === 'walls') this.applyWallhack(this.cheats.walls);
    return {
      ok: true,
      message: `${code} ${this.cheats[key] ? 'ON' : 'OFF'} · OFFLINE ONLY`
    };
  }

  /** Back out of matchmaking without any penalty — nothing has started yet. */
  cancelQueue() {
    this.currentPlaylist = null;
    this.lobbyStatus = null;
    this.onlineNet?.leave?.();
  }

  /**
   * Award XP and fold the result into the lifetime record. Only the two
   * player-only playlists count toward K/D — bot matches and private games
   * would make the number meaningless.
   */
  recordMatchResult({ won = false } = {}) {
    const pl = this.currentPlaylist;
    const kills = this.player.kills || 0;
    const deaths = this.player.deaths || 0;
    account.addXp(kills * 25 + (won ? 300 : 100));
    if (pl === 'standard' || pl === 'quickmatch') {
      account.recordMatch(pl, { kills, deaths, won });
    }
    account.clearPendingReconnect();
  }

  /** True only when this match is local bots, never online against people. */
  get cheatsActive() {
    return this.mode === 'match' && !!this.net?.offline;
  }

  /** Draw enemy models through walls (or stop doing so). */
  applyWallhack(on) {
    for (const r of this.remotes.values()) this.setSeeThrough(r, on);
  }

  setSeeThrough(remote, on) {
    remote.model?.root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.depthTest = !on;
        m.transparent = on ? true : m.transparent;
        m.opacity = on ? 0.85 : 1;
        m.needsUpdate = true;
      }
      o.renderOrder = on ? 900 : 0;
    });
  }

  async joinRoom(id) {
    if (!this.isSquadLeader) { this.ui.toast('Only the squad leader can start a match', 'warn'); return; }
    try { (await this.ensureOnline()).joinRoom(id); } catch (e) { /* ignore */ }
  }

  async joinCode(code) {
    if (!this.isSquadLeader) { this.ui.toast('Only the squad leader can start a match', 'warn'); return; }
    try { (await this.ensureOnline()).joinCode(code); } catch (e) { /* ignore */ }
  }

  async createRoom(settingsObj) {
    if (!this.isSquadLeader) {
      this.ui.toast('Only the squad leader can start a match', 'warn');
      return;
    }
    // Whoever is in your squad is dropped into the private room with you.
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

  // -------------------------------------------------------------------------
  // spectating
  // -------------------------------------------------------------------------
  startFreeCam() {
    if (this.freeCam) return;
    const cam = this.engine.camera;
    this.freeCam = new FreeCam(cam.position, this.player.rig.yaw, this.player.rig.pitch);
    this.viewmodel.visible = false;      // no floating gun while spectating
    this.hud.setPrompt('SPECTATING · WASD FLY · SPACE/CTRL UP DOWN · SHIFT FAST');
  }

  stopFreeCam() {
    if (!this.freeCam) return;
    this.freeCam = null;
    this.viewmodel.visible = true;
    this.hud.setPrompt('');
  }

  // -------------------------------------------------------------------------
  // economy (Team Deathmatch)
  // -------------------------------------------------------------------------
  /** True when this match runs the buy economy. */
  get economyMode() { return !!this.matchState?.economy; }

  onEconomy(fn) {
    this.economyListeners.add(fn);
    return () => this.economyListeners.delete(fn);
  }

  notifyEconomy() { for (const fn of this.economyListeners) fn(this.economy); }

  buy(what) { this.net?.buy?.(what); }

  /**
   * Adopt the kit and wallet the match says we have. In an economy match the
   * server owns both, so this is the only thing that may change the local
   * player's weapons — the menu loadout does not apply.
   */
  applyEconomy(ev) {
    const changed = JSON.stringify(ev.loadout) !== JSON.stringify(this.economy?.loadout);
    this.economy = { ...(this.economy || {}), money: ev.money, loadout: ev.loadout };
    if (changed && this.mode === 'match') {
      this.player.setLoadout(ev.loadout);
      bus.emit('hud:weapon', this.player.weapon);
    }
    this.notifyEconomy();
  }

  /** Seconds of buy time left, 0 once the round goes live. */
  buyTimeLeft() {
    const st = this.matchState;
    if (!st || st.phase !== 'freeze') return 0;
    return Math.max(0, st.timeLeft | 0);
  }

  openBuyMenu() {
    if (!this.economyMode || this.buyOpen) return;
    if (this.matchState?.phase !== 'freeze') {
      this.ui.toast('Buy time is over', 'warn');
      return;
    }
    this.buyOpen = true;
    this.paused = true;
    this.input.exitLock();
    this.ui.showRoot();
    this.ui.show('buy', {}, { noStack: true, resetStack: true });
  }

  closeBuyMenu() {
    if (!this.buyOpen) return;
    this.buyOpen = false;
    this.paused = false;
    this.ui.hide();
    this.input.requestLock();
  }

  /** Spin the operator model on the buy screen. */
  setBuyPreview(on) {
    this.buyPreview = on;
  }

  // -------------------------------------------------------------------------
  // squad
  // -------------------------------------------------------------------------
  onSquadUpdate(fn) {
    this.squadListeners.add(fn);
    return () => this.squadListeners.delete(fn);
  }

  notifySquad() { for (const fn of this.squadListeners) fn(this.squad); }

  /** The squad as the UI wants it: always four slots, you always present. */
  squadSlots() {
    const members = this.squad?.members?.length
      ? this.squad.members
      : [{ id: this.onlineNet?.id ?? -1, name: S.name, leader: true }];
    const slots = [];
    for (let i = 0; i < (this.squad?.max || 4); i++) slots.push(members[i] || null);
    return slots;
  }

  /** True when you are the one allowed to start a match. */
  get isSquadLeader() {
    const sq = this.squad;
    if (!sq || sq.members.length < 2) return true;
    return sq.leaderId === (this.onlineNet?.id ?? -1);
  }

  /**
   * Connect quietly so squad invites can arrive while you sit in the menu.
   * Unlike ensureOnline() this never toasts — an offline player just keeps a
   * solo squad panel rather than being told off for having no server.
   */
  async connectForSquad() {
    if (this.onlineNet?.connected) { this.onlineNet.squadInfo(); return this.onlineNet; }
    // Back off after a failure. Without this, every trip back to the main
    // menu fired another doomed WebSocket at a server that isn't there.
    if (this._squadConnectFailedAt && Date.now() - this._squadConnectFailedAt < 30000) return null;
    try {
      const net = await this.ensureOnlineQuiet();
      net.squadInfo();
      this._squadConnectFailedAt = 0;
      return net;
    } catch (e) {
      this._squadConnectFailedAt = Date.now();
      return null;
    }
  }

  async squadInvite(name) {
    const net = await this.connectForSquad();
    if (!net) { this.ui.toast('Not connected — invites need the game server', 'warn'); return; }
    net.squadInvite(String(name || '').toUpperCase());
  }

  async squadJoin(code) {
    const net = await this.connectForSquad();
    if (!net) { this.ui.toast('Not connected — invites need the game server', 'warn'); return; }
    net.squadJoin(String(code || '').toUpperCase());
    this.pendingInvite = null;
  }

  squadLeave() {
    if (!this.onlineNet?.connected) return;
    this.onlineNet.squadLeave();
  }

  squadKick(id) {
    if (!this.onlineNet?.connected) return;
    this.onlineNet.squadKick(id);
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
      this.lobbyStatus = null;
      // Load in whenever we are not already standing in this match. Comparing
      // the map alone was not enough: queueing from the menu into a room on
      // the same map as the last match skipped the load and left you sitting
      // on the matchmaking screen forever.
      if (msg.map && (this.mode !== 'match' || msg.map !== this.currentMap)) this.enterMatch(msg);
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
      // Show it in the kill feed the same way a death is shown.
      if (this.mode === 'match' && msg.name) {
        bus.emit('hud:kill', { left: true, text: `${msg.name} HAS LEFT THE GAME` });
      }
    });
    // Player-only playlists hold in a queue until the lobby is full.
    net.on('lobbyStatus', (msg) => {
      this.lobbyStatus = msg;
      this.notifyRoom();
    });
    net.on('economy', (msg) => this.applyEconomy(msg));
    net.on('buyResult', (msg) => {
      if (msg.economy) { this.economy = msg.economy; this.notifyEconomy(); }
      if (!msg.ok && msg.reason === 'too_poor') this.ui.toast('Not enough money', 'warn');
      if (msg.ok) bus.emit('hud:weapon', this.player.weapon);
    });
    net.on('squad', (msg) => {
      this.squad = { ...msg, local: false };
      for (const fn of this.squadListeners) fn(this.squad);
    });
    net.on('squadInvite', (msg) => {
      this.pendingInvite = { from: msg.from, code: msg.code, at: Date.now() };
      this.ui.toast(`${msg.from} invited you to their squad — open FRIENDS to accept`);
      for (const fn of this.squadListeners) fn(this.squad);
    });
    net.on('squadInviteSent', (msg) => this.ui.toast(`Invite sent to ${msg.name}`));
    net.on('error', (msg) => this.ui.toast(msg.message || 'Server error', 'err'));
    net.on('chat', (msg) => this.ui.toast(`${msg.from}: ${msg.text}`));
    net.on('left', () => { this.roomInfo = null; });
    bus.on('net:close', () => {
      this.squad = { id: 0, code: '', leaderId: -1, max: 4, members: [], local: true };
      this.pendingInvite = null;
      this.notifySquad();
      if (this.mode === 'match' && this.net === this.onlineNet) {
        this.ui.toast('Connection lost', 'err');
        this.toMenu();
      }
    });
  }

  onJoined(net, msg) {
    this.net = net;
    // Adopt the wallet and kit before enterMatch() builds the weapons, or the
    // first round of an economy match starts with the menu loadout instead.
    if (msg.economy) this.economy = msg.economy;
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
    // A queued playlist room holds in warmup until it has eight humans. Sit
    // on the matchmaking screen rather than loading into a near-empty map —
    // 'matchStart' brings everyone in together once the lobby fills.
    if (msg.minPlayers > 0 && msg.phase === 'warmup' && !msg.offline) {
      this.currentPlaylist = this.currentPlaylist || 'quickmatch';
      this.lobbyStatus = { have: msg.players || 1, need: msg.minPlayers, ready: false };
      this.ui.showRoot();
      this.ui.show('queue', { playlist: this.currentPlaylist }, { noStack: true });
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
    audio.warmup(Object.values(WEAPON_BY_KEY));
    this.effects.clear();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.friendlyFire = !!info.friendlyFire;

    // In an economy match the kit comes from the server (see applyEconomy),
    // so the menu loadout must not be applied here — it would hand you a free
    // rifle for the first moment of every round.
    //
    // Read it off the incoming info rather than this.matchState: enterMatch()
    // runs before onMatchState() on a fresh join, so the economy flag is not
    // on matchState yet and the check would silently fall through to the
    // menu loadout.
    const isEconomy = !!(info.state?.economy ?? this.matchState?.economy);
    if (!isEconomy) this.economy = null;
    this.player.setLoadout(isEconomy && this.economy?.loadout
      ? this.economy.loadout
      : this.loadout());
    // Placeholder spawn until the authoritative SPAWN event lands: pick the
    // right pool for the assigned team so the camera starts facing roughly
    // the way the real spawn will, instead of the map's FFA pool regardless
    // of mode. Using the wrong pool here (e.g. FFA's pos/yaw in a team mode)
    // left the camera looking one way while the corrected authoritative
    // position sat behind it, so "forward" briefly ran you backward until
    // the real spawn event corrected the camera a moment later.
    const pool = this.player.team === TEAM.ALPHA && map.spawns.alpha.length ? map.spawns.alpha
      : this.player.team === TEAM.BRAVO && map.spawns.bravo.length ? map.spawns.bravo
      : map.spawns.ffa;
    const spawn = pool[(Math.random() * pool.length) | 0];
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

  /**
   * Leave the current match.
   *
   * Quick Match is free to leave. Standard is not: abandoning one records a
   * leave and starts an escalating ban (1/5/10/45/60/120 minutes), during
   * which only private matches are available, and the count resets a day
   * after the first leave. A Standard match is also remembered so it can be
   * rejoined rather than re-queued.
   */
  leaveMatch() {
    const playlist = this.currentPlaylist;
    if (this.mode === 'match' && playlist) {
      if (playlist === 'standard') {
        account.setPendingReconnect({
          roomId: this.roomInfo?.id || null,
          code: this.roomInfo?.code || null,
          at: Date.now()
        });
        const mins = account.recordLeave('standard');
        if (mins > 0) {
          this.ui.toast(
            `Left a Standard match — ${mins} minute penalty. Private matches only until it expires.`,
            'warn'
          );
        }
      } else {
        // Quick Match: no penalty, and nothing to come back to.
        account.clearPendingReconnect();
      }
    }
    this.currentPlaylist = null;
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
    // The wallet rides along on the owner's own snapshot, so it stays live
    // between buys without a message of its own.
    if (snap.self && snap.self.money !== undefined && snap.self.money !== this.economy?.money) {
      this.economy = { ...(this.economy || {}), money: snap.self.money };
      this.notifyEconomy();
    }
    const serverTime = this.net?.offline ? performance.now() : Date.now() + (this.onlineNet?.serverTimeOffset || 0);
    this.player.applyServerState(snap.self, snap.ackSeq);

    const wasAlive = this.player.alive;
    const dead = !!(snap.self.flags & SF.DEAD);
    this.player.alive = !dead;
    if (dead && wasAlive) {
      this.player.onDeath();
      // No respawn until the round ends, so hand the player a camera to fly
      // rather than a corpse to stare at.
      if (!this.matchState || this.matchState.mode !== 'ffa') this.startFreeCam();
    }
    if (!dead && !wasAlive) {
      this.stopFreeCam();
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
        // a newly-seen enemy has to pick up the wallhack state too
        if (this.cheats.walls && this.cheatsActive) this.setSeeThrough(r, true);
      }
      if (r.team !== p.team) r.setInfo({ team: p.team });
      r.push(p, serverTime);
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) { r.dispose(); this.remotes.delete(id); }
    }
  }

  onMatchState(state) {
    const prevPhase = this.matchState?.phase;
    if (state?.economy) {
      // Rounds hand out new kit; make sure the client has it even if the
      // per-player event was missed.
      if (state.phase === 'freeze' && prevPhase !== 'freeze') this.net?.requestEconomy?.();
      // Freeze time in an economy match means buy time: put the menu up the
      // moment the round starts rather than making people find a key for it.
      if (state.phase === 'freeze' && prevPhase !== 'freeze' && this.mode === 'match') {
        setTimeout(() => this.openBuyMenu(), 60);
      }
      if (state.phase !== 'freeze' && this.buyOpen) this.closeBuyMenu();
    }
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
        case EV.ECONOMY:
          // Only our own kit matters here; everyone else's arrives as the
          // weapon id on their snapshot.
          if (ev.p === this.playerId) this.applyEconomy(ev);
          break;
        case EV.IMPACT:
          if (ev.p) {
            this.effects.impact(ev.p, ev.n, ev.m, 1);
          }
          break;
        case EV.HIT:
          // Blood is drawn here and only here — off the authoritative hit —
          // so seeing blood always means damage was actually dealt, whether
          // it came out of an enemy or out of you.
          if (ev.p) this.effects.bloodMist(ev.p, ev.dir || [0, 0, 1]);
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
    const cx = pos[0] + dir[0] * t, cy = pos[1] + dir[1] * t, cz = pos[2] + dir[2] * t;
    const missBy = Math.hypot(cx - cam.x, cy - cam.y, cz - cam.z);
    // The closest-approach point being near the camera is only a "near miss"
    // if nothing solid is actually between them — otherwise a shot fired in
    // an entirely different room, on the other side of a wall, could still
    // mathematically pass close to the player's position and play a
    // supersonic crack with no visible cause.
    if (missBy < 3.2 && t > 2) {
      const toClosest = missBy || 0.001;
      const blocked = this.world?.raycast(
        cam.x, cam.y, cam.z, (cx - cam.x) / toClosest, (cy - cam.y) / toClosest, (cz - cam.z) / toClosest,
        Math.max(0, toClosest - 0.15)
      );
      if (!blocked) {
        audio.bulletCrack([cam.x + dir[0] * 1.2, cam.y + dir[1] * 1.2, cam.z + dir[2] * 1.2], 1 - missBy / 3.2);
      }
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
    // The buy menu is the only way to change kit in an economy match.
    if (this.economyMode) return;
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
    if (this.freeCam && !this.paused) {
      // Dead and flying: the spectator camera owns the mouse and the camera,
      // and the player simulation is left alone entirely.
      const m = this.input.takeMouse();
      if (this.input.locked) this.freeCam.look(m.dx, m.dy);
      this.freeCam.update(dt, this.input);
      this.freeCam.applyTo(this.engine.camera);
      this.engine.postCtx.yawRate = 0;
      this.engine.postCtx.pitchRate = 0;
    } else if (!this.paused) {
      this.player.update(dt, this.input);
    }

    const serverTime = this.net?.offline ? performance.now() : Date.now() + (this.onlineNet?.serverTimeOffset || 0);
    const renderTime = serverTime - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      r.update(dt, renderTime, (rp, pos, vol) => {
        const surf = this.world?.supportY(pos[0], pos[1], pos[2], 0.34, 0.4).surface || 'concrete';
        audio.footstep(surf, pos, vol);
      });
      r.updateMarker(this.player.team, dt);
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
      // Only a telescopic scope takes over the whole screen; every other
      // sight is looked through on the weapon model itself.
      scoped: !!w?.def?.flags?.scoped,
      moving: this.player.state.speed > 0.4,
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
window.__buildWeaponModel = buildWeaponModel;   // ditto: geometry measurements
window.__settings = settings;                  // ditto: loadout assertions
game.boot().catch((e) => {
  console.error(e);
  const status = document.querySelector('#boot .boot-status');
  if (status) status.textContent = 'FAILED TO START — ' + e.message;
});
