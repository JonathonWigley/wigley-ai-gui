// @ts-check

// The built-in Sessions look: the side bar's "Sessions" header over its
// sections, Favorites then Recent, each a label beside a hairline and a drop
// hint over its groups, each group a project's header (name, count, star and
// grip) over its rows, then each plugin section, its label always shown with
// its header part at the hairline's end, over its claimed rows,
// each row a compact card of three lines: its title (`New Chat` for a row with no
// title; no harness name) with its activity's label or, with no
// activity, a needs you label while `marked` (a running activity draws no
// label: the workflow chip's tag in the footer says it), a status edge for an
// activity with an emphasis, its on-screen mark, and for a row a plugin section
// claimed, a muted title and card with a dashed accent edge,
// over a footer holding other plugins' row parts (`contributedParts`): the parts
// ordered below 2 on the second line, and those ordered 2 and later always on
// a third, then, on the list cursor's row, the cursor prompt on a line of its
// own (one key hint per action of `prompt`),
// each chat pane's frame and focus edges, the tab bar's prompts around its
// strip, other plugins' bar parts (`contributedParts`) after them, then its
// close prompt, split prompts and close-pane control, each tab's icon with no label, each session
// popup's sheet around its body, the hidden popups' bar (each entry's icon and
// status, or its title with no status, then the toggle key), and the rename
// dialog's frame (its panel and title) and its title box over why a title was
// refused and the hint, in the class names its `layout.css` styles, and each split picker row as the kit's list
// row holding its label alone.

const UNTITLED_ROW_TEXT = 'New Chat';

/** @type {import('../layout').ActivityInput} */
const MARKED_ROW_ACTIVITY = {
  word: 'needs you',
  tone: 'attention',
  emphasis: 'urgent',
};

// A state the user should act on, or one with an emphasis, takes a Tag, solid
// when urgent; a success Tag opens on a check. Any other is plain text.
/**
 * @param {HTMLElement} parent
 * @param {import('../layout').ActivityInput} activity
 * @param {Parameters<import('../layout').CompleteLayout['row']>[2]} kit
 */
function drawActivityLabel(parent, { word, tone, emphasis }, kit) {
  const text = word.charAt(0).toUpperCase() + word.slice(1);
  if (
    emphasis !== null ||
    tone === 'attention' ||
    tone === 'warning' ||
    tone === 'error'
  ) {
    const tag = kit.tag(parent, text, tone === 'idle' ? 'neutral' : tone);
    tag.classList.toggle('session-row-tag--solid', emphasis === 'urgent');
    if (tone === 'success') {
      tag.prepend(kit.icon(tag, 'check', 'session-row-activity-check'));
    }
    return;
  }
  kit.el(
    parent,
    'span',
    `session-row-activity session-row-activity--${tone}`,
    text,
  );
}

