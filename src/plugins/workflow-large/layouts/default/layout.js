// @ts-check

// The built-in workflow look: a one-line chip under the session row (the
// level's badge, the stage's tag with its progress (`Make 3/8`), coloured and
// pulsing by its status, unless the
// row's label says it, and the countdown), a strip above the
// composer (the stepper's trail while it shows the stage; for a stage outside
// it, the status mark and line, with the trail until a checklist exists; the
// countdown, the main action and the Headless chip), and the
// side pane beside the transcript (the
// status mark and line, the detail, the progress bar, the
// checklist and every action).

/** @typedef {import('../../../workflow/layouts/layout').SideGroupInput} SideGroupInput */
/** @typedef {import('../../../workflow/layouts/layout').SidePaneInput} SidePaneInput */
/** @typedef {import('../../../workflow/layouts/layout').StripInput} StripInput */
/** @typedef {import('../../../workflow/layouts/layout').WorkflowKit} WorkflowKit */

/**
 * The status mark, when the stage has a status, then the status line.
 * @param {HTMLElement} parent
 * @param {StripInput} input
 * @param {WorkflowKit} kit
 */
function drawStatusLine(parent, input, kit) {
  if (input.status !== null) {
    kit.statusMark(parent, input.status);
  }
  kit.el(parent, 'span', 'workflow-status-line', input.statusLine);
}

/**
 * `<n> waves · <m> done`, `<m>` counting the items in `groups`.
 * @param {readonly SideGroupInput[]} groups
 * @returns {string}
 */
function foldText(groups) {
  const count = groups.length === 1 ? '1 wave' : `${groups.length} waves`;
  const items = groups.reduce((sum, group) => sum + group.items.length, 0);
  return `${count} · ${items} done`;
}

/**
 * A group's title over its items, each with its mark.
 * @param {HTMLElement} parent
 * @param {SideGroupInput} group
 * @param {WorkflowKit} kit
 */
function drawGroup(parent, group, kit) {
  kit.sectionHeader(parent, group.title);
  const items = kit.el(parent, 'ul', 'workflow-side-tasks');
  for (const item of group.items) {
    const mark = kit.statusMark(items, item.state);
    kit.row(items, {
      density: 'list',
      tag: 'li',
      label: item.text,
      leading: mark,
    });
  }
}

/**
 * The scrolling checklist: the fold, the current group and the later groups,
 * every group with its items in full.
 * @param {HTMLElement} parent
 * @param {SidePaneInput} input
 * @param {WorkflowKit} kit
 */
function drawChecklist(parent, input, kit) {
  const list = kit.sideList(parent);
  if (input.finishedGroups.length > 0) {
    kit.finishedFold(list, foldText(input.finishedGroups), input.finishedOpen);
  }
  if (input.finishedOpen) {
    for (const group of input.finishedGroups) {
      drawGroup(list, group, kit);
    }
  }
  if (input.currentGroup !== null) {
    drawGroup(list, input.currentGroup, kit);
  }
  for (const group of input.laterGroups) {
    drawGroup(list, group, kit);
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
    if (input.countdown !== null) {
      kit.countdown(chip, input.countdown);
    }
    return { element: chip };
  },

  strip(parent, input, kit) {
    const strip = kit.el(parent, 'div', 'workflow-strip');
    const stepperShowsStage = input.steps.some(
      (step) => step.id === input.stage,
    );
    if (!stepperShowsStage) {
      drawStatusLine(strip, input, kit);
    }
    if (stepperShowsStage || !input.hasChecklist) {
      kit.stepper(strip, input.steps);
    }
    if (input.countdown !== null) {
      kit.countdown(strip, input.countdown);
    }
    const mainAction = input.actions.find((action) => action.main);
    if (mainAction !== undefined) {
      kit.actionButton(strip, mainAction);
    }
    kit.headlessChip(strip, input.headless);
    return { element: strip };
  },

  sidePane(parent, input, kit) {
    const pane = kit.el(parent, 'div', 'workflow-side-pane');
    drawStatusLine(kit.el(pane, 'div', 'workflow-side-status'), input, kit);
    kit.el(pane, 'p', 'workflow-side-detail', input.detail);
    const percent = input.total === 0 ? 0 : (input.checked / input.total) * 100;
    kit.meter(pane, percent, 'normal');
    drawChecklist(pane, input, kit);
    if (input.actions.length > 0) {
      const actions = kit.el(pane, 'div', 'workflow-side-actions');
      for (const action of input.actions) {
        kit.actionButton(actions, action);
      }
    }
    return { element: pane };
  },
};

export default layout;
