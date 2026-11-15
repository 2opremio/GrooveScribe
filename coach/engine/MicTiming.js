/**
 * MicTiming - The system's own delay, measured with a mic: how much later the coach sees a hit
 * than it really happened, against the click as really heard.
 *
 * One recording from the mic holds rounds of the click, played into it from the headphones,
 * and taps of a stick on a pad next to it. Each click and each tap is found in it by its sound.
 * A click found later than the coach thinks it is heard shows the output's error; a tap found
 * against its MIDI message shows the input's delay. The mic's own delay is in both and cancels
 * out, as long as it stays put; clicks before and after the taps show that it did.
 *
 * All times are on the audio context's clock, in ms.
 */

// Rumble, hum and footsteps sit below this; a stick on a pad and the click (2.5 kHz) above.
const HIGH_PASS_HZ = 1000;
// A sound is only taken when it peaks this many times above the background: the typical level
// over the SOUND_CONTEXT_MS before it, mostly quiet, which also lets the high-pass settle.
const NOISE_MARGIN = 8;
export const SOUND_CONTEXT_MS = 500;
// A sound starts where it first reaches this fraction of its peak: past any background, and
// early on the steep rise of a click or a stick, so loud and soft ones are timed alike.
const ONSET_FRACTION = 0.25;
// Where a click is looked for, around when the coach thinks it is heard: the mic's delay plus
// the output's error, at most well under the time to the next click.
const CLICK_SEARCH_BEFORE_MS = 20;
const CLICK_SEARCH_AFTER_FRACTION = 0.8;
// where a tap's sound is looked for, either side of its MIDI message; taps come about 1 s apart
const TAP_SEARCH_MS = 300;
// Once the typical delay is known, each sound is looked for again this close to it, so a stray
// sound further away (a stick's rebound, a cough) isn't taken for it.
const REFINE_MS = 15;
// sounds that must be found, for a result to rest on them
export const MIN_CLICKS_FOUND_FRACTION = 0.8;
export const MIN_TAPS_FOUND = 16;
// The mic's delay may differ between the two rounds of clicks by at most this: the taps
// between them are measured against the delay halfway, so a delay moving faster spoils them.
const MAX_ROUND_SHIFT_MS = 2;
// how well the result must be known, one standard error, to be worth taking
const MAX_RESULT_SE_MS = 1.5;
// standard error of a median, in standard errors of a mean (sqrt(pi / 2), for normal spread)
const MEDIAN_SE_FACTOR = 1.2533;
// a median absolute deviation, scaled by this, estimates the standard deviation
const MAD_TO_SD = 1.4826;
const MS_PER_S = 1000;

/**
 * @typedef {object} MicRecording
 * @property {Float32Array} samples - one channel of the mic
 * @property {number} sampleRate
 * @property {number} startMs - when the first sample was taken, on the context clock
 */

/**
 * @param {object} measurement
 * @param {MicRecording} measurement.recording
 * @param {number[][]} measurement.clickRounds - per round, when each click is heard by the
 *   coach's reckoning; one round before the taps, one after
 * @param {number} measurement.clickIntervalMs - time between clicks
 * @param {number[]} measurement.tapsMs - when each tap's MIDI message arrived
 * @returns {{
 *   systemMs: number|null,
 *   clicks: {found: number, played: number, lagMs: number|null, spreadMs: number|null}[],
 *   taps: {found: number, played: number, lagMs: number|null, spreadMs: number|null},
 *   roundShiftMs: number|null,
 *   precisionMs: number|null,
 *   failure: 'clicks'|'taps'|'moved'|'imprecise'|null,
 * }}
 *   systemMs is how much later the coach sees a hit than it happened, against the click as
 *   heard: the calibration offset that takes the system out of the grading
 */
