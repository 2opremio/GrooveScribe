/**
 * MicTiming - The system's own delay, measured with a mic: how much later the coach sees a hit
 * than it really happened, against the click as really heard; and how long after the stick the
 * kit sounds the drum, which is what a player hears and lines up with the click.
 *
 * One recording from the mic holds rounds of the click, played into it from the headphones,
 * taps whose drum sound the mic hears from the headphones, and taps of a stick on a pad next to
 * it. Each is found in it by its sound. A click found later than the coach thinks it is heard
 * shows the output's error; a stick found against its MIDI message shows the input's delay; a
 * drum sound found against its MIDI message, against a stick's, shows the kit's sound delay. The
 * mic's own delay is in all of them and cancels out: the clicks before and after the taps show
 * how far it moved, and each tap is measured against it as it was then, assuming it moved
 * steadily.
 *
 * All times are on the audio context's clock, in ms.
 */

// Rumble, hum and footsteps sit below this; a stick on a pad and the click (2.5 kHz) above.
const HIGH_PASS_HZ = 1000;
// The room's noise (a fan, someone cooking) is tracked as it changes: before each sound, the
// recording over NOISE_WINDOW_MS is cut into NOISE_SLICE_MS slices, and the noise level is the
// typical (median) loudest point of a slice. The clicks and taps in that time fill only a few
// slices, so they don't count as noise.
export const NOISE_WINDOW_MS = 2000;
const NOISE_SLICE_MS = 20;
// A sound is only taken when it peaks this many times above the room's noise.
export const LOUD_ENOUGH = 3;
// A sound starts where it first reaches this fraction of its peak, early on the steep rise of a
// click or a stick so loud and soft ones are timed alike, and clearly above the room's noise,
// at least this many times its level, so the noise can't make it start early.
const ONSET_FRACTION = 0.25;
const ONSET_ABOVE_NOISE = 1.5;
// A sound's start is the start of the burst its peak is in: back from the peak to the first
// stretch this long below the onset threshold. A quieter sound before it (a stick on a far pad,
// ahead of the drum sound it triggers) dies out within that and isn't taken for its start, while
// a click's own swings (0.2 ms apart at 2.5 kHz) are far shorter.
const BURST_GAP_MS = 1;

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
// The kit can't sound a drum before its stick lands: a drum sound found earlier than the stick
// by more than the timing's own error was the stick, heard over a quiet drum sound.
const SOUND_BEFORE_STICK_TOLERANCE_MS = 1;
// The mic's delay drifts as its clock and the output's run at slightly different rates, which
// each tap is corrected for, and Chromium keeps the two in step by now and then dropping or
// repeating a chunk of the mic's sound, which moves its delay at once by that chunk (measured on
// DrumOS: 64 of the mic's samples, every half minute or so). From round to round the delay must
// move by its drift within the rounds plus whole chunks, to within this; anything else means it
// jumped some other way, and the taps can't be lined up with it.
export const MIC_RESYNC_FRAMES = 64;
const MAX_UNSTEADY_MS = 0.5;
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
 * @typedef {{found: number, played: number, lagMs: number|null, spreadMs: number|null}} Found
 */

/**
 * @param {object} measurement
 * @param {MicRecording} measurement.recording
 * @param {number[][]} measurement.clickRounds - per round, when each click is heard by the
 *   coach's reckoning; one round before the taps, one after
 * @param {number} measurement.clickIntervalMs - time between clicks
 * @param {number[]} measurement.soundTapsMs - when each MIDI message arrived of the taps whose
 *   drum sound the mic heard from the headphones
 * @param {number[]} measurement.stickTapsMs - when each MIDI message arrived of the taps whose
 *   stick the mic heard on the pad next to it
 * @param {number} measurement.micSampleRate - the mic's own sample rate, which sets how far
 *   one of Chromium's resyncs moves its delay
 * @returns {{
 *   stickMs: number|null,
 *   soundMs: number|null,
 *   soundDelayMs: number|null,
 *   clicks: Found[],
 *   soundTaps: Found,
 *   stickTaps: Found,
 *   roundShiftMs: number|null,
 *   unsteadyMs: number|null,
 *   resyncs: number|null,
 *   resyncMs: number,
 *   precisionMs: number|null,
 *   failure: 'clicks'|'soundTaps'|'stickTaps'|'stickHeard'|'moved'|'imprecise'|null,
 * }}
 *   stickMs is how much later the coach sees a hit than its stick landed, against the click as
 *   heard: the calibration offset that judges the stick. soundDelayMs is how long after the
 *   stick the kit sounds the drum, and soundMs the offset that judges the drum's sound.
 */
