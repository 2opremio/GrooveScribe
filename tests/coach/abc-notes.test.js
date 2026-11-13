import { describe, it, expect } from 'vitest';
import * as constants from '../../js/constants.js';
import { ABCIndexMapper } from '../../coach/engine/ABCIndexMapper.js';
import { DrumType } from '../../coach/engine/DrumConstants.js';

// every note GrooveScribe can write into a voice slot (stickings are text, not notes)
const NOTE_CONSTANTS = Object.entries(constants).filter(
  ([name, value]) =>
    name.startsWith('constant_ABC_') && typeof value === 'string' && !name.includes('STICK')
);

describe('Drum Coach reading the score', () => {
  const mapper = new ABCIndexMapper();

  it('finds a drum to grade in every note GrooveScribe can write', () => {
    expect(NOTE_CONSTANTS.length).toBeGreaterThan(20);
    for (const [name, value] of NOTE_CONSTANTS) {
      const drums = mapper.resolveAbcDrumTypes(value, name, 0);
      expect(drums.length, `${name} (${value})`).toBeGreaterThan(0);
    }
  });

  it('grades each drum of a chord on its own', () => {
    expect(mapper.resolveAbcDrumTypes(constants.constant_ABC_KI_SandK, 'kick', 0)).toEqual([
      DrumType.KICK,
      DrumType.HH_FOOT,
    ]);
  });
});
