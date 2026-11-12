/**
 * PassScore - How well a pass (or several) was played, and what that earns.
 *
 * A score counts the notes hit in each timing tier (perfect = blue, good = green,
 * close = yellow), the notes missed (not hit, or hit too far off to grade), and stray hits
 * (hits that belong to no note).
 */

/**
 * @typedef {Object} Score
 * @property {number} perfect
 * @property {number} good
 * @property {number} close
 * @property {number} missed
 * @property {number} stray
 */

/**
 * @typedef {Object} Goal
 * @property {number} minPerfectPercent  Blue notes, in percent of the notes hit, at least.
 * @property {number} maxClosePercent  Yellow notes, in percent of the notes hit, at most.
 */

const PERCENT = 100;

/** @returns {Score} */
export function emptyScore() {
  return { perfect: 0, good: 0, close: 0, missed: 0, stray: 0 };
}

/**
 * @param {Score} a
 * @param {Score} b
 * @returns {Score} both scores together
 */
export function addScores(a, b) {
  return {
    perfect: a.perfect + b.perfect,
    good: a.good + b.good,
    close: a.close + b.close,
    missed: a.missed + b.missed,
    stray: a.stray + b.stray,
  };
}

/** @param {Score} score */
export function hitCount(score) {
  return score.perfect + score.good + score.close;
}

/**
 * Share of the notes hit in each tier, in percent. Rounded for display; the goal is
 * checked on exact shares.
 * @param {Score} score
 * @returns {{perfect: number, good: number, close: number} | null} null before any note is hit
 */
export function tierPercentages(score) {
  const hits = hitCount(score);
  if (hits === 0) return null;
  return {
    perfect: Math.round((score.perfect * PERCENT) / hits),
    good: Math.round((score.good * PERCENT) / hits),
    close: Math.round((score.close * PERCENT) / hits),
  };
}

/**
 * Each condition of the goal, for a score so far or a finished pass.
 * @param {Score} score
 * @param {Goal} goal
 * @returns {{perfect: boolean, close: boolean, missed: boolean, stray: boolean}}
 */
export function goalChecks(score, goal) {
  const hits = hitCount(score);
  return {
    perfect: hits > 0 && score.perfect * PERCENT >= goal.minPerfectPercent * hits,
    close: hits > 0 && score.close * PERCENT <= goal.maxClosePercent * hits,
    missed: score.missed === 0,
    stray: score.stray === 0,
  };
}

/**
 * @param {Score} score
 * @param {Goal} goal
 * @returns {boolean} whether the score meets every condition of the goal
 */
export function meetsGoal(score, goal) {
  return Object.values(goalChecks(score, goal)).every(Boolean);
}

/**
 * Whether one pass is better than another: fewer mistakes (missed notes and stray hits)
 * first, then a larger share of blue and green, then a larger share of blue.
 * @param {Score} a
 * @param {Score} b
 * @returns {boolean} whether a is better than b
 */
export function isBetter(a, b) {
  const mistakesA = a.missed + a.stray;
  const mistakesB = b.missed + b.stray;
  if (mistakesA !== mistakesB) return mistakesA < mistakesB;
  // compare shares of the notes hit without dividing: x/hitsA > y/hitsB
  const hitsA = hitCount(a);
  const hitsB = hitCount(b);
  const onTimeA = (a.perfect + a.good) * hitsB;
  const onTimeB = (b.perfect + b.good) * hitsA;
  if (onTimeA !== onTimeB) return onTimeA > onTimeB;
  return a.perfect * hitsB > b.perfect * hitsA;
}

/**
 * One word for how a session went.
 *  - clean: meets the goal
 *  - solid: no mistakes, but short of the blue or yellow target
 *  - getting-there: mistakes on at most fewMistakesPercent of the notes
 *  - keep-at-it: more mistakes than that
 * @param {Score} score
 * @param {Goal} goal
 * @param {number} fewMistakesPercent  Mistakes, in percent of the notes, that still count as few.
 * @returns {'clean' | 'solid' | 'getting-there' | 'keep-at-it'}
 */
export function verdict(score, goal, fewMistakesPercent) {
  if (meetsGoal(score, goal)) return 'clean';
  const mistakes = score.missed + score.stray;
  if (mistakes === 0) return 'solid';
  const notes = hitCount(score) + score.missed;
  return mistakes * PERCENT <= fewMistakesPercent * notes ? 'getting-there' : 'keep-at-it';
}