export function analyzeMicTiming({
  recording,
  clickRounds,
  clickIntervalMs,
  soundTapsMs,
  stickTapsMs,
  micSampleRate,
}) {
  const resyncMs = (MIC_RESYNC_FRAMES * MS_PER_S) / micSampleRate;
  const find = (expectedMs, beforeMs, afterMs) =>
    soundStart(recording, expectedMs - beforeMs, expectedMs + afterMs);
  // each sound found roughly, then again close to its kind's typical delay
  const lagsAround = (times, beforeMs, afterMs) => {
    const rough = lagsOf(times, (ms) => find(ms, beforeMs, afterMs));
    if (rough.length === 0) return rough;
    const typical = medianOf(rough.map((f) => f.lagMs));
    return lagsOf(times, (ms) => find(ms + typical, REFINE_MS, REFINE_MS), typical);
  };

  const clickLags = clickRounds.map((round) =>
    lagsAround(round, CLICK_SEARCH_BEFORE_MS, clickIntervalMs * CLICK_SEARCH_AFTER_FRACTION)
  );
  const soundLags = lagsAround(soundTapsMs, TAP_SEARCH_MS, TAP_SEARCH_MS);
  const stickLags = lagsAround(stickTapsMs, TAP_SEARCH_MS, TAP_SEARCH_MS);

  const clicks = clickLags.map((found, i) => summarize(found, clickRounds[i].length));
  const soundTaps = summarize(soundLags, soundTapsMs.length);
  const stickTaps = summarize(stickLags, stickTapsMs.length);
  const result = {
    stickMs: null,
    soundMs: null,
    soundDelayMs: null,
    clicks,
    soundTaps,
    stickTaps,
    roundShiftMs: null,
    unsteadyMs: null,
    resyncs: null,
    resyncMs,
    precisionMs: null,
    failure: null,
  };
  if (clicks.some((c) => c.found < c.played * MIN_CLICKS_FOUND_FRACTION)) {
    return { ...result, failure: 'clicks' };
  }
  if (soundTaps.found < MIN_TAPS_FOUND) return { ...result, failure: 'soundTaps' };
  if (stickTaps.found < MIN_TAPS_FOUND) return { ...result, failure: 'stickTaps' };

  const [before, after] = clicks;
  result.roundShiftMs = after.lagMs - before.lagMs;
  // a click's lag when a tap was played, the mic's delay moving steadily from round to round
  const [beforeMs, afterMs] = clickLags.map((found) => medianOf(found.map((f) => f.atMs)));
  const clickLagAt = (ms) =>
    before.lagMs + (result.roundShiftMs * (ms - beforeMs)) / (afterMs - beforeMs);
  // how far the drift from round to round strays from the drift within the rounds
  const withinSlope = (slopeOf(clickLags[0]) + slopeOf(clickLags[1])) / 2;
  const jumpedMs = result.roundShiftMs - withinSlope * (afterMs - beforeMs);
  result.resyncs = Math.round(jumpedMs / resyncMs);
  result.unsteadyMs = Math.abs(jumpedMs - result.resyncs * resyncMs);
  // The coach grades a hit by its MIDI time against the click's reckoned time; truly it was the
  // stick (or the drum's sound) against the click as heard. Through the mic, that difference is
  // the click's lag (the mic's delay plus the output's error) less the tap's (the mic's delay
  // less MIDI's, plus the drum sound's delay for a drum sound).
  const offsets = (found) => found.map((f) => clickLagAt(f.atMs) - f.lagMs);
  const stickOffsets = offsets(stickLags);
  const soundOffsets = offsets(soundLags);
  result.stickMs = medianOf(stickOffsets);
  result.soundMs = medianOf(soundOffsets);
  // a hit whose sound is on the click had its stick land the sound delay earlier
  result.soundDelayMs = result.stickMs - result.soundMs;
  result.precisionMs = Math.hypot(
    standardError(clickLags[0].map((f) => f.lagMs)) / 2,
    standardError(clickLags[1].map((f) => f.lagMs)) / 2,
    standardError(stickOffsets),
    standardError(soundOffsets)
  );
  if (result.soundDelayMs < -SOUND_BEFORE_STICK_TOLERANCE_MS) {
    return { ...result, failure: 'stickHeard' };
  }
  if (result.unsteadyMs > MAX_UNSTEADY_MS) return { ...result, failure: 'moved' };
  if (result.precisionMs > MAX_RESULT_SE_MS) return { ...result, failure: 'imprecise' };
  return result;
}

/**
 * How long after each expected time its sound starts, for those whose sound was found.
 * @param {number[]} timesMs
 * @param {(ms: number) => number|null} findSound - when the sound expected at ms starts
 * @param {number} [shiftMs] - how far the search was moved from each time
 * @returns {{atMs: number, lagMs: number}[]}
 */
