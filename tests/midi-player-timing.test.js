import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PLAYER_SRC = fs.readFileSync(path.resolve(__dirname, '../MIDI.js/js/MIDI/Player.js'), 'utf8');

// every timer fires this late, as browser timers do under load
const TIMER_LATENESS_MS = 7;
const NOTE_SPACING_MS = 100;
// how long GrooveScribe takes to rebuild a tune's MIDI when a pass ends
const REBUILD_MS = 20;
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
  let reloaded = false;
  const MIDI = {
    lang: 'WebAudioAPI',
    channels: [{ mute: false }],
    noteOn(channel, note, velocity, time) {
      // like the WebAudio plugin, a time in the past is taken as relative to now
      if (time < nowMs / 1000) time += nowMs / 1000;
      const source = {
        time,
        fromReload: reloaded,
        lateMs: Math.max(0, nowMs - time * 1000),
        cancelled: false,
        // cancelling a note that has already played doesn't unplay it
        disconnect() {
          if (nowMs < this.time * 1000) this.cancelled = true;
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
      reloaded = true;
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
  // the pass queued ahead after the last one is cancelled when looping stops, but by then a late
  // callback has let its first note play: only the passes asked for are looked at
  const played = sources.filter((s) => !s.cancelled);
  const scheduled = played
    .map((s) => s.time)
    .sort((a, b) => a - b)
    .slice(0, NOTES * passes);
  const maxLateMs = Math.max(...played.map((s) => s.lateMs));
  const reloadedPass = played
    .filter((s) => s.fromReload)
    .map((s) => s.time)
    .sort((a, b) => a - b)
    .slice(0, NOTES);
  return { scheduled, reloadedPass, songLengthMs, nowMs, maxLateMs };
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

  it('starts a tune reloaded at the end of a pass on the bar line', () => {
    const { scheduled, reloadedPass, songLengthMs } = runPlayer({
      passes: 3,
      reloadAfterFirstPass: true,
      endOfPassWorkMs: REBUILD_MS,
    });
    const barLine = scheduled[0] + songLengthMs / 1000;
    // the reload runs as late as its timer and the work before it: a note already due by then
    // plays at once, the rest of the tune is on the grid from the bar line
    expect(reloadedPass).toHaveLength(NOTES);
    expect((reloadedPass[0] - barLine) * 1000).toBeLessThanOrEqual(
      TIMER_LATENESS_MS + REBUILD_MS + 1e-6
    );
    reloadedPass.slice(1).forEach((time, i) => {
      expect((time - barLine) * 1000).toBeCloseTo((i + 1) * NOTE_SPACING_MS, 6);
    });
  });

  it('queues the next pass before the end-of-pass work, so its first notes are on time', () => {
    const { scheduled, maxLateMs } = runPlayer({ passes: 3, endOfPassWorkMs: 300 });
    expect(scheduled).toHaveLength(NOTES * 3);
    expect(maxLateMs).toBe(0);
  });
});
