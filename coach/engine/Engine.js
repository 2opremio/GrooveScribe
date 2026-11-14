import { DrumType, EditorDrumToModuleDrum } from './DrumConstants.js';
import { evaluateHit } from './TimingEvaluator.js';
import { emptyScore } from './PassScore.js';

// Timing thresholds (ms) for matching incoming MIDI hits to expected notes
export const NORMAL_HIT_MATCH_WINDOW_MS = 150; // Max distance from expected note before counting as extra

// The furthest (in ms) a note can be from the hit time and still be matchable.
// Used for cursor advancement (skipping old notes) and scan termination.
const SCAN_RADIUS_MS = NORMAL_HIT_MATCH_WINDOW_MS;

/**
 * Engine - Manages the coaching session
 */
export class Engine {
  constructor(options = {}) {
    this.groove = null; // Current groove/pattern
    this.noteTimeline = []; // Flattened note schedule [{time, type, ...}]
    this.results = []; // Hit results for scoring
    // () => ms from scheduling a note to the player's hit on it arriving; read per hit
    // because the browser's reported output delay changes once playback is running
    this.latencyMs = options.latencyMs;
    this.windows = options.windows || { perfect: 20, good: 35, close: 50 };
    this.onHitEvaluated = options.onHitEvaluated || (() => {});
    // () => whether hi-hat foot hits are graded in a groove that has no hi-hat foot notes; many
    // players keep time with the foot, so by default those hits are left out
    this.gradesUnwrittenHihatFoot = options.gradesUnwrittenHihatFoot ?? (() => false);

    this.startTime = 0;
    this.isPlaying = false;
  }

  /**
   * Load a groove and prepare the note timeline
   * @param {Object} groove - The groove object containing targets
   * @param {number} bpm - Beats per minute (optional if already in groove)
   */
  loadGroove(groove, bpm) {
    this.groove = groove;
    this.noteTimeline = groove.target.map((note, index) => {
      const moduleType = EditorDrumToModuleDrum[note.type];
      if (moduleType === undefined) {
        throw new Error(`[Engine] No EditorDrumToModuleDrum mapping for '${note.type}'`);
      }
      return {
        ...note,
        type: moduleType ?? note.type,
        editorType: note.type,
        originalIndex: index,
        matched: false,
      };
    });
    this.hasHihatFoot = this.noteTimeline.some((note) => note.type === DrumType.HH_FOOT);
    this.results = [];
  }

  /**
   * Start the coaching session
   * @param {number} startTime - performance.now() when playback started
   */
  start(startTime) {
    this.startTime = startTime;
    this.isPlaying = true;
    this.results = [];
    // Reset matched/graceMatched flags for all notes
    this.noteTimeline.forEach((note) => {
      note.matched = false;
      note.graceMatched = false;
      note.missed = false;
    });
    // Search cursor: index of the earliest note that could still be matched.
    // Advances monotonically during playback; each note is skipped at most once.
    this._searchCursor = 0;
    // Miss cursor: index of the earliest note not yet known to be hit or missed.
    this._missCursor = 0;
  }

  /**
   * Notes whose time to be hit has passed without a graded hit. A note is past once
   * playback is SCAN_RADIUS_MS beyond it: no hit can be matched to it after that.
   * Each note is reported once.
   * @param {number} timestamp - performance.now() to check at
   * @returns {Array} the notes that became missed, in time order
   */
  takeMissedNotes(timestamp) {
    const tl = this.noteTimeline;
    const playbackTime = timestamp - this.startTime;
    const latency = this.latencyMs();
    const missed = [];
    while (
      this._missCursor < tl.length &&
      playbackTime - (tl[this._missCursor].time + latency) > SCAN_RADIUS_MS
    ) {
      const note = tl[this._missCursor++];
      if (note.matched) continue;
      note.missed = true;
      missed.push(note);
    }
    return missed;
  }

  /**
   * End the pass: every note not hit by now is missed.
   * @returns {Array} the notes that became missed, in time order
   */
  finishPass() {
    return this.takeMissedNotes(Infinity);
  }

  /**
   * How the current pass has gone so far: graded hits, stray hits, and the notes known
   * to be missed. Flam grace notes are part of their flam and aren't counted on their own.
   * A stray hit that was an attempt at a note later missed is that note's miss, not a second
   * mistake; see _isOwnMistake.
   * @returns {import('./PassScore.js').Score}
   */
  passScore() {
    const score = emptyScore();
    for (const res of this.results) {
      if (res.isGraceNote) continue;
      if (res.tier !== 'extra') score[res.tier]++;
      else if (this._isOwnMistake(res)) score.stray++;
    }
    score.missed = this.noteTimeline.filter((n) => n.missed).length;
    return score;
  }

