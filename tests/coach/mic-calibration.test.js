import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CalibrationDialog } from '../../coach/ui/CalibrationDialog.js';
import { coachState } from '../../coach/state/State.js';
import { roomSound, SAMPLE_RATE } from './helpers/micRoom.js';

const MS_PER_S = 1000;
// how much later the click comes out of the headphones than the coach reckons
const OUTPUT_ERROR_MS = 15;
// how long a hit takes to arrive over MIDI
const MIDI_DELAY_MS = 7;
// how late the mic hears everything, on the audio clock
const MIC_DELAY_MS = 40;
// how long after its stick lands the kit sounds a drum in the headphones
const KIT_SOUND_DELAY_MS = 6;
// how loud the mic hears a stick on the pad next to it, one on a pad far from it, and the drum
// sound from headphones hung on it
const NEAR_STICK_LEVEL = 0.3;
const FAR_STICK_LEVEL = 0.02;
const DRUM_SOUND_LEVEL = 0.5;
// how much sound the fake mic hands over at a time
const BLOCK_MS = 100;
const TAP_EVERY_MS = 1000;
// the play-along click's 16ths at 80 BPM
const PLAY_ALONG_GRID_MS = 187.5;
// longer than any measurement takes
const MAX_MS = 120000;

/**
 * An AudioContext on performance.now()'s clock that records when each click starts, with a mic
 * that hears those clicks and the sounds the test makes, as the room would.
 */
function roomAudioContext({ clickLevel = 0.3 } = {}) {
  const clicks = [];
  const sounds = []; // what the test makes the mic hear besides the clicks: [{atMs, level}]
  let micNode = null;
  let fedUntilMs = null;
  let calls = 0; // the worklet's process calls so far
  let staleNextFrame = false; // report the next block's frame as the one before's, as Chromium does
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, gain: param() });
  const ctx = {
    clicks,
    sounds,
    state: 'running',
    sampleRate: SAMPLE_RATE,
    destination: {},
    get currentTime() {
      return performance.now() / MS_PER_S;
    },
    getOutputTimestamp() {
      return { contextTime: performance.now() / MS_PER_S, performanceTime: performance.now() };
    },
    createGain: node,
    createOscillator: () => ({
      ...node(),
      frequency: param(),
      start: (t) => clicks.push(t),
      stop() {},
    }),
    audioWorklet: { addModule: async () => {} },
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    /** Hand the mic node everything the mic heard up to now. */
    feedMic() {
      if (!micNode?.port.onmessage) return;
      const nowMs = performance.now();
      fedUntilMs ??= nowMs;
      const lengthMs =
        (Math.floor(((nowMs - fedUntilMs) * SAMPLE_RATE) / MS_PER_S) / SAMPLE_RATE) * MS_PER_S;
      if (lengthMs <= 0) return;
      const samples = roomSound({
        startMs: fedUntilMs,
        lengthMs,
        clicks: clicks.map((t) => ({
          atMs: t * MS_PER_S + OUTPUT_ERROR_MS + MIC_DELAY_MS,
          level: clickLevel,
        })),
        taps: sounds.map(({ atMs, level }) => ({ atMs: atMs + MIC_DELAY_MS, level })),
        seed: Math.round(fedUntilMs),
      });
      const frame = Math.round((fedUntilMs * SAMPLE_RATE) / MS_PER_S);
      calls++;
      micNode.port.onmessage({
        data: { call: calls, frame: staleNextFrame ? frame - samples.length : frame, samples },
      });
      staleNextFrame = false;
      fedUntilMs += lengthMs;
    },
    /** Report the next block's frame a block late, as Chromium now and then does. */
    staleFrame() {
      staleNextFrame = true;
    },
    /** Lose the next ms of the mic's sound, as a mic does now and then. */
    skipMic(ms) {
      fedUntilMs += ms;
      calls++;
    },
  };
  globalThis.AudioWorkletNode = function () {
    micNode = { port: { onmessage: null } };
    return micNode;
  };
  return ctx;
}

