// In-game HUD.  Deliberately sparse: ammo, a health bar, the round clock and
// a killfeed.  Hit feedback is a 4-pixel tick, not a giant X — the bodycam
// chrome (timecode, REC dot, battery, unit ID) does the rest of the work.

import { el, clear, fmtTime, pingClass } from '../ui/UI.js';
import { bus } from '../core/EventBus.js';
import { S } from '../core/Settings.js';
import { perf } from '../core/Perf.js';
import { clamp } from '../shared/constants.js';

export class HUD {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.build();
    this.hitTimer = 0;
    this.killTimer = 0;
    this.dmgDirs = [];
    this.killfeedItems = [];
    this.spread = 6;
    this.lastHealth = 100;
    this.flashT = 0;
    this.hurtT = 0;
    this.bind();
  }

  build() {
    const r = this.root;
    clear(r);

    // crosshair
    this.crosshair = el('div.crosshair',
      el('i.ch-t'), el('i.ch-b'), el('i.ch-l'), el('i.ch-r'), el('i.ch-d'));
    this.hitmark = el('div.hitmark', el('i'), el('i'));
    this.hitmark.innerHTML =
      '<i style="width:2px;height:9px;left:-1px;top:-11px"></i>' +
      '<i style="width:2px;height:9px;left:-1px;top:2px"></i>' +
      '<i style="width:9px;height:2px;left:-11px;top:-1px"></i>' +
      '<i style="width:9px;height:2px;left:2px;top:-1px"></i>';

    // bodycam chrome
    this.tc = el('div.tc', '00:00:00:00');
    this.batt = el('div.batt', 'BATT 87%');
    this.unit = el('div.unit', 'UNIT ' + (S.name || 'OPERATOR'));
    this.bodycam = el('div.bodycam-hud',
      this.tc, this.unit,
      el('div.rec2', el('i'), 'REC'),
      this.batt);

    // ammo / weapon
    this.ammo = el('div.ammo', '30', el('small', ' / 180'));
    this.wname = el('div.wname', 'M4A1');
    this.wmode = el('div.wmode', 'AUTO · MRDS');
    this.br = el('div.hud-br', this.ammo, this.wname, this.wmode);

    // health
    this.hpNum = el('div.hp-num', '100');
    this.hpBar = el('div.health-bar', el('i', { style: { width: '100%' } }));
    this.bl = el('div.hud-bl', el('div.health-wrap',
      el('div.wname', 'VITALS'), this.hpNum, this.hpBar));

    // top centre: clock + score
    this.timer = el('div.timer', '—:—');
    this.scoreLine = el('div.score-line',
      el('span.a', '0'), el('span.dim', '—'), el('span.b', '0'));
    this.modeLabel = el('div.mode-label', '');
    this.tc2 = el('div.hud-tc', this.timer, this.scoreLine, this.modeLabel);

    // net / perf
    this.netgraph = el('div.netgraph');
    this.tr = el('div.hud-tr', this.netgraph);

    this.killfeed = el('div.killfeed');
    this.dmgWrap = el('div.dmg-dirs');
    this.center = el('div.center-msg', { style: { display: 'none' } },
      el('div.big', ''), el('div.small', ''));
    this.objective = el('div.obj-banner', { style: { display: 'none' } });
    this.plantBar = el('div.plant-bar', { style: { display: 'none' } }, el('i'));
    this.hurtVig = el('div.hurt-vig');
    this.flash = el('div.flash-overlay');
    this.leanInd = el('div.lean-ind', 'LEAN');

    this.prompt = el('div.center-msg', {
      style: { display: 'none', top: '58%' }
    }, el('div.big', ''), el('div.small', 'MOUSE LOOK REQUIRES POINTER LOCK'));

    this.scoreboard = el('div#scoreboard', { hidden: true });

    r.appendChild(this.bodycam);
    // Scope picture. Only the M40's telescopic scope raises this; every other
    // sight is looked through on the weapon model itself. The surround is one
    // huge box-shadow rather than an image, so it fills any aspect ratio.
    this.scope = el('div.scope', { style: { display: 'none' } },
      el('div.scope-shade'),
      el('div.scope-ring',
        el('div.scope-glass'),
        el('div.scope-cross-v'),
        el('div.scope-cross-h'),
        el('div.scope-mil'),
        el('div.scope-numbers', '2  4  6  8  10')));
    r.appendChild(this.scope);
    r.appendChild(this.crosshair);
    r.appendChild(this.hitmark);
    r.appendChild(this.br);
    r.appendChild(this.bl);
    r.appendChild(this.tc2);
    r.appendChild(this.tr);
    r.appendChild(this.killfeed);
    r.appendChild(this.dmgWrap);
    r.appendChild(this.objective);
    r.appendChild(this.plantBar);
    r.appendChild(this.center);
    r.appendChild(this.prompt);
    r.appendChild(this.hurtVig);
    r.appendChild(this.flash);
    r.appendChild(this.leanInd);
    r.appendChild(this.scoreboard);
  }

  bind() {
    bus.on('hud:weapon', (w) => this.setWeapon(w));
    bus.on('hud:health', (h) => this.setHealth(h));
    bus.on('hud:damage', (dir) => this.addDamageDir(dir));
    bus.on('hud:hit', (killed) => this.hitMarker(killed));
    bus.on('hud:kill', (feed) => this.addKillfeed(feed));
    bus.on('hud:center', (big, small, time) => this.centerMessage(big, small, time));
    bus.on('hud:objective', (text) => this.setObjective(text));
  }

  setWeapon(w) {
    if (!w) return;
    const d = w.def;
    // A blade has no magazine and no reserve, so it gets no ammo counter —
    // showing "1 / 1" over a knife was the last thing making it read as a gun
    // you happen to be holding backwards.
    if (d.melee) {
      this.ammo.firstChild.nodeValue = '—';
      this.ammo.querySelector('small').textContent = '';
      this.ammo.classList.remove('low', 'empty');
    } else {
      this.ammo.firstChild.nodeValue = String(w.ammo);
      this.ammo.querySelector('small').textContent = ` / ${w.reserve}`;
      this.ammo.classList.toggle('low', w.ammo <= d.magSize * 0.25 && w.ammo > 0);
      this.ammo.classList.toggle('empty', w.ammo === 0);
    }
    this.wname.textContent = d.name;
    const att = (d.attached || []).map((a) => a.toUpperCase()).join(' · ');
    const action = d.melee ? 'MELEE' : d.auto ? 'AUTO' : d.pumpTime ? 'BOLT' : 'SEMI';
    this.wmode.textContent = action + (att ? ' · ' + att : '');
  }

  setHealth(h) {
    const v = clamp(h, 0, 100);
    if (v < this.lastHealth) this.hurtT = 0.65;
    this.lastHealth = v;
    this.hpNum.textContent = String(Math.round(v));
    const bar = this.hpBar.firstChild;
    bar.style.width = `${v}%`;
    this.hpBar.classList.toggle('hurt', v <= 60 && v > 30);
    this.hpBar.classList.toggle('crit', v <= 30);
  }

  hitMarker(killed) {
    this.hitTimer = killed ? 0.5 : 0.28;
    this.hitmark.classList.toggle('kill', !!killed);
    this.hitmark.style.opacity = '1';
    this.hitmark.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${killed ? 1.5 : 1.15})`;
  }

  addDamageDir(dir) {
    if (!dir) return;
    const node = el('div.dmg-dir');
    this.dmgWrap.appendChild(node);
    this.dmgDirs.push({ node, life: 1.5, dir });
  }

  addKillfeed({ attacker, victim, weapon, headshot, teamkill, mine, left, text }) {
    // A player leaving shows up here too, as a plain single-line notice
    // rather than an attacker/victim pair.
    if (left) {
      const n = el('div.kf', el('span.dim', text || 'A PLAYER HAS LEFT THE GAME'));
      this.killfeed.appendChild(n);
      this.killfeedItems.push({ node: n, life: 6 });
      while (this.killfeedItems.length > 5) this.killfeedItems.shift().node.remove();
      return;
    }
    const node = el('div.kf',
      el('span', { class: mine === 'a' ? 'me' : '' }, attacker),
      el('span.dim', headshot ? ' ⌖ ' : ' › '),
      el('span', { class: mine === 'v' ? 'me' : '' }, victim),
      weapon ? el('span.dim', '  ' + weapon) : null);
    if (headshot) node.classList.add('hs');
    if (teamkill) node.style.borderRightColor = 'var(--danger)';
    this.killfeed.appendChild(node);
    this.killfeedItems.push({ node, life: 6 });
    while (this.killfeedItems.length > 5) {
      const old = this.killfeedItems.shift();
      old.node.remove();
    }
  }

  centerMessage(big, small, time = 2.5) {
    this.center.style.display = big || small ? 'block' : 'none';
    this.center.children[0].textContent = big || '';
    this.center.children[1].textContent = small || '';
    this.centerT = time;
  }

  setObjective(text) {
    this.objective.style.display = text ? 'block' : 'none';
    this.objective.textContent = text || '';
  }

  setPlantProgress(p) {
    this.plantBar.style.display = p > 0 ? 'block' : 'none';
    this.plantBar.firstChild.style.width = `${clamp(p, 0, 1) * 100}%`;
  }

  flashScreen(amount = 0.5) { this.flashT = amount; }

  /** Persistent prompt (e.g. "CLICK TO ENGAGE" before pointer lock). */
  setPrompt(text) {
    this.prompt.style.display = text ? 'block' : 'none';
    this.prompt.children[0].textContent = text || '';
  }

  toggleScoreboard(show, state) {
    this.scoreboard.hidden = !show;
    if (!show || !state) return;
    clear(this.scoreboard);
    const teams = state.mode !== 'ffa';
    const mk = (rows, label, cls) => el('div',
      label ? el('div.sb-team.' + cls, label) : null,
      el('table.list',
        el('thead', el('tr',
          el('th', 'Operator'), el('th', 'K'), el('th', 'D'), el('th', 'Dmg'),
          el('th', 'Acc'), el('th', 'Score'), el('th', 'Ping'))),
        el('tbody', ...rows.map((r) => el('tr' + (r.id === this.game.playerId ? '.row.sel' : ''),
          el('td', r.name, r.bot ? el('span.dim', ' · BOT') : null, r.alive ? null : el('span.dim', ' · DOWN')),
          el('td', String(r.kills)), el('td', String(r.deaths)),
          el('td', String(r.damage)), el('td', r.acc + '%'), el('td', String(r.score)),
          el('td', { class: 'ping ' + pingClass(r.ping) }, r.bot ? '—' : r.ping))))));

    const board = state.board || [];
    const body = teams
      ? el('div', mk(board.filter((r) => r.team === 1), `ALPHA — ${state.scores[1]}`, 'a'),
        mk(board.filter((r) => r.team === 2), `BRAVO — ${state.scores[2]}`, 'b'))
      : mk(board, null, 'a');

    this.scoreboard.appendChild(el('div.sb-wrap',
      el('div.sb-head',
        el('div.sb-title', state.mapName || ''),
        el('div.mono.dim', `${state.modeName} · ${fmtTime(state.timeLeft)}`)),
      body));
  }

  /** Per-frame: crosshair spread, fades, timers, telemetry. */
  update(dt, ctx) {
    // crosshair follows the weapon's real spread cone
    const target = ctx.spread !== undefined ? 3 + ctx.spread * 7.5 : this.spread;
    this.spread += (target - this.spread) * (1 - Math.exp(-14 * dt));
    const g = Math.round(this.spread);
    const c = this.crosshair;
    c.children[0].style.transform = `translateY(${-g - 7}px)`;
    c.children[1].style.transform = `translateY(${g}px)`;
    c.children[2].style.transform = `translateX(${-g - 7}px)`;
    c.children[3].style.transform = `translateX(${g}px)`;
    c.style.opacity = ctx.ads > 0.6 ? '0' : String(1 - ctx.ads * 0.9);

    // Scoped sights swap the whole view for the scope picture once the aim has
    // mostly settled. Below that the weapon model is still swinging up, and
    // cutting to the scope early looks like a teleport rather than a mount.
    const scoped = !!ctx.scoped && ctx.ads > 0.72;
    if (scoped !== this._scoped) {
      this._scoped = scoped;
      this.scope.style.display = scoped ? 'block' : 'none';
      bus.emit('hud:scoped', scoped);
    }
    if (scoped) {
      // A touch of drift so the picture is not dead still, scaled by how much
      // the operator is moving.
      const t = performance.now() / 1000;
      const sway = 1 + (ctx.moving ? 2.2 : 0);
      this.scope.style.transform =
        `translate(${Math.sin(t * 0.9) * 1.6 * sway}px, ${Math.cos(t * 0.7) * 1.3 * sway}px)`;
    }

    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      const t = clamp(this.hitTimer / 0.28, 0, 1);
      this.hitmark.style.opacity = String(t);
      this.hitmark.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${1 + (1 - t) * 0.5})`;
    }

    if (this.centerT > 0) {
      this.centerT -= dt;
      if (this.centerT <= 0) this.center.style.display = 'none';
    }

    this.hurtT = Math.max(0, this.hurtT - dt);
    const hurtBase = 1 - clamp((ctx.health ?? 100) / 100, 0, 1);
    this.hurtVig.style.opacity = String(clamp(hurtBase * 0.5 + this.hurtT * 0.42, 0, 0.8));

    this.flashT = Math.max(0, this.flashT - dt * 2.2);
    this.flash.style.opacity = String(this.flashT);

    // damage direction arrows
    for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
      const d = this.dmgDirs[i];
      d.life -= dt;
      if (d.life <= 0) { d.node.remove(); this.dmgDirs.splice(i, 1); continue; }
      const ang = Math.atan2(d.dir[0], d.dir[2]) - (ctx.yaw ?? 0) + Math.PI;
      d.node.style.opacity = String(clamp(d.life / 1.5, 0, 1) * 0.9);
      d.node.style.transform = `translate(-50%,-50%) rotate(${ang}rad) translateY(-130px)`;
    }

    for (let i = this.killfeedItems.length - 1; i >= 0; i--) {
      const k = this.killfeedItems[i];
      k.life -= dt;
      if (k.life <= 0) { k.node.remove(); this.killfeedItems.splice(i, 1); }
      else if (k.life < 1) k.node.style.opacity = String(k.life);
    }

    this.leanInd.style.opacity = Math.abs(ctx.lean ?? 0) > 0.15 ? '0.8' : '0';
    if (Math.abs(ctx.lean ?? 0) > 0.15) this.leanInd.textContent = ctx.lean < 0 ? '◄ LEAN' : 'LEAN ►';

    // bodycam chrome
    const t = ctx.matchTime ?? (performance.now() / 1000);
    const hh = String(Math.floor(t / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor(t / 60) % 60).padStart(2, '0');
    const ss = String(Math.floor(t) % 60).padStart(2, '0');
    const ff = String(Math.floor((t % 1) * 30)).padStart(2, '0');
    this.tc.textContent = `${hh}:${mm}:${ss}:${ff}`;
    if (!this._battT || performance.now() - this._battT > 8000) {
      this._battT = performance.now();
      this._batt = this._batt === undefined ? 87 : Math.max(11, this._batt - 1);
      this.batt.textContent = `BATT ${this._batt}%`;
    }

    // telemetry
    const parts = [];
    if (S.showFps) parts.push(`<b>FPS</b> ${perf.fps}`);
    if (S.showPing && ctx.net) {
      parts.push(`<b>PING</b> ${ctx.net.ping}ms`);
      if (ctx.net.loss > 2) parts.push(`<span class="warnp"><b>LOSS</b> ${ctx.net.loss}%</span>`);
    }
    if (S.showNetGraph && ctx.net) {
      parts.push(`<b>JIT</b> ${ctx.net.jitter}ms`);
      parts.push(`<b>IN</b> ${ctx.net.inKbps}kb/s`);
      parts.push(`<b>OUT</b> ${ctx.net.outKbps}kb/s`);
    }
    if (S.showPerf) {
      parts.push(`<b>MS</b> ${perf.avgMs.toFixed(1)}`);
      parts.push(`<b>1%</b> ${perf.onePercentLow()}`);
      parts.push(`<b>DC</b> ${perf.drawCalls}`);
      parts.push(`<b>TRI</b> ${(perf.triangles / 1000).toFixed(0)}k`);
    }
    this.netgraph.innerHTML = parts.join('<br>');
  }

  show(on) { this.root.hidden = !on; }
}
