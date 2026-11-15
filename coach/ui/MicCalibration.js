import { coachState } from '../state/State.js';
import { scheduleCalibrationClick } from '../engine/CalibrationClick.js';
import { MicRecorder, openMic } from '../engine/MicRecorder.js';
import {
  analyzeMicTiming,
  soundStart,
  loudness,
  LOUD_ENOUGH,
  SOUND_CONTEXT_MS,
  MIN_CLICKS_FOUND_FRACTION,
} from '../engine/MicTiming.js';

const MS_PER_S = 1000;
// clicks per round: enough for a median to within a fraction of a ms, in 9 s
const CLICKS_PER_ROUND = 24;
const CLICK_INTERVAL_MS = 375;
// taps the mic must hear; MicTiming needs most of them found again
const TAPS_WANTED = 20;
// taps the mic may miss before it gives up: it can't hear the pad well enough
const MAX_MISSED_TAPS = 6;
// Taps closer together than this aren't counted: each tap's sound is looked for up to 300 ms
// either side of its MIDI message, so closer taps could be taken for each other.
const MIN_TAP_GAP_MS = 600;
// time from starting a round to its first click, so it isn't scheduled in the past
const FIRST_CLICK_DELAY_S = 0.3;
// how far after a click, and either side of a tap, its sound is looked for while it runs
const CLICK_LISTEN_MS = 300;
const TAP_LISTEN_MS = 300;
// how often the recording is checked for the sounds that have come in
const CHECK_INTERVAL_MS = 100;
// clicks after which, if the mic heard under half of them, it can't hear the headphones
const CLICKS_BEFORE_HEARING_CHECK = 6;
// how long the note that a hit restarted the click stays up
const RESTART_MESSAGE_MS = 3000;
// taps in a row the mic missed before the player is told to move it closer
const MISSED_TAPS_WARNING = 2;
// how long a message about one tap stays up to be read
const TAP_MESSAGE_MS = 3000;

// each click's or tap's mark, by whether its sound was heard (null: not checked yet)
const MARKS = { null: 'waiting', true: 'heard', false: 'missed' };

/** The steps, in order; the stepper shows the three that measure. */
const STEPS = ['setup', 'clicks1', 'toPad', 'taps', 'replace', 'clicks2', 'analyzing'];
// the steps whose sounds the level meter shows
const METER_STEPS = ['clicks1', 'taps', 'clicks2'];
// the meter shows the loudest sound in this much of the latest recording
const METER_WINDOW_MS = 300;
// how far above the background a sound fills the meter
const METER_FULL = 200;

/**
 * MicCalibration - Measures the system's own delay with the mic DrumOS records: the click as it
 * comes out of the headphones, and stick taps on a pad, against what the coach sees of each.
 *
 * The player hangs the headphones on the mic for a round of clicks, takes them away and taps the
 * pad next to the mic, then puts them back for a second round; MicTiming works out the result.
 * Whatever can't succeed stops right away: a click the mic can't hear, a pad it can't hear.
 */
export class MicCalibration {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root - the panel's element, from panelHtml()
   * @param {string} options.micName - the mic, as DrumOS names it
   * @param {{onHit: Function}} options.midiHandler
   * @param {(step: string) => void} options.onStep - the step shown changed
   * @param {(result: ReturnType<typeof analyzeMicTiming>) => void} options.onResult
   * @param {(problem: string, advice: string) => void} options.onError - it couldn't run
   */
  constructor({ root, micName, midiHandler, onStep, onResult, onError }) {
    this.root = root;
    this.micName = micName;
    this.midiHandler = midiHandler;
    this.onStep = onStep;
    this.onResult = onResult;
    this.onError = onError;
    this._ctx = null;
    this._clock = null;
    this._recorder = null;
    this._step = 'setup';
    this._rounds = []; // per click round, when each click is heard by the coach's reckoning (ms)
    this._clicks = []; // the click round playing: [{ms, heard: boolean|null}]
    this._taps = []; // [{ms, heard: boolean|null}], context time of each tap's MIDI message
    this._pendingClicks = [];
    this._timer = null;
    this._originalOnHit = null;
    this._message = null; // {text, atMs, forMs}: about one hit, shown for forMs
  }

