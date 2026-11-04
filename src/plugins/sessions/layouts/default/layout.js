// @ts-check

// The built-in Sessions look: the side bar's "Sessions" header over its two
// sections, Favorites then Recent, each a label beside a hairline and a drop
// hint over its groups, each group a project's header (name, count, star and
// grip) over its rows,
// each row a card: its title (the folder label for a row with no title; no
// harness name), its activity's dot or, with no activity, its attention dot,
// and its on-screen mark, over a footer holding its status then other plugins'
// row parts (`contributedParts`),
// each chat pane's frame and focus edges, the tab bar's prompts around its
// strip, other plugins' bar parts (`contributedParts`) after them, then its
// close prompt and pane controls, each tab's icon with no label, and the
// rename dialog's title box over why a title was refused and the hint, in the
// class names its `layout.css` styles.

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
      label: input.title ?? input.label,
    });
    element.classList.add('session-row');
    element.classList.toggle('is-on-screen', input.onScreen);
    if (input.activity !== null) {
      kit.statusDot(kit.rowTrailing(element), input.activity.tone);
    } else if (input.marked) {
      kit.statusDot(kit.rowTrailing(element), 'attention');
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
    element.classList.toggle('is-focused', input.isFocused);
    const body = kit.el(element, 'div', 'session-pane-body');
    for (const direction of input.edges) {
      kit.focusEdge(element, direction);
    }
    return { element, body };
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
