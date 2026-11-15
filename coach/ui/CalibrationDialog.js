import { coachState } from '../state/State.js';
import { AudioClock } from '../engine/AudioClock.js';

const CALIBRATION_BPM = 80;
const BEAT_INTERVAL_MS = 60000 / CALIBRATION_BPM; // 750ms
// A run is 40 beats, the first 8 a warm-up for locking onto the click, which takes most people
// a few beats. In quarter notes that leaves 32 counted taps: with a typical tap spread of 15-20 ms
// the median is then good to about +/-3 ms; 16th notes give four times the taps.
const RUN_BEATS = 40;
const WARMUP_BEATS = 8;
// the notes the click plays (and the player with it) per beat, by coachState.calibrationRhythm
const NOTES_PER_BEAT = { quarters: 1, sixteenths: 4 };
// how loud a click between beats is, against one on the beat, so 16th notes keep their pulse
const OFF_BEAT_CLICK_GAIN = 0.5;
// clicks beyond the last counted tap, so a slightly late final tap still has a click to land on
const TRAILING_CLICKS = 2;
const COUNTDOWN_BEATS = 4;
// Well above a snare's body (roughly 150-400 Hz plus a noise band), so the click doesn't
// blur into the drum being hit on it.
const CLICK_FREQ_HZ = 2500;
const CLICK_DURATION_S = 0.03;
// gain at 100% metronome volume; just under full scale, so the click can't clip
const CLICK_MAX_GAIN = 0.9;
const TIMING_STRIP_RANGE_MS = 80; // strip shows +/- this many ms
// velocity given to a keyboard tap; one key press is the only tap on its beat
const KEYBOARD_TAP_VELOCITY = 100;
// A tap further from the run's median than this many median absolute deviations is a slip
// (a missed click, a double hit), not the player's timing; scaled by 1.4826, a MAD estimates
// the standard deviation, so this keeps taps within about 3 of them.
const OUTLIER_MADS = 3;
const MAD_TO_SD = 1.4826;

/**
 * CalibrationDialog - Tap-along latency calibration.
 *
 * Plays a metronome at 80 BPM, collects MIDI taps, and computes
 * the median timing offset to store as calibrationOffset.
 */
export class CalibrationDialog {
  constructor({ midiHandler }) {
    this.midiHandler = midiHandler;
    this._clock = null; // when the clicks are heard; created with the audio context
    this.container = null;
    this._audioCtx = null;
    this._active = false;
    this._tapErrors = []; // signed error of each tapped beat, in beat order (including warmup)
    this._tapCount = 0; // clicks that have a tap
    // the run's rhythm, set when it starts: clicks per beat, and the taps a run takes
    this._notesPerBeat = NOTES_PER_BEAT.quarters;
    this._totalTaps = RUN_BEATS;
    this._warmupTaps = WARMUP_BEATS;
    // the counted taps, as {beat, error, velocity, dot}, keyed per coachState.calibrationHitRule
    this._taps = new Map();
    this._resultMs = null; // calibration offset from the last completed run
    // when each click plays on the audio clock, in s; converted to when it is heard at each tap,
    // so a shift in the output's timing during the run is followed
    this._beatAudioTimes = [];
    this._schedulerTimer = null;
    this._pendingClicks = []; // oscillators scheduled for the tapping phase, stopped when it ends
    this._countdownLeft = 0;
    this._originalMidiOnHit = null;
    this._onKeyDown = (e) => this._handleKeyTap(e);
  }

