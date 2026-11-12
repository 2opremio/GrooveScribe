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
  const notesInTiers = (score) => score.perfect + score.good + score.close + score.missed;

  it('treats a hit outside every window as a stray hit and leaves the note open', () => {
    const engine = playingEngine(kicks, 91);
    expect(engine.handleMidiHit(DrumType.KICK, engine.startTime + 90).tier).toBe('extra');
    // a better-timed hit on the same note still counts
    expect(engine.handleMidiHit(DrumType.KICK, engine.startTime + 10).tier).toBe('perfect');
  });

  it('puts every note of a finished pass in exactly one tier and counts stray hits', () => {
    const engine = playingEngine(kicks, 91);
    engine.handleMidiHit(DrumType.KICK, engine.startTime + 90); // way off the first kick
    engine.finishPass();
    const score = engine.passScore();
    expect(notesInTiers(score)).toBe(kicks.length);
    expect(score.missed).toBe(2);
    expect(score.stray).toBe(1);
  });

  it('reports a note as missed only once no hit can be graded against it any more', () => {
    const engine = playingEngine(kicks, 0);
    // the first kick can still be hit just after its time
    expect(engine.takeMissedNotes(engine.startTime + 100)).toHaveLength(0);
    expect(engine.handleMidiHit(DrumType.KICK, engine.startTime + 30).isMatch).toBe(true);
    // long after both kicks, only the one never hit is missed, and only once
    const missed = engine.takeMissedNotes(engine.startTime + 2000);
    expect(missed.map((n) => n.time)).toEqual([500]);
    expect(engine.takeMissedNotes(engine.startTime + 3000)).toHaveLength(0);
    expect(engine.passScore().missed).toBe(1);
  });

  it('starts each pass with no notes missed', () => {
    const engine = playingEngine(kicks, 0);
    engine.finishPass();
    engine.start(performance.now());
    expect(engine.passScore()).toEqual({ perfect: 0, good: 0, close: 0, missed: 0, stray: 0 });
  });
});
