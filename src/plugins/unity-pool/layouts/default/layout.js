// @ts-check

// The built-in unity-pool look: a tag under a session row for each clone it
// holds or queue it waits in, and the right-bar panel: a summary of the counts,
// a two-column grid with one tile per clone (a dot for its state, its Hold or
// Release button, branch, editor state, dirty mark, who has it or `Free`, and
// any handoff, stranded mark, warm-up or result), then the queue. A clone
// blocking a long wait takes the attention edge and shows its holder's idle
// time.

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
    kit.el(element, 'div', 'unity-pool-summary', summaryText(input));
    const tiles = kit.el(element, 'div', 'unity-pool-clones');
    for (const clone of input.clones) {
      drawClone(tiles, clone, kit);
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

// `3 free · 1 held`: free always, the other counts only while not zero.
/**
 * @param {import('../layout').PanelInput} input
 */
function summaryText(input) {
  const { counts } = input;
  const strandedCount = input.clones.filter(
    (clone) => clone.stranded !== null,
  ).length;
  const parts = [`${counts.free} free`];
  if (counts.held > 0) {
    parts.push(`${counts.held} held`);
  }
  if (strandedCount > 0) {
    parts.push(`${strandedCount} stranded`);
  }
  if (counts.queued > 0) {
    parts.push(`${counts.queued} queued`);
  }
  return parts.join(' · ');
}

/**
 * @param {HTMLElement} parent
 * @param {import('../layout').PanelCloneInput} clone
 * @param {import('../layout').UnityPoolKit} kit
 */
function drawClone(parent, clone, kit) {
  const box = kit.el(parent, 'div', 'unity-pool-clone');
  box.classList.toggle('is-blocking', clone.blocking);
  box.title = clone.path;
  const head = kit.el(box, 'div', 'unity-pool-clone-head');
  kit.statusDot(head, cloneDot(clone));
  kit.el(head, 'span', 'unity-pool-clone-title', clone.title);
  if (clone.action !== null) {
    const { label, command, arg } = clone.action;
    const button = kit.button(head, label, command, {
      arg,
      variant: label === 'Hold' ? 'ghost' : 'secondary',
    });
    button.disabled = clone.action.running;
  }
  kit.el(box, 'span', 'unity-pool-branch', clone.branch);
  const facts = kit.el(box, 'div', 'unity-pool-facts');
  kit.el(facts, 'span', 'unity-pool-muted', clone.editor);
  if (clone.dirty) {
    kit.tag(facts, 'dirty', 'warning');
  }
  drawOwner(box, clone, kit);
  drawNotes(box, clone, kit);
}

// Clean, with no claim, handoff or stranded mark: each of those sets a holder.
/**
 * @param {import('../layout').PanelCloneInput} clone
 */
function isFree(clone) {
  return clone.holder === null && !clone.dirty;
}

// Green while free, amber while stuck (stranded, or dirty with no holder),
// neutral on the user's own hold, running on a session's.
/**
 * @param {import('../layout').PanelCloneInput} clone
 * @returns {'success' | 'warning' | 'idle' | 'running'}
 */
function cloneDot(clone) {
  if (isFree(clone)) {
    return 'success';
  }
  if (clone.stranded !== null || clone.holder === null) {
    return 'warning';
  }
  return clone.holder.kind === 'user' ? 'idle' : 'running';
}

// Who has the clone: `Free`, `Stranded` over the session that left it, or the
// holder with its idle time while it blocks a long wait.
/**
 * @param {HTMLElement} box
 * @param {import('../layout').PanelCloneInput} clone
 * @param {import('../layout').UnityPoolKit} kit
 */
function drawOwner(box, clone, kit) {
  if (isFree(clone)) {
    kit.el(box, 'span', 'unity-pool-free', 'Free');
    return;
  }
  if (clone.stranded !== null) {
    kit.el(box, 'span', 'unity-pool-warning', 'Stranded');
  }
  if (clone.holder === null) {
    return;
  }
  drawHolder(box, clone.holder, kit);
  if (clone.blocking && clone.holder.idleMs !== null) {
    kit.el(
      box,
      'span',
      'unity-pool-idle',
      `idle ${kit.duration(clone.holder.idleMs)}`,
    );
  }
}

// An open handoff, a stranded mark's reason, a running or failed warm-up, and
// the last Hold or Release's result, each only while it applies.
/**
 * @param {HTMLElement} box
 * @param {import('../layout').PanelCloneInput} clone
 * @param {import('../layout').UnityPoolKit} kit
 */
function drawNotes(box, clone, kit) {
  if (clone.handoffMs !== null) {
    kit.el(
      box,
      'span',
      'unity-pool-muted',
      `handoff, ${kit.duration(clone.handoffMs)} left`,
    );
  }
  if (clone.stranded !== null) {
    kit.el(
      box,
      'span',
      'unity-pool-warning',
      `${clone.stranded.reason}, ${kit.duration(clone.stranded.forMs)} ago`,
    );
  }
  if (clone.warmup !== null) {
    drawWarmup(box, clone.warmup, kit);
  }
  if (clone.result !== null) {
    kit.el(
      box,
      'span',
      clone.result.ok ? 'unity-pool-muted' : 'unity-pool-error',
      clone.result.text,
    );
  }
}

// A failed warm-up blocks no claim, so it stays a small mark with its error in
// the tooltip.
/**
 * @param {HTMLElement} box
 * @param {NonNullable<import('../layout').PanelCloneInput['warmup']>} warmup
 * @param {import('../layout').UnityPoolKit} kit
 */
function drawWarmup(box, warmup, kit) {
  if (warmup.state === 'running') {
    kit.el(box, 'span', 'unity-pool-running', 'warming up');
    return;
  }
  const note = kit.el(box, 'span', 'unity-pool-warning');
  note.title = `warm-up failed${warmup.error === null ? '' : `: ${warmup.error}`}`;
  kit.icon(note, 'warning');
  kit.el(note, 'span', '', 'not warmed');
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
