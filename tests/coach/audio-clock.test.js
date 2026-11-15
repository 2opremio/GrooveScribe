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

/**
 * An AudioContext whose clock runs at `rate` times real time, as Chromium's fake output does
 * after a silence; it pairs its clock with performance.now() as it advances. Setting `rate`
 * back to 1 is the real output resuming.
 */
function driftingContext() {
  const ctx = { state: 'running', rate: 1, time: 100 };
  let last = performance.now();
  ctx.getOutputTimestamp = () => {
    const now = performance.now();
    ctx.time += (ctx.rate * (now - last)) / 1000;
    last = now;
    return { contextTime: ctx.time, performanceTime: now };
  };
  return ctx;
}

/** Advance fake time in small steps until the clock trusts its pairing, and no further. */
async function untilRunning(clock) {
  let running = false;
  clock.whenRunning().then(() => (running = true));
  await vi.advanceTimersByTimeAsync(0);
  while (!running) await vi.advanceTimersByTimeAsync(5);
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

  it('times a new session by the clock as it runs now, not as the last session left it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'performance'] });
    const ctx = driftingContext();
    const clock = new AudioClock(ctx);
    clock.start();
    await vi.advanceTimersByTimeAsync(2000);
    clock.stop();
    // idle between sessions: the context's clock fell a minute behind performance.now()
    ctx.time -= 60;
    clock.start();
    await untilRunning(clock);
    const audioNow = ctx.getOutputTimestamp().contextTime;
    expect(clock.heardAt(audioNow + 1)).toBeCloseTo(performance.now() + 1000, 0);
    clock.stop();
  });

  it('waits for a slow clock to run at real speed before timing sounds by it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'performance'] });
    const ctx = driftingContext();
    ctx.rate = 0.3;
    const clock = new AudioClock(ctx);
    clock.start();
    let running = false;
    const started = clock.whenRunning().then(() => (running = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(running).toBe(false);
    ctx.rate = 1; // the real output resumes
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    const audioNow = ctx.getOutputTimestamp().contextTime;
    expect(clock.heardAt(audioNow + 1)).toBeCloseTo(performance.now() + 1000, 0);
    clock.stop();
  });

  it('fails clearly when the context never starts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] });
    const clock = new AudioClock(fakeContext({ offsetMs: 0, running: false }));
    const started = clock.whenRunning();
    const failed = expect(started).rejects.toThrow(/reported no steady output/);
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
