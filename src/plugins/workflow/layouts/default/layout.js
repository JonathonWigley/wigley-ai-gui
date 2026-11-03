// @ts-check

// The built-in workflow look: a one-line chip under the session row (the
// stage as an accent tag, its detail, the countdown and the main action), a
// strip above the composer (the stepper, the detail, the countdown and every
// action), and the Flow tab (the stage's label, the stepper, the detail, the
// checklist by wave and every action).

/** @type {import('../layout').CompleteLayout} */
const layout = {
  chip(parent, input, kit) {
    const chip = kit.el(parent, 'div', 'workflow-chip');
    kit.tag(chip, input.label, 'accent');
    kit.el(chip, 'span', 'workflow-chip-detail', input.detail);
    if (input.countdown !== null) {
      kit.countdown(chip, input.countdown);
    }
    if (input.mainAction !== null) {
      kit.actionButton(chip, input.mainAction, {
        anchor: false,
        variant: 'ghost',
      });
    }
    return { element: chip };
  },

  strip(parent, input, kit) {
    const strip = kit.el(parent, 'div', 'workflow-strip');
    kit.stepper(strip, input.steps);
    kit.el(strip, 'span', 'workflow-strip-detail', input.detail);
    if (input.countdown !== null) {
      kit.countdown(strip, input.countdown);
    }
    for (const action of input.actions) {
      kit.actionButton(strip, action);
    }
    return { element: strip };
  },

  flowTab(parent, input, kit) {
    const flow = kit.el(parent, 'div', 'workflow-flow');
    kit.sectionHeader(flow, input.label);
    kit.stepper(flow, input.steps);
    const status = kit.el(flow, 'p', 'workflow-flow-detail', input.detail);
    if (input.countdown !== null) {
      kit.countdown(status, input.countdown);
    }
    const hasPlan = input.planTitle !== null || input.waves.length > 0;
    if (!hasPlan) {
      kit.emptyState(flow, 'No plan yet');
    }
    for (const wave of input.waves) {
      const header = kit.sectionHeader(flow, wave.title);
      if (wave.current) {
        header.classList.add('is-current');
      }
      const tasks = kit.el(flow, 'ul', 'workflow-flow-tasks');
      for (const task of wave.tasks) {
        const mark = kit.icon(
          tasks,
          task.done ? 'pass-filled' : 'circle-large',
          'workflow-task-mark',
        );
        kit.row(tasks, {
          density: 'list',
          tag: 'li',
          label: task.text,
          leading: mark,
        });
      }
    }
    const actions = kit.el(flow, 'div', 'workflow-flow-actions');
    for (const action of input.actions) {
      kit.actionButton(actions, action);
    }
    return { element: flow };
  },
};

export default layout;