// a run plays a minute of simulated room sound, listened to as the dialog would
describe('calibrating with the mic', { timeout: 30000 }, () => {
  let ctx;
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
    });
    vi.advanceTimersByTime(1000);
    ctx = roomAudioContext();
    globalThis.AudioContext = function () {
      return ctx;
    };
    window.drumOSMicDevice = 'AT2020USB+';
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => [
          { kind: 'audioinput', label: 'Logitech BRIO (046d:085e)', deviceId: 'cam' },
          { kind: 'audioinput', label: 'AT2020USB+ (0909:001c)', deviceId: 'mic' },
        ],
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    });
    coachState.calibrated = false;
    coachState.calibrationHistory = [];
    coachState.calibrationHitRule = 'loudest';
    coachState.minHitVelocity = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.AudioContext;
    delete globalThis.AudioWorkletNode;
    delete window.drumOSMicDevice;
    delete navigator.mediaDevices;
    document.body.innerHTML = '';
  });

  const text = (id) => document.getElementById(id).textContent;
  const shown = (id) => document.getElementById(id).style.display !== 'none';

  // what a hit whose stick is right on the click as heard looks like to the coach
  const STICK_MS = OUTPUT_ERROR_MS + MIDI_DELAY_MS;
  // and one whose drum sound is: its stick landed the kit's sound delay earlier
  const SOUND_MS = STICK_MS - KIT_SOUND_DELAY_MS;

  function openDialog() {
    const midiHandler = { onHit: () => {} };
    const dialog = new CalibrationDialog({ midiHandler });
    dialog.inject();
    dialog.show();
    return midiHandler;
  }

  /**
   * A stick hit now: MIDI reports it a little later, and the mic hears the stick, at stickLevel,
   * and the drum sound from the headphones if they hang on it.
   */
  function hit(midiHandler, { stickLevel, drumSoundHeard }) {
    const stickMs = performance.now();
    ctx.sounds.push({ atMs: stickMs, level: stickLevel });
    if (drumSoundHeard) {
      ctx.sounds.push({ atMs: stickMs + KIT_SOUND_DELAY_MS, level: DRUM_SOUND_LEVEL });
    }
    midiHandler.onHit('snare', stickMs + MIDI_DELAY_MS, 100);
  }
  // a stray hit with the headphones on the mic
  const strayHit = (midiHandler) =>
    hit(midiHandler, { stickLevel: NEAR_STICK_LEVEL, drumSoundHeard: true });

  // what the player does at each step that asks for something
  const PLAYER = {
    'Tap a pad away from the mic': { tap: { stickLevel: FAR_STICK_LEVEL, drumSoundHeard: true } },
    'Put the mic next to a pad': 'continue',
    'Tap the pad next to the mic': { tap: { stickLevel: NEAR_STICK_LEVEL, drumSoundHeard: false } },
    'Hang the headphones back on the mic': 'continue',
  };

  /**
   * Go through the mic's steps as asked, until it hands over to something else.
   * @param {() => void} [duringFirstClick] - done once, partway into the first click round
   * @param {() => void} [afterFirstSound] - done once, after the mic's first sound
   */
  async function measureWithMic(
    midiHandler,
    duringFirstClick = () => {},
    afterFirstSound = () => {}
  ) {
    document.getElementById('calib-start-btn').click();
    const titles = new Set();
    let nextTapMs = 0;
    let clicked = false;
    let sounded = false;
    while (shown('calib-mic') && performance.now() < MAX_MS) {
      await vi.advanceTimersByTimeAsync(BLOCK_MS);
      ctx.feedMic();
      if (!sounded) {
        afterFirstSound();
        sounded = true;
      }
      const title = text('calib-mic-title');
      titles.add(title);
      if (title === 'Listening to the click' && !clicked && ctx.clicks.length > 0) {
        await vi.advanceTimersByTimeAsync(2000);
        ctx.feedMic();
        duringFirstClick();
        clicked = true;
      }
      const asked = PLAYER[title];
      if (asked === 'continue') document.getElementById('calib-continue-btn').click();
      if (asked?.tap && performance.now() >= nextTapMs) {
        hit(midiHandler, asked.tap);
        nextTapMs = performance.now() + TAP_EVERY_MS;
      }
    }
    return titles;
  }

  it('measures the kit and the computer alone, for the drum sound and for the stick', async () => {
    const midiHandler = openDialog();
    document.getElementById('calib-choose-mic').click();
    await measureWithMic(midiHandler);

    expect(text('calib-compare-sound')).toBe(`+${SOUND_MS} ms`);
    expect(text('calib-compare-stick')).toBe(`+${STICK_MS} ms`);
    expect(text('calib-result-explanation')).toContain(
      `plays the drum ${KIT_SOUND_DELAY_MS} ms after the stick`
    );
    expect(coachState.calibrationHistory.slice(-2)).toMatchObject([
      { method: 'mic', offsetMs: SOUND_MS },
      { method: 'micStick', offsetMs: STICK_MS },
    ]);
  });

  it('uses whichever of the two the player picks', async () => {
    const midiHandler = openDialog();
    document.getElementById('calib-choose-mic').click();
    await measureWithMic(midiHandler);
    document.getElementById('calib-accept-stick-btn').click();
    expect(coachState.calibrationOffset).toBe(STICK_MS);
    expect(coachState.calibrationMethod).toBe('micStick');
  });

  it('is not thrown off by a hit during the click', async () => {
    const midiHandler = openDialog();
    document.getElementById('calib-choose-mic').click();
    await measureWithMic(midiHandler, () => strayHit(midiHandler));
    expect(text('calib-compare-sound')).toBe(`+${SOUND_MS} ms`);
  });

  it('waits for a just-opened mic to settle in before measuring', async () => {
    const midiHandler = openDialog();
    document.getElementById('calib-choose-mic').click();
    await measureWithMic(midiHandler, undefined, () => ctx.skipMic(16));
    expect(text('calib-compare-sound')).toBe(`+${SOUND_MS} ms`);
  });

  it("keeps going when the browser reports a block's frame a block late", async () => {
    const midiHandler = openDialog();
    document.getElementById('calib-choose-mic').click();
    await measureWithMic(midiHandler, () => ctx.staleFrame());
    expect(text('calib-compare-sound')).toBe(`+${SOUND_MS} ms`);
  });

  it('says so when the mic drops out partway, instead of measuring across the gap', async () => {
    const midiHandler = openDialog();
    document.getElementById('calib-choose-mic').click();
    await measureWithMic(midiHandler, () => ctx.skipMic(16));
    expect(text('calib-result-value')).toBe('No result');
    expect(text('calib-result-explanation')).toContain('stopped sending sound');
  });

  it("stops after the first click round when the mic can't hear the click", async () => {
    ctx = roomAudioContext({ clickLevel: 0.0005 });
    const midiHandler = openDialog();
    document.getElementById('calib-choose-mic').click();
    const titles = await measureWithMic(midiHandler);
    expect(text('calib-result-value')).toBe('No result');
    expect(titles.has('Tap a pad away from the mic')).toBe(false);
  });

  it('compares the mic with playing along, and uses either', async () => {
    const playedLateMs = 30;
    const midiHandler = openDialog();
    document.getElementById('calib-choose-both').click();
    await measureWithMic(midiHandler);

    // then play along: every 16th, playedLateMs after each click as the coach reckons it
    expect(shown('calib-instructions')).toBe(true);
    const clicksBefore = ctx.clicks.length;
    document.getElementById('calib-start-btn').click();
    while (ctx.clicks.length === clicksBefore) await vi.advanceTimersByTimeAsync(BLOCK_MS);
    const firstMs = ctx.clicks[clicksBefore] * MS_PER_S;
    let hitMs = firstMs + playedLateMs;
    while (!shown('calib-result') && performance.now() < MAX_MS) {
      await vi.advanceTimersByTimeAsync(Math.max(0, hitMs - performance.now()));
      midiHandler.onHit('snare', hitMs, 100);
      hitMs += PLAY_ALONG_GRID_MS;
    }

    expect(text('calib-compare-play')).toBe(`+${playedLateMs} ms`);
    expect(text('calib-compare-sound')).toBe(`+${SOUND_MS} ms`);
    expect(text('calib-compare-stick')).toBe(`+${STICK_MS} ms`);
    expect(text('calib-result-explanation')).toContain(
      `drum sound landed ${playedLateMs - SOUND_MS} ms after the click (your stick ` +
        `${playedLateMs - STICK_MS} ms after)`
    );
    document.getElementById('calib-accept-mic-btn').click();
    expect(coachState.calibrationOffset).toBe(SOUND_MS);
    expect(coachState.calibrationMethod).toBe('mic');
    expect(coachState.calibrationHistory.slice(-3).map((e) => e.method)).toEqual([
      'mic',
      'micStick',
      'playAlong',
    ]);
  });

  it('offers only playing along when DrumOS names no mic', () => {
    delete window.drumOSMicDevice;
    const dialog = new CalibrationDialog({ midiHandler: { onHit: () => {} } });
    dialog.inject();
    dialog.show();
    expect(shown('calib-choice')).toBe(false);
    expect(shown('calib-instructions')).toBe(true);
  });
});
