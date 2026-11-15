import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SettingsDialog } from '../../coach/ui/SettingsDialog.js';
import { coachState } from '../../coach/state/State.js';

describe('choosing which calibration the coach uses', () => {
  let dialog;
  const q = (sel) => document.querySelector(sel);
  const choose = (value) => {
    q('#coach-calib-use-select').value = value;
    q('#coach-calib-use-select').dispatchEvent(new Event('change'));
  };

  beforeEach(() => {
    coachState.calibrationHistory = [];
    coachState.recordCalibration({ method: 'playAlong', offsetMs: -30, details: '' });
    coachState.recordCalibration({ method: 'mic', offsetMs: 9, details: '' });
    coachState.recordCalibration({ method: 'playAlong', offsetMs: -23, details: '' });
    coachState.recordCalibration({ method: 'mic', offsetMs: 11, details: '' });
    coachState.calibrationOffset = -23;
    coachState.calibrationMethod = 'playAlong';
    coachState.calibrated = true;
    dialog = new SettingsDialog();
    dialog.inject();
    dialog.show();
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('offers the latest result of each way, and switches between them', () => {
    expect([...q('#coach-calib-use-select').options].map((o) => o.textContent)).toEqual([
      expect.stringContaining('Play along: -23 ms'),
      expect.stringContaining('Mic, drum sound: +11 ms'),
      'By hand',
    ]);
    expect(q('#coach-calib-use-select').value).toBe('playAlong');

    choose('mic');
    dialog.save();
    expect(coachState.calibrationOffset).toBe(11);
    expect(coachState.calibrationMethod).toBe('mic');

    dialog.show();
    choose('playAlong');
    dialog.save();
    expect(coachState.calibrationOffset).toBe(-23);
    expect(coachState.calibrationMethod).toBe('playAlong');
  });

  it('takes a latency typed in as set by hand', () => {
    q('#coach-latency-input').value = '5';
    q('#coach-latency-input').dispatchEvent(new Event('input'));
    dialog.save();
    expect(coachState.calibrationOffset).toBe(5);
    expect(coachState.calibrationMethod).toBe('hand');
  });
});
