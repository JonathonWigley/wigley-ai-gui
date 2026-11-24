// @ts-check

// The built-in Board look. The pane's root is `div.work-board-pane`: a head (title, the status line and any load
// problem, the sweep hint), then one row of columns that scrolls sideways, each column scrolling its own cards. The
// detail pane's root is `div.work-board-detail-pane`: the card's head, then a ticket's fields, text, threads and
// comment box, or a task's source thread and reply box.

const MISSING_DETAIL = 'No detail yet: the next sweep fetches it.';

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

/**
 * The missing-detail line, with the sweep hint.
 * @param {HTMLElement} parent
 * @param {import('../layout').BoardKit} kit
 */
function missingDetail(parent, kit) {
  const line = kit.el(parent, 'p', 'work-board-detail-missing', MISSING_DETAIL);
  kit.keyHint(line, 'sweep', { label: 'sweep' });
}

/**
 * One message: its author and age, then its markdown.
 * @param {HTMLElement} parent
 * @param {import('../layout').DetailMessageInput} message
 * @param {import('../layout').BoardKit} kit
 */
function messageBlock(parent, message, kit) {
  const root = kit.el(parent, 'div', 'work-board-detail-message');
  const head = kit.el(root, 'div', 'work-board-detail-message-head');
  kit.el(head, 'span', 'work-board-detail-author', message.author);
  kit.el(head, 'span', 'work-board-detail-age', message.age);
  kit.markdown(root, message.text, 'work-board-detail-text md');
}

/**
 * A ticket's label and value rows, a null field left out.
 * @param {HTMLElement} parent
 * @param {import('../layout').TicketDetailInput} detail
 * @param {import('../layout').BoardKit} kit
 */
function fieldRows(parent, detail, kit) {
  const rows = kit.el(parent, 'dl', 'work-board-detail-fields');
  /** @type {[string, string | null][]} */
  const fields = [
    ['Type', detail.type],
    ['Priority', detail.priority],
    ['Status', detail.status],
    ['Assignee', detail.assignee],
    ['Reporter', detail.reporter],
    ['Updated', detail.updated],
  ];
  for (const [label, value] of fields) {
    if (value !== null) {
      kit.el(rows, 'dt', 'work-board-detail-label', label);
      kit.el(rows, 'dd', 'work-board-detail-value', value);
    }
  }
}

/**
 * Subtasks or linked issues under `header`, only while there are any: each key opens the issue.
 * @param {HTMLElement} parent
 * @param {string} header
 * @param {import('../layout').DetailIssueInput[]} issues
 * @param {import('../layout').BoardKit} kit
 */
function issueRows(parent, header, issues, kit) {
  if (issues.length === 0) {
    return;
  }
  kit.sectionHeader(parent, header);
  const list = kit.el(parent, 'div', 'work-board-detail-issues');
  for (const issue of issues) {
    const row = kit.el(list, 'div', 'work-board-detail-issue');
    const key = kit.button(row, issue.key, 'core.openLink', {
      arg: issue.url,
      variant: 'ghost',
    });
    key.classList.add('work-board-card-key');
    if (issue.relation !== null) {
      kit.el(row, 'span', 'work-board-detail-relation', issue.relation);
    }
    kit.el(row, 'span', 'work-board-detail-issue-title', issue.title);
    kit.tag(row, issue.status);
  }
}

/**
 * A ticket's stored detail: fields, description, comments, subtasks and links.
 * @param {HTMLElement} parent
 * @param {import('../layout').TicketDetailInput} detail
 * @param {import('../layout').BoardKit} kit
 */
function ticketDetail(parent, detail, kit) {
  fieldRows(parent, detail, kit);
  kit.sectionHeader(parent, 'Description');
  if (detail.description === '') {
    kit.el(parent, 'p', 'work-board-detail-none', 'No description.');
  } else {
    kit.markdown(parent, detail.description, 'work-board-detail-text md');
  }
  kit.sectionHeader(parent, 'Comments');
  if (detail.comments.length === 0) {
    kit.el(parent, 'p', 'work-board-detail-none', 'No comments yet.');
  }
  for (const comment of detail.comments) {
    messageBlock(parent, comment, kit);
  }
  issueRows(parent, 'Subtasks', detail.subtasks, kit);
  issueRows(parent, 'Linked issues', detail.links, kit);
}

/**
 * The open Inbox threads naming the ticket, only while there are any.
 * @param {HTMLElement} parent
 * @param {import('../layout').DetailThreadInput[]} threads
 * @param {import('../layout').BoardKit} kit
 */
function threadRows(parent, threads, kit) {
  if (threads.length === 0) {
    return;
  }
  const header = kit.sectionHeader(parent, 'Threads');
  kit.keyHint(header, 'threads', { className: 'work-board-control-hint' });
  for (const thread of threads) {
    const root = kit.el(parent, 'div', 'work-board-detail-thread');
    kit.el(root, 'span', 'work-board-detail-channel', thread.channel);
    kit.el(root, 'p', 'work-board-detail-summary', thread.summary);
    kit.el(root, 'p', 'work-board-detail-latest', thread.latest);
  }
}

