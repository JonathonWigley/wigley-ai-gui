// @ts-check

// The built-in workflow look: a one-line chip under the session row (the
// stage as an accent tag, its detail, the countdown and the main action), a
// strip above the composer (the stepper, the detail, the countdown and every
// action, or only a dim Start feature in idle), and the Flow tab (the plan's
// title, the stepper, the checklist by wave and every action).

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
    if (input.stage === 'idle') {
      strip.classList.add('workflow-strip--idle');
      const startFeature = input.actions[0];
      if (startFeature !== undefined) {
        kit.actionButton(strip, startFeature, { variant: 'ghost' });
      }
      return { element: strip };
    }
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
    kit.sectionHeader(flow, input.planTitle ?? input.label);
    kit.stepper(flow, input.steps);
    const status = kit.el(flow, 'p', 'workflow-flow-detail', input.detail);
    if (input.countdown !== null) {
      kit.countdown(status, input.countdown);
    }
    if (input.waves.length === 0) {
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
