// @ts-check

// The built-in Settings mode look. Every pane and row appends its root to
// `parent` first. A pane's root is `div.settings-pane`, which draws no box of
// its own, so its parts lay out in the app's container as the container's own
// children.

/**
 * A setting, plugin, key, leader or advanced row: the label, its dim detail
 * and its end on the first line, with the cursor prompt after them; the
 * description under them, then what `drawUnder` adds; then the open box.
 * @param {HTMLElement} parent
 * @param {import('../layout').RowKit} kit
 * @param {{ label: string, detail?: string, description: string, isSet: boolean, defaultText: string | null, drawEnd(end: HTMLElement): void, drawUnder?(row: HTMLElement): void }} lines
 */
function settingsRow(parent, kit, lines) {
  const row = kit.el(parent, 'li', 'settings-row');
  const head = kit.el(row, 'div', 'settings-row-head');
  kit.el(head, 'span', 'settings-row-label', lines.label);
  if (lines.detail !== undefined) {
    kit.el(head, 'span', 'settings-row-detail', lines.detail);
  }
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
  lines.drawUnder?.(row);
  kit.box(row);
  return row;
}

/**
 * A key recording in progress: the Kbd of the keys held, then the prompt.
 * @param {HTMLElement} parent
 * @param {import('../layout').RowKit} kit
 * @param {import('../layout').RecordingInput} recording
 */
function recordingSpan(parent, kit, recording) {
  const span = kit.el(parent, 'span', 'settings-recording');
  if (recording.keys !== null) {
    kit.kbd(span, recording.keys);
  }
  kit.el(span, 'span', 'settings-recording-prompt', recording.prompt);
  return span;
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
          end.classList.add('settings-row-end--locked');
          const lock = kit.tag(end, input.lockedText);
          lock.classList.add('settings-row-lock');
          lock.title = input.lockedText;
        }
        kit.el(end, 'span', 'settings-row-value', input.value);
      },
    });
  },
  keyRow(parent, input, kit) {
    const { recording } = input;
    return settingsRow(parent, kit, {
      label: input.label,
      detail: input.group,
      description: '',
      isSet: false,
      defaultText: null,
      drawEnd(end) {
        if (input.lines.length === 0 && recording === null) {
          kit.el(end, 'span', 'settings-row-value is-unset', '—');
          return;
        }
        const binds = kit.el(end, 'span', 'settings-binds');
        /** @param {HTMLElement} item */
        const separated = (item) => {
          if (binds.firstChild !== item) {
            binds.insertBefore(
              kit.el(binds, 'span', 'settings-bind-separator', '·'),
              item,
            );
          }
        };
        input.lines.forEach((line, index) => {
          const bind = kit.el(binds, 'span', 'settings-bind');
          separated(bind);
          const isReplaced = recording !== null && recording.line === index;
          bind.classList.toggle('is-struck', line.isStruck || isReplaced);
          kit.kbd(bind, line.keys);
          for (const text of line.tags) {
            kit.tag(bind, text);
          }
          if (isReplaced) {
            recordingSpan(binds, kit, recording);
          }
        });
        if (recording !== null && recording.line === null) {
          separated(recordingSpan(binds, kit, recording));
        }
      },
      drawUnder(row) {
        if (recording === null || recording.note === null) {
          return;
        }
        const note = kit.el(row, 'div', 'settings-row-note', recording.note);
        note.classList.toggle('is-refused', recording.isRefused);
      },
    });
  },
  keyFilters(parent, input, kit) {
    const bar = kit.el(parent, 'div', 'settings-key-filters');
    kit.keyHint(bar, 'cycleKeyFilter');
    for (const chip of input.chips) {
      kit.tag(
        bar,
        `${chip.label} ${chip.count}`,
        chip.isOn ? 'accent' : 'neutral',
      );
    }
    const end = kit.el(bar, 'span', 'settings-key-filters-end');
    if (input.find.isRecording) {
      kit.el(
        end,
        'span',
        'settings-recording-prompt',
        'Press a key to find what it runs — Esc cancels',
      );
    } else if (input.find.keys !== null) {
      kit.tag(end, `Finding ${input.find.keys}`, 'accent');
    } else {
      kit.keyHint(end, 'findByKey', { label: 'find by key' });
    }
    return bar;
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
      description: 'Remaps and accelerators',
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
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.label,
      trailing: kit.trailing(),
    });
    if (input.keys !== null) {
      const keys = kit.kbd(row, input.keys);
      keys.classList.add('settings-picker-keys');
      // The Row primitive wraps `trailing` in its own end cell.
      const trailingCell = kit.trailing()?.parentElement;
      if (trailingCell !== null && trailingCell?.parentNode === row) {
        row.insertBefore(keys, trailingCell);
      }
    }
    return row;
  },
};

export default layout;
