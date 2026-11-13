import { ModuleDrumTypes } from './DrumConstants.js';

/**
 * MidiInputHandler - Wraps Web MIDI API
 */
export class MidiInputHandler {
  constructor(options = {}) {
    this.midiAccess = null;
    this.onHit = options.onHit || (() => {});
    // (inputName) => void: an input sends notes the browser can't time; reported once per input
    this.onUntimedInput = options.onUntimedInput || (() => {});
    this._untimedInputs = new Set();
    this.drumMap = options.drumMap || {};
    // Hi-hat CC config: { enabled, cc, threshold }
    this.hihatCC = options.hihatCC || { enabled: false, cc: 4, threshold: 64 };
    this._lastHiHatCC = 0; // 0 = fully open, 127 = fully closed
  }

  async connect() {
    if (!navigator.requestMIDIAccess) {
      throw new Error('Web MIDI API not supported in this browser');
    }

    this.midiAccess = await navigator.requestMIDIAccess();
    for (const input of this.midiAccess.inputs.values()) {
      input.onmidimessage = this._handleMidiMessage.bind(this);
    }
  }

  disconnect() {
    if (this.midiAccess) {
      for (const input of this.midiAccess.inputs.values()) {
        input.onmidimessage = null;
      }
    }
  }

  /**
   * A MIDI source that sends its notes without a time leaves the browser stamping every one
   * of them 0, so they can't be graded: they're refused, and the input reported once.
   */
  _isTimed(event) {
    if (event.timeStamp !== 0) return true;
    const name = event.target.name;
    if (!this._untimedInputs.has(name)) {
      this._untimedInputs.add(name);
      this.onUntimedInput(name);
    }
    return false;
  }

  _handleMidiMessage(event) {
    const [status, data1, data2] = event.data;

    // Track CC messages for hi-hat pedal
    const isCC = (status & 0xf0) === 0xb0;
    if (isCC && this.hihatCC.enabled && data1 === this.hihatCC.cc) {
      this._lastHiHatCC = data2;
      return;
    }

    const isNoteOn = (status & 0xf0) === 0x90 && data2 > 0;
    if (isNoteOn) {
      let drum = this.drumMap[data1];
      if (drum && ModuleDrumTypes.includes(drum)) {
        // CC-based hi-hat resolution: if a note maps to hh_open but
        // the pedal CC says closed, report as hh_closed instead
        if (
          this.hihatCC.enabled &&
          drum === 'hh_open' &&
          this._lastHiHatCC >= this.hihatCC.threshold
        ) {
          drum = 'hh_closed';
        }
        if (this._isTimed(event)) this.onHit(drum, event.timeStamp, data2);
      }
    }
  }
}
