// @ts-check

// The built-in agent-strip look: each box a card of fixed width. A subagent
// box holds its status dot and name, its model, effort and cost, its task cut
// to one line and its latest tool calls in mono, which an open box swaps for
// the list of every call. A task box holds its status dot, a terminal icon and
// what it runs, then its owner and elapsed time, and its command in mono while
// open. A finished box dims; the selected one takes the focus ring and the
// prompt of the keys that type in the chat box.

/** @typedef {import('../layout').AgentStripKit} AgentStripKit */
/** @typedef {import('../layout').ToolLineInput} ToolLineInput */

/** @type {import('../layout').CompleteLayout} */
const layout = {
  agentBox(parent, input, kit) {
    const element = kit.card(parent, boxClass('agent-strip-agent', input));
    const head = kit.el(element, 'div', 'agent-strip-head');
    kit.statusDot(head, input.status);
    kit.el(head, 'span', 'agent-strip-name', input.name);
    if (input.meta !== '') {
      kit.el(element, 'div', 'agent-strip-meta', input.meta);
    }
    kit.el(element, 'div', 'agent-strip-description', input.description);
    if (!input.isOpen && input.recentTools.length > 0) {
      const recent = kit.el(element, 'div', 'agent-strip-recent');
      for (const tool of input.recentTools) {
        toolLine(recent, tool, kit);
      }
    }
    if (input.isSelected) {
      cursorPrompt(element, kit);
    }
    return { element };
  },
  taskBox(parent, input, kit) {
    const element = kit.card(parent, boxClass('agent-strip-task', input));
    const head = kit.el(element, 'div', 'agent-strip-head');
    kit.statusDot(head, input.status);
    kit.icon(head, 'terminal', 'agent-strip-task-icon');
    kit.el(head, 'span', 'agent-strip-name', input.description);
    const meta = kit.el(
      element,
      'div',
      'agent-strip-meta',
      taskMeta(input, kit),
    );
    if (input.isOpen) {
      kit.el(
        element,
        'div',
        'agent-strip-command',
        input.command ?? 'no command',
      );
    }
    if (input.isSelected) {
      cursorPrompt(element, kit);
    }
    return {
      element,
      update(next) {
        meta.textContent = taskMeta(next, kit);
      },
    };
  },
  toolList(parent, input, kit) {
    const element = kit.el(parent, 'div', 'agent-strip-toolList');
    for (const tool of input.tools) {
      toolLine(element, tool, kit);
    }
    return { element };
  },
};

/**
 * @param {string} kindClass
 * @param {{ isDimmed: boolean; isSelected: boolean; isOpen: boolean }} input
 */
function boxClass(kindClass, input) {
  return [
    'agent-strip-box',
    kindClass,
    input.isDimmed ? 'is-dimmed' : '',
    input.isSelected ? 'is-selected' : '',
    input.isOpen ? 'is-open' : '',
  ]
    .filter((name) => name !== '')
    .join(' ');
}

/**
 * A task box's owner, then its elapsed time while it runs.
 * @param {import('../layout').TaskBoxInput} input
 * @param {AgentStripKit} kit
 */
function taskMeta(input, kit) {
  return input.elapsedMs === null
    ? input.owner
    : `${input.owner} · ${kit.duration(input.elapsedMs)}`;
}

/**
 * One tool call as a mono line, its status on `data-status`.
 * @param {HTMLElement} parent
 * @param {ToolLineInput} tool
 * @param {AgentStripKit} kit
 */
function toolLine(parent, tool, kit) {
  const line = kit.el(
    parent,
    'div',
    'agent-strip-tool',
    `${tool.tool} ${tool.summary}`,
  );
  line.dataset.status = tool.status;
}

/**
 * The selected box's cursor prompt: the keys that leave it for the chat box.
 * @param {HTMLElement} element
 * @param {AgentStripKit} kit
 */
function cursorPrompt(element, kit) {
  const line = kit.el(element, 'div', 'agent-strip-prompt');
  kit.keyHint(line, 'focusBox', { label: 'to type' });
  kit.keyHint(line, 'appendBox', { label: 'to append' });
}

export default layout;
