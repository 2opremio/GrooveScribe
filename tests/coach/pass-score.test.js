import { describe, it, expect } from 'vitest';
import {
  addScores,
  emptyScore,
  goalChecks,
  isBetter,
  meetsGoal,
  tierPercentages,
  verdict,
} from '../../coach/engine/PassScore.js';

const GOAL = { minPerfectPercent: 50, maxClosePercent: 10, maxMissedPercent: 2 };
const FEW_MISTAKES_PERCENT = 5;
const score = (fields) => ({ ...emptyScore(), ...fields });

describe('Drum Coach pass goal', () => {
  it('is met by a pass with enough blue, little yellow, and no mistakes', () => {
    expect(meetsGoal(score({ perfect: 50, good: 40, close: 10 }), GOAL)).toBe(true);
  });

  it('counts an all-blue pass as meeting the goal', () => {
    expect(meetsGoal(score({ perfect: 20 }), GOAL)).toBe(true);
  });

  it('allows missed notes up to their share of the notes played, but no stray hit', () => {
    expect(meetsGoal(score({ perfect: 98, missed: 2 }), GOAL)).toBe(true);
    expect(meetsGoal(score({ perfect: 97, missed: 3 }), GOAL)).toBe(false);
    expect(meetsGoal(score({ perfect: 100, stray: 1 }), GOAL)).toBe(false);
  });

  it('is not met with too little blue or too much yellow', () => {
    expect(goalChecks(score({ perfect: 49, good: 51 }), GOAL).perfect).toBe(false);
    expect(goalChecks(score({ perfect: 89, close: 11 }), GOAL).close).toBe(false);
  });

  it('is not met by a pass with nothing hit', () => {
    expect(meetsGoal(score({}), GOAL)).toBe(false);
  });
});

describe('Drum Coach tier shares', () => {
  it('are shares of every note played, missed ones included', () => {
    const pct = tierPercentages(score({ perfect: 5, good: 2, close: 1, missed: 2, stray: 3 }));
    expect(pct).toEqual({ perfect: 50, good: 20, close: 10 });
  });

  it('count missed notes against the blue target', () => {
    expect(goalChecks(score({ perfect: 5, missed: 5 }), GOAL).perfect).toBe(true);
    expect(goalChecks(score({ perfect: 4, missed: 6 }), GOAL).perfect).toBe(false);
  });
});

describe('Drum Coach best pass', () => {
  it('prefers fewer mistakes over better timing', () => {
    expect(isBetter(score({ close: 10 }), score({ perfect: 10, stray: 1 }))).toBe(true);
  });

  it('with equal mistakes, prefers more blue and green, then more blue', () => {
    expect(isBetter(score({ good: 9, close: 1 }), score({ perfect: 8, close: 2 }))).toBe(true);
    expect(isBetter(score({ perfect: 6, good: 4 }), score({ perfect: 5, good: 5 }))).toBe(true);
  });

  it('compares shares, so passes of different lengths compare fairly', () => {
    expect(isBetter(score({ perfect: 9, good: 1 }), score({ perfect: 80, good: 20 }))).toBe(true);
  });

  it('does not count an identical pass as better', () => {
    expect(isBetter(score({ perfect: 5 }), score({ perfect: 5 }))).toBe(false);
  });
});

describe('Drum Coach session verdict', () => {
  const v = (fields) => verdict(score(fields), GOAL, FEW_MISTAKES_PERCENT);

  it('rates a session meeting the goal as clean', () => {
    expect(v({ perfect: 90, good: 10 })).toBe('clean');
  });

  it('rates a session without mistakes but short of the targets as solid', () => {
    expect(v({ perfect: 10, good: 70, close: 20 })).toBe('solid');
  });

  it('separates a few mistakes from many by their share of the notes', () => {
    expect(v({ perfect: 97, missed: 2, stray: 1 })).toBe('getting-there'); // 3 of 99 notes
    expect(v({ perfect: 90, missed: 10 })).toBe('keep-at-it');
  });

  it('totals passes without losing any count', () => {
    const a = score({ perfect: 1, good: 2, close: 3, missed: 4, stray: 5 });
    expect(addScores(a, a)).toEqual({ perfect: 2, good: 4, close: 6, missed: 8, stray: 10 });
  });
});
