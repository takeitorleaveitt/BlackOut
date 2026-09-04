// Siege pre-round pick screen: shown over the HUD for the whole freeze
// phase. Picking an operator sends it to the server immediately (no
// separate confirm step — you can keep changing your mind until the clock
// runs out, same as the attack-side / defend-floor choice below it).

import { el, clear } from '../ui/UI.js';
import { audio } from '../audio/AudioEngine.js';
import { OPERATORS_FOR_TEAM } from '../shared/operators.js';

const SIDES = [['north', 'NORTH'], ['west', 'WEST'], ['east', 'EAST']];
const FLOORS = [[1, 'FLOOR 1'], [2, 'FLOOR 2']];

export class OperatorPicker {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.visible = false;
    this.lastKey = null;
    this.build();
  }

  build() {
    clear(this.root);
    this.timerEl = el('div.op-timer', '20');
    this.gridEl = el('div.op-grid');
    this.choiceEl = el('div.op-choice');
    this.root.appendChild(el('div.op-modal',
      el('div.op-head', el('h2', 'SELECT YOUR OPERATOR'), this.timerEl),
      this.gridEl,
      this.choiceEl));
    this.injectStyle();
  }

  injectStyle() {
    if (document.getElementById('op-picker-style')) return;
    const s = document.createElement('style');
    s.id = 'op-picker-style';
    s.textContent = `
      #operator-root { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
        background: rgba(4,6,7,0.72); backdrop-filter: blur(2px); }
      #operator-root[hidden] { display: none; }
      .op-modal { width: min(920px, 92vw); max-height: 86vh; overflow: auto; background: var(--panel-2);
        border: 1px solid var(--line); padding: 26px 30px; font-family: var(--mono, monospace); }
      .op-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
      .op-head h2 { margin: 0; font-size: 15px; letter-spacing: 0.18em; color: var(--accent); font-weight: 500; }
      .op-timer { font-size: 22px; color: var(--accent); font-variant-numeric: tabular-nums; }
      .op-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; margin-bottom: 20px; }
      .op-card { border: 1px solid var(--line); padding: 12px; cursor: pointer; transition: border-color .12s, background .12s; }
      .op-card:hover:not(.taken) { border-color: var(--line-hot); }
      .op-card.sel { border-color: var(--accent); background: rgba(200,255,77,0.08); }
      .op-card.taken { opacity: 0.35; cursor: not-allowed; }
      .op-card .nm { display: block; font-size: 13px; letter-spacing: 0.04em; color: #eef2f4; margin-bottom: 3px; }
      .op-card .role { display: block; font-size: 10px; letter-spacing: 0.14em; color: var(--accent-dim); margin-bottom: 6px; text-transform: uppercase; }
      .op-card .wpn { display: block; font-size: 10px; color: #9aa5ab; margin-bottom: 4px; }
      .op-card .desc { display: block; font-size: 10px; color: #6c7579; line-height: 1.4; }
      .op-choice { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding-top: 14px; border-top: 1px solid var(--line); }
      .op-choice .lbl { font-size: 10px; letter-spacing: 0.16em; color: #9aa5ab; margin-right: 4px; }
      .op-choice button { font-family: var(--mono, monospace); font-size: 11px; letter-spacing: 0.08em; padding: 8px 14px;
        background: transparent; border: 1px solid var(--line); color: #cfd6d9; cursor: pointer; }
      .op-choice button.sel { border-color: var(--accent); color: var(--accent); }
    `;
    document.head.appendChild(s);
  }

  /** Called from Game.onMatchState() and each frame while visible. */
  update(state) {
    const g = this.game;
    const shouldShow = !!state && g.mode === 'match' && !!g.player && !g.paused
      && (state.mode === 'siege' || state.mode === 'quickplay')
      && state.phase === 'freeze';
    if (shouldShow !== this.visible) {
      // release/recapture the cursor so cards are actually clickable, same
      // as the pause menu does, without touching game.paused (this isn't a
      // pause — the sim keeps ticking through the freeze phase)
      if (shouldShow) g.input.exitLock(); else g.input.requestLock();
    }
    this.root.hidden = !shouldShow;
    this.visible = shouldShow;
    if (!shouldShow) return;

    this.timerEl.textContent = String(Math.max(0, Math.round(state.timeLeft)));

    const myTeam = g.player.team;
    const myRow = (state.board || []).find((r) => r.id === g.player.id) || {};
    const myKey = myRow.operator || null;
    this.myAttackSide = myRow.attackSide || null;
    this.myFloorChoice = myRow.floorChoice || null;
    const attacking = myTeam === state.attackTeam;
    const takenByTeammate = new Set(
      (state.board || []).filter((r) => r.team === myTeam && r.id !== g.player.id && r.operator).map((r) => r.operator)
    );

    if (this.lastKey !== myKey + ':' + attacking) {
      this.lastKey = myKey + ':' + attacking;
      this.renderGrid(myTeam, myKey, takenByTeammate);
      this.renderChoice(attacking);
    } else {
      // just refresh the "taken"/"selected" state each tick without a full rebuild
      for (const card of this.gridEl.children) {
        const taken = takenByTeammate.has(card.dataset.key) && card.dataset.key !== myKey;
        card.classList.toggle('taken', taken);
        card.classList.toggle('sel', card.dataset.key === myKey);
      }
      for (const btn of this.choiceEl.querySelectorAll('button')) {
        btn.classList.toggle('sel', btn.dataset.value === (attacking ? this.myAttackSide : String(this.myFloorChoice)));
      }
    }
  }

  renderGrid(myTeam, myKey, takenByTeammate) {
    clear(this.gridEl);
    for (const op of OPERATORS_FOR_TEAM(myTeam)) {
      const taken = takenByTeammate.has(op.key);
      const card = el('div.op-card' + (op.key === myKey ? '.sel' : '') + (taken ? '.taken' : ''), {
        dataset: { key: op.key },
        onclick: () => {
          if (taken) return;
          audio.ui('accept');
          this.game.pickOperator(op.key);
        },
        onmouseenter: () => { if (!taken) audio.ui('hover'); }
      },
        el('span.nm', op.name),
        el('span.role', op.role),
        el('span.wpn', op.primary.toUpperCase() + ' · ' + op.secondary.toUpperCase()),
        el('span.desc', op.desc));
      this.gridEl.appendChild(card);
    }
  }

  renderChoice(attacking) {
    clear(this.choiceEl);
    const g = this.game;
    if (attacking) {
      this.choiceEl.appendChild(el('span.lbl', 'ATTACK FROM'));
      for (const [side, label] of SIDES) {
        this.choiceEl.appendChild(el('button' + (this.myAttackSide === side ? '.sel' : ''), {
          dataset: { value: side },
          onclick: () => { audio.ui('click'); g.pickSpawnChoice({ side }); }
        }, label));
      }
    } else {
      this.choiceEl.appendChild(el('span.lbl', 'DEFEND'));
      for (const [floor, label] of FLOORS) {
        this.choiceEl.appendChild(el('button' + (this.myFloorChoice === floor ? '.sel' : ''), {
          dataset: { value: String(floor) },
          onclick: () => { audio.ui('click'); g.pickSpawnChoice({ floor }); }
        }, label));
      }
    }
  }
}
