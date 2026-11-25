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

/**
 * An activity bar button labelled and titled `label` that never takes focus,
 * so page keys still drive the page after a click.
 * @param {HTMLElement} parent
 * @param {string} className
 * @param {string} label
 * @param {import('../layout').ShellKit} kit
 */
function barButton(parent, className, label, kit) {
  const button = /** @type {HTMLButtonElement} */ (
    kit.el(parent, 'button', className)
  );
  button.type = 'button';
  button.tabIndex = -1;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

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
  // The icon in its column, a dot on it while the mode has a count, then the
  // title, the count and the show command's key, which the CSS shows only
  // while the bar is expanded.
  activityItem(parent, input, kit) {
    const item = barButton(parent, 'activity-item', input.title, kit);
    const icon = kit.el(item, 'span', 'activity-item-icon');
    kit.icon(icon, input.icon);
    if (input.count !== null) {
      kit.el(icon, 'span', 'activity-item-dot');
    }
    kit.el(item, 'span', 'activity-item-title', input.title);
    if (input.count !== null) {
      kit.el(item, 'span', 'activity-item-count', String(input.count));
    }
    if (input.showCommand !== null) {
      kit.keyHint(item, input.showCommand, { className: 'activity-item-key' });
    }
    return item;
  },
  // A hairline across the bar's width.
  activityDivider(parent, kit) {
    const divider = kit.el(parent, 'div', 'activity-divider');
    divider.setAttribute('role', 'separator');
    return divider;
  },
  // Laid out as an item: the pin in the icon column, then its label and key.
  activityPin(parent, input, kit) {
    const togglePin = kit.command('activityBar.togglePin');
    const label = input.pinned ? 'Unpin' : 'Pin open';
    const pin = barButton(parent, 'activity-item activity-pin', label, kit);
    const icon = kit.el(pin, 'span', 'activity-item-icon');
    kit.icon(icon, input.pinned ? 'pinned' : 'pin');
    kit.el(pin, 'span', 'activity-item-title', label);
    kit.keyHint(pin, 'activityBar.togglePin', {
      className: 'activity-item-key',
    });
    pin.addEventListener('click', () => togglePin());
    return pin;
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
