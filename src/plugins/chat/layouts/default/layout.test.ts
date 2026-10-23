import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import layout from './layout.js';

type ChatKit = Parameters<typeof layout.entries.user>[1];

// The DOM surface the default layout uses: `part` tags an element a fake kit
// part returned, with that part's argument (`markdown:hello`).
interface FakeElement {
  tagName: string;
  part: string | null;
  className: string;
  classList: {
    toggle(name: string, force?: boolean): boolean;
    contains(name: string): boolean;
  };
  textContent: string;
  children: FakeElement[];
  append(...nodes: FakeElement[]): void;
  replaceChildren(...nodes: FakeElement[]): void;
}

function fakeElement(tagName: string, part: string | null = null): FakeElement {
  const classes = new Set<string>();
  const element: FakeElement = {
    tagName: tagName.toUpperCase(),
    part,
    get className() {
      return [...classes].join(' ');
    },
    set className(value: string) {
      classes.clear();
      for (const name of value.split(' ').filter((name) => name !== '')) {
        classes.add(name);
      }
    },
    classList: {
      toggle(name, force) {
        const isOn = force ?? !classes.has(name);
        if (isOn) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return isOn;
      },
      contains: (name) => classes.has(name),
    },
    textContent: '',
    children: [],
    append(...nodes) {
      element.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      element.children = [...nodes];
    },
  };
  return element;
}

type CardOptions = Parameters<ChatKit['collapsibleCard']>[0];

// A kit whose parts return tagged fake elements and record each call; each
// expander keeps its line and `body`, and each collapsible card its options,
// so a test opens it by calling `body()`.
function fakeKit() {
  const calls = {
    markdown: [] as string[],
    json: [] as unknown[],
    expanders: [] as { line: string; body: () => HTMLElement }[],
    collapsibleCards: [] as CardOptions[],
    setOpen: [] as boolean[],
    setDotStatus: [] as [string | null, string][],
    permissionActions: 0,
    images: 0,
  };
  const kit: ChatKit = {
    markdown(text) {
      calls.markdown.push(text);
      return asHtml(fakeElement('div', `markdown:${text}`));
    },
    json(value) {
      calls.json.push(value);
      return asHtml(fakeElement('pre', `json:${JSON.stringify(value)}`));
    },
    expander(summary, body) {
      calls.expanders.push({ line: summary, body });
      return asHtml(fakeElement('div', `expander:${summary}`));
    },
    collapsibleCard(options) {
      calls.collapsibleCards.push(options);
      return {
        element: asHtml(
          fakeElement('div', `collapsibleCard:${options.summary}`),
        ),
        isOpen: () => false,
        setOpen(open) {
          calls.setOpen.push(open);
        },
      };
    },
    card: (edge) => asHtml(fakeElement('div', `card:${edge ?? 'none'}`)),
    statusDot: (status) => asHtml(fakeElement('span', `dot:${status}`)),
    setDotStatus(dot, status) {
      calls.setDotStatus.push([asFake(dot).part, status]);
    },
    sectionHeader: (text) => asHtml(fakeElement('h3', `section:${text}`)),
    permissionActions() {
      calls.permissionActions += 1;
      return asHtml(fakeElement('div', 'permissionActions'));
    },
    images() {
      calls.images += 1;
      return asHtml(fakeElement('div', 'images'));
    },
  };
  return { kit, calls };
}

function asHtml(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
}

function asFake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

