// @ts-check

// The built-in keys look: help's sections side by side, which-key's rows in
// columns, and the Keys button with its key prompt after the icon.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  help(parent, input, kit) {
    const grid = kit.el(parent, 'div', 'keys-help-sections');
    for (const section of input.sections) {
      kit.section(grid, section);
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
    kit.sectionHeader(pane, input.title);
    const list = kit.el(pane, 'div', 'which-key-list');
    for (const entry of input.entries) {
      kit.entry(list, entry);
    }
    return pane;
  },
  whichKeyEntry(parent, input, kit) {
    const row = kit.row(parent, {
      density: 'list',
      label: input.label,
      trailing: keysElement(input.keys, kit),
    });
    row.classList.add('which-key-row', `is-${input.kind}`);
    return row;
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

export default layout;
