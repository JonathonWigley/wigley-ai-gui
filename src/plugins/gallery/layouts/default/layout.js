// @ts-check

// The built-in Gallery mode look. Every part appends its root to `parent`
// first and returns it.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  head(parent, input, kit) {
    const status = kit.el(parent, 'div', 'gallery-status');
    kit.el(
      status,
      'span',
      'gallery-status-text',
      `Transparency: ${input.transparency ?? 'from settings'}`,
    );
    kit.transparencyHint(status);
    return { element: status };
  },
  section(parent, input, kit) {
    const section = kit.el(parent, 'section', 'gallery-section');
    kit.sectionHeader(section, input.name);
    input.rows.forEach((cells, row) => {
      const states = kit.el(section, 'div', 'gallery-states');
      cells.forEach((_, column) => kit.cell(states, row, column));
    });
    return { element: section };
  },
  framedSection(parent, input, kit) {
    const section = kit.el(
      parent,
      'section',
      'gallery-section gallery-section--framed',
    );
    kit.sectionHeader(section, input.name);
    const frame = kit.el(
      section,
      'div',
      input.isDialog ? 'gallery-frame gallery-frame--dialog' : 'gallery-frame',
    );
    kit.sample(frame);
    return { element: section };
  },
  cell(parent, input, kit) {
    const cell = kit.el(
      parent,
      'figure',
      input.isWide ? 'gallery-cell gallery-cell--wide' : 'gallery-cell',
    );
    kit.sample(cell);
    kit.el(cell, 'figcaption', 'gallery-caption', input.caption);
    return { element: cell };
  },
};

export default layout;
