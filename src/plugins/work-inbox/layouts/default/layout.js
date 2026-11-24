// @ts-check

// The built-in Inbox look. The side bar's root is `div.work-inbox-side-pane`, the sheet's `div.work-inbox-pane`: a
// head (title, the filter chip, the sweep hint, then the status line), then the cards, which scroll. The detail pane's
// root is `div.work-inbox-detail-pane`: the thread's head, its people, tickets, summary and why, the thread, the reply
// box, then the buttons.

const MISSING_THREAD = 'No thread detail yet: the next sweep fetches it.';

/** @type {Record<import('../layout').InboxCardAction, string>} */
const ACTION_LABELS = {
  send: 'Send',
  snooze: 'Snooze 1 day',
  dismiss: 'Dismiss',
  restore: 'Restore',
  startSession: 'Start session',
  addToBoard: 'Add to Board',
};

/** @type {Record<import('../layout').InboxCardAction, string>} */
const ACTION_COMMANDS = {
  send: 'work-inbox.sendItem',
  snooze: 'work-inbox.snoozeItem',
  dismiss: 'work-inbox.dismissItem',
  restore: 'work-inbox.restoreItem',
  startSession: 'work-inbox.startItemSession',
  addToBoard: 'work-inbox.addItemToBoard',
};

/** @type {Record<import('../layout').InboxCardAction, import('../../../../shared/page/layout-host/kit').ButtonVariant>} */
const ACTION_VARIANTS = {
  send: 'primary',
  snooze: 'secondary',
  dismiss: 'ghost',
  restore: 'secondary',
  startSession: 'secondary',
  addToBoard: 'secondary',
};

/**
 * The meta line a card and the detail head share: `channel · author`, the section and state Tags, a `sending` Tag,
 * then the age at the end.
 * @param {HTMLElement} parent
 * @param {{ channel: string, author: string, sectionTitle: string | null, stateTag: string | null, isSending: boolean, age: string }} input
 * @param {import('../layout').InboxKit} kit
 */
function metaLine(parent, input, kit) {
  const meta = kit.el(parent, 'div', 'work-inbox-card-meta');
  kit.el(
    meta,
    'span',
    'work-inbox-card-source',
    `${input.channel} · ${input.author}`,
  );
  if (input.sectionTitle !== null) {
    kit.tag(meta, input.sectionTitle);
  }
  if (input.stateTag !== null) {
    kit.tag(meta, input.stateTag);
  }
  if (input.isSending) {
    kit.tag(meta, 'sending');
  }
  kit.el(meta, 'span', 'work-inbox-card-age', input.age);
  return meta;
}

/**
 * The detail pane's buttons: Open in Slack, then its actions in order.
 * @param {HTMLElement} parent
 * @param {import('../layout').DetailInput} input
 * @param {import('../layout').DetailKit} kit
 */
function detailButtons(parent, input, kit) {
  const row = kit.el(parent, 'div', 'work-inbox-detail-actions');
  const slack = kit.button(row, 'Open in Slack', 'core.openLink', {
    arg: input.url,
    variant: 'ghost',
  });
  kit.keyHint(slack, 'openSlack', { className: 'work-inbox-control-hint' });
  for (const action of input.actions) {
    const isSend = action === 'send';
    const label =
      isSend && input.isSending ? 'Sending…' : ACTION_LABELS[action];
    const button = kit.button(row, label, ACTION_COMMANDS[action], {
      arg: input.id,
      variant: ACTION_VARIANTS[action],
    });
    if (isSend) {
      button.disabled = input.isSending;
      kit.keyHint(button, 'send', { className: 'work-inbox-control-hint' });
    }
  }
  return row;
}

/**
 * One message: its author and age, then its markdown.
 * @param {HTMLElement} parent
 * @param {import('../layout').DetailMessageInput} message
 * @param {import('../layout').InboxKit} kit
 */
function messageBlock(parent, message, kit) {
  const root = kit.el(parent, 'div', 'work-inbox-detail-message');
  kit.el(
    root,
    'div',
    'work-inbox-detail-message-head',
    `${message.author} · ${message.age}`,
  );
  kit.markdown(root, message.text, 'work-inbox-detail-text md');
}

/**
 * The thread: its root message, how many replies show, then each reply; or the missing line with no stored detail.
 * @param {HTMLElement} parent
 * @param {import('../layout').DetailInput} input
 * @param {import('../layout').InboxKit} kit
 */
function threadBlock(parent, input, kit) {
  if (input.root === null) {
    kit.el(parent, 'p', 'work-inbox-detail-missing', MISSING_THREAD);
    return;
  }
  const thread = kit.el(parent, 'div', 'work-inbox-detail-thread');
  messageBlock(thread, input.root, kit);
  if (input.replyCountText !== null) {
    kit.el(thread, 'p', 'work-inbox-detail-count', input.replyCountText);
  }
  for (const reply of input.replies) {
    messageBlock(thread, reply, kit);
  }
}