  inject() {
    if (document.getElementById('coachCalibrationDialog')) return;

    const dialog = document.createElement('div');
    dialog.id = 'coachCalibrationDialog';
    dialog.className = 'coach-sheet';
    dialog.innerHTML = `
            <h2>Latency Calibration</h2>

            <div id="calib-instructions">
                <p id="calib-what-to-play"></p>
                <p class="calib-subtle" id="calib-warmup"></p>
                <p class="calib-subtle" id="calib-hit-rule"></p>
            </div>

            <div id="calib-countdown" style="display:none;">
                <div id="calib-countdown-number"></div>
            </div>

            <div id="calib-progress" style="display:none;">
                <div id="calib-beat-counter"></div>
                <div id="calib-beat-indicator"></div>
                <div id="calib-timing-strip">
                    <div class="calib-strip-center-line"></div>
                    <div class="calib-strip-label calib-strip-label-early">early</div>
                    <div class="calib-strip-label calib-strip-label-late">late</div>
                </div>
                <div id="calib-running-offset"></div>
            </div>

            <div id="calib-result" style="display:none;">
                <div id="calib-result-value"></div>
                <div id="calib-result-explanation"></div>
            </div>

            <div class="coach-dialog-buttons">
                <button class="coach-btn coach-btn-secondary" id="calib-cancel-btn">Cancel</button>
                <button class="coach-btn coach-btn-primary" id="calib-start-btn">Start</button>
                <button class="coach-btn coach-btn-primary" id="calib-accept-btn" style="display:none;">Accept</button>
                <button class="coach-btn coach-btn-secondary" id="calib-retry-btn" style="display:none;">Retry</button>
            </div>
        `;

    document.body.appendChild(dialog);
    this.container = dialog;

    this.container
      .querySelector('#calib-cancel-btn')
      .addEventListener('click', () => this._cancel());
    this.container
      .querySelector('#calib-start-btn')
      .addEventListener('click', () => this._startCountdown());
    this.container
      .querySelector('#calib-accept-btn')
      .addEventListener('click', () => this._accept());
    this.container.querySelector('#calib-retry-btn').addEventListener('click', () => this._retry());
  }

  show() {
    const sixteenths = coachState.calibrationRhythm === 'sixteenths';
    this.container.querySelector('#calib-what-to-play').textContent = sixteenths
      ? 'Play 16th notes on any drum pad with the metronome click, alternating hands.'
      : 'Hit any drum pad or press any key in time with the metronome click.';
    this.container.querySelector('#calib-warmup').textContent =
      `Start on the very first click. The first ${WARMUP_BEATS} beats are warm-up and ` +
      "won't count, so use them to lock in.";
    const rules = [
      coachState.calibrationHitRule === 'loudest'
        ? 'Only the loudest hit near each click counts.'
        : 'Every hit counts as a tap.',
    ];
    if (coachState.minHitVelocity > 0) {
      rules.push(`Hits softer than velocity ${coachState.minHitVelocity} are ignored.`);
    }
    this.container.querySelector('#calib-hit-rule').textContent =
      rules.join(' ') + ' (Change this in Coach settings.)';
    this._reset();
    this.container.style.display = 'block';
    this._showPhase('instructions');
  }

  hide() {
    this._stop();
    this.container.style.display = 'none';
  }

  // -- Phase management --

  _showPhase(phase) {
    const ids = {
      instructions: 'calib-instructions',
      countdown: 'calib-countdown',
      tapping: 'calib-progress',
      result: 'calib-result',
    };
    for (const [key, id] of Object.entries(ids)) {
      this.container.querySelector(`#${id}`).style.display = key === phase ? 'block' : 'none';
    }

    const startBtn = this.container.querySelector('#calib-start-btn');
    const acceptBtn = this.container.querySelector('#calib-accept-btn');
    const retryBtn = this.container.querySelector('#calib-retry-btn');
    const cancelBtn = this.container.querySelector('#calib-cancel-btn');

    startBtn.style.display = phase === 'instructions' ? '' : 'none';
    acceptBtn.style.display = phase === 'result' ? '' : 'none';
    retryBtn.style.display = phase === 'result' ? '' : 'none';
    cancelBtn.style.display = phase === 'result' ? 'none' : '';
  }

  // -- Countdown --

