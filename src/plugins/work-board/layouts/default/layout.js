// @ts-check

// The built-in Board look. The pane's root is `div.work-board-pane`: a head (title, the status line, the sweep hint),
// then one row of columns that scrolls sideways, each column scrolling its own cards.

/**
 * The cursor card's key hint for `command`, inside `parent`, when the card's prompt holds it.
 * @param {HTMLElement} parent
 * @param {import('../layout').CardInput} input
 * @param {string} command
 * @param {import('../layout').BoardKit} kit
 */
function controlHint(parent, input, command, kit) {
  if (input.prompt.some((action) => action.command === command)) {
    kit.keyHint(parent, command, { className: 'work-board-control-hint' });
  }
}

/**
 * A move button: ◀ or ▶, disabled while the card lacks `action`.
 * @param {HTMLElement} parent
 * @param {import('../layout').CardInput} input
 * @param {'moveLeft' | 'moveRight'} action
 * @param {import('../layout').BoardKit} kit
 */
function moveButton(parent, input, action, kit) {
  const isLeft = action === 'moveLeft';
  const column = isLeft ? input.prev : input.next;
  const button = kit.button(
    parent,
    isLeft ? '◀' : '▶',
    'work-board.moveCardTo',
    { arg: { cardId: input.id, column: column ?? '' }, variant: 'ghost' },
  );
  button.disabled = !input.actions.includes(action);
  controlHint(button, input, `work-board.${action}`, kit);
  return button;
}

/**
 * The card's head: a Jira card's key as a link and its priority, or a local task's Tag; then the title.
 * @param {HTMLElement} parent
 * @param {import('../layout').CardInput} input
 * @param {import('../layout').BoardKit} kit
 */
function cardHead(parent, input, kit) {
  const head = kit.el(parent, 'div', 'work-board-card-head');
  if (input.kind === 'jira' && input.key !== null) {
    if (input.url !== null) {
      const link = kit.button(head, input.key, 'core.openLink', {
        arg: input.url,
        variant: 'ghost',
      });
      link.classList.add('work-board-card-key');
    } else {
      kit.el(head, 'span', 'work-board-card-key', input.key);
    }
    if (input.priority !== null) {
      kit.tag(head, input.priority);
    }
  } else {
    kit.tag(head, 'Local task');
  }
  kit.el(head, 'span', 'work-board-card-title', input.title);
  return head;
}

/**
 * The suggestion block: a waiting move's reason with Accept and Not yet, or a done one's Tag and reason.
 * @param {HTMLElement} parent
 * @param {import('../layout').CardInput} input
 * @param {import('../layout').BoardKit} kit
 */
function suggestionBlock(parent, input, kit) {
  const { suggestion } = input;
  if (suggestion === null) {
    return;
  }
  const block = kit.el(parent, 'div', 'work-board-suggestion');
  if (suggestion.isDone) {
    kit.tag(block, 'done', 'success');
    kit.el(block, 'span', 'work-board-suggestion-reason', suggestion.reason);
    return;
  }
  kit.el(block, 'span', 'work-board-suggestion-reason', suggestion.reason);
  const buttons = kit.el(block, 'div', 'work-board-suggestion-actions');
  if (input.actions.includes('accept')) {
    const accept = kit.button(buttons, 'Accept', 'work-board.acceptCard', {
      arg: input.id,
      variant: 'primary',
    });
    controlHint(accept, input, 'work-board.accept', kit);
  }
  if (input.actions.includes('notYet')) {
    const notYet = kit.button(buttons, 'Not yet', 'work-board.notYetCard', {
      arg: input.id,
      variant: 'secondary',
    });
    controlHint(notYet, input, 'work-board.notYet', kit);
  }
}

/** @type {import('../layout').CompleteBoardLayout} */
const layout = {
  board(parent, kit) {
    const root = kit.el(parent, 'div', 'work-board-pane');
    const head = kit.el(root, 'div', 'work-board-head');
    kit.el(head, 'h2', 'work-board-title', 'Board');
    kit.status(head);
    kit.keyHint(head, 'sweep', {
      label: 'sweep',
      className: 'work-board-box-hint',
    });
    kit.columns(root);
    return { element: root };
  },
  status(parent, input, kit) {
    const line = kit.el(parent, 'div', 'work-board-status');
    kit.statusDot(line, input.tone);
    kit.el(line, 'span', 'work-board-status-text', input.text);
    if (input.hasRow) {
      const button = kit.button(
        line,
        'Show transcript',
        'work-board.showJobRow',
        {
          variant: 'ghost',
        },
      );
      kit.keyHint(button, 'showJobRow', {
        className: 'work-board-control-hint',
      });
    }
    return line;
  },
  column(parent, input, kit) {
    const root = kit.el(parent, 'section', 'work-board-column');
    const head = kit.el(root, 'div', 'work-board-column-head');
    kit.el(head, 'span', 'work-board-column-name', input.name);
    kit.el(head, 'span', 'work-board-count', String(input.count));
    kit.cards(root);
    return root;
  },
  card(parent, input, kit) {
    const root = kit.el(parent, 'li', 'ui-card work-board-card');
    cardHead(root, input, kit);
    if (input.threads > 0 && input.ticketKey !== null) {
      const chip = kit.button(
        root,
        input.threads === 1 ? '1 thread' : `${input.threads} threads`,
        'work-board.openThreads',
        { arg: input.ticketKey, variant: 'secondary' },
      );
      chip.classList.add('work-board-thread-chip');
      controlHint(chip, input, 'work-board.threads', kit);
    }
    suggestionBlock(root, input, kit);
    if (input.movingTo !== null) {
      kit.el(
        root,
        'p',
        'work-board-moving',
        `Moving to ${input.movingTo} in Jira…`,
      );
    }
    if (input.note !== null) {
      kit.el(root, 'p', 'work-board-note', input.note);
    }
    const actions = kit.el(root, 'div', 'work-board-card-actions');
    moveButton(actions, input, 'moveLeft', kit);
    moveButton(actions, input, 'moveRight', kit);
    const session = kit.button(
      actions,
      'Session',
      'work-board.startCardSession',
      {
        arg: input.id,
        variant: 'secondary',
      },
    );
    controlHint(session, input, 'work-board.startSession', kit);
    if (input.actions.includes('deleteTask')) {
      const remove = kit.button(actions, 'Delete', 'work-board.deleteCard', {
        arg: input.id,
        variant: 'danger',
      });
      controlHint(remove, input, 'work-board.deleteTask', kit);
    }
    return root;
  },
  empty(parent, kit) {
    const root = kit.el(parent, 'div', 'work-board-empty');
    const hint = kit.el(root, 'span', 'work-board-empty-hint');
    kit.keyHint(hint, 'sweep', { label: 'sweep' });
    kit.emptyState(
      root,
      'Nothing on the Board yet: sweep Slack and Jira',
      hint,
    );
    return root;
  },
};

export default layout;
