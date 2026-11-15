const MS_PER_S = 1000;
const WORKLET_URL = new URL('./micCapture.worklet.js', import.meta.url);
const PROCESSOR_NAME = 'mic-capture';
// contexts the capture processor is registered on: registering it twice on one fails
const contextsWithWorklet = new WeakSet();

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
    this._source = null;
    this._node = null;
    this._stream = null;
  }

  /** @param {MediaStream} stream - from openMic; stopped by stop() */
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
    if (this._nextFrame !== null && frame !== this._nextFrame && !this._error) {
      // a block the mic didn't deliver: the recording no longer lines up with the clock
      this._error = new Error(
        `[MicRecorder] the mic skipped from frame ${this._nextFrame} to ${frame}`
      );
    }
    this._chunks.push({ frame, samples });
    this._nextFrame = frame + samples.length;
  }
}
