import { tierPercentages } from '../engine/PassScore.js';

/**
 * ScorePanel - The scores under the coach bar while coaching: this pass so far, the last
 * pass, the best pass at this tempo, and, with auto BPM on, what the next tempo needs.
 */
export class ScorePanel {
  constructor() {
    this.container = null;
    this.onRecenter = null; // () => void, when the player asks to re-center on the last pass
  }

  inject() {
    if (document.getElementById('coachScorePanel')) return;
    const sheet = document.getElementById('sheetMusicDiv');
    if (!sheet) throw new Error('[ScorePanel] #sheetMusicDiv not found');

    const panel = document.createElement('div');
    panel.id = 'coachScorePanel';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="coach-score-cols">
        <div class="coach-score-col current"><div class="coach-score-label">This pass</div><div data-score="current"></div></div>
        <div class="coach-score-col"><div class="coach-score-label">Last pass</div><div data-score="last"></div></div>
        <div class="coach-score-col"><div class="coach-score-label">Best at this tempo</div><div data-score="best"></div></div>
      </div>
      <div class="coach-score-goal"></div>
    `;
    sheet.parentElement.insertBefore(panel, sheet);
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-recenter]')) this.onRecenter();
    });
    this.container = panel;
  }

  /** Show the panel, pinned just under the player bar while the page scrolls. */
  show() {
    this.container.style.display = 'block';
    const playerBar = document.getElementById('midiPlayer');
    if (!playerBar) throw new Error('[ScorePanel] #midiPlayer not found');
    this.container.style.top = `${playerBar.getBoundingClientRect().bottom}px`;
    contentArea().classList.add('coach-score-pinned');
  }

  hide() {
    this.container.style.display = 'none';
    contentArea().classList.remove('coach-score-pinned');
  }

  /**
   * @param {Object} view
   * @param {import('../engine/PassScore.js').Score|null} view.current - this pass so far
   * @param {number|null} view.currentOffset - typical timing error this pass so far, ms
   * @param {import('../engine/PassScore.js').Score|null} view.last
   * @param {number|null} view.lastOffset - typical timing error of the last pass, ms
   * @param {boolean} view.lastRecentered - the calibration was re-centered on the last pass
   * @param {import('../engine/PassScore.js').Score|null} view.best
   * @param {Object|null} view.goal - null when auto BPM is off
   * @param {number} view.goal.nextTempo
   * @param {{perfect: boolean, close: boolean, missed: boolean, stray: boolean}|null} view.goal.checks
   *   null until the pass has started
   * @param {import('../engine/PassScore.js').Goal} view.goal.targets
   * @param {import('../engine/PassScore.js').Score|null} view.goal.score - this pass so far
   * @param {number} view.goal.passesDone - passes in a row that met the goal
   * @param {number} view.goal.passesNeeded
   */
  update(view) {
    const offsets = {
      current: offsetHtml(view.currentOffset, ''),
      last: offsetHtml(view.lastOffset, recenterHtml(view.lastOffset, view.lastRecentered)),
      best: '',
    };
    for (const which of ['current', 'last', 'best']) {
      this.container.querySelector(`[data-score="${which}"]`).innerHTML =
        scoreHtml(view[which]) + offsets[which];
    }
    const goalEl = this.container.querySelector('.coach-score-goal');
    goalEl.style.display = view.goal ? 'flex' : 'none';
    if (view.goal) goalEl.innerHTML = goalHtml(view.goal);
  }
}

function scoreHtml(score) {
  if (!score) return '<div class="coach-score-nums"><span class="coach-score-none">–</span></div>';
  const pct = tierPercentages(score);
  const nums = pct
    ? `<span class="perfect">${pct.perfect}%</span><span class="good">${pct.good}%</span><span class="close">${pct.close}%</span>`
    : '<span class="coach-score-none">–</span>';
  return `<div class="coach-score-nums">${nums}</div><div class="coach-score-missed">${score.missed} missed</div>`;
}

/** How early or late a pass was, typically, and what can be done about it. */
function offsetHtml(offsetMs, action) {
  if (offsetMs === null) return '';
  const ms = Math.round(offsetMs);
  let text = 'on time';
  if (ms < 0) text = `${-ms} ms early`;
  if (ms > 0) text = `${ms} ms late`;
  return `<div class="coach-score-offset">${text}${action}</div>`;
}

function recenterHtml(offsetMs, recentered) {
  if (recentered) return ' <span class="coach-score-recentered">re-centered</span>';
  if (Math.round(offsetMs) === 0) return '';
  return ' <button type="button" class="coach-score-recenter" data-recenter>Re-center</button>';
}

function goalHtml(goal) {
  // ok is null before the pass starts: the condition shows without a verdict
  const item = (ok, text) => {
    if (ok === null) return `<span>${text}</span>`;
    return `<span class="${ok ? 'ok' : 'fail'}">${ok ? '✓' : '✗'} ${text}</span>`;
  };
  const checks = goal.checks;
  const score = goal.score;
  const passes =
    goal.passesNeeded > 1
      ? `<span class="coach-score-passes">pass ${goal.passesDone + 1} of ${goal.passesNeeded}</span>`
      : '';
  return (
    `<span class="coach-score-next">Next: ${goal.nextTempo} bpm</span>` +
    passes +
    item(checks && checks.perfect, `blue ${goal.targets.minPerfectPercent}%+`) +
    item(checks && checks.close, `yellow ${goal.targets.maxClosePercent}% or less`) +
    item(
      checks && checks.missed,
      checks
        ? `${score.missed} missed (${goal.targets.maxMissedPercent}% max)`
        : `missed ${goal.targets.maxMissedPercent}% or less`
    ) +
    item(
      checks && checks.stray,
      checks
        ? `${score.stray} stray (${goal.targets.maxStrayPercent}% max)`
        : `stray ${goal.targets.maxStrayPercent}% or less`
    )
  );
}

/** The page area the panel and the sheet music sit in. */
function contentArea() {
  const area = document.getElementById('RightHandContent');
  if (!area) throw new Error('[ScorePanel] #RightHandContent not found');
  return area;
}
