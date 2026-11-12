import { coachState } from '../state/State.js';

/**
 * SettingsDialog - Manages the settings UI
 */
export class SettingsDialog {
  constructor() {
    this.container = null;
  }

  inject() {
    if (document.getElementById('coachSettingsDialog')) return;

    const dialog = document.createElement('div');
    dialog.id = 'coachSettingsDialog';
    dialog.innerHTML = `
      <h2>Drum Coach Settings</h2>
      
      <div class="coach-setting-row">
        <label>Coach Mode</label>
        <select id="coach-mode-select">
          <option value="practice">Practice (Infinite)</option>
          <option value="performance">Performance (Scored)</option>
        </select>
      </div>
      
      <div id="performance-options" style="display: none;">
        <div class="coach-setting-row">
          <label>Repetitions</label>
          <input type="number" id="coach-reps-input" min="2" max="16" value="4">
        </div>
        <div class="coach-setting-row">
          <label>Few Mistakes Up To</label>
          <span class="coach-latency-group">
            <input type="number" id="coach-few-mistakes-input" min="0" max="100" step="1"> % of notes
          </span>
        </div>
      </div>

      <div id="practice-options">
        <div class="coach-setting-row">
          <label>Auto BPM</label>
          <span class="coach-latency-group">
            <input type="checkbox" id="coach-auto-bpm-check"> +5 when a pass meets the goal
          </span>
        </div>
        <div class="coach-setting-row">
          <label>Passes in a Row</label>
          <input type="number" id="coach-auto-bpm-passes-input" min="1" step="1">
        </div>
      </div>

      <div class="coach-setting-row">
        <label>Goal: Blue</label>
        <span class="coach-latency-group">
          at least <input type="number" id="coach-goal-blue-input" min="0" max="100" step="1"> %
        </span>
      </div>

      <div class="coach-setting-row">
        <label>Goal: Yellow</label>
        <span class="coach-latency-group">
          at most <input type="number" id="coach-goal-yellow-input" min="0" max="100" step="1"> %
        </span>
      </div>
      
      <div class="coach-setting-row">
        <label>Count-in</label>
        <input type="checkbox" id="coach-countin-check" checked>
      </div>
      
      <div class="coach-setting-row">
        <label>Tolerance</label>
        <select id="coach-tolerance-select">
          <option value="strict">Strict (±15ms)</option>
          <option value="normal" selected>Normal (±30ms)</option>
          <option value="relaxed">Relaxed (±50ms)</option>
        </select>
      </div>

      <div class="coach-setting-row">
        <label>Drum Mapping</label>
        <button class="coach-btn coach-btn-calibrate" id="coach-drummap-btn">General MIDI</button>
      </div>
      <div id="coach-drummap-hint" class="coach-calib-hint" style="display:none;">Not configured</div>

      <div class="coach-setting-row">
        <label>Latency Offset</label>
        <span class="coach-latency-group">
          <input type="number" id="coach-latency-input" step="1" value="0"> ms
          <button class="coach-btn coach-btn-calibrate" id="coach-calibrate-btn">Calibrate</button>
        </span>
      </div>
      <div id="coach-calib-hint" class="coach-calib-hint" style="display:none;">Not calibrated</div>

      <div class="coach-setting-row">
        <label>Calibration Counts</label>
        <select id="coach-calib-hit-rule-select">
          <option value="loudest">Loudest hit per click</option>
          <option value="every">Every hit</option>
        </select>
      </div>

      <div class="coach-setting-row">
        <label>Ignore Hits Below</label>
        <span class="coach-latency-group">
          <input type="number" id="coach-min-velocity-input" min="0" max="127" step="1" value="0"> velocity (0 = off)
        </span>
      </div>

      <div class="coach-setting-row">
        <label>Metronome Vol</label>
        <span class="coach-slider-group">
          <input type="range" id="coach-metronome-vol" min="0" max="100" value="100">
          <span id="coach-metronome-vol-label">100%</span>
        </span>
      </div>

      <div class="coach-setting-row">
        <label>Start in Solo</label>
        <input type="checkbox" id="coach-start-solo-check" checked>
      </div>

      <div class="coach-setting-row">
        <label>Debug Grid</label>
        <input type="checkbox" id="coach-debug-grid-check">
      </div>

      <div class="coach-dialog-buttons">
        <button class="coach-btn coach-btn-secondary" id="coach-cancel-btn">Cancel</button>
        <button class="coach-btn coach-btn-primary" id="coach-start-btn">Start Session</button>
      </div>
    `;

    document.body.appendChild(dialog);
    this.container = dialog;
    this._setupEventListeners();
  }

