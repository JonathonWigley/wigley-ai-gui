// @ts-check

// The built-in system stats look: a section header, then one row per meter (its label, a Meter, the value and a
// Sparkline), RAM's memory note under its row, then the process list: a heading row naming the columns, the sorted one
// marked, and one tree row per group or process with its CPU, RAM and GPU cells. A group row leads with a chevron;
// the keyboard cursor's row takes the focus ring. The sort key's hint sits at the end of the section header. In a
// narrow bar each meter takes two lines and each row's cells drop under its name.

/** @type {ReadonlyArray<{ column: 'cpu' | 'ram' | 'gpu', text: string }>} */
const COLUMNS = [
  { column: 'cpu', text: 'CPU' },
  { column: 'ram', text: 'RAM' },
  { column: 'gpu', text: 'GPU' },
];

/** @type {import('../layout').CompleteLayout} */
const layout = {
  panel(parent, input, kit) {
    const element = kit.el(parent, 'div', 'system-stats-panel');
    const header = kit.sectionHeader(element, 'System stats');
    if (input.reading) {
      kit.emptyState(element, 'Reading the machine…');
      return { element };
    }
    const meters = kit.el(element, 'div', 'system-stats-meters');
    for (const meter of input.meters) {
      drawMeter(meters, meter, kit);
    }
    if (input.error !== null) {
      kit.el(
        element,
        'p',
        'system-stats-error',
        `Could not read the machine: ${input.error}`,
      );
    }
    kit.keyHint(header, 'cycleSort', { label: 'sort' });
    drawHeadings(element, input, kit);
    if (input.rows.length === 0 && input.error === null) {
      kit.emptyState(element, 'No processes');
    }
    for (const row of input.rows) {
      drawRow(element, row, kit);
    }
    if (input.moreRows > 0) {
      kit.el(element, 'div', 'system-stats-more', `${input.moreRows} more`);
    }
    return { element };
  },
};

/**
 * @param {HTMLElement} parent
 * @param {import('../layout').StatsMeterInput} meter
 * @param {import('../layout').SystemStatsKit} kit
 */
function drawMeter(parent, meter, kit) {
  const row = kit.el(parent, 'div', 'system-stats-meter');
  kit.el(row, 'span', 'system-stats-meter-label', meter.label);
  kit.meter(row, meter.percent ?? 0, meter.tone);
  kit.el(row, 'span', 'system-stats-meter-value', meter.value);
  kit.sparkline(row, meter.history, meter.tone);
  if (meter.note !== null) {
    kit.el(parent, 'div', 'system-stats-meter-note', meter.note);
  }
}

// The column headings over the rows: a spacer the chevron's width, `Process`, then the three cells the rows' cells
// line up under.
/**
 * @param {HTMLElement} parent
 * @param {import('../layout').PanelInput} input
 * @param {import('../layout').SystemStatsKit} kit
 */
function drawHeadings(parent, input, kit) {
  const headings = kit.el(parent, 'div', 'system-stats-headings');
  kit.el(headings, 'span', 'system-stats-chevron');
  kit.el(headings, 'span', 'system-stats-heading-name', 'Process');
  const cells = kit.el(headings, 'span', 'system-stats-cells');
  for (const { column, text } of COLUMNS) {
    const isSorted = column === input.sort;
    const cell = kit.el(
      cells,
      'span',
      'system-stats-cell',
      isSorted ? `${text} ▾` : text,
    );
    cell.classList.toggle('is-sorted', isSorted);
  }
}

/**
 * @param {HTMLElement} parent
 * @param {import('../layout').StatsRowInput} input
 * @param {import('../layout').SystemStatsKit} kit
 */
function drawRow(parent, input, kit) {
  const chevron = kit.el(parent, 'span', 'system-stats-chevron');
  if (input.kind === 'app' || input.kind === 'session') {
    kit.icon(chevron, input.isOpen ? 'chevron-down' : 'chevron-right');
  }
  const cells = kit.el(parent, 'span', 'system-stats-cells');
  for (const text of [input.cpu, input.ram, input.gpu]) {
    kit.el(cells, 'span', 'system-stats-cell', text);
  }
  const row = kit.row(parent, {
    density: 'tree',
    label: input.name,
    depth: input.depth,
    leading: chevron,
    trailing: cells,
  });
  row.classList.add('system-stats-row');
  row.classList.toggle('is-cursor', input.isCursor);
  row.title = input.name;
}

export default layout;