/** @type {import('../layout').CompleteInboxLayout} */
const layout = {
  sideBar(parent, kit) {
    const root = kit.el(parent, 'div', 'work-inbox-side-pane');
    const head = kit.el(root, 'div', 'work-inbox-side-head');
    kit.sectionHeader(head, 'Inbox');
    kit.keyHint(head, 'sweep', {
      label: 'sweep',
      className: 'work-inbox-box-hint',
    });
    kit.sections(root);
    return { element: root };
  },
  sectionRow(parent, input, kit) {
    const end = kit.el(parent, 'span', 'work-inbox-section-end');
    if (input.isHot) {
      kit.tag(end, String(input.count), 'warning');
    } else {
      kit.el(end, 'span', 'work-inbox-count', String(input.count));
    }
    return kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.title,
      trailing: end,
    });
  },
  main(parent, kit) {
    const root = kit.el(parent, 'div', 'work-inbox-pane');
    const head = kit.el(root, 'div', 'work-inbox-head');
    const top = kit.el(head, 'div', 'work-inbox-head-top');
    kit.el(top, 'h2', 'work-inbox-title', 'Inbox');
    kit.filter(top);
    kit.keyHint(top, 'sweep', {
      label: 'sweep',
      className: 'work-inbox-box-hint',
    });
    kit.status(head);
    kit.cards(root);
    return { element: root };
  },
  status(parent, input, kit) {
    const line = kit.el(parent, 'div', 'work-inbox-status');
    kit.statusDot(line, input.tone);
    kit.el(line, 'span', 'work-inbox-status-text', input.text);
    if (input.hasRow) {
      const button = kit.button(
        line,
        'Show transcript',
        'work-inbox.showJobRow',
        {
          variant: 'ghost',
        },
      );
      kit.keyHint(button, 'showJobRow', {
        className: 'work-inbox-control-hint',
      });
    }
    return line;
  },
  problem(parent, input, kit) {
    return kit.el(parent, 'p', 'work-inbox-problem', input.text);
  },
  filter(parent, input, kit) {
    const chip = kit.button(
      parent,
      `${input.ticketKey} ✕`,
      'work-inbox.clearFilter',
      { variant: 'secondary' },
    );
    chip.classList.add('work-inbox-filter');
    return chip;
  },
  card(parent, input, kit) {
    const root = kit.el(parent, 'li', 'ui-card work-inbox-card');
    metaLine(root, input, kit);
    kit.el(root, 'h3', 'work-inbox-card-title', input.title);
    if (input.summary !== null) {
      kit.el(root, 'p', 'work-inbox-card-summary', input.summary);
    }
    if (input.latest !== '') {
      kit.el(root, 'p', 'work-inbox-card-latest', input.latest);
    }
    if (input.prompt.length > 0) {
      const prompt = kit.el(root, 'div', 'work-inbox-card-prompt');
      for (const action of input.prompt) {
        kit.keyHint(prompt, action.command, { label: action.label });
      }
    }
    if (input.note !== null) {
      kit.el(root, 'p', 'work-inbox-card-note', input.note);
    }
    return root;
  },
  empty(parent, input, kit) {
    const root = kit.el(parent, 'li', 'work-inbox-empty');
    if (input.reason === 'never') {
      const hint = kit.el(root, 'span', 'work-inbox-empty-hint');
      kit.keyHint(hint, 'sweep', { label: 'sweep' });
      kit.emptyState(root, 'Nothing gathered yet: sweep Slack and Jira', hint);
      return root;
    }
    const text =
      input.reason === 'filter'
        ? `No open threads for ${input.ticketKey ?? ''}.`
        : `Nothing in ${input.section}.`;
    kit.emptyState(root, text);
    return root;
  },
  detail(parent, input, kit) {
    const root = kit.el(parent, 'div', 'work-inbox-detail-pane');
    const head = kit.el(root, 'div', 'work-inbox-detail-head');
    kit.el(head, 'h2', 'work-inbox-detail-title', input.title);
    metaLine(head, input, kit);
    if (input.fetched !== null) {
      kit.el(head, 'p', 'work-inbox-detail-fetched', input.fetched);
    }
    if (input.participants.length > 0) {
      kit.el(
        root,
        'p',
        'work-inbox-detail-people',
        `With ${input.participants.join(', ')}`,
      );
    }
    if (input.tickets.length > 0) {
      const tickets = kit.el(root, 'div', 'work-inbox-detail-tickets');
      for (const ticket of input.tickets) {
        const chip = kit.button(tickets, ticket.key, 'work-inbox.openTicket', {
          arg: ticket.key,
          variant: 'ghost',
        });
        chip.classList.add('work-inbox-ticket');
        chip.title = ticket.reason ?? '';
      }
    }
    kit.el(root, 'p', 'work-inbox-detail-summary', input.summary);
    if (input.why !== null) {
      kit.el(root, 'p', 'work-inbox-detail-why', `Why: ${input.why}`);
    }
    threadBlock(root, input, kit);
    if (input.draft !== null) {
      kit.draftBox(root);
    }
    detailButtons(root, input, kit);
    if (input.note !== null) {
      kit.el(root, 'p', 'work-inbox-detail-note', input.note);
    }
    return root;
  },
  detailEmpty(parent, kit) {
    const root = kit.el(parent, 'div', 'work-inbox-detail-empty');
    kit.emptyState(root, 'No thread selected.');
    return root;
  },
};

export default layout;
