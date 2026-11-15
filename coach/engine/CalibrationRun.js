/**
 * CalibrationRun - Measures how far from the click a player's hits land, from the hits alone.
 *
 * The click plays 16th notes; the player plays quarter notes, 8ths or 16ths along with it,
 * and the run tells which from the time between hits. It then waits for the hits to settle
 * onto the click, and measures until the typical offset is known well enough, starting over
 * from the newer hits whenever they drift away from the older ones.
 */

/** The rhythms a player can calibrate in, by the notes they play per beat. */
export const CALIBRATION_RHYTHMS = {
  quarters: { notesPerBeat: 1, label: 'quarter notes' },
  eighths: { notesPerBeat: 2, label: '8th notes' },
  sixteenths: { notesPerBeat: 4, label: '16th notes' },
};
// the click's own notes per beat: every rhythm's notes fall on it
export const CLICK_NOTES_PER_BEAT = 4;

// gaps between hits that tell the rhythm: the middle one of these many, so a missed or a
// doubled hit doesn't change it
const RHYTHM_GAPS = 6;
// How close the middle gap must be to a rhythm's note length to be that rhythm: within this
// factor either way. Triplets (a third longer than 16ths) and dotted notes fall outside.
const RHYTHM_GAP_TOLERANCE = 1.2;
// hits in a row that must be locked onto the click before measuring starts
export const SETTLE_TAPS = 8;
// Hits typically further than this from their note are on another click: the player is a
// note off the beat (quarter notes on an unaccented 16th, say). Just under half a 16th at
// 80 BPM, where the next click is nearer; system delays and players' leads stay well inside.
const MAX_PLAUSIBLE_OFFSET_MS = 90;
// Hits scattered more than this (standard deviation) aren't locked onto the click yet. Trained
// players land within 10-25 ms of a click, and newer players within 30-40.
const MAX_LOCKED_SPREAD_MS = 40;
// How well the result must be known: one standard error of the median. Well inside the
// tightest grading window (10 ms), so another run lands within a few ms of this one.
const TARGET_PRECISION_MS = 3;
// fewest hits a result is taken from, however steady they are
const MIN_MEASURED_TAPS = 24;
// Shortest time a result is taken over: long enough for a slow slide (half a ms per 16th,
// say) to move the hits further than DRIFT_LIMIT_MS and show as drift.
const MIN_MEASURE_MS = 20000;
// A shift between the older and the newer half of the measured hits smaller than this doesn't
// move the result enough to matter.
const DRIFT_LIMIT_MS = 10;
// ...and one smaller than this many of its standard errors may be chance
const DRIFT_SIGMAS = 3;
// how long a run may settle, and then measure, before it gives up
const MAX_SETTLE_MS = 30000;
const MAX_MEASURE_MS = 90000;
// standard error of a median, in standard errors of a mean (sqrt(pi / 2), for normal spread)
const MEDIAN_SE_FACTOR = 1.2533;
// A hit further from the median than this many median absolute deviations is a slip (a missed
// click, a double hit), not the player's timing; scaled by 1.4826, a MAD estimates the
// standard deviation, so this keeps hits within about 3 of them.
const OUTLIER_MADS = 3;
const MAD_TO_SD = 1.4826;

export class CalibrationRun {
  /**
   * @param {object} options
   * @param {number} options.beatMs - the click's beat length
   * @param {'loudest'|'every'} options.hitRule - whether only the loudest hit near a note counts
   */
  constructor({ beatMs, hitRule }) {
    this.beatMs = beatMs;
    this.hitRule = hitRule;
    this._hitTimes = []; // every note hit, for telling the rhythm
    this._rhythm = null; // key of CALIBRATION_RHYTHMS
    this._phaseStartMs = null; // when settling, or measuring, started
    this._measuring = false;
    // the hits counted in the current phase, as {note, timeMs, errorMs, velocity}, in time order
    this._taps = [];
    // which way the hits last drifted ('earlier' or 'later'), while that is the latest news
    this._drift = null;
    this._driftsFound = 0; // drifts found while measuring, for telling why a run gave up
    this._offBeat = false; // settled, but on a click other than the rhythm's
    // 'scattered', 'drifting' or 'offbeat' once the run gives up
    this._failure = null;
  }

