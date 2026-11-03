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

  get classList() {
    return {
      contains: (name: string) => this.className.split(' ').includes(name),
    };
  }

  append(node: FakeElement) {
    this.children.push(node);
  }
}

function asHtml(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
}

function asFake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

// A kit whose parts append fake elements; `hints` records each `keyHint`'s
// command.
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
    icon: (parent, name) => el(parent, 'span', `codicon-${name}`),
    duration: (ms) => `${Math.floor(ms / 1000)}s`,
    keyHint(parent, command) {
      hints.push(command);
      return el(parent, 'span', 'hint');
    },
  };
  return { kit: parts as AgentStripKit, hints };
}

const AGENT: AgentBoxInput = {
  name: 'map-decoder',
  meta: 'claude-sonnet-5-5 · medium · $0.04',
  description: 'Map the stream decoder',
  recentTools: [
    { tool: 'Read', summary: 'stream-decoder.ts', status: 'success' },
  ],
  status: 'running',
  isDimmed: false,
  isSelected: false,
  isOpen: false,
};

const TASK: TaskBoxInput = {
  description: 'Run the self-test',
  owner: 'main',
  elapsedMs: 42_000,
  command: 'npm run selftest',
  status: 'running',
  isDimmed: false,
  isSelected: false,
  isOpen: false,
};

// What a drawn box shows: its state classes, the key hints it named, and its
// text.
function drawn(
  draw: (parent: HTMLElement, kit: AgentStripKit) => { element: HTMLElement },
) {
  const { kit, hints } = fakeKit();
  const parent = new FakeElement('div');
  const { element } = draw(asHtml(parent), kit);
  const root = asFake(element);
  expect(parent.children).toEqual([root]);
  return {
    isDimmed: root.classList.contains('is-dimmed'),
    isSelected: root.classList.contains('is-selected'),
    hints,
    text: root.textContent,
  };
}

describe('default agent-strip layout', () => {
  it.each<{
    case: string;
    input: Partial<AgentBoxInput>;
    dimmed: boolean;
    selected: boolean;
    hints: string[];
  }>([
    { case: 'plain', input: {}, dimmed: false, selected: false, hints: [] },
    {
      case: 'dimmed',
      input: { isDimmed: true, status: 'success' },
      dimmed: true,
      selected: false,
      hints: [],
    },
    {
      case: 'selected',
      input: { isSelected: true },
      dimmed: false,
      selected: true,
      hints: ['focusBox', 'appendBox'],
    },
  ])('agentBox_$case', ({ input, dimmed, selected, hints }) => {
    const box = drawn((parent, kit) =>
      layout.agentBox(parent, { ...AGENT, ...input }, kit),
    );

    expect(box).toMatchObject({
      isDimmed: dimmed,
      isSelected: selected,
      hints,
    });
  });

  it.each<{
    case: string;
    input: Partial<TaskBoxInput>;
    dimmed: boolean;
    selected: boolean;
    hints: string[];
    shows: string[];
    hides: string[];
  }>([
    {
      case: 'plain',
      input: {},
      dimmed: false,
      selected: false,
      hints: [],
      shows: ['main · 42s'],
      hides: ['npm run selftest'],
    },
    {
      case: 'finished',
      input: { isDimmed: true, status: 'error', elapsedMs: null },
      dimmed: true,
      selected: false,
      hints: [],
      shows: ['main'],
      hides: ['main ·'],
    },
    {
      case: 'selected',
      input: { isSelected: true },
      dimmed: false,
      selected: true,
      hints: ['focusBox', 'appendBox'],
      shows: [],
      hides: [],
    },
    {
      case: 'openWithCommand',
      input: { isOpen: true },
      dimmed: false,
      selected: false,
      hints: [],
      shows: ['npm run selftest'],
      hides: ['no command'],
    },
    {
      case: 'openWithoutCommand',
      input: { isOpen: true, command: null },
      dimmed: false,
      selected: false,
      hints: [],
      shows: ['no command'],
      hides: [],
    },
  ])('taskBox_$case', ({ input, dimmed, selected, hints, shows, hides }) => {
    const box = drawn((parent, kit) =>
      layout.taskBox(parent, { ...TASK, ...input }, kit),
    );

    expect(box).toMatchObject({
      isDimmed: dimmed,
      isSelected: selected,
      hints,
    });
    for (const text of shows) {
      expect(box.text).toContain(text);
    }
    for (const text of hides) {
      expect(box.text).not.toContain(text);
    }
  });
});
