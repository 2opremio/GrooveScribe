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
// how much sound the fake mic hands over at a time
const BLOCK_MS = 100;
const TAP_EVERY_MS = 1000;
// the play-along click's 16ths at 80 BPM
const PLAY_ALONG_GRID_MS = 187.5;
// longer than any measurement takes
const MAX_MS = 120000;

/**
 * An AudioContext on performance.now()'s clock that records when each click starts, with a mic
 * that hears those clicks and the taps the test plays, as the room would.
 */
function roomAudioContext({ clickLevel = 0.3 } = {}) {
  const clicks = [];
  const taps = []; // when each stick hits, on the audio clock (ms)
  let micNode = null;
  let fedUntilMs = null;
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, gain: param() });
  const ctx = {
    clicks,
    taps,
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
        taps: taps.map((ms) => ({ atMs: ms + MIC_DELAY_MS, level: 0.3 })),
        seed: Math.round(fedUntilMs),
      });
      micNode.port.onmessage({
        data: { frame: Math.round((fedUntilMs * SAMPLE_RATE) / MS_PER_S), samples },
      });
      fedUntilMs += lengthMs;
    },
    /** Lose the next ms of the mic's sound, as a mic does now and then. */
    skipMic(ms) {
      fedUntilMs += ms;
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

  const SYSTEM_MS = OUTPUT_ERROR_MS + MIDI_DELAY_MS;

  function openDialog() {
    const midiHandler = { onHit: () => {} };
    const dialog = new CalibrationDialog({ midiHandler });
    dialog.inject();
    dialog.show();
    return midiHandler;
  }

  /** A stick hit now: the mic hears it, MIDI reports it a little later. */
  function hit(midiHandler) {
    const stickMs = performance.now();
    ctx.taps.push(stickMs);
    midiHandler.onHit('snare', stickMs + MIDI_DELAY_MS, 100);
  }

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
      if (title === 'Put the mic next to a pad') {
        document.getElementById('calib-continue-btn').click();
      }
      if (title === 'Tap the pad next to the mic' && performance.now() >= nextTapMs) {
        hit(midiHandler);
        nextTapMs = performance.now() + TAP_EVERY_MS;
      }
      if (title === 'Put the headphones back on the mic') {
        document.getElementById('calib-continue-btn').click();
      }
    }
    return titles;
  }

  it('measures the kit and the computer alone, and keeps that as the calibration', async () => {
    const midiHandler = openDialog();
    document.getElementById('calib-choose-mic').click();
    await measureWithMic(midiHandler);

    // a hit right on the click as heard looks this much late to the coach
    expect(text('calib-result-value')).toBe(`+${SYSTEM_MS} ms`);
    document.getElementById('calib-accept-btn').click();
    expect(coachState.calibrationOffset).toBe(SYSTEM_MS);
    expect(coachState.calibrationMethod).toBe('mic');
    expect(coachState.calibrationHistory.at(-1)).toMatchObject({
      method: 'mic',
      offsetMs: SYSTEM_MS,
    });
  });

  it('is not thrown off by a hit during the click', async () => {
    const midiHandler = openDialog();
    document.getElementById('calib-choose-mic').click();
    await measureWithMic(midiHandler, () => hit(midiHandler));
    expect(text('calib-result-value')).toBe(`+${SYSTEM_MS} ms`);
  });

  it('waits for a just-opened mic to settle in before measuring', async () => {
    const midiHandler = openDialog();
    document.getElementById('calib-choose-mic').click();
    await measureWithMic(midiHandler, undefined, () => ctx.skipMic(16));
    expect(text('calib-result-value')).toBe(`+${SYSTEM_MS} ms`);
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
    expect(titles.has('Put the mic next to a pad')).toBe(false);
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
    expect(text('calib-compare-mic')).toBe(`+${SYSTEM_MS} ms`);
    expect(text('calib-result-explanation')).toContain(`${playedLateMs - SYSTEM_MS} ms after`);
    document.getElementById('calib-accept-mic-btn').click();
    expect(coachState.calibrationOffset).toBe(SYSTEM_MS);
    expect(coachState.calibrationMethod).toBe('mic');
    expect(coachState.calibrationHistory.slice(-2).map((e) => e.method)).toEqual([
      'mic',
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