  /**
   * One hit.
   * @param {number} timeMs - when it landed, from when the click's first note was heard
   * @param {number} velocity
   * @returns {{errorMs: number}|null} where it landed against its note, or null when the run
   *   doesn't know the rhythm yet, has finished, or the hit was a softer one on a note
   */
  addTap(timeMs, velocity) {
    if (this.isDone() || this._failure) return null;
    // a hit this close after the last one is on the same note (a flam, a double hit)
    const lastHit = this._hitTimes[this._hitTimes.length - 1];
    if (lastHit === undefined || timeMs - lastHit >= this.beatMs / CLICK_NOTES_PER_BEAT / 2) {
      this._hitTimes.push(timeMs);
    }
    const rhythm = this._detectRhythm();
    if (rhythm !== this._rhythm) {
      this._rhythm = rhythm;
      this._startPhase(false, timeMs);
    }
    if (!rhythm) return null;

    const gridMs = this._gridMs();
    const note = Math.round(timeMs / gridMs);
    const tap = { note, timeMs, errorMs: timeMs - note * gridMs, velocity };
    const last = this._taps[this._taps.length - 1];
    if (this.hitRule === 'loudest' && last && last.note === note) {
      if (velocity <= last.velocity) return null;
      this._taps[this._taps.length - 1] = tap;
    } else {
      this._taps.push(tap);
    }

    if (this._measuring) this._checkMeasurement(timeMs);
    else this._checkSettled(timeMs);
    return { errorMs: tap.errorMs };
  }

  /** Whether the result is known well enough to use. */
  isDone() {
    const m = this._measurement();
    return (
      this._measuring &&
      !this._drift &&
      m.count >= MIN_MEASURED_TAPS &&
      m.durationMs >= MIN_MEASURE_MS &&
      m.precisionMs <= TARGET_PRECISION_MS
    );
  }

  /**
   * Where the run stands.
   * @returns {{phase: 'listening'|'settling'|'measuring'|'done'|'failed', rhythm: string|null,
   *   offsetMs: number|null, spreadMs: number|null, precisionMs: number|null,
   *   drift: 'earlier'|'later'|null, offBeat: boolean, measuredTaps: number, settledTaps: number,
   *   progress: number,
   *   timeLeftMs: number|null, failure: string|null}}
   *   settledTaps: hits toward SETTLE_TAPS while settling; spreadMs: of the hits so far, while
   *   settling or measuring; timeLeftMs: about how much longer measuring takes at this spread
   */
  status() {
    const m = this._measuring ? this._measurement() : null;
    let phase = 'listening';
    if (this._failure) phase = 'failed';
    else if (this.isDone()) phase = 'done';
    else if (this._measuring) phase = 'measuring';
    else if (this._rhythm) phase = 'settling';
    return {
      phase,
      rhythm: this._rhythm,
      offsetMs: m && m.count ? m.medianMs : null,
      spreadMs: this._spreadSoFar(m),
      precisionMs: m && m.count > 1 ? m.precisionMs : null,
      drift: this._drift,
      offBeat: this._offBeat,
      measuredTaps: m ? m.count : 0,
      settledTaps: this._measuring ? SETTLE_TAPS : Math.min(this._taps.length, SETTLE_TAPS),
      progress: m ? progressOf(m) : 0,
      timeLeftMs: m && m.count >= MIN_MEASURED_TAPS ? this._timeLeftMs(m) : null,
      failure: this._failure,
    };
  }

  _spreadSoFar(m) {
    if (m) return m.count > 1 ? m.spreadMs : null;
    const recent = this._taps.slice(-SETTLE_TAPS);
    return recent.length > 1 ? robustSpread(recent.map((t) => t.errorMs)) : null;
  }

  /** About how much longer measuring needs, at this spread and the rhythm's rate of notes. */
  _timeLeftMs(m) {
    const hitsLeft = Math.max(0, neededTaps(m) - m.count);
    return Math.max(hitsLeft * this._gridMs(), MIN_MEASURE_MS - m.durationMs);
  }

  _gridMs() {
    return this.beatMs / CALIBRATION_RHYTHMS[this._rhythm].notesPerBeat;
  }

  /** The rhythm the recent gaps between hits are closest to, or null if they fit none. */
  _detectRhythm() {
    const times = this._hitTimes;
    if (times.length <= RHYTHM_GAPS) return null;
    const recent = times.slice(-RHYTHM_GAPS - 1);
    const gap = medianOf(recent.slice(1).map((t, i) => t - recent[i]));
    let best = null;
    let bestRatio = Infinity;
    for (const [key, { notesPerBeat }] of Object.entries(CALIBRATION_RHYTHMS)) {
      // gaps compare by ratio: twice too long is as far off as half too short
      const ratio = Math.abs(Math.log(gap / (this.beatMs / notesPerBeat)));
      if (ratio < bestRatio) [best, bestRatio] = [key, ratio];
    }
    return bestRatio <= Math.log(RHYTHM_GAP_TOLERANCE) ? best : null;
  }

