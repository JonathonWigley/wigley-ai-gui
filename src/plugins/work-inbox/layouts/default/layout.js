// @ts-check

// The built-in Inbox look. The side bar's root is `div.work-inbox-side-pane`: the section rows under their Threads and
// Digest headings. The sheet's is `div.work-inbox-pane`: one head line (the list's title, the update status, the
// filter chip, the sweep hint), then compact rows, which scroll: an unseen dot, the source and age, the title (bold
// while unseen), then the latest message, or a digest item's why. The detail pane's root is
// `div.work-inbox-detail-pane`: the item's head, its people, tickets, summary and why, the thread, the reply box on a
// thread, then the buttons.

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
 * The meta line a row and the detail head share: `channel · author`, a `digest` Tag on a digest item, the section and
 * state Tags, a `sending` Tag, then the age at the end.
 * @param {HTMLElement} parent
 * @param {{ channel: string, author: string, isDigest: boolean, sectionTitle: string | null, stateTag: string | null, isSending: boolean, age: string }} input
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
  if (input.isDigest) {
    kit.tag(meta, 'digest', 'info');
  }
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
 * A group's heading in the nav or the list: its title in small capitals, or a bare divider with none.
 * @param {HTMLElement} parent
 * @param {string | null} title
 * @param {import('../layout').InboxKit} kit
 */
function groupHeading(parent, title, kit) {
  const root = kit.el(parent, 'li', 'work-inbox-group');
  if (title === null) {
    root.classList.add('is-divider');
  } else {
    kit.el(root, 'span', 'work-inbox-group-title', title);
  }
  return root;
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
  sectionGroup(parent, input, kit) {
    return groupHeading(parent, input.title, kit);
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
    kit.status(head);
    kit.filter(head);
    kit.keyHint(head, 'sweep', {
      label: 'sweep',
      className: 'work-inbox-box-hint',
    });
    kit.cards(root);
    return { element: root };
  },
  status(parent, input, kit) {
    const line = kit.el(parent, 'div', 'work-inbox-status');
    kit.el(line, 'h2', 'work-inbox-title', input.title);
    if (input.tone !== 'idle') {
      kit.statusDot(line, input.tone);
    }
    kit.el(line, 'span', 'work-inbox-status-text', input.text);
    if (input.hasRow) {
      kit.keyHint(line, 'showJobRow', {
        label: 'log',
        className: 'work-inbox-status-hint',
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
  cardGroup(parent, input, kit) {
    return groupHeading(parent, input.title, kit);
  },
  card(parent, input, kit) {
    const root = kit.el(parent, 'li', 'work-inbox-card');
    root.classList.toggle('is-unseen', input.isUnseen);
    root.classList.toggle('is-digest', input.isDigest);
    kit.el(root, 'span', 'work-inbox-card-dot');
    metaLine(root, input, kit);
    kit.el(root, 'h3', 'work-inbox-card-title', input.title);
    const line =
      input.isDigest && input.why !== null ? input.why : input.latest;
    if (line !== '') {
      kit.el(root, 'p', 'work-inbox-card-latest', line);
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
    if (input.why !== null) {
      kit.el(root, 'p', 'work-inbox-detail-why', `Why: ${input.why}`);
    }
    kit.el(root, 'p', 'work-inbox-detail-summary', input.summary);
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
