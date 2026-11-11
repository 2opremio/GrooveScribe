import { describe, it, expect, beforeEach } from 'vitest';
import { newGrooveUtils, installMidiGlobal } from '../helpers/legacyLoader.js';
import { noteOns } from '../helpers/midiDecode.js';
import {
  constant_OUR_MIDI_HIHAT_NORMAL,
  constant_OUR_MIDI_KICK_NORMAL,
  constant_OUR_MIDI_SNARE_NORMAL,
  constant_OUR_MIDI_TOM1_NORMAL,
  constant_OUR_MIDI_METRONOME_1,
  constant_OUR_MIDI_METRONOME_NORMAL,
} from '../../js/constants.js';

// Where notes land in the generated MIDI. Playback and the Drum Coach both depend on the
// notes sitting on the musical grid, so these decode the MIDI file and check tick positions.

const TICKS_PER_QUARTER = 128;

const ticksOf = (notes, midiNote) => notes.filter((n) => n.note === midiNote).map((n) => n.tick);
const repeatBars = (bar, measures) => '|' + Array(measures).fill(bar).join('|') + '|';

describe('MIDI note timing', () => {
  let gu;

  beforeEach(async () => {
    await installMidiGlobal();
    gu = await newGrooveUtils();
  });

  const midiFor = (qs) =>
    noteOns(gu.create_MIDIURLFromGrooveData(gu.getGrooveDataFromUrlString(qs), 0));

  it('puts every straight 16th of every measure exactly on the grid', () => {
    const measures = 3;
    const notes = midiFor(
      `?TimeSig=4/4&Div=16&Tempo=120&Measures=${measures}` +
        `&H=${repeatBars('xxxxxxxxxxxxxxxx', measures)}&S=${repeatBars('----o-------o---', measures)}` +
        `&K=${repeatBars('o-------o-------', measures)}`
    );
    const sixteenth = TICKS_PER_QUARTER / 4;
    const measure = TICKS_PER_QUARTER * 4;
    expect(ticksOf(notes, constant_OUR_MIDI_HIHAT_NORMAL)).toEqual(
      Array.from({ length: 16 * measures }, (_, i) => i * sixteenth)
    );
    expect(ticksOf(notes, constant_OUR_MIDI_KICK_NORMAL)).toEqual(
      Array.from({ length: measures }, (_, m) => [
        m * measure,
        m * measure + 2 * TICKS_PER_QUARTER,
      ]).flat()
    );
  });

  it('keeps triplet notes within half a tick of their exact time, with exact measure lengths', () => {
    const measures = 2;
    const notes = midiFor(
      `?TimeSig=4/4&Div=12&Tempo=120&Measures=${measures}` +
        `&H=${repeatBars('xxxxxxxxxxxx', measures)}&K=${repeatBars('o-----o-----', measures)}`
    );
    const tripletEighth = TICKS_PER_QUARTER / 3;
    const hh = ticksOf(notes, constant_OUR_MIDI_HIHAT_NORMAL);
    expect(hh).toHaveLength(12 * measures);
    hh.forEach((tick, i) => expect(Math.abs(tick - i * tripletEighth)).toBeLessThanOrEqual(0.5));
    expect(ticksOf(notes, constant_OUR_MIDI_KICK_NORMAL)).toEqual([0, 256, 512, 768]);
  });

  it('makes a 6/8 measure six eighth notes long', () => {
    const notes = midiFor(
      '?TimeSig=6/8&Div=8&Tempo=100&Measures=2&H=|xxxxxx|xxxxxx|&K=|o-----|o-----|'
    );
    const eighth = TICKS_PER_QUARTER / 2;
    expect(ticksOf(notes, constant_OUR_MIDI_KICK_NORMAL)).toEqual([0, 6 * eighth]);
    expect(ticksOf(notes, constant_OUR_MIDI_HIHAT_NORMAL)).toEqual(
      Array.from({ length: 12 }, (_, i) => i * eighth)
    );
  });

  it('swings the e and the a later while every beat and & stays on the grid', () => {
    const swing = 0.3;
    const notes = midiFor(
      `?TimeSig=4/4&Div=16&Tempo=120&Measures=2&Swing=${swing * 100}` +
        `&H=${repeatBars('xxxxxxxxxxxxxxxx', 2)}`
    );
    const sixteenth = TICKS_PER_QUARTER / 4;
    const hh = ticksOf(notes, constant_OUR_MIDI_HIHAT_NORMAL);
    hh.forEach((tick, i) => {
      const straight = i * sixteenth;
      const offbeat = i % 2 === 1; // the e and the a
      expect(tick).toBe(offbeat ? Math.round(straight + sixteenth * swing) : straight);
    });
  });

  it('places a tom on its own slot like any other voice', () => {
    const notes = midiFor(
      '?TimeSig=4/4&Div=16&Tempo=120&Measures=2&H=|----------------|----------------|' +
        '&T1=|------------o---|------------o---|'
    );
    const sixteenth = TICKS_PER_QUARTER / 4;
    expect(ticksOf(notes, constant_OUR_MIDI_TOM1_NORMAL)).toEqual([
      12 * sixteenth,
      16 * sixteenth + 12 * sixteenth,
    ]);
  });

  it('keeps snares and kicks of the same slot at the same tick', () => {
    const notes = midiFor(
      '?TimeSig=4/4&Div=12&Tempo=90&Measures=1&S=|o--o--o--o--|&K=|o--o--o--o--|'
    );
    expect(ticksOf(notes, constant_OUR_MIDI_SNARE_NORMAL)).toEqual(
      ticksOf(notes, constant_OUR_MIDI_KICK_NORMAL)
    );
  });

  it('clicks the count-in on each beat, starting at the first tick', () => {
    const fourFour = noteOns(gu.MIDI_build_midi_url_count_in_track(4, 4));
    expect(fourFour.map((n) => n.tick)).toEqual([0, 128, 256, 384]);
    expect(fourFour.map((n) => n.note)).toEqual([
      constant_OUR_MIDI_METRONOME_1,
      constant_OUR_MIDI_METRONOME_NORMAL,
      constant_OUR_MIDI_METRONOME_NORMAL,
      constant_OUR_MIDI_METRONOME_NORMAL,
    ]);
    const sixEight = noteOns(gu.MIDI_build_midi_url_count_in_track(6, 8));
    expect(sixEight.map((n) => n.tick)).toEqual([0, 64, 128, 192, 256, 320]);
  });
});
