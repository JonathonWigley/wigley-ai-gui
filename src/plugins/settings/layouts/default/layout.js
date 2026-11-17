// @ts-check

// The built-in Settings mode look. Every pane and row appends its root to
// `parent` first. A pane's root is `div.settings-pane`, which draws no box of
// its own, so its parts lay out in the app's container as the container's own
// children.

/**
 * `element` with its own text as its title, so text that ends in an ellipsis
 * can still be read whole.
 * @param {HTMLElement} element
 */
function titled(element) {
  element.title = element.textContent ?? '';
  return element;
}

/**
 * A setting, plugin, key, leader or advanced row: the label, its dim detail
 * and its end on the first line, with the cursor prompt after them; the
 * description under them, then what `drawUnder` adds; then the open box. On a
 * one-line row the label and detail carry their text as a title.
 * @param {HTMLElement} parent
 * @param {import('../layout').RowKit} kit
 * @param {{ label: string, detail?: string, description: string, isSet: boolean, defaultText: string | null, isOneLine?: boolean, drawEnd(end: HTMLElement): void, drawUnder?(row: HTMLElement): void }} lines
 */
function settingsRow(parent, kit, lines) {
  const row = kit.el(parent, 'li', 'settings-row');
  const head = kit.el(row, 'div', 'settings-row-head');
  const label = kit.el(head, 'span', 'settings-row-label', lines.label);
  if (lines.isOneLine === true) {
    titled(label);
  }
  if (lines.detail !== undefined) {
    const detail = kit.el(head, 'span', 'settings-row-detail', lines.detail);
    if (lines.isOneLine === true) {
      titled(detail);
    }
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
  titled(kit.el(span, 'span', 'settings-recording-prompt', recording.prompt));
  return span;
}

/**
 * A recording's note under its row: what the keys move from, or why a press
 * was refused.
 * @param {HTMLElement} row
 * @param {import('../layout').RowKit} kit
 * @param {import('../layout').RecordingInput | null} recording
 */
function recordingNote(row, kit, recording) {
  if (recording === null || recording.note === null) {
    return;
  }
  const note = kit.el(row, 'div', 'settings-row-note', recording.note);
  note.classList.toggle('is-refused', recording.isRefused);
}

/**
 * One Leader menu column: its header with `drawEdges`' edge prompts, then the
 * rows slot `rows` places.
 * @param {HTMLElement} parent
 * @param {import('../layout').SettingsKit} kit
 * @param {string} title
 * @param {(head: HTMLElement) => void} drawEdges
 * @param {(column: HTMLElement) => HTMLElement} rows
 */
function leaderColumn(parent, kit, title, drawEdges, rows) {
  const column = kit.el(parent, 'div', 'settings-leader-column');
  const head = kit.sectionHeader(column, title);
  head.classList.add('settings-head');
  drawEdges(head);
  rows(column);
  return column;
}

/**
 * An edge prompt drawn by `kit` into `head`, on the `side` the move goes.
 * @param {HTMLElement} head
 * @param {import('../layout').SettingsKit} kit
 * @param {string} command
 * @param {{ side: 'start' | 'end', chevron?: string, label?: string }} options
 */
function leaderEdge(head, kit, command, options) {
  const edge = kit.edge(head, command, options);
  edge.classList.add('settings-edge', `settings-edge--${options.side}`);
  if (options.side === 'start') {
    head.prepend(edge);
  }
  return edge;
}

/**
 * A Leader menu row and its main part, the one line its key, label and dim
 * detail keep; the recording and the cursor prompt follow it on that line, or
 * wrap under it when the column has no room.
 * @param {HTMLElement} parent
 * @param {import('../layout').RowKit} kit
 * @param {import('../layout').RecordingInput | null} recording
 */
function leaderRow(parent, kit, recording) {
  const row = kit.el(parent, 'li', 'settings-row settings-leader-row');
  row.classList.toggle('settings-row--recording', recording !== null);
  const head = kit.el(row, 'div', 'settings-row-head');
  const main = kit.el(head, 'div', 'settings-leader-main');
  return { row, head, main };
}

/**
 * Ends a Leader menu row: the recording and the cursor prompt in `head` after
 * its main part, the recording's note under it, then the open box.
 * @param {{ row: HTMLElement, head: HTMLElement }} drawn
 * @param {import('../layout').RowKit} kit
 * @param {import('../layout').RecordingInput | null} recording
 */
function leaderRowEnd({ row, head }, kit, recording) {
  if (recording !== null) {
    recordingSpan(head, kit, recording);
  }
  kit.rowActions(head);
  recordingNote(row, kit, recording);
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
    // The Leader menu's groups column draws its own edge to the sections.
    if (input.sectionId !== 'leader') {
      const edge = kit.edge(head, 'panes.focusLeft', {
        side: 'start',
        chevron: '‹ sections',
      });
      edge.classList.add('settings-edge', 'settings-edge--start');
      head.prepend(edge);
    }
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
        if (input.problem !== null) {
          const failed = kit.tag(end, 'failed', 'error');
          failed.classList.add('settings-row-failed');
        }
        if (input.originText !== null) {
          const origin = kit.tag(end, input.originText);
          origin.classList.add('settings-row-origin');
        }
        if (input.lockedText !== null) {
          end.classList.add('settings-row-end--locked');
          const lock = titled(kit.tag(end, input.lockedText));
          lock.classList.add('settings-row-lock');
        }
        kit.el(end, 'span', 'settings-row-value', input.value);
      },
      drawUnder(drawnRow) {
        if (input.problem !== null) {
          kit.el(drawnRow, 'div', 'settings-row-problem', input.problem);
        }
      },
    });
  },
  keyRow(parent, input, kit) {
    const { recording } = input;
    const row = settingsRow(parent, kit, {
      label: input.label,
      detail: input.group,
      description: '',
      isSet: false,
      defaultText: null,
      isOneLine: true,
      drawEnd(end) {
        if (input.lines.length === 0 && recording === null) {
          kit.el(end, 'span', 'settings-row-value is-unset', '—');
          return;
        }
        const binds = kit.el(end, 'span', 'settings-binds');
        binds.title = input.lines
          .map((line) => [line.keys, ...line.tags].join(' '))
          .join(' · ');
        // While a recording runs the row shows only it and the bind it
        // replaces, so a bind cut from the line never hides the recording.
        input.lines.forEach((line, index) => {
          const isReplaced = recording !== null && recording.line === index;
          if (recording !== null && !isReplaced) {
            return;
          }
          const bind = kit.el(binds, 'span', 'settings-bind');
          // The separator sits inside the bind it leads, so a bind cut from
          // the line takes its separator with it.
          if (binds.firstChild !== bind) {
            kit.el(bind, 'span', 'settings-bind-separator', '·');
          }
          bind.classList.toggle('is-struck', line.isStruck || isReplaced);
          kit.kbd(bind, line.keys);
          for (const text of line.tags) {
            titled(kit.tag(bind, text));
          }
          if (isReplaced) {
            recordingSpan(binds, kit, recording);
          }
        });
        if (recording !== null && recording.line === null) {
          recordingSpan(binds, kit, recording);
        }
      },
      drawUnder: (drawnRow) => recordingNote(drawnRow, kit, recording),
    });
    row.classList.add('settings-key-row');
    row.classList.toggle('settings-row--recording', recording !== null);
    return row;
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
    if (input.find.prompt !== null) {
      kit.el(end, 'span', 'settings-recording-prompt', input.find.prompt);
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
  leaderPanes(parent, input, kit) {
    const root = kit.el(parent, 'li', 'settings-leader');
    leaderColumn(
      root,
      kit,
      'Groups',
      (head) => {
        leaderEdge(head, kit.groupsKit, 'panes.focusLeft', {
          side: 'start',
        });
        leaderEdge(head, kit.groupsKit, 'panes.focusRight', { side: 'end' });
      },
      (column) => kit.groupRows(column),
    );
    leaderColumn(
      root,
      kit,
      input.itemsTitle,
      (head) =>
        leaderEdge(head, kit.itemsKit, 'panes.focusLeft', {
          side: 'start',
          chevron: '‹ groups',
        }),
      (column) => kit.itemRows(column),
    );
    return { element: root };
  },
  leaderGroupRow(parent, input, kit) {
    const drawn = leaderRow(parent, kit, input.recording);
    drawn.row.style.setProperty('--settings-leader-depth', String(input.depth));
    if (input.key !== '') {
      kit.kbd(drawn.main, input.key);
    }
    const name = titled(
      kit.el(drawn.main, 'span', 'settings-row-label', input.name),
    );
    name.classList.toggle('is-unnamed', !input.isNamed);
    if (input.isSet) {
      titled(kit.tag(drawn.main, 'Set'));
    }
    kit.el(drawn.main, 'span', 'settings-leader-count', String(input.count));
    return leaderRowEnd(drawn, kit, input.recording);
  },
  leaderItemRow(parent, input, kit) {
    const drawn = leaderRow(parent, kit, input.recording);
    const key = kit.kbd(drawn.main, input.key);
    key.classList.toggle('is-struck', input.recording !== null);
    const label = input.kind === 'group' ? `${input.label} ›` : input.label;
    titled(kit.el(drawn.main, 'span', 'settings-row-label', label));
    if (input.command !== null) {
      titled(
        kit.el(drawn.main, 'span', 'settings-leader-command', input.command),
      );
    }
    for (const text of input.tags) {
      titled(kit.tag(drawn.main, text));
    }
    return leaderRowEnd(drawn, kit, input.recording);
  },
  leaderAddRow(parent, input, kit) {
    const drawn = leaderRow(parent, kit, input.recording);
    kit.el(drawn.main, 'span', 'settings-row-label', 'add…');
    titled(
      kit.el(
        drawn.main,
        'span',
        'settings-leader-free',
        input.freeKeys.join(' '),
      ),
    );
    return leaderRowEnd(drawn, kit, input.recording);
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
  cursorPrompt(parent, input, kit) {
    const prompt = kit.el(parent, 'span', 'settings-row-actions');
    for (const action of input.actions) {
      kit.keyHint(prompt, action.command, { label: action.label });
    }
    return prompt;
  },
  boxMessage(parent, input, kit) {
    return kit.el(parent, 'div', 'settings-box-message', input.text);
  },
};

export default layout;