  _setupEventListeners() {
    const modeSelect = this.container.querySelector('#coach-mode-select');
    const perfOptions = this.container.querySelector('#performance-options');
    const startBtn = this.container.querySelector('#coach-start-btn');
    const cancelBtn = this.container.querySelector('#coach-cancel-btn');

    const practiceOptions = this.container.querySelector('#practice-options');
    modeSelect.addEventListener('change', () => {
      perfOptions.style.display = modeSelect.value === 'performance' ? 'block' : 'none';
      practiceOptions.style.display = modeSelect.value === 'practice' ? 'block' : 'none';
    });

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
    this.container.querySelector('#coach-mode-select').value = coachState.mode;
    this.container.querySelector('#coach-reps-input').value = coachState.reps;
    this.container.querySelector('#coach-countin-check').checked = coachState.countIn;
    this.container.querySelector('#coach-tolerance-select').value = coachState.tolerance;
    this.container.querySelector('#coach-latency-input').value = coachState.calibrationOffset;
    this.container.querySelector('#coach-calib-hit-rule-select').value =
      coachState.calibrationHitRule;
    this.container.querySelector('#coach-min-velocity-input').value = coachState.minHitVelocity;
    this.container.querySelector('#coach-debug-grid-check').checked = coachState.showDebugGrid;
    this.container.querySelector('#coach-start-solo-check').checked = coachState.startWithSolo;
    this.container.querySelector('#coach-metronome-vol').value = coachState.metronomeVolume;
    this.container.querySelector('#coach-metronome-vol-label').textContent =
      coachState.metronomeVolume + '%';

    this.container.querySelector('#performance-options').style.display =
      coachState.mode === 'performance' ? 'block' : 'none';
    this.container.querySelector('#practice-options').style.display =
      coachState.mode === 'practice' ? 'block' : 'none';
    this.container.querySelector('#coach-few-mistakes-input').value = coachState.fewMistakesPercent;
    this.container.querySelector('#coach-auto-bpm-check').checked = coachState.autoBpm;
    this.container.querySelector('#coach-auto-bpm-passes-input').value = coachState.autoBpmPasses;
    this.container.querySelector('#coach-goal-blue-input').value = coachState.goalMinPerfectPercent;
    this.container.querySelector('#coach-goal-yellow-input').value = coachState.goalMaxClosePercent;

    this.container.querySelector('#coach-calib-hint').style.display = coachState.calibrated
      ? 'none'
      : 'block';

    // Update drum mapping button label
    const drumMapBtn = this.container.querySelector('#coach-drummap-btn');
    if (coachState.drumMapPreset === 'custom') {
      drumMapBtn.textContent = 'Custom';
    } else {
      drumMapBtn.textContent =
        coachState.drumMapPreset === '_gm' ? 'General MIDI' : coachState.drumMapPreset;
    }
    this.container.querySelector('#coach-drummap-hint').style.display = coachState.drumMapConfigured
      ? 'none'
      : 'block';

    this.container.style.display = 'block';
  }

  hide() {
    this.container.style.display = 'none';
  }

  save() {
    coachState.mode = this.container.querySelector('#coach-mode-select').value;
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
    coachState.save();
  }
}
