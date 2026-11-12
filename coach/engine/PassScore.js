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
 * @property {number} minPerfectPercent  Blue notes, in percent of the notes played, at least.
 * @property {number} maxClosePercent  Yellow notes, in percent of the notes played, at most.
 * @property {number} maxMistakesPercent  Missed notes and stray hits, in percent of the notes
 *   played, at most.
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

/**
 * Missed notes and stray hits. A stray hit that was an imprecise attempt at a note that
 * ended up missed is already that note's miss, and isn't in the stray count.
 * @param {Score} score
 */
export function mistakeCount(score) {
  return score.missed + score.stray;
}

/**
 * The notes played so far: hit in some tier, or missed. Stray hits belong to no note.
 * @param {Score} score
 */
export function noteCount(score) {
  return score.perfect + score.good + score.close + score.missed;
}

/**
 * Share of the notes played in each tier, in percent: with the missed share, they make up
 * every note. Rounded for display; the goal is checked on exact shares.
 * @param {Score} score
 * @returns {{perfect: number, good: number, close: number} | null} null before any note is due
 */
export function tierPercentages(score) {
  const notes = noteCount(score);
  if (notes === 0) return null;
  return {
    perfect: Math.round((score.perfect * PERCENT) / notes),
    good: Math.round((score.good * PERCENT) / notes),
    close: Math.round((score.close * PERCENT) / notes),
  };
}

/**
 * Each condition of the goal, for a score so far or a finished pass.
 * @param {Score} score
 * @param {Goal} goal
 * @returns {{perfect: boolean, close: boolean, mistakes: boolean}}
 */
export function goalChecks(score, goal) {
  const notes = noteCount(score);
  return {
    perfect: notes > 0 && score.perfect * PERCENT >= goal.minPerfectPercent * notes,
    close: notes > 0 && score.close * PERCENT <= goal.maxClosePercent * notes,
    mistakes: mistakeCount(score) * PERCENT <= goal.maxMistakesPercent * notes,
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
  const mistakesA = mistakeCount(a);
  const mistakesB = mistakeCount(b);
  if (mistakesA !== mistakesB) return mistakesA < mistakesB;
  // compare shares of the notes played without dividing: x/notesA > y/notesB
  const notesA = noteCount(a);
  const notesB = noteCount(b);
  const onTimeA = (a.perfect + a.good) * notesB;
  const onTimeB = (b.perfect + b.good) * notesA;
  if (onTimeA !== onTimeB) return onTimeA > onTimeB;
  return a.perfect * notesB > b.perfect * notesA;
}

/**
 * One word for how a session went.
 *  - clean: meets the goal
 *  - solid: within the goal's mistakes, but short of its timing targets
 *  - keep-at-it: more mistakes than the goal allows
 * @param {Score} score
 * @param {Goal} goal
 * @returns {'clean' | 'solid' | 'keep-at-it'}
 */
export function verdict(score, goal) {
  const checks = goalChecks(score, goal);
  if (Object.values(checks).every(Boolean)) return 'clean';
  return checks.mistakes ? 'solid' : 'keep-at-it';
}
