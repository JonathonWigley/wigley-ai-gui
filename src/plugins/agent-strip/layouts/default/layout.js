// @ts-check

// The built-in agent-strip look. A subagent box is a card of fixed width: its
// running dot, name, kind tag and runtime, then its description cut to one line,
// its model and effort, its latest tool calls in mono, which an open box drops,
// and a footer of its context bar and cost. The app draws an open subagent box's
// list of every call after all of these. A task box is a row the composer's
// width: its running dot, Shell tag (Task when it has no command), command or
// else description in mono and runtime on one line.
// An open row wraps the command and adds its owner under the line. The selected
// box takes the focus ring and the prompt of the keys that type in the chat box.

/** @typedef {import('../layout').AgentStripKit} AgentStripKit */
/** @typedef {import('../layout').AgentBoxInput} AgentBoxInput */
/** @typedef {import('../layout').TaskBoxInput} TaskBoxInput */
/** @typedef {import('../layout').ToolLineInput} ToolLineInput */

// The share of its context window at which a subagent's bar turns the warning colour.
const CONTEXT_WARNING_RATIO = 0.8;

/** @type {import('../layout').CompleteLayout} */
const layout = {
  agentBox(parent, input, kit) {
    const element = kit.card(parent, boxClass('agent-strip-agent', input));
    const isBackground = input.kind === 'backgroundAgent';
    const runtime = boxTop(
      element,
      input,
      isBackground ? 'Background agent' : 'Subagent',
      isBackground ? 'accent' : 'neutral',
      kit,
    );
    const modelLine = [input.model, input.effort]
      .filter((part) => part !== null)
      .join(' · ');
    if (modelLine !== '') {
      kit.el(element, 'div', 'agent-strip-model', modelLine);
    }
    if (!input.isOpen) {
      const recent = kit.el(element, 'div', 'agent-strip-recent');
      for (const tool of input.recentTools) {
        toolLine(recent, tool, kit);
      }
    }
    agentFooter(element, input, kit);
    if (input.isSelected) {
      cursorPrompt(element, kit);
    }
    return {
      element,
      update(next) {
        runtime.textContent = kit.duration(next.elapsedMs);
      },
    };
  },
  taskBox(parent, input, kit) {
    const element = kit.card(parent, boxClass('agent-strip-task', input));
    const line = kit.el(element, 'div', 'agent-strip-row-line');
    kit.statusDot(line, 'running');
    kit.tag(line, input.command === null ? 'Task' : 'Shell', 'accent');
    kit.el(
      line,
      'div',
      'agent-strip-command',
      input.command ?? input.description,
    );
    if (input.isSelected) {
      cursorPrompt(line, kit);
    }
    const runtime = kit.el(
      line,
      'span',
      'agent-strip-runtime',
      kit.duration(input.elapsedMs),
    );
    if (input.isOpen) {
      kit.el(element, 'div', 'agent-strip-row-owner', rowOwner(input));
    }
    return {
      element,
      update(next) {
        runtime.textContent = kit.duration(next.elapsedMs);
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
 * @param {{ isSelected: boolean; isOpen: boolean }} input
 */
function boxClass(kindClass, input) {
  return [
    'agent-strip-box',
    kindClass,
    input.isSelected ? 'is-selected' : '',
    input.isOpen ? 'is-open' : '',
  ]
    .filter((name) => name !== '')
    .join(' ');
}

/**
 * What an open row says under its line: its owner, and its description unless
 * the command line already shows it.
 * @param {TaskBoxInput} input
 */
function rowOwner(input) {
  return input.command === null
    ? input.name
    : `${input.name} · ${input.description}`;
}

/**
 * An agent box's head row and description; returns the runtime `update` rewrites.
 * @param {HTMLElement} element
 * @param {{ name: string; description: string; elapsedMs: number }} input
 * @param {string} tagText
 * @param {import('../../../../shared/page/layout-host/kit').TagTone} tagTone
 * @param {AgentStripKit} kit
 */
function boxTop(element, input, tagText, tagTone, kit) {
  const head = kit.el(element, 'div', 'agent-strip-head');
  kit.statusDot(head, 'running');
  kit.el(head, 'span', 'agent-strip-name', input.name);
  kit.tag(head, tagText, tagTone);
  const runtime = kit.el(
    head,
    'span',
    'agent-strip-runtime',
    kit.duration(input.elapsedMs),
  );
  kit.el(element, 'div', 'agent-strip-description', input.description);
  return runtime;
}

/**
 * The context bar and text, then the cost, each left out while unknown; no
 * footer when both are.
 * @param {HTMLElement} element
 * @param {AgentBoxInput} input
 * @param {AgentStripKit} kit
 */
function agentFooter(element, input, kit) {
  const { contextTokens, contextWindow, spendUsd } = input;
  if (contextTokens === null && spendUsd === null) {
    return;
  }
  const footer = kit.el(element, 'div', 'agent-strip-footer');
  if (contextTokens !== null) {
    if (contextWindow !== null) {
      contextBar(footer, contextTokens / contextWindow, kit);
    }
    kit.el(
      footer,
      'span',
      'agent-strip-context',
      contextWindow === null
        ? tokenCount(contextTokens)
        : `${tokenCount(contextTokens)}/${tokenCount(contextWindow)}`,
    );
  }
  if (spendUsd !== null) {
    kit.el(footer, 'span', 'agent-strip-cost', `$${spendUsd.toFixed(2)}`);
  }
}

/**
 * A meter filled to `ratio`, held to full, in the warning tone once `ratio`
 * reaches the warning share.
 * @param {HTMLElement} footer
 * @param {number} ratio
 * @param {AgentStripKit} kit
 */
function contextBar(footer, ratio, kit) {
  const percent = Math.min(100, Math.round(ratio * 100));
  kit.meter(
    footer,
    percent,
    ratio >= CONTEXT_WARNING_RATIO ? 'warning' : 'normal',
  );
}

/**
 * `84k`, or `1.2M` from where the thousands would round to `1000k`.
 * @param {number} tokens
 */
function tokenCount(tokens) {
  return tokens >= 999_500
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : `${Math.round(tokens / 1000)}k`;
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
 * @param {HTMLElement} parent
 * @param {AgentStripKit} kit
 */
function cursorPrompt(parent, kit) {
  const line = kit.el(parent, 'div', 'agent-strip-prompt');
  kit.keyHint(line, 'focusBox', { label: 'to type' });
  kit.keyHint(line, 'appendBox', { label: 'to append' });
}

export default layout;
