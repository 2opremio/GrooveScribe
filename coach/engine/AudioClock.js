const MS_PER_SECOND = 1000;
// One pairing of the two clocks jitters by a couple of ms (it is taken once per audio
// render quantum), so the pairing used is the median of the recent ones: 40 readings 50 ms
// apart cover the last 2 s, enough to pin it well under a ms while following the slow drift
// between the audio device's clock and performance.now() (about 15 ppm measured on DrumOS).
const SAMPLE_INTERVAL_MS = 50;
const SAMPLES_KEPT = 40;
// Two pairings in a row that differ by more than this mean the audio clock jumped or isn't
// keeping real time (Chromium's fake output after a silence runs it at about a third of real
// speed, moving the pairing by ~35 ms between samples); one pairing's own jitter stays under
// 2.5 ms (measured on DrumOS), so the earlier pairings are dropped.
const STEADY_TOLERANCE_MS = 5;
// pairings that must agree before the clock is trusted: the first one may be the last of a jump
const STEADY_SAMPLES = 3;
// how long to wait for a just-resumed context to start reporting output timestamps
const START_TIMEOUT_MS = 2000;
const START_POLL_MS = 5;

/**
 * AudioClock - When a sound scheduled on an AudioContext is heard, on the performance.now()
 * clock.
 *
 * The browser pairs the audio clock with performance.now() at the moment each sample leaves
 * for the output device (getOutputTimestamp), so the pairing already includes the output
 * delay the browser knows about. Everything after that (an external mixer, the interface,
 * the MIDI input path) is the calibration offset's job.
 */
export class AudioClock {
  /** @param {AudioContext} audioContext - the context the sounds are scheduled on */
  constructor(audioContext) {
    this.audioContext = audioContext;
    this._offsets = []; // recent pairings: performance.now() minus audio time, in ms
    this._intervalId = null;
  }

  /** Keep the pairing current while sounds are being scheduled on the context. */
  start() {
    // the clock may have jumped or run slow since the last session's pairings
    this._offsets = [];
    this.sample();
    this._intervalId = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
  }

  stop() {
    clearInterval(this._intervalId);
    this._intervalId = null;
  }

  /** Take one pairing of the clocks, if the context is producing sound. */
  sample() {
    const ts = this.audioContext.getOutputTimestamp();
    if (ts.contextTime <= 0 || ts.performanceTime <= 0) return; // not running yet
    const offset = ts.performanceTime - ts.contextTime * MS_PER_SECOND;
    const last = this._offsets[this._offsets.length - 1];
    if (last !== undefined && Math.abs(offset - last) > STEADY_TOLERANCE_MS) this._offsets = [];
    this._offsets.push(offset);
    if (this._offsets.length > SAMPLES_KEPT) this._offsets.shift();
  }

  /**
   * Resolves once the context reports steady output timestamps, so heardAt can be used.
   * @returns {Promise<void>}
   */
  async whenRunning() {
    const deadline = performance.now() + START_TIMEOUT_MS;
    // waits on start()'s sampling: pairings taken closer together than SAMPLE_INTERVAL_MS
    // would drift too little apart to tell a slow clock from a steady one
    while (this._offsets.length < STEADY_SAMPLES) {
      if (performance.now() > deadline) {
        throw new Error(
          `[AudioClock] the audio context reported no steady output after ${START_TIMEOUT_MS} ms ` +
            `(state: ${this.audioContext.state})`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
    }
  }

  /**
   * @param {number} contextTime - a time on the context's clock, in seconds
   * @returns {number} when a sound scheduled at that time is heard, in performance.now() ms
   */
  heardAt(contextTime) {
    if (this._offsets.length === 0) {
      throw new Error('[AudioClock] no output timestamps yet: await whenRunning() first');
    }
    return contextTime * MS_PER_SECOND + median(this._offsets);
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