// Each child as its kit part, or as its classes and text when the layout made it.
function describeChildren(element: FakeElement): string[] {
  return element.children.map(
    (child) =>
      child.part ??
      `${child.tagName.toLowerCase()}.${child.className}:${child.textContent}`,
  );
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => fakeElement(tag),
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

    const view = layout.entries.user(entry, kit);
    const root = asFake(view.element);
    expect(root.className).toBe('chat-entry chat-user');
    expect(describeChildren(root)).toEqual(['card:none']);
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

  it('userEntry_WithImages_DrawsThumbnails', () => {
    const { kit, calls } = fakeKit();

    const view = layout.entries.user(userWithImage, kit);
    const turn = asFake(view.element).children[0];

    expect(calls.images).toBe(1);
    expect(describeChildren(turn)).toEqual(['markdown:look', 'images']);
  });

  it('userEntry_NoImages_NoThumbnails', () => {
    const { kit, calls } = fakeKit();

    const view = layout.entries.user({ ...userWithImage, images: [] }, kit);
    const turn = asFake(view.element).children[0];

    expect(calls.images).toBe(0);
    expect(describeChildren(turn)).toEqual(['markdown:look']);
  });

  it('assistant_streamingClass_updateInPlace', () => {
    const { kit } = fakeKit();
    const entry = {
      kind: 'assistant' as const,
      id: 'a1',
      text: 'Hi',
      streaming: true,
      raw: [] as unknown[],
    };

    const view = layout.entries.assistant(entry, kit);
    const root = asFake(view.element);
    expect(root.classList.contains('chat-streaming')).toBe(true);

    view.update?.({ ...entry, text: 'Hi there', streaming: false });
    expect(asFake(view.element)).toBe(root);
    expect(describeChildren(root)).toEqual(['markdown:Hi there']);
    expect(root.classList.contains('chat-streaming')).toBe(false);
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

    const view = layout.entries.thinking(entry, kit);
    expect(calls.expanders.map((expander) => expander.line)).toEqual([
      'Thinking',
    ]);
    const body = asFake(calls.expanders[0].body());
    expect(body.className).toBe('chat-thinking-body');
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

  it('tool_closedMonoCardWithRunningDot', () => {
    const { kit, calls } = fakeKit();

    const view = layout.entries.tool(toolEntry, kit);
    expect(calls.collapsibleCards).toHaveLength(1);
    const options = calls.collapsibleCards[0];
    expect(options.summary).toBe('Bash · ls -la');
    expect(options.mono).toBe(true);
    expect(asFake(options.leading as HTMLElement).part).toBe('dot:running');
    expect(options.open ?? false).toBe(false);
    expect(describeChildren(asFake(view.element))).toEqual([
      'collapsibleCard:Bash · ls -la',
    ]);
    const body = asFake(options.body());
    expect(body.className).toBe('chat-tool-body');
    expect(describeChildren(body)).toEqual([
      'section:Input',
      inputJson,
      'div.chat-muted:Running…',
    ]);
  });

  it('tool_lineWithoutSummary', () => {
    const { kit, calls } = fakeKit();

    layout.entries.tool({ ...toolEntry, summary: '' }, kit);
    expect(calls.collapsibleCards[0].summary).toBe('Bash');
  });

  it.each([
    { isError: true, label: 'Error', status: 'error', text: 'denied' },
    { isError: false, label: 'Result', status: 'success', text: 'total 0' },
  ])(
    'tool_updateSetsTheDotAndRefillsTheBody (isError $isError)',
    ({ isError, label, status, text }) => {
      const { kit, calls } = fakeKit();
      const view = layout.entries.tool(toolEntry, kit);
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

  it('permission_unansweredAttentionCard_noUpdate', () => {
    const { kit, calls } = fakeKit();

    const view = layout.entries.permission(permissionEntry, kit);
    const root = asFake(view.element);
    expect(describeChildren(root)).toEqual(['card:attention']);
    expect(describeChildren(root.children[0])).toEqual([
      'div.chat-permission-head:Allow Bash?',
      `json:${JSON.stringify({ command: 'rm x' })}`,
      'permissionActions',
    ]);
    expect(calls.json).toEqual([{ command: 'rm x' }]);
    expect(calls.permissionActions).toBe(1);
    expect(view.update).toBeUndefined();
  });

  it('permission_answeredPlainCard', () => {
    const { kit } = fakeKit();

    const view = layout.entries.permission(
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

    const view = layout.entries.result(entry, kit);
    expect(asFake(view.element).textContent).toBe(line);
  });

  it('notice_toneClass', () => {
    const { kit } = fakeKit();
    const entry = {
      kind: 'notice' as const,
      id: 'n1',
      text: 'rate limited',
      tone: 'error' as const,
      raw: [] as unknown[],
    };

    const root = asFake(layout.entries.notice(entry, kit).element);
    expect(root.className).toBe('chat-entry chat-notice chat-notice-error');
    expect(root.textContent).toBe('rate limited');
  });

  it('raw_expanderShowsTheEvents', () => {
    const { kit, calls } = fakeKit();
    const raw: unknown[] = [{ type: 'x' }];

    layout.entries.raw({ kind: 'raw', id: 'x1', raw }, kit);
    expect(calls.expanders[0].line).toBe('Raw event');
    const body = asFake(calls.expanders[0].body());
    expect(body.className).toBe('chat-raw-body');
    expect(describeChildren(body)).toEqual([
      `json:${JSON.stringify([{ type: 'x' }])}`,
    ]);
  });
});