/** @type {import('../layout').CompleteLayout} */
const layout = {
  sideBar(parent, kit) {
    const element = kit.el(parent, 'div', 'session-side');
    const header = kit.sectionHeader(element, 'Sessions');
    kit.sessionEdge(header);
    kit.keyHint(header, 'chat.startNewSession', { label: 'new' });
    const rows = kit.el(element, 'nav', 'session-sidebar');
    rows.setAttribute('aria-label', 'Sessions');
    return { element, rows };
  },

  section(parent, input, kit) {
    const element = kit.el(parent, 'div', 'session-section');
    element.dataset.section = input.id;
    const label = kit.el(element, 'div', 'session-section-label', input.label);
    if (input.kind === 'plugin') {
      element.classList.add('session-section--plugin');
      kit.headerPart(label);
    } else {
      kit.el(element, 'div', 'session-section-drop-hint', input.dropHint);
    }
    const groups = kit.el(element, 'div', 'session-section-groups');
    return { element, groups };
  },

  group(parent, input, kit) {
    const element = kit.el(parent, 'div', 'session-group');
    const header = kit.el(element, 'div', 'session-group-header');
    kit.el(header, 'span', 'session-group-name', input.project);
    kit.el(header, 'span', 'session-group-count', String(input.count));
    kit.favoriteToggle(header);
    kit.dragHandle(header);
    const rows = kit.el(element, 'div', 'session-group-rows');
    return { element, header, rows };
  },

  row(parent, input, kit) {
    const element = kit.row(parent, {
      density: 'list',
      label: input.title ?? UNTITLED_ROW_TEXT,
    });
    element.classList.add('session-row');
    element.classList.toggle('is-on-screen', input.onScreen);
    element.classList.toggle('session-row--claimed', input.section !== null);
    const activity =
      input.activity ?? (input.marked ? MARKED_ROW_ACTIVITY : null);
    if (activity !== null && activity.tone !== 'running') {
      drawActivityLabel(kit.rowTrailing(element), activity, kit);
      if (activity.emphasis !== null) {
        element.classList.add(`session-row-edge--${activity.tone}`);
      }
    }
    const foot = kit.el(element, 'div', 'session-row-foot');
    kit.contributedParts(foot);
    if (input.prompt.length > 0) {
      const prompt = kit.el(element, 'span', 'session-row-actions');
      for (const action of input.prompt) {
        kit.keyHint(prompt, action.command, { label: action.label });
      }
    }
    return { element };
  },

  pane(parent, input, kit) {
    const element = kit.el(parent, 'div', 'session-pane');
    const body = kit.el(element, 'div', 'session-pane-body');
    /** @type {Map<import('../layout').PaneInput['edges'][number], HTMLElement>} */
    const edges = new Map();
    /** @param {import('../layout').PaneInput} next */
    const update = (next) => {
      element.classList.toggle('is-focused', next.isFocused);
      for (const [direction, edge] of edges) {
        if (!next.edges.includes(direction)) {
          edge.remove();
        }
      }
      for (const direction of next.edges) {
        const edge = edges.get(direction) ?? kit.focusEdge(element, direction);
        edges.set(direction, edge);
        element.append(edge);
      }
    };
    update(input);
    return { element, body, update };
  },

  tabBar(parent, kit) {
    const element = kit.el(parent, 'div', 'session-tabs-bar');
    kit.prevTabEdge(element);
    const strip = kit.el(
      element,
      'nav',
      'ui-tabs ui-tabs--scroll session-tabs',
    );
    strip.setAttribute('aria-label', 'Tabs');
    kit.nextTabEdge(element);
    kit.contributedParts(element);
    kit.closeHint(element);
    kit.splitRightHint(element);
    kit.splitDownHint(element);
    kit.closePaneHint(element);
    return { element, strip };
  },

  tab(parent, input, kit) {
    const element = /** @type {HTMLButtonElement} */ (
      kit.el(parent, 'button', 'ui-tab')
    );
    element.type = 'button';
    element.tabIndex = -1;
    kit.icon(element, input.icon, 'session-tab-icon');
    return { element };
  },

  emptyText(parent, input, kit) {
    const element = kit.el(parent, 'div', 'sessions-empty');
    const text = kit.emptyState(element, input.text);
    if (input.hasHint) {
      kit.pickHint(text);
    }
    return { element };
  },

  popup(parent, input, kit) {
    const element = kit.el(parent, 'div', 'session-popup');
    element.setAttribute('aria-label', input.title);
    const body = kit.el(element, 'div', 'session-popup-body');
    return { element, body };
  },

  popupBar(parent, input, kit) {
    const element = kit.el(parent, 'div', 'session-popup-bar');
    const entries = input.entries.map((entry) => {
      const drawn = kit.el(element, 'div', 'session-popup-bar-entry');
      drawn.title = entry.title;
      kit.icon(drawn, entry.icon, 'session-popup-bar-icon');
      kit.el(
        drawn,
        'span',
        'session-popup-bar-text',
        entry.status === '' ? entry.title : entry.status,
      );
      return drawn;
    });
    kit.toggleHint(element);
    return { element, entries };
  },

  renameDialog(parent, input, kit) {
    const element = kit.el(parent, 'div', 'session-rename');
    kit.textBox(element);
    if (input.problem !== null) {
      kit.el(element, 'p', 'session-rename-problem', input.problem);
    }
    kit.el(element, 'p', 'session-rename-hint', input.hint);
    return { element };
  },

  pickerRow(parent, input, kit) {
    const element = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.label,
      trailing: kit.trailing(),
    });
    return { element };
  },

  dialogFrame(parent, input, kit) {
    const panel = kit.el(
      parent,
      'div',
      'ui-floating material-floating ui-dialog',
    );
    kit.el(panel, 'h2', 'ui-dialog-title', input.title);
    const body = kit.el(panel, 'div', 'ui-dialog-body');
    const actions = input.hasActions
      ? kit.el(panel, 'div', 'ui-dialog-actions')
      : null;
    return { element: panel, body, actions };
  },
};

export default layout;
