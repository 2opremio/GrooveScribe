import { DEFAULT_HIHAT_CC, DrumType, ModuleDrumTypes } from './DrumConstants.js';

/**
 * The hi-hat a hit was, by the pedal's CC value: closed at hihatCC.closedFrom or above, open below.
 * @param {number} pedal - CC value, 0 = fully open, 127 = fully closed
 * @param {{ closedFrom: number }} hihatCC
 */
export function hihatByPedal(pedal, hihatCC) {
  return pedal >= hihatCC.closedFrom ? DrumType.HH_CLOSED : DrumType.HH_OPEN;
}

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
    // Hi-hat pedal config, see DEFAULT_HIHAT_CC
    this.hihatCC = options.hihatCC || { ...DEFAULT_HIHAT_CC };
    // the pedal's last CC value, 0 = fully open, 127 = fully closed; null until the kit sends one
    this._lastHiHatCC = null;
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
        // the pedal says how open a hi-hat hit was, wherever the kit itself draws the line
        // (a V-51 sends its closed note only with the pedal all the way down)
        const isHihat = drum === DrumType.HH_OPEN || drum === DrumType.HH_CLOSED;
        if (isHihat && this.hihatCC.enabled && this._lastHiHatCC !== null) {
          drum = hihatByPedal(this._lastHiHatCC, this.hihatCC);
        }
        if (this._isTimed(event)) this.onHit(drum, event.timeStamp, data2);
      }
    }
  }
}
