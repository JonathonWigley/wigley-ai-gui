// @ts-check

// The built-in notes look, with the class names `notes.css` styles. A root
// that only groups what the app's container lays out (`notes-tags`,
// `notes-session-value`, `notes-actions`, `notes-markup-groups`) is
// `display: contents` there, so the container lays out its children as its
// own.

/**
 * The quiet text of an empty value.
 * @param {HTMLElement} parent
 * @param {string} text
 * @param {import('../layout').NotesKit} kit
 */
function quiet(parent, text, kit) {
  return { element: kit.el(parent, 'span', 'notes-empty', text) };
}

/** @type {import('../layout').CompleteLayout} */
const layout = {
  row(parent, input, kit) {
    const root = kit.el(parent, 'div', 'notes-row');
    kit.el(root, 'span', 'notes-row-label', input.label);
    kit.valueSlot(root);
    kit.pickHint(kit.el(root, 'span', 'notes-row-keys'));
    return { element: root };
  },
  target(parent, input, kit) {
    if (input.text === null) {
      return quiet(parent, 'No target', kit);
    }
    const shown = kit.el(parent, 'span', 'notes-target', input.text);
    shown.title = input.text;
    return { element: shown };
  },
  tags(parent, input, kit) {
    if (input.tags.length === 0) {
      return quiet(parent, 'No tags', kit);
    }
    const root = kit.el(parent, 'span', 'notes-tags');
    for (const held of input.tags) {
      kit.tag(root, held);
    }
    return { element: root };
  },
  images(parent, input, kit) {
    if (input.count === 0) {
      return quiet(parent, 'No images', kit);
    }
    const strip = kit.el(parent, 'div', 'notes-strip');
    for (let position = 1; position <= input.count; position += 1) {
      kit.image(strip, position);
    }
    return { element: strip };
  },
  image(parent, input, kit) {
    const held = kit.el(parent, 'div', 'notes-image');
    held.classList.toggle('is-selected', input.isSelected);
    const thumbnail = /** @type {HTMLImageElement} */ (
      kit.el(held, 'img', 'notes-image-thumbnail')
    );
    thumbnail.src = input.src;
    thumbnail.alt = input.alt;
    if (input.hasMarkup) {
      kit.icon(held, 'edit', 'notes-image-pen');
    }
    kit.removeButton(held);
    return { element: held };
  },
  session(parent, input, kit) {
    if (input.text === null) {
      return quiet(parent, 'No session', kit);
    }
    const root = kit.el(parent, 'span', 'notes-session-value');
    kit.sessionChip(root, input.text);
    kit.removeButton(root);
    return { element: root };
  },
  actions(parent, kit) {
    const root = kit.el(parent, 'div', 'notes-actions');
    kit.actionButton(root, 'discard');
    kit.actionButton(root, 'appendFollowup');
    kit.actionButton(root, 'sendSession');
    kit.actionButton(root, 'sendFollowup');
    return { element: root };
  },
  confirm(parent, kit) {
    const root = kit.el(parent, 'div', 'notes-confirm');
    kit.el(
      root,
      'p',
      'notes-confirm-text',
      'Its title, text and images are removed.',
    );
    const actions = kit.el(root, 'div', 'ui-dialog-actions');
    kit.actionButton(actions, 'confirmNo');
    kit.actionButton(actions, 'confirmYes');
    return { element: root };
  },
  markupToolbar(parent, kit) {
    const root = kit.el(parent, 'div', 'notes-markup-groups');
    const tools = kit.el(root, 'div', 'notes-markup-group');
    kit.toolButton(tools, 'select');
    kit.toolButton(tools, 'pen');
    kit.toolButton(tools, 'text');
    kit.toolButton(tools, 'arrow');
    kit.toolButton(tools, 'box');
    const colours = kit.el(root, 'div', 'notes-markup-group');
    kit.colourButton(colours, 'red');
    kit.colourButton(colours, 'yellow');
    kit.colourButton(colours, 'green');
    kit.colourButton(colours, 'blue');
    kit.colourKeys(colours);
    const commands = kit.el(root, 'div', 'notes-markup-group');
    kit.commandButton(commands, 'undo');
    kit.commandButton(commands, 'redo');
    kit.commandButton(commands, 'closeMarkup');
    return { element: root };
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

export default layout;
