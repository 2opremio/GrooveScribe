import { Controller } from './Controller.js';

const BOOTSTRAP_RETRY_MS = 500;
const BOOTSTRAP_MAX_RETRIES = 20; // 10 seconds total
const BUTTON_INJECT_RETRY_MS = 1000;
const BUTTON_INJECT_MAX_RETRIES = 10; // 10 seconds total

// GrooveWriter rewrites the URL with replaceState once the page loads, dropping the
// coach's own params, so read them from the query string as it was when the page opened.
const initialQuery = window.location.search;

// Resolves once window 'load' has fired. This module's listener is registered after
// js/main.js's, so it runs after GrooveWriter.runsOnPageLoad has built the player, loaded the
// URL's groove and installed its own playback callbacks (loadMidiDataEvent, notePlaying),
// which would replace the coach's hooks if the coach set them up first.
const pageLoaded = new Promise((resolve) => {
  if (document.readyState === 'complete') resolve();
  else window.addEventListener('load', resolve, { once: true });
});

/**
 * Bootstraps the Drum Coach and attaches it to the global window object
 */
let bootstrapRetries = 0;
async function bootstrap() {
  // Wait for myGrooveWriter to be available
  if (!window.myGrooveWriter) {
    bootstrapRetries++;
    if (bootstrapRetries > BOOTSTRAP_MAX_RETRIES) {
      console.error('[Drum Coach] myGrooveWriter not found after max retries, giving up.');
      return;
    }
    console.warn('[Drum Coach] myGrooveWriter not found, waiting...');
    setTimeout(bootstrap, BOOTSTRAP_RETRY_MS);
    return;
  }

  await pageLoaded;
  const controller = new Controller(window.myGrooveWriter);
  window.coachController = controller;

  await controller.init();

  // Apply DrumMap URL param if present
  const utils = window.myGrooveWriter.myGrooveUtils;
  const drumMapParam = utils.getQueryVariableFromString('DrumMap', '', initialQuery);
  if (drumMapParam) {
    if (drumMapParam === 'custom') {
      const dmParam = utils.getQueryVariableFromString('DM', '', initialQuery);
      if (dmParam) {
        const { decodeDrumMap } = await import('./data/DrumMapUtils.js');
        const { coachState } = await import('./state/State.js');
        coachState.drumMapPreset = 'custom';
        coachState.drumMapCustom = decodeDrumMap(dmParam);
        coachState.drumMapConfigured = true;
        coachState.save();
        controller._applyDrumMapFromState();
      }
    } else {
      const { coachState } = await import('./state/State.js');
      coachState.drumMapPreset = drumMapParam;
      coachState.drumMapConfigured = true;
      coachState.save();
      controller._applyDrumMapFromState();
    }
  }

  // Add a toggle button to the UI
  addCoachToggleButton();

  // Auto-start coach mode if Mode=coach in URL
  const mode = utils.getQueryVariableFromString('Mode', '', initialQuery);
  if (mode === 'coach') {
    try {
      await controller.startSession({ autoPlay: false });
    } catch (e) {
      console.error('[Drum Coach] Auto-start failed:', e);
    }
  }
}

let buttonRetries = 0;
function addCoachToggleButton() {
  // Try multiple possible containers if upperRight is missing or cleared
  const topNav = document.getElementById('upperRight') || document.getElementById('TopNav');
  if (!topNav) {
    buttonRetries++;
    if (buttonRetries > BUTTON_INJECT_MAX_RETRIES) {
      console.error('[Drum Coach] Navigation container not found after max retries, giving up.');
      return;
    }
    console.warn('[Drum Coach] Navigation container not found, retrying button injection...');
    setTimeout(addCoachToggleButton, BUTTON_INJECT_RETRY_MS);
    return;
  }

  if (document.getElementById('coachToggleBtn')) return; // Already added

  const btn = document.createElement('span');
  btn.className = 'rightButtons';
  btn.id = 'coachToggleBtn';
  btn.style.cursor = 'pointer';
  btn.innerHTML = '<i class="fa fa-graduation-cap"></i> Coach';

  btn.onclick = () => {
    const controller = window.coachController;
    if (!controller || controller.isCoachingActive) return; // disabled during coaching
    controller.dialog.show();
  };

  topNav.insertBefore(btn, topNav.firstChild);
}

// Inject CSS
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'coach/css/coach.css';
document.head.appendChild(link);

// Start
bootstrap();
