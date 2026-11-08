// @ts-check

// The built-in Settings mode look. Every pane and row appends its root to
// `parent` first. A pane's root is `div.settings-pane`, which draws no box of
// its own, so its parts lay out in the app's container as the container's own
// children.

/**
 * A setting, plugin, key, leader or advanced row: the label and its end on the first
 * line, with the cursor prompt after them; the description under them; then
 * the open box.
 * @param {HTMLElement} parent
 * @param {import('../layout').RowKit} kit
 * @param {{ label: string, description: string, isSet: boolean, defaultText: string | null, drawEnd(end: HTMLElement): void }} lines
 */
function settingsRow(parent, kit, lines) {
  const row = kit.el(parent, 'li', 'settings-row');
  const head = kit.el(row, 'div', 'settings-row-head');
  kit.el(head, 'span', 'settings-row-label', lines.label);
  const end = kit.el(head, 'div', 'settings-row-end');
  if (lines.isSet) {
    kit.tag(end, 'Set');
  }
  if (lines.isSet && lines.defaultText !== null) {
    kit.el(
      end,
      'span',
      'settings-row-default',
      `Default: ${lines.defaultText}`,
    );
  }
  lines.drawEnd(end);
  kit.rowActions(head);
  if (lines.description.trim() !== '') {
    kit.el(row, 'div', 'settings-row-description', lines.description);
  }
  kit.box(row);
  return row;
}

/** @type {import('../layout').CompleteSettingsLayout} */
const layout = {
  sections(parent, kit) {
    const root = kit.el(parent, 'div', 'settings-pane');
    kit.sectionRows(root);
    const edge = kit.edge(root, 'panes.focusRight', {
      side: 'end',
      label: 'rows',
    });
    edge.classList.add('settings-edge', 'settings-edge--end');
    return { element: root };
  },
  rows(parent, input, kit) {
    const root = kit.el(parent, 'div', 'settings-pane');
    const head = kit.sectionHeader(root, input.title);
    head.classList.add('settings-head');
    const edge = kit.edge(head, 'panes.focusLeft', {
      side: 'start',
      chevron: '‹ sections',
    });
    edge.classList.add('settings-edge', 'settings-edge--start');
    head.prepend(edge);
    kit.filterHint(head);
    kit.filterBox(root);
    kit.problem(root);
    kit.rowList(root);
    return { element: root };
  },
  sectionRow(parent, input, kit) {
    return kit.row(parent, { density: 'list', tag: 'li', label: input.title });
  },
  settingRow(parent, input, kit) {
    return settingsRow(parent, kit, {
      label: input.label,
      description: input.description,
      isSet: input.isSet,
      defaultText: input.defaultText,
      drawEnd(end) {
        const value = kit.el(end, 'span', 'settings-row-value', input.value);
        value.classList.toggle('is-unset', input.isUnset);
      },
    });
  },
  pluginRow(parent, input, kit) {
    return settingsRow(parent, kit, {
      label: input.label,
      description: input.description,
      isSet: false,
      defaultText: null,
      drawEnd(end) {
        if (input.lockedText !== null) {
          kit.tag(end, input.lockedText);
        }
        kit.el(end, 'span', 'settings-row-value', input.value);
      },
    });
  },
  keyRow(parent, input, kit) {
    return settingsRow(parent, kit, {
      label: input.label,
      description: '',
      isSet: false,
      defaultText: null,
      drawEnd(end) {
        if (input.lines.length === 0) {
          kit.el(end, 'span', 'settings-row-value is-unset', 'Not bound');
          return;
        }
        const binds = kit.el(end, 'span', 'settings-binds');
        for (const line of input.lines) {
          const bind = kit.el(binds, 'span', 'settings-bind');
          bind.classList.toggle('is-struck', line.isStruck);
          kit.kbd(bind, line.keys);
          for (const text of line.tags) {
            kit.tag(bind, text);
          }
        }
      },
    });
  },
  leaderRow(parent, input, kit) {
    return settingsRow(parent, kit, {
      label: 'Leader',
      description: 'The key every <Leader> bind starts with',
      isSet: input.isSet,
      defaultText: input.defaultKeys,
      drawEnd: (end) => kit.kbd(end, input.keys),
    });
  },
  advancedRow(parent, input, kit) {
    return settingsRow(parent, kit, {
      label: 'Advanced',
      description: 'Groups, remaps and accelerators',
      isSet: input.isSet,
      defaultText: null,
      drawEnd: (end) => kit.el(end, 'span'),
    });
  },
  groupHeader(parent, input, kit) {
    const header = kit.sectionHeader(parent, input.title);
    header.classList.add('settings-group-header');
    return header;
  },
  empty(parent, input, kit) {
    const empty = kit.emptyState(parent, `No rows match "${input.query}".`);
    kit.keyHint(empty, 'clearFilter');
    return empty;
  },
  problem(parent, input, kit) {
    const card = kit.card(parent, 'ui-card--error');
    card.textContent = `${input.file} has a problem: ${input.problem}`;
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
