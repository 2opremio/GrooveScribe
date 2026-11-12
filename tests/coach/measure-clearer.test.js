import { describe, it, expect } from 'vitest';
import { MeasureClearer } from '../../coach/ui/feedback/MeasureClearer.js';

function setup() {
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  document.body.appendChild(layer);
  const clearer = new MeasureClearer();
  clearer.init([{ layer }], [], 1000);
  const mark = (measure, play) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.classList.add('coach-hit-marker');
    el.setAttribute('data-measure', measure);
    el.setAttribute('data-play', play);
    layer.appendChild(el);
    return el;
  };
  return { clearer, mark };
}

describe('Drum Coach mark clearing', () => {
  it('clears a measure of earlier plays only, keeping marks already drawn for the new play', () => {
    const { clearer, mark } = setup();
    const old = mark(0, 2);
    const early = mark(0, 3); // an early hit on the new play's first note
    clearer.clearMeasure(0, 3);
    expect(old.isConnected).toBe(false);
    expect(early.isConnected).toBe(true);
  });

  it('leaves other measures alone, wherever their marks were drawn', () => {
    const { clearer, mark } = setup();
    const other = mark(1, 1);
    clearer.clearMeasure(0, 3);
    expect(other.isConnected).toBe(true);
  });

  it('remembers how far each measure was cleared', () => {
    const { clearer } = setup();
    clearer.clearMeasure(0, 3);
    expect(clearer.keptFrom(0)).toBe(3);
    expect(clearer.keptFrom(1)).toBe(-Infinity);
  });
});
