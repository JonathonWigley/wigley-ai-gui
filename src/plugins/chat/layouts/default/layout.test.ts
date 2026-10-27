import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChatKit,
  ChatLayout,
  CollapsibleCardOptions,
  EntryInput,
  EntryKind,
  EntryView,
} from '../layout';
import layout from './layout.js';

// The DOM surface the default layout uses. This layer may not import the
// page's shared fake DOM.
class FakeElement {
  tagName: string;
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get classList() {
    const names = () => this.className.split(' ').filter((name) => name !== '');
    return {
      toggle: (name: string, force?: boolean) => {
        const isOn = force ?? !names().includes(name);
        const rest = names().filter((held) => held !== name);
        this.className = (isOn ? [...rest, name] : rest).join(' ');
        return isOn;
      },
      contains: (name: string) => names().includes(name),
    };
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: FakeElement[]) {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children = [];
    this.append(...nodes);
  }
}

function asHtml(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
}

function asFake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

// A fake kit part's element: tagged with the part and its argument
// (`markdown:hello`) and appended to `parent`, as every kit part appends.
function part(parent: HTMLElement, tag: string, name: string): HTMLElement {
  const node = new FakeElement(tag);
  node.dataset.part = name;
  asFake(parent).append(node);
  return asHtml(node);
}

// A kit whose parts append tagged fake elements and record each call; each
// expander keeps its line and `body`, and each collapsible card its options,
// so a test opens it by calling `body()`.
function fakeKit() {
  const calls = {
    expanders: [] as { line: string; body: () => HTMLElement }[],
    collapsibleCards: [] as CollapsibleCardOptions[],
    setOpen: [] as boolean[],
    setDotStatus: [] as [string | undefined, string][],
  };
  const parts: Partial<ChatKit> = {
    markdown: (parent, text) => part(parent, 'div', `markdown:${text}`),
    json: (parent, value) =>
      part(parent, 'pre', `json:${JSON.stringify(value)}`),
    expander(parent, summary, body) {
      calls.expanders.push({ line: summary, body });
      return part(parent, 'div', `expander:${summary}`);
    },
    collapsibleCard(parent, options) {
      calls.collapsibleCards.push(options);
      return {
        element: part(parent, 'div', `collapsibleCard:${options.summary}`),
        isOpen: () => false,
        setOpen(open) {
          calls.setOpen.push(open);
        },
      };
    },
    card: (parent) => part(parent, 'div', 'card:none'),
    edgeCard: (parent, edge) => part(parent, 'div', `card:${edge ?? 'none'}`),
    statusDot: (parent, status) => part(parent, 'span', `dot:${status}`),
    setDotStatus(dot, status) {
      calls.setDotStatus.push([dot.dataset.part, status]);
    },
    sectionHeader: (parent, text) => part(parent, 'h3', `section:${text}`),
    permissionActions: (parent) => part(parent, 'div', 'permissionActions'),
    images: (parent) => part(parent, 'div', 'images'),
  };
  return { kit: parts as ChatKit, calls };
}

type AnyBuilder = (
  parent: HTMLElement,
  input: EntryInput<EntryKind>,
  kit: ChatKit,
) => EntryView;

// Draws `input` with its kind's default builder into a fresh parent, and
// checks the element it returned is the parent's one child.
function draw<K extends EntryKind>(
  input: EntryInput<K>,
  kit: ChatKit,
): EntryView<K> {
  const parent = new FakeElement('li');
  const builder = (layout as ChatLayout).entries[input.kind] as AnyBuilder;
  const view = builder(asHtml(parent), input, kit);
  expect(parent.children).toEqual([asFake(view.element)]);
  return view as EntryView<K>;
}

