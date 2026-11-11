// Where each note slot of a measure falls in time. The MIDI generator places notes with
// this, and the Drum Coach grades hits against the same positions, so the two can't drift.

// jsmidgen writes a fixed 128 ticks per quarter note into every MIDI file it builds.
export const MIDI_TICKS_PER_QUARTER = 128;

// Full-size note arrays hold 32nd notes, or 48th-note triplets (12 slots per quarter).
const STRAIGHT_SLOT_TICKS = MIDI_TICKS_PER_QUARTER / 8;
const TRIPLET_SLOT_TICKS = MIDI_TICKS_PER_QUARTER / 12;

// Swing works on groups of four slots of the swing division (1 e & a): it lengthens the
// 1 and the &, and shortens the e and the a by the same amount.
const SWING_GROUP_SLOTS = 4;

const MS_PER_MINUTE = 60000;

/**
 * Tick positions of the slots of one measure of a full-size note array.
 *
 * A triplet slot is a fractional number of ticks (10.67), and swing makes slots fractional
 * too. Each slot is placed on the tick nearest its exact position rather than adding
 * rounded durations, so rounding never accumulates: every slot is within half a tick of
 * its exact time, and the measure length is exact.
 *
 * @param {number} numNotes  Slots in the measure (full-size array length per measure).
 * @param {number} numNotesForSwing  The swing division, in notes per measure (e.g. 16).
 * @param {number} swingFraction  Swing amount, 0 (straight) to below 1.
 * @param {boolean} isTriplets  Whether the measure is in triplet slots.
 * @returns {number[]}  numNotes + 1 integer tick positions: the start of each slot, then
 *   the length of the measure.
 */
export function measureSlotTicks(numNotes, numNotesForSwing, swingFraction, isTriplets) {
  const slotTicks = isTriplets ? TRIPLET_SLOT_TICKS : STRAIGHT_SLOT_TICKS;
  const slotsPerSwingNote = numNotes / numNotesForSwing;
  const positions = [0];
  let exact = 0;
  for (let i = 0; i < numNotes; i++) {
    const swingPosition = Math.floor(
      (i % (SWING_GROUP_SLOTS * slotsPerSwingNote)) / slotsPerSwingNote
    );
    // positions 0 and 2 of the group (the 1 and the &) are lengthened, 1 and 3 shortened
    const swingSign = swingPosition % 2 === 0 ? 1 : -1;
    exact += slotTicks * (1 + swingSign * swingFraction);
    positions.push(Math.round(exact));
  }
  return positions;
}

/**
 * @param {number} ticks  MIDI ticks.
 * @param {number} tempo  Quarter notes per minute.
 * @returns {number} milliseconds
 */
export function ticksToMs(ticks, tempo) {
  return (ticks * MS_PER_MINUTE) / (tempo * MIDI_TICKS_PER_QUARTER);
}
