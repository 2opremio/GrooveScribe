import { coachState } from '../state/State.js';
import { AudioClock } from '../engine/AudioClock.js';
import { scheduleCalibrationClick } from '../engine/CalibrationClick.js';
import { drumOSMicName } from '../engine/MicRecorder.js';
import { MicCalibration } from './MicCalibration.js';
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
 * Playing along is the way; when DrumOS offers a mic, the system can also be measured alone with
 * it (MicCalibration), or both in turn and compared, until it's settled which to use. For playing
 * along the click plays 16ths at 80 BPM, accented on the beat. The
 * player plays quarter notes, 8ths or 16ths with it; CalibrationRun tells which, waits for the
 * hits to settle, and measures until the result is steady and precise. Only then can it be
 * accepted as calibrationOffset.
 */
export class CalibrationDialog {
  constructor({ midiHandler }) {
    this.midiHandler = midiHandler;
    this._clock = null; // when the clicks are heard; created with the audio context
    this.container = null;
    this._audioCtx = null;
    this._run = null; // the CalibrationRun being played
    this._status = null; // the run's status after the last hit
    // what the result screen offers to use: one way's result, the mic's two, or a comparison;
    // null while there is none to accept
    this._resultKind = null;
    this._method = null; // 'playAlong', 'mic' or 'both', the way chosen
    // results of this calibration, in ms, by method; 'both' fills both and compares them
    this._results = { playAlong: null, mic: null, micStick: null };
    this._micName = drumOSMicName();
    this._mic = null; // the MicCalibration, when there is a mic
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

            <div id="calib-choice">
                <p>Your kit and the computer each add a little delay. The coach measures it so
                early and late are judged fairly. Choose how:</p>
                <button type="button" class="calib-choice" id="calib-choose-play">
                    <span class="calib-choice-title"><i class="fa fa-music"></i> Play along
                        <span class="calib-choice-tag">usual</span></span>
                    <span class="calib-choice-text">Play with a click for about a minute. If you
                    tend to play a bit early or late, that becomes your “on time”.</span>
                </button>
                <button type="button" class="calib-choice" id="calib-choose-mic">
                    <span class="calib-choice-title"><i class="fa fa-microphone"></i> Measure with the mic</span>
                    <span class="calib-choice-text">Needs the mic (<span class="calib-mic-name"></span>),
                    your headphones and a stick. Measures only your kit and computer, so sessions show
                    how early or late you really play. About a minute.</span>
                </button>
                <button type="button" class="calib-choice" id="calib-choose-both">
                    <span class="calib-choice-title"><i class="fa fa-balance-scale"></i> Both, and compare</span>
                    <span class="calib-choice-text">The mic, then playing along. Shows how much of
                    the number is your own feel, then you choose which to use. About two minutes.</span>
                </button>
            </div>

            <div id="calib-mic">${MicCalibration.panelHtml()}</div>

            <div id="calib-instructions">
                <p id="calib-intro">Your kit and the computer each add a little delay. Play along
                with a click for about a minute so the coach can measure it and judge early and
                late fairly.</p>
                <p id="calib-both-lead"></p>
                <p>Hit any pad you've mapped (or tap any key) along with the click. Any of these
                ways works; just keep to the same one the whole time:</p>
                ${playAlongDiagram()}
                <p><strong>Hitting on every click works best</strong> and finishes soonest. New to
                this? Hitting only on the loud clicks is fine too, it just takes a little longer.</p>
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
                <button class="coach-btn coach-btn-secondary" id="calib-back-btn" style="display:none;">Back</button>
                <button class="coach-btn coach-btn-secondary" id="calib-retry-btn" style="display:none;">Try again</button>
                <button class="coach-btn coach-btn-primary" id="calib-start-btn">Start</button>
                <button class="coach-btn coach-btn-primary" id="calib-continue-btn" style="display:none;">Continue</button>
                <button class="coach-btn coach-btn-secondary" id="calib-accept-stick-btn" style="display:none;">Use stick</button>
                <button class="coach-btn coach-btn-secondary" id="calib-accept-mic-btn" style="display:none;">Use mic</button>
                <button class="coach-btn coach-btn-primary" id="calib-accept-btn" style="display:none;">Accept</button>
            </div>
        `;

    document.body.appendChild(dialog);
    this.container = dialog;

    this._q('#calib-cancel-btn').addEventListener('click', () => this._cancel());
    this._q('#calib-back-btn').addEventListener('click', () => this._showPhase('choice'));
    // the mic's setup comes first both on its own and when comparing
    this._q('#calib-start-btn').addEventListener('click', () =>
      this._q('#calib-mic').style.display === 'block' ? this._startMic() : this._start()
    );
    this._q('#calib-continue-btn').addEventListener('click', () => this._mic.continue());
    this._q('#calib-choose-play').addEventListener('click', () => this._choosePlayAlong());
    this._q('#calib-choose-mic').addEventListener('click', () => this._chooseMic('mic'));
    this._q('#calib-choose-both').addEventListener('click', () => this._chooseMic('both'));
    if (this._micName) {
      this._mic = new MicCalibration({
        root: this._q('#calib-mic'),
        micName: this._micName,
        midiHandler: this.midiHandler,
        onStep: (step) => this._showMicButtons(step),
        onResult: (result) => this._micResult(result),
        onError: (problem, advice) => {
          this._stop();
          this._showFailure(problem, `${advice} Or choose Play along instead.`);
        },
      });
    }
    this._q('#calib-accept-btn').addEventListener('click', () =>
      this._accept(RESULT_KINDS[this._resultKind].accepts)
    );
    this._q('#calib-accept-mic-btn').addEventListener('click', () => this._accept('mic'));
    this._q('#calib-accept-stick-btn').addEventListener('click', () => this._accept('micStick'));
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
    if (this._mic) {
      this._q('.calib-choice .calib-mic-name').textContent = this._micName;
      this._showPhase('choice');
    } else {
      this._choosePlayAlong();
    }
  }

  /** @param {'mic'|'both'} method - the mic alone, or the mic and then playing along */
  _chooseMic(method) {
    this._method = method;
    this._results = { playAlong: null, mic: null, micStick: null };
    this._showPhase('mic');
    this._mic.show();
  }

  _choosePlayAlong() {
    this._method = 'playAlong';
    this._results = { playAlong: null, mic: null, micStick: null };
    this._showPlayAlongInstructions();
  }

  _showPlayAlongInstructions() {
    // the choice screen has already said what calibrating is for
    this._q('#calib-intro').style.display = this._mic ? 'none' : '';
    const lead = this._q('#calib-both-lead');
    lead.style.display = this._method === 'both' ? '' : 'none';
    if (this._method === 'both') {
      lead.innerHTML =
        `<strong>The mic measured ${signed(this._results.mic)} ms.</strong> ` +
        'Now put your headphones back on and play along with the click.';
    }
    this._showPhase('instructions');
  }

  hide() {
    this._stop();
    this.container.style.display = 'none';
  }

  _q(selector) {
    return this.container.querySelector(selector);
  }

  /** @param {'choice'|'instructions'|'mic'|'running'|'result'} phase */
  _showPhase(phase) {
    const ids = {
      choice: 'calib-choice',
      instructions: 'calib-instructions',
      mic: 'calib-mic',
      running: 'calib-progress',
      result: 'calib-result',
    };
    for (const [key, id] of Object.entries(ids)) {
      this._q(`#${id}`).style.display = key === phase ? 'block' : 'none';
    }
    // the results to choose from, once a run has finished with some
    const kind = phase === 'result' ? this._resultKind : null;
    this._showButtons({
      // back to the choice; with two results to choose from, Try again is enough
      back:
        (phase === 'instructions' || phase === 'result') &&
        this._mic !== null &&
        (kind === null || kind === 'playAlong'),
      start: phase === 'instructions',
      continue: false,
      retry: phase === 'result',
      accept: kind !== null,
      'accept-mic': kind === 'compare',
      'accept-stick': kind === 'mic',
    });
    if (kind !== null) this._q('#calib-accept-btn').textContent = RESULT_KINDS[kind].acceptLabel;
  }

  /** The buttons for a step of the mic measurement. */
  _showMicButtons(step) {
    this._showButtons({
      back: step === 'setup',
      start: step === 'setup',
      continue: step === 'toPad' || step === 'replace',
      retry: false,
      accept: false,
      'accept-mic': false,
      'accept-stick': false,
    });
  }

  _showButtons(shown) {
    for (const [name, show] of Object.entries(shown)) {
      this._q(`#calib-${name}-btn`).style.display = show ? '' : 'none';
    }
  }

  // -- Running --

  _start() {
    this._resultKind = null;
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
      const osc = scheduleCalibrationClick(
        this._audioCtx,
        audioTime,
        onBeat ? 1 : OFF_BEAT_CLICK_GAIN
      );
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
    // the mic times sticks on a pad; a key's sound isn't one
    if (this._method === 'mic') return;
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

  // -- The mic --

  _startMic() {
    this._resultKind = null;
    this._ensureAudioContext();
    document.addEventListener('keydown', this._onKeyDown);
    this._mic.start(this._audioCtx, this._clock);
  }

  /** @param {ReturnType<typeof import('../engine/MicTiming.js').analyzeMicTiming>} result */
  _micResult(result) {
    this._stop();
    const failure = micFailure(result);
    if (failure) {
      this._showFailure(...failure);
      return;
    }
    const soundMs = Math.round(result.soundMs);
    const stickMs = Math.round(result.stickMs);
    const soundDelayMs = Math.round(result.soundDelayMs);
    const [before, after] = result.clicks;
    const { soundTaps, stickTaps } = result;
    const details =
      `Clicks heard ${before.found}/${before.played}, then ${after.found}/${after.played}. ` +
      `Drum sounds heard ${soundTaps.found}/${soundTaps.played}, ` +
      `stick taps ${stickTaps.found}/${stickTaps.played} (spread ±${stickTaps.spreadMs.toFixed(1)} ms). ` +
      `Result ±${result.precisionMs.toFixed(1)} ms. Mic clock drift ` +
      `${Math.abs(result.roundShiftMs).toFixed(1)} ms, steady to ${result.unsteadyMs.toFixed(1)} ms.`;
    this._results.mic = soundMs;
    this._results.micStick = stickMs;
    coachState.recordCalibration({ method: 'mic', offsetMs: soundMs, details });
    coachState.recordCalibration({ method: 'micStick', offsetMs: stickMs, details });
    if (this._method === 'both') {
      this._showPlayAlongInstructions();
      return;
    }
    this._resultKind = 'mic';
    this._showResult(
      [
        ['Drum sound on the click', soundMs, 'calib-compare-sound', 'judges what you hear'],
        ['Stick on the click', stickMs, 'calib-compare-stick', 'judges when the stick lands'],
      ],
      [
        `Your kit and computer delay each hit by ${stickMs} ms, and the kit plays the drum ` +
          `${soundDelayMs} ms after the stick lands.`,
        'Neither number includes your own feel, so sessions will show how early or late you ' +
          'really play.',
      ],
      [details, this._previousText(), this._lastOtherText('playAlong')].filter(Boolean).join(' ')
    );
  }

  /** The calibration in use now, for comparing a new one with. */
  _previousText() {
    return coachState.calibrated ? `Now using ${signed(coachState.calibrationOffset)} ms.` : '';
  }

  /** The other method's latest result, for comparing. */
  _lastOtherText(method) {
    const last = coachState.calibrationHistory.findLast((entry) => entry.method === method);
    if (!last) return '';
    const day = new Date(last.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `Last ${METHOD_NAMES[method]}: ${signed(last.offsetMs)} ms (${day}).`;
  }

  /** The results side by side, and what their differences mean. */
  _showComparison() {
    const { mic, micStick, playAlong } = this._results;
    this._resultKind = 'compare';
    this._showResult(
      [
        ['Play along', playAlong, 'calib-compare-play', 'your feel counts as on time'],
        ['Mic: drum sound', mic, 'calib-compare-sound', 'judges what you hear'],
        ['Mic: stick', micStick, 'calib-compare-stick', 'judges when the stick lands'],
      ],
      [
        feelText(playAlong - mic, playAlong - micStick),
        'The mic measured only your kit and computer; playing along adds your feel on top.',
      ],
      this._previousText()
    );
  }

  // -- Finish & results --

  _finish(status) {
    this._stop();
    const resultMs = Math.round(status.offsetMs);
    const details =
      `${CALIBRATION_RHYTHMS[status.rhythm].label}: median of ${status.measuredTaps} hits, ` +
      `spread ±${Math.round(status.spreadMs)} ms. Result ±${status.precisionMs.toFixed(1)} ms.`;
    this._results.playAlong = resultMs;
    coachState.recordCalibration({ method: 'playAlong', offsetMs: resultMs, details });
    if (this._method === 'both') {
      this._showComparison();
      return;
    }
    this._resultKind = 'playAlong';
    this._showResult(
      `${signed(resultMs)} ms`,
      `Your hits land ${Math.abs(resultMs)} ms ${resultMs < 0 ? 'before' : 'after'} the click, ` +
        'counting your kit, computer and feel. Sessions treat playing like this as on time.',
      [details, this._previousText(), this._mic ? this._lastOtherText('mic') : '']
        .filter(Boolean)
        .join(' ')
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
    this._resultKind = null;
    this._showResult('No result', `${problem} ${advice}`, details);
  }

  /**
   * @param {string|[string, number, string, string][]} value - the result, or several to choose
   *   from side by side, as [name, ms, element id, what it judges]
   * @param {string|string[]} explanation - one paragraph, or several short ones
   */
  _showResult(value, explanation, details) {
    const valueEl = this._q('#calib-result-value');
    if (typeof value === 'string') valueEl.textContent = value;
    else {
      valueEl.innerHTML = `<div class="calib-compare">${value
        .map(
          ([name, ms, id, judges]) =>
            `<div><span>${name}</span><strong id="${id}">${signed(ms)} ms</strong>` +
            `<small>${judges}</small></div>`
        )
        .join('')}</div>`;
    }
    const explanationEl = this._q('#calib-result-explanation');
    explanationEl.replaceChildren(
      ...[explanation].flat().map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      })
    );
    this._q('#calib-result-details').textContent = details;
    this._showPhase('result');
  }

  /** @param {'playAlong'|'mic'|'micStick'} method - whose result the coach uses */
  _accept(method) {
    coachState.calibrationOffset = this._results[method];
    coachState.calibrationMethod = method;
    coachState.calibrated = true;
    coachState.save();

    this.hide();
    window.dispatchEvent(new CustomEvent('calibration-accepted'));
  }

  _retry() {
    this._resultKind = null;
    if (this._method === 'playAlong') this._choosePlayAlong();
    // comparing, with the mic measured already: only playing along again
    else if (this._method === 'both' && this._results.mic !== null) {
      this._showPlayAlongInstructions();
    } else this._chooseMic(this._method);
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

  /** Stop the click and stop listening. */
  _stop() {
    if (this._mic) this._mic.stop();
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
    ['Loud clicks only', 'quarter notes', CALIBRATION_RHYTHMS.quarters.notesPerBeat],
    ['Every other click', '8th notes', CALIBRATION_RHYTHMS.eighths.notesPerBeat],
    ['Every click', '16th notes, best', CALIBRATION_RHYTHMS.sixteenths.notesPerBeat],
  ];
  const left = 200;
  const step = 15;
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
      const label = `${name} <tspan class="calib-diagram-note">(${note})</tspan>`;
      return `<text x="0" y="${y + 4}" class="calib-diagram-label">${label}</text>${dots}`;
    })
    .join('');
  const height = 22 + rowHeight * ways.length + 4;
  const width = left + notes * step;
  return `<svg id="calib-diagram" viewBox="0 0 ${width} ${height}" role="img"
      aria-label="The click plays every 16th note, loud on the beat. Hit on the loud clicks, on every other click, or on every click, which works best.">
      <text x="0" y="17" class="calib-diagram-label">Click</text>${ticks}${rows}</svg>`;
}

