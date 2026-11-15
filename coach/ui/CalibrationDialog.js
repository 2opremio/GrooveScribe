import { coachState } from '../state/State.js';
import { AudioClock } from '../engine/AudioClock.js';
import {
  CalibrationRun,
  CALIBRATION_RHYTHMS,
  CLICK_NOTES_PER_BEAT,
  SETTLE_TAPS,
} from '../engine/CalibrationRun.js';

const CALIBRATION_BPM = 80;
const BEAT_INTERVAL_MS = 60000 / CALIBRATION_BPM; // 750ms
const MS_PER_S = 1000;
const CLICK_INTERVAL_S = BEAT_INTERVAL_MS / CLICK_NOTES_PER_BEAT / MS_PER_S;
// how far ahead clicks are queued on the audio clock, and how often more are queued: the
// queueing timer can run late by far less than the lead without a click coming late
const CLICK_LEAD_S = 0.5;
const CLICK_QUEUE_INTERVAL_MS = 100;
// time from pressing Start to the first click, so it isn't queued in the past
const FIRST_CLICK_DELAY_S = 0.1;
// Well above a snare's body (roughly 150-400 Hz plus a noise band), so the click doesn't
// blur into the drum being hit on it.
const CLICK_FREQ_HZ = 2500;
const CLICK_DURATION_S = 0.03;
// gain at 100% metronome volume; just under full scale, so the click can't clip
const CLICK_MAX_GAIN = 0.9;
// how loud a click between beats is, against one on the beat, so the 16ths keep their pulse
const OFF_BEAT_CLICK_GAIN = 0.35;
const TIMING_STRIP_RANGE_MS = 80; // strip shows +/- this many ms
// hits shown on the strip; older ones fade and go, so the strip shows where the player is now
const STRIP_DOTS = 24;
// velocity given to a keyboard tap; one key press is the only tap on its beat
const KEYBOARD_TAP_VELOCITY = 100;
// keys that keep their own job during a run: moving between and pressing the buttons
const NON_TAP_KEYS = new Set(['Tab', 'Enter', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
// how long a message about one hit (a drift, a hit too soft to count) stays up to be read
const HIT_MESSAGE_MS = 3000;
// with no hit for this long (4 beats) after the click starts, the kit may not be reaching us
const NO_HIT_HINT_MS = 4 * BEAT_INTERVAL_MS;
// with no hit for this long mid-run, the player has stopped
const PAUSE_HINT_MS = 4 * BEAT_INTERVAL_MS;
// hits after which a rhythm should have been recognised (the first 7 are needed to tell)
const RHYTHM_HINT_HITS = 12;
// how often the hints that come from time passing (no hits, a pause) are refreshed
const HINT_REFRESH_MS = 250;
const PERCENT = 100;
// beats in the play-along picture: one bar of 4/4
const DIAGRAM_BEATS = 4;

/**
 * CalibrationDialog - Measures the player's latency: how far from a click, as heard, their hits
 * arrive.
 *
 * The click plays 16ths at 80 BPM, accented on the beat. The player plays quarter notes, 8ths or
 * 16ths with it; CalibrationRun tells which, waits for the hits to settle, and measures until the
 * result is steady and precise. Only then can it be accepted as calibrationOffset.
 */
export class CalibrationDialog {
  constructor({ midiHandler }) {
    this.midiHandler = midiHandler;
    this._clock = null; // when the clicks are heard; created with the audio context
    this.container = null;
    this._audioCtx = null;
    this._run = null; // the CalibrationRun being played
    this._status = null; // the run's status after the last hit
    this._resultMs = null; // calibration offset from the last completed run
    this._firstClickAudioTime = null; // when the run's first click plays, on the audio clock (s)
    this._nextClick = 0; // index of the next click to queue
    this._clickQueueTimer = null;
    this._hintTimer = null;
    this._pendingClicks = []; // oscillators queued and not yet played, stopped when the run ends
    this._originalMidiOnHit = null;
    this._startedMs = null; // when the click started, performance.now()
    this._hits = 0; // hits that counted, this run
    this._lastHitMs = null; // when the last one landed, performance.now() domain
    // a message about one hit, {title?, hint, untilMs}, shown until untilMs
    this._hitMessage = null;
    this._onKeyDown = (e) => this._handleKey(e);
  }

  inject() {
    if (document.getElementById('coachCalibrationDialog')) return;

    const dialog = document.createElement('div');
    dialog.id = 'coachCalibrationDialog';
    dialog.className = 'coach-sheet';
    dialog.innerHTML = `
            <h2>Timing calibration</h2>

            <div id="calib-instructions">
                <p>Your kit and the computer each add a little delay. Play along with a click for
                about a minute so the coach can measure it and judge early and late fairly.</p>
                <p>Hit along with the click on any pad you've mapped, or tap any key. Pick one way
                and keep it up:</p>
                ${playAlongDiagram()}
                <p class="calib-subtle">It finishes by itself once your hits are steady. Being a
                little early or late is fine, as long as you stay put.</p>
                <p class="calib-subtle" id="calib-hit-rule"></p>
            </div>

            <div id="calib-progress" style="display:none;">
                <div id="calib-status" aria-live="polite"></div>
                <div id="calib-hint"></div>
                <div id="calib-beat-indicator"></div>
                <div id="calib-timing-strip">
                    <div class="calib-strip-center-line"></div>
                    <div id="calib-strip-median" style="display:none;"></div>
                    <div class="calib-strip-label calib-strip-label-early">early</div>
                    <div class="calib-strip-label calib-strip-label-late">late</div>
                </div>
                <div class="calib-strip-caption">Each dot is a hit. Center line: on the click.
                Dark bar: your typical timing.</div>
                <div id="calib-progress-track"><div id="calib-progress-fill"></div></div>
                <div id="calib-details"></div>
            </div>

            <div id="calib-result" style="display:none;">
                <div id="calib-result-value"></div>
                <div id="calib-result-explanation"></div>
                <div id="calib-result-details"></div>
            </div>

            <div class="coach-dialog-buttons">
                <button class="coach-btn coach-btn-secondary" id="calib-cancel-btn">Cancel</button>
                <button class="coach-btn coach-btn-primary" id="calib-start-btn">Start</button>
                <button class="coach-btn coach-btn-primary" id="calib-accept-btn" style="display:none;">Accept</button>
                <button class="coach-btn coach-btn-secondary" id="calib-retry-btn" style="display:none;">Try again</button>
            </div>
        `;

    document.body.appendChild(dialog);
    this.container = dialog;

    this._q('#calib-cancel-btn').addEventListener('click', () => this._cancel());
    this._q('#calib-start-btn').addEventListener('click', () => this._start());
    this._q('#calib-accept-btn').addEventListener('click', () => this._accept());
    this._q('#calib-retry-btn').addEventListener('click', () => this._retry());
  }

  show() {
    const rules = [
      coachState.calibrationHitRule === 'loudest'
        ? 'Only the loudest hit on each click counts.'
        : 'Every hit counts.',
    ];
    if (coachState.minHitVelocity > 0) {
      rules.push(`Very soft hits (below velocity ${coachState.minHitVelocity}) don't count.`);
    }
    this._q('#calib-hit-rule').textContent = rules.join(' ') + ' (Change this in Coach settings.)';
    this._stop();
    this.container.style.display = 'block';
    this._showPhase('instructions');
  }

  hide() {
    this._stop();
    this.container.style.display = 'none';
  }

  _q(selector) {
    return this.container.querySelector(selector);
  }

  /** @param {'instructions'|'running'|'result'} phase */
  _showPhase(phase) {
    const ids = {
      instructions: 'calib-instructions',
      running: 'calib-progress',
      result: 'calib-result',
    };
    for (const [key, id] of Object.entries(ids)) {
      this._q(`#${id}`).style.display = key === phase ? 'block' : 'none';
    }
    this._q('#calib-start-btn').style.display = phase === 'instructions' ? '' : 'none';
    this._q('#calib-retry-btn').style.display = phase === 'result' ? '' : 'none';
    // Accept appears with a result, and only a finished run has one
    this._q('#calib-accept-btn').style.display =
      phase === 'result' && this._resultMs !== null ? '' : 'none';
  }

  // -- Running --

  _start() {
    this._resultMs = null;
    this._hitMessage = null;
    this._hits = 0;
    this._lastHitMs = null;
    this._run = new CalibrationRun({
      beatMs: BEAT_INTERVAL_MS,
      hitRule: coachState.calibrationHitRule,
    });
    this._status = this._run.status();
    this._q('#calib-timing-strip')
      .querySelectorAll('.calib-strip-dot')
      .forEach((d) => d.remove());
    this._showPhase('running');

    this._ensureAudioContext();
    this._originalMidiOnHit = this.midiHandler.onHit;
    this.midiHandler.onHit = (drum, timestamp, velocity) => this._onTap(timestamp, velocity);
    document.addEventListener('keydown', this._onKeyDown);

    // the clicks are timed by when they will be heard, so they start once the clock knows that
    this._clock
      .whenRunning()
      .then(() => {
        this._firstClickAudioTime = this._audioCtx.currentTime + FIRST_CLICK_DELAY_S;
        this._startedMs = performance.now();
        this._nextClick = 0;
        this._queueClicks();
        this._clickQueueTimer = setInterval(() => this._queueClicks(), CLICK_QUEUE_INTERVAL_MS);
        this._hintTimer = setInterval(() => this._render(), HINT_REFRESH_MS);
        this._render();
      })
      .catch((error) => {
        console.error('[CalibrationDialog] Could not time the clicks:', error);
        this._stop();
        this._showFailure(
          'The audio output did not start, so the click could not be timed.',
          'Close this, check that no other app is using the audio device, and try again.'
        );
      });
    this._render();
  }

  /** Queue the clicks due within the next CLICK_LEAD_S. */
  _queueClicks() {
    const until = this._audioCtx.currentTime + CLICK_LEAD_S;
    for (;;) {
      const audioTime = this._firstClickAudioTime + this._nextClick * CLICK_INTERVAL_S;
      if (audioTime > until) break;
      const onBeat = this._nextClick % CLICK_NOTES_PER_BEAT === 0;
      const osc = this._scheduleClickAt(audioTime, onBeat ? 1 : OFF_BEAT_CLICK_GAIN);
      this._pendingClicks.push(osc);
      osc.onended = () => {
        // a stopped run has already let go of its clicks
        const queued = this._pendingClicks.indexOf(osc);
        if (queued >= 0) this._pendingClicks.splice(queued, 1);
      };
      this._nextClick++;
    }
  }

  _handleKey(e) {
    if (e.key === 'Escape') {
      this._cancel();
      return;
    }
    if (e.repeat || NON_TAP_KEYS.has(e.key)) return;
    e.preventDefault();
    // the event's own timestamp is when the key went down; reading the clock here would
    // add however long the page took to get to this handler
    this._onTap(e.timeStamp, KEYBOARD_TAP_VELOCITY);
  }

  _onTap(timestamp, velocity) {
    if (this._firstClickAudioTime === null) return; // no click yet to play along with
    if (velocity < coachState.minHitVelocity) {
      this._flashBeatIndicator(false);
      this._hitMessage = {
        hint: `Too soft to count (velocity ${velocity}, minimum ${coachState.minHitVelocity}).`,
        untilMs: timestamp + HIT_MESSAGE_MS,
      };
      this._render();
      return;
    }
    this._flashBeatIndicator(true);
    this._hits++;
    this._lastHitMs = timestamp;

    // Click times are when each click is heard, as sessions grade against when each note is
    // heard, so the calibration offset is whatever remains after the browser's output delay.
    // Converted at each hit, so a shift in the output's timing during the run is followed.
    const fromFirstClickMs = timestamp - this._clock.heardAt(this._firstClickAudioTime);
    const hit = this._run.addTap(fromFirstClickMs, velocity);
    if (hit) this._addDot(hit.errorMs);

    this._status = this._run.status();
    if (this._status.phase === 'done') this._finish(this._status);
    else if (this._status.phase === 'failed') this._fail(this._status);
    else {
      if (this._status.drift) {
        this._hitMessage = {
          title: 'Your timing moved',
          hint: 'That’s fine: keep it right where it is now. Measuring again from your latest hits.',
          untilMs: timestamp + HIT_MESSAGE_MS,
        };
      }
      this._render();
    }
  }

  /** Show where the run is: what to do now, the progress, and the numbers. */
  _render() {
    const status = this._status;
    const now = performance.now();
    const message = this._hitMessage && now < this._hitMessage.untilMs ? this._hitMessage : null;
    const said = this._situation(status, now);
    this._q('#calib-status').textContent = (message && message.title) || said.title;
    this._q('#calib-hint').textContent = message ? message.hint : said.hint;

    const settling = status.phase === 'settling';
    this._q('#calib-progress-fill').style.width = `${(settling ? 0 : status.progress) * PERCENT}%`;
    const median = this._q('#calib-strip-median');
    median.style.display = status.offsetMs === null ? 'none' : 'block';
    if (status.offsetMs !== null) median.style.left = stripPosition(status.offsetMs);

    // the numbers, for players who want them
    const details = [];
    if (status.rhythm) details.push(CALIBRATION_RHYTHMS[status.rhythm].label);
    if (status.offsetMs !== null) details.push(`median ${signed(status.offsetMs)} ms`);
    if (status.spreadMs !== null) details.push(`spread ±${Math.round(status.spreadMs)} ms`);
    if (status.timeLeftMs !== null) {
      details.push(`about ${Math.ceil(status.timeLeftMs / MS_PER_S)} s to go`);
    }
    this._q('#calib-details').textContent = details.join(' · ');
  }

  /** What is happening and what to do about it, from the run's status and the time. */
  _situation(status, now) {
    if (this._startedMs === null) return { title: 'Starting the click…', hint: '' };
    if (this._hits === 0) {
      return now - this._startedMs < NO_HIT_HINT_MS
        ? { title: 'Start playing whenever you’re ready', hint: 'The loud click is the beat.' }
        : {
            title: 'Can’t hear you yet',
            hint: 'Check that your kit is connected and the pad is mapped, or tap any key.',
          };
    }
    if (now - this._lastHitMs > PAUSE_HINT_MS) {
      return { title: 'Paused', hint: 'Keep playing with the click to carry on.' };
    }
    switch (status.phase) {
      case 'listening':
        return this._hits < RHYTHM_HINT_HITS
          ? { title: 'Listening…', hint: 'Keep one steady way of playing along.' }
          : { title: 'Can’t tell your rhythm', hint: 'Hit once on every loud click.' };
      case 'settling':
        return status.offBeat
          ? { title: 'You’re between clicks', hint: 'Hit on the loud click.' }
          : {
              title: 'Getting in sync',
              hint: `Keep hitting with the click: ${status.settledTaps} of ${SETTLE_TAPS}.`,
            };
      default:
        return { title: 'Measuring', hint: 'Steady. Keep going until the bar fills.' };
    }
  }

  _addDot(errorMs) {
    const strip = this._q('#calib-timing-strip');
    const dot = document.createElement('div');
    dot.className = 'calib-strip-dot';
    dot.style.left = stripPosition(errorMs);
    strip.appendChild(dot);
    const dots = [...strip.querySelectorAll('.calib-strip-dot')];
    const old = dots.length - STRIP_DOTS;
    for (let i = 0; i < old; i++) dots[i].remove();
    // older hits fade, so the newest stand out
    dots.slice(Math.max(0, old)).forEach((d, i, kept) => {
      d.style.opacity = String((i + 1) / kept.length);
    });
  }

  /** @param {boolean} counted - whether the hit counted; one too soft flashes grey */
  _flashBeatIndicator(counted) {
    const indicator = this._q('#calib-beat-indicator');
    indicator.classList.remove('calib-flash', 'calib-flash-soft');
    void indicator.offsetWidth;
    indicator.classList.add(counted ? 'calib-flash' : 'calib-flash-soft');
  }

  // -- Finish & results --

  _finish(status) {
    const previousMs = coachState.calibrated ? coachState.calibrationOffset : null;
    this._stop();
    this._resultMs = Math.round(status.offsetMs);
    const direction = this._resultMs < 0 ? 'before' : 'after';
    this._showResult(
      `${signed(this._resultMs)} ms`,
      `Your hits reach the coach ${Math.abs(this._resultMs)} ms ${direction} the click: your ` +
        'kit, the computer and your own feel together. Sessions take this into account, so ' +
        'playing the way you just did counts as on time.',
      `${CALIBRATION_RHYTHMS[status.rhythm].label}: median of ${status.measuredTaps} hits, ` +
        `spread ±${Math.round(status.spreadMs)} ms, ±${status.precisionMs.toFixed(1)} ms ` +
        'standard error.' +
        (previousMs === null ? '' : ` Was ${signed(previousMs)} ms.`)
    );
  }

  _fail(status) {
    this._stop();
    const numbers = [];
    if (status.spreadMs !== null) numbers.push(`spread ±${Math.round(status.spreadMs)} ms`);
    if (status.precisionMs !== null) {
      numbers.push(`reached ±${status.precisionMs.toFixed(1)} ms of the ±3 needed`);
    }
    const details = numbers.length ? `${numbers.join(', ')}.` : '';
    if (status.failure === 'offbeat') {
      this._showFailure(
        'Your hits were a whole click away from the beat.',
        'Try again and hit on the loud click.',
        details
      );
    } else if (status.failure === 'drifting') {
      this._showFailure(
        'Your timing kept moving, so there was no steady value to take.',
        'Try again and settle into one feel: a little early or late is fine, as long as it stays put.',
        details
      );
    } else {
      this._showFailure(
        'Your hits were too spread out to measure in time.',
        status.rhythm === 'sixteenths'
          ? 'Try again, relaxed, at a volume where you hear every click.'
          : 'Try hitting on every click, loud and soft: more hits give a result sooner.',
        details
      );
    }
  }

  _showFailure(problem, advice, details = '') {
    this._resultMs = null;
    this._showResult('No result', `${problem} ${advice}`, details);
  }

  _showResult(value, explanation, details) {
    this._q('#calib-result-value').textContent = value;
    this._q('#calib-result-explanation').textContent = explanation;
    this._q('#calib-result-details').textContent = details;
    this._showPhase('result');
  }

  _accept() {
    coachState.calibrationOffset = this._resultMs;
    coachState.calibrated = true;
    coachState.save();

    this.hide();
    window.dispatchEvent(new CustomEvent('calibration-accepted'));
  }

  _retry() {
    this._resultMs = null;
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

  /**
   * @param {number} audioTime - when the click plays, on the audio clock, in s
   * @param {number} relativeGain - its loudness against a click on the beat
   */
  _scheduleClickAt(audioTime, relativeGain) {
    const ctx = this._audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = CLICK_FREQ_HZ;
    osc.type = 'sine';
    const clickGain = CLICK_MAX_GAIN * relativeGain * (coachState.metronomeVolume / PERCENT);
    gain.gain.setValueAtTime(clickGain, audioTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + CLICK_DURATION_S);
    osc.start(audioTime);
    osc.stop(audioTime + CLICK_DURATION_S);
    return osc;
  }

  /** Stop the click and stop listening. */
  _stop() {
    clearInterval(this._clickQueueTimer);
    this._clickQueueTimer = null;
    clearInterval(this._hintTimer);
    this._hintTimer = null;
    for (const osc of this._pendingClicks) osc.stop();
    this._pendingClicks = [];
    this._firstClickAudioTime = null;
    this._startedMs = null;
    if (this._originalMidiOnHit) {
      this.midiHandler.onHit = this._originalMidiOnHit;
      this._originalMidiOnHit = null;
    }
    document.removeEventListener('keydown', this._onKeyDown);
    if (this._clock) {
      this._clock.stop();
      this._clock = null;
    }
  }
}

/**
 * One bar of the click, and the three ways to play along with it, as a picture: the click's
 * 16 notes with the four beats taller, then a dot on each note each way hits.
 */
function playAlongDiagram() {
  const ways = [
    ['Loud clicks only', 'easiest', CALIBRATION_RHYTHMS.quarters.notesPerBeat],
    ['Every other click', '', CALIBRATION_RHYTHMS.eighths.notesPerBeat],
    ['Every click', 'quickest', CALIBRATION_RHYTHMS.sixteenths.notesPerBeat],
  ];
  const left = 150;
  const step = 16;
  const rowHeight = 26;
  const notes = CLICK_NOTES_PER_BEAT * DIAGRAM_BEATS;
  const x = (i) => left + i * step + step / 2;
  const ticks = Array.from({ length: notes }, (_, i) => {
    const beat = i % CLICK_NOTES_PER_BEAT === 0;
    const top = beat ? 4 : 12;
    return `<line x1="${x(i)}" y1="${top}" x2="${x(i)}" y2="22" class="${beat ? 'calib-tick-beat' : 'calib-tick'}"/>`;
  }).join('');
  const rows = ways
    .map(([name, note, perBeat], r) => {
      const y = 22 + rowHeight * (r + 1) - 8;
      const dots = Array.from({ length: notes }, (_, i) => i)
        .filter((i) => i % (CLICK_NOTES_PER_BEAT / perBeat) === 0)
        .map((i) => `<circle cx="${x(i)}" cy="${y}" r="4.5" class="calib-hit-dot"/>`)
        .join('');
      const label = note ? `${name} <tspan class="calib-diagram-note">(${note})</tspan>` : name;
      return `<text x="0" y="${y + 4}" class="calib-diagram-label">${label}</text>${dots}`;
    })
    .join('');
  const height = 22 + rowHeight * ways.length + 4;
  const width = left + notes * step;
  return `<svg id="calib-diagram" viewBox="0 0 ${width} ${height}" role="img"
      aria-label="The click plays every 16th note, loud on the beat. Hit on the loud clicks, on every other click, or on every click.">
      <text x="0" y="17" class="calib-diagram-label">Click</text>${ticks}${rows}</svg>`;
}

/** Where an offset sits on the timing strip, as a CSS left. */
function stripPosition(ms) {
  const clamped = Math.max(-TIMING_STRIP_RANGE_MS, Math.min(TIMING_STRIP_RANGE_MS, ms));
  return `${50 + (clamped / TIMING_STRIP_RANGE_MS) * 50}%`;
}

function signed(ms) {
  const rounded = Math.round(ms);
  return `${rounded >= 0 ? '+' : ''}${rounded}`;
}