  _startCountdown() {
    this._notesPerBeat = NOTES_PER_BEAT[coachState.calibrationRhythm];
    this._totalTaps = RUN_BEATS * this._notesPerBeat;
    this._warmupTaps = WARMUP_BEATS * this._notesPerBeat;
    this._ensureAudioContext();
    this._showPhase('countdown');
    this._countdownLeft = COUNTDOWN_BEATS;
    this._tickCountdown();
  }

  _tickCountdown() {
    if (this._countdownLeft <= 0) {
      this._startTapping();
      return;
    }
    const el = this.container.querySelector('#calib-countdown-number');
    el.textContent = this._countdownLeft;
    el.classList.remove('calib-countdown-pulse');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('calib-countdown-pulse');

    this._playClick();
    this._countdownLeft--;
    this._schedulerTimer = setTimeout(() => this._tickCountdown(), BEAT_INTERVAL_MS);
  }

  // -- Tapping phase --

  _startTapping() {
    this._showPhase('tapping');
    this._tapErrors = [];
    this._tapCount = 0;
    this._taps = new Map();
    this._beatAudioTimes = [];

    // Clear any existing dots from a previous run
    const strip = this.container.querySelector('#calib-timing-strip');
    strip.querySelectorAll('.calib-strip-dot').forEach((d) => d.remove());

    this._updateDisplay();

    // Hook MIDI input — save original handler, replace with ours
    this._originalMidiOnHit = this.midiHandler.onHit;
    this.midiHandler.onHit = (drum, timestamp, velocity) => this._onTap(timestamp, velocity);

    // Hook keyboard input — any key counts as a tap
    document.addEventListener('keydown', this._onKeyDown);

    // Schedule all beats up front in audio time for precise timing, once the clock knows
    // when they will be heard
    this._clock
      .whenRunning()
      .then(() => {
        this._scheduleBeatClicks();
        this._active = true;
      })
      .catch((error) => {
        console.error('[CalibrationDialog] Could not time the clicks:', error);
        this._stop();
        this.container.querySelector('#calib-running-offset').textContent =
          'The audio output did not start, so calibration cannot run. Close this and try again.';
      });
  }

  _scheduleBeatClicks() {
    const audioNow = this._audioCtx.currentTime;

    // _stopPendingClicks silences the trailing clicks once tapping ends
    const noteIntervalS = this._noteIntervalMs() / 1000;
    for (let i = 0; i < this._totalTaps + TRAILING_CLICKS; i++) {
      const audioTime = audioNow + i * noteIntervalS;
      const onBeat = i % this._notesPerBeat === 0;
      this._pendingClicks.push(this._scheduleClickAt(audioTime, onBeat ? 1 : OFF_BEAT_CLICK_GAIN));
      this._beatAudioTimes.push(audioTime);
    }
  }

  _handleKeyTap(e) {
    if (!this._active) return;
    // Ignore modifier keys and repeats
    if (e.repeat || e.key === 'Escape') return;
    e.preventDefault();
    // the event's own timestamp is when the key went down; reading the clock here would
    // add however long the page took to get to this handler
    this._onTap(e.timeStamp, KEYBOARD_TAP_VELOCITY);
  }

