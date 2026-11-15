import { coachState } from '../state/State.js';
import { scheduleCalibrationClick } from '../engine/CalibrationClick.js';
import { MicRecorder, openMic } from '../engine/MicRecorder.js';
import {
  analyzeMicTiming,
  soundStart,
  loudness,
  LOUD_ENOUGH,
  NOISE_WINDOW_MS,
  MIN_CLICKS_FOUND_FRACTION,
} from '../engine/MicTiming.js';

const MS_PER_S = 1000;
// clicks per round: enough for a median to within a fraction of a ms, in 9 s
const CLICKS_PER_ROUND = 24;
const CLICK_INTERVAL_MS = 375;
// taps the mic must hear in each tap step; MicTiming needs most of them found again
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

// where the headphones are, said at the top of each step that measures
const HEADPHONES_ON_MIC = ['clicks1', 'soundTaps', 'replace', 'clicks2'];
const HEADPHONES = {
  clicks1: 'Headphones: on the mic',
  soundTaps: 'Headphones: still on the mic',
  toPad: 'Headphones: take them off the mic, and put them down an arm’s length away',
  stickTaps: 'Headphones: away from the mic',
  replace: 'Headphones: hang them back on the mic',
  clicks2: 'Headphones: on the mic',
};

// each click's or tap's mark, by whether its sound was heard (null: not checked yet)
const MARKS = { null: 'waiting', true: 'heard', false: 'missed' };

/**
 * The steps, in order. The headphones hang on the mic for the clicks and the drum sounds, and
 * are put away for the stick taps, so the mic hears only the stick.
 */
const STEPS = [
  'setup',
  'clicks1',
  'soundTaps',
  'toPad',
  'stickTaps',
  'replace',
  'clicks2',
  'analyzing',
];
// the steps where the player taps, each with its own taps
const TAP_STEPS = ['soundTaps', 'stickTaps'];
// the steps whose sounds the level meter shows
const METER_STEPS = ['clicks1', 'soundTaps', 'stickTaps', 'clicks2'];
// the meter shows the loudest sound in this much of the latest recording
const METER_WINDOW_MS = 300;
// how far above the background a sound fills the meter
const METER_FULL = 200;
// The meter stays empty up to this many times the room's noise: the noise's own peaks wander
// around its level and rarely reach twice it, so the noise alone never shows.
const METER_EMPTY = 2;

