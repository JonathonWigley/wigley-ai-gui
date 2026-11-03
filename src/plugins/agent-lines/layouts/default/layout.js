// @ts-check

// The built-in agent-lines look: one line while the session runs anything, a
// running dot before the elapsed time of its longest-running work.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  workingLine(parent, input, kit) {
    const element = kit.el(parent, 'div', 'agent-lines-line');
    kit.statusDot(element, 'running');
    kit.el(
      element,
      'span',
      'agent-lines-line-elapsed',
      kit.duration(input.elapsedMs),
    );
    return { element };
  },
};

export default layout;
