// @ts-check

// The built-in Backlog look. Each pane's root is `div.backlog-pane`, whose
// tracks its `layout.css` sets by the container it fills.

/** @type {Record<import('../layout').EmptyReason, (filter: string) => string>} */
const EMPTY_TEXTS = {
  filter: (filter) => `No rows match "${filter}".`,
  allDone: () => 'Every follow-up here is done.',
  readyNone: () => 'No agent-ready follow-ups here.',
  allChunked: () => 'Every follow-up here is in a chunk.',
  nothing: () => 'No follow-ups yet: ask the assistant to add one.',
};

// The command whose keys follow an empty state's text, by reason.
/** @type {Partial<Record<import('../layout').EmptyReason, string>>} */
const EMPTY_COMMANDS = { nothing: 'toggleAssistant' };

/** @type {Record<import('../layout').StalenessLevel, 'success' | 'warning' | 'error' | 'neutral'>} */
const STALENESS_TONES = {
  fresh: 'success',
  moved: 'warning',
  stale: 'error',
  unknown: 'neutral',
};

// The table's column head, in the row grid's order.
const COLUMNS = /** @type {const} */ ([
  ['repo', 'Repo'],
  ['task', 'Task'],
  ['ready', 'Ready'],
  ['staleness', 'Staleness'],
  ['chunk', 'Chunk'],
]);

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
 * One cell of the row grid, in `column`.
 * @param {HTMLElement} parent
 * @param {import('../layout').BacklogKit} kit
 * @param {string} column
 * @param {string} [text]
 */
function cell(parent, kit, column, text) {
  return kit.el(parent, 'span', `backlog-cell backlog-cell--${column}`, text);
}

/**
 * The line naming the chunk an item is in, or null for none.
 * @param {{ name: string; isStarted: boolean } | null} chunk
 */
function chunkLine(chunk) {
  if (chunk === null) {
    return null;
  }
  return `In chunk ${chunk.name}${chunk.isStarted ? ', started' : ''}`;
}

/**
 * A filter's button: `primary` while on, `ghost` while off.
 * @param {HTMLElement} parent
 * @param {import('../layout').BacklogKit} kit
 * @param {string} label
 * @param {string} command
 * @param {boolean} isOn
 */
function filterButton(parent, kit, label, command, isOn) {
  return kit.button(parent, label, command, {
    variant: isOn ? 'primary' : 'ghost',
    keys: null,
  });
}

