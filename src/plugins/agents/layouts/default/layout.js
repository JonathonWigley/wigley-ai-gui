// @ts-check

// The built-in agents look: one line per running subagent, a running dot
// before its type, its task cut to one line, then its elapsed time and its
// tool-call count; one line per running task, a terminal icon before what it
// runs, cut to one line, then its elapsed time, indented under its subagent.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  agentLine(parent, input, kit) {
    const element = kit.el(parent, 'div', 'agents-line');
    kit.statusDot(element, 'running');
    kit.el(element, 'span', 'agents-line-type', input.agentType);
    kit.el(element, 'span', 'agents-line-description', input.description);
    kit.el(
      element,
      'span',
      'agents-line-elapsed',
      kit.duration(input.elapsedMs),
    );
    kit.el(element, 'span', 'agents-line-tools', toolsText(input.toolCalls));
    return { element };
  },
  taskLine(parent, input, kit) {
    const element = kit.el(
      parent,
      'div',
      input.isNested
        ? 'agents-line agents-task-line agents-task-line-nested'
        : 'agents-line agents-task-line',
    );
    kit.icon(element, 'terminal', 'agents-task-icon');
    kit.el(element, 'span', 'agents-line-description', input.description);
    kit.el(
      element,
      'span',
      'agents-line-elapsed',
      kit.duration(input.elapsedMs),
    );
    return { element };
  },
};

/** @param {number} count */
function toolsText(count) {
  return count === 1 ? '1 tool' : `${count} tools`;
}

export default layout;
