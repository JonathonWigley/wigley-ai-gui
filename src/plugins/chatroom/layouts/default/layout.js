// @ts-check

// The built-in chatroom look: the side bar's rooms under section headers, each
// thread a list row with its unread count and an `@` tag for a mention,
// resolved threads dim; the sheet's head with one line per board session and
// the thread's heading carrying the log's key hints; one block per message
// (sender, kind tag, time, `to` names and `↪ #id`, then the markdown body and
// ref chips), entries and progress dim; the composer's frame, box and Send
// button; and the row badge, a tag the click opens the row's room with.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  sideBar(parent, input, kit) {
    const element = kit.el(parent, 'div', 'chatroom-side-bar');
    if (input.preview) {
      kit.tag(element, 'Preview', 'accent');
    }
    if (input.rooms.length === 0) {
      kit.emptyState(element, 'No rooms yet: an agent posts to start one.');
    }
    for (const group of input.rooms) {
      kit.sectionHeader(element, group.room);
      for (const thread of group.threads) {
        drawThreadRow(element, thread, kit);
      }
    }
    return { element };
  },
  board(parent, input, kit) {
    const element = kit.el(parent, 'div', 'chatroom-board');
    if (input.room === null) {
      kit.emptyState(element, 'Pick a thread in the side bar.');
      return { element };
    }
    kit.sectionHeader(element, `Board · ${input.room}`);
    for (const row of input.rows) {
      drawBoardLine(element, row, kit);
    }
    if (input.rows.length === 0) {
      kit.el(element, 'span', 'chatroom-muted', 'No live sessions.');
    }
    if (input.thread !== null) {
      const head = kit.el(element, 'div', 'chatroom-thread-head');
      kit.el(head, 'span', 'chatroom-thread-title', input.thread);
      const hints = kit.el(head, 'span', 'chatroom-hints');
      kit.keyHint(hints, 'compose', { label: true });
      kit.keyHint(hints, 'reply', { label: true });
    }
    return { element };
  },
  message(parent, input, kit) {
    const element = kit.el(parent, 'div', 'chatroom-message');
    element.classList.toggle('is-quiet', input.quiet);
    element.classList.toggle('is-cursor', input.isCursor);
    const head = kit.el(element, 'div', 'chatroom-message-head');
    kit.el(head, 'span', 'chatroom-sender', input.sender);
    kit.tag(head, input.kind, kindTone(input.kind));
    kit.el(head, 'span', 'chatroom-muted', input.time);
    if (input.to.length > 0) {
      kit.el(head, 'span', 'chatroom-muted', `to ${input.to.join(', ')}`);
    }
    if (input.replyTo !== null) {
      kit.el(head, 'span', 'chatroom-muted', `↪ #${input.replyTo}`);
    }
    if (input.isCursor && input.canReply) {
      kit.keyHint(head, 'reply', {
        label: true,
        className: 'chatroom-prompt',
      });
    }
    kit.markdown(element, input.body, 'chatroom-body');
    if (input.refs.length > 0) {
      const refs = kit.el(element, 'div', 'chatroom-refs');
      for (const ref of input.refs) {
        kit.tag(refs, `${ref.type} ${ref.value}`, 'neutral');
      }
    }
    return { element };
  },
  composer(parent, input, kit) {
    const element = kit.el(parent, 'div', 'chatroom-composer');
    kit.el(
      element,
      'span',
      'chatroom-muted',
      input.answerTo === null
        ? 'Note to the thread'
        : `Answer to #${input.answerTo}`,
    );
    const line = kit.el(element, 'div', 'chatroom-composer-line');
    kit.textBox(line);
    const send = kit.button(line, 'Send', 'chatroom.send', {
      variant: 'primary',
    });
    kit.keyHint(send, 'send');
    if (input.error !== null) {
      kit.el(element, 'span', 'chatroom-error', input.error);
    }
    return { element };
  },
  rowBadge(parent, input, kit) {
    const element = kit.tag(
      parent,
      input.text,
      input.isMention ? 'attention' : 'accent',
    );
    element.classList.add('chatroom-badge');
    const open = kit.command('chatroom.openRowRoom', input.rowId);
    element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('click', () => open());
    return { element };
  },
};

/**
 * @param {HTMLElement} parent
 * @param {import('../layout').ThreadRowInput} thread
 * @param {import('../layout').ChatroomKit} kit
 */
function drawThreadRow(parent, thread, kit) {
  const open = kit.command('chatroom.openThreadRow', thread.arg);
  const row = kit.row(parent, {
    density: 'list',
    label: thread.label,
    onClick: () => open(),
  });
  row.classList.add('chatroom-thread');
  row.classList.toggle('is-resolved', thread.resolved);
  row.classList.toggle('is-cursor', thread.isCursor);
  row.classList.toggle('is-selected', thread.isOpen);
  row.title = thread.label;
  if (thread.unread > 0 || thread.mentions > 0) {
    const trailing = kit.rowTrailing(row);
    if (thread.unread > 0) {
      kit.el(trailing, 'span', 'chatroom-count', String(thread.unread));
    }
    if (thread.mentions > 0) {
      kit.tag(trailing, '@', 'attention');
    }
  }
}

/**
 * @param {HTMLElement} parent
 * @param {import('../layout').BoardLineInput} row
 * @param {import('../layout').ChatroomKit} kit
 */
function drawBoardLine(parent, row, kit) {
  const line = kit.el(parent, 'div', 'chatroom-board-line');
  kit.statusDot(line, stateDot(row.state));
  kit.el(line, 'span', 'chatroom-board-name', row.name);
  kit.el(line, 'span', 'chatroom-muted', row.state);
  if (row.harness !== null) {
    kit.el(line, 'span', 'chatroom-muted', row.harness);
  }
  if (row.branch !== null) {
    kit.el(line, 'span', 'chatroom-branch', row.branch);
  }
  if (row.clone !== null) {
    kit.tag(line, row.clone, 'neutral');
  }
  if (row.uncommitted > 0) {
    kit.tag(line, `${row.uncommitted} uncommitted`, 'warning');
  }
  for (const claim of row.claims) {
    kit.tag(line, `claims ${claim}`, 'neutral');
  }
}

/**
 * @param {string} state
 * @returns {'idle' | 'running' | 'success' | 'attention'}
 */
function stateDot(state) {
  switch (state) {
    case 'working':
      return 'running';
    case 'waiting':
      return 'attention';
    case 'done':
      return 'success';
    default:
      return 'idle';
  }
}

/**
 * @param {string} kind
 * @returns {import('../../../../shared/page/layout-host/kit').TagTone}
 */
function kindTone(kind) {
  switch (kind) {
    case 'question':
    case 'blocker':
      return 'attention';
    case 'result':
      return 'success';
    case 'heads-up':
      return 'warning';
    default:
      return 'neutral';
  }
}

export default layout;
