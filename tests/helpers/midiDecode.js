// Minimal decoder for the single-track MIDI files jsmidgen builds, for asserting where
// notes land in time.

const MIDI_URL_PREFIX = 'data:audio/midi;base64,';
const NOTE_ON = 0x90;
const STATUS_TYPE_MASK = 0xf0;
const META_EVENT = 0xff;

/** Decode a single-track MIDI data: URL into its note-ons as {tick, note}. */
export function noteOns(midiUrl) {
  const bytes = Uint8Array.from(atob(midiUrl.slice(MIDI_URL_PREFIX.length)), (c) =>
    c.charCodeAt(0)
  );
  let pos = 14 + 8; // MThd chunk, then the MTrk chunk header
  const end = bytes.length;
  const readVarLen = () => {
    let value = 0;
    let byte;
    do {
      byte = bytes[pos++];
      value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);
    return value;
  };
  const notes = [];
  let tick = 0;
  while (pos < end) {
    tick += readVarLen();
    const status = bytes[pos++];
    if (status === META_EVENT) {
      pos++; // meta type
      const length = readVarLen(); // read first: it advances pos
      pos += length;
      continue;
    }
    const type = status & STATUS_TYPE_MASK;
    if (type === 0xc0 || type === 0xd0) {
      pos += 1;
      continue;
    }
    const [note, velocity] = [bytes[pos], bytes[pos + 1]];
    pos += 2;
    if (type === NOTE_ON && velocity > 0) notes.push({ tick, note });
  }
  return notes;
}
