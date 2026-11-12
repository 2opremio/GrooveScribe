import { describe, it, expect } from 'vitest';
import { PlaylineInterpolator } from '../../coach/ui/feedback/PlaylineInterpolator.js';

// Two lines of music, one measure each, 1000 ms per measure, quarter notes.
// Barlines at x 10 and 210 on each line; notes at x 40, 80, 120, 160.
const MEASURE_MS = 1000;
const BAR_LEFT_X = 10;
const BAR_RIGHT_X = 210;
const NOTE_XS = [40, 80, 120, 160];

function line(measureIndex) {
  const start = measureIndex * MEASURE_MS;
  return {
    measureBoundaries: [
      { timeMs: start, measureIndex, x: BAR_LEFT_X },
      { timeMs: start + MEASURE_MS, measureIndex: measureIndex + 1, x: BAR_RIGHT_X },
    ],
    timeline: NOTE_XS.map((x, i) => ({ timeMs: start + (i * MEASURE_MS) / NOTE_XS.length, x })),
  };
}

function build() {
  const systems = [line(0), line(1)];
  const interp = new PlaylineInterpolator();
  interp.build(systems);
  return { interp, systems };
}

describe('Drum Coach playline', () => {
  it('stays inside the measure being played until that measure ends', () => {
    const { interp, systems } = build();
    for (let t = 0; t < 2 * MEASURE_MS; t += 5) {
      const { x, sys } = interp.interpolate(t);
      expect(sys).toBe(systems[Math.floor(t / MEASURE_MS)]);
      expect(x).toBeGreaterThanOrEqual(BAR_LEFT_X);
      expect(x).toBeLessThanOrEqual(BAR_RIGHT_X);
    }
  });

  it('reaches the closing barline as the measure ends', () => {
    const { interp } = build();
    const { x } = interp.interpolate(MEASURE_MS - 1);
    expect(BAR_RIGHT_X - x).toBeLessThan(1);
  });

  it('moves the same way when following the cursor', () => {
    const { interp } = build();
    for (let t = 0; t < 2 * MEASURE_MS; t += 5) {
      expect(interp.interpolateWithCursor(t)).toEqual(interp.interpolate(t));
    }
  });

  it('starts each measure at its barline time, measure 0 at the loop point', () => {
    const { interp } = build();
    expect(interp.thresholds).toEqual([
      { measureIndex: 1, timeMs: MEASURE_MS },
      { measureIndex: 0, timeMs: 2 * MEASURE_MS },
    ]);
  });
});
