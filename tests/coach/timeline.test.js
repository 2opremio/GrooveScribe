import { describe, it, expect, beforeAll } from 'vitest';
import { newGrooveUtils, installMidiGlobal } from '../helpers/legacyLoader.js';
import { noteOns } from '../helpers/midiDecode.js';
import { allGrooves } from '../../tests-e2e/corpus.js';
import { ABCIndexMapper } from '../../coach/engine/ABCIndexMapper.js';
import { ticksToMs } from '../../js/noteTiming.js';

// The Drum Coach grades each hit against the time it expects the note to play. Those times
// must be the times the MIDI file actually plays the notes, for every time signature,
// division, swing amount and tempo, or correct playing is graded early or late.

// floating-point tolerance for comparing two computations of the same time, in ms
const SAME_TIME_MS = 1e-6;

describe('Drum Coach note timeline', () => {
  let gu;
  const mapper = new ABCIndexMapper();

  beforeAll(async () => {
    await installMidiGlobal();
    gu = await newGrooveUtils();
  });

  // a groove that plays each of its measures several times in a row
  const repeatedBars = {
    name: 'repeated bars',
    url:
      '?TimeSig=4/4&Div=16&Tempo=90&Measures=2&Repeats=3&Swing=20' +
      '&H=|x-x-x-x-x-x-x-x-|x-x-x-x-x-x-x-x-|&S=|----o-------o---|--o-----o-----o-|' +
      '&K=|o------o--o---o-|o---o-o---o-o---|',
  };

  it.each([...allGrooves, repeatedBars].map((g) => [g.name, g.url]))(
    'expects every note of %s exactly when the MIDI plays a note',
    (name, url) => {
      const data = gu.getGrooveDataFromUrlString(url);
      const timeline = mapper.buildTimeline(data, mapper.getGrooveMetrics(data));
      const midiTimes = noteOns(gu.create_MIDIURLFromGrooveData(data, 0)).map((n) =>
        ticksToMs(n.tick, data.tempo)
      );

      for (const note of timeline) {
        const nearest = Math.min(...midiTimes.map((t) => Math.abs(t - note.time)));
        expect(nearest, `${note.type} at ${note.time} ms`).toBeLessThan(SAME_TIME_MS);
      }
    }
  );

  it('makes a 6/8 measure last six eighth notes at the quarter-note tempo', () => {
    const data = gu.getGrooveDataFromUrlString(
      '?TimeSig=6/8&Div=8&Tempo=120&Measures=1&H=|xxxxxx|&K=|o-----|'
    );
    // 120 quarter notes per minute: an eighth is 250 ms
    expect(mapper.getGrooveMetrics(data).measureDurationMs).toBe(1500);
  });

  it('expects a repeated measure as many times as the MIDI plays it', () => {
    const data = gu.getGrooveDataFromUrlString(repeatedBars.url);
    const timeline = mapper.buildTimeline(data, mapper.getGrooveMetrics(data));
    const midiNoteCount = noteOns(gu.create_MIDIURLFromGrooveData(data, 0)).length;
    expect(timeline).toHaveLength(midiNoteCount);
  });
});
