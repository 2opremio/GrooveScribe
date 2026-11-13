const MS_PER_SECOND = 1000;
// One pairing of the two clocks jitters by a couple of ms (it is taken once per audio
// render quantum), so the pairing used is the median of the recent ones: 40 readings 50 ms
// apart cover the last 2 s, enough to pin it well under a ms while following the slow drift
// between the audio device's clock and performance.now() (about 15 ppm measured on DrumOS).
const SAMPLE_INTERVAL_MS = 50;
const SAMPLES_KEPT = 40;
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
    this._offsets.push(ts.performanceTime - ts.contextTime * MS_PER_SECOND);
    if (this._offsets.length > SAMPLES_KEPT) this._offsets.shift();
  }

  /**
   * Resolves once the context reports output timestamps, so heardAt can be used.
   * @returns {Promise<void>}
   */
  async whenRunning() {
    const deadline = performance.now() + START_TIMEOUT_MS;
    this.sample();
    while (this._offsets.length === 0) {
      if (performance.now() > deadline) {
        throw new Error(
          `[AudioClock] the audio context reported no output after ${START_TIMEOUT_MS} ms ` +
            `(state: ${this.audioContext.state})`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
      this.sample();
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
