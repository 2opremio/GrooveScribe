/**
 * Hands each block of the mic's first channel to the page, numbered by the call that processed
 * it, with the audio-clock frame Chromium reports for that call. Every call posts, a block or
 * null while the mic's stream isn't delivering, so the page can tell the blocks are consecutive.
 */
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.call = 0;
  }

  process(inputs) {
    const channel = inputs[0][0];
    this.call++;
    this.port.postMessage({
      call: this.call,
      frame: currentFrame,
      samples: channel ? channel.slice() : null,
    });
    return true;
  }
}

registerProcessor('mic-capture', MicCapture);
