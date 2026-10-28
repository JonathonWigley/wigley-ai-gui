// @ts-check

// The built-in Backlog look. Each pane's root is `div.backlog-pane`, whose
// tracks `backlog.css` sets by the container it fills.

const FIELD_LABELS = /** @type {const} */ ([
  ['title', 'Title'],
  ['oneLine', 'One line'],
  ['tags', 'Tags (comma-separated)'],
  ['body', 'Body'],
]);

/** @type {Record<import('../layout').EmptyReason, (filter: string) => string>} */
const EMPTY_TEXTS = {
  noHome: () => 'Open a features home from the side bar.',
  filter: (filter) => `No rows match "${filter}".`,
  allDone: () => 'Every follow-up here is done.',
  agentReadyNone: () => 'No agent-ready follow-ups here.',
  nothing: () => 'Nothing is planned here.',
};

// The command whose keys follow an empty state's text, by reason.
/** @type {Partial<Record<import('../layout').EmptyReason, string>>} */
const EMPTY_COMMANDS = { noHome: 'back', nothing: 'create' };

/**
 * A pane's root, laid out by its container.
 * @param {HTMLElement} parent
 * @param {import('../layout').BacklogKit} kit
 */
function paneRoot(parent, kit) {
  return kit.el(parent, 'div', 'backlog-pane');
}

/**
 * A pane header's edge prompt for `command`: `<keys> <label> ›` at the end,
 * `‹ <label> <keys>` at the start.
 * @param {HTMLElement} parent
 * @param {import('../layout').BacklogKit} kit
 * @param {'start' | 'end'} side
 * @param {string} command
 * @param {string} label
 */
function edge(parent, kit, side, command, label) {
  const shown = kit.edge(
    parent,
    command,
    side === 'end' ? { side, label } : { side, chevron: `‹ ${label}` },
  );
  shown.classList.add('backlog-edge', `backlog-edge--${side}`);
  return shown;
}

/**
 * A command hint with its label.
 * @param {HTMLElement} parent
 * @param {import('../layout').BacklogKit} kit
 * @param {string} command
 * @param {string} label
 */
function hint(parent, kit, command, label) {
  return kit.keyHint(parent, command, { label, className: 'backlog-hint' });
}

/**
 * The tags span, one tag per tag; null with no tags.
 * @param {readonly string[]} tags
 * @param {import('../layout').BacklogKit} kit
 */
function tagsElement(tags, kit) {
  if (tags.length === 0) {
    return null;
  }
  const shown = document.createElement('span');
  shown.className = 'backlog-tags';
  for (const each of tags) {
    kit.tag(shown, each, each === 'agent-ready' ? 'accent' : 'neutral');
  }
  return shown;
}

/**
 * @param {number} checked
 * @param {number} total
 */
function progress(checked, total) {
  return `${String(checked)}/${String(total)}`;
}

/**
 * Puts the chevron of a plan or feature row at the row's start.
 * @param {HTMLElement} row
 * @param {boolean} isExpanded
 * @param {import('../layout').BacklogKit} kit
 */
function chevron(row, isExpanded, kit) {
  row.prepend(kit.icon(row, isExpanded ? 'chevron-down' : 'chevron-right'));
}

/** @type {import('../layout').CompleteBacklogLayout} */
const layout = {
  homes(parent, kit) {
    const root = paneRoot(parent, kit);
    kit.status(root);
    kit.homeRows(root);
    return { element: root };
  },
  list(parent, kit) {
    const root = paneRoot(parent, kit);
    const header = kit.el(root, 'div', 'backlog-list-header');
    const keys = kit.el(header, 'span', 'backlog-list-keys');
    hint(keys, kit, 'filter', 'filter');
    hint(keys, kit, 'create', 'new');
    hint(keys, kit, 'rescan', 'rescan');
    hint(keys, kit, 'commit', 'commit');
    edge(header, kit, 'end', 'focusDetail', 'detail');
    kit.filterBox(root);
    kit.rows(root);
    return { element: root };
  },
  detail(parent, kit) {
    const root = paneRoot(parent, kit);
    const head = kit.el(root, 'div', 'backlog-detail-head');
    edge(head, kit, 'start', 'focusList', 'list');
    hint(head, kit, 'openInDocs', 'docs');
    kit.body(root);
    kit.editor(root);
    return { element: root };
  },
  editor(parent, input, kit) {
    const root = paneRoot(parent, kit);
    kit.el(root, 'h2', 'backlog-editor-heading', input.heading);
    const fields = kit.el(root, 'div', 'backlog-editor-fields');
    for (const [field, label] of FIELD_LABELS) {
      kit.el(fields, 'label', 'backlog-editor-label', label);
      kit.textBox(fields, field);
    }
    const footer = kit.el(root, 'div', 'backlog-editor-hints');
    const keys = kit.el(footer, 'span', 'backlog-editor-keys');
    hint(keys, kit, 'save', 'save');
    hint(keys, kit, 'cancelEdit', 'cancel');
    hint(keys, kit, 'pickTag', 'tag');
    return { element: root };
  },
  repoHeader(parent, input, kit) {
    const header = kit.sectionHeader(parent, input.repo);
    header.classList.add('backlog-repo');
    return header;
  },
  homeRow(parent, input, kit) {
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.shownRoot,
      depth: 1,
    });
    row.title = input.root;
    if (input.uncommitted) {
      kit.tag(kit.rowTrailing(row), 'uncommitted');
    }
    return row;
  },
  groupHeader(parent, input, kit) {
    return kit.sectionHeader(parent, input.title);
  },
  followupRow(parent, input, kit) {
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.title,
      detail: input.oneLine,
      trailing: tagsElement(input.tags, kit),
    });
    kit.cursorActions(row);
    return row;
  },
  planRow(parent, input, kit) {
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.title,
      detail: [
        input.feature,
        progress(input.checked, input.total),
        input.target,
      ]
        .filter((part) => part !== null)
        .join(' · '),
    });
    chevron(row, input.isExpanded, kit);
    kit.cursorActions(row);
    return row;
  },
  featureRow(parent, input, kit) {
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.slug,
      detail: progress(input.checked, input.total),
    });
    chevron(row, input.isExpanded, kit);
    kit.cursorActions(row);
    return row;
  },
  taskRow(parent, input, kit) {
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.title,
      detail: input.status,
      depth: 1,
    });
    kit.cursorActions(row);
    return row;
  },
  empty(parent, input, kit) {
    const empty = kit.emptyState(
      parent,
      EMPTY_TEXTS[input.reason](input.filter),
    );
    const command = EMPTY_COMMANDS[input.reason];
    if (command !== undefined) {
      kit.keyHint(empty, command, { className: 'backlog-hint' });
    }
    return empty;
  },
  followupDetail(parent, input, kit) {
    const body = kit.el(parent, 'div', 'backlog-followup');
    kit.el(body, 'h2', 'backlog-detail-title', input.title);
    const tags = tagsElement(input.tags, kit);
    if (tags !== null) {
      body.append(tags);
    }
    kit.inlineMarkdown(body, input.oneLine, 'backlog-detail-line');
    kit.markdown(body, input.body, 'md');
    return body;
  },
  docDetail(parent, _input, kit) {
    return kit.document(parent);
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
};

export default layout;
