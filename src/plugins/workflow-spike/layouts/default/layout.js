// @ts-check

// The built-in Spike look: a one-line chip under the session row (the level's
// badge, then the stage's tag, coloured and pulsing by its status), the stepper's
// trail above the composer, ending on the Headless chip, and the side pane
// beside the transcript (the status mark and line, the count, the progress bar
// and the checklist as one flat list).

/** @typedef {import('../../../workflow/layouts/layout').SideGroupInput} SideGroupInput */
/** @typedef {import('../../../workflow/layouts/layout').SidePaneInput} SidePaneInput */
/** @typedef {import('../../../workflow/layouts/layout').WorkflowKit} WorkflowKit */

/**
 * The status mark, when the stage has a status, then the status line.
 * @param {HTMLElement} parent
 * @param {SidePaneInput} input
 * @param {WorkflowKit} kit
 */
function drawStatusLine(parent, input, kit) {
  if (input.status !== null) {
    kit.statusMark(parent, input.status);
  }
  kit.el(parent, 'span', 'workflow-status-line', input.statusLine);
}

/**
 * The input's groups in order: finished, current, later.
 * @param {SidePaneInput} input
 * @returns {readonly SideGroupInput[]}
 */
function allGroups(input) {
  return [
    ...input.finishedGroups,
    ...(input.currentGroup === null ? [] : [input.currentGroup]),
    ...input.laterGroups,
  ];
}

/**
 * The scrolling checklist: every group's items, each with its mark.
 * @param {HTMLElement} parent
 * @param {SidePaneInput} input
 * @param {WorkflowKit} kit
 */
function drawChecklist(parent, input, kit) {
  const items = kit.el(kit.sideList(parent), 'ul', 'workflow-side-tasks');
  for (const item of allGroups(input).flatMap((group) => group.items)) {
    const mark = kit.statusMark(items, item.state);
    kit.row(items, {
      density: 'list',
      tag: 'li',
      label: item.text,
      leading: mark,
    });
  }
}

/** @type {import('../../../workflow/layouts/layout').CompleteLayout} */
const layout = {
  chip(parent, input, kit) {
    const chip = kit.el(parent, 'div', 'workflow-chip');
    kit.badge(chip, input.badge, input.workflowLabel);
    if (!input.onRowLabel) {
      kit.stageTag(chip, input.label + input.progress, input.status);
    }
    return { element: chip };
  },

  strip(parent, input, kit) {
    const strip = kit.el(parent, 'div', 'workflow-strip');
    kit.stepper(strip, input.steps);
    kit.headlessChip(strip, input.headless);
    return { element: strip };
  },

  sidePane(parent, input, kit) {
    const pane = kit.el(parent, 'div', 'workflow-side-pane');
    drawStatusLine(kit.el(pane, 'div', 'workflow-side-status'), input, kit);
    kit.el(pane, 'p', 'workflow-side-count', `${input.checked}/${input.total}`);
    const percent = input.total === 0 ? 0 : (input.checked / input.total) * 100;
    kit.meter(pane, percent, 'normal');
    drawChecklist(pane, input, kit);
    return { element: pane };
  },
};

export default layout;
