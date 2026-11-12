/**
 * PlaylineInterpolator — pure geometry for the continuous-strip model.
 *
 * Treats all staff systems as one continuous horizontal strip so that
 * time → X interpolation works across system boundaries. No DOM
 * dependencies — takes system data in, returns coordinates out.
 *
 * ## Concepts
 *
 * - **Segments**: Each system becomes a segment in the strip, with a
 *   cumulative offset from the strip's left edge.
 *
 * - **Waypoints**: Notes, rests, and barlines mapped to absolute offsets,
 *   sorted by time. A barline is placed at the exact time its measure
 *   ends, so the playline reaches it as the measure ends and never runs
 *   into the next measure early. The groove's final barline, at its end
 *   time, sits at the strip's right edge, which is the left edge again:
 *   the playline wraps exactly at the loop point.
 *
 * - **Thresholds**: The time each measure starts, with measure 0 at the
 *   loop point (the groove's end), where the next pass begins. Used for
 *   measure clearing and getMeasureIndex.
 *
 * ## Usage
 *
 *   const interp = new PlaylineInterpolator();
 *   interp.build(systems);
 *   const { x, sys } = interp.interpolate(timeMs);
 *   const measureIdx = interp.getMeasureIndex(timeMs, totalDurationMs);
 */
export class PlaylineInterpolator {
  constructor() {
    this._segments = [];
    this._waypoints = [];
    this._totalWidth = 0;
    this._thresholds = [];
    this.cursor = 0;
  }

  /** @returns {Array} The precomputed thresholds array */
  get thresholds() {
    return this._thresholds;
  }

  /**
   * Build segments, waypoints, and thresholds from system data.
   * Call once per groove load.
   * @param {Array} systems - Per-system data with timeline and measureBoundaries
   */
  build(systems) {
    const segments = buildSegments(systems);

    // --- Waypoints: barlines at the time their measure ends, then the notes ---
    const barlines = [];
    const notes = [];
    for (const seg of segments) {
      for (const b of seg.sys.measureBoundaries) {
        if (b.x !== null) {
          barlines.push({ timeMs: b.timeMs, absOffset: seg.offset + (b.x - seg.leftEdge) });
        }
      }
      for (const t of seg.sys.timeline) {
        if (t.x !== undefined) {
          notes.push({ timeMs: t.timeMs, absOffset: seg.offset + (t.x - seg.leftEdge) });
        }
      }
    }
    // A barline comes before the note on the downbeat it precedes: the playline reaches
    // the barline as the measure ends, then steps onto that note.
    const waypoints = [...barlines, ...notes].sort((a, b) => a.timeMs - b.timeMs);

    this._segments = segments;
    this._waypoints = waypoints;
    this._totalWidth = segments.reduce((sum, seg) => sum + seg.width, 0);
    this._thresholds = this._computeThresholds(systems);
    this.cursor = 0;
  }

  /**
   * Interpolate X position for an arbitrary time (linear scan).
   * Used by drawExtraHit for arbitrary-time lookups.
   * @returns {{ x: number, sys: Object } | null}
   */
  interpolate(timeMs) {
    const waypoints = this._waypoints;
    let left = null;
    let right = null;
    for (const w of waypoints) {
      if (w.timeMs <= timeMs) left = w;
      else {
        right = w;
        break;
      }
    }
    return this._between(left, right, timeMs);
  }

  /**
   * Advance the cursor and interpolate (O(1) amortized).
   * Used by _tickPlayLine on the hot path.
   * @returns {{ x: number, sys: Object } | null}
   */
  interpolateWithCursor(timeMs) {
    const waypoints = this._waypoints;
    while (this.cursor < waypoints.length - 1 && waypoints[this.cursor + 1].timeMs <= timeMs) {
      this.cursor++;
    }
    return this._between(waypoints[this.cursor], waypoints[this.cursor + 1], timeMs);
  }

  /**
   * The point between two waypoints at a time; null when the time is outside the strip.
   * The groove's final barline is at the strip's right edge, which is its left edge.
   */
  _between(left, right, timeMs) {
    if (!left || !right || right.timeMs <= left.timeMs || this._totalWidth === 0) return null;
    const ratio = (timeMs - left.timeMs) / (right.timeMs - left.timeMs);
    const offset = left.absOffset + ratio * (right.absOffset - left.absOffset);
    return this._offsetToSystem(offset % this._totalWidth);
  }

  /**
   * Compute the modular measure index for a given time.
   * Uses the geometric barline thresholds so the result matches the
   * visual position of the playline.
   */
  getMeasureIndex(timeMs, totalDurationMs, measureDurationMs, totalMeasures) {
    if (measureDurationMs <= 0 || !totalDurationMs) return 0;
    const modularTime = ((timeMs % totalDurationMs) + totalDurationMs) % totalDurationMs;

    if (this._thresholds.length === 0) {
      return Math.floor(modularTime / measureDurationMs) % totalMeasures;
    }

    let measureIndex = 0;
    for (let i = this._thresholds.length - 1; i >= 0; i--) {
      if (modularTime >= this._thresholds[i].timeMs) {
        measureIndex = this._thresholds[i].measureIndex;
        break;
      }
    }
    return measureIndex;
  }

  /**
   * Map an absolute offset back to a system and local X coordinate.
   */
  _offsetToSystem(offset) {
    for (const seg of this._segments) {
      if (offset >= seg.offset && offset < seg.offset + seg.width) {
        return { x: seg.leftEdge + (offset - seg.offset), sys: seg.sys };
      }
    }
    const last = this._segments.at(-1);
    return { x: last.rightEdge, sys: last.sys };
  }

  /**
   * The time each measure starts. Measure 0 starts at the loop point, the groove's end,
   * where the next pass begins.
   */
  _computeThresholds(systems) {
    const boundaries = systems.flatMap((s) => s.measureBoundaries);
    if (boundaries.length === 0) return [];
    const grooveEndMs = Math.max(...boundaries.map((b) => b.timeMs));
    const lastMeasure = Math.max(...boundaries.map((b) => b.measureIndex));
    const starts = new Map([[0, grooveEndMs]]);
    for (const b of boundaries) {
      if (b.measureIndex > 0 && b.measureIndex < lastMeasure) starts.set(b.measureIndex, b.timeMs);
    }
    return [...starts]
      .map(([measureIndex, timeMs]) => ({ measureIndex, timeMs }))
      .sort((a, b) => a.timeMs - b.timeMs);
  }
}

/** Each system as a segment of the strip, placed after the systems before it. */
function buildSegments(systems) {
  const segments = [];
  let offset = 0;
  for (const sys of systems) {
    const xs = sys.measureBoundaries.filter((b) => b.x !== null).map((b) => b.x);
    const leftEdge = xs.length > 0 ? Math.min(...xs) : 0;
    const rightEdge = xs.length > 0 ? Math.max(...xs) : 0;
    const width = rightEdge - leftEdge;
    segments.push({ sys, leftEdge, rightEdge, width, offset });
    offset += width;
  }
  return segments;
}