  /** The panel's markup, to put in the dialog before constructing this. */
  static panelHtml() {
    return `
      <div id="calib-mic-setup">
        ${micSetupDiagram()}
        <ol class="calib-mic-checklist">
          <li>Take off your headphones and hang them on the mic, the ear cups either side of it.
          From here on, follow the screen.</li>
          <li>Have a stick ready. Keep the kit quiet until it asks you to tap.</li>
          <li>Halfway through, it asks you to put the mic next to a pad, then back.</li>
        </ol>
        <label class="calib-mic-volume">Click volume
          <input type="range" id="calib-mic-volume" min="0" max="100" step="5"></label>
        <p class="calib-subtle">About a minute. It asks you to move the headphones twice.
        Mic: <span class="calib-mic-name"></span></p>
      </div>
      <div id="calib-mic-running">
        <ol class="calib-stepper">
          <li data-steps="clicks1">Click</li>
          <li data-steps="toPad taps replace">Taps</li>
          <li data-steps="clicks2 analyzing">Click again</li>
        </ol>
        <div id="calib-mic-title" aria-live="polite"></div>
        <div id="calib-mic-hint"></div>
        <div id="calib-mic-meter" aria-hidden="true">
          <div id="calib-mic-meter-fill"></div>
          <div id="calib-mic-meter-line"></div>
        </div>
        <div id="calib-mic-marks" aria-hidden="true"></div>
        <div id="calib-mic-count"></div>
      </div>`;
  }

  /** Show the setup step. */
  show() {
    this.root.querySelector('.calib-mic-name').textContent = this.micName;
    const volume = this.root.querySelector('#calib-mic-volume');
    volume.value = String(coachState.metronomeVolume);
    volume.onchange = () => {
      coachState.metronomeVolume = Number(volume.value);
      coachState.save();
    };
    this._setStep('setup');
  }

  /**
   * Open the mic and play the first round of clicks.
   * @param {AudioContext} ctx - running, with clock started on it
   * @param {import('../engine/AudioClock.js').AudioClock} clock
   */
  async start(ctx, clock) {
    this._ctx = ctx;
    this._clock = clock;
    this._rounds = [];
    this._taps = [];
    this._recorder = new MicRecorder(ctx);
    let stream;
    try {
      stream = await openMic(this.micName);
      await this._recorder.start(stream);
      await clock.whenRunning();
    } catch (error) {
      console.error('[MicCalibration] could not start:', error);
      if (stream) for (const track of stream.getTracks()) track.stop();
      this._recorder = null;
      this.onError(
        `The mic (${this.micName}) could not be opened, or the audio output did not start.`,
        'Check that the mic is plugged in and try again.'
      );
      return;
    }
    this._originalOnHit = this.midiHandler.onHit;
    this.midiHandler.onHit = (drum, timestamp) => this._onHit(timestamp);
    this._timer = setInterval(() => this._check(), CHECK_INTERVAL_MS);
    this._playRound('clicks1');
  }

  /** The player is ready: the mic is by a pad, for the taps, or back under the headphones. */
  continue() {
    if (this._step === 'toPad') this._setStep('taps');
    else if (this._step === 'replace') this._playRound('clicks2');
    else throw new Error(`[MicCalibration] nothing to continue at step '${this._step}'`);
  }

  /** Stop the clicks, the mic and listening to the kit. */
  stop() {
    clearInterval(this._timer);
    this._timer = null;
    for (const osc of this._pendingClicks) osc.stop();
    this._pendingClicks = [];
    if (this._originalOnHit) {
      this.midiHandler.onHit = this._originalOnHit;
      this._originalOnHit = null;
    }
    if (this._recorder) {
      this._recorder.stop();
      this._recorder = null;
    }
  }

