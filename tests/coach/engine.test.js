import { describe, it, expect } from 'vitest';
import { Engine } from '../../coach/engine/Engine.js';
import { DrumType } from '../../coach/engine/DrumConstants.js';

const WINDOWS = { perfect: 20, good: 35, close: 50 };

// An engine already playing a pass that started `elapsedMs` ago, with no latency.
function playingEngine(target, elapsedMs) {
  const engine = new Engine({ latencyMs: () => 0, windows: WINDOWS });
  engine.loadGroove({ target });
  engine.start(performance.now() - elapsedMs);
  return engine;
}

describe('Drum Coach engine note matching', () => {
  it('matches a cross-stick hit to a cross-stick note', () => {
    const engine = playingEngine([{ time: 0, type: DrumType.SNARE_XSTICK }], 10);
    const result = engine.handleMidiHit(DrumType.SNARE_XSTICK, engine.startTime);
    expect(result.tier).toBe('perfect');
  });

  it('does not credit a plain snare hit for a cross-stick note', () => {
    const engine = playingEngine([{ time: 0, type: DrumType.SNARE_XSTICK }], 10);
    const result = engine.handleMidiHit(DrumType.SNARE, engine.startTime);
    expect(result.tier).toBe('extra');
  });

  it.each([DrumType.SNARE_GHOST, DrumType.SNARE_ACCENT])(
    'still credits a snare hit for a %s note',
    (noteType) => {
      const engine = playingEngine([{ time: 0, type: noteType }], 10);
      expect(engine.handleMidiHit(DrumType.SNARE, engine.startTime).tier).toBe('perfect');
    }
  );
});

describe('Drum Coach engine scoring', () => {
  const kicks = [
    { time: 0, type: DrumType.KICK },
    { time: 500, type: DrumType.KICK },
  ];
  const notesInTiers = (r) => r.perfect + r.good + r.close + r.miss;

  it('treats a hit outside every window as an extra and leaves the note open', () => {
    const engine = playingEngine(kicks, 91);
    expect(engine.handleMidiHit(DrumType.KICK, engine.startTime + 90).tier).toBe('extra');
    // a better-timed hit on the same note still counts
    expect(engine.handleMidiHit(DrumType.KICK, engine.startTime + 10).tier).toBe('perfect');
  });

  it('puts every note in exactly one tier and counts stray hits as extras', () => {
    const engine = playingEngine(kicks, 91);
    engine.handleMidiHit(DrumType.KICK, engine.startTime + 90); // way off the first kick
    const results = engine.getResults();
    expect(notesInTiers(results)).toBe(results.totalNotes);
    expect(results.miss).toBe(2);
    expect(results.extra).toBe(1);
  });
});
