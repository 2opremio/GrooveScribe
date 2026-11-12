import { describe, it, expect } from 'vitest';
import { StateManager } from '../../coach/state/State.js';

describe('Drum Coach settings', () => {
  it('remembers the auto BPM and goal settings across a save and load', () => {
    const saved = new StateManager();
    saved.autoBpm = true;
    saved.autoBpmPasses = 3;
    saved.goalMinPerfectPercent = 60;
    saved.goalMaxClosePercent = 5;
    saved.goalMaxMissedPercent = 3;
    saved.goalMaxStrayPercent = 4;
    saved.fewMistakesPercent = 8;

    const loaded = new StateManager();
    loaded.fromObject(JSON.parse(JSON.stringify(saved.toObject())));
    expect(loaded.toObject()).toEqual(saved.toObject());
    expect(loaded.goal).toEqual({
      minPerfectPercent: 60,
      maxClosePercent: 5,
      maxMissedPercent: 3,
      maxStrayPercent: 4,
    });
  });

  it('keeps settings saved before the new ones existed, with defaults for the rest', () => {
    const loaded = new StateManager();
    loaded.fromObject({ mode: 'performance', reps: 6 });
    expect(loaded.mode).toBe('performance');
    expect(loaded.reps).toBe(6);
    expect(loaded.autoBpm).toBe(false);
    expect(loaded.autoBpmPasses).toBe(1);
  });

  it('rejects an auto BPM pass count below one', () => {
    const state = new StateManager();
    state.autoBpmPasses = 0;
    expect(state.autoBpmPasses).toBe(1);
  });
});
