// @ts-check

// The built-in workflow look: a one-line chip under the session row (the
// stage and its status as an accent tag, unless the row's label says it, and
// the countdown), a strip above the
// composer (the stepper until a plan is read, the status mark and line when the
// stepper does not show the stage, the countdown and the main action), and the
// side pane beside the transcript (the
// status mark and line, the detail, the stepper, the progress bar, the
// checklist and every action).

/** @typedef {import('../layout').SideWaveInput} SideWaveInput */
/** @typedef {import('../layout').SidePaneInput} SidePaneInput */
/** @typedef {import('../layout').StripInput} StripInput */
/** @typedef {import('../layout').WorkflowKit} WorkflowKit */

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
 * `<n> waves · <m> done`, `<m>` counting the tasks in `waves`.
 * @param {readonly SideWaveInput[]} waves
 * @returns {string}
 */
function foldText(waves) {
  const count = waves.length === 1 ? '1 wave' : `${waves.length} waves`;
  const tasks = waves.reduce((sum, wave) => sum + wave.tasks.length, 0);
  return `${count} · ${tasks} done`;
}

/**
 * A wave's title over its tasks, each with its mark.
 * @param {HTMLElement} parent
 * @param {SideWaveInput} wave
 * @param {WorkflowKit} kit
 */
function drawWave(parent, wave, kit) {
  kit.sectionHeader(parent, wave.title);
  const tasks = kit.el(parent, 'ul', 'workflow-side-tasks');
  for (const task of wave.tasks) {
    const mark = kit.statusMark(tasks, task.state);
    kit.row(tasks, {
      density: 'list',
      tag: 'li',
      label: task.text,
      leading: mark,
    });
  }
}

/**
 * A later wave's one line: its title, then its one task's text or its count.
 * @param {HTMLElement} parent
 * @param {SideWaveInput} wave
 * @param {WorkflowKit} kit
 */
function drawLaterWave(parent, wave, kit) {
  kit.row(parent, {
    density: 'list',
    label: wave.title,
    detail:
      wave.tasks.length === 1
        ? wave.tasks[0].text
        : `${wave.tasks.length} tasks`,
  });
}

/**
 * The scrolling checklist: the fold, the current wave and the later waves.
 * @param {HTMLElement} parent
 * @param {SidePaneInput} input
 * @param {WorkflowKit} kit
 */
function drawChecklist(parent, input, kit) {
  const list = kit.sideList(parent);
  if (input.finishedWaves.length > 0) {
    kit.finishedFold(list, foldText(input.finishedWaves), input.finishedOpen);
  }
  if (input.finishedOpen) {
    for (const wave of input.finishedWaves) {
      drawWave(list, wave, kit);
    }
  }
  if (input.currentWave !== null) {
    drawWave(list, input.currentWave, kit);
  }
  if (input.laterWaves.length > 0) {
    kit.sectionHeader(list, 'Up next');
    for (const wave of input.laterWaves) {
      drawLaterWave(list, wave, kit);
    }
  }
}

/** @type {import('../layout').CompleteLayout} */
const layout = {
  chip(parent, input, kit) {
    const chip = kit.el(parent, 'div', 'workflow-chip');
    if (!input.onRowLabel) {
      kit.tag(chip, input.statusText, 'accent');
    }
    if (input.countdown !== null) {
      kit.countdown(chip, input.countdown);
    }
    return { element: chip };
  },

  strip(parent, input, kit) {
    const strip = kit.el(parent, 'div', 'workflow-strip');
    const stepperShowsStage =
      !input.hasPlan && input.steps.some((step) => step.id === input.stage);
    if (!stepperShowsStage) {
      drawStatusLine(strip, input, kit);
    }
    if (!input.hasPlan) {
      kit.stepper(strip, input.steps);
    }
    if (input.countdown !== null) {
      kit.countdown(strip, input.countdown);
    }
    const mainAction = input.actions.find((action) => action.main);
    if (mainAction !== undefined) {
      kit.actionButton(strip, mainAction);
    }
    return { element: strip };
  },

  sidePane(parent, input, kit) {
    const pane = kit.el(parent, 'div', 'workflow-side-pane');
    drawStatusLine(kit.el(pane, 'div', 'workflow-side-status'), input, kit);
    kit.el(pane, 'p', 'workflow-side-detail', input.detail);
    kit.stepper(pane, input.steps);
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
