/**
 * State - Manages the global state of the Drum Coach
 */

import { TOLERANCE_LEVELS } from '../engine/TimingEvaluator.js';

const VALID_MODES = ['practice', 'performance'];
// which hits near a calibration click count as the tap: only the loudest, or every hit
const VALID_CALIBRATION_HIT_RULES = ['loudest', 'every'];
const MAX_MIDI_VELOCITY = 127;
const MAX_PERCENT = 100;

const DEFAULTS = {
  mode: 'practice',
  tolerance: 'intermediate',
  reps: 4,
  countIn: true,
  calibrationOffset: 0,
  calibrated: false,
  drumMapPreset: '_gm',
  drumMapCustom: null,
  drumMapCustomHihatCC: null,
  drumMapConfigured: false,
  showDebugGrid: false,
  metronomeVolume: 100,
  startWithSolo: true,
  calibrationHitRule: 'loudest',
  minHitVelocity: 0, // 0 = no hit is ignored for being soft
  autoBpm: false, // in practice mode, raise the tempo after passes that meet the goal
  autoBpmPasses: 1, // passes in a row that must meet the goal before the tempo rises
  goalMinPerfectPercent: 50, // blue notes, in percent of the notes played, at least
  goalMaxClosePercent: 10, // yellow notes, in percent of the notes played, at most
  goalMaxMistakesPercent: 3, // missed notes and stray hits, in percent of the notes played, at most
  fewMistakesPercent: 5, // missed notes and stray hits, in percent of the notes, that count as few
};

function percentOrKeep(value, current, name) {
  value = Number(value);
  if (Number.isNaN(value)) {
    console.warn(`[State] Invalid ${name} '${value}', keeping '${current}'`);
    return current;
  }
  return Math.max(0, Math.min(MAX_PERCENT, Math.round(value)));
}

export class StateManager {
  constructor() {
    this._data = { ...DEFAULTS };
  }

  // Mode property
  get mode() {
    return this._data.mode;
  }

  set mode(value) {
    if (!VALID_MODES.includes(value)) {
      throw new Error(`[State] Invalid mode '${value}'`);
    }
    this._data.mode = value;
  }

  // Tolerance property
  get tolerance() {
    return this._data.tolerance;
  }

  set tolerance(value) {
    if (!Object.hasOwn(TOLERANCE_LEVELS, value)) {
      console.warn(`[State] Invalid tolerance '${value}', keeping '${this._data.tolerance}'`);
      return;
    }
    this._data.tolerance = value;
  }

  // Reps property
  get reps() {
    return this._data.reps;
  }

  set reps(value) {
    value = Math.floor(value);
    value = Math.max(1, Math.min(16, value));
    this._data.reps = value;
  }

  // CountIn property
  get countIn() {
    return this._data.countIn;
  }

  set countIn(value) {
    this._data.countIn = Boolean(value);
  }

  // CalibrationOffset property (ms, can be negative)
  get calibrationOffset() {
    return this._data.calibrationOffset;
  }

  set calibrationOffset(value) {
    value = Number(value);
    if (Number.isNaN(value)) {
      console.warn(
        `[State] Invalid calibrationOffset '${value}', keeping '${this._data.calibrationOffset}'`
      );
      return;
    }
    this._data.calibrationOffset = Math.round(value);
  }

  // Calibrated property — tracks whether calibration has been run
  get calibrated() {
    return this._data.calibrated;
  }

  set calibrated(value) {
    this._data.calibrated = Boolean(value);
  }

  // ShowDebugGrid property
  get showDebugGrid() {
    return this._data.showDebugGrid;
  }

  set showDebugGrid(value) {
    this._data.showDebugGrid = Boolean(value);
  }

  // MetronomeVolume property (0-100 percentage, maps to MIDI velocity 0-127)
  get metronomeVolume() {
    return this._data.metronomeVolume;
  }

  set metronomeVolume(value) {
    value = Number(value);
    if (Number.isNaN(value)) return;
    this._data.metronomeVolume = Math.max(0, Math.min(100, Math.round(value)));
  }

  // CalibrationHitRule: 'loudest' counts one tap per click (the loudest hit near it),
  // 'every' counts every hit as a tap
  get calibrationHitRule() {
    return this._data.calibrationHitRule;
  }

  set calibrationHitRule(value) {
    if (!VALID_CALIBRATION_HIT_RULES.includes(value)) {
      console.warn(
        `[State] Invalid calibrationHitRule '${value}', keeping '${this._data.calibrationHitRule}'`
      );
      return;
    }
    this._data.calibrationHitRule = value;
  }

  // MinHitVelocity: hits softer than this (MIDI velocity 0-127) are ignored, in sessions
  // and in calibration; 0 ignores nothing
  get minHitVelocity() {
    return this._data.minHitVelocity;
  }

  set minHitVelocity(value) {
    value = Number(value);
    if (Number.isNaN(value)) return;
    this._data.minHitVelocity = Math.max(0, Math.min(MAX_MIDI_VELOCITY, Math.round(value)));
  }