  /**
   * How early or late the graded hits of the current pass were, typically: the median of
   * their timing errors. Negative is early.
   * @returns {number|null} ms, or null before any hit is graded
   */
  passTimingOffset() {
    const errors = this.results
      .filter((res) => res.isMatch && !res.isGraceNote)
      .map((res) => res.timingError)
      .sort((a, b) => a - b);
    if (errors.length === 0) return null;
    const mid = Math.floor(errors.length / 2);
    return errors.length % 2 === 1 ? errors[mid] : (errors[mid - 1] + errors[mid]) / 2;
  }

  /**
   * Whether a stray hit is a mistake of its own: one with no note in reach, or an extra hit
   * next to a note that was hit after all. Next to a note still open (on its drum, or on
   * another drum for a hit on the wrong drum) it isn't counted yet; if that note ends up
   * missed, the miss is the mistake.
   */
  _isOwnMistake(stray) {
    const noteIndex = stray.nearestNoteIndex ?? stray.intendedNoteIndex;
    if (noteIndex === undefined) return true;
    return this.noteTimeline[noteIndex].matched;
  }

  /**
   * A hit with no note on its drum in reach: an extra hit, or an attempt at a note on another
   * drum, which it is tied to (see _isOwnMistake).
   */
  _strayOffDrum(drum, relativeHitTime, latency) {
    const evaluation = { timingError: 0, tier: 'extra', isMatch: false, drum };
    const intended = this._nearestOpenNote(relativeHitTime, latency);
    if (intended) evaluation.intendedNoteIndex = intended.originalIndex;
    return evaluation;
  }

  /**
   * The note, on any drum, that a hit on the wrong drum was most likely meant for: the nearest
   * note still open (not hit, not missed) within matching reach. If that note ends up missed,
   * the wrong hit and the miss are one mistake.
   * @returns {Object|null}
   */
  _nearestOpenNote(relativeHitTime, latency) {
    let nearest = null;
    let minDiff = Infinity;
    for (let i = this._searchCursor; i < this.noteTimeline.length; i++) {
      const note = this.noteTimeline[i];
      const diff = Math.abs(relativeHitTime - (note.time + latency));
      if (note.time + latency - relativeHitTime > NORMAL_HIT_MATCH_WINDOW_MS) break;
      if (note.matched || note.missed || note.isGrace || diff > NORMAL_HIT_MATCH_WINDOW_MS)
        continue;
      if (diff < minDiff) {
        minDiff = diff;
        nearest = note;
      }
    }
    return nearest;
  }

  /**
   * Stop the coaching session
   */
  stop() {
    this.isPlaying = false;
  }

  /**
   * Helper to check if a MIDI drum type matches a timeline note type
   * Handles articulations (e.g., SNARE matching SNARE_ACCENT)
   */
  _isTypeMatch(drum, noteType) {
    // Since loadGroove already normalized noteType using EditorDrumToModuleDrum,
    // and incoming MIDI drum hits should be in ModuleDrumTypes,
    // a simple equality check is sufficient for most drums.
    if (drum === noteType) return true;

    // Special case: snare can match snare_flam as the grace note
    // but snare_flam itself (the primary hit) would have been normalized to 'snare'
    // in loadGroove. The grace note logic is handled separately in handleMidiHit.

    return false;
  }

  /**
   * Whether a note can take this hit, and how far off the hit is.
   * A flam or drag (editor type snare_flam) takes several strokes; each later stroke in reach
   * is graded in place of the one before, which becomes a grace stroke. That grades the last
   * stroke, the main one, however many grace strokes come first, and a single stroke as well.
   * @returns {{ absDiff: number } | null} Match info, or null if not a candidate
   */
  _evaluateCandidate(note, drum, relativeHitTime, latency) {
    if (!this._isTypeMatch(drum, note.type)) return null;
    if (note.matched && note.editorType !== DrumType.SNARE_FLAM) return null;
    const absDiff = Math.abs(relativeHitTime - (note.time + latency));
    return absDiff <= NORMAL_HIT_MATCH_WINDOW_MS ? { absDiff } : null;
  }

