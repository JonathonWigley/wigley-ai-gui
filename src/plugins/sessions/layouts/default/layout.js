// @ts-check

// The built-in Sessions look: the side bar's "Sessions" header over its two
// sections, Favorites then Recent, each a label beside a hairline and a drop
// hint over its groups, each group a project's header (name, count, star and
// grip) over its rows,
// each row a compact card of two lines: its title (`New Chat` for a row with no
// title; no harness name) with its activity's label or, with no
// activity, a needs you label for its `marked` round, and its on-screen mark,
// over a footer line that never wraps, holding its status then other plugins'
// row parts (`contributedParts`),
// each chat pane's frame and focus edges, the tab bar's prompts around its
// strip, other plugins' bar parts (`contributedParts`) after them, then its
// close prompt and pane controls, each tab's icon with no label, and the
// rename dialog's title box over why a title was refused and the hint, in the
// class names its `layout.css` styles.

const UNTITLED_ROW_TEXT = 'New Chat';

/** @type {NonNullable<import('../layout').SessionRowInput['activity']>} */
const MARKED_ROW_ACTIVITY = { word: 'needs you', tone: 'attention' };

// A state the user should act on takes a Tag; any other is plain text.
/**
 * @param {HTMLElement} parent
 * @param {NonNullable<import('../layout').SessionRowInput['activity']>} activity
 * @param {Parameters<import('../layout').CompleteLayout['row']>[2]} kit
 */
function drawActivityLabel(parent, { word, tone }, kit) {
  const text = word.charAt(0).toUpperCase() + word.slice(1);
  if (tone === 'attention' || tone === 'warning' || tone === 'error') {
    kit.tag(parent, text, tone);
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
    const rows = kit.el(element, 'nav', 'session-sidebar');
    rows.setAttribute('aria-label', 'Sessions');
    return { element, rows };
  },

  section(parent, input, kit) {
    const element = kit.el(parent, 'div', 'session-section');
    kit.el(element, 'div', 'session-section-label', input.label);
    kit.el(element, 'div', 'session-section-drop-hint', input.dropHint);
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
    const activity =
      input.activity ?? (input.marked ? MARKED_ROW_ACTIVITY : null);
    if (activity !== null) {
      drawActivityLabel(kit.rowTrailing(element), activity, kit);
    }
    const foot = kit.el(element, 'div', 'session-row-foot');
    if (input.status !== null) {
      kit.el(foot, 'span', 'session-row-status', input.status);
    }
    kit.contributedParts(foot);
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

  renameDialog(parent, input, kit) {
    const element = kit.el(parent, 'div', 'session-rename');
    kit.textBox(element);
    if (input.problem !== null) {
      kit.el(element, 'p', 'session-rename-problem', input.problem);
    }
    kit.el(element, 'p', 'session-rename-hint', input.hint);
    return { element };
  },
};

export default layout;
