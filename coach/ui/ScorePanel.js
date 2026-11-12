import { tierPercentages } from '../engine/PassScore.js';

/**
 * ScorePanel - The scores under the coach bar while coaching: this pass so far, the last
 * pass, the best pass at this tempo, and, with auto BPM on, what the next tempo needs.
 */
export class ScorePanel {
  constructor() {
    this.container = null;
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
    this.container = panel;
  }

  show() {
    this.container.style.display = 'block';
  }

  hide() {
    this.container.style.display = 'none';
  }

  /**
   * @param {Object} view
   * @param {import('../engine/PassScore.js').Score|null} view.current - this pass so far
   * @param {import('../engine/PassScore.js').Score|null} view.last
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
    for (const which of ['current', 'last', 'best']) {
      this.container.querySelector(`[data-score="${which}"]`).innerHTML = scoreHtml(view[which]);
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
      checks && !checks.missed ? `${score.missed} missed` : 'none missed'
    ) +
    item(checks && checks.stray, checks && !checks.stray ? strayText(score.stray) : 'no stray hits')
  );
}

function strayText(count) {
  return count === 1 ? '1 stray hit' : `${count} stray hits`;
}