  _playRound(step) {
    for (const osc of this._pendingClicks) osc.stop();
    const firstS = this._ctx.currentTime + FIRST_CLICK_DELAY_S;
    this._clicks = [];
    this._pendingClicks = [];
    for (let i = 0; i < CLICKS_PER_ROUND; i++) {
      const audioTime = firstS + (i * CLICK_INTERVAL_MS) / MS_PER_S;
      this._pendingClicks.push(scheduleCalibrationClick(this._ctx, audioTime, 1));
      this._clicks.push({ ms: audioTime * MS_PER_S, heard: null });
    }
    this._setStep(step);
  }

  _onHit(timestamp) {
    // on the context clock, as the clicks and the recording are
    const ms = timestamp - this._clock.heardAt(0);
    if (this._step === 'clicks1' || this._step === 'clicks2') {
      // the stick is louder than the click through the cups, and would be taken for it
      this._playRound(this._step);
      this._message = {
        text: 'That hit got in the way, so the click started again. Hands off until it stops.',
        atMs: ms,
        forMs: RESTART_MESSAGE_MS,
      };
      this._render();
      return;
    }
    if (this._step !== 'taps') return;
    const last = this._taps[this._taps.length - 1];
    if (last && ms - last.ms < MIN_TAP_GAP_MS) {
      this._message = {
        text: 'A little slower: about one tap a second.',
        atMs: ms,
        forMs: TAP_MESSAGE_MS,
      };
      this._render();
      return;
    }
    this._taps.push({ ms, heard: null });
    this._render();
  }

  /** Check the recording, and stop with a message if it broke. */
  _check() {
    try {
      this._listen();
    } catch (error) {
      console.error('[MicCalibration] the recording broke:', error);
      this._fail(
        'The mic stopped sending sound partway through.',
        'Check its USB cable and try again.'
      );
    }
  }

  /** Mark the sounds the recording now covers as heard or not, and move on when a round ends. */
  _listen() {
    const until = this._recorder.recordedUntilMs;
    if (until === null) return;
    const listen = (item, beforeMs, afterMs) => {
      if (item.heard !== null || until < item.ms + afterMs) return false;
      const [from, to] = [item.ms - beforeMs, item.ms + afterMs];
      const recording = this._recorder.recording(from - SOUND_CONTEXT_MS, to);
      item.heard = soundStart(recording, from, to) !== null;
      return true;
    };
    for (const click of this._clicks) listen(click, 0, CLICK_LISTEN_MS);
    for (const tap of this._taps) {
      if (listen(tap, TAP_LISTEN_MS, TAP_LISTEN_MS) && !tap.heard) this._onTapMissed(tap);
    }
    this._showLevel(until);
    this._advance();
  }

  /** How loud the latest sound was, against how loud a sound must be to count. */
  _showLevel(untilMs) {
    const meter = this.root.querySelector('#calib-mic-meter');
    meter.style.display = METER_STEPS.includes(this._step) ? '' : 'none';
    if (!METER_STEPS.includes(this._step)) return;
    const fromMs = untilMs - METER_WINDOW_MS;
    const ratio = loudness(
      this._recorder.recording(fromMs - SOUND_CONTEXT_MS, untilMs),
      fromMs,
      untilMs
    );
    const fill = ratio === null ? 0 : meterFraction(ratio);
    const fillBar = this.root.querySelector('#calib-mic-meter-fill');
    fillBar.style.width = `${fill * 100}%`;
    fillBar.classList.toggle('calib-mic-meter-enough', ratio !== null && ratio > LOUD_ENOUGH);
    this.root.querySelector('#calib-mic-meter-line').style.left =
      `${meterFraction(LOUD_ENOUGH) * 100}%`;
  }

