// @ts-check

// The built-in docs look. Every part appends its root element to `parent`
// first, then places the app's parts inside it.

// A load-state chip's tone, by its state.
/** @type {Record<import('../layout').ChipInput['state'], import('../../../../shared/page/layout-host/kit').TagTone>} */
const CHIP_TONES = {
  launch: 'success',
  'on-demand': 'accent',
  listed: 'neutral',
  shadowed: 'warning',
  pending: 'warning',
  'not-loaded': 'neutral',
  none: 'neutral',
};

// The tree header's box hints, in the order they show.
const TREE_HINTS = [
  ['filter', 'filter'],
  ['createByKind', 'new'],
  ['createByPath', 'file'],
  ['rescan', 'rescan'],
  ['pickContext', 'folder'],
];

/** @type {import('../layout').CompleteLayout} */
const layout = {
  treePane(parent, _input, kit) {
    const pane = kit.el(parent, 'div', 'docs-tree-pane');
    const header = kit.el(pane, 'div', 'docs-tree-header');
    for (const [command, label] of TREE_HINTS) {
      kit.keyHint(header, command, { label });
    }
    const edge = kit.edge(header, 'panes.focusRight', {
      side: 'end',
      chevron: '›',
      label: 'doc',
    });
    edge.classList.add('docs-edge', 'docs-edge--end');
    kit.sidebarSwitch(pane);
    kit.status(pane);
    kit.filterBox(pane);
    kit.line(pane);
    kit.rows(pane);
    return { element: pane };
  },
  treeLine(parent, input, kit) {
    if (input.placement === 'empty') {
      const line = kit.emptyState(parent, input.text);
      if (input.hint !== null) {
        kit.keyHint(line, input.hint.command, {
          label: input.hint.words,
          className: 'docs-hint',
        });
      }
      return { element: line };
    }
    const line = kit.el(parent, 'div', 'docs-filtered');
    kit.el(line, 'span', 'docs-filtered-text', input.text);
    if (input.hint !== null) {
      kit.keyHint(line, input.hint.command, {
        label: input.hint.words,
        className: 'docs-hint',
      });
    }
    return { element: line };
  },
  treeRow(parent, input, kit) {
    const caret = kit.el(parent, 'span', 'docs-row-caret');
    if (input.type === 'group') {
      kit.icon(caret, input.isExpanded ? 'chevron-down' : 'chevron-right');
    } else if (input.isStarred) {
      kit.icon(caret, 'star-full', 'docs-row-star');
    }
    const end = rowEnd(parent, input, kit);
    const row = kit.row(parent, {
      density: 'tree',
      tag: 'li',
      label: input.title,
      detail: input.detail,
      depth: input.depth,
      leading: caret,
      trailing: end,
    });
    if (input.isDangling) {
      row.classList.add('docs-row--dangling');
    }
    if (input.type === 'wikiLabel') {
      row.classList.add('docs-row--label');
    }
    if (input.isPrompted) {
      row.classList.add('docs-row--prompted');
      kit.cursorPrompt(row);
    }
    return { element: row };
  },
  docPane(parent, _input, kit) {
    const frame = kit.el(parent, 'div', 'docs-doc-frame');
    const top = kit.el(frame, 'div', 'docs-doc-top');
    const edge = kit.edge(top, 'panes.focusLeft', {
      side: 'start',
      chevron: '‹ tree',
    });
    edge.classList.add('docs-edge', 'docs-edge--start');
    kit.scroller(frame);
    return { element: frame };
  },
  emptyDoc(parent, input, kit) {
    const empty = kit.emptyState(parent, input.text);
    kit.keyHint(empty, 'backToTree', { label: 'tree' });
    return { element: empty };
  },
  docHeader(parent, input, kit) {
    const head = kit.el(parent, 'div', 'docs-head');
    const header = kit.el(head, 'div', 'docs-header');
    kit.el(header, 'h1', 'docs-title', input.title);
    kit.sectionHint(header);
    kit.editHint(header);
    const path = kit.el(header, 'div', 'docs-path', input.path);
    path.title = input.fullPath;
    const chips = kit.el(header, 'div', 'docs-chips');
    for (const chip of input.chips) {
      kit.tag(chips, chip.text, CHIP_TONES[chip.state]).title = chip.tooltip;
    }
    for (const status of input.statuses) {
      kit.tag(chips, status, 'warning');
    }
    if (input.loaded !== null) {
      kit.el(chips, 'span', 'docs-loaded', input.loaded);
    }
    if (input.readOnly !== null) {
      kit.el(head, 'div', 'docs-readonly', input.readOnly);
    }
    return { element: head };
  },
  diskBanner(parent, input, kit) {
    return { element: kit.el(parent, 'div', 'docs-banner', input.text) };
  },
  conflictPrompt(parent, input, kit) {
    const prompt = kit.el(parent, 'div', 'docs-prompt');
    kit.el(prompt, 'span', '', input.text);
    const keys = kit.el(prompt, 'span', 'docs-prompt-keys');
    kit.keyHint(keys, 'conflictReload', { label: 'reload' });
    kit.keyHint(keys, 'conflictOverwrite', { label: 'overwrite' });
    kit.keyHint(keys, 'conflictCancel', { label: 'cancel' });
    return { element: prompt };
  },
  docBody(parent, input, kit) {
    const docBody = kit.el(parent, 'div', 'docs-doc-body');
    if (input.fields.length > 0) {
      const box = kit.el(docBody, 'div', 'docs-frontmatter-box');
      const table = kit.el(box, 'table', 'docs-frontmatter');
      for (const [key, value] of input.fields) {
        const row = kit.el(table, 'tr');
        kit.el(row, 'th', '', key);
        kit.el(row, 'td', '', value);
      }
    }
    kit.body(docBody);
    return { element: docBody };
  },
  editorFrame(parent, _input, kit) {
    const frame = kit.el(parent, 'div', 'docs-editor-frame');
    kit.editor(frame);
    return { element: frame };
  },
  boxDialog(parent, input, kit) {
    const box = kit.el(parent, 'div', 'docs-box-body');
    kit.textBox(box);
    if (input.completes) {
      kit.keyHint(box, 'boxComplete', {
        label: 'complete',
        className: 'docs-box-hint',
      });
    }
    kit.completions(box);
    return { element: box };
  },
  completion(parent, input, kit) {
    return {
      element: kit.row(parent, {
        density: 'list',
        tag: 'li',
        label: input.text,
      }),
    };
  },
  confirmDialog(parent, input, kit) {
    const text = kit.el(parent, 'p', 'docs-confirm-text', input.question);
    const actions = kit.actions();
    kit.answer(actions, 'no', 'Keep it', 'secondary');
    kit.answer(actions, 'yes', 'Move to the Trash', 'danger');
    return { element: text };
  },
  pickerRow(parent, input, kit) {
    return {
      element: kit.row(parent, {
        density: 'list',
        tag: 'li',
        label: input.label,
        trailing: kit.trailing(),
      }),
    };
  },
  pageFrame(parent, _input, kit) {
    const frame = kit.el(parent, 'div', 'docs-page-frame');
    kit.article(frame);
    kit.aside(frame);
    return { element: frame };
  },
  pageAside(parent, _input, kit) {
    const aside = kit.el(parent, 'div', 'docs-aside-body');
    kit.onThisPage(aside);
    kit.linkedFrom(aside);
    return { element: aside };
  },
  asideHeading(parent, input, kit) {
    const heading = kit.el(parent, 'div', 'docs-aside-heading');
    if (input.kind === 'sections') {
      kit.edge(heading, 'prevSection', { side: 'start' });
    }
    kit.el(heading, 'span', 'docs-aside-title', input.title);
    if (input.kind === 'sections') {
      kit.edge(heading, 'nextSection', { side: 'end' });
    }
    return { element: heading };
  },
  asideLink(parent, input, kit) {
    return {
      element: kit.row(parent, {
        density: 'tree',
        label: input.title,
        depth: input.depth,
      }),
    };
  },
  sectionEditControl(parent, _input, kit) {
    const button = kit.button(parent, 'edit', kit.openSection, {
      variant: 'ghost',
    });
    button.classList.add('docs-section-edit');
    return { element: button };
  },
  recentChanges(parent, input, kit) {
    const recent = kit.el(parent, 'div', 'docs-recent');
    kit.sectionHeader(recent, 'Recent changes');
    if (input.rows.length === 0) {
      kit.el(
        recent,
        'p',
        'docs-recent-empty',
        'No commits touch these pages yet',
      );
    }
    for (const row of input.rows) {
      const line = kit.el(recent, 'div', 'docs-recent-row');
      kit.el(line, 'span', 'docs-recent-time', row.time.text).title =
        row.time.title;
      kit.el(line, 'span', 'docs-recent-subject', row.subject).title = row.sha;
      const pages = kit.el(line, 'span', 'docs-recent-pages');
      for (const page of row.pages) {
        kit.pageLink(pages, page.title, page.path);
      }
    }
    return { element: recent };
  },
  listPage(parent, input, kit) {
    const page = kit.el(parent, 'div', 'docs-list-page');
    kit.el(page, 'h1', 'docs-title', input.title);
    kit.el(
      page,
      'div',
      'docs-list-count',
      input.count === 1 ? '1 doc' : `${input.count} docs`,
    );
    for (const [index, group] of input.groups.entries()) {
      kit.sectionHeader(page, group.title);
      kit.rows(page, index);
    }
    return { element: page };
  },
  listRow(parent, input, kit) {
    return {
      element: kit.row(parent, {
        density: 'list',
        tag: 'li',
        label: input.title,
        detail: input.path,
        trailing: listRowTime(parent, input, kit),
      }),
    };
  },
  sidebarSwitch(parent, input, kit) {
    const control = kit.el(parent, 'div', 'docs-sidebar-switch');
    const wiki = kit.el(control, 'span', 'docs-sidebar-switch-option', 'Wiki');
    const all = kit.el(
      control,
      'span',
      'docs-sidebar-switch-option',
      'All pages',
    );
    (input.view === 'wiki' ? wiki : all).classList.add('is-active');
    return { element: control };
  },
  mainEmpty(parent, input, kit) {
    const empty = kit.emptyState(parent, `No Main page at ${input.path}`);
    kit.createMainHint(empty);
    return { element: empty };
  },
};

