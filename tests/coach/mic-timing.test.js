import { describe, it, expect } from 'vitest';
import { analyzeMicTiming } from '../../coach/engine/MicTiming.js';
import { roomSound, normalNoise, SAMPLE_RATE } from './helpers/micRoom.js';

const CLICK_INTERVAL_MS = 375;
const CLICKS = 24;
const TAPS = 20;

/**
 * A measurement in a room where the click comes out of the headphones outputErrorMs later than
 * the coach reckons, MIDI arrives midiDelayMs after a stick hits, and the mic hears everything
 * micDelayMs late (micDelayAfterMs for the second round of clicks, if it moved). A louder
 * knock knockAfterFirstTapMs after the first tap, if given.
 */
function measure({
  outputErrorMs,
  midiDelayMs,
  micDelayMs,
  micDelayAfterMs = micDelayMs,
  midiJitterMs = 0.5,
  tapLevel = 0.3,
  clickLevel = 0.3,
  knockAfterFirstTapMs = null,
  seed = 1,
}) {
  const jitter = normalNoise(seed + 100);
  const round = (startMs) =>
    Array.from({ length: CLICKS }, (_, i) => startMs + i * CLICK_INTERVAL_MS);
  const clickRounds = [round(1000), round(26000)];
  // taps at an uneven pace in between, the way a player taps without a click
  const stickMs = Array.from({ length: TAPS }, (_, i) => 12000 + i * 1000 + 150 * jitter());
  const tapsMs = stickMs.map((ms) => ms + midiDelayMs + midiJitterMs * jitter());
  const heardClicks = clickRounds.flatMap((r, i) =>
    r.map((ms) => ({
      atMs: ms + outputErrorMs + (i === 0 ? micDelayMs : micDelayAfterMs),
      level: clickLevel,
    }))
  );
  // the mic's delay halfway between the rounds, while the taps are played
  const tapMicDelayMs = (micDelayMs + micDelayAfterMs) / 2;
  const heardTaps = stickMs.map((ms) => ({ atMs: ms + tapMicDelayMs, level: tapLevel }));
  const startMs = 500;
  const recording = {
    samples: roomSound({
      startMs,
      lengthMs: 36000,
      clicks: heardClicks,
      taps:
        knockAfterFirstTapMs === null
          ? heardTaps
          : [...heardTaps, { atMs: heardTaps[0].atMs + knockAfterFirstTapMs, level: 0.9 }],
      seed,
    }),
    sampleRate: SAMPLE_RATE,
    startMs,
  };
  return analyzeMicTiming({ recording, clickRounds, clickIntervalMs: CLICK_INTERVAL_MS, tapsMs });
}

describe('measuring the system with a mic', () => {
  it('finds how much later the coach sees a hit, against the click as heard', () => {
    const result = measure({ outputErrorMs: 18, midiDelayMs: 6, micDelayMs: 25 });
    expect(result.failure).toBeNull();
    // the click comes 18 ms later than reckoned, and MIDI takes 6 ms more: a hit right on the
    // click as heard looks 24 ms late to the coach
    expect(result.systemMs).toBeCloseTo(18 + 6, 0);
  });

  it("gives the same result whatever the mic's own delay", () => {
    const quick = measure({ outputErrorMs: -4, midiDelayMs: 9, micDelayMs: 3 });
    const slow = measure({ outputErrorMs: -4, midiDelayMs: 9, micDelayMs: 140 });
    expect(Math.abs(quick.systemMs - slow.systemMs)).toBeLessThan(0.5);
    expect(slow.systemMs).toBeCloseTo(-4 + 9, 0);
  });

  it('takes a mic delay drifting steadily as the delay halfway, while the taps were played', () => {
    const result = measure({
      outputErrorMs: 10,
      midiDelayMs: 5,
      micDelayMs: 20,
      micDelayAfterMs: 21.5,
    });
    expect(result.failure).toBeNull();
    expect(result.systemMs).toBeCloseTo(10 + 5, 0);
  });

  it("doesn't give a result when the mic's own delay moved between the rounds of clicks", () => {
    const result = measure({
      outputErrorMs: 10,
      midiDelayMs: 5,
      micDelayMs: 20,
      micDelayAfterMs: 30,
    });
    expect(result.failure).toBe('moved');
  });

  it("doesn't give a result when the mic couldn't hear the click", () => {
    const result = measure({
      outputErrorMs: 10,
      midiDelayMs: 5,
      micDelayMs: 20,
      clickLevel: 0.005,
    });
    expect(result.failure).toBe('clicks');
  });

  it("doesn't give a result when the mic heard too few taps", () => {
    const result = measure({ outputErrorMs: 10, midiDelayMs: 5, micDelayMs: 20, tapLevel: 0.005 });
    expect(result.failure).toBe('taps');
  });

  it('times taps by their start, not a louder sound soon after (a rebound, the kit next door)', () => {
    const plain = measure({ outputErrorMs: 10, midiDelayMs: 5, micDelayMs: 20 });
    const knock = measure({
      outputErrorMs: 10,
      midiDelayMs: 5,
      micDelayMs: 20,
      knockAfterFirstTapMs: 40,
    });
    expect(knock.failure).toBeNull();
    expect(Math.abs(knock.systemMs - plain.systemMs)).toBeLessThan(0.5);
  });
});