  /** Move on, or stop, by what has been heard so far. */
  _advance() {
    const roundDone = this._clicks.length > 0 && this._clicks.every((c) => c.heard !== null);
    const heardTaps = this._taps.filter((t) => t.heard).length;
    const missedTaps = this._taps.filter((t) => t.heard === false).length;
    if (roundDone && this._step !== 'setup' && !this._heardEnoughClicks()) {
      this._fail(
        `The mic heard ${this._clicks.filter((c) => c.heard).length} of ${CLICKS_PER_ROUND} clicks.`,
        'Hang the headphones right over the mic, or turn the click volume up, and try again.'
      );
    } else if (roundDone && this._step === 'clicks1') {
      this._rounds.push(this._clicks.map((c) => c.ms));
      this._clicks = [];
      this._setStep('toPad');
    } else if (roundDone && this._step === 'clicks2') {
      this._rounds.push(this._clicks.map((c) => c.ms));
      this._finish();
    } else if (this._step === 'taps' && missedTaps >= MAX_MISSED_TAPS) {
      this._fail(
        `The mic missed ${missedTaps} of your taps.`,
        'Put the mic right next to the pad, tap firmly, and try again.'
      );
    } else if (this._step === 'taps' && heardTaps >= TAPS_WANTED) {
      this._setStep('replace');
    } else {
      this._render();
    }
  }

  _heardEnoughClicks() {
    const heard = this._clicks.filter((c) => c.heard).length;
    return heard >= CLICKS_PER_ROUND * MIN_CLICKS_FOUND_FRACTION;
  }

  _fail(problem, advice) {
    this.stop();
    this.onError(problem, advice);
  }

  _onTapMissed(tap) {
    const recent = this._taps.filter((t) => t.heard !== null).slice(-MISSED_TAPS_WARNING);
    if (recent.length === MISSED_TAPS_WARNING && recent.every((t) => !t.heard)) {
      this._message = {
        text: 'The mic missed your last taps: move it closer to the pad, or tap a bit harder.',
        atMs: tap.ms,
        forMs: TAP_MESSAGE_MS,
      };
    }
  }

  _finish() {
    this._setStep('analyzing');
    let result;
    try {
      result = analyzeMicTiming({
        recording: this._recorder.recording(),
        clickRounds: this._rounds,
        clickIntervalMs: CLICK_INTERVAL_MS,
        tapsMs: this._taps.map((t) => t.ms),
      });
    } catch (error) {
      console.error('[MicCalibration] could not measure:', error);
      this._fail('The mic recording broke off partway.', 'Try again.');
      return;
    }
    this.stop();
    this.onResult(result);
  }

  _setStep(step) {
    if (!STEPS.includes(step)) throw new Error(`[MicCalibration] unknown step '${step}'`);
    this._step = step;
    this._message = null;
    this.root.querySelector('#calib-mic-setup').style.display = step === 'setup' ? '' : 'none';
    this.root.querySelector('#calib-mic-running').style.display = step === 'setup' ? 'none' : '';
    const stepIndex = STEPS.indexOf(step);
    for (const item of this.root.querySelectorAll('.calib-stepper li')) {
      const own = item.dataset.steps.split(' ').map((s) => STEPS.indexOf(s));
      item.classList.toggle('calib-step-current', own.includes(stepIndex));
      item.classList.toggle('calib-step-done', Math.max(...own) < stepIndex);
    }
    this.onStep(step);
    this._render();
  }

  /** What to do now, and how it is going. */
  _render() {
    const now = this._ctx ? this._ctx.currentTime * MS_PER_S : 0;
    const message = this._message && now < this._message.atMs + this._message.forMs;
    const said = this._said();
    this.root.querySelector('#calib-mic-title').textContent = said.title;
    this.root.querySelector('#calib-mic-hint').textContent = message
      ? this._message.text
      : said.hint;
    this.root.querySelector('#calib-mic-count').textContent = said.count;
    this.root.querySelector('#calib-mic-marks').innerHTML = said.marks
      .map((heard) => `<span class="calib-mic-mark calib-mic-mark-${heard}"></span>`)
      .join('');
  }

