// A rising two-note chime: nothing like a drum or the metronome's click, so it can only mean
// "the tempo is going up". Synthesized, so it doesn't depend on the soundfont.
const CHIME_NOTES_HZ = [880, 1320]; // A5 then E6, a rising fifth
const CHIME_NOTE_S = 0.14; // each note's length; the second starts as the first ends
const CHIME_ATTACK_S = 0.005;
const CHIME_FLOOR_GAIN = 0.001; // exponential ramps can't reach 0: fade to this
// gain at 100% metronome volume, a little under the click so it doesn't startle
const CHIME_MAX_GAIN = 0.5;

/**
 * Play the chime on an audio context at a given time.
 * @param {AudioContext} ctx
 * @param {number} atContextTime - when it starts, on the context's clock, in s
 * @param {number} volumePercent - the metronome volume, 0-100
 */
export function playTempoChime(ctx, atContextTime, volumePercent) {
  const peak = (CHIME_MAX_GAIN * volumePercent) / 100;
  CHIME_NOTES_HZ.forEach((hz, i) => {
    const start = atContextTime + i * CHIME_NOTE_S;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(CHIME_FLOOR_GAIN, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + CHIME_ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(CHIME_FLOOR_GAIN, start + CHIME_NOTE_S);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + CHIME_NOTE_S);
  });
}
