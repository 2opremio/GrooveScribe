import { coachState } from '../state/State.js';
import { TOLERANCE_LEVELS } from '../engine/TimingEvaluator.js';

/**
 * SettingsDialog - Manages the settings UI
 */
export class SettingsDialog {
  constructor() {
    this.container = null;
    this._mode = null; // the mode selected in the dialog, saved on Start
  }

  inject() {
    if (document.getElementById('coachSettingsDialog')) return;

    const dialog = document.createElement('div');
    dialog.id = 'coachSettingsDialog';
    dialog.innerHTML = `
      <div class="coach-settings-head"><h2>Drum Coach</h2></div>
      <div class="coach-settings-grid">
        <section class="coach-settings-card mode">
          <h3><i class="fa fa-repeat"></i>Mode</h3>
          <div class="coach-settings-seg" id="coach-mode-seg">
            <button type="button" data-mode="practice">Practice</button>
            <button type="button" data-mode="performance">Performance</button>
          </div>
          <div id="practice-options">
            <div class="coach-settings-row">
              <label for="coach-auto-bpm-check">Auto +5 bpm</label>
              ${toggle('coach-auto-bpm-check')}
            </div>
            <div class="coach-settings-row">
              <label for="coach-auto-bpm-passes-input">Clean passes in a row</label>
              ${number('coach-auto-bpm-passes-input', '', 'min="1" step="1"')}
            </div>
          </div>
          <div id="performance-options">
            <div class="coach-settings-row">
              <label for="coach-reps-input">Passes before result</label>
              ${number('coach-reps-input', '', 'min="1" max="16" step="1"')}
            </div>
            <div class="coach-settings-row">
              <label for="coach-few-mistakes-input">"Getting there" up to</label>
              ${number('coach-few-mistakes-input', '% off', 'min="0" max="100" step="1"')}
            </div>
          </div>
        </section>

        <section class="coach-settings-card">
          <h3><i class="fa fa-bullseye"></i>Clean pass</h3>
          <div class="coach-settings-row">
            <label for="coach-goal-blue-input"><span class="coach-settings-blue">Blue</span> at least</label>
            ${number('coach-goal-blue-input', '%', 'min="0" max="100" step="1"')}
          </div>
          <div class="coach-settings-row">
            <label for="coach-goal-yellow-input"><span class="coach-settings-yellow">Yellow</span> at most</label>
            ${number('coach-goal-yellow-input', '%', 'min="0" max="100" step="1"')}
          </div>
          <div class="coach-settings-row">
            <label for="coach-goal-mistakes-input"><span class="coach-settings-red">Mistakes</span> at most</label>
            ${number('coach-goal-mistakes-input', '%', 'min="0" max="100" step="1"')}
          </div>
          <div class="coach-settings-row"><span class="coach-settings-note">missed notes and stray hits</span></div>
        </section>

        <section class="coach-settings-card">
          <h3><i class="fa fa-clock-o"></i>Timing<span id="coach-calib-hint" class="coach-settings-warn">Not calibrated</span></h3>
          <div class="coach-settings-row">
            <label for="coach-tolerance-select">Level</label>
            <select id="coach-tolerance-select">${toleranceOptions()}</select>
          </div>
          <div class="coach-settings-row"><span class="coach-settings-note" id="coach-tolerance-note"></span></div>
          <div class="coach-settings-row">
            <label for="coach-latency-input">Latency</label>
            <span class="coach-settings-ctl">
              <input type="number" id="coach-latency-input" step="1"><span class="coach-settings-unit">ms</span>
              <button type="button" class="coach-settings-btn" id="coach-calibrate-btn">Calibrate</button>
            </span>
          </div>
          <div class="coach-settings-row">
            <label for="coach-calib-hit-rule-select">Calibration counts</label>
            <select id="coach-calib-hit-rule-select">
              <option value="loudest">Loudest hit</option>
              <option value="every">Every hit</option>
            </select>
          </div>
        </section>

        <section class="coach-settings-card">
          <h3><i class="fa fa-music"></i>Metronome</h3>
          <div class="coach-settings-row">
            <label for="coach-countin-check">Count-in</label>
            ${toggle('coach-countin-check')}
          </div>
          <div class="coach-settings-row">
            <label for="coach-start-solo-check">Solo <span class="coach-settings-note">(mute the groove)</span></label>
            ${toggle('coach-start-solo-check')}
          </div>
          <div class="coach-settings-row">
            <label for="coach-metronome-vol">Volume</label>
            <span class="coach-settings-ctl">
              <input type="range" id="coach-metronome-vol" min="0" max="100">
              <span class="coach-settings-unit" id="coach-metronome-vol-label"></span>
            </span>
          </div>
        </section>

        <section class="coach-settings-card wide">
          <h3><i class="fa fa-th-large"></i>Kit<span id="coach-drummap-hint" class="coach-settings-warn">Not set up</span></h3>
          <div class="coach-settings-row">
            <label for="coach-drummap-btn">Mapping</label>
            <button type="button" class="coach-settings-btn" id="coach-drummap-btn"></button>
          </div>
          <div class="coach-settings-row">
            <label for="coach-min-velocity-input">Ignore hits below</label>
            ${number('coach-min-velocity-input', 'velocity', 'min="0" max="127" step="1"')}
          </div>
        </section>
      </div>

      <div class="coach-settings-foot">
        <label class="coach-settings-debug">${switchInput('coach-debug-grid-check')}Debug grid</label>
        <span class="coach-settings-ctl">
          <button type="button" class="coach-btn coach-btn-secondary" id="coach-cancel-btn">Cancel</button>
          <button type="button" class="coach-btn coach-btn-primary" id="coach-start-btn">Start</button>
        </span>
      </div>
    `;

    document.body.appendChild(dialog);
    this.container = dialog;
    this._setupEventListeners();
  }

