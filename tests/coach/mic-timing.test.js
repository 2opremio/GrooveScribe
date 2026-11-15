import { describe, it, expect } from 'vitest';
import { analyzeMicTiming } from '../../coach/engine/MicTiming.js';
import { roomSound, normalNoise, SAMPLE_RATE } from './helpers/micRoom.js';

const CLICK_INTERVAL_MS = 375;
const CLICKS = 24;
const TAPS = 20;

/**
 * A measurement in a room where the click comes out of the headphones outputErrorMs later than
 * the coach reckons, MIDI arrives midiDelayMs after a stick hits, the kit sounds the drum
 * soundDelayMs after the stick, and the mic hears everything micDelayMs late, moving steadily to
 * micDelayAfterMs by the second round of clicks. A louder knock knockAfterFirstTapMs after the
 * first stick tap, if given.
 */
function measure({
  outputErrorMs,
  midiDelayMs,
  soundDelayMs = 6,
  micDelayMs,
  micDelayAfterMs = micDelayMs,
  midiJitterMs = 0.5,
  stickLevel = 0.3,
  drumSoundLevel = 0.5,
  clickLevel = 0.3,
  knockAfterFirstTapMs = null,
  roomNoise = undefined,
  farStickLevel = 0,
  seed = 1,
}) {
  const jitter = normalNoise(seed + 100);
  const round = (startMs) =>
    Array.from({ length: CLICKS }, (_, i) => startMs + i * CLICK_INTERVAL_MS);
  const [firstRoundMs, lastRoundMs] = [1000, 52000];
  const clickRounds = [round(firstRoundMs), round(lastRoundMs)];
  const micDelayAt = (ms) =>
    micDelayMs +
    ((micDelayAfterMs - micDelayMs) * (ms - firstRoundMs)) / (lastRoundMs - firstRoundMs);
  // taps at an uneven pace, the way a player taps without a click: the drum sounds, then sticks
  const taps = (fromMs) =>
    Array.from({ length: TAPS }, (_, i) => fromMs + i * 1000 + 150 * jitter());
  const soundSticksMs = taps(11000);
  const nearSticksMs = taps(31000);
  const midi = (sticks) => sticks.map((ms) => ms + midiDelayMs + midiJitterMs * jitter());
  const heard = (ms, level) => ({ atMs: ms + micDelayAt(ms), level });
  const heardClicks = clickRounds.flat().map((ms) => heard(ms + outputErrorMs, clickLevel));
  const heardTaps = [
    ...soundSticksMs.map((ms) => heard(ms + soundDelayMs, drumSoundLevel)),
    // the stick on the far pad, heard faintly ahead of its drum sound
    ...(farStickLevel > 0 ? soundSticksMs.map((ms) => heard(ms, farStickLevel)) : []),
    ...nearSticksMs.map((ms) => heard(ms, stickLevel)),
  ];
  if (knockAfterFirstTapMs !== null) {
    heardTaps.push(heard(nearSticksMs[0] + knockAfterFirstTapMs, 0.9));
  }
  const startMs = 500;
  const recording = {
    samples: roomSound({
      startMs,
      lengthMs: 62000,
      clicks: heardClicks,
      taps: heardTaps,
      noise: roomNoise,
      seed,
    }),
    sampleRate: SAMPLE_RATE,
    startMs,
  };
  return analyzeMicTiming({
    recording,
    clickRounds,
    clickIntervalMs: CLICK_INTERVAL_MS,
    soundTapsMs: midi(soundSticksMs),
    stickTapsMs: midi(nearSticksMs),
  });
}

describe('measuring the system with a mic', () => {
  it('finds how much later the coach sees a hit, against the click as heard', () => {
    const result = measure({ outputErrorMs: 18, midiDelayMs: 6, soundDelayMs: 5, micDelayMs: 25 });
    expect(result.failure).toBeNull();
    // the click comes 18 ms later than reckoned, and MIDI takes 6 ms more: a hit whose stick is
    // right on the click as heard looks 24 ms late to the coach
    expect(result.stickMs).toBeCloseTo(18 + 6, 0);
    // and one whose drum sound is, 5 ms less: its stick landed that much earlier
    expect(result.soundDelayMs).toBeCloseTo(5, 0);
    expect(result.soundMs).toBeCloseTo(18 + 6 - 5, 0);
  });

  it("gives the same result whatever the mic's own delay", () => {
    const quick = measure({ outputErrorMs: -4, midiDelayMs: 9, micDelayMs: 3 });
    const slow = measure({ outputErrorMs: -4, midiDelayMs: 9, micDelayMs: 140 });
    expect(Math.abs(quick.stickMs - slow.stickMs)).toBeLessThan(0.5);
    expect(Math.abs(quick.soundMs - slow.soundMs)).toBeLessThan(0.5);
    expect(slow.stickMs).toBeCloseTo(-4 + 9, 0);
  });

  it('measures each tap against the mic delay as it was then, when it drifts steadily', () => {
    const result = measure({
      outputErrorMs: 10,
      midiDelayMs: 5,
      soundDelayMs: 6,
      micDelayMs: 20,
      micDelayAfterMs: 21.9,
    });
    expect(result.failure).toBeNull();
    expect(result.stickMs).toBeCloseTo(10 + 5, 0);
    expect(result.soundDelayMs).toBeCloseTo(6, 0);
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
    const quietSticks = measure({
      outputErrorMs: 10,
      midiDelayMs: 5,
      micDelayMs: 20,
      stickLevel: 0.005,
    });
    expect(quietSticks.failure).toBe('stickTaps');
    const quietDrums = measure({
      outputErrorMs: 10,
      midiDelayMs: 5,
      micDelayMs: 20,
      drumSoundLevel: 0.005,
    });
    expect(quietDrums.failure).toBe('soundTaps');
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
    expect(Math.abs(knock.stickMs - plain.stickMs)).toBeLessThan(0.5);
  });

  it('times sounds the same over the steady hiss of a fan', () => {
    const quiet = measure({ outputErrorMs: 10, midiDelayMs: 5, micDelayMs: 20 });
    // a hiss ten times the quiet room's, whose peaks reach a fifth of the sounds'
    const fan = measure({ outputErrorMs: 10, midiDelayMs: 5, micDelayMs: 20, roomNoise: 0.02 });
    expect(fan.failure).toBeNull();
    expect(Math.abs(fan.stickMs - quiet.stickMs)).toBeLessThan(0.5);
    expect(Math.abs(fan.soundMs - quiet.soundMs)).toBeLessThan(0.5);
  });

  it('times the drum sound, not a quieter stick on the far pad just before it', () => {
    const result = measure({
      outputErrorMs: 10,
      midiDelayMs: 5,
      soundDelayMs: 6,
      micDelayMs: 20,
      farStickLevel: 0.2,
    });
    expect(result.failure).toBeNull();
    expect(result.soundDelayMs).toBeCloseTo(6, 0);
  });

  it("doesn't take a drum sound found before its stick: the kit can't sound early", () => {
    const result = measure({ outputErrorMs: 10, midiDelayMs: 5, soundDelayMs: -4, micDelayMs: 20 });
    expect(result.failure).toBe('stickHeard');
  });
});
