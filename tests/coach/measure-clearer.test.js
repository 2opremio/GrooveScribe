import { describe, it, expect } from 'vitest';
import { MeasureClearer } from '../../coach/ui/feedback/MeasureClearer.js';

// One line of music with two measures: x 0-100 and 100-200.
function setup() {
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  document.body.appendChild(layer);
  const systems = [
    { measureBoundaries: [{ x: 0 }, { x: 100 }, { x: 200 }], numMeasures: 2, layerIndex: 0 },
  ];
  const clearer = new MeasureClearer();
  clearer.init(systems, [{ layer }], [], 1000);
  const mark = (x, play) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.classList.add('coach-hit-marker');
    el.setAttribute('data-x', x);
    el.setAttribute('data-play', play);
    layer.appendChild(el);
    return el;
  };
  return { clearer, mark };
}

describe('Drum Coach mark clearing', () => {
  it('clears a measure of earlier plays only, keeping marks already drawn for the new play', () => {
    const { clearer, mark } = setup();
    const old = mark(50, 2);
    const early = mark(20, 3); // an early hit on the new play's first note
    clearer.clearMeasure(0, 3);
    expect(old.isConnected).toBe(false);
    expect(early.isConnected).toBe(true);
  });

  it('leaves other measures alone', () => {
    const { clearer, mark } = setup();
    const other = mark(150, 1);
    clearer.clearMeasure(0, 3);
    expect(other.isConnected).toBe(true);
  });
});
