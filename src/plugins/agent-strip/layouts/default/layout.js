// @ts-check

// The built-in agent-strip look: each box a card of fixed width. Every box
// heads with its running dot, name, kind tag and runtime, then its description
// cut to one line. A subagent box adds its model and effort, its latest tool
// calls in mono, which an open box drops, and a footer of its context bar and
// cost. A task box adds its command in mono, one line until open. The selected
// box takes the focus ring and the prompt of the keys that type in the chat box.
// The app draws an open subagent box's list of every call after all of these.

/** @typedef {import('../layout').AgentStripKit} AgentStripKit */
/** @typedef {import('../layout').AgentBoxInput} AgentBoxInput */
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
    const runtime = boxTop(element, input, 'Shell', 'accent', kit);
    kit.el(
      element,
      'div',
      'agent-strip-command',
      input.command ?? 'no command',
    );
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
 * Every box's head row and description; returns the runtime `update` rewrites.
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
 * @param {HTMLElement} element
 * @param {AgentStripKit} kit
 */
function cursorPrompt(element, kit) {
  const line = kit.el(element, 'div', 'agent-strip-prompt');
  kit.keyHint(line, 'focusBox', { label: 'to type' });
  kit.keyHint(line, 'appendBox', { label: 'to append' });
}

export default layout;
