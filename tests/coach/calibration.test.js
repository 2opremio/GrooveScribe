import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CalibrationDialog } from '../../coach/ui/CalibrationDialog.js';
import { coachState } from '../../coach/state/State.js';

const BEAT_MS = 750;
const NOTES_PER_BEAT = { quarters: 1, eighths: 2, sixteenths: 4 };
// the clock waits for a few steady pairings before the click starts
const CLOCK_SETTLE_MS = 500;
// longer than any steady run takes
const MAX_PLAY_MS = 120000;

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
    coachState.calibrationHitRule = 'loudest';
    coachState.minHitVelocity = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.AudioContext;
    document.body.innerHTML = '';
  });

  /** Open the dialog, start, and play `rhythm` `lateMs` after each of its notes until it ends. */
  async function calibrate(rhythm, lateMs) {
    const midiHandler = { onHit: () => {} };
    const dialog = new CalibrationDialog({ midiHandler });
    dialog.inject();
    dialog.show();
    document.getElementById('calib-start-btn').click();
    await vi.advanceTimersByTimeAsync(CLOCK_SETTLE_MS);

    const firstClickMs = ctx.clicks[0] * 1000;
    const gridMs = BEAT_MS / NOTES_PER_BEAT[rhythm];
    const running = () => document.getElementById('calib-progress').style.display !== 'none';
    for (let n = 0; running() && n * gridMs < MAX_PLAY_MS; n++) {
      const hitMs = firstClickMs + n * gridMs + lateMs;
      await vi.advanceTimersByTimeAsync(Math.max(0, hitMs - performance.now()));
      midiHandler.onHit('snare', hitMs, 100);
    }
    return {
      value: document.getElementById('calib-result-value').textContent,
      canAccept: document.getElementById('calib-accept-btn').style.display !== 'none',
    };
  }

  it.each(['quarters', 'eighths', 'sixteenths'])(
    'finds a player on %s hitting 12 ms after every note 12 ms late',
    async (rhythm) => {
      expect(await calibrate(rhythm, 12)).toEqual({ value: '+12 ms', canAccept: true });
    }
  );

  it('keeps the click going on the beat for as long as the player plays', async () => {
    await calibrate('quarters', 0);
    const gaps = ctx.clicks.slice(1).map((t, i) => (t - ctx.clicks[i]) * 1000);
    for (const gap of gaps) expect(gap).toBeCloseTo(BEAT_MS / 4, 6);
  });
});
