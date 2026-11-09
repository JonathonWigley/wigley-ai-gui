// @ts-check

// The built-in Practice look. The list pane's root is `div.practice-pane`,
// whose tracks its `layout.css` sets.

/** @type {Record<import('../layout').EmptyReason, (filter: string) => string>} */
const EMPTY_TEXTS = {
  loading: () => 'Loading problems…',
  noProblems: () => 'No problems yet. Ask an agent to add some.',
  filter: (filter) => `No problems match "${filter}".`,
};

/** @type {Record<import('../layout').ProblemRowInput['status'], string>} */
const STATUS_ICONS = {
  solved: 'pass-filled',
  attempted: 'circle-large-outline',
  new: 'circle-small',
};

/**
 * @type {Record<import('../layout').ProblemRowInput['difficulty'], { label: string, tone: import('../../../../shared/page/layout-host/kit').TagTone }>}
 */
const DIFFICULTY_TAGS = {
  easy: { label: 'Easy', tone: 'success' },
  medium: { label: 'Medium', tone: 'warning' },
  hard: { label: 'Hard', tone: 'error' },
};

/** @type {import('../layout').CompletePracticeLayout} */
const layout = {
  list(parent, kit) {
    const root = kit.el(parent, 'div', 'practice-pane');
    const header = kit.el(root, 'div', 'practice-list-header');
    kit.header(header);
    const keys = kit.el(header, 'span', 'practice-list-keys');
    kit.keyHint(keys, 'filter', {
      label: 'filter',
      className: 'practice-hint',
    });
    kit.importHint(keys);
    kit.filterBox(root);
    kit.rows(root);
    return { element: root };
  },
  listHeader(parent, input, kit) {
    const counts = kit.el(parent, 'div', 'practice-counts');
    for (const count of input.counts) {
      kit.el(
        counts,
        'span',
        `practice-count practice-count--${count.difficulty}`,
        `${count.label} ${String(count.solved)}/${String(count.total)}`,
      );
    }
    return counts;
  },
  problemRow(parent, input, kit) {
    const status = kit.icon(
      parent,
      STATUS_ICONS[input.status],
      `practice-status practice-status--${input.status}`,
    );
    const marks = kit.el(parent, 'span', 'practice-row-marks');
    if (input.isDue) {
      kit.tag(marks, 'due', 'attention');
    }
    const difficulty = DIFFICULTY_TAGS[input.difficulty];
    kit.tag(marks, difficulty.label, difficulty.tone);
    return kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.title,
      leading: status,
      trailing: marks,
    });
  },
  empty(parent, input, kit) {
    return kit.emptyState(parent, EMPTY_TEXTS[input.reason](input.filter));
  },
  noProblem(parent, kit) {
    return kit.emptyState(parent, 'Open a problem from the list.');
  },
};

export default layout;
