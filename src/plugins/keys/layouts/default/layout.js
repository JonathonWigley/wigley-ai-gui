// @ts-check

// The built-in keys look: help's sections side by side, which-key as a quiet
// shelf of keys and labels in columns under the keys pressed and their
// group's name, the leader search's rows as help's are, the help dialog's
// frame with its Close button, and the Keys button with its key prompt after
// the icon.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  help(parent, input, kit) {
    const grid = kit.el(parent, 'div', 'keys-help-sections');
    for (const section of input.sections) {
      kit.helpSection(grid, section);
    }
    return grid;
  },
  helpSection(parent, input, kit) {
    const block = kit.el(parent, 'section', 'keys-help-section');
    kit.sectionHeader(block, input.title);
    const list = kit.el(block, 'ul', 'keys-help-list');
    for (const hint of input.hints) {
      kit.hint(list, hint);
    }
    return block;
  },
  helpRow(parent, input, kit) {
    return kit.row(parent, {
      density: 'list',
      label: input.label,
      trailing: keysElement(input.keys, kit),
      tag: 'li',
    });
  },
  whichKey(parent, input, kit) {
    const pane = kit.el(parent, 'div', 'which-key-pane');
    const header = kit.el(pane, 'div', 'which-key-header');
    kit.kbd(header, input.title);
    if (input.name !== null) {
      kit.el(header, 'span', 'which-key-name', sentenceCase(input.name));
    }
    const list = kit.el(pane, 'div', 'which-key-list');
    for (const entry of input.entries) {
      kit.entry(list, entry);
    }
    return pane;
  },
  whichKeyEntry(parent, input, kit) {
    const entry = kit.el(parent, 'div', `which-key-entry is-${input.kind}`);
    kit.kbd(entry, input.keys);
    kit.el(entry, 'span', 'which-key-label', sentenceCase(input.label));
    if (input.kind === 'prefix') {
      kit.el(entry, 'span', 'which-key-more', '›');
    }
    return entry;
  },
  leaderSearchRow(parent, input, kit) {
    return kit.row(parent, {
      density: 'list',
      label: sentenceCase(input.label),
      trailing: keysElement(input.keys, kit),
    });
  },
  dialogFrame(parent, input, kit) {
    const panel = kit.el(
      parent,
      'div',
      'ui-floating material-floating ui-dialog keys-help-dialog',
    );
    kit.el(panel, 'h2', 'ui-dialog-title', input.title);
    const body = kit.el(panel, 'div', 'ui-dialog-body');
    const actions = input.hasActions
      ? kit.el(panel, 'div', 'ui-dialog-actions')
      : null;
    if (actions !== null) {
      const close = kit.button(actions, 'Close', 'keys.closeHelp', {
        variant: 'secondary',
      });
      kit.keyHint(close, 'closeHelp');
    }
    return { element: panel, body, actions };
  },
  titleBarButton(parent, kit) {
    const button = kit.iconButton(
      parent,
      'record-keys',
      'Keys',
      kit.command('keys.toggleHelp'),
    );
    button.classList.add('keys-title-bar-button');
    kit.keyHint(button, 'toggleHelp', { className: 'keys-title-bar-hint' });
    return button;
  },
};

// `keys` drawn for the platform, not yet placed, for a row's trailing end.
/**
 * @param {string} keys
 * @param {import('../layout').KeysKit} kit
 */
function keysElement(keys, kit) {
  return kit.kbd(document.createElement('span'), keys);
}

// `text` with its first character upper-cased and the rest as written.
/** @param {string} text */
function sentenceCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default layout;