export function analyzeMicTiming({ recording, clickRounds, clickIntervalMs, tapsMs }) {
  const find = (expectedMs, beforeMs, afterMs) =>
    soundStart(recording, expectedMs - beforeMs, expectedMs + afterMs);

  const clicks = clickRounds.map((round) =>
    lagsOf(round, (ms) =>
      find(ms, CLICK_SEARCH_BEFORE_MS, clickIntervalMs * CLICK_SEARCH_AFTER_FRACTION)
    )
  );
  const taps = lagsOf(tapsMs, (ms) => find(ms, TAP_SEARCH_MS, TAP_SEARCH_MS));
  // refine each sound around its kind's typical delay
  const refined = (lags, times) =>
    lags.length === 0
      ? lags
      : lagsOf(times, (ms) => find(ms + medianOf(lags), REFINE_MS, REFINE_MS), medianOf(lags));
  const clickLags = clicks.map((lags, i) => refined(lags, clickRounds[i]));
  const tapLags = refined(taps, tapsMs);

  const clickSummaries = clickLags.map((lags, i) => summarize(lags, clickRounds[i].length));
  const tapSummary = summarize(tapLags, tapsMs.length);
  const result = {
    systemMs: null,
    clicks: clickSummaries,
    taps: tapSummary,
    roundShiftMs: null,
    precisionMs: null,
    failure: null,
  };
  if (clickSummaries.some((c) => c.found < c.played * MIN_CLICKS_FOUND_FRACTION)) {
    return { ...result, failure: 'clicks' };
  }
  if (tapSummary.found < MIN_TAPS_FOUND) return { ...result, failure: 'taps' };

  const [before, after] = clickSummaries;
  result.roundShiftMs = after.lagMs - before.lagMs;
  // The coach grades a hit by its MIDI time against the click's reckoned time; truly it was the
  // tap against the click as heard. Through the mic, that difference is the click's lag (the
  // mic's delay plus the output's error) less the tap's (the mic's delay less MIDI's).
  result.systemMs = (before.lagMs + after.lagMs) / 2 - tapSummary.lagMs;
  result.precisionMs = Math.hypot(
    standardError(clickLags[0]) / 2,
    standardError(clickLags[1]) / 2,
    standardError(tapLags)
  );
  if (Math.abs(result.roundShiftMs) > MAX_ROUND_SHIFT_MS) return { ...result, failure: 'moved' };
  if (result.precisionMs > MAX_RESULT_SE_MS) return { ...result, failure: 'imprecise' };
  return result;
}

/**
 * How long after each expected time its sound starts, for those whose sound was found.
 * @param {number[]} timesMs
 * @param {(ms: number) => number|null} findSound - when the sound expected at ms starts
 * @param {number} [shiftMs] - how far the search was moved from each time
 */
function lagsOf(timesMs, findSound, shiftMs = 0) {
  const lags = [];
  for (const ms of timesMs) {
    const soundMs = findSound(ms);
    if (soundMs !== null) lags.push(soundMs - ms);
  }
  return shiftMs === 0 ? lags : lags.filter((lag) => Math.abs(lag - shiftMs) <= REFINE_MS);
}

function summarize(lags, played) {
  return {
    found: lags.length,
    played,
    lagMs: lags.length ? medianOf(lags) : null,
    spreadMs: lags.length ? robustSpread(lags) : null,
  };
}

/**
 * When the loudest sound between fromMs and toMs starts, or null if nothing there stands out
 * from the background just before it.
 * @param {MicRecording} recording
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {number|null}
 */
export function soundStart(recording, fromMs, toMs) {
  const toIndex = (ms) => Math.round(((ms - recording.startMs) * recording.sampleRate) / MS_PER_S);
  const segmentStart = Math.max(0, toIndex(fromMs - SOUND_CONTEXT_MS));
  const from = Math.max(segmentStart, toIndex(fromMs));
  const to = Math.min(recording.samples.length, toIndex(toMs));
  if (to <= from) return null;
  const signal = highPass(recording.samples.subarray(segmentStart, to), recording.sampleRate);
  const background = medianOf(Array.from(signal, Math.abs));
  let peak = 0;
  for (let i = from - segmentStart; i < signal.length; i++) {
    peak = Math.max(peak, Math.abs(signal[i]));
  }
  if (peak <= background * NOISE_MARGIN) return null;
  for (let i = from - segmentStart; i < signal.length; i++) {
    if (Math.abs(signal[i]) >= peak * ONSET_FRACTION) {
      return recording.startMs + ((segmentStart + i) * MS_PER_S) / recording.sampleRate;
    }
  }
  throw new Error('[MicTiming] a peak was found but no sample reached a fraction of it');
}

/** A second-order Butterworth high-pass at HIGH_PASS_HZ (the audio EQ cookbook's). */
function highPass(samples, sampleRate) {
  const w = (2 * Math.PI * HIGH_PASS_HZ) / sampleRate;
  const alpha = Math.sin(w) / Math.SQRT2;
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

function standardError(lags) {
  return (MEDIAN_SE_FACTOR * robustSpread(lags)) / Math.sqrt(lags.length);
}

function robustSpread(values) {
  const median = medianOf(values);
  return MAD_TO_SD * medianOf(values.map((v) => Math.abs(v - median)));
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
