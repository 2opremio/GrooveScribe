const MS_PER_S = 1000;
const WORKLET_URL = new URL('./micCapture.worklet.js', import.meta.url);
const PROCESSOR_NAME = 'mic-capture';
// contexts the capture processor is registered on: registering it twice on one fails
const contextsWithWorklet = new WeakSet();
// A just-opened mic may skip a few blocks while it settles in. Recording counts from the first
// stretch this long without a skip; a skip after that breaks the recording.
const STEADY_INPUT_MS = 300;
// how long a mic may take to settle in before it counts as not working
const STEADY_TIMEOUT_MS = 3000;

/**
 * The mic DrumOS names, or '' when the page doesn't run in DrumOS or DrumOS has no mic.
 * @returns {string}
 */
export function drumOSMicName() {
  return typeof window.drumOSMicDevice === 'string' ? window.drumOSMicDevice : '';
}

/**
 * Open the input device called deviceName, raw: no echo cancelling, noise suppression or gain
 * control, which would reshape or delay the very sounds being timed.
 * @param {string} deviceName - as macOS names it; the browser may add "(vendor:product)"
 * @returns {Promise<MediaStream>}
 */
export async function openMic(deviceName) {
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === 'audioinput'
  );
  const device = inputs.find(
    (d) => d.label === deviceName || d.label.startsWith(`${deviceName} (`)
  );
  if (!device) {
    throw new Error(
      `[MicRecorder] no mic called "${deviceName}" among: ` +
        (inputs.map((d) => d.label || '(no label)').join(', ') || 'none')
    );
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: device.deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

/**
 * MicRecorder - Records a mic on an audio context's own clock, sample by sample, so its sounds
 * can be lined up with sounds scheduled on that context.
 */
export class MicRecorder {
  /** @param {AudioContext} audioContext */
  constructor(audioContext) {
    this.audioContext = audioContext;
    this._chunks = [];
    this._nextFrame = null; // the frame the next block must start at
    this._error = null;
    this._steady = false; // whether the mic has delivered without a skip for STEADY_INPUT_MS
    this._onSteady = null; // resolves start() once it has
    this._source = null;
    this._node = null;
    this._stream = null;
  }

  /**
   * Start recording, once the mic delivers steadily.
   * @param {MediaStream} stream - from openMic; stopped by stop()
   */
  async start(stream) {
    const ctx = this.audioContext;
    if (!contextsWithWorklet.has(ctx)) {
      await ctx.audioWorklet.addModule(WORKLET_URL);
      contextsWithWorklet.add(ctx);
    }
    this._stream = stream;
    this._source = ctx.createMediaStreamSource(stream);
    // no outputs: the mic is only listened to, never played
    this._node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { numberOfOutputs: 0 });
    this._node.port.onmessage = (e) => this._add(e.data);
    this._source.connect(this._node);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`[MicRecorder] the mic gave no steady sound in ${STEADY_TIMEOUT_MS} ms`));
      }, STEADY_TIMEOUT_MS);
      this._onSteady = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  stop() {
    this._source.disconnect();
    this._node.port.onmessage = null;
    for (const track of this._stream.getTracks()) track.stop();
  }

  /** The context time up to which the mic has been recorded, in ms, or null before any. */
  get recordedUntilMs() {
    return this._nextFrame === null
      ? null
      : (this._nextFrame * MS_PER_S) / this.audioContext.sampleRate;
  }

  /**
   * What was recorded between fromMs and toMs on the context clock (all of it without them).
   * @param {number} [fromMs]
   * @param {number} [toMs]
   * @returns {import('./MicTiming.js').MicRecording}
   */
  recording(fromMs = -Infinity, toMs = Infinity) {
    if (this._error) throw this._error;
    const sampleRate = this.audioContext.sampleRate;
    const msOf = (frame) => (frame * MS_PER_S) / sampleRate;
    const chunks = this._chunks.filter(
      (c) => msOf(c.frame + c.samples.length) > fromMs && msOf(c.frame) < toMs
    );
    if (chunks.length === 0) throw new Error('[MicRecorder] the mic delivered no sound then');
    const samples = new Float32Array(chunks.reduce((n, c) => n + c.samples.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      samples.set(chunk.samples, at);
      at += chunk.samples.length;
    }
    return { samples, sampleRate, startMs: msOf(chunks[0].frame) };
  }

  _add({ frame, samples }) {
    const last = this._chunks[this._chunks.length - 1];
    // Chromium sometimes hands the worklet one block twice; a copy of the last block adds nothing
    if (last && frame === last.frame && sameSamples(samples, last.samples)) return;
    const skipped = this._nextFrame !== null && frame !== this._nextFrame;
    if (skipped && !this._steady) {
      this._chunks = []; // still settling in: start again from here
    } else if (skipped && !this._error) {
      // a block missing, or a different one at a frame already recorded: the recording no
      // longer lines up with the clock
      const repeated = last && frame === last.frame ? ' (a different block at the same frame)' : '';
      this._error = new Error(
        `[MicRecorder] the mic skipped from frame ${this._nextFrame} to ${frame}${repeated}`
      );
    }
    this._chunks.push({ frame, samples });
    this._nextFrame = frame + samples.length;
    const recordedMs =
      ((this._nextFrame - this._chunks[0].frame) * MS_PER_S) / this.audioContext.sampleRate;
    if (!this._steady && recordedMs >= STEADY_INPUT_MS) {
      this._steady = true;
      this._onSteady();
    }
  }
}

function sameSamples(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
