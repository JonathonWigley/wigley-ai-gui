// @ts-check

// The built-in unity-pool look: a tag under a session row for each clone it
// holds or queue it waits in, and the right-bar panel: one row per clone (its
// branch, dirty mark, editor state, holder and its Hold or Release button),
// a line under it for a handoff, stranded mark, warm-up or result, then the
// queue. A clone blocking a long wait takes the attention edge and shows its
// holder's idle time.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  rowBadge(parent, input, kit) {
    const element = kit.tag(
      parent,
      input.text,
      input.queued ? 'attention' : 'neutral',
    );
    element.classList.add('unity-pool-badge');
    return { element };
  },
  panel(parent, input, kit) {
    const element = kit.el(parent, 'div', 'unity-pool-panel');
    kit.sectionHeader(element, `Unity pool · ${input.pool}`);
    for (const clone of input.clones) {
      drawClone(element, clone, kit);
    }
    if (input.queue.length > 0) {
      kit.sectionHeader(element, 'Queue');
      for (const ticket of input.queue) {
        drawTicket(element, ticket, kit);
      }
    }
    return { element };
  },
};

/**
 * @param {HTMLElement} parent
 * @param {import('../layout').PanelCloneInput} clone
 * @param {import('../layout').UnityPoolKit} kit
 */
function drawClone(parent, clone, kit) {
  const box = kit.el(parent, 'div', 'unity-pool-clone');
  box.classList.toggle('is-blocking', clone.blocking);
  box.title = clone.path;
  const row = kit.row(box, { density: 'list', label: clone.title });
  kit.el(row, 'span', 'unity-pool-branch', clone.branch);
  if (clone.dirty) {
    kit.tag(row, 'dirty', 'warning');
  }
  kit.el(row, 'span', 'unity-pool-muted', clone.editor);
  if (clone.holder !== null) {
    drawHolder(row, clone.holder, kit);
    if (clone.blocking && clone.holder.idleMs !== null) {
      kit.el(
        row,
        'span',
        'unity-pool-idle',
        `idle ${kit.duration(clone.holder.idleMs)}`,
      );
    }
  }
  if (clone.action !== null) {
    const button = kit.button(
      kit.rowTrailing(row),
      clone.action.label,
      clone.action.run,
    );
    button.disabled = clone.action.running;
  }
  drawNotes(box, clone, kit);
}

// The second line: an open handoff, a stranded mark, a running or failed
// warm-up, and the last Hold or Release's result, each only while it applies.
/**
 * @param {HTMLElement} box
 * @param {import('../layout').PanelCloneInput} clone
 * @param {import('../layout').UnityPoolKit} kit
 */
function drawNotes(box, clone, kit) {
  /** @type {[string, string][]} */
  const notes = [];
  if (clone.handoffMs !== null) {
    notes.push([
      'unity-pool-muted',
      `handoff, ${kit.duration(clone.handoffMs)} left`,
    ]);
  }
  if (clone.stranded !== null) {
    notes.push([
      'unity-pool-warning',
      `${clone.stranded.reason}, ${kit.duration(clone.stranded.forMs)} ago`,
    ]);
  }
  if (clone.warmup !== null) {
    notes.push(
      clone.warmup.state === 'running'
        ? ['unity-pool-running', 'warming up']
        : [
            'unity-pool-error',
            `warm-up failed${clone.warmup.error === null ? '' : `: ${clone.warmup.error}`}`,
          ],
    );
  }
  if (clone.result !== null) {
    notes.push([
      clone.result.ok ? 'unity-pool-muted' : 'unity-pool-error',
      clone.result.text,
    ]);
  }
  if (notes.length === 0) {
    return;
  }
  const line = kit.el(box, 'div', 'unity-pool-notes');
  for (const [className, text] of notes) {
    kit.el(line, 'span', className, text);
  }
}

/**
 * @param {HTMLElement} parent
 * @param {import('../layout').PanelQueueInput} ticket
 * @param {import('../layout').UnityPoolKit} kit
 */
function drawTicket(parent, ticket, kit) {
  const row = kit.row(parent, { density: 'list', label: ticket.position });
  row.classList.add('unity-pool-ticket');
  drawHolder(row, ticket.holder, kit);
  kit.el(row, 'span', 'unity-pool-branch', ticket.branch);
  kit.el(
    row,
    'span',
    'unity-pool-muted',
    `waited ${kit.duration(ticket.waitedMs)}`,
  );
}

// A session holder with a row is a link-styled click that selects the row and
// takes no focus; any other holder is plain text.
/**
 * @param {HTMLElement} parent
 * @param {import('../layout').HolderInput} holder
 * @param {import('../layout').UnityPoolKit} kit
 */
function drawHolder(parent, holder, kit) {
  const element = kit.el(parent, 'span', 'unity-pool-holder', holder.label);
  const select = holder.select;
  if (select === null) {
    return;
  }
  element.classList.add('is-link');
  element.addEventListener('mousedown', (event) => event.preventDefault());
  element.addEventListener('click', () => select());
}

export default layout;