/** @type {import('../layout').CompleteBacklogLayout} */
const layout = {
  table(parent, kit) {
    const root = paneRoot(parent, kit);
    const header = kit.el(root, 'div', 'backlog-pane-header');
    const keys = kit.el(header, 'span', 'backlog-pane-keys');
    hint(keys, kit, 'filter', 'filter');
    hint(keys, kit, 'rescan', 'rescan');
    hint(keys, kit, 'sweep', 'sweep');
    hint(keys, kit, 'startAllChunks', 'start all');
    edge(header, kit, 'end', 'panes.focusRight', 'review');
    kit.status(root);
    kit.filterBar(root);
    kit.filterBox(root);
    const head = kit.el(root, 'div', 'backlog-columns');
    for (const [column, label] of COLUMNS) {
      cell(head, kit, column, label);
    }
    kit.rows(root);
    return { element: root };
  },
  filters(parent, input, kit) {
    const bar = kit.el(parent, 'div', 'backlog-filters');
    filterButton(
      bar,
      kit,
      input.repo ?? 'All repos',
      'backlog.pickRepo',
      input.repo !== null,
    );
    filterButton(
      bar,
      kit,
      'Ready',
      'backlog.toggleAgentReadyOnly',
      input.isReadyOnly,
    );
    filterButton(
      bar,
      kit,
      'Hide chunked',
      'backlog.toggleChunkedHidden',
      input.isChunkedHidden,
    );
    filterButton(
      bar,
      kit,
      'Stale first',
      'backlog.toggleStaleFirst',
      input.isStaleFirst,
    );
    filterButton(bar, kit, 'Done', 'backlog.toggleDone', input.isDoneShown);
    if (input.marked > 0) {
      kit.tag(bar, `${String(input.marked)} marked`, 'accent');
    }
    return bar;
  },
  tableRow(parent, input, kit) {
    const repo = document.createElement('span');
    repo.className = 'backlog-cell backlog-cell--repo';
    if (input.isMarked) {
      kit.icon(repo, 'check', 'backlog-mark');
    }
    repo.append(input.repo);
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.title,
      detail: input.oneLine,
      leading: repo,
    });
    row.classList.add('backlog-table-row');
    const trailing = kit.rowTrailing(row);
    const ready = cell(trailing, kit, 'ready');
    if (input.isReady) {
      kit.tag(ready, 'ready', 'accent');
    }
    const staleness = cell(trailing, kit, 'staleness');
    if (input.staleness === null) {
      kit.tag(staleness, '…', 'neutral');
    } else {
      kit.tag(staleness, input.staleness, STALENESS_TONES[input.staleness]);
    }
    const chunk = cell(trailing, kit, 'chunk');
    if (input.chunk !== null) {
      kit.el(chunk, 'span', 'backlog-chunk-name', input.chunk.name);
      if (input.chunk.isStarted) {
        kit.icon(chunk, 'link-external');
      }
    }
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
  review(parent, kit) {
    const root = paneRoot(parent, kit);
    const head = kit.el(root, 'div', 'backlog-review-head');
    edge(head, kit, 'start', 'panes.focusLeft', 'table');
    hint(head, kit, 'openInDocs', 'docs');
    hint(head, kit, 'toggleCommits', 'commits');
    kit.body(root);
    return { element: root };
  },
  reviewItem(parent, input, kit) {
    const item = kit.el(parent, 'div', 'backlog-review-item');
    kit.el(item, 'h2', 'backlog-review-title', input.title);
    if (input.tags.length > 0) {
      const tags = kit.el(item, 'span', 'backlog-tags');
      for (const each of input.tags) {
        kit.tag(tags, each, each === 'agent-ready' ? 'accent' : 'neutral');
      }
    }
    kit.el(
      item,
      'p',
      `backlog-staleness backlog-staleness--${input.level ?? 'reading'}`,
      input.note,
    );
    kit.inlineMarkdown(item, input.oneLine, 'backlog-review-line');
    kit.el(
      item,
      'p',
      'backlog-review-path',
      `${input.repo} · ${input.shownPath}`,
    );
    const inChunk = chunkLine(input.chunk);
    if (inChunk !== null) {
      kit.el(item, 'p', 'backlog-review-chunk', inChunk);
    }
    kit.markdown(item, input.body, 'md');
    return item;
  },
  commits(parent, input, kit) {
    const section = kit.el(parent, 'div', 'backlog-commits');
    kit.sectionHeader(section, 'Commits since written');
    if (input.problem !== null) {
      kit.emptyState(section, input.problem);
    } else if (input.commits === null) {
      kit.emptyState(section, 'Reading commits…');
    } else if (input.commits.length === 0) {
      kit.emptyState(section, 'No commits since it was written.');
    } else {
      const list = kit.el(section, 'ol', 'backlog-commit-rows');
      for (const commit of input.commits) {
        kit.row(list, {
          density: 'list',
          tag: 'li',
          label: commit.subject,
          detail: `${commit.shortSha} · ${commit.date}`,
        });
      }
    }
    return section;
  },
  strip(parent, kit) {
    const root = paneRoot(parent, kit);
    const header = kit.el(root, 'div', 'backlog-pane-header');
    kit.sectionHeader(header, 'Chunks');
    const keys = kit.el(header, 'span', 'backlog-pane-keys');
    hint(keys, kit, 'renameChunk', 'rename');
    hint(keys, kit, 'toggleHeadless', 'headless');
    hint(keys, kit, 'startChunk', 'start');
    hint(keys, kit, 'startAllChunks', 'start all');
    kit.renameBox(root);
    kit.chunks(root);
    return { element: root };
  },
  chunkCard(parent, input, kit) {
    const card = kit.card(parent, 'backlog-chunk');
    kit.el(card, 'span', 'backlog-chunk-title', input.name);
    const facts = kit.el(card, 'span', 'backlog-chunk-facts');
    kit.tag(facts, input.repo, 'neutral');
    kit.el(
      facts,
      'span',
      'backlog-chunk-count',
      `${String(input.count)} ${input.count === 1 ? 'item' : 'items'}`,
    );
    if (input.isHeadless) {
      kit.tag(facts, 'headless', 'accent');
    }
    if (input.isStarted) {
      const started = kit.el(facts, 'span', 'backlog-chunk-started');
      kit.statusDot(started, 'running');
      started.append('started');
    }
    return card;
  },
  newChunk(parent, kit) {
    const card = kit.card(parent, 'backlog-chunk backlog-chunk--new');
    kit.el(card, 'span', 'backlog-chunk-title', 'New chunk');
    return card;
  },
  pickerRow(parent, input, kit) {
    return kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.label,
      trailing: kit.trailing(),
    });
  },
};

export default layout;
