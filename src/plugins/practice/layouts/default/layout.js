// @ts-check

// The built-in Practice look. The list pane's root is `div.practice-pane`,
// and each of the column's panes `div.practice-pane` with its own modifier,
// whose tracks its `layout.css` sets.

/** @type {Record<import('../layout').EmptyReason, (filter: string) => string>} */
const EMPTY_TEXTS = {
  loading: () => 'Loading problems…',
  noProblems: () => 'No problems yet. Ask an agent to add some.',
  filter: (filter) => `No problems match "${filter}".`,
  noSubmissions: () => 'No submissions yet.',
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

/**
 * A pane's header: the previous-tab hint, the tab strip, the next-tab hint.
 * @param {HTMLElement} root
 * @param {import('../layout').TabbedPaneKit} kit
 * @returns {HTMLElement}
 */
function tabsHeader(root, kit) {
  const header = kit.el(root, 'div', 'practice-pane-header');
  kit.keyHint(header, 'prevTab', {
    label: 'previous tab',
    className: 'practice-hint',
  });
  kit.tabs(header);
  kit.keyHint(header, 'nextTab', {
    label: 'next tab',
    className: 'practice-hint',
  });
  return header;
}

/**
 * One labelled value of a case, in a `pre.practice-output`.
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {string} value
 * @param {import('../layout').PracticeKit} kit
 */
function outputBlock(parent, label, value, kit) {
  kit.el(parent, 'div', 'practice-output-label', label);
  kit.el(parent, 'pre', 'practice-output', value);
}

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
  problemPane(parent, kit) {
    const root = kit.el(parent, 'div', 'practice-pane practice-pane--tabbed');
    tabsHeader(root, kit);
    kit.body(root);
    return { element: root };
  },
  editorPane(parent, input, kit) {
    const root = kit.el(parent, 'div', 'practice-pane practice-pane--editor');
    const header = kit.el(root, 'div', 'practice-pane-header');
    kit.el(header, 'span', 'practice-file-name', input.fileName);
    kit.saveState(header);
    kit.editor(root);
    return { element: root };
  },
  consolePane(parent, kit) {
    const root = kit.el(parent, 'div', 'practice-pane practice-pane--tabbed');
    const header = tabsHeader(root, kit);
    kit.actions(header);
    kit.body(root);
    return { element: root };
  },
  descriptionTab(parent, input, kit) {
    const root = kit.el(parent, 'div', 'practice-doc');
    kit.el(root, 'h2', 'practice-doc-title', input.title);
    const marks = kit.el(root, 'div', 'practice-doc-marks');
    const difficulty = DIFFICULTY_TAGS[input.difficulty];
    kit.tag(marks, difficulty.label, difficulty.tone);
    for (const name of [...input.tags, ...input.lists]) {
      kit.tag(marks, name);
    }
    kit.document(root);
    return root;
  },
  submissionRow(parent, input, kit) {
    const verdict = kit.tag(
      parent,
      input.verdictLabel,
      input.verdict === 'accepted' ? 'success' : 'error',
    );
    return kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.time,
      detail: `${String(input.passed)}/${String(input.total)} · ${input.runtime}`,
      trailing: verdict,
    });
  },
  submissionCode(parent, input, kit) {
    const root = kit.el(parent, 'div', 'practice-doc');
    kit.el(
      root,
      'h3',
      'practice-doc-title',
      `${input.time} · ${input.verdictLabel}`,
    );
    kit.document(root);
    return root;
  },
  notesTab(parent, kit) {
    const root = kit.el(parent, 'div', 'practice-box-tab');
    kit.keyHint(root, 'editBox', { label: 'edit', className: 'practice-hint' });
    kit.textBox(root);
    return root;
  },
  solutionTab(parent, _input, kit) {
    const root = kit.el(parent, 'div', 'practice-doc');
    kit.document(root);
    return root;
  },
  testcaseTab(parent, kit) {
    const root = kit.el(parent, 'div', 'practice-box-tab');
    kit.keyHint(root, 'editBox', { label: 'edit', className: 'practice-hint' });
    kit.textBox(root);
    return root;
  },
  resultTab(parent, input, kit) {
    const root = kit.el(parent, 'div', 'practice-result');
    if (input.state === 'empty') {
      kit.emptyState(root, 'Run or submit to see the result.');
      return root;
    }
    if (input.state === 'running') {
      kit.el(root, 'p', 'practice-result-running', 'Running…');
      return root;
    }
    if (input.state === 'failed') {
      kit.el(root, 'pre', 'practice-output', input.message ?? '');
      return root;
    }
    const line = kit.el(root, 'div', 'practice-result-line');
    kit.tag(
      line,
      input.verdictLabel ?? '',
      input.verdict === 'accepted' ? 'success' : 'error',
    );
    kit.el(
      line,
      'span',
      'practice-result-counts',
      `${String(input.passed)}/${String(input.total)} passed`,
    );
    if (input.runtime !== null) {
      kit.el(line, 'span', 'practice-result-runtime', input.runtime);
    }
    if (input.compileOutput !== null) {
      kit.el(root, 'pre', 'practice-output', input.compileOutput);
    }
    if (input.stderr !== null) {
      kit.el(root, 'pre', 'practice-output', input.stderr);
    }
    kit.failingCase(root);
    return root;
  },
  caseResult(parent, input, kit) {
    const root = kit.el(parent, 'div', 'practice-case');
    kit.el(root, 'div', 'practice-case-label', input.label);
    outputBlock(root, 'Input', input.input, kit);
    outputBlock(root, 'Expected', input.expected, kit);
    outputBlock(root, 'Output', input.output, kit);
    if (input.stdout !== '') {
      outputBlock(root, 'Stdout', input.stdout, kit);
    }
    return root;
  },
  confirmBody(parent, input, kit) {
    return kit.el(parent, 'p', '', input.body);
  },
};

export default layout;
