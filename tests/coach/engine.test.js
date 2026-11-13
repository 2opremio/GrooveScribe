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

  it('puts every note of a finished pass in exactly one tier', () => {
    const engine = playingEngine(kicks, 91);
    engine.handleMidiHit(DrumType.KICK, engine.startTime + 90); // way off the first kick
    engine.finishPass();
    expect(notesInTiers(engine.passScore())).toBe(kicks.length);
  });

  it('counts a way-off attempt at a note that ends up missed as one mistake, the miss', () => {
    const engine = playingEngine(kicks, 91);
    engine.handleMidiHit(DrumType.KICK, engine.startTime + 90); // way off the first kick
    engine.finishPass();
    const score = engine.passScore();
    expect(score.missed).toBe(2);
    expect(score.stray).toBe(0);
  });

  it('counts a way-off hit next to a note that was hit after all as a stray hit', () => {
    const engine = playingEngine(kicks, 91);
    engine.handleMidiHit(DrumType.KICK, engine.startTime + 90); // way off the first kick
    engine.handleMidiHit(DrumType.KICK, engine.startTime + 5); // then the first kick, on time
    engine.finishPass();
    expect(engine.passScore().stray).toBe(1);
  });

  it('counts a hit with no note in reach as a stray hit', () => {
    const engine = playingEngine([{ time: 0, type: DrumType.SNARE }], 400);
    engine.handleMidiHit(DrumType.KICK, engine.startTime + 300);
    expect(engine.passScore().stray).toBe(1);
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

describe('Drum Coach pass timing offset', () => {
  // three notes on different drums, so each hit can only be graded against its own note
  const NOW_MS = 1010;
  const notes = [
    { time: 900, type: DrumType.KICK },
    { time: 950, type: DrumType.SNARE },
    { time: 1000, type: DrumType.HH_CLOSED },
  ];

  it('is the typical error of the graded hits, early being negative', () => {
    const engine = playingEngine(notes, NOW_MS);
    engine.handleMidiHit(DrumType.KICK, engine.startTime + 900 - 12);
    engine.handleMidiHit(DrumType.SNARE, engine.startTime + 950 - 30);
    engine.handleMidiHit(DrumType.HH_CLOSED, engine.startTime + 1000 + 4);
    expect(engine.passTimingOffset()).toBeCloseTo(-12);
  });

  it('ignores stray hits, which belong to no note', () => {
    const engine = playingEngine(notes, NOW_MS);
    engine.handleMidiHit(DrumType.KICK, engine.startTime + 900 - 10);
    engine.handleMidiHit(DrumType.SNARE, engine.startTime + 950 + 90); // too late to grade
    expect(engine.passTimingOffset()).toBeCloseTo(-10);
  });

  it('is unknown before any hit is graded', () => {
    expect(playingEngine(notes, NOW_MS).passTimingOffset()).toBeNull();
  });
});

describe('Drum Coach stray hits', () => {
  // the last kick of one play and the first kick of the next, 200 ms apart
  const kicks = [
    { time: 1000, type: DrumType.KICK },
    { time: 1200, type: DrumType.KICK },
  ];

  it('keep the closest note not yet hit, so an early hit goes to the next note once the last is hit', () => {
    const engine = playingEngine(kicks, 1130);
    engine.handleMidiHit(DrumType.KICK, engine.startTime + 1000); // the last note, on time
    const stray = engine.handleMidiHit(DrumType.KICK, engine.startTime + 1120); // 80 ms early
    expect(stray.tier).toBe('extra');
    expect(stray.nearestNoteIndex).toBe(1);
    expect(stray.timingError).toBeCloseTo(-80);
  });

  it('keep the closer note when neither was hit', () => {
    const engine = playingEngine(kicks, 1130);
    const stray = engine.handleMidiHit(DrumType.KICK, engine.startTime + 1070); // 70 ms late
    expect(stray.nearestNoteIndex).toBe(0);
  });
});

describe('Drum Coach wrong-drum hits', () => {
  const snareNote = [{ time: 1000, type: DrumType.SNARE }];
  const mistakes = (score) => score.missed + score.stray;

  it('count a hit on the wrong drum, with its note missed, as one mistake', () => {
    const engine = playingEngine(snareNote, 1000);
    engine.handleMidiHit(DrumType.HH_CLOSED, engine.startTime + 1000); // hi-hat instead of snare
    engine.finishPass();
    const score = engine.passScore();
    expect(score.missed).toBe(1);
    expect(mistakes(score)).toBe(1);
  });

  it('count a wrong-drum hit as its own mistake when the right drum was hit too', () => {
    const engine = playingEngine(snareNote, 1000);
    engine.handleMidiHit(DrumType.HH_CLOSED, engine.startTime + 995);
    engine.handleMidiHit(DrumType.SNARE, engine.startTime + 1000);
    engine.finishPass();
    const score = engine.passScore();
    expect(score.perfect).toBe(1);
    expect(mistakes(score)).toBe(1);
  });

  it('count a hit far from any note as a stray', () => {
    const engine = playingEngine(snareNote, 1600);
    engine.handleMidiHit(DrumType.HH_CLOSED, engine.startTime + 1600);
    engine.finishPass();
    expect(mistakes(engine.passScore())).toBe(2); // the stray, and the snare nobody played
  });
});
