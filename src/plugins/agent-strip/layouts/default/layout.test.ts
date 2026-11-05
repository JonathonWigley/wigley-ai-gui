import { describe, expect, it } from 'vitest';
import type { AgentBoxInput, AgentStripKit, TaskBoxInput } from '../layout';
import layout from './layout.js';

// The DOM surface the default layout uses. This layer may not import the
// page's shared fake DOM.
class FakeElement {
  tagName: string;
  className = '';
  ownText = '';
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    return (
      this.ownText + this.children.map((child) => child.textContent).join('')
    );
  }

  set textContent(text: string) {
    this.ownText = text;
    this.children = [];
  }

  get classList() {
    return {
      contains: (name: string) => this.className.split(' ').includes(name),
    };
  }

  append(node: FakeElement) {
    this.children.push(node);
  }

  // The first element under this one, itself included, carrying `className`.
  find(className: string): FakeElement | null {
    if (this.classList.contains(className)) {
      return this;
    }
    for (const child of this.children) {
      const found = child.find(className);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
}

function asHtml(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
}

function asFake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

// A kit whose parts append fake elements, a meter's percent and tone on its
// `dataset`; `hints` records each `keyHint`'s command.
function fakeKit() {
  const hints: string[] = [];
  const el = (
    parent: HTMLElement,
    tag: string,
    className = '',
    text = '',
  ): HTMLElement => {
    const node = new FakeElement(tag);
    node.className = className;
    node.ownText = text;
    asFake(parent).append(node);
    return asHtml(node);
  };
  const parts: Partial<AgentStripKit> = {
    el,
    card: (parent, className) =>
      el(parent, 'div', `ui-card ${className ?? ''}`),
    statusDot: (parent, status) => el(parent, 'span', `ui-dot ${status}`),
    tag: (parent, text, tone) =>
      el(parent, 'span', `ui-tag ui-tag--${tone}`, text),
    duration: (ms) => `${Math.floor(ms / 1000)}s`,
    meter(parent, percent, tone) {
      const node = el(parent, 'span', 'ui-meter');
      node.dataset.percent = String(percent);
      node.dataset.tone = tone;
      return node;
    },
    keyHint(parent, command) {
      hints.push(command);
      return el(parent, 'span', 'hint');
    },
  };
  return { kit: parts as AgentStripKit, hints };
}

const AGENT: AgentBoxInput = {
  name: 'map-decoder',
  kind: 'subagent',
  description: 'Map the stream decoder',
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  spendUsd: 0.0421,
  contextTokens: 84_000,
  contextWindow: 200_000,
  autocompactLimit: null,
  elapsedMs: 42_000,
  recentTools: [
    { tool: 'Read', summary: 'stream-decoder.ts', status: 'success' },
  ],
  isSelected: false,
  isOpen: false,
};

const TASK: TaskBoxInput = {
  name: 'kind-fixer',
  description: 'Run the self-test',
  command: 'npm run selftest',
  elapsedMs: 42_000,
  isSelected: false,
  isOpen: false,
};

// What a drawn box shows: its root, the key hints it named, and its text.
function drawn(
  draw: (
    parent: HTMLElement,
    kit: AgentStripKit,
  ) => { element: HTMLElement; update?(input: never): void },
) {
  const { kit, hints } = fakeKit();
  const parent = new FakeElement('div');
  const part = draw(asHtml(parent), kit);
  const root = asFake(part.element);
  expect(parent.children).toEqual([root]);
  return { root, part, hints };
}

const drawAgent = (input: Partial<AgentBoxInput> = {}) =>
  drawn((parent, kit) => layout.agentBox(parent, { ...AGENT, ...input }, kit));

const drawTask = (input: Partial<TaskBoxInput> = {}) =>
  drawn((parent, kit) => layout.taskBox(parent, { ...TASK, ...input }, kit));

describe('default agent-strip layout', () => {
  it.each<{
    case: string;
    box: () => ReturnType<typeof drawn>;
    name: string | null;
    tag: string;
  }>([
    {
      case: 'subagent',
      box: () => drawAgent(),
      name: 'map-decoder',
      tag: 'Subagent',
    },
    {
      case: 'background agent',
      box: () => drawAgent({ kind: 'backgroundAgent' }),
      name: 'map-decoder',
      tag: 'Background agent',
    },
    { case: 'task', box: () => drawTask(), name: null, tag: 'Shell' },
    {
      case: 'task without a command',
      box: () => drawTask({ command: null }),
      name: null,
      tag: 'Task',
    },
  ])('head_$case', ({ box, name, tag }) => {
    const { root } = box();

    expect({
      dot: root.find('ui-dot')?.classList.contains('running'),
      name: root.find('agent-strip-name')?.textContent ?? null,
      tag: root.find('ui-tag')?.textContent,
      runtime: root.find('agent-strip-runtime')?.textContent,
    }).toEqual({ dot: true, name, tag, runtime: '42s' });
  });

  it.each<{
    case: string;
    box: (selected: boolean) => ReturnType<typeof drawn>;
  }>([
    { case: 'agent', box: (isSelected) => drawAgent({ isSelected }) },
    { case: 'task', box: (isSelected) => drawTask({ isSelected }) },
  ])('selected_TakesRingAndPrompt ($case)', ({ box }) => {
    const plain = box(false);
    const selected = box(true);

    expect(plain.root.classList.contains('is-selected')).toBe(false);
    expect(plain.hints).toEqual([]);
    expect(selected.root.classList.contains('is-selected')).toBe(true);
    expect(selected.hints).toEqual(['focusBox', 'appendBox']);
  });

  it.each<{
    case: string;
    input: Partial<AgentBoxInput>;
    context: string | null;
    cost: string | null;
    percent: string | null;
    tone: string | undefined;
  }>([
    {
      case: 'under the warning share',
      input: { spendUsd: 0.4213 },
      context: '84k/200k',
      cost: '$0.42',
      percent: '42',
      tone: 'normal',
    },
    {
      case: 'past the warning share',
      input: { contextTokens: 166_000 },
      context: '166k/200k',
      cost: '$0.04',
      percent: '83',
      tone: 'warning',
    },
    {
      case: 'at the warning share',
      input: { contextTokens: 160_000 },
      context: '160k/200k',
      cost: '$0.04',
      percent: '80',
      tone: 'warning',
    },
    {
      case: 'rounds up to the share but stays under it',
      input: { contextTokens: 159_900 },
      context: '160k/200k',
      cost: '$0.04',
      percent: '80',
      tone: 'normal',
    },
    {
      case: 'over the window holds at full',
      input: { contextTokens: 250_000 },
      context: '250k/200k',
      cost: '$0.04',
      percent: '100',
      tone: 'warning',
    },
    {
      case: 'millions read in M',
      input: { contextTokens: 1_234_000, contextWindow: 2_000_000 },
      context: '1.2M/2.0M',
      cost: '$0.04',
      percent: '62',
      tone: 'normal',
    },
    {
      case: 'where the thousands would read 1000k reads in M',
      input: { contextTokens: 999_500, contextWindow: 2_000_000 },
      context: '1.0M/2.0M',
      cost: '$0.04',
      percent: '50',
      tone: 'normal',
    },
    {
      case: 'just under that still reads in k',
      input: { contextTokens: 999_499, contextWindow: 2_000_000 },
      context: '999k/2.0M',
      cost: '$0.04',
      percent: '50',
      tone: 'normal',
    },
    {
      case: 'an autocompact limit replaces the window',
      input: {
        contextTokens: 174_000,
        contextWindow: 1_000_000,
        autocompactLimit: 300_000,
      },
      context: '174k/300k',
      cost: '$0.04',
      percent: '58',
      tone: 'normal',
    },
    {
      case: 'the warning share is of the autocompact limit',
      input: {
        contextTokens: 240_000,
        contextWindow: 1_000_000,
        autocompactLimit: 300_000,
      },
      context: '240k/300k',
      cost: '$0.04',
      percent: '80',
      tone: 'warning',
    },
    {
      case: 'no window: no bar',
      input: { contextWindow: null },
      context: '84k',
      cost: '$0.04',
      percent: null,
      tone: undefined,
    },
    {
      case: 'no tokens: no bar or text',
      input: { contextTokens: null },
      context: null,
      cost: '$0.04',
      percent: null,
      tone: undefined,
    },
    {
      case: 'no spend: no cost',
      input: { spendUsd: null },
      context: '84k/200k',
      cost: null,
      percent: '42',
      tone: 'normal',
    },
  ])('footer_$case', ({ input, context, cost, percent, tone }) => {
    const { root } = drawAgent(input);

    const meter = root.find('ui-meter');
    expect({
      context: root.find('agent-strip-context')?.textContent ?? null,
      cost: root.find('agent-strip-cost')?.textContent ?? null,
      percent: meter?.dataset.percent ?? null,
      tone: meter?.dataset.tone,
    }).toEqual({ context, cost, percent, tone });
  });

  it('footer_NothingKnown_Omitted', () => {
    const { root } = drawAgent({ contextTokens: null, spendUsd: null });

    expect(root.find('agent-strip-footer')).toBeNull();
  });

  it.each<{
    case: string;
    model: string | null;
    effort: string | null;
    line: string | null;
  }>([
    { case: 'both', model: 'sonnet', effort: 'high', line: 'sonnet · high' },
    { case: 'no effort', model: 'sonnet', effort: null, line: 'sonnet' },
    { case: 'no model', model: null, effort: 'high', line: 'high' },
    { case: 'neither', model: null, effort: null, line: null },
  ])('modelLine_$case', ({ model, effort, line }) => {
    const { root } = drawAgent({ model, effort });

    expect(root.find('agent-strip-model')?.textContent ?? null).toBe(line);
  });

  it.each<{ case: string; input: Partial<AgentBoxInput>; shown: boolean }>([
    { case: 'closed with tools', input: {}, shown: true },
    { case: 'closed with no tools', input: { recentTools: [] }, shown: true },
    { case: 'open', input: { isOpen: true }, shown: false },
  ])('recentTools_$case', ({ input, shown }) => {
    const { root } = drawAgent(input);

    expect(root.find('agent-strip-recent') !== null).toBe(shown);
  });

  it.each<{
    case: string;
    input: Partial<TaskBoxInput>;
    command: string;
    owner: string | null;
    isOpen: boolean;
  }>([
    {
      case: 'closed',
      input: {},
      command: 'npm run selftest',
      owner: null,
      isOpen: false,
    },
    {
      case: 'open',
      input: { isOpen: true },
      command: 'npm run selftest',
      owner: 'kind-fixer · Run the self-test',
      isOpen: true,
    },
    {
      case: 'no command',
      input: { command: null },
      command: 'Run the self-test',
      owner: null,
      isOpen: false,
    },
    {
      case: 'open with no command',
      input: { command: null, isOpen: true },
      command: 'Run the self-test',
      owner: 'kind-fixer',
      isOpen: true,
    },
  ])('taskCommand_$case', ({ input, command, owner, isOpen }) => {
    const { root } = drawTask(input);

    expect(root.find('agent-strip-command')?.textContent).toBe(command);
    expect(root.find('agent-strip-row-owner')?.textContent ?? null).toBe(owner);
    expect(root.classList.contains('is-open')).toBe(isOpen);
  });

  it.each<{ case: string; box: () => ReturnType<typeof drawn> }>([
    { case: 'agent', box: () => drawAgent() },
    { case: 'task', box: () => drawTask() },
  ])('update_RewritesOnlyTheRuntime ($case)', ({ box }) => {
    const { root, part } = box();
    const before = root.textContent;

    part.update?.({ elapsedMs: 43_000 } as never);

    expect(root.find('agent-strip-runtime')?.textContent).toBe('43s');
    expect(root.textContent).toBe(before.replace('42s', '43s'));
  });
});
