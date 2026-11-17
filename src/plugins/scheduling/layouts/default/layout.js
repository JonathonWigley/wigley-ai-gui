// @ts-check

// The built-in Schedules look. The list pane's root is `div.scheduling-pane`, the details pane's
// `div.scheduling-pane scheduling-pane--detail`, and the editor's `div.scheduling-editor-pane`, whose tracks its
// `layout.css` sets.

/** @type {Record<import('../layout').EmptyInput['reason'], string>} */
const EMPTY_TEXTS = {
  noTasks: 'No scheduled tasks.',
  newTask: 'Make a new scheduled task.',
};

/** @type {Record<import('../layout').NoticeInput['tone'], import('../../../../shared/page/layout-host/kit').TagTone>} */
const NOTICE_TONES = {
  neutral: 'neutral',
  warning: 'warning',
  error: 'error',
};

/**
 * One label and value pair of the task's details.
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {string} value
 * @param {import('../layout').SchedulingKit} kit
 */
function detailRow(parent, label, value, kit) {
  const row = kit.el(parent, 'div', 'scheduling-detail-row');
  kit.el(row, 'span', 'scheduling-detail-label', label);
  kit.el(row, 'span', 'scheduling-detail-value', value);
  return row;
}

/** @type {import('../layout').CompleteSchedulingLayout} */
const layout = {
  list(parent, kit) {
    const root = kit.el(parent, 'div', 'scheduling-pane');
    kit.rows(root);
    return { element: root };
  },
  detail(parent, kit) {
    const root = kit.el(
      parent,
      'div',
      'scheduling-pane scheduling-pane--detail',
    );
    kit.notices(root);
    kit.body(root);
    kit.history(root);
    kit.editor(root);
    return { element: root };
  },
  editor(parent, input, kit) {
    const root = kit.el(parent, 'div', 'scheduling-editor-pane');
    const header = kit.el(root, 'div', 'scheduling-editor-header');
    kit.el(header, 'h2', 'scheduling-heading', input.heading);
    const keys = kit.el(header, 'span', 'scheduling-editor-keys');
    kit.keyHint(keys, 'save', { label: 'save', className: 'scheduling-hint' });
    kit.keyHint(keys, 'cancelEdit', {
      label: 'cancel',
      className: 'scheduling-hint',
    });
    kit.fields(root);
    if (input.problem !== null) {
      kit.el(root, 'p', 'scheduling-problem', input.problem);
    }
    kit.el(root, 'p', 'scheduling-env-note', input.envNote);
    return { element: root };
  },
  newTaskRow(parent, kit) {
    const actions = kit.el(parent, 'span', 'scheduling-row-end');
    kit.cursorActions(actions);
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: '+ New task',
      trailing: actions,
    });
    row.classList.add('scheduling-new-row');
    return row;
  },
  taskRow(parent, input, kit) {
    const end = kit.el(parent, 'span', 'scheduling-row-end');
    if (input.paused) {
      kit.tag(end, 'Paused');
    }
    kit.cursorActions(end);
    const detail = input.paused
      ? input.scheduleText
      : [input.scheduleText, input.next]
          .filter((part) => part !== '')
          .join(' · ');
    return kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.name,
      detail,
      trailing: end,
    });
  },
  empty(parent, input, kit) {
    const hint = kit.el(parent, 'span', 'scheduling-empty-hint');
    kit.keyHint(hint, 'newTask', { label: 'new task' });
    return kit.emptyState(parent, EMPTY_TEXTS[input.reason], hint);
  },
  notice(parent, input, kit) {
    const card = kit.card(
      parent,
      `scheduling-notice scheduling-notice--${NOTICE_TONES[input.tone]}`,
    );
    kit.el(card, 'span', 'scheduling-notice-text', input.text);
    return card;
  },
  taskDetail(parent, input, kit) {
    const root = kit.el(parent, 'div', 'scheduling-detail');
    const title = kit.el(root, 'div', 'scheduling-detail-title');
    kit.el(title, 'h2', 'scheduling-heading', input.name);
    if (input.paused) {
      kit.tag(title, 'Paused');
    }
    const rows = kit.el(root, 'div', 'scheduling-detail-rows');
    detailRow(rows, 'Project', input.project, kit);
    detailRow(rows, 'Profile', input.profile, kit);
    detailRow(rows, 'Schedule', input.scheduleText, kit);
    detailRow(rows, 'Next run', input.next, kit);
    for (const control of input.controls) {
      detailRow(rows, control.label, control.value, kit);
    }
    const prompt = kit.el(rows, 'div', 'scheduling-detail-row');
    kit.el(prompt, 'span', 'scheduling-detail-label', 'Prompt');
    kit.el(prompt, 'pre', 'scheduling-prompt', input.prompt);
    const buttons = kit.el(root, 'div', 'scheduling-buttons');
    kit.editButton(buttons);
    kit.pauseButton(buttons);
    kit.runNowButton(buttons);
    kit.removeButton(buttons);
    return root;
  },
  historyRow(parent, input, kit) {
    const end = kit.el(parent, 'span', 'scheduling-row-end');
    kit.cursorActions(end);
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.when,
      detail: input.text,
      trailing: end,
    });
    row.classList.add('scheduling-run', `scheduling-run--${input.outcome}`);
    row.classList.toggle('is-linked', input.linked);
    return row;
  },
  fieldRow(parent, input, kit) {
    const root = kit.el(
      parent,
      'li',
      `scheduling-field scheduling-field--${input.kind}`,
    );
    kit.el(root, 'span', 'scheduling-field-label', input.label);
    const value = kit.el(root, 'div', 'scheduling-field-value');
    if (input.kind === 'choice') {
      const choice = kit.el(value, 'div', 'ui-input scheduling-choice');
      kit.el(choice, 'span', 'scheduling-choice-text', input.value);
      kit.icon(choice, 'chevron-down', 'scheduling-choice-icon');
    } else {
      kit.textBox(value);
    }
    if (input.hint !== null) {
      kit.el(value, 'span', 'scheduling-field-hint', input.hint);
    }
    return root;
  },
  pickerRow(parent, input, kit) {
    return kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.label,
      trailing: kit.trailing(),
    });
  },
  confirmBody(parent, input, kit) {
    return kit.el(parent, 'p', '', input.body);
  },
  dialogFrame(parent, input, kit) {
    const panel = kit.el(
      parent,
      'div',
      'ui-floating material-floating ui-dialog',
    );
    kit.el(panel, 'h2', 'ui-dialog-title', input.title);
    const body = kit.el(panel, 'div', 'ui-dialog-body');
    const actions = input.hasActions
      ? kit.el(panel, 'div', 'ui-dialog-actions')
      : null;
    return { element: panel, body, actions };
  },
};

export default layout;
