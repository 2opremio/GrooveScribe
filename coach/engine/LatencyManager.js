import { coachState } from '../state/State.js';

const MS_PER_SECOND = 1000;

/**
 * LatencyManager - How long after a sound is scheduled the player hears it.
 *
 * Two parts:
 *  - the output delay the browser reports for the AudioContext, read at the moment it is
 *    needed. Chromium reports a larger, stale value until output is running (64 ms before
 *    playback vs 24 ms while playing on macOS), so the value must never be cached.
 *  - the calibration offset (coachState), which covers everything the browser does not
 *    report: the path after the browser (an external mixer, the audio interface, the
 *    headphones), the MIDI input path, and any error in the browser's report.
 *
 * Calibration and sessions both go through outputDelayMs(), so whatever the browser
 * reports, the calibration measures exactly the remainder. A browser that reports no
 * output latency contributes 0 and its whole delay is measured by calibration.
 */
export class LatencyManager {
  /**
   * @param {AudioContext} audioContext - the context the sounds are scheduled on
   * @returns {number} browser-reported output delay right now, in ms
   */
  outputDelayMs(audioContext) {
    const outputLatency = audioContext.outputLatency ?? 0;
    const baseLatency = audioContext.baseLatency ?? 0;
    return (outputLatency + baseLatency) * MS_PER_SECOND;
  }

  /**
   * @param {AudioContext} audioContext - the context the sounds are scheduled on
   * @returns {number} total delay from scheduling a sound to a hit on it arriving, in ms
   */
  getTotalOffset(audioContext) {
    return this.outputDelayMs(audioContext) + coachState.calibrationOffset;
  }
}
