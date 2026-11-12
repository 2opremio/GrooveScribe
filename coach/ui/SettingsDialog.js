import { coachState } from '../state/State.js';
import { TOLERANCE_LEVELS } from '../engine/TimingEvaluator.js';

/**
 * SettingsDialog - Manages the settings UI
 */
export class SettingsDialog {
  constructor() {
    this.container = null;
    this._mode = null; // the mode selected in the dialog, saved on Start
    this._level = null; // the level selected in the dialog, saved on Start
  }

  inject() {
    if (document.getElementById('coachSettingsDialog')) return;

    const dialog = document.createElement('div');
    dialog.id = 'coachSettingsDialog';
    dialog.innerHTML = `
      <div class="coach-settings-head">Drum Coach</div>
      <div class="coach-settings-content">
        <section class="coach-settings-level">
          <h3><i class="fa fa-signal"></i>Level</h3>
          <div class="coach-settings-choices" id="coach-level-choices">${levelButtons()}</div>
        </section>

        <div class="coach-settings-grid">
          <section class="coach-settings-card">
            <h3><i class="fa fa-repeat"></i>Mode</h3>
            <div class="coach-settings-choices" id="coach-mode-choices">
              <button type="button" data-mode="practice">Practice<small>loop it with live marks</small></button>
              <button type="button" data-mode="performance">Performance<small>play it through, get a grade</small></button>
            </div>
            <div id="practice-options">
              <div class="coach-settings-row">
                <label for="coach-auto-bpm-check">Raise tempo<small>when you play the groove clean</small></label>
                ${switchInput('coach-auto-bpm-check')}
              </div>
              <div class="coach-settings-row coach-settings-sentence" id="coach-auto-bpm-amounts">
                By <input type="number" id="coach-auto-bpm-step-input" min="1" step="1" aria-label="bpm to raise by">
                bpm, after <input type="number" id="coach-auto-bpm-passes-input" min="1" step="1" aria-label="clean passes in a row">
                clean passes in a row
              </div>
            </div>
            <div id="performance-options">
              <div class="coach-settings-row coach-settings-sentence">
                Play it <input type="number" id="coach-reps-input" min="1" max="16" step="1" aria-label="times to play">
                times, then grade
              </div>
            </div>
          </section>

          <section class="coach-settings-card">
            <h3><i class="fa fa-th-large"></i>Kit</h3>
            <div class="coach-settings-row">
              <span class="coach-settings-label">Mapping<small id="coach-drummap-status"></small></span>
              <button type="button" class="coach-settings-btn" id="coach-drummap-btn"></button>
            </div>
            <div class="coach-settings-row coach-settings-advanced">
              <label for="coach-min-velocity-input">Ignore hits below<small>velocity 0-127; filters pad crosstalk</small></label>
              <input type="number" id="coach-min-velocity-input" min="0" max="127" step="1">
            </div>
            <div class="coach-settings-sub">
              <h4><i class="fa fa-clock-o"></i>Calibration<small id="coach-calib-status"></small></h4>
              <div class="coach-settings-row">
                <label for="coach-latency-input">Latency<small>delay from a sound to your hit arriving</small></label>
                <span class="coach-settings-ctl">
                  <span class="coach-settings-advanced coach-settings-ctl">
                    <input type="number" id="coach-latency-input" step="1"> ms
                  </span>
                  <span class="coach-settings-basic" id="coach-latency-value"></span>
                  <button type="button" class="coach-settings-btn" id="coach-calibrate-btn"></button>
                </span>
              </div>
              <div class="coach-settings-row coach-settings-advanced">
                <label for="coach-calib-hit-rule-select">Listens to<small>which hit near each click is the tap</small></label>
                <select id="coach-calib-hit-rule-select">
                  <option value="loudest">Loudest hit</option>
                  <option value="every">Every hit</option>
                </select>
              </div>
            </div>
          </section>

          <section class="coach-settings-card coach-settings-advanced">
            <h3><i class="fa fa-bullseye"></i>A pass is clean when</h3>
            <div class="coach-settings-targets">
              ${target('coach-goal-blue-input', 'Blue, at least')}
              ${target('coach-goal-yellow-input', 'Yellow, at most')}
              ${target('coach-goal-mistakes-input', 'Mistakes, at most')}
            </div>
            <div class="coach-settings-note">Shares of the notes. Mistakes are missed notes and stray hits.</div>
          </section>

          <section class="coach-settings-card coach-settings-advanced">
            <h3><i class="fa fa-music"></i>Metronome</h3>
            <div class="coach-settings-pair">
              <div class="coach-settings-row">
                <label for="coach-countin-check">Count-in<small>one bar of clicks first</small></label>
                ${switchInput('coach-countin-check')}
              </div>
              <div class="coach-settings-row">
                <label for="coach-start-solo-check">Click only<small>mute the groove</small></label>
                ${switchInput('coach-start-solo-check')}
              </div>
            </div>
            <div class="coach-settings-row">
              <label for="coach-metronome-vol">Volume</label>
              <span class="coach-settings-ctl">
                <input type="range" id="coach-metronome-vol" min="0" max="100">
                <span class="coach-settings-unit" id="coach-metronome-vol-label"></span>
              </span>
            </div>
          </section>
        </div>
      </div>

      <div class="coach-settings-foot">
        <span class="coach-settings-ctl">
          <label class="coach-settings-show-advanced">${switchInput('coach-show-advanced-check')}Show advanced options</label>
          <label class="coach-settings-debug">${switchInput('coach-debug-grid-check')}Debug grid</label>
        </span>
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
    const q = (sel) => this.container.querySelector(sel);

    for (const btn of this.container.querySelectorAll('#coach-mode-choices button')) {
      btn.addEventListener('click', () => this._showMode(btn.dataset.mode));
    }
    for (const btn of this.container.querySelectorAll('#coach-level-choices button')) {
      btn.addEventListener('click', () => this._showLevel(btn.dataset.level));
    }

    q('#coach-auto-bpm-check').addEventListener('change', () => this._showAutoBpm());
    q('#coach-show-advanced-check').addEventListener('change', () => this._showAdvanced());

    q('#coach-calibrate-btn').addEventListener('click', () => {
      this.save();
      this.hide();
      window.dispatchEvent(new CustomEvent('coach-calibrate-requested'));
    });

    q('#coach-metronome-vol').addEventListener('input', (e) => {
      q('#coach-metronome-vol-label').textContent = e.target.value + '%';
    });

    q('#coach-drummap-btn').addEventListener('click', () => {
      this.save();
      this.hide();
      window.dispatchEvent(new CustomEvent('coach-drummap-requested'));
    });

    q('#coach-start-btn').addEventListener('click', () => {
      this.save();
      this.hide();
      window.dispatchEvent(new CustomEvent('coach-start-requested'));
    });

    q('#coach-cancel-btn').addEventListener('click', () => {
      this.hide();
    });
  }

  show() {
    const q = (sel) => this.container.querySelector(sel);

    this._showMode(coachState.mode);
    this._showLevel(coachState.tolerance);
    q('#coach-reps-input').value = coachState.reps;
    q('#coach-countin-check').checked = coachState.countIn;
    q('#coach-latency-input').value = coachState.calibrationOffset;
    q('#coach-calib-hit-rule-select').value = coachState.calibrationHitRule;
    q('#coach-min-velocity-input').value = coachState.minHitVelocity;
    q('#coach-debug-grid-check').checked = coachState.showDebugGrid;
    q('#coach-start-solo-check').checked = coachState.startWithSolo;
    q('#coach-metronome-vol').value = coachState.metronomeVolume;
    q('#coach-metronome-vol-label').textContent = coachState.metronomeVolume + '%';

    q('#coach-auto-bpm-check').checked = coachState.autoBpm;
    q('#coach-auto-bpm-step-input').value = coachState.autoBpmStep;
    q('#coach-auto-bpm-passes-input').value = coachState.autoBpmPasses;
    this._showAutoBpm();
    q('#coach-goal-blue-input').value = coachState.goalMinPerfectPercent;
    q('#coach-goal-yellow-input').value = coachState.goalMaxClosePercent;
    q('#coach-goal-mistakes-input').value = coachState.goalMaxMistakesPercent;

    q('#coach-show-advanced-check').checked = coachState.showAdvancedSettings;
    this._showAdvanced();
    this._showKitStatus();

    this.container.style.display = 'block';
  }

  /** Mapping and calibration: what each is now, and the button that sets it up or redoes it. */
  _showKitStatus() {
    const q = (sel) => this.container.querySelector(sel);

    const mapped = coachState.drumMapConfigured;
    status(q('#coach-drummap-status'), mapped, 'which pad is which drum', 'not set up');
    const mapBtn = q('#coach-drummap-btn');
    mapBtn.classList.toggle('solid', !mapped);
    mapBtn.innerHTML = `${mapped ? drumMapName() : 'Set up'} <i class="fa fa-chevron-right"></i>`;

    const calibrated = coachState.calibrated;
    status(
      q('#coach-calib-status'),
      calibrated,
      '<i class="fa fa-check"></i> calibrated',
      'not calibrated'
    );
    q('#coach-latency-value').textContent = `${coachState.calibrationOffset} ms`;
    const calibBtn = q('#coach-calibrate-btn');
    calibBtn.classList.toggle('solid', !calibrated);
    calibBtn.textContent = calibrated ? 'Recalibrate' : 'Calibrate';
  }

  /** Select a mode in the dialog: highlight it and show only its options. */
  _showMode(mode) {
    this._mode = mode;
    for (const btn of this.container.querySelectorAll('#coach-mode-choices button')) {
      btn.classList.toggle('on', btn.dataset.mode === mode);
    }
    this.container.querySelector('#practice-options').hidden = mode !== 'practice';
    this.container.querySelector('#performance-options').hidden = mode !== 'performance';
  }

  _showLevel(level) {
    this._level = level;
    for (const btn of this.container.querySelectorAll('#coach-level-choices button')) {
      btn.classList.toggle('on', btn.dataset.level === level);
    }
  }

  /** The tempo step and passes only matter while raising the tempo is on. */
  _showAutoBpm() {
    const on = this.container.querySelector('#coach-auto-bpm-check').checked;
    this.container.querySelector('#coach-auto-bpm-amounts').classList.toggle('off', !on);
  }

  _showAdvanced() {
    const on = this.container.querySelector('#coach-show-advanced-check').checked;
    this.container.classList.toggle('show-advanced', on);
  }

  hide() {
    this.container.style.display = 'none';
  }

  save() {
    const q = (sel) => this.container.querySelector(sel);
    coachState.mode = this._mode;
    coachState.tolerance = this._level;
    coachState.reps = parseInt(q('#coach-reps-input').value);
    coachState.countIn = q('#coach-countin-check').checked;
    coachState.calibrationOffset = parseInt(q('#coach-latency-input').value) || 0;
    coachState.calibrationHitRule = q('#coach-calib-hit-rule-select').value;
    coachState.minHitVelocity = q('#coach-min-velocity-input').value;
    coachState.showDebugGrid = q('#coach-debug-grid-check').checked;
    coachState.startWithSolo = q('#coach-start-solo-check').checked;
    coachState.metronomeVolume = parseInt(q('#coach-metronome-vol').value);
    coachState.autoBpm = q('#coach-auto-bpm-check').checked;
    coachState.autoBpmStep = q('#coach-auto-bpm-step-input').value;
    coachState.autoBpmPasses = q('#coach-auto-bpm-passes-input').value;
    coachState.goalMinPerfectPercent = q('#coach-goal-blue-input').value;
    coachState.goalMaxClosePercent = q('#coach-goal-yellow-input').value;
    coachState.goalMaxMistakesPercent = q('#coach-goal-mistakes-input').value;
    coachState.showAdvancedSettings = q('#coach-show-advanced-check').checked;
    coachState.save();
  }
}

/** A checkbox drawn as a switch. */
function switchInput(id) {
  return `<span class="coach-settings-switch"><input type="checkbox" id="${id}"><span></span></span>`;
}

/** A percentage target of the clean-pass goal: its name over its box. */
function target(id, name) {
  return `<label for="${id}"><span>${name}</span><span class="coach-settings-ctl"><input type="number" id="${id}" min="0" max="100" step="1"> %</span></label>`;
}

/** One button per experience level, each with who it suits. */
function levelButtons() {
  return Object.entries(TOLERANCE_LEVELS)
    .map(
      ([name, level]) =>
        `<button type="button" data-level="${name}">${level.label}<small>${level.description}</small></button>`
    )
    .join('');
}

/** The mapping in use, as the kit's name. */
function drumMapName() {
  if (coachState.drumMapPreset === 'custom') return 'Custom';
  return coachState.drumMapPreset === '_gm' ? 'General MIDI' : coachState.drumMapPreset;
}

/** A row's status line: what's set, or a warning with what's missing. */
function status(el, ok, okHtml, missingText) {
  el.className = ok ? 'coach-settings-ok' : 'coach-settings-missing';
  el.innerHTML = ok ? okHtml : `<i class="fa fa-exclamation-circle"></i> ${missingText}`;
}
