// @ts-check

// The built-in Sessions look: the side bar's "Sessions" header over its rows,
// each row's label, harness, attention dot and status line, the tab bar's
// prompts around its strip, and each tab's icon with no label, in the class
// names `sessions.css` styles.

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

  row(parent, input, kit) {
    const element = kit.row(parent, {
      density: 'list',
      label: input.label,
      detail: input.harness || null,
    });
    element.classList.add('session-row');
    if (input.marked) {
      kit.statusDot(kit.rowTrailing(element), 'attention');
    }
    if (input.status !== null) {
      kit.el(element, 'span', 'session-row-status', input.status);
    }
    return { element };
  },

  tabBar(parent, kit) {
    const element = kit.el(parent, 'div', 'session-tabs-bar');
    kit.prevTabEdge(element);
    const strip = kit.el(element, 'nav', 'ui-tabs session-tabs');
    strip.setAttribute('aria-label', 'Tabs');
    kit.nextTabEdge(element);
    kit.closeHint(element);
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
};

export default layout;