// how each method is named in a sentence
const METHOD_NAMES = { playAlong: 'play-along calibration', mic: 'mic measurement' };
// per result screen, what its main button uses and says
const RESULT_KINDS = {
  playAlong: { accepts: 'playAlong', acceptLabel: 'Accept' },
  mic: { accepts: 'mic', acceptLabel: 'Use sound' },
  compare: { accepts: 'playAlong', acceptLabel: 'Use play along' },
};
// results this close are the same: within what either can measure
const FEEL_SAME_MS = 3;

/**
 * What the gaps between playing along and the mic say about the player's feel.
 * @param {number} soundFeelMs - where the player's drum sound lands against the click
 * @param {number} stickFeelMs - where their stick lands
 */
function feelText(soundFeelMs, stickFeelMs) {
  if (Math.abs(soundFeelMs) < FEEL_SAME_MS) {
    return 'Playing along, your drum sound landed right on the click.';
  }
  const side = (ms) => `${Math.abs(ms)} ms ${ms > 0 ? 'after' : 'before'}`;
  return (
    `Playing along, your drum sound landed ${side(soundFeelMs)} the click (your stick ` +
    `${side(stickFeelMs)}). That gap is your own feel.`
  );
}

/**
 * What went wrong with a mic measurement, as [problem, advice], or null if nothing did.
 * @param {ReturnType<typeof import('../engine/MicTiming.js').analyzeMicTiming>} result
 */
