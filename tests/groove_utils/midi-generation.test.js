import { describe, it, expect, beforeEach } from 'vitest';
import { newGrooveUtils, installMidiGlobal } from '../helpers/legacyLoader.js';

// Regression coverage for the MIDI-generation functions in groove_utils.js:
//   - create_MIDIURLFromGrooveData      (main entry: grooveData -> data: URL)
//   - MIDI_from_HH_Snare_Kick_Arrays     (per-measure note array -> midiTrack events)
//   - MIDI_build_midi_url_count_in_track (metronome "count-in" click track)
//   - midiEventCallbackClass             (default playback callback object)
//
// These probe the *encoding* path only (data: URL construction and determinism);
// note placement in time is covered by midi-timing.test.js. Playback controls (start/stop/pause) need the MIDI.js Player
// runtime and are intentionally out of scope.
//
// The ABC-notation note codes below (e.g. '^g' for normal hi-hat, 'c' for
// normal snare, 'F' for normal kick, 'e' for tom 1) are taken directly from
// the constant_ABC_* definitions near the top of groove_utils.js.
describe('GrooveUtils MIDI generation', () => {
  let gu;

  beforeEach(async () => {
    await installMidiGlobal(); // sets globalThis.Midi (jsmidgen) - required before any MIDI call
    gu = await newGrooveUtils();
  });

  // Helper: build grooveData from a query-string fragment the same way the
  // app does when loading a groove from a URL.
  function grooveFromUrl(qs) {
    return gu.getGrooveDataFromUrlString(qs);
  }

  describe('create_MIDIURLFromGrooveData', () => {
    const BASIC_QS =
      '?TimeSig=4/4&Div=16&Tempo=90&Measures=1&H=|xxxxxxxxxxxxxxxx|&S=|----o-------o---|&K=|o-------o-------|';

    it('returns a data:audio/midi;base64,... URL whose decoded payload starts with the MThd MIDI header', () => {
      const gd = grooveFromUrl(BASIC_QS);
      const url = gu.create_MIDIURLFromGrooveData(gd, 0);

      expect(url.startsWith('data:audio/midi;base64,')).toBe(true);

      const base64 = url.slice('data:audio/midi;base64,'.length);
      const decoded = atob(base64);
      expect(decoded.startsWith('MThd')).toBe(true);
    });

    it('is deterministic: the same grooveData produces an identical URL each call', () => {
      const gd = grooveFromUrl(BASIC_QS);
      const url1 = gu.create_MIDIURLFromGrooveData(gd, 0);
      const url2 = gu.create_MIDIURLFromGrooveData(gd, 0);
      expect(url2).toBe(url1);
    });

    it('produces a different URL when only the tempo changes', () => {
      const gdSlow = grooveFromUrl(BASIC_QS); // Tempo=90
      const gdFast = grooveFromUrl(BASIC_QS.replace('Tempo=90', 'Tempo=150'));
      const urlSlow = gu.create_MIDIURLFromGrooveData(gdSlow, 0);
      const urlFast = gu.create_MIDIURLFromGrooveData(gdFast, 0);
      expect(urlFast).not.toBe(urlSlow);
    });

    it('produces a different URL when the groove pattern changes', () => {
      const gdA = grooveFromUrl(BASIC_QS);
      const gdB = grooveFromUrl(
        '?TimeSig=4/4&Div=16&Tempo=90&Measures=1&H=|xxxxxxxxxxxxxxxx|&S=|--------o-------|&K=|o---------------|'
      );
      const urlA = gu.create_MIDIURLFromGrooveData(gdA, 0);
      const urlB = gu.create_MIDIURLFromGrooveData(gdB, 0);
      expect(urlB).not.toBe(urlA);
    });

    it('handles a 6/8 compound-meter groove', () => {
      const gd = grooveFromUrl(
        '?TimeSig=6/8&Div=8&Tempo=100&Measures=1&H=|xxxxxx|&S=|--o---|&K=|o-----|'
      );
      const url = gu.create_MIDIURLFromGrooveData(gd, 0);
      expect(url.startsWith('data:audio/midi;base64,')).toBe(true);
      const decoded = atob(url.slice('data:audio/midi;base64,'.length));
      expect(decoded.startsWith('MThd')).toBe(true);
    });

    it('handles a triplet division (Div=12) without error', () => {
      const gd = grooveFromUrl(
        '?TimeSig=4/4&Div=12&Tempo=100&Measures=1&H=|xxxxxxxxxxxx|&S=|----o-------|&K=|o-----------|'
      );
      const url = gu.create_MIDIURLFromGrooveData(gd, 0);
      expect(url.startsWith('data:audio/midi;base64,')).toBe(true);
      const decoded = atob(url.slice('data:audio/midi;base64,'.length));
      expect(decoded.startsWith('MThd')).toBe(true);
    });

    it('handles multiple measures, producing a longer encoded track than a single measure', () => {
      const single = grooveFromUrl(BASIC_QS);
      const double = grooveFromUrl(
        '?TimeSig=4/4&Div=16&Tempo=90&Measures=2&H=|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx|&S=|----o-------o---|----o-------o---|&K=|o-------o-------|o-------o-------|'
      );
      expect(double.numberOfMeasures).toBe(2);

      const urlSingle = gu.create_MIDIURLFromGrooveData(single, 0);
      const urlDouble = gu.create_MIDIURLFromGrooveData(double, 0);

      expect(urlDouble.startsWith('data:audio/midi;base64,')).toBe(true);
      // Two measures of notes encode to strictly more bytes than one measure.
      expect(urlDouble.length).toBeGreaterThan(urlSingle.length);
    });

    it('produces a different URL when non-zero swing is applied', () => {
      const gdNoSwing = grooveFromUrl(BASIC_QS);
      const gdSwing = grooveFromUrl(BASIC_QS + '&Swing=62');
      expect(gdSwing.swingPercent).toBe(62);

      const urlNoSwing = gu.create_MIDIURLFromGrooveData(gdNoSwing, 0);
      const urlSwing = gu.create_MIDIURLFromGrooveData(gdSwing, 0);
      expect(urlSwing).not.toBe(urlNoSwing);
    });

    it('produces a different URL when a non-zero metronome frequency is set', () => {
      const gdNoMetro = grooveFromUrl(BASIC_QS);
      const gdMetro = grooveFromUrl(BASIC_QS + '&MetronomeFreq=8');
      expect(gdMetro.metronomeFrequency).toBe(8);

      const urlNoMetro = gu.create_MIDIURLFromGrooveData(gdNoMetro, 0);
      const urlMetro = gu.create_MIDIURLFromGrooveData(gdMetro, 0);
      expect(urlMetro).not.toBe(urlNoMetro);
    });

    it('produces a valid, different URL for a groove that includes toms', () => {
      const gdNoToms = grooveFromUrl(BASIC_QS);
      const gdToms = grooveFromUrl(BASIC_QS + '&T1=|o---------------|');
      expect(gdToms.showToms).toBe(true);

      const urlNoToms = gu.create_MIDIURLFromGrooveData(gdNoToms, 0);
      const urlToms = gu.create_MIDIURLFromGrooveData(gdToms, 0);

      expect(urlToms.startsWith('data:audio/midi;base64,')).toBe(true);
      const decoded = atob(urlToms.slice('data:audio/midi;base64,'.length));
      expect(decoded.startsWith('MThd')).toBe(true);
      expect(urlToms).not.toBe(urlNoToms);
    });
  });

  describe('MIDI_from_HH_Snare_Kick_Arrays', () => {
    // ABC note codes used below: '^g' = normal hi-hat. Where notes land in time is
    // covered by midi-timing.test.js.
    it('adds metronome click events when metronome_frequency is non-zero', () => {
      const withMetronome = new globalThis.Midi.Track();
      const withoutMetronome = new globalThis.Midi.Track();
      const HH = new Array(16).fill(false);
      const Snare = new Array(16).fill(false);
      const Kick = new Array(16).fill(false);

      gu.MIDI_from_HH_Snare_Kick_Arrays(
        withMetronome,
        HH,
        Snare,
        Kick,
        false,
        'general_MIDI',
        4,
        16,
        16,
        0,
        4,
        4
      );
      gu.MIDI_from_HH_Snare_Kick_Arrays(
        withoutMetronome,
        HH,
        Snare,
        Kick,
        false,
        'general_MIDI',
        0,
        16,
        16,
        0,
        4,
        4
      );

      expect(withMetronome.events.length).toBeGreaterThan(withoutMetronome.events.length);
    });

    it('resets an out-of-range swing_percentage to 0 rather than throwing', () => {
      const midiTrack = new globalThis.Midi.Track();
      const HH = ['^g', false, '^g', false];
      const Snare = [false, false, false, false];
      const Kick = [false, false, false, false];

      // swing_percentage of 1.5 is out of the valid (0, 0.99) range; the
      // function logs a warning internally and falls back to 0 swing.
      expect(() => {
        gu.MIDI_from_HH_Snare_Kick_Arrays(
          midiTrack,
          HH,
          Snare,
          Kick,
          false,
          'general_MIDI',
          0,
          4,
          4,
          1.5,
          4,
          4
        );
      }).not.toThrow();
    });
  });

  describe('MIDI_build_midi_url_count_in_track', () => {
    it('returns a data:audio/midi;base64,... URL starting with the MThd header', () => {
      const url = gu.MIDI_build_midi_url_count_in_track(4, 4);
      expect(url.startsWith('data:audio/midi;base64,')).toBe(true);
      const decoded = atob(url.slice('data:audio/midi;base64,'.length));
      expect(decoded.startsWith('MThd')).toBe(true);
    });

    it('is deterministic for the same time signature', () => {
      const url1 = gu.MIDI_build_midi_url_count_in_track(4, 4);
      const url2 = gu.MIDI_build_midi_url_count_in_track(4, 4);
      expect(url2).toBe(url1);
    });

    it('produces a different URL for a different time signature (different count-in length)', () => {
      const url44 = gu.MIDI_build_midi_url_count_in_track(4, 4);
      const url34 = gu.MIDI_build_midi_url_count_in_track(3, 4);
      expect(url34).not.toBe(url44);
    });
  });

  describe('midiEventCallbackClass', () => {
    it('constructs an instance carrying classRoot and the default callback methods', () => {
      const cb = new gu.midiEventCallbackClass(gu);

      expect(cb.classRoot).toBe(gu);
      expect(cb.noteHasChangedSinceLastDataLoad).toBe(false);

      // Default callback surface - all present as functions.
      for (const method of [
        'playEvent',
        'loadMidiDataEvent',
        'doesMidiDataNeedRefresh',
        'pauseEvent',
        'resumeEvent',
        'stopEvent',
        'repeatChangeEvent',
        'percentProgress',
        'notePlaying',
        'midiInitialized',
      ]) {
        expect(typeof cb[method]).toBe('function');
      }
    });

    it("doesMidiDataNeedRefresh reads root.midiEventCallbacks (the GrooveUtils singleton), not the instance's own flag", () => {
      const cb = new gu.midiEventCallbackClass(gu);

      // A freshly-constructed instance's own flag is false, and so is the
      // GrooveUtils-instance singleton created internally by `new GrooveUtils()`.
      expect(cb.doesMidiDataNeedRefresh(gu)).toBe(false);

      // midiNoteHasChanged() flips the flag on gu.midiEventCallbacks (the
      // singleton), which is what doesMidiDataNeedRefresh actually reads -
      // the standalone `cb` instance's own flag is untouched.
      gu.midiNoteHasChanged();
      expect(cb.doesMidiDataNeedRefresh(gu)).toBe(true);
      expect(cb.noteHasChangedSinceLastDataLoad).toBe(false);

      gu.midiResetNoteHasChanged();
      expect(cb.doesMidiDataNeedRefresh(gu)).toBe(false);
    });
  });
});
