# Source Code README

Readme for Groove Scribe Source Code.

## Structure

- Groove Scribe runs entirely in the browser with no back-end calls.
- The main application is referred to as **Groove Writer** in the source code and includes the authoring view.
- A secondary application is referred to as **Groove Display** in the source code and includes the sheet-music generator and the MIDI player.
- Shared logic used by both lives in **Groove Utils**.

Since the 2026 refactor, the source in `js/` is loaded as **native ES modules** (`<script type="module">`) — there is **no build/bundler step**. Serve the project over HTTP (`npm run serve`) rather than opening the HTML via `file://`, or the sound library will fail to load. See `README.md` for the developer tooling (Vitest, Playwright, ESLint, Prettier, TypeScript `checkJs`, Knip) and `CLAUDE.md` for a fuller architecture tour.

## Data flow

Everything centers on one data object, **`grooveData`** — the notation-independent description of a groove (time signature, subdivision, tempo, the per-instrument note lanes, display flags). The pipeline is:

```
URL query string  ──parse──►  grooveData  ──►  ABC notation ──► SVG  (abc2svg)
                                   │
                                   └──────────►  MIDI file   (jsmidgen) ──► playback
```

## Groove Writer

- All the authoring code: the clickable grid of HTML note cells that, in turn, generates music.
- Puts an HTML grid on the screen representing every possible note for a given division, reads it back into note arrays, and calls Groove Utils / Groove Display to render sheet music and MIDI.
- HTML
  - `index.html` — main authoring view. Add `?GDB_Author=1` for the GrooveDB authoring view.
- JavaScript
  - `groove_writer.js` — the editor controller (grid clicks, menus/popups, undo/redo, permutation practice modes, hotkeys).
  - `main.js` — the ES-module entry point for `index.html`: constructs the app, exposes the API on `window` for the inline `onclick` handlers, and builds the dynamic DOM into placeholder containers after parse (this replaced the old parse-time `document.write`).

## Groove Display

- Just the rendering/playback portion; runs independently of the authoring view for embedding in other pages.
- Turns note arrays into ABC notation, renders SVG sheet music (abc2svg), generates MIDI files, and controls MIDI playback.
- HTML
  - `GrooveEmbed.html` — production single-groove embed target (share/embed URLs point here).
  - Example/test embed pages live in `html_examples_and_tests/` (see below).
- JavaScript
  - `groove_display.js` — embeds a read-only groove display into an HTML page.
  - `groove_utils.js` — see below.

## Groove Utils and the extracted core modules

