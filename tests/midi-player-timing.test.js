import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PLAYER_SRC = fs.readFileSync(path.resolve(__dirname, '../MIDI.js/js/MIDI/Player.js'), 'utf8');

// every timer fires this late, as browser timers do under load
const TIMER_LATENESS_MS = 7;
const NOTE_SPACING_MS = 100;
// more notes than the player queues at once (100), so a pass spans several batches
const NOTES = 250;

/**
 * Runs MIDI.js's player on a simulated clock whose timers all fire late, and records the audio
 * audio time of every note that plays (a note queued and then cancelled doesn't).
 */
function runPlayer({ passes, reloadAfterFirstPass = false, endOfPassWorkMs = 0 }) {
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
  const sources = [];
  const MIDI = {
    lang: 'WebAudioAPI',
    channels: [{ mute: false }],
    noteOn(channel, note, velocity, time) {
      const source = {
        time,
        lateMs: Math.max(0, nowMs - time * 1000),
        cancelled: false,
        disconnect() {
          this.cancelled = true;
        },
      };
      sources.push(source);
      return source;
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
  // like GrooveScribe's songs, the song ends with the last note's note-off, a step after it
  data.push([
    { event: { type: 'channel', channel: 0, subtype: 'noteOff', noteNumber: 36 } },
    NOTE_SPACING_MS,
  ]);
  player.replayer = { getData: () => data };
  let passesStarted = 1;
  player.addListener((event) => {
    // the end of a pass: the song's closing note-off
    if (event.now !== event.end) return;
    passesStarted++;
    // what GrooveScribe and the coach do when a pass ends takes time
    nowMs += endOfPassWorkMs;
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
  const played = sources.filter((s) => !s.cancelled);
  const scheduled = played.map((s) => s.time).sort((a, b) => a - b);
  const maxLateMs = Math.max(...played.map((s) => s.lateMs));
  return { scheduled, songLengthMs, nowMs, maxLateMs };
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

  it('queues the next pass before the end-of-pass work, so its first notes are on time', () => {
    const { scheduled, maxLateMs } = runPlayer({ passes: 3, endOfPassWorkMs: 300 });
    expect(scheduled).toHaveLength(NOTES * 3);
    expect(maxLateMs).toBe(0);
  });
});
