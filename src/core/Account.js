// Local player account: level, lifetime stats per playlist, and the
// leave-penalty ladder that governs Standard.
//
// This lives in localStorage alongside the settings. It is deliberately
// client-side: there are no user accounts on the server, so this is a profile
// and a self-imposed penalty record rather than an authority. The server
// still owns everything that affects other players.

import { bus } from './EventBus.js';

const KEY = 'bp.account.v1';

// Escalating bans for abandoning a Standard match, in minutes. The count
// resets once a full day has passed since the first leave in the window, so
// a bad night does not follow you around forever.
export const LEAVE_PENALTIES_MIN = [1, 5, 10, 45, 60, 120];
export const LEAVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** XP needed to go from `level` to the next one. Grows, but not steeply. */
export function xpForLevel(level) {
  return 500 + (level - 1) * 250;
}

function emptyStats() {
  return { kills: 0, deaths: 0, matches: 0, wins: 0 };
}

function defaults() {
  return {
    createdAt: Date.now(),
    xp: 0,
    level: 1,
    stats: { quickmatch: emptyStats(), standard: emptyStats() },
    // leave ladder
    leaveCount: 0,
    leaveWindowStart: 0,
    banUntil: 0,
    // a Standard match abandoned mid-way, offered back on the next queue
    pendingReconnect: null
  };
}

class Account {
  constructor() {
    this.data = defaults();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...defaults(), ...JSON.parse(raw) };
      // stats sub-objects must survive a partial save from an older build
      for (const k of ['quickmatch', 'standard']) {
        this.data.stats[k] = { ...emptyStats(), ...(this.data.stats?.[k] || {}) };
      }
    } catch (e) { /* storage unavailable — a fresh profile is fine */ }
    this.expireLeaveWindow();
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }

  // --- level ---------------------------------------------------------------
  get level() { return this.data.level; }
  get xp() { return this.data.xp; }
  get xpToNext() { return xpForLevel(this.data.level); }
  get createdAt() { return this.data.createdAt; }

  addXp(amount) {
    if (!(amount > 0)) return;
    this.data.xp += Math.round(amount);
    let levelled = false;
    while (this.data.xp >= xpForLevel(this.data.level)) {
      this.data.xp -= xpForLevel(this.data.level);
      this.data.level++;
      levelled = true;
    }
    this.save();
    bus.emit('account:changed');
    if (levelled) bus.emit('account:levelUp', this.data.level);
  }

  // --- stats ---------------------------------------------------------------
  /** Only the two ranked-ish playlists are tracked; anything else is ignored. */
  statsFor(playlist) {
    return this.data.stats[playlist] || null;
  }

  kd(playlist) {
    const s = this.statsFor(playlist);
    if (!s) return 0;
    return s.deaths > 0 ? s.kills / s.deaths : s.kills;
  }

  recordMatch(playlist, { kills = 0, deaths = 0, won = false } = {}) {
    const s = this.statsFor(playlist);
    if (!s) return;
    s.kills += kills;
    s.deaths += deaths;
    s.matches += 1;
    if (won) s.wins += 1;
    this.save();
    bus.emit('account:changed');
  }

  // --- leave penalties -----------------------------------------------------
  /** Drop the leave count once the 24h window has fully elapsed. */
  expireLeaveWindow() {
    if (!this.data.leaveWindowStart) return;
    if (Date.now() - this.data.leaveWindowStart >= LEAVE_WINDOW_MS) {
      this.data.leaveCount = 0;
      this.data.leaveWindowStart = 0;
      this.save();
    }
  }

  /** Milliseconds of ban left, 0 when clear. */
  banRemainingMs() {
    this.expireLeaveWindow();
    return Math.max(0, (this.data.banUntil || 0) - Date.now());
  }

  get banned() { return this.banRemainingMs() > 0; }

  /**
   * Record abandoning a match. Quick Match carries no penalty at all; only
   * Standard escalates. Returns the ban length applied, in minutes (0 if none).
   */
  recordLeave(playlist) {
    if (playlist !== 'standard') return 0;
    this.expireLeaveWindow();
    if (!this.data.leaveWindowStart) this.data.leaveWindowStart = Date.now();
    const idx = Math.min(this.data.leaveCount, LEAVE_PENALTIES_MIN.length - 1);
    const minutes = LEAVE_PENALTIES_MIN[idx];
    this.data.leaveCount++;
    this.data.banUntil = Date.now() + minutes * 60 * 1000;
    this.save();
    bus.emit('account:changed');
    return minutes;
  }

  // --- reconnect -----------------------------------------------------------
  /** Remember a Standard match so it can be rejoined instead of re-queued. */
  setPendingReconnect(info) {
    this.data.pendingReconnect = info || null;
    this.save();
  }

  get pendingReconnect() { return this.data.pendingReconnect; }

  clearPendingReconnect() {
    this.data.pendingReconnect = null;
    this.save();
  }
}

export const account = new Account();

/** "3 MIN 20 S" style countdown, for ban timers. */
export function fmtDuration(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return m > 0 ? `${m}M ${String(s).padStart(2, '0')}S` : `${s}S`;
}