function micFailure(result) {
  const otherWay = 'Or choose Play along instead.';
  switch (result.failure) {
    case 'clicks': {
      const [before, after] = result.clicks;
      return [
        `The mic didn't hear enough of the click (${before.found}/${before.played}, then ` +
          `${after.found}/${after.played}).`,
        `Hang the headphones right over the mic, or turn the click volume up, and try again. ${otherWay}`,
      ];
    }
    case 'soundTaps':
      return [
        `The mic heard the drum sound of ${result.soundTaps.found} of your ` +
          `${result.soundTaps.played} taps.`,
        `Keep the headphones on the mic, turn the kit’s volume up, and try again. ${otherWay}`,
      ];
    case 'stickTaps':
      return [
        `The mic heard ${result.stickTaps.found} of your ${result.stickTaps.played} stick taps.`,
        `Put the mic right next to the pad, tap firmly, and try again. ${otherWay}`,
      ];
    case 'stickHeard':
      return [
        'In the drum sound step, the mic heard your stick rather than the drum sound from the ' +
          'headphones.',
        `Try again, tapping a pad further from the mic. ${otherWay}`,
      ];
    case 'moved':
      return [
        `The mic's own timing jumped by ${result.unsteadyMs.toFixed(1)} ms during the ` +
          'measurement, so the result can’t be trusted.',
        `Try again. If it keeps happening, the mic or its USB connection may be unsteady. ${otherWay}`,
      ];
    case 'imprecise':
      return [
        `The sounds were too uneven to time precisely (±${result.precisionMs.toFixed(1)} ms).`,
        'Try again in a quiet room. Keep the headphones an arm’s length from the mic while you ' +
          `tap, and tap firmly. ${otherWay}`,
      ];
    case null:
      return null;
    default:
      throw new Error(`[CalibrationDialog] unknown mic failure '${result.failure}'`);
  }
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
