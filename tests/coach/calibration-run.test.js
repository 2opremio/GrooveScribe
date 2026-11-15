import { describe, it, expect } from 'vitest';
import { CalibrationRun } from '../../coach/engine/CalibrationRun.js';

const BEAT_MS = 750;
const NOTES_PER_BEAT = { quarters: 1, eighths: 2, sixteenths: 4 };

/** Normally distributed numbers from a fixed seed, so every run of a test sees the same hits. */
function normalNoise(seed) {
  let state = seed;
  const uniform = () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return (state + 1) / (2 ** 32 + 1);
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

/**
 * A player on a rhythm, hitting `offsetMs(n)` from the n-th note with a spread of `spreadMs`,
 * until the run finishes or gives up; `onStatus` sees the run's status after every hit.
 */
function play(
  run,
  { rhythm, offsetMs, spreadMs, seed = 1, fromNote = 0, maxNotes = 2000, onStatus = () => {} }
) {
  const gridMs = BEAT_MS / NOTES_PER_BEAT[rhythm];
  const noise = normalNoise(seed);
  for (let n = fromNote; n < fromNote + maxNotes; n++) {
    const offset = typeof offsetMs === 'function' ? offsetMs(n) : offsetMs;
    run.addTap(n * gridMs + offset + spreadMs * noise(), 100);
    const status = run.status();
    onStatus(status);
    const { phase } = status;
    if (phase === 'done' || phase === 'failed') return n;
  }
  return fromNote + maxNotes;
}

const newRun = () => new CalibrationRun({ beatMs: BEAT_MS, hitRule: 'every' });

describe('calibration run', () => {
  it.each(['quarters', 'eighths', 'sixteenths'])(
    'tells a steady player on %s apart and finds their offset',
    (rhythm) => {
      const run = newRun();
      play(run, { rhythm, offsetMs: -14, spreadMs: 20 });
      const status = run.status();
      expect(status.phase).toBe('done');
      expect(status.rhythm).toBe(rhythm);
      expect(Math.abs(status.offsetMs - -14)).toBeLessThan(3 * status.precisionMs);
    }
  );

  it('measures where a player settled after sliding, not the average of the slide', () => {
    const run = newRun();
    // sliding from -10 to -70 ms over the first 120 16ths, then steady
    const slide = (n) => -10 - 60 * Math.min(1, n / 120);
    const drifts = new Set();
    play(run, {
      rhythm: 'sixteenths',
      offsetMs: slide,
      spreadMs: 15,
      seed: 3,
      onStatus: (status) => drifts.add(status.drift),
    });
    expect(drifts.has('earlier')).toBe(true);
    expect(drifts.has('later')).toBe(false);
    const status = run.status();
    expect(status.phase).toBe('done');
    expect(Math.abs(status.offsetMs - -70)).toBeLessThan(5);
  });

  it('does not accept hits too scattered to be locked onto the click', () => {
    const run = newRun();
    play(run, { rhythm: 'eighths', offsetMs: 0, spreadMs: 90, seed: 5 });
    expect(run.status().phase).toBe('failed');
    expect(run.isDone()).toBe(false);
  });

  it('keeps the rhythm and the result through the odd missed note and stray hit', () => {
    const steady = newRun();
    play(steady, { rhythm: 'sixteenths', offsetMs: -20, spreadMs: 12, seed: 7 });

    const sloppy = newRun();
    const gridMs = BEAT_MS / 4;
    const noise = normalNoise(7);
    for (let n = 0; sloppy.status().phase !== 'done' && n < 2000; n++) {
      const hit = n * gridMs - 20 + 12 * noise();
      if (n % 23 === 5) continue; // a missed note
      sloppy.addTap(hit, 100);
      if (n % 31 === 9) sloppy.addTap(hit + gridMs / 2, 100); // a stray hit between notes
    }
    expect(sloppy.status().rhythm).toBe('sixteenths');
    expect(Math.abs(sloppy.status().offsetMs - steady.status().offsetMs)).toBeLessThan(4);
  });

  it('starts over when the player changes rhythm, and measures the new one', () => {
    const run = newRun();
    play(run, { rhythm: 'quarters', offsetMs: 30, spreadMs: 20, maxNotes: 20 });
    expect(run.status().rhythm).toBe('quarters');
    // 20 quarters later, on 16ths: the next 16th is the 80th
    play(run, { rhythm: 'sixteenths', offsetMs: -10, spreadMs: 20, fromNote: 80, seed: 9 });
    const status = run.status();
    expect(status.phase).toBe('done');
    expect(status.rhythm).toBe('sixteenths');
    expect(Math.abs(status.offsetMs - -10)).toBeLessThan(5);
  });

  it('counts only the loudest of a flam on one note when told to', () => {
    const run = new CalibrationRun({ beatMs: BEAT_MS, hitRule: 'loudest' });
    const gridMs = BEAT_MS / 4;
    for (let n = 0; run.status().phase !== 'done' && n < 2000; n++) {
      run.addTap(n * gridMs - 40, 30); // a soft grace note
      run.addTap(n * gridMs + 5, 100); // the real hit
    }
    expect(run.status().offsetMs).toBeCloseTo(5, 5);
  });

  it('does not take 8th-note triplets for any rhythm it measures', () => {
    const run = newRun();
    const tripletMs = BEAT_MS / 3;
    for (let n = 0; n < 60; n++) run.addTap(n * tripletMs, 100);
    expect(run.status().phase).toBe('listening');
  });

  it('does not accept quarter notes played a 16th off the beat', () => {
    const run = newRun();
    play(run, { rhythm: 'quarters', offsetMs: BEAT_MS / 4, spreadMs: 10 });
    const status = run.status();
    expect(status.phase).toBe('failed');
    expect(status.failure).toBe('offbeat');
  });

  it('gives up early on hits too scattered to finish in time, instead of at the time limit', () => {
    const run = newRun();
    const lastNote = play(run, { rhythm: 'quarters', offsetMs: 0, spreadMs: 38, seed: 11 });
    expect(run.status().phase).toBe('failed');
    expect(run.status().failure).toBe('scattered');
    // the measuring limit is 90 s; this knows well before
    expect(lastNote * BEAT_MS).toBeLessThan(60000);
  });
});