/**
 * The pane's head: a ticket's key or a task's Tag, the title, the open hint while the card has a link, then when the
 * detail was fetched.
 * @param {HTMLElement} parent
 * @param {import('../layout').DetailInput} input
 * @param {import('../layout').BoardKit} kit
 */
function detailHead(parent, input, kit) {
  const head = kit.el(parent, 'div', 'work-board-detail-head');
  const title = kit.el(head, 'div', 'work-board-detail-title-line');
  if (input.kind === 'ticket') {
    kit.el(title, 'span', 'work-board-card-key', input.key);
  } else {
    kit.tag(title, 'Local task');
  }
  kit.el(title, 'span', 'work-board-detail-title', input.title);
  if (input.url !== null) {
    kit.keyHint(head, 'openCard', {
      label: input.kind === 'ticket' ? 'open in Jira' : 'open in Slack',
      className: 'work-board-box-hint',
    });
  }
  if (input.fetched !== null) {
    kit.el(head, 'p', 'work-board-detail-fetched', input.fetched);
  }
}

/**
 * The last failed job's note, when there is one.
 * @param {HTMLElement} parent
 * @param {string | null} note
 * @param {import('../layout').BoardKit} kit
 */
function noteLine(parent, note, kit) {
  if (note !== null) {
    kit.el(parent, 'p', 'work-board-note', note);
  }
}

/**
 * A Jira card's pane body.
 * @param {HTMLElement} root
 * @param {import('../layout').TicketPaneInput} input
 * @param {import('../layout').DetailKit} kit
 */
function ticketPane(root, input, kit) {
  if (input.detail === null) {
    missingDetail(root, kit);
  } else {
    ticketDetail(root, input.detail, kit);
  }
  threadRows(root, input.threads, kit);
  kit.sectionHeader(root, 'Comment');
  kit.box(root);
  for (const text of input.posting) {
    const block = kit.el(root, 'div', 'work-board-detail-posting');
    kit.el(block, 'p', 'work-board-posting', 'Posting…');
    kit.markdown(block, text, 'work-board-detail-text md');
  }
  noteLine(root, input.note, kit);
}

/**
 * The thread a local task came from: channel, participants and ticket keys, then the summary.
 * @param {HTMLElement} parent
 * @param {import('../layout').DetailSourceInput} source
 * @param {import('../layout').BoardKit} kit
 */
function sourceBlock(parent, source, kit) {
  const root = kit.el(parent, 'div', 'work-board-detail-source');
  const meta = kit.el(root, 'div', 'work-board-detail-source-meta');
  kit.el(meta, 'span', 'work-board-detail-channel', source.channel);
  if (source.participants.length > 0) {
    kit.el(
      meta,
      'span',
      'work-board-detail-participants',
      source.participants.join(', '),
    );
  }
  for (const key of source.ticketKeys) {
    kit.button(meta, key, 'work-board.showTicket', {
      arg: key,
      variant: 'secondary',
    });
  }
  kit.el(root, 'p', 'work-board-detail-summary', source.summary);
}

/**
 * A local task's pane body.
 * @param {HTMLElement} root
 * @param {import('../layout').TaskPaneInput} input
 * @param {import('../layout').DetailKit} kit
 */
function taskPane(root, input, kit) {
  const { source, detail } = input;
  if (source === null && detail === null) {
    kit.el(
      root,
      'p',
      'work-board-detail-missing',
      input.hasThread
        ? 'Its Slack thread is no longer in the Inbox.'
        : 'This task has no Slack thread.',
    );
  } else {
    if (source !== null) {
      sourceBlock(root, source, kit);
    }
    kit.sectionHeader(root, 'Thread');
    if (detail === null) {
      missingDetail(root, kit);
    } else {
      messageBlock(root, detail.root, kit);
      if (detail.hidden > 0) {
        kit.el(
          root,
          'p',
          'work-board-detail-hidden',
          detail.hidden === 1
            ? '1 earlier reply in Slack'
            : `${detail.hidden} earlier replies in Slack`,
        );
      }
      for (const reply of detail.replies) {
        messageBlock(root, reply, kit);
      }
    }
  }
  if (input.box !== null) {
    kit.sectionHeader(root, 'Reply');
    kit.box(root);
  } else {
    kit.el(
      root,
      'p',
      'work-board-detail-none',
      'No reply from here: the thread is not open in the Inbox.',
    );
  }
  noteLine(root, input.note, kit);
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
  problem(parent, input, kit) {
    return kit.el(parent, 'p', 'work-board-problem', input.text);
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
    if (input.isPosting) {
      kit.el(root, 'p', 'work-board-posting', 'Posting…');
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
  detail(parent, input, kit) {
    const root = kit.el(parent, 'div', 'work-board-detail-pane');
    detailHead(root, input, kit);
    if (input.kind === 'ticket') {
      ticketPane(root, input, kit);
    } else {
      taskPane(root, input, kit);
    }
    return root;
  },
  detailEmpty(parent, kit) {
    return kit.el(parent, 'p', 'work-board-detail-empty', 'No card selected.');
  },
};

export default layout;