  _onTap(timestamp, velocity) {
    if (!this._active) return;
    if (velocity < coachState.minHitVelocity) return;

    // Click times are when each click is heard, as sessions grade against when each note is
    // heard, so the calibration offset is whatever remains after the browser's output delay.
    const heardTimes = this._beatAudioTimes.map((t) => this._clock.heardAt(t));
    let beat = 0;
    for (let i = 1; i < heardTimes.length; i++) {
      const dist = (b) => Math.abs(timestamp - heardTimes[b]);
      if (dist(i) < dist(beat)) beat = i;
    }
    const error = timestamp - heardTimes[beat];

    // 'loudest' keys taps by their click, so a louder hit replaces a softer one on the same
    // click; 'every' gives each hit its own key
    const key = coachState.calibrationHitRule === 'loudest' ? beat : `hit${this._tapCount}`;
    const existing = this._taps.get(key);
    // all taps are in: only a louder hit replacing one of them still counts
    if (!existing && this._tapCount >= this._totalTaps) return;
    if (existing) {
      if (velocity <= existing.velocity) return;
      existing.error = error;
      existing.velocity = velocity;
      this._placeDot(existing.dot, error);
    } else {
      const dot = this._addDot(this._tapCount < this._warmupTaps);
      this._placeDot(dot, error);
      this._taps.set(key, { beat, error, velocity, dot });
      this._flashBeatIndicator();
    }
    this._tapCount = this._taps.size;
    // insertion order is tap order; under 'loudest' a replaced tap keeps its place
    this._tapErrors = [...this._taps.values()].map((tap) => tap.error);
    this._updateDisplay();

    if (!existing && this._tapCount === this._totalTaps) {
      if (coachState.calibrationHitRule !== 'loudest') {
        this._finishTapping();
        return;
      }
      // a louder hit can still replace this click's tap until the next click is nearer
      const beatWindowEnd = heardTimes[beat] + this._noteIntervalMs() / 2;
      setTimeout(() => this._finishTapping(), Math.max(0, beatWindowEnd - performance.now()));
    }
  }

  _addDot(isWarmup) {
    const strip = this.container.querySelector('#calib-timing-strip');
    const dot = document.createElement('div');
    dot.className = 'calib-strip-dot';
    if (isWarmup) dot.classList.add('calib-strip-dot-warmup');
    strip.appendChild(dot);
    return dot;
  }

  _placeDot(dot, error) {
    // 50% = center (0 error)
    const clampedError = Math.max(-TIMING_STRIP_RANGE_MS, Math.min(TIMING_STRIP_RANGE_MS, error));
    dot.style.left = `${50 + (clampedError / TIMING_STRIP_RANGE_MS) * 50}%`;
  }

  _flashBeatIndicator() {
    const indicator = this.container.querySelector('#calib-beat-indicator');
    indicator.classList.remove('calib-flash');
    void indicator.offsetWidth;
    indicator.classList.add('calib-flash');
  }

  _updateDisplay() {
    const counter = this.container.querySelector('#calib-beat-counter');
    counter.textContent = `${this._tapCount} / ${this._totalTaps}`;

    // Running offset (median of non-warmup taps)
    const offsetEl = this.container.querySelector('#calib-running-offset');
    const usableTaps = this._tapErrors.slice(this._warmupTaps);
    if (usableTaps.length > 0) {
      const median = this._computeMedian(usableTaps);
      const sign = median >= 0 ? '+' : '';
      offsetEl.textContent = `${sign}${median.toFixed(1)} ms`;
    } else if (this._tapCount > 0) {
      offsetEl.textContent = `warming up... (${this._warmupTaps - this._tapCount} left)`;
    } else {
      offsetEl.textContent = '';
    }
  }

  // -- Finish & results --

  _finishTapping() {
    this._active = false;
    this._stopPendingClicks();
    this._restoreMidiHandler();

    const countedTaps = this._tapErrors.slice(this._warmupTaps);
    const usableTaps = withoutSlips(countedTaps);
    const slips = countedTaps.length - usableTaps.length;
    this._resultMs = Math.round(this._computeMedian(usableTaps));
    const spread = this._computeStdDev(usableTaps);
    // standard error of the result: how far another run would typically land from this one
    const precision = spread / Math.sqrt(usableTaps.length);

    this._showPhase('result');

    const valueEl = this.container.querySelector('#calib-result-value');
    const sign = this._resultMs >= 0 ? '+' : '';
    valueEl.textContent = `${sign}${this._resultMs} ms`;

    const explEl = this.container.querySelector('#calib-result-explanation');
    const direction = this._resultMs < 0 ? 'before' : 'after';
    explEl.textContent =
      `Your taps landed ${Math.abs(this._resultMs)} ms ${direction} the click on average ` +
      `(accurate to about \u00b1${Math.round(precision)} ms). ` +
      `Taps varied by about \u00b1${Math.round(spread)} ms` +
      slipsText(slips) +
      '. Sessions are graded with this offset.';
  }