  /**
   * Distance from a hit to the nearest note it could be, at the current latency.
   * @param {string} drum - Normalized drum name
   * @param {number} relativeHitTime - Hit time relative to the pass start (ms)
   * @param {boolean} includeMatched - Also consider notes already hit in this pass
   * @returns {number} ms to the nearest candidate note, Infinity if there is none
   */
  nearestNoteDistance(drum, relativeHitTime, includeMatched) {
    const latency = this.latencyMs();
    let nearest = Infinity;
    for (const note of this.noteTimeline) {
      if (!includeMatched && note.matched) continue;
      if (!this._isTypeMatch(drum, note.type)) continue;
      nearest = Math.min(nearest, Math.abs(relativeHitTime - (note.time + latency)));
    }
    return nearest;
  }

  /**
   * Handle an incoming MIDI hit.
   *
   * Uses a cursor-based forward scan for efficient note matching:
   *
   *   1. Advance _searchCursor past notes that are definitively unmatchable
   *      (their expected-heard-time is > SCAN_RADIUS_MS before playbackTime).
   *      The cursor uses playbackTime (performance.now() - startTime) because
   *      it represents "where playback is right now" and is always >= any
   *      relativeHitTime we could receive.
   *
   *   2. Scan forward from _searchCursor, evaluating each note against
   *      relativeHitTime (the actual hit timestamp). Stop when remaining
   *      notes are too far in the future (> SCAN_RADIUS_MS ahead of the hit).
   *
   *   No backward scan is needed: the cursor guarantees everything before it
   *   is beyond SCAN_RADIUS_MS in the past. Since relativeHitTime <= playbackTime
   *   (the hit happened before or at now), a note skipped by the cursor is also
   *   beyond the match window relative to the hit.
   *
   * @param {string} drum - Normalized drum name (e.g., 'kick', 'snare')
   * @param {number} timestamp - The hardware timestamp from the MIDI event
   */
  handleMidiHit(drum, timestamp) {
    if (!this.isPlaying) return null;
    if (drum === DrumType.HH_FOOT && !this.hasHihatFoot && !this.gradesUnwrittenHihatFoot()) {
      return null;
    }
    const tl = this.noteTimeline;
    const latency = this.latencyMs();

    // relativeHitTime: from the hit's actual timestamp. Used for all matching.
    const relativeHitTime = timestamp - this.startTime;

    // playbackTime: current wall-clock elapsed time. Used only for cursor advancement.
    // Always >= relativeHitTime (the hit happened before or at performance.now()).
    const playbackTime = performance.now() - this.startTime;

    // Step 1: Advance cursor past notes that are definitively unmatchable.
    // A note is unmatchable when its expected-heard-time (note.time + latency)
    // is more than SCAN_RADIUS_MS behind playbackTime.
    while (
      this._searchCursor < tl.length &&
      playbackTime - (tl[this._searchCursor].time + latency) > SCAN_RADIUS_MS
    ) {
      this._searchCursor++;
    }

    // Step 2: Forward scan from cursor, matching against relativeHitTime.
    let bestMatch = null; // direct reference to the timeline note
    let minDiff = Infinity;

    for (let i = this._searchCursor; i < tl.length; i++) {
      const note = tl[i];
      // Stop when remaining notes are too far in the future to match this hit
      if (note.time + latency - relativeHitTime > SCAN_RADIUS_MS) break;

      const result = this._evaluateCandidate(note, drum, relativeHitTime, latency);
      if (result && result.absDiff < minDiff) {
        minDiff = result.absDiff;
        bestMatch = note;
      }
    }

    if (!bestMatch) {
      const evaluation = this._strayOffDrum(drum, relativeHitTime, latency);
      this.results.push(evaluation);
      this.onHitEvaluated(evaluation);
      return evaluation;
    }

    let evaluation = evaluateHit(timestamp, this.startTime + bestMatch.time, latency, this.windows);
    if (evaluation.isMatch) {
      evaluation.noteIndex = bestMatch.originalIndex;
      // a later stroke of a flam or drag: the stroke graded so far was a grace stroke
      if (bestMatch.gradedResult) bestMatch.gradedResult.isGraceNote = true;
      bestMatch.gradedResult = evaluation;
      bestMatch.matched = true;
    } else {
      // Outside every grading window: a stray hit, and the note stays open for a
      // better-timed one (or counts as missed), so each note lands in exactly one tier.
      // The note it was closest to is kept, to show the hit by it.
      evaluation = {
        timingError: evaluation.timingError,
        tier: 'extra',
        isMatch: false,
        drum,
        nearestNoteIndex: bestMatch.originalIndex,
      };
    }

    this.results.push(evaluation);
    this.onHitEvaluated(evaluation);

    return evaluation;
  }
}
