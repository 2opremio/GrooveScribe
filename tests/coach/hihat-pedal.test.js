import { describe, it, expect } from 'vitest';
import { MidiInputHandler } from '../../coach/engine/MidiInputHandler.js';
import { Engine } from '../../coach/engine/Engine.js';
import { DrumType } from '../../coach/engine/DrumConstants.js';

// as the General MIDI base map sets it, for every kit
const PEDAL = { enabled: true, cc: 4, closedFrom: 60, openUpTo: 80 };
// a V-51 sends its open edge note at any pedal position short of fully closed
const HH_EDGE = 26;
// and its closed edge note only with the pedal all the way down
const HH_CLOSED_EDGE = 22;
const CC = 0xb0;
const NOTE_ON = 0x90;
const WINDOWS = { perfect: 20, good: 35, close: 50 };

function kitWithPedal() {
  const hits = [];
  const handler = new MidiInputHandler({
    onHit: (drum) => hits.push(drum),
    drumMap: { [HH_EDGE]: DrumType.HH_OPEN, [HH_CLOSED_EDGE]: DrumType.HH_CLOSED },
    hihatCC: PEDAL,
  });
  const send = (data) =>
    handler._handleMidiMessage({ data, timeStamp: 1, target: { name: 'kit' } });
  const pedalAt = (value) => send([CC, PEDAL.cc, value]);
  const hit = (note) => send([NOTE_ON, note, 100]);
  return { hits, pedalAt, hit };
}

function engineFor(noteType) {
  const engine = new Engine({ latencyMs: () => 0, windows: WINDOWS });
  engine.loadGroove({ target: [{ time: 0, type: noteType }] });
  engine.start(performance.now() - 10);
  return engine;
}

describe('Drum Coach hi-hat pedal', () => {
  it('tells open, half-open and closed hits apart by the pedal', () => {
    const kit = kitWithPedal();
    // fully open, half open (as a washy chorus is played), closed
    for (const pedal of [10, 65, 90]) {
      kit.pedalAt(pedal);
      kit.hit(HH_EDGE);
    }
    expect(kit.hits).toEqual([DrumType.HH_OPEN, DrumType.HH_HALF_OPEN, DrumType.HH_CLOSED]);
  });

  it("reads a kit's closed note by the pedal too", () => {
    const kit = kitWithPedal();
    kit.pedalAt(30);
    kit.hit(HH_CLOSED_EDGE);
    expect(kit.hits).toEqual([DrumType.HH_OPEN]);
  });

  it("keeps the kit's own reading until the pedal sends a value", () => {
    const kit = kitWithPedal();
    kit.hit(HH_CLOSED_EDGE);
    kit.hit(HH_EDGE);
    expect(kit.hits).toEqual([DrumType.HH_CLOSED, DrumType.HH_OPEN]);
  });

  it.each([DrumType.HH_OPEN, DrumType.HH_CLOSED])(
    'credits a half-open hit for a %s note',
    (note) => {
      const engine = engineFor(note);
      expect(engine.handleMidiHit(DrumType.HH_HALF_OPEN, engine.startTime).tier).toBe('perfect');
    }
  );

  it('does not credit a half-open hit for another drum', () => {
    const engine = engineFor(DrumType.RIDE);
    expect(engine.handleMidiHit(DrumType.HH_HALF_OPEN, engine.startTime).tier).toBe('extra');
  });
});
