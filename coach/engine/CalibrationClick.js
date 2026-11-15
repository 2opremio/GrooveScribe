import { coachState } from '../state/State.js';

// Well above a snare's body (roughly 150-400 Hz plus a noise band), so the click doesn't
// blur into the drum being hit on it, and a sharp, steady start for a mic to time.
const CLICK_FREQ_HZ = 2500;
const CLICK_DURATION_S = 0.03;
// gain at 100% metronome volume; just under full scale, so the click can't clip
const CLICK_MAX_GAIN = 0.9;
// the level the click fades to by its end, inaudible
const CLICK_END_GAIN = 0.001;
const PERCENT = 100;

/**
 * Schedule one calibration click at the metronome volume.
 * @param {AudioContext} ctx
 * @param {number} audioTime - when the click plays, on the audio clock, in s
 * @param {number} relativeGain - its loudness against a click on the beat
 * @returns {OscillatorNode} the click, to stop it early
 */
export function scheduleCalibrationClick(ctx, audioTime, relativeGain) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = CLICK_FREQ_HZ;
  osc.type = 'sine';
  const clickGain = CLICK_MAX_GAIN * relativeGain * (coachState.metronomeVolume / PERCENT);
  gain.gain.setValueAtTime(clickGain, audioTime);
  gain.gain.exponentialRampToValueAtTime(CLICK_END_GAIN, audioTime + CLICK_DURATION_S);
  osc.start(audioTime);
  osc.stop(audioTime + CLICK_DURATION_S);
  return osc;
}
