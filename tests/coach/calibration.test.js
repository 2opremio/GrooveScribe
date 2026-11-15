import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CalibrationDialog } from '../../coach/ui/CalibrationDialog.js';
import { coachState } from '../../coach/state/State.js';

const COUNTDOWN_MS = 4 * 750;
// the clock waits for a few steady pairings before the clicks are scheduled
const CLOCK_SETTLE_MS = 500;

/** An AudioContext on performance.now()'s clock that records when each click starts. */
function recordingAudioContext() {
  const clicks = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, gain: param() });
  return {
    clicks,
    state: 'running',
    destination: {},
    get currentTime() {
      return performance.now() / 1000;
    },
    getOutputTimestamp() {
      return { contextTime: performance.now() / 1000, performanceTime: performance.now() };
    },
    createGain: node,
    createOscillator: () => ({
      ...node(),
      frequency: param(),
      start: (t) => clicks.push(t),
      stop() {},
    }),
  };
}

describe('latency calibration', () => {
  let ctx;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'performance'] });
    vi.advanceTimersByTime(1000); // performance.now() and audio time start above 0
    ctx = recordingAudioContext();
    globalThis.AudioContext = function () {
      return ctx;
    };
    coachState.calibrationHitRule = 'every';
    coachState.minHitVelocity = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.AudioContext;
    document.body.innerHTML = '';
  });

  it.each([
    ['quarters', 40],
    ['sixteenths', 160],
  ])('finds a player on %s hitting 12 ms after every click 12 ms late', async (rhythm, taps) => {
    coachState.calibrationRhythm = rhythm;
    const midiHandler = { onHit: () => {} };
    const dialog = new CalibrationDialog({ midiHandler });
    dialog.inject();
    dialog.show();
    document.getElementById('calib-start-btn').click();
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + CLOCK_SETTLE_MS);

    // the countdown's clicks are the first four; the run's start after them
    const runClicks = ctx.clicks.slice(4);
    for (const clickS of runClicks.slice(0, taps)) {
      const hitMs = clickS * 1000 + 12;
      await vi.advanceTimersByTimeAsync(Math.max(0, hitMs - performance.now()));
      midiHandler.onHit('snare', hitMs, 100);
    }

    expect(document.getElementById('calib-result-value').textContent).toBe('+12 ms');
  });
});