  // AutoBpm: in practice mode, raise the tempo after enough passes that meet the goal
  get autoBpm() {
    return this._data.autoBpm;
  }

  set autoBpm(value) {
    this._data.autoBpm = Boolean(value);
  }

  // AutoBpmPasses: passes in a row that must meet the goal before the tempo rises
  get autoBpmPasses() {
    return this._data.autoBpmPasses;
  }

  set autoBpmPasses(value) {
    value = Math.floor(Number(value));
    if (Number.isNaN(value) || value < 1) {
      console.warn(
        `[State] Invalid autoBpmPasses '${value}', keeping '${this._data.autoBpmPasses}'`
      );
      return;
    }
    this._data.autoBpmPasses = value;
  }

  get goalMinPerfectPercent() {
    return this._data.goalMinPerfectPercent;
  }

  set goalMinPerfectPercent(value) {
    this._data.goalMinPerfectPercent = percentOrKeep(
      value,
      this._data.goalMinPerfectPercent,
      'goalMinPerfectPercent'
    );
  }

  get goalMaxClosePercent() {
    return this._data.goalMaxClosePercent;
  }

  set goalMaxClosePercent(value) {
    this._data.goalMaxClosePercent = percentOrKeep(
      value,
      this._data.goalMaxClosePercent,
      'goalMaxClosePercent'
    );
  }

  get goalMaxMistakesPercent() {
    return this._data.goalMaxMistakesPercent;
  }

  set goalMaxMistakesPercent(value) {
    this._data.goalMaxMistakesPercent = percentOrKeep(
      value,
      this._data.goalMaxMistakesPercent,
      'goalMaxMistakesPercent'
    );
  }

  get fewMistakesPercent() {
    return this._data.fewMistakesPercent;
  }

  set fewMistakesPercent(value) {
    this._data.fewMistakesPercent = percentOrKeep(
      value,
      this._data.fewMistakesPercent,
      'fewMistakesPercent'
    );
  }

  /** @returns {import('../engine/PassScore.js').Goal} what a pass must reach */
  get goal() {
    return {
      minPerfectPercent: this.goalMinPerfectPercent,
      maxClosePercent: this.goalMaxClosePercent,
      maxMistakesPercent: this.goalMaxMistakesPercent,
    };
  }

  // StartWithSolo property — enable Solo (mute synth) when session starts
  get startWithSolo() {
    return this._data.startWithSolo;
  }

  set startWithSolo(value) {
    this._data.startWithSolo = Boolean(value);
  }

  // DrumMapPreset property — file path relative to modulemappings/ or 'custom'
  get drumMapPreset() {
    return this._data.drumMapPreset;
  }

  set drumMapPreset(value) {
    if (typeof value !== 'string' || value.length === 0) {
      console.warn(
        `[State] Invalid drumMapPreset '${value}', keeping '${this._data.drumMapPreset}'`
      );
      return;
    }
    this._data.drumMapPreset = value;
  }

  // DrumMapCustom property — editing-shape map object, or null
  get drumMapCustom() {
    return this._data.drumMapCustom;
  }

  set drumMapCustom(value) {
    if (value !== null && typeof value !== 'object') {
      console.warn(`[State] Invalid drumMapCustom, keeping current value`);
      return;
    }
    this._data.drumMapCustom = value;
  }

  // DrumMapCustomHihatCC property — hi-hat CC config object, or null
  get drumMapCustomHihatCC() {
    return this._data.drumMapCustomHihatCC;
  }

  set drumMapCustomHihatCC(value) {
    if (value !== null && typeof value !== 'object') {
      console.warn(`[State] Invalid drumMapCustomHihatCC, keeping current value`);
      return;
    }
    this._data.drumMapCustomHihatCC = value;
  }

  // DrumMapConfigured property — tracks whether user has explicitly chosen a mapping
  get drumMapConfigured() {
    return this._data.drumMapConfigured;
  }

  set drumMapConfigured(value) {
    this._data.drumMapConfigured = Boolean(value);
  }

  // Convert to plain object: every setting, by name
  toObject() {
    return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, this[key]]));
  }

  // Restore from plain object, through each setting's validation
  fromObject(obj) {
    for (const key of Object.keys(DEFAULTS)) {
      if (obj[key] !== undefined) this[key] = obj[key];
    }
  }

  // Persistence
  save() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('coachState', JSON.stringify(this.toObject()));
    } catch (e) {
      console.warn('[State] Failed to save:', e);
    }
  }

  load() {
    if (typeof localStorage === 'undefined') return;
    try {
      const data = localStorage.getItem('coachState');
      if (data) {
        this.fromObject(JSON.parse(data));
      }
    } catch (e) {
      console.warn('[State] Failed to load:', e);
    }
  }
}

// Global instance
export const coachState = new StateManager();

// Only load if localStorage is available (not in Node.js tests)
if (typeof localStorage !== 'undefined') {
  coachState.load();
}
