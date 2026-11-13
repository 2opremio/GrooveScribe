import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PLAYER_SRC = fs.readFileSync(path.resolve(__dirname, '../MIDI.js/js/MIDI/Player.js'), 'utf8');

// every timer fires this late, as browser timers do under load
const TIMER_LATENESS_MS = 7;
const NOTE_SPACING_MS = 100;
// more notes than the player queues at once (100), so a pass spans several batches
const NOTES = 250;
const NOTE_ON = 144;

/**
 * Runs MIDI.js's player on a simulated clock whose timers all fire late, and records the audio
 * time every note was scheduled at.
 */
function runPlayer({ passes, reloadAfterFirstPass = false }) {
  let nowMs = 0;
  let timers = [];
  let nextId = 1;
  const cancel = (id) => {
    timers = timers.filter((t) => t.id !== id);
  };
  const fakeWindow = {
    setTimeout(fn, delay) {
      const id = nextId++;
      timers.push({ id, at: nowMs + Math.max(0, delay) + TIMER_LATENESS_MS, fn });
      return id;
    },
    clearTimeout: cancel,
    clearInterval: cancel,
  };
  const scheduled = [];
  const MIDI = {
    lang: 'WebAudioAPI',
    channels: [{ mute: false }],
    noteOn(channel, note, velocity, time) {
      scheduled.push(time);
      return { disconnect() {} };
    },
    noteOff() {
      return { disconnect() {} };
    },
  };
  new Function('MIDI', 'window', PLAYER_SRC)(MIDI, fakeWindow);
  const player = MIDI.Player;
  player.ctx = {
    get currentTime() {
      return nowMs / 1000;
    },
  };
  const data = [];
  for (let i = 0; i < NOTES; i++) {
    const delta = i === 0 ? 0 : NOTE_SPACING_MS;
    data.push([
      { event: { type: 'channel', channel: 0, subtype: 'noteOn', noteNumber: 36, velocity: 100 } },
      delta,
    ]);
  }
  player.replayer = { getData: () => data };
  let passesStarted = 1;
  player.addListener((event) => {
    // the end of a pass; stopping also reports a note-off for each note still sounding
    if (event.now !== event.end || event.message !== NOTE_ON) return;
    passesStarted++;
    // as GrooveScribe does when the next pass needs new MIDI (count-in over, tempo changed)
    if (reloadAfterFirstPass && passesStarted === 2) {
      player.stop();
      player.loop(true);
      player.start();
    }
    if (passesStarted > passes) player.loop(false);
  });
  player.loop(true);
  player.start();
  // the player's end time counts its half-ms lead-in before the first tick
  const songLengthMs = player.endTime - 0.5;
  while (timers.length) {
    timers.sort((a, b) => a.at - b.at);
    const timer = timers.shift();
    nowMs = timer.at;
    timer.fn();
  }
  return { scheduled, songLengthMs, nowMs };
}

describe('MIDI player timing', () => {
  it('keeps every note of a long pass on the song grid, whatever the timers do', () => {
    const { scheduled } = runPlayer({ passes: 1 });
    expect(scheduled).toHaveLength(NOTES);
    const start = scheduled[0];
    scheduled.forEach((time, i) => {
      expect((time - start) * 1000).toBeCloseTo(i * NOTE_SPACING_MS, 6);
    });
  });

  it('starts each loop exactly one song length after the last', () => {
    const passes = 3;
    const { scheduled, songLengthMs } = runPlayer({ passes });
    expect(scheduled).toHaveLength(NOTES * passes);
    for (let pass = 1; pass < passes; pass++) {
      const gapMs = (scheduled[pass * NOTES] - scheduled[(pass - 1) * NOTES]) * 1000;
      expect(gapMs).toBeCloseTo(songLengthMs, 6);
    }
  });

  it('keeps looping after the tune is reloaded at the end of a pass', () => {
    const passes = 3;
    const { scheduled, songLengthMs } = runPlayer({ passes, reloadAfterFirstPass: true });
    expect(scheduled).toHaveLength(NOTES * passes);
    // the reload starts its pass from the moment it happens; the loop after it is exact
    const gapMs = (scheduled[2 * NOTES] - scheduled[NOTES]) * 1000;
    expect(gapMs).toBeCloseTo(songLengthMs, 6);
  });
});
