import { DrumType, ABC_PITCH_TO_DRUM_TYPE } from './DrumConstants.js';
import { getNoteScaler, isTripletDivisionFromNotesPerMeasure } from '../../js/musicMath.js';
import { measureSlotTicks, ticksToMs } from '../../js/noteTiming.js';

// One ABC note: accidentals, a letter, octave marks. A slot holds one, or a chord of several
// in brackets (GrooveScribe writes kick plus hi-hat foot as [F^d,]).
const ABC_NOTE = /[_^=]*[A-Ga-g][,']*/g;

/**
 * ABCIndexMapper - Maps ABC notation tick positions to rendered note indices
 * by simulating abc2svg's rendering order.
 *
 * abc2svg renders voices in a fixed order (stickings → hands → feet), and
 * within each voice, notes are rendered left-to-right. This class walks the
 * groove data in that same order to assign each (tickIndex, DrumType) pair
 * to its rendered ABC note index, enabling accurate hit-to-SVG matching.
 *
 * Also handles:
 * - Converting groove editor arrays into a ms-based note timeline for the Engine
 * - Resolving raw ABC pitch strings (with decorations) to DrumType values
 * - Extracting and validating groove timing metrics from editor data
 */
export class ABCIndexMapper {
  constructor() {
    this.noteMap = new Map();
  }

  /**
   * Build the (tickIndex, instrument) → abcNoteIndex mapping.
   * Must be called whenever the groove notation changes.
   *
   * @param {Object} data - Result from grooveDataFromClickableUI()
   * @param {Object} metrics - Result from getGrooveMetrics(data)
   */
  buildMap(data, metrics) {
    this.noteMap = new Map();
    if (!data || !metrics) return;

    let currentIndex = 0;
    const { totalTicks } = metrics;

    // Stickings use hidden rests (x) in abc2svg, which don't increment
    // ScoreLayoutExtractor's abcIndex counter.  Skip them here to stay
    // in sync with the extractor's numbering.

    const kickStemsUp = !!data.kickStemsUp;

    // 2. Main Voice (Hands, and Feet if stems are unified)
    for (let i = 0; i < totalTicks; i++) {
      const hasSnare = data.snare_array[i] && data.snare_array[i] !== '';
      const hasHH = data.hh_array[i] && data.hh_array[i] !== '';
      const hasToms = data.toms_array && data.toms_array.some((arr) => arr[i] && arr[i] !== '');
      const feet = kickStemsUp ? this._feetIn(data.kick_array[i], i) : [];
      const isKick = feet.includes(DrumType.KICK);
      const isFoot = feet.includes(DrumType.HH_FOOT);

      if (hasSnare || hasHH || hasToms || isKick || isFoot) {
        if (hasSnare) {
          [
            DrumType.SNARE,
            DrumType.SNARE_ACCENT,
            DrumType.SNARE_GHOST,
            DrumType.SNARE_XSTICK,
            DrumType.SNARE_FLAM,
            DrumType.SNARE_BUZZ,
          ].forEach((t) => this.noteMap.set(`${i}:${t}`, currentIndex));
        }
        if (hasHH) {
          [
            DrumType.HH_CLOSED,
            DrumType.HH_OPEN,
            DrumType.HH_ACCENT,
            DrumType.CRASH,
            DrumType.RIDE,
            DrumType.RIDE_BELL,
            DrumType.COWBELL,
            DrumType.STACKER,
            DrumType.METRONOME_NORMAL,
            DrumType.METRONOME_ACCENT,
          ].forEach((t) => this.noteMap.set(`${i}:${t}`, currentIndex));
        }
        if (hasToms) {
          data.toms_array.forEach((arr, tomIdx) => {
            if (arr[i]) {
              const key = tomIdx < 2 ? DrumType.TOM_HIGH : DrumType.TOM_LOW;
              this.noteMap.set(`${i}:${key}`, currentIndex);
            }
          });
        }
        if (isKick) this.noteMap.set(`${i}:${DrumType.KICK}`, currentIndex);
        if (isFoot) this.noteMap.set(`${i}:${DrumType.HH_FOOT}`, currentIndex);
        currentIndex++;
      }
    }

    // 3. Lower Voice (Feet only if rendered on separate stems)
    if (!kickStemsUp) {
      for (let i = 0; i < totalTicks; i++) {
        const feet = this._feetIn(data.kick_array[i], i);
        if (feet.length > 0) {
          // a chord of both feet is one note in the rendered score
          for (const foot of feet) this.noteMap.set(`${i}:${foot}`, currentIndex);
          currentIndex++;
        }
      }
    }
  }

  /** The foot drums (kick, hi-hat foot) in one slot of the feet voice. */
  _feetIn(val, tickIndex) {
    if (!val) return [];
    return this.resolveAbcDrumTypes(val, 'kick', tickIndex);
  }

  /**
   * Resolve the ABC note index for a specific tick and instrument.
   * @returns {number} The ABC note index, or -1 if not found
   */
  getIndex(tickIndex, instrument) {
    const index = this.noteMap.get(`${tickIndex}:${instrument}`);
    return index !== undefined ? index : -1;
  }

  /**
   * Convert groove editor arrays into a ms-based note timeline for the Engine.
   *
   * @param {Object} data - Result from grooveDataFromClickableUI()
   * @param {Object} metrics - Result from getGrooveMetrics(data)
   * @returns {Array} Sorted array of {time, type, tickIndex} objects
   */
  buildTimeline(data, metrics) {
    if (!data || !metrics) return [];

    const { noteTimeMs, totalTicks, repeatsPerBar } = metrics;
    const timeline = [];

    for (let repeat = 0; repeat < repeatsPerBar; repeat++) {
      this._addPassNotes(data, totalTicks, (i) => noteTimeMs(i, repeat), timeline);
    }
    return timeline.sort((a, b) => a.time - b.time);
  }

  /**
   * Add every note of the groove to the timeline once, at the time noteTimeMs gives it.
   */
  _addPassNotes(data, totalTicks, noteTimeMs, timeline) {
    for (let i = 0; i < totalTicks; i++) {
      // Hi-Hats & Cymbals
      const slots = [
        [data.hh_array[i], 'hh'],
        [data.snare_array[i], 'snare'],
        [data.kick_array[i], 'kick'],
        ...(data.toms_array || []).map((row, idx) => [row[i], `tom${idx}`]),
      ];
      for (const [val, arrayName] of slots) {
        if (!val) continue;
        // a chord in one slot is a note on each of its drums, graded on its own
        for (const type of this.resolveAbcDrumTypes(val, arrayName, i)) {
          timeline.push({ time: noteTimeMs(i), type, tickIndex: i });
        }
      }
    }
  }

  /**
   * The drums in one slot's raw ABC value (from grooveDataFromClickableUI): one note, or each
   * note of a chord such as [F^d,] (kick plus hi-hat foot).
   *
   * Values may include decorations (e.g. "!open!^g", "!accent!c", "!(c!)", "{/c").
   * The notes are read after stripping decorations, each looked up in ABC_PITCH_TO_DRUM_TYPE;
   * decorations then pick the articulation (e.g. !open! on ^g → HH_OPEN instead of HH_CLOSED).
   * A note GrooveScribe can't have written is reported and left out.
   *
   * @returns {string[]} DrumType values
   */
  resolveAbcDrumTypes(val, arrayName, tickIndex) {
    if (val === true) return [DrumType.KICK]; // the kick array's legacy "on"
    // Strip ABC decorations: !xxx! patterns (e.g. !accent!, !open!, !(.!, !///!)
    let stripped = val.replace(/![^!]*!/g, '');
    // Strip grace note prefix: {/X} block (flam notation, e.g. {/c} before the main note)
    stripped = stripped.replace(/\{\/[^}]*\}/g, '');
    const drums = [];
    for (const pitch of stripped.match(ABC_NOTE) || []) {
      const baseType = ABC_PITCH_TO_DRUM_TYPE[pitch];
      if (!baseType) {
        console.warn(
          `[ABCIndexMapper] Unknown ABC note in ${arrayName}[${tickIndex}]: ${JSON.stringify(pitch)} (value: ${JSON.stringify(val)})`
        );
        continue;
      }
      drums.push(articulation(val, baseType));
    }
    if (drums.length === 0) {
      console.warn(
        `[ABCIndexMapper] No notes in ${arrayName}[${tickIndex}]: ${JSON.stringify(val)}`
      );
    }
    return drums;
  }

  /**
   * Extract and validate groove timing metrics from editor data.
   * @param {Object} data - Result from grooveDataFromClickableUI()
   * @returns {Object|null} Metrics object or null if data is invalid
   */
  getGrooveMetrics(data) {
    const bpm = data.tempo;
    const numBeats = data.numBeats;
    const measures = data.numberOfMeasures;
    const notesPerMeasure = data.notesPerMeasure;

    if (!bpm || !numBeats || !measures || !notesPerMeasure || !data.repeatsPerBar) {
      console.error('[ABCIndexMapper] Groove data has missing/zero fields:', {
        tempo: bpm,
        numBeats,
        numberOfMeasures: measures,
        repeatsPerBar: data.repeatsPerBar,
        notesPerMeasure,
      });
      return null;
    }

    const totalTicks = notesPerMeasure * measures;

    // Note times come from the same slot positions the MIDI file is built from, so the
    // coach expects each note exactly when it plays (time signature, triplets and swing).
    const scaler = getNoteScaler(notesPerMeasure, numBeats, data.noteValue);
    const fullSizeNotes = notesPerMeasure * scaler;
    const isTriplets = isTripletDivisionFromNotesPerMeasure(
      fullSizeNotes,
      numBeats,
      data.noteValue
    );
    const slotTicks = measureSlotTicks(
      fullSizeNotes,
      data.timeDivision,
      data.swingPercent / 100,
      isTriplets
    );
    const measureTicks = slotTicks[fullSizeNotes];
    const measureDurationMs = ticksToMs(measureTicks, bpm);
    const repeatsPerBar = data.repeatsPerBar;
    // each measure plays repeatsPerBar times before the next one
    const noteTimeMs = (i, repeat) => {
      const playedMeasure = Math.floor(i / notesPerMeasure) * repeatsPerBar + repeat;
      const slot = (i % notesPerMeasure) * scaler;
      return ticksToMs(playedMeasure * measureTicks + slotTicks[slot], bpm);
    };

    return {
      measures,
      repeatsPerBar,
      notesPerMeasure,
      totalTicks,
      measureDurationMs,
      noteTimeMs,
    };
  }
}

/**
 * The articulation a slot's decorations give a drum, e.g. !open! turns a closed hi-hat open.
 * @param {string} val - the slot's raw ABC value, decorations included
 * @param {string} baseType - the drum the note's pitch names
 */
function articulation(val, baseType) {
  if (val.includes('!open!')) return DrumType.HH_OPEN;
  if (val.includes('!accent!')) {
    // Flam with accent: the {/ grace block takes priority over accent
    if (val.includes('{/')) return DrumType.SNARE_FLAM;
    if (baseType === DrumType.SNARE) return DrumType.SNARE_ACCENT;
    if (baseType === DrumType.HH_CLOSED) return DrumType.HH_ACCENT;
  }
  if (val.includes('!(')) return DrumType.SNARE_GHOST;
  if (val.includes('{/')) return DrumType.SNARE_FLAM;
  if (val.includes('!///!')) return DrumType.SNARE_BUZZ;
  return baseType;
}
