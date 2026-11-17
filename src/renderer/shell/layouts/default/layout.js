// @ts-check

// The built-in shell chrome look. Every part appends its root to `parent` and
// returns it.

/**
 * `<file>: <message>`.
 * @param {import('../layout').ProblemInput} problem
 */
function problemText(problem) {
  return `${problem.file}: ${problem.message}`;
}

// The status dot leading each tone's toast; an info note carries none.
/** @type {Record<import('../layout').ToastTone, 'success' | 'error' | null>} */
const TOAST_DOTS = {
  success: 'success',
  info: null,
  error: 'error',
};

/** @type {import('../layout').CompleteLayout} */
const layout = {
  // The title then the detail, on one line cut short; the full detail, or the
  // title without one, is the tooltip.
  titleContext(parent, input, kit) {
    const root = kit.el(parent, 'span', 'title-bar-context');
    kit.el(root, 'span', 'title-bar-context-title', input.title);
    const detail = kit.el(
      root,
      'span',
      'title-bar-context-detail',
      input.detail ?? '',
    );
    detail.hidden = input.detail === null;
    root.title = input.detail ?? input.title;
    return root;
  },
  devTag(parent, kit) {
    return kit.tag(parent, 'Dev', 'neutral');
  },
  // One problem reads as itself, more as their count; the tooltip lists each
  // on its own line.
  configProblems(parent, input, kit) {
    const { problems } = input;
    const text =
      problems.length === 1
        ? problemText(problems[0])
        : `${problems.length} config problems`;
    const badge = kit.tag(parent, text, 'error');
    badge.classList.add('config-problem-badge');
    badge.title = problems.map(problemText).join('\n');
    return badge;
  },
  // An icon button that never takes focus, so page keys still drive the page
  // after a click.
  activityItem(parent, input, kit) {
    const item = /** @type {HTMLButtonElement} */ (
      kit.el(parent, 'button', 'activity-item')
    );
    item.type = 'button';
    item.tabIndex = -1;
    item.addEventListener('mousedown', (event) => event.preventDefault());
    kit.icon(item, input.icon);
    item.title = input.title;
    item.setAttribute('aria-label', input.title);
    return item;
  },
  // A glass panel: the tone's dot, if it has one, then the text.
  toast(parent, input, kit) {
    const root = kit.floatingPanel(parent);
    root.classList.add('toast');
    const dot = TOAST_DOTS[input.tone];
    if (dot !== null) {
      kit.statusDot(root, dot);
    }
    kit.el(root, 'span', 'toast-text', input.text);
    return root;
  },
};

export default layout;