// A list row's time, or null with no time. Drawn into `parent` and moved into
// the row by `kit.row`.
/**
 * @param {HTMLElement} parent
 * @param {import('../layout').ListRowInput} input
 * @param {import('../layout').DocsKit} kit
 * @returns {HTMLElement | null}
 */
function listRowTime(parent, input, kit) {
  if (input.time === null) {
    return null;
  }
  const time = kit.el(parent, 'span', 'docs-row-time', input.time.text);
  time.title = input.time.title;
  return time;
}

// A row's end: its count, then its time, then its status dot; the dot alone
// with neither; null with none. Drawn into `parent` and moved into the row by
// `kit.row`.
/**
 * @param {HTMLElement} parent
 * @param {import('../layout').TreeRowInput} input
 * @param {import('../layout').TreeRowKit} kit
 * @returns {HTMLElement | null}
 */
function rowEnd(parent, input, kit) {
  const hasEnd = input.time !== null || input.count !== null;
  const end = hasEnd ? kit.el(parent, 'span', 'docs-row-end') : null;
  if (input.count !== null && end !== null) {
    kit.el(end, 'span', 'docs-row-count', String(input.count));
  }
  if (input.time !== null && end !== null) {
    kit.el(end, 'span', 'docs-row-time', input.time.text).title =
      input.time.title;
  }
  if (input.mark !== null) {
    const dot = kit.statusDot(end ?? parent, 'warning');
    dot.title = input.mark;
    return end ?? dot;
  }
  return end;
}

export default layout;
