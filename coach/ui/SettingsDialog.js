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

      <section class="coach-settings-level">
        <h3><i class="fa fa-signal"></i>Level</h3>
        <div class="coach-settings-bar" id="coach-level-choices">${levelButtons()}</div>
      </section>

      <div class="coach-settings-cols">
        <div>
          <section>
            <h3><i class="fa fa-repeat"></i>Mode</h3>
            <div class="coach-settings-bar" id="coach-mode-choices">
              <button type="button" data-mode="practice">Practice<small>loop it with live marks</small></button>
              <button type="button" data-mode="performance">Performance<small>play it through, get a grade</small></button>
            </div>
            <div class="coach-settings-row" id="practice-options">
              <span class="coach-settings-sentence" id="coach-auto-bpm-amounts">
                Raise ${inlineNumber('coach-auto-bpm-step-input', 'bpm to raise by', 'min="1" step="1"')}
                bpm every ${inlineNumber('coach-auto-bpm-passes-input', 'clean passes in a row', 'min="1" step="1"')}
                clean passes
              </span>
              ${switchInput('coach-auto-bpm-check', 'Raise the tempo')}
            </div>
            <div class="coach-settings-row" id="performance-options">
              <span class="coach-settings-sentence">
                Play it ${inlineNumber('coach-reps-input', 'times to play', 'min="1" max="16" step="1"')}
                times, then grade
              </span>
            </div>
          </section>

          <section class="coach-settings-advanced">
            <h3><i class="fa fa-bullseye"></i>A pass is clean when</h3>
            ${row('Blue notes, at least', 'share of the notes', number('coach-goal-blue-input', '%', 'min="0" max="100" step="1"'))}
            ${row('Yellow notes, at most', '', number('coach-goal-yellow-input', '%', 'min="0" max="100" step="1"'))}
            ${row('Mistakes, at most', 'missed notes and stray hits', number('coach-goal-mistakes-input', '%', 'min="0" max="100" step="1"'))}
          </section>

          <section class="coach-settings-advanced">
            <h3><i class="fa fa-music"></i>Metronome</h3>
            <div class="coach-settings-pair">
              ${row('Count-in', 'one bar first', switchInput('coach-countin-check'), 'coach-countin-check')}
              ${row('Click only', 'mute the groove', switchInput('coach-start-solo-check'), 'coach-start-solo-check')}
            </div>
            ${row('Volume', '', '<input type="range" id="coach-metronome-vol" min="0" max="100">', 'coach-metronome-vol')}
          </section>
        </div>

        <div>
          <section>
            <h3><i class="fa fa-th-large"></i>Kit</h3>
            <div class="coach-settings-row">
              <span class="coach-settings-label">Mapping<small id="coach-drummap-status"></small></span>
              <button type="button" class="coach-settings-btn" id="coach-drummap-btn"></button>
            </div>
            <div class="coach-settings-advanced">
              ${row('Ignore hits below', 'velocity; filters pad crosstalk', number('coach-min-velocity-input', '', 'min="0" max="127" step="1"'), 'coach-min-velocity-input')}
              ${row('Grade hi-hat foot', 'also in grooves without it', switchInput('coach-grade-hh-foot-check'), 'coach-grade-hh-foot-check')}
            </div>
          </section>

          <section>
            <h3><i class="fa fa-clock-o"></i>Calibration</h3>
            <div class="coach-settings-row">
              <span class="coach-settings-label">Latency<small id="coach-calib-status"></small></span>
              <button type="button" class="coach-settings-btn" id="coach-calibrate-btn"></button>
            </div>
            <div class="coach-settings-advanced">
              ${row(
                'Use',
                'the latest result of each way of calibrating',
                '<select id="coach-calib-use-select"></select>',
                'coach-calib-use-select'
              )}
              ${row('Latency', 'type a number to set it by hand', number('coach-latency-input', 'ms', 'step="1"'), 'coach-latency-input')}
              ${row(
                'Listens to',
                'which hit near each click is the tap',
                `<select id="coach-calib-hit-rule-select">
                  <option value="loudest">Loudest hit</option>
                  <option value="every">Every hit</option>
                </select>`,
                'coach-calib-hit-rule-select'
              )}
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
    // choosing a calibration shows its latency; typing one makes it a latency set by hand
    q('#coach-calib-use-select').addEventListener('change', (e) => {
      const latest = latestCalibration(e.target.value);
      if (latest) q('#coach-latency-input').value = latest.offsetMs;
    });
    q('#coach-latency-input').addEventListener('input', () => {
      q('#coach-calib-use-select').value = 'hand';
    });

    q('#coach-calibrate-btn').addEventListener('click', () => {
      this.save();
      this.hide();
      window.dispatchEvent(new CustomEvent('coach-calibrate-requested'));
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
    this._showCalibrationChoices();
    q('#coach-calib-hit-rule-select').value = coachState.calibrationHitRule;
    q('#coach-min-velocity-input').value = coachState.minHitVelocity;
    q('#coach-debug-grid-check').checked = coachState.showDebugGrid;
    q('#coach-start-solo-check').checked = coachState.startWithSolo;
    q('#coach-grade-hh-foot-check').checked = coachState.gradeUnwrittenHihatFoot;
    q('#coach-metronome-vol').value = coachState.metronomeVolume;

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

  /** The calibrations to choose from: the latest of each way that has a result, and by hand. */
  _showCalibrationChoices() {
    const select = this.container.querySelector('#coach-calib-use-select');
    const options = MEASURED_METHODS.map((method) => [method, latestCalibration(method)])
      .filter(([, latest]) => latest)
      .map(([method, latest]) => {
        const day = new Date(latest.at).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
        });
        const label = `${CALIBRATION_METHOD_NAMES[method]}: ${signedMs(latest.offsetMs)} ms (${day})`;
        return `<option value="${method}">${label}</option>`;
      });
    options.push('<option value="hand">By hand</option>');
    select.innerHTML = options.join('');
    // the calibration in use, unless it has changed since (or was never one of these)
    const inUse = latestCalibration(coachState.calibrationMethod);
    select.value =
      inUse?.offsetMs === coachState.calibrationOffset ? coachState.calibrationMethod : 'hand';
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
      `<i class="fa fa-check"></i> ${signedMs(coachState.calibrationOffset)} ms, ` +
        CALIBRATION_STATUS[coachState.calibrationMethod ?? 'unknown'],
      'not calibrated'
    );
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
    const latencyMs = parseInt(q('#coach-latency-input').value) || 0;
    const method = q('#coach-calib-use-select').value;
    // an old calibration of unknown method stays as it was until something is changed
    if (latencyMs !== coachState.calibrationOffset || method !== 'hand') {
      coachState.calibrationMethod = method;
    }
    coachState.calibrationOffset = latencyMs;
    coachState.calibrationHitRule = q('#coach-calib-hit-rule-select').value;
    coachState.minHitVelocity = q('#coach-min-velocity-input').value;
    coachState.showDebugGrid = q('#coach-debug-grid-check').checked;
    coachState.startWithSolo = q('#coach-start-solo-check').checked;
    coachState.gradeUnwrittenHihatFoot = q('#coach-grade-hh-foot-check').checked;
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