  _startPhase(measuring, timeMs) {
    this._measuring = measuring;
    this._phaseStartMs = timeMs;
    this._taps = [];
    this._drift = null;
    this._driftsFound = 0;
    this._offBeat = false;
  }

  _checkSettled(timeMs) {
    const recent = this._taps.slice(-SETTLE_TAPS).map((t) => t.errorMs);
    const locked = recent.length === SETTLE_TAPS && robustSpread(recent) <= MAX_LOCKED_SPREAD_MS;
    this._offBeat = locked && Math.abs(medianOf(recent)) > MAX_PLAUSIBLE_OFFSET_MS;
    if (locked && !this._offBeat) {
      this._startPhase(true, timeMs);
    } else if (timeMs - this._phaseStartMs > MAX_SETTLE_MS) {
      this._failure = this._offBeat ? 'offbeat' : 'scattered';
    }
  }

  _checkMeasurement(timeMs) {
    const m = this._measurement();
    const drifted = m.count >= MIN_MEASURED_TAPS && isDrift(m);
    this._drift = drifted ? driftDirection(m) : null;
    // the newer hits are where the player is now: measure on from them
    if (drifted) this._driftsFound++;
    if (drifted) this._taps = this._taps.slice(Math.floor(this._taps.length / 2));
    if (this.isDone()) return;
    const msLeft = MAX_MEASURE_MS - (timeMs - this._phaseStartMs);
    // at this spread, the hits still needed can't come in the time left: say so now
    const outOfTime = !drifted && m.count >= MIN_MEASURED_TAPS && this._timeLeftMs(m) > msLeft;
    if (msLeft < 0 || outOfTime) {
      this._failure = this._driftsFound > 0 ? 'drifting' : 'scattered';
    }
  }

  /** The measured hits' typical offset, spread, and how far the newer half moved from the older. */
  _measurement() {
    const errors = withoutSlips(this._taps.map((t) => t.errorMs));
    const count = errors.length;
    const spreadMs = standardDeviation(errors);
    const half = Math.floor(count / 2);
    const taps = this._taps;
    return {
      count,
      durationMs: taps.length ? taps[taps.length - 1].timeMs - taps[0].timeMs : 0,
      medianMs: medianOf(errors),
      spreadMs,
      precisionMs: (MEDIAN_SE_FACTOR * spreadMs) / Math.sqrt(count),
      driftMs: medianOf(errors.slice(half)) - medianOf(errors.slice(0, half)),
      // each half's median has the standard error of a measurement of half the hits
      driftErrorMs: (MEDIAN_SE_FACTOR * spreadMs * 2) / Math.sqrt(count),
    };
  }
}

function driftDirection(m) {
  return m.driftMs < 0 ? 'earlier' : 'later';
}

function isDrift(m) {
  return Math.abs(m.driftMs) > Math.max(DRIFT_LIMIT_MS, DRIFT_SIGMAS * m.driftErrorMs);
}

/** Hits a measurement at this spread needs to know its median to TARGET_PRECISION_MS. */
function neededTaps(m) {
  return Math.max(MIN_MEASURED_TAPS, ((MEDIAN_SE_FACTOR * m.spreadMs) / TARGET_PRECISION_MS) ** 2);
}

/** How far a measurement is toward the hits its spread needs, from 0 to 1. */
function progressOf(m) {
  return Math.min(1, m.count / neededTaps(m), m.durationMs / MIN_MEASURE_MS);
}

/** The hits without the slips: those further from the median than OUTLIER_MADS deviations. */
function withoutSlips(errors) {
  const median = medianOf(errors);
  const mad = medianOf(errors.map((e) => Math.abs(e - median))) * MAD_TO_SD;
  // every hit equally far off: nothing stands out as a slip
  if (mad < Number.EPSILON) return errors;
  return errors.filter((e) => Math.abs(e - median) <= OUTLIER_MADS * mad);
}

/** Standard deviation estimated from the median absolute deviation, so slips don't inflate it. */
function robustSpread(values) {
  const median = medianOf(values);
  return medianOf(values.map((v) => Math.abs(v - median))) * MAD_TO_SD;
}

function standardDeviation(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
}

function medianOf(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
