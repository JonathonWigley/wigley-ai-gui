// @ts-check

// The built-in Inbox look. The side bar's root is `div.work-inbox-side-pane`, the sheet's `div.work-inbox-pane`: a
// head (title, the filter chip, the sweep hint, then the status line), then the cards, which scroll.

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
 * The card's buttons, in its actions' order, after Open in Slack.
 * @param {HTMLElement} parent
 * @param {import('../layout').CardInput} input
 * @param {import('../layout').CardKit} kit
 */
function cardButtons(parent, input, kit) {
  const row = kit.el(parent, 'div', 'work-inbox-card-actions');
  kit.button(row, 'Open in Slack', 'core.openLink', {
    arg: input.url,
    variant: 'ghost',
  });
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
      if (input.isCursor) {
        kit.keyHint(button, 'send', { className: 'work-inbox-control-hint' });
      }
    }
  }
  return row;
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
    const meta = kit.el(root, 'div', 'work-inbox-card-meta');
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
    kit.el(meta, 'span', 'work-inbox-card-age', input.age);
    kit.el(root, 'h3', 'work-inbox-card-title', input.title);
    kit.el(root, 'p', 'work-inbox-card-summary', input.summary);
    if (input.latest !== '') {
      kit.el(root, 'p', 'work-inbox-card-latest', input.latest);
    }
    if (input.participants.length > 0) {
      kit.el(
        root,
        'p',
        'work-inbox-card-people',
        `With ${input.participants.join(', ')}`,
      );
    }
    if (input.why !== null) {
      kit.el(root, 'p', 'work-inbox-card-why', `Why: ${input.why}`);
    }
    if (input.tickets.length > 0) {
      const tickets = kit.el(root, 'div', 'work-inbox-card-tickets');
      for (const ticket of input.tickets) {
        const chip = kit.button(tickets, ticket.key, 'work-inbox.openTicket', {
          arg: ticket.key,
          variant: 'ghost',
        });
        chip.classList.add('work-inbox-ticket');
        chip.title = ticket.reason ?? '';
      }
    }
    if (input.draft !== null) {
      if (input.isCursor) {
        kit.draftBox(root);
      } else if (input.draft !== '') {
        kit.el(root, 'p', 'work-inbox-card-draft', input.draft);
      }
    }
    cardButtons(root, input, kit);
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
};

export default layout;