/**
 * A setting's row: its name, with a line on what it means under it, and its control.
 * @param {string} name
 * @param {string} meaning - empty when the name says it all
 * @param {string} control - the control's markup
 * @param {string} [forId] - the control the name labels, so tapping the name works it
 */
function row(name, meaning, control, forId) {
  const meaningEl = meaning ? `<small>${meaning}</small>` : '';
  const label = name + meaningEl;
  const labelEl = forId
    ? `<label for="${forId}">${label}</label>`
    : `<span class="coach-settings-label">${label}</span>`;
  return `<div class="coach-settings-row">${labelEl}${control}</div>`;
}

/** A checkbox drawn as a switch. */
function switchInput(id, ariaLabel) {
  const aria = ariaLabel ? ` aria-label="${ariaLabel}"` : '';
  return `<span class="coach-settings-switch"><input type="checkbox" id="${id}"${aria}><span></span></span>`;
}

/** A number box with its unit inside, so boxes share their edges whatever their unit. */
function number(id, unit, attrs) {
  const unitEl = unit ? `<i>${unit}</i>` : '';
  return `<span class="coach-settings-num"><input type="number" id="${id}" ${attrs}>${unitEl}</span>`;
}

/** A small number box inside a sentence. */
function inlineNumber(id, ariaLabel, attrs) {
  return `<input type="number" class="coach-settings-inline" id="${id}" aria-label="${ariaLabel}" ${attrs}>`;
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
/** A number of ms with its sign, as the calibration shows it: +12, -4, +0. */
function signedMs(ms) {
  return `${ms >= 0 ? '+' : ''}${ms}`;
}

// how the status line says the calibration was set, by calibrationMethod
const CALIBRATION_STATUS = {
  mic: 'measured with the mic, drum sound',
  micStick: 'measured with the mic, stick',
  playAlong: 'by playing along',
  hand: 'set by hand',
  unknown: 'calibrated',
};
// the ways of calibrating that measure, and their names in the choice of which to use
const MEASURED_METHODS = ['playAlong', 'mic', 'micStick'];
const CALIBRATION_METHOD_NAMES = {
  playAlong: 'Play along',
  mic: 'Mic, drum sound',
  micStick: 'Mic, stick',
};

/** The latest result of one way of calibrating, or undefined if it has none. */
function latestCalibration(method) {
  return coachState.calibrationHistory.findLast((entry) => entry.method === method);
}

function status(el, ok, okHtml, missingText) {
  el.className = ok ? 'coach-settings-ok' : 'coach-settings-missing';
  el.innerHTML = ok ? okHtml : `<i class="fa fa-exclamation-circle"></i> ${missingText}`;
}