`groove_utils.js` is the shared engine used by both Writer and Display: URL ↔ grooveData, ABC + MIDI generation, MIDI playback, tempo/swing, and note-array math. During the refactor its pure logic (and much of Groove Writer's) was extracted into small, focused modules that it delegates to:

- `constants.js` — all `constant_*` values (ABC tokens, MIDI note numbers, grid colors).
- `grooveData.js` — the `GrooveData` type definition (JSDoc `@typedef`) and the pure `createGrooveData()` factory. The central contract described above.
- `musicMath.js` — pure time-signature / note-scaling math.
- `noteArrays.js` — note-array ↔ tab/ABC conversions, default-groove generators.
- `urlSerialization.js` — URL ↔ grooveData serialization (pure).
- `abcNotation.js` — grooveData → ABC notation.
- `midiFile.js` — grooveData → MIDI file (via jsmidgen).
- `browserInfo.js` — user-agent / touch-device probes.
- `permutations.js` — pure generators for the permutation practice modes.
- `viewHtml.js` — pure HTML builders (the clickable staff container and the permutation-options menu).
- `gridState.js` — the clickable-grid **read** layer: per-cell note state and whole-measure array readers (reads the DOM). The note **setters** remain in `groove_writer.js`.
- `grooves.js` — the built-in groove library.

Third-party libraries are vendored under `js/` (abc2svg, jsmidgen, pablo, share-button, unmute) and `MIDI.js/` (MIDI playback + soundfonts); these are not linted or edited.

## Repository layout (HTML)

- **Root** — the app and app-wired pages: `index.html`, `GrooveEmbed.html`, `gscribe_help.html`, `gscribe_about.html`.
- **`html_examples_and_tests/`** — standalone example, demo, and test pages (multi-display, image-only, time-signature tests, GrooveDB tools, etc.), with an `index.html` listing them.
- **`tests/`** — Vitest unit tests. **`tests-e2e/`** — Playwright browser tests (golden-master SVG/MIDI snapshots + smoke checks).

## Drum Coach (`coach/`)

The Drum Coach is a self-contained ES module tree that hooks into GrooveWriter's playback system. It provides real-time timing evaluation when playing along on a MIDI electronic drum kit.

### Architecture

```
coach/
├── bootstrap.js              Entry point, loaded via <script type="module"> in index.html
├── Controller.js             Orchestrates all components, routes MIDI hits, manages session lifecycle
├── state/
│   └── State.js              Global state manager with localStorage persistence
├── engine/
│   ├── DrumConstants.js      Drum type identifiers (DrumType, ModuleDrumTypes, EditorDrumToModuleDrum)
│   ├── Engine.js             Timing evaluation engine — matches MIDI hits to expected notes
│   ├── TimingEvaluator.js    Pure function for timing error + tier calculation
│   ├── MidiInputHandler.js   Web MIDI API wrapper, drum map lookup, CC#4 hi-hat tracking
│   ├── LatencyManager.js     Audio output latency detection + calibration offset
│   ├── ABCIndexMapper.js     Maps groove notes to ABC notation indices for visual feedback
│   └── ScoreLayoutExtractor.js  Extracts rendered note coordinates from abc2svg SVG output
├── ui/
│   ├── SettingsDialog.js     Coach settings (mode, tolerance, mapping, calibration, volume)
│   ├── CalibrationDialog.js  Tap-along latency calibration with timing strip visualization
│   ├── DrumMapDialog.js      MIDI mapping config with presets, MIDI-learn, CC config, live feedback
│   ├── ResultsDialog.js      Post-session score display
│   ├── PlayerBar.js          Coaching-mode player bar (stop button, badge, solo toggle)
│   └── feedback/
│       └── Renderer.js       SVG overlay for hit circles, play line, debug grid
├── data/
│   ├── DrumMapLoader.js      Fetches JSON presets, resolves inheritance, validates against ModuleDrumTypes
│   ├── DrumMapUtils.js       Editing↔runtime map conversion, URL encode/decode
│   └── modulemappings/       JSON drum map presets (see modulemappings/README.md)
│       ├── _gm.json          General MIDI base map
│       ├── roland/            Roland V-Drums (TD-17, TD-27, TD-50, V-31/51/71)
│       ├── yamaha/            Yamaha DTX (DTX-PRO, DTX6, DTX502)
│       ├── alesis/            Alesis (Nitro, Surge, Strike, Command)
│       └── efnote/            Efnote (3, 5, 7)
└── css/
    └── coach.css             All coach UI styles
```

### Key Concepts

**Drum Types:** `DrumConstants.js` defines `ModuleDrumTypes` — the 13 drum types that can come from hardware (kick, snare, snare_xstick, hh_foot, hh_open, hh_closed, tom_high, tom_low, crash, ride, ride_bell, cow_bell, stacker). All MIDI mapping and hit evaluation works in terms of these types.

**Drum Map Presets:** JSON files under `modulemappings/` with inheritance via a `base` field. Files prefixed with `_` are base maps (not shown in UI). The loader resolves the chain and merges maps from root to leaf. See `modulemappings/README.md` for the format and how to add new modules.

**Hi-Hat CC:** Some modules (Roland, Yamaha, Efnote) use CC#4 to communicate pedal position instead of sending different note numbers for open/closed. When enabled, `MidiInputHandler` tracks CC messages and overrides `hh_open` → `hh_closed` when the CC value exceeds the configured threshold.

**Timing Evaluation:** `Engine.js` builds a timeline from the groove's expected notes. When a MIDI hit arrives, it finds the nearest matching note using a cursor-based forward scan. `TimingEvaluator.js` computes the timing error accounting for audio output latency and calibration offset. Hits are classified as perfect/good/close/miss based on configurable tolerance windows.

**Visual Feedback:** `Renderer.js` draws colored circles on the SVG score at the matched note's position. It uses coordinates extracted by `ScoreLayoutExtractor.js` from abc2svg's rendered output. A moving play line shows the current playback position.

**Calibration:** The calibration dialog plays metronome clicks at 80 BPM via Web Audio oscillator and captures MIDI hits (or keyboard taps). It collects 20 taps, discards the first 4 (warmup), and computes the median timing error as the calibration offset.

### Integration with GrooveWriter

The coach hooks into GrooveWriter with a few small touch points in the core:

- `bootstrap.js` waits for `window.myGrooveWriter`, injects the Coach button, and creates the `Controller`
- `Controller` intercepts GrooveWriter's playback callbacks (`playEvent`, `stopEvent`, `repeatCallback`) to sync the coaching engine
- During coaching, the editor grid is hidden (view mode) and the player bar is transformed into a coaching bar
- URL state uses `Mode=coach` and optional `DrumMap`/`DM` parameters, serialized by `urlSerialization.js` from flags set on GrooveUtils
- `groove_utils.js` `renderABCtoSVG` hooks `window.scoreLayout` into each abc2svg render; `midiFile.js` honors `metronomeVelocityOverride` for the coach's metronome volume