  _setupEventListeners() {
    const startBtn = this.container.querySelector('#coach-start-btn');
    const cancelBtn = this.container.querySelector('#coach-cancel-btn');

    for (const btn of this.container.querySelectorAll('#coach-mode-seg button')) {
      btn.addEventListener('click', () => this._showMode(btn.dataset.mode));
    }

    this.container
      .querySelector('#coach-tolerance-select')
      .addEventListener('change', () => this._showToleranceNote());
    this.container.querySelector('#coach-calibrate-btn').addEventListener('click', () => {
      this.save();
      this.hide();
      window.dispatchEvent(new CustomEvent('coach-calibrate-requested'));
    });

    this.container.querySelector('#coach-metronome-vol').addEventListener('input', (e) => {
      this.container.querySelector('#coach-metronome-vol-label').textContent = e.target.value + '%';
    });

    this.container.querySelector('#coach-drummap-btn').addEventListener('click', () => {
      this.save();
      this.hide();
      window.dispatchEvent(new CustomEvent('coach-drummap-requested'));
    });

    startBtn.addEventListener('click', () => {
      this.save();
      this.hide();
      // Trigger session start event...
      window.dispatchEvent(new CustomEvent('coach-start-requested'));
    });

    cancelBtn.addEventListener('click', () => {
      this.hide();
    });
  }

  show() {
    // Load current state into fields
    this._showMode(coachState.mode);
    this.container.querySelector('#coach-reps-input').value = coachState.reps;
    this.container.querySelector('#coach-countin-check').checked = coachState.countIn;
    this.container.querySelector('#coach-tolerance-select').value = coachState.tolerance;
    this._showToleranceNote();
    this.container.querySelector('#coach-latency-input').value = coachState.calibrationOffset;
    this.container.querySelector('#coach-calib-hit-rule-select').value =
      coachState.calibrationHitRule;
    this.container.querySelector('#coach-min-velocity-input').value = coachState.minHitVelocity;
    this.container.querySelector('#coach-debug-grid-check').checked = coachState.showDebugGrid;
    this.container.querySelector('#coach-start-solo-check').checked = coachState.startWithSolo;
    this.container.querySelector('#coach-metronome-vol').value = coachState.metronomeVolume;
    this.container.querySelector('#coach-metronome-vol-label').textContent =
      coachState.metronomeVolume + '%';

    this.container.querySelector('#coach-few-mistakes-input').value = coachState.fewMistakesPercent;
    this.container.querySelector('#coach-auto-bpm-check').checked = coachState.autoBpm;
    this.container.querySelector('#coach-auto-bpm-passes-input').value = coachState.autoBpmPasses;
    this.container.querySelector('#coach-goal-blue-input').value = coachState.goalMinPerfectPercent;
    this.container.querySelector('#coach-goal-yellow-input').value = coachState.goalMaxClosePercent;
    this.container.querySelector('#coach-goal-mistakes-input').value =
      coachState.goalMaxMistakesPercent;

    this.container.querySelector('#coach-calib-hint').hidden = coachState.calibrated;

    // Update drum mapping button label
    const drumMapBtn = this.container.querySelector('#coach-drummap-btn');
    if (coachState.drumMapPreset === 'custom') {
      drumMapBtn.textContent = 'Custom';
    } else {
      drumMapBtn.textContent =
        coachState.drumMapPreset === '_gm' ? 'General MIDI' : coachState.drumMapPreset;
    }
    this.container.querySelector('#coach-drummap-hint').hidden = coachState.drumMapConfigured;

    this.container.style.display = 'block';
  }

