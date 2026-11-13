import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioClock } from '../../coach/engine/AudioClock.js';
import { MidiInputHandler } from '../../coach/engine/MidiInputHandler.js';

/**
 * An AudioContext whose output timestamps pair its clock with performance.now() at a known
 * offset, with each reading off by up to `jitterMs` (as one render quantum's worth is).
 */
function fakeContext({ offsetMs, jitterMs = 0, running = true }) {
  let reading = 0;
  return {
    state: running ? 'running' : 'suspended',
    getOutputTimestamp() {
      if (!running) return { contextTime: 0, performanceTime: 0 };
      const contextTime = 100 + reading * 0.05;
      const jitter = jitterMs * Math.sin(reading++ * 1.7);
      return { contextTime, performanceTime: contextTime * 1000 + offsetMs + jitter };
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('audio clock', () => {
  it('places a scheduled sound at the time it is heard, through jittery readings', () => {
    const clock = new AudioClock(fakeContext({ offsetMs: 5000, jitterMs: 2 }));
    for (let i = 0; i < 40; i++) clock.sample();
    expect(clock.heardAt(200)).toBeCloseTo(200 * 1000 + 5000, 0);
  });

  it('refuses to place a sound before the context has reported any output', () => {
    const clock = new AudioClock(fakeContext({ offsetMs: 0, running: false }));
    clock.sample();
    expect(() => clock.heardAt(1)).toThrow(/no output timestamps/);
  });

  it('fails clearly when the context never starts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] });
    const clock = new AudioClock(fakeContext({ offsetMs: 0, running: false }));
    const started = clock.whenRunning();
    const failed = expect(started).rejects.toThrow(/reported no output/);
    await vi.advanceTimersByTimeAsync(3000);
    await failed;
  });
});

describe('MIDI input timing', () => {
  const noteOn = (timeStamp, name = 'Kit') => ({
    data: [0x99, 36, 100],
    timeStamp,
    target: { name },
  });

  it('passes on a timed hit with its own timestamp', () => {
    const hits = [];
    const handler = new MidiInputHandler({
      onHit: (...h) => hits.push(h),
      drumMap: { 36: 'kick' },
    });
    handler._handleMidiMessage(noteOn(1234.5));
    expect(hits).toEqual([['kick', 1234.5, 100]]);
  });

  it('refuses untimed hits instead of grading them, and reports the input once', () => {
    const hits = [];
    const untimed = [];
    const handler = new MidiInputHandler({
      onHit: (...h) => hits.push(h),
      onUntimedInput: (name) => untimed.push(name),
      drumMap: { 36: 'kick' },
    });
    handler._handleMidiMessage(noteOn(0, 'Virtual'));
    handler._handleMidiMessage(noteOn(0, 'Virtual'));
    expect(hits).toEqual([]);
    expect(untimed).toEqual(['Virtual']);
  });
});