// Each child as its kit part, or as its classes and text when the layout made it.
function describeChildren(element: FakeElement): string[] {
  return element.children.map(
    (child) =>
      child.dataset.part ??
      `${child.tagName.toLowerCase()}.${child.className}:${child.textContent}`,
  );
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('default chat layout', () => {
  it('user_cardHoldsMarkdown_updateReplacesIt', () => {
    const { kit } = fakeKit();
    const entry = {
      kind: 'user' as const,
      id: 'u1',
      text: 'hello',
      images: [] as { mediaType: string; data: string }[],
      raw: [] as unknown[],
    };

    const view = draw(entry, kit);
    const root = asFake(view.element);
    const turn = root.children[0];
    expect(describeChildren(turn)).toEqual(['markdown:hello']);

    view.update?.({ ...entry, text: 'hello there' });
    expect(asFake(view.element)).toBe(root);
    expect(root.children).toEqual([turn]);
    expect(describeChildren(turn)).toEqual(['markdown:hello there']);
  });

  const userWithImage = {
    kind: 'user' as const,
    id: 'u2',
    text: 'look',
    images: [{ mediaType: 'image/png', data: 'cG5n' }],
    raw: [] as unknown[],
  };

  it.each([
    {
      images: [{ mediaType: 'image/png', data: 'cG5n' }],
      children: ['markdown:look', 'images'],
    },
    { images: [], children: ['markdown:look'] },
  ])(
    'user entry with $images.length images holds $children',
    ({ images, children }) => {
      const { kit } = fakeKit();

      const view = draw({ ...userWithImage, images }, kit);
      const turn = asFake(view.element).children[0];

      expect(describeChildren(turn)).toEqual(children);
    },
  );

  it('assistant_update_UpdatesInPlace', () => {
    const { kit } = fakeKit();
    const entry = {
      kind: 'assistant' as const,
      id: 'a1',
      text: 'Hi',
      streaming: true,
      raw: [] as unknown[],
    };

    const view = draw(entry, kit);
    const root = asFake(view.element);

    view.update?.({ ...entry, text: 'Hi there', streaming: false });
    expect(asFake(view.element)).toBe(root);
    expect(describeChildren(root)).toEqual(['markdown:Hi there']);
  });

  it('thinking_expanderBodyRefilledInPlace', () => {
    const { kit, calls } = fakeKit();
    const entry = {
      kind: 'thinking' as const,
      id: 't1',
      text: 'step 1',
      streaming: true,
      raw: [] as unknown[],
    };

    const view = draw(entry, kit);
    expect(calls.expanders.map((expander) => expander.line)).toEqual([
      'Thinking',
    ]);
    const body = asFake(calls.expanders[0].body());
    expect(describeChildren(body)).toEqual(['markdown:step 1']);

    view.update?.({ ...entry, text: 'step 1 step 2' });
    expect(asFake(calls.expanders[0].body())).toBe(body);
    expect(describeChildren(body)).toEqual(['markdown:step 1 step 2']);
    expect(calls.expanders).toHaveLength(1);
  });

  const toolEntry = {
    kind: 'tool' as const,
    id: 'tool1',
    toolUseId: 'toolu_1',
    name: 'Bash',
    input: { command: 'ls -la' } as unknown,
    summary: 'ls -la',
    result: null as { text: string; isError: boolean } | null,
    raw: [] as unknown[],
  };
  const inputJson = `json:${JSON.stringify({ command: 'ls -la' })}`;

  it.each([
    { summary: 'ls -la', line: 'Bash · ls -la' },
    { summary: '', line: 'Bash' },
  ])('tool line with summary "$summary" is $line', ({ summary, line }) => {
    const { kit, calls } = fakeKit();

    draw({ ...toolEntry, summary }, kit);
    expect(calls.collapsibleCards[0].summary).toBe(line);
  });

  it.each([
    { isError: true, label: 'Error', status: 'error', text: 'denied' },
    { isError: false, label: 'Result', status: 'success', text: 'total 0' },
  ])(
    'tool_updateSetsTheDotAndRefillsTheBody (isError $isError)',
    ({ isError, label, status, text }) => {
      const { kit, calls } = fakeKit();
      const view = draw(toolEntry, kit);
      const options = calls.collapsibleCards[0];
      const body = asFake(options.body());

      view.update?.({ ...toolEntry, result: { text, isError } });
      expect(calls.setDotStatus).toEqual([['dot:running', status]]);
      expect(asFake(options.body())).toBe(body);
      expect(describeChildren(body)).toEqual([
        'section:Input',
        inputJson,
        `section:${label}`,
        `pre.chat-tool-result:${text}`,
      ]);
      expect(calls.setOpen).toEqual([]);
    },
  );

  const permissionEntry = {
    kind: 'permission' as const,
    id: 'p1',
    toolName: 'Bash',
    input: { command: 'rm x' } as unknown,
    answer: null as { allowed: boolean; reason: string | null } | null,
    raw: [] as unknown[],
  };

  it('permission_unanswered_holdsTheInputAndActions_noUpdate', () => {
    const { kit } = fakeKit();

    const view = draw(permissionEntry, kit);
    const card = asFake(view.element).children[0];
    expect(describeChildren(card)).toEqual(
      expect.arrayContaining([
        `json:${JSON.stringify({ command: 'rm x' })}`,
        'permissionActions',
      ]),
    );
    expect(view.update).toBeUndefined();
  });

  it('permission_answeredPlainCard', () => {
    const { kit } = fakeKit();

    const view = draw(
      { ...permissionEntry, answer: { allowed: true, reason: null } },
      kit,
    );
    expect(describeChildren(asFake(view.element))).toEqual(['card:none']);
  });

  it.each([
    { costUsd: 0.01234, durationMs: 4210, line: 'end_turn · $0.0123 · 4.2 s' },
    { costUsd: null, durationMs: null, line: 'end_turn' },
  ])('result_lineFormats ($line)', ({ costUsd, durationMs, line }) => {
    const { kit } = fakeKit();
    const entry = {
      kind: 'result' as const,
      id: 'r1',
      stopReason: 'end_turn',
      costUsd,
      durationMs,
      raw: [] as unknown[],
    };

    const view = draw(entry, kit);
    expect(asFake(view.element).textContent).toBe(line);
  });

  it('raw_expanderShowsTheEvents', () => {
    const { kit, calls } = fakeKit();
    const raw: unknown[] = [{ type: 'x' }];

    draw({ kind: 'raw', id: 'x1', raw }, kit);
    const body = asFake(calls.expanders[0].body());
    expect(describeChildren(body)).toEqual([
      `json:${JSON.stringify([{ type: 'x' }])}`,
    ]);
  });
});
