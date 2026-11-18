// @ts-check

// The built-in demo look. The step list: a hint line (the step agent's key, then `autoplay` and `real sessions shown`
// tags while they hold), then each section's header over one list row per step, the current step's beats indented
// under it as tree rows with the shown beat marked; the keyboard cursor's row takes the focus ring. The caption: the
// step's number of the count, its title, then its caption line.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  steps(parent, input, kit) {
    const element = kit.el(parent, 'div', 'demo-steps');
    const hints = kit.el(element, 'div', 'demo-hints');
    kit.keyHint(hints, 'askAgent', { label: true });
    if (input.autoplay) {
      kit.tag(hints, 'autoplay', 'running');
    }
    if (input.realShown) {
      kit.tag(hints, 'real sessions shown', 'info');
    }
    for (const section of input.sections) {
      kit.sectionHeader(element, section.title);
      for (const step of section.steps) {
        drawStep(element, step, kit);
      }
    }
    return { element };
  },
  caption(parent, input, kit) {
    const element = kit.el(parent, 'span', 'demo-caption');
    kit.el(
      element,
      'span',
      'demo-caption-number',
      `${input.stepNumber}/${input.stepCount}`,
    );
    kit.el(element, 'span', 'demo-caption-title', input.title);
    kit.el(element, 'span', 'demo-caption-text', input.caption);
    return { element };
  },
};

/**
 * @param {HTMLElement} parent
 * @param {import('../layout').StepRowInput} step
 * @param {import('../layout').DemoKit} kit
 */
function drawStep(parent, step, kit) {
  const row = kit.row(parent, { density: 'list', label: step.title });
  row.classList.add('demo-step');
  row.classList.toggle('is-current', step.isCurrent);
  row.classList.toggle('is-cursor', step.isCursor);
  row.title = step.id;
  for (const beat of step.beats) {
    const beatRow = kit.row(parent, {
      density: 'tree',
      label: beat.name,
      depth: 1,
    });
    beatRow.classList.add('demo-beat');
    beatRow.classList.toggle('is-current', beat.isCurrent);
  }
}

export default layout;