  /** Select a mode in the dialog: highlight it and show only its options. */
  _showMode(mode) {
    this._mode = mode;
    for (const btn of this.container.querySelectorAll('#coach-mode-seg button')) {
      btn.classList.toggle('on', btn.dataset.mode === mode);
    }
    this.container.querySelector('#practice-options').hidden = mode !== 'practice';
    this.container.querySelector('#performance-options').hidden = mode !== 'performance';
  }

  _showToleranceNote() {
    const level = this.container.querySelector('#coach-tolerance-select').value;
    this.container.querySelector('#coach-tolerance-note').textContent =
      TOLERANCE_LEVELS[level].description;
  }

  hide() {
    this.container.style.display = 'none';
  }

  save() {
    coachState.mode = this._mode;
    coachState.reps = parseInt(this.container.querySelector('#coach-reps-input').value);
    coachState.countIn = this.container.querySelector('#coach-countin-check').checked;
    coachState.tolerance = this.container.querySelector('#coach-tolerance-select').value;
    coachState.calibrationOffset =
      parseInt(this.container.querySelector('#coach-latency-input').value) || 0;
    coachState.calibrationHitRule = this.container.querySelector(
      '#coach-calib-hit-rule-select'
    ).value;
    coachState.minHitVelocity = this.container.querySelector('#coach-min-velocity-input').value;
    coachState.showDebugGrid = this.container.querySelector('#coach-debug-grid-check').checked;
    coachState.startWithSolo = this.container.querySelector('#coach-start-solo-check').checked;
    coachState.metronomeVolume = parseInt(
      this.container.querySelector('#coach-metronome-vol').value
    );
    coachState.fewMistakesPercent = this.container.querySelector('#coach-few-mistakes-input').value;
    coachState.autoBpm = this.container.querySelector('#coach-auto-bpm-check').checked;
    coachState.autoBpmPasses = this.container.querySelector('#coach-auto-bpm-passes-input').value;
    coachState.goalMinPerfectPercent = this.container.querySelector('#coach-goal-blue-input').value;
    coachState.goalMaxClosePercent = this.container.querySelector('#coach-goal-yellow-input').value;
    coachState.goalMaxMistakesPercent = this.container.querySelector(
      '#coach-goal-mistakes-input'
    ).value;
    coachState.save();
  }
}

/** A checkbox drawn as a switch. */
function switchInput(id) {
  return `<span class="coach-settings-switch"><input type="checkbox" id="${id}"><span></span></span>`;
}

/** A switch in a row, with an empty unit column so it lines up with the boxes in its card. */
function toggle(id) {
  return `<span class="coach-settings-ctl">${switchInput(id)}<span class="coach-settings-unit"></span></span>`;
}

/** A number box followed by its unit, in a fixed-width column so boxes line up in a card. */
function number(id, unit, attrs) {
  return `<span class="coach-settings-ctl"><input type="number" id="${id}" ${attrs}><span class="coach-settings-unit">${unit}</span></span>`;
}

/** The experience levels, which set how far off a hit can be at each tier. */
function toleranceOptions() {
  return Object.entries(TOLERANCE_LEVELS)
    .map(([name, level]) => `<option value="${name}">${level.label}</option>`)
    .join('');
}