  _accept() {
    coachState.calibrationOffset = this._resultMs;
    coachState.calibrated = true;
    coachState.save();

    this.hide();
    window.dispatchEvent(new CustomEvent('calibration-accepted'));
  }

  _retry() {
    this._reset();
    this._showPhase('instructions');
  }

  _cancel() {
    this.hide();
    window.dispatchEvent(new CustomEvent('calibration-cancelled'));
  }

  // -- Audio --

  _ensureAudioContext() {
    if (!this._audioCtx) {
      // Reuse the MIDI player's context if available, otherwise create one
      if (typeof MIDI !== 'undefined' && MIDI.Player?.ctx) {
        this._audioCtx = MIDI.Player.ctx;
      } else {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
    }
    // Resume if suspended (autoplay policy)
    if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume();
    }
    if (!this._clock) {
      this._clock = new AudioClock(this._audioCtx);
      this._clock.start();
    }
  }

  _playClick() {
    this._ensureAudioContext();
    this._scheduleClickAt(this._audioCtx.currentTime);
  }

  /** The time between clicks while tapping, in ms. */
  _noteIntervalMs() {
    return BEAT_INTERVAL_MS / this._notesPerBeat;
  }

  /**
   * @param {number} audioTime - when the click plays, on the audio clock, in s
   * @param {number} [relativeGain] - its loudness against a click on the beat
   */
  _scheduleClickAt(audioTime, relativeGain = 1) {
    const ctx = this._audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = CLICK_FREQ_HZ;
    osc.type = 'sine';
    const clickGain = CLICK_MAX_GAIN * relativeGain * (coachState.metronomeVolume / 100);
    gain.gain.setValueAtTime(clickGain, audioTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + CLICK_DURATION_S);
    osc.start(audioTime);
    osc.stop(audioTime + CLICK_DURATION_S);
    return osc;
  }

  _stopPendingClicks() {
    for (const osc of this._pendingClicks) osc.stop();
    this._pendingClicks = [];
  }

  // -- Helpers --

  _computeStdDev(values) {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  }

  _computeMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  _reset() {
    this._stop();
    this._resultMs = null;
    this._tapErrors = [];
    this._tapCount = 0;
    this._taps = new Map();
    this._beatAudioTimes = [];

    // Clear timing strip dots
    if (this.container) {
      const strip = this.container.querySelector('#calib-timing-strip');
      if (strip) strip.querySelectorAll('.calib-strip-dot').forEach((d) => d.remove());
    }
  }

  _stop() {
    this._active = false;
    this._stopPendingClicks();
    if (this._schedulerTimer) {
      clearTimeout(this._schedulerTimer);
      this._schedulerTimer = null;
    }
    this._restoreMidiHandler();
    document.removeEventListener('keydown', this._onKeyDown);
    if (this._clock) {
      this._clock.stop();
      this._clock = null;
    }
  }

  _restoreMidiHandler() {
    if (this._originalMidiOnHit) {
      this.midiHandler.onHit = this._originalMidiOnHit;
      this._originalMidiOnHit = null;
    }
  }
}

/**
 * The taps without the slips: those further from the median than OUTLIER_MADS deviations.
 * @param {number[]} errors - tap timing errors, ms
 * @returns {number[]}
 */
function withoutSlips(errors) {
  const median = medianOf(errors);
  const mad = medianOf(errors.map((e) => Math.abs(e - median))) * MAD_TO_SD;
  // every tap equally far off: nothing stands out as a slip
  if (mad < Number.EPSILON) return errors;
  return errors.filter((e) => Math.abs(e - median) <= OUTLIER_MADS * mad);
}

/** How many far-off taps were left out, as a clause; empty when none were. */
function slipsText(slips) {
  if (slips === 0) return '';
  return `, leaving out ${slips} far-off ${slips === 1 ? 'tap' : 'taps'}`;
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