/**
 * MicCalibration - Measures the system's own delay with the mic DrumOS records: the click as it
 * comes out of the headphones, the kit's drum sound, and stick taps on a pad, against what the
 * coach sees of each.
 *
 * With the headphones hung on the mic, a round of clicks plays and the player taps a pad away
 * from it, so it hears the drum sound; with them put away and the mic by a pad, the player taps
 * that pad, so it hears the stick; with them back on, a second round of clicks plays. MicTiming
 * works out the result. Whatever can't succeed stops right away: a sound the mic can't hear.
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
    // by tap step, [{ms, heard: boolean|null}]: context time of each tap's MIDI message
    this._taps = { soundTaps: [], stickTaps: [] };
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
          <li><strong>Take off your headphones and hang them on the mic</strong>, the ear cups
          either side of it. From here on, follow the screen.</li>
          <li>Have a stick ready. Keep the kit quiet until it asks you to tap.</li>
          <li>Each step says where the headphones go: on the mic, or put away.</li>
        </ol>
        <label class="calib-mic-volume">Click volume
          <input type="range" id="calib-mic-volume" min="0" max="100" step="5"></label>
        <p class="calib-subtle">About two minutes, in four steps. Mic: <span class="calib-mic-name"></span></p>
      </div>
      <div id="calib-mic-running">
        <ol class="calib-stepper">
          <li data-steps="clicks1">Click</li>
          <li data-steps="soundTaps">Drum sound</li>
          <li data-steps="toPad stickTaps">Stick</li>
          <li data-steps="replace clicks2 analyzing">Click again</li>
        </ol>
        <div id="calib-mic-headphones"></div>
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
    this._taps = { soundTaps: [], stickTaps: [] };
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
    if (this._step === 'toPad') this._setStep('stickTaps');
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
    if (!TAP_STEPS.includes(this._step)) return;
    const taps = this._taps[this._step];
    const last = taps[taps.length - 1];
    if (last && ms - last.ms < MIN_TAP_GAP_MS) {
      this._message = {
        text: 'A little slower: about one tap a second.',
        atMs: ms,
        forMs: TAP_MESSAGE_MS,
      };
      this._render();
      return;
    }
    taps.push({ ms, heard: null });
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
      const recording = this._recorder.recording(from - NOISE_WINDOW_MS, to);
      item.heard = soundStart(recording, from, to) !== null;
      return true;
    };
    for (const click of this._clicks) listen(click, 0, CLICK_LISTEN_MS);
    for (const step of TAP_STEPS) {
      for (const tap of this._taps[step]) {
        if (listen(tap, TAP_LISTEN_MS, TAP_LISTEN_MS) && !tap.heard) this._onTapMissed(step, tap);
      }
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
      this._recorder.recording(fromMs - NOISE_WINDOW_MS, untilMs),
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
    if (roundDone && this._step !== 'setup' && !this._heardEnoughClicks()) {
      this._fail(
        `The mic heard ${this._clicks.filter((c) => c.heard).length} of ${CLICKS_PER_ROUND} clicks.`,
        'Hang the headphones right over the mic, or turn the click volume up, and try again.'
      );
    } else if (roundDone && this._step === 'clicks1') {
      this._rounds.push(this._clicks.map((c) => c.ms));
      this._clicks = [];
      this._setStep('soundTaps');
    } else if (roundDone && this._step === 'clicks2') {
      this._rounds.push(this._clicks.map((c) => c.ms));
      this._finish();
    } else if (TAP_STEPS.includes(this._step)) {
      this._advanceTaps(this._taps[this._step]);
    } else {
      this._render();
    }
  }

  /** Move on once the mic has heard enough taps of this step, or stop if it misses too many. */
  _advanceTaps(taps) {
    const heard = taps.filter((t) => t.heard).length;
    const missed = taps.filter((t) => t.heard === false).length;
    const sound = this._step === 'soundTaps';
    if (missed >= MAX_MISSED_TAPS) {
      this._fail(
        sound
          ? `The mic didn't hear the drum sound of ${missed} of your taps.`
          : `The mic missed ${missed} of your stick taps.`,
        sound
          ? 'Keep the headphones on the mic, turn the kit’s volume up, and try again.'
          : 'Put the mic right next to the pad, tap firmly, and try again.'
      );
    } else if (heard >= TAPS_WANTED) {
      this._setStep(sound ? 'toPad' : 'replace');
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

  _onTapMissed(step, tap) {
    const recent = this._taps[step].filter((t) => t.heard !== null).slice(-MISSED_TAPS_WARNING);
    if (recent.length === MISSED_TAPS_WARNING && recent.every((t) => !t.heard)) {
      this._message = {
        text:
          step === 'soundTaps'
            ? 'The mic missed your last drum sounds: keep the headphones on it, or turn the kit up.'
            : 'The mic missed your last taps: move it closer to the pad, or tap a bit harder.',
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
        soundTapsMs: this._taps.soundTaps.map((t) => t.ms),
        stickTapsMs: this._taps.stickTaps.map((t) => t.ms),
        micSampleRate: this._recorder.micSampleRate,
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
    this.root.querySelector('#calib-mic-meter').style.display = METER_STEPS.includes(step)
      ? ''
      : 'none';
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
    const headphones = this.root.querySelector('#calib-mic-headphones');
    headphones.textContent = HEADPHONES[this._step] ?? '';
    headphones.className = HEADPHONES_ON_MIC.includes(this._step)
      ? 'calib-headphones-on'
      : 'calib-headphones-off';
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
    const tapMarks = (taps) => TAPS_WANTED + taps.filter((t) => t.heard === false).length;
    const tapsSaid = (taps) => ({
      count: `${heard(taps)} of ${TAPS_WANTED} taps heard`,
      marks: marksOf(taps, tapMarks(taps)),
    });
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
      case 'soundTaps':
        return {
          title: 'Tap a pad away from the mic',
          hint:
            'About once a second, on a pad at least an arm’s length from the mic, so it hears ' +
            'the drum sound from the headphones, not your stick.',
          ...tapsSaid(this._taps.soundTaps),
        };
      case 'toPad':
        return {
          title: 'Put the mic next to a pad',
          hint:
            'Put the mic right next to a pad: the closer, the more exact (every 34 cm adds ' +
            '1 ms). Then press Continue.',
          count: '',
          marks: [],
        };
      case 'stickTaps':
        return {
          title: 'Tap the pad next to the mic',
          hint: 'Firmly, about once a second. A tap counts when the meter passes the line.',
          ...tapsSaid(this._taps.stickTaps),
        };
      case 'replace':
        return {
          title: 'Hang the headphones back on the mic',
          hint: 'Bring the mic back if you moved it, then press Continue. Hands off the kit.',
          count: '',
          marks: [],
        };
      case 'analyzing':
        return { title: 'Working it out…', hint: '', count: '', marks: [] };
      default:
        return { title: '', hint: '', count: '', marks: [] };
    }
  }
}

/** Where a loudness sits on the meter, from 0 to 1: on a log scale, as loudness is heard. */
function meterFraction(ratio) {
  const fraction = Math.log(ratio / METER_EMPTY) / Math.log(METER_FULL / METER_EMPTY);
  return Math.max(0, Math.min(1, fraction));
}

/** The setup as a picture: the headphones hung on the mic, and the pad and stick for later. */
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
