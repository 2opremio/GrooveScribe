import { describe, it, expect } from 'vitest';
import {
  TOLERANCE_LEVELS,
  toleranceWindows,
  evaluateHit,
} from '../../coach/engine/TimingEvaluator.js';
import { NORMAL_HIT_MATCH_WINDOW_MS } from '../../coach/engine/Engine.js';

const LEVELS = Object.keys(TOLERANCE_LEVELS);
const TEMPOS = [30, 40, 60, 71, 90, 120, 160, 240];

describe('tolerance levels', () => {
  it('widen with the beat between 60 and 120 bpm', () => {
    for (const level of LEVELS) {
      const at60 = toleranceWindows(level, 60);
      const at120 = toleranceWindows(level, 120);
      expect(at60.close).toBeCloseTo(2 * at120.close);
    }
  });

  it('stop widening below 60 bpm and narrowing above 120 bpm', () => {
    for (const level of LEVELS) {
      expect(toleranceWindows(level, 30)).toEqual(toleranceWindows(level, 60));
      expect(toleranceWindows(level, 240)).toEqual(toleranceWindows(level, 120));
    }
  });

  it('are stricter at each higher level, at every tempo', () => {
    for (const bpm of TEMPOS) {
      const closes = LEVELS.map((level) => toleranceWindows(level, bpm).close);
      expect(closes).toEqual([...closes].sort((a, b) => b - a));
    }
  });

  it('never grade a hit the engine would not match to its note', () => {
    for (const level of LEVELS) {
      for (const bpm of TEMPOS) {
        expect(toleranceWindows(level, bpm).close).toBeLessThan(NORMAL_HIT_MATCH_WINDOW_MS);
      }
    }
  });

  it('grade the same share of a beat the same at any tempo in range', () => {
    for (const level of LEVELS) {
      const tiers = [60, 71, 90, 120].map((bpm) => {
        const beatMs = 60000 / bpm;
        const windows = toleranceWindows(level, bpm);
        return [0.01, 0.03, 0.05, 0.07, 0.12].map(
          (share) => evaluateHit(share * beatMs, 0, 0, windows).tier
        );
      });
      for (const t of tiers) expect(t).toEqual(tiers[0]);
    }
  });
});
