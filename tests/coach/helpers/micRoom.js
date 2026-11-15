/**
 * A room as a mic hears it: the click from an ear cup resting on it, stick taps on a pad next to
 * it, and a little background noise. Times are on the audio context's clock, in ms.
 */
export const SAMPLE_RATE = 48000;
const MS_PER_S = 1000;
const CLICK_HZ = 2500;
const CLICK_MS = 30;
const TAP_MS = 15;
// how fast a tap's sound dies away, in ms
const TAP_DECAY_MS = 3;

/** Normally distributed numbers from a fixed seed, so every run sees the same room. */
export function normalNoise(seed) {
  let state = seed;
  const uniform = () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return (state + 1) / (2 ** 32 + 1);
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

/**
 * @param {object} room
 * @param {number} room.startMs - when the recording starts
 * @param {number} room.lengthMs
 * @param {{atMs: number, level: number}[]} room.clicks - each click as it reaches the mic
 * @param {{atMs: number, level: number}[]} room.taps - each tap as it reaches the mic
 * @param {number} [room.noise] - background level
 * @param {number} [room.seed]
 * @returns {Float32Array}
 */
export function roomSound({ startMs, lengthMs, clicks, taps, noise = 0.002, seed = 1 }) {
  const samples = new Float32Array(Math.round((lengthMs * SAMPLE_RATE) / MS_PER_S));
  const random = normalNoise(seed);
  for (let i = 0; i < samples.length; i++) samples[i] = noise * random();
  const indexOf = (ms) => Math.round(((ms - startMs) * SAMPLE_RATE) / MS_PER_S);
  for (const { atMs, level } of clicks) {
    const from = indexOf(atMs);
    const length = (CLICK_MS * SAMPLE_RATE) / MS_PER_S;
    for (let i = 0; i < length && from + i < samples.length; i++) {
      if (from + i < 0) continue;
      const t = i / SAMPLE_RATE;
      samples[from + i] +=
        level * Math.exp(-i / length / 0.3) * Math.sin(2 * Math.PI * CLICK_HZ * t);
    }
  }
  for (const { atMs, level } of taps) {
    const from = indexOf(atMs);
    const length = (TAP_MS * SAMPLE_RATE) / MS_PER_S;
    const decay = (TAP_DECAY_MS * SAMPLE_RATE) / MS_PER_S;
    for (let i = 0; i < length && from + i < samples.length; i++) {
      if (from + i < 0) continue;
      samples[from + i] += level * Math.exp(-i / decay) * random();
    }
  }
  return samples;
}