function lagsOf(timesMs, findSound, shiftMs = 0) {
  const found = [];
  for (const atMs of timesMs) {
    const soundMs = findSound(atMs);
    if (soundMs !== null) found.push({ atMs, lagMs: soundMs - atMs });
  }
  return shiftMs === 0 ? found : found.filter((f) => Math.abs(f.lagMs - shiftMs) <= REFINE_MS);
}

/** @param {{lagMs: number}[]} found @param {number} played */
function summarize(found, played) {
  const lags = found.map((f) => f.lagMs);
  return {
    found: lags.length,
    played,
    lagMs: lags.length ? medianOf(lags) : null,
    spreadMs: lags.length ? robustSpread(lags) : null,
  };
}

/**
 * When the loudest sound between fromMs and toMs starts, or null if nothing there stands clear of
 * the room's noise just before it.
 * @param {MicRecording} recording - from NOISE_WINDOW_MS before fromMs, where it has that
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {number|null}
 */
export function soundStart(recording, fromMs, toMs) {
  const window = loudestIn(recording, fromMs, toMs);
  if (window === null || window.peak <= window.noise * LOUD_ENOUGH) return null;
  const { signal, from, segmentStart, peak, peakAt, noise } = window;
  const threshold = Math.max(peak * ONSET_FRACTION, noise * ONSET_ABOVE_NOISE);
  const gap = (BURST_GAP_MS * recording.sampleRate) / MS_PER_S;
  let start = peakAt;
  for (let i = peakAt - 1; i >= from && start - i <= gap; i--) {
    if (Math.abs(signal[i]) >= threshold) start = i;
  }
  return recording.startMs + ((segmentStart + start) * MS_PER_S) / recording.sampleRate;
}

/**
 * How loud the loudest sound between fromMs and toMs is, against the room's noise just before
 * it: soundStart takes sounds of at least LOUD_ENOUGH.
 * @param {MicRecording} recording - from NOISE_WINDOW_MS before fromMs, where it has that
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {number|null} null when the recording has nothing there yet
 */
export function loudness(recording, fromMs, toMs) {
  const window = loudestIn(recording, fromMs, toMs);
  return window === null ? null : window.peak / window.noise;
}

/**
 * The loudest point between fromMs and toMs, and the room's noise over the NOISE_WINDOW_MS before
 * it, on the recording filtered as sounds are timed; null if there is nothing there yet.
 */
function loudestIn(recording, fromMs, toMs) {
  const toIndex = (ms) => Math.round(((ms - recording.startMs) * recording.sampleRate) / MS_PER_S);
  const segmentStart = Math.max(0, toIndex(fromMs - NOISE_WINDOW_MS));
  const from = Math.max(segmentStart, toIndex(fromMs)) - segmentStart;
  const signal = highPass(
    recording.samples.subarray(segmentStart, Math.min(recording.samples.length, toIndex(toMs))),
    recording.sampleRate
  );
  if (signal.length <= from) return null;
  let peak = 0;
  let peakAt = from;
  for (let i = from; i < signal.length; i++) {
    if (Math.abs(signal[i]) > peak) {
      peak = Math.abs(signal[i]);
      peakAt = i;
    }
  }
  return {
    signal,
    from,
    segmentStart,
    peak,
    peakAt,
    noise: noiseBefore(signal, from, recording.sampleRate),
  };
}

/**
 * The typical loudest point of the NOISE_SLICE_MS slices of signal before index end (the whole
 * slices only); over the window itself when there is nothing before it yet.
 */
function noiseBefore(signal, end, sampleRate) {
  const slice = Math.round((NOISE_SLICE_MS * sampleRate) / MS_PER_S);
  const stop = end >= slice ? end : signal.length;
  const peaks = [];
  for (let start = 0; start + slice <= stop; start += slice) {
    let peak = 0;
    for (let i = start; i < start + slice; i++) peak = Math.max(peak, Math.abs(signal[i]));
    peaks.push(peak);
  }
  if (peaks.length === 0) throw new Error('[MicTiming] too little recording to tell its noise');
  return medianOf(peaks);
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

/** How fast lags change over the times they were found at, ms per ms (least squares). */
function slopeOf(found) {
  const meanAt = found.reduce((sum, f) => sum + f.atMs, 0) / found.length;
  const meanLag = found.reduce((sum, f) => sum + f.lagMs, 0) / found.length;
  let covariance = 0;
  let variance = 0;
  for (const f of found) {
    covariance += (f.atMs - meanAt) * (f.lagMs - meanLag);
    variance += (f.atMs - meanAt) ** 2;
  }
  return covariance / variance;
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
