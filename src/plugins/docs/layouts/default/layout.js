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
};

// A leaf's row end: its time, then its status dot; the dot alone with no
// time; null with neither. Drawn into `parent` and moved into the row by
// `kit.row`.
/**
 * @param {HTMLElement} parent
 * @param {import('../layout').TreeRowInput} input
 * @param {import('../layout').TreeRowKit} kit
 * @returns {HTMLElement | null}
 */
function rowEnd(parent, input, kit) {
  const hasTime = input.time !== null;
  const end = hasTime ? kit.el(parent, 'span', 'docs-row-end') : null;
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
