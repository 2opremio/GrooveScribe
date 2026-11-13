const MS_PER_MINUTE = 60000;
// Timing spread grows in proportion to the beat only between these beat lengths: above
// 1000 ms (below 60 bpm) players subdivide and stop getting less precise, and below
// 500 ms (above 120 bpm) their spread in ms flattens out at the motor floor.
const MIN_BEAT_MS = 500;
const MAX_BEAT_MS = 1000;
// Nobody's spread gets below this, professional drummers playing to a click included (about
// 10 ms at 120 bpm), and the browser's own timing jitter is a few ms on top.
const MIN_SPREAD_MS = 10;
// each tier's window, in spreads: blue within one, green within two, yellow within three
const TIER_SPREADS = { perfect: 1, good: 2, close: 3 };

/**
 * Experience levels, by the timing spread (standard deviation of a player's hits around
 * the note) they expect, as a share of the beat. Tapping studies put trained musicians at
 * about 2-3% of the beat and untrained people at 4% or more.
 */
export const TOLERANCE_LEVELS = {
  beginner: { label: 'Beginner', spread: 0.04, description: 'new to it' },
  intermediate: { label: 'Intermediate', spread: 0.025, description: 'a few years in' },
  advanced: { label: 'Advanced', spread: 0.02, description: 'gigging' },
  pro: { label: 'Pro', spread: 0.015, description: 'studio' },
};

/**
 * The ms off a note each tier allows for a level at a tempo.
 * @param {string} level - A key of TOLERANCE_LEVELS
 * @param {number} bpm - Beats per minute
 * @returns {{perfect: number, good: number, close: number}}
 */
export function toleranceWindows(level, bpm) {
  const beatMs = Math.min(MAX_BEAT_MS, Math.max(MIN_BEAT_MS, MS_PER_MINUTE / bpm));
  const spreadMs = Math.max(MIN_SPREAD_MS, TOLERANCE_LEVELS[level].spread * beatMs);
  return {
    perfect: TIER_SPREADS.perfect * spreadMs,
    good: TIER_SPREADS.good * spreadMs,
    close: TIER_SPREADS.close * spreadMs,
  };
}

/**
 * TimingEvaluator - Pure function for timing evaluation
 *
 * @param {number} hitTimestamp - When user hit (ms, performance.now domain)
 * @param {number} targetTime - When note should be played (ms)
 * @param {number} audioLatency - Delay from scheduling a note to a hit on it arriving (ms)
 * @param {Object} windows - Timing windows {perfect, good, close}
 * @returns {Object} {timingError, tier, isMatch}
 */
export function evaluateHit(hitTimestamp, targetTime, audioLatency, windows) {
  // The user hears the note 'audioLatency' ms after it's scheduled
  const whenUserHeard = targetTime + audioLatency;

  // Error = hit time - what they heard
  // Negative = early (rushing), Positive = late (dragging)
  const timingError = hitTimestamp - whenUserHeard;
  const absError = Math.abs(timingError);

  let tier;
  if (absError <= windows.perfect) {
    tier = 'perfect';
  } else if (absError <= windows.good) {
    tier = 'good';
  } else if (absError <= windows.close) {
    tier = 'close';
  } else {
    tier = 'miss';
  }

  return {
    timingError,
    tier,
    isMatch: tier !== 'miss',
  };
}