  _said() {
    const marksOf = (items, total) =>
      Array.from({ length: total }, (_, i) => MARKS[String(items[i]?.heard ?? null)]);
    const heard = (items) => items.filter((i) => i.heard).length;
    // a mark for each tap wanted, and one more for each the mic missed
    const tapMarks = TAPS_WANTED + this._taps.filter((t) => t.heard === false).length;
    switch (this._step) {
      case 'clicks1':
      case 'clicks2': {
        const checked = this._clicks.filter((c) => c.heard !== null).length;
        const deaf = checked >= CLICKS_BEFORE_HEARING_CHECK && heard(this._clicks) < checked / 2;
        return {
          title:
            this._step === 'clicks1' ? 'Listening to the click' : 'Listening to the click again',
          hint: deaf
            ? 'The mic can’t hear the click: hang the headphones right over it.'
            : 'Hands off the kit. Just let it play.',
          count: `Heard ${heard(this._clicks)} of ${CLICKS_PER_ROUND} clicks`,
          marks: marksOf(this._clicks, CLICKS_PER_ROUND),
        };
      }
      case 'toPad':
        return {
          title: 'Put the mic next to a pad',
          hint:
            'Lift the headphones off and set them down away from the mic. Put the mic right ' +
            'next to a pad: the closer, the more exact (every 34 cm adds 1 ms). Then press Continue.',
          count: '',
          marks: [],
        };
      case 'taps':
        return {
          title: 'Tap the pad next to the mic',
          hint: 'Firmly, about once a second. A tap counts when the meter passes the line.',
          count: `${heard(this._taps)} of ${TAPS_WANTED} taps heard`,
          marks: marksOf(this._taps, tapMarks),
        };
      case 'replace':
        return {
          title: 'Put the headphones back on the mic',
          hint: 'Bring the mic back, hang the headphones on it, then press Continue. Hands off the kit.',
          count: `${heard(this._taps)} of ${TAPS_WANTED} taps heard`,
          marks: marksOf(this._taps, tapMarks),
        };
      case 'analyzing':
        return { title: 'Working it out…', hint: '', count: '', marks: [] };
      default:
        return { title: '', hint: '', count: '', marks: [] };
    }
  }
}

/** The setup as a picture: the headphones hung on the mic, and the pad and stick for later. */
/** Where a loudness sits on the meter, from 0 to 1: on a log scale, as loudness is heard. */
function meterFraction(ratio) {
  return Math.max(0, Math.min(1, Math.log(ratio) / Math.log(METER_FULL)));
}

function micSetupDiagram() {
  return `<svg id="calib-mic-diagram" viewBox="0 0 320 150" role="img"
      aria-label="Headphones hung on the mic, an ear cup either side of it, and the mic standing right next to a drum pad.">
    <text x="110" y="12" class="calib-pic-label">headphones</text>
    <rect x="99" y="44" width="22" height="58" rx="11" class="calib-pic-mic"/>
    <line x1="110" y1="102" x2="110" y2="128" class="calib-pic-stand"/>
    <text x="110" y="145" class="calib-pic-label">mic</text>
    <path d="M 82 58 C 82 14, 138 14, 138 58" class="calib-pic-band"/>
    <rect x="70" y="50" width="22" height="40" rx="9" class="calib-pic-cup calib-pic-cup-on"/>
    <rect x="128" y="50" width="22" height="40" rx="9" class="calib-pic-cup calib-pic-cup-on"/>
    <ellipse cx="225" cy="112" rx="65" ry="15" class="calib-pic-pad"/>
    <text x="225" y="145" class="calib-pic-label">pad</text>
    <line x1="268" y1="40" x2="236" y2="104" class="calib-pic-stick"/>
    <text x="274" y="32" class="calib-pic-label">stick</text>
  </svg>`;
}
