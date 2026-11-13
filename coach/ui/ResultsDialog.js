import { tierPercentages } from '../engine/PassScore.js';

const VERDICT_LABELS = {
  clean: 'Clean',
  solid: 'Solid',
  'keep-at-it': 'Keep at it',
};

/**
 * ResultsDialog - Shows session results after performance mode
 */
export class ResultsDialog {
  constructor() {
    this.container = null;
  }

  inject() {
    if (document.getElementById('coachResultsDialog')) return;

    const dialog = document.createElement('div');
    dialog.id = 'coachResultsDialog';
    dialog.className = 'coach-sheet';
    dialog.innerHTML = `
      <h2 id="result-verdict"></h2>
      <div class="coach-results-grid">
        <div class="coach-result-tile perfect">
          <div class="coach-result-value" id="result-perfect">–</div>
          <div class="coach-result-label">Perfect</div>
        </div>
        <div class="coach-result-tile good">
          <div class="coach-result-value" id="result-good">–</div>
          <div class="coach-result-label">Good</div>
        </div>
        <div class="coach-result-tile close">
          <div class="coach-result-value" id="result-close">–</div>
          <div class="coach-result-label">Close</div>
        </div>
        <div class="coach-result-tile miss">
          <div class="coach-result-value" id="result-missed">0</div>
          <div class="coach-result-label">Missed</div>
        </div>
        <div class="coach-result-tile stray">
          <div class="coach-result-value" id="result-stray">0</div>
          <div class="coach-result-label">Stray</div>
        </div>
      </div>
      <div class="coach-results-summary">
        <div class="coach-score-row">
          <span>Passes</span>
          <span id="result-passes">0</span>
        </div>
      </div>
      <div class="coach-dialog-buttons">
        <button class="coach-btn coach-btn-secondary" id="results-close-btn">Close</button>
        <button class="coach-btn coach-btn-primary" id="results-retry-btn">Play Again</button>
      </div>
    `;

    document.body.appendChild(dialog);
    this.container = dialog;
    this._setupEventListeners();
  }

  _setupEventListeners() {
    const closeBtn = this.container.querySelector('#results-close-btn');
    const retryBtn = this.container.querySelector('#results-retry-btn');

    closeBtn.addEventListener('click', () => this.hide());
    retryBtn.addEventListener('click', () => {
      this.hide();
      window.dispatchEvent(new CustomEvent('coach-start-requested'));
    });
  }

  /**
   * Show how the session went, over all its passes.
   * @param {import('../engine/PassScore.js').Score} totals - every pass together
   * @param {number} passes - passes played to the end
   * @param {'clean'|'solid'|'keep-at-it'} verdictKey
   */
  show(totals, passes, verdictKey) {
    const q = (id) => this.container.querySelector(id);
    q('#result-verdict').textContent = VERDICT_LABELS[verdictKey];
    const pct = tierPercentages(totals);
    q('#result-perfect').textContent = pct ? `${pct.perfect}%` : '–';
    q('#result-good').textContent = pct ? `${pct.good}%` : '–';
    q('#result-close').textContent = pct ? `${pct.close}%` : '–';
    q('#result-missed').textContent = totals.missed;
    q('#result-stray').textContent = totals.stray;
    q('#result-passes').textContent = passes;
    this.container.style.display = 'block';
  }

  hide() {
    this.container.style.display = 'none';
  }
}
