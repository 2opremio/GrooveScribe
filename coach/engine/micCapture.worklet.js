/**
 * Hands each block of the mic's first channel to the page, with the audio-clock frame it was
 * processed at, so the page can tell exactly when each sample sits on the context's clock.
 */
class MicCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0][0];
    // no channel until the mic's stream has started delivering
    if (channel) this.port.postMessage({ frame: currentFrame, samples: channel.slice() });
    return true;
  }
}

registerProcessor('mic-capture', MicCapture);
