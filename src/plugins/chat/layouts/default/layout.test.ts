import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ActivityInput,
  ChatKit,
  ChatLayout,
  CollapsibleCardOptions,
  ComposerInput,
  ComposerKit,
  EntryInput,
  EntryKind,
  EntryView,
  PartView,
  PickerRowKit,
  QueuedMessageInput,
  SignInKit,
  StatusLineKit,
  StepInput,
  WorkingInput,
  WorkingState,
} from '../layout';
import type { KitRowOptions } from '../../../../shared/page/layout-host/kit';
import layout from './layout.js';

// The main agent's id; this layer may not import the agent contract.
const MAIN_AGENT_ID = 'main';

// The DOM surface the default layout uses. This layer may not import the
// page's shared fake DOM.
class FakeElement {
  tagName: string;
  className = '';
  textContent = '';
  hidden = false;
  src = '';
  alt = '';
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
      add: (name: string) => {
        this.className = [
          ...names().filter((held) => held !== name),
          name,
        ].join(' ');
      },
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

  remove() {
    if (this.parentNode !== null) {
      this.parentNode.children = this.parentNode.children.filter(
        (child) => child !== this,
      );
      this.parentNode = null;
    }
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
// collapsible row keeps its options, so a test opens it by calling `body()`.
// `markdown` tags a draw with live fences off ` (fences off)` and records
// how many children its parent held when called.
function fakeKit() {
  const calls = {
    collapsibleRows: [] as CollapsibleCardOptions[],
    setOpen: [] as boolean[],
    setDotStatus: [] as [string | undefined, string][],
    markdownSiblings: [] as number[],
  };
  const parts: Partial<ChatKit> = {
    markdown(parent, text, _className, options) {
      calls.markdownSiblings.push(asFake(parent).children.length);
      const fencesOff = options?.liveFences === false ? ' (fences off)' : '';
      return part(parent, 'div', `markdown:${text}${fencesOff}`);
    },
    json: (parent, value) =>
      part(parent, 'pre', `json:${JSON.stringify(value)}`),
    collapsibleRow(parent, options) {
      calls.collapsibleRows.push(options);
      return {
        element: part(parent, 'div', `collapsibleRow:${options.summary}`),
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
    duration: (ms) => `${Math.floor(ms / 1000)}s`,
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
  const builder = layout.entries[input.kind] as AnyBuilder;
  const view = builder(asHtml(parent), input, kit);
  expect(parent.children).toEqual([asFake(view.element)]);
  return view as EntryView<K>;
}

// The element as its kit part, or as its classes and text when the layout made it.
function describeElement(element: FakeElement): string {
  return (
    element.dataset.part ??
    `${element.tagName.toLowerCase()}.${element.className}:${element.textContent}`
  );
}

function describeChildren(element: FakeElement): string[] {
  return element.children.map(describeElement);
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
    expect(describeChildren(turn)).toEqual(['markdown:hello (fences off)']);

    view.update?.({ ...entry, text: 'hello there' });
    expect(asFake(view.element)).toBe(root);
    expect(root.children).toEqual([turn]);
    expect(describeChildren(turn)).toEqual([
      'markdown:hello there (fences off)',
    ]);
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
      children: ['markdown:look (fences off)', 'images'],
    },
    { images: [], children: ['markdown:look (fences off)'] },
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
    const { kit, calls } = fakeKit();
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
    expect(calls.markdownSiblings.at(-1)).toBe(1);
    expect(describeChildren(root)).toEqual(['markdown:Hi there']);
  });

  it('thinking_rowBodyRefilledInPlace', () => {
    const { kit, calls } = fakeKit();
    const entry = {
      kind: 'thinking' as const,
      id: 't1',
      text: 'step 1',
      streaming: true,
      raw: [] as unknown[],
    };

    const view = draw(entry, kit);
    expect(calls.collapsibleRows.map((row) => row.summary)).toEqual([
      'Thinking',
    ]);
    const body = asFake(calls.collapsibleRows[0].body());
    expect(describeChildren(body)).toEqual(['markdown:step 1']);

    view.update?.({ ...entry, text: 'step 1 step 2' });
    expect(calls.markdownSiblings.at(-1)).toBe(1);
    expect(asFake(calls.collapsibleRows[0].body())).toBe(body);
    expect(describeChildren(body)).toEqual(['markdown:step 1 step 2']);
    expect(calls.collapsibleRows).toHaveLength(1);
  });

  const toolEntry = {
    kind: 'tool' as const,
    id: 'tool1',
    agentId: MAIN_AGENT_ID,
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
    const options = calls.collapsibleRows[0];
    expect([
      options.summary,
      options.mono,
      options.leading?.dataset.part,
    ]).toEqual([line, true, 'dot:running']);
  });

  it.each([
    { isError: true, label: 'Error', status: 'error', text: 'denied' },
    { isError: false, label: 'Result', status: 'success', text: 'total 0' },
  ])(
    'tool_updateSetsTheDotAndRefillsTheBody (isError $isError)',
    ({ isError, label, status, text }) => {
      const { kit, calls } = fakeKit();
      const view = draw(toolEntry, kit);
      const options = calls.collapsibleRows[0];
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
    { costUsd: 0.01234, durationMs: 4210, line: 'end_turn · $0.01 · 4.2 s' },
    { costUsd: 0.5, durationMs: null, line: 'end_turn · $0.50' },
    { costUsd: 0.004, durationMs: null, line: 'end_turn · $0.00' },
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

  it('raw_rowShowsTheEvents', () => {
    const { kit, calls } = fakeKit();
    const raw: unknown[] = [{ type: 'x' }];

    draw({ kind: 'raw', id: 'x1', raw }, kit);
    expect(calls.collapsibleRows[0].summary).toBe('Raw event');
    const body = asFake(calls.collapsibleRows[0].body());
    expect(describeChildren(body)).toEqual([
      `json:${JSON.stringify([{ type: 'x' }])}`,
    ]);
  });
});

// A tool step named `name`, its result failed when `isError`; null leaves it
// running.
function toolStep(
  name: string,
  summary: string,
  isError: boolean | null = false,
): StepInput {
  return {
    kind: 'tool',
    id: `${name}-${summary}`,
    agentId: MAIN_AGENT_ID,
    toolUseId: `toolu-${name}-${summary}`,
    name,
    input: {},
    summary,
    result: isError === null ? null : { text: '', isError },
    raw: [],
  };
}

function thinkingStep(id: string): StepInput {
  return { kind: 'thinking', id, text: '', streaming: false, raw: [] };
}

// A finished, closed run of `steps` from 0 to `endedAt`.
function finishedRun(steps: StepInput[], endedAt: number): ActivityInput {
  return {
    steps,
    current: steps[steps.length - 1],
    live: false,
    open: false,
    startedAt: 0,
    endedAt,
    now: endedAt,
  };
}

// A live run of `steps`, started at 0, drawn at `now`.
function liveRun(
  steps: StepInput[],
  open: boolean,
  now: number,
): ActivityInput {
  return {
    steps,
    current: steps[steps.length - 1],
    live: true,
    open,
    startedAt: 0,
    endedAt: null,
    now,
  };
}

const sevenSteps = [
  toolStep('Read', 'a.ts'),
  toolStep('Read', 'b.ts'),
  thinkingStep('t1'),
  toolStep('Grep', 'todo', true),
  toolStep('Edit', 'a.ts'),
  { kind: 'raw', id: 'x1', raw: [] } as StepInput,
  toolStep('Bash', 'npm test', null),
];
const sevenStepSummary =
  'span.chat-activity-steps:7 steps · Read 2 · Grep · Edit · Bash span.chat-activity-failed:· 1 failed span.chat-activity-time:· 12s';

function drawActivity(input: ActivityInput): PartView<ActivityInput> {
  const parent = new FakeElement('div');
  const view = layout.activity(asHtml(parent), input, fakeKit().kit);
  expect(parent.children).toEqual([asFake(view.element)]);
  return view;
}

// The part's root classes, then the summary line as its pieces.
function activityLines(view: PartView<ActivityInput>): string[] {
  const line = asFake(view.element);
  return [
    line.className,
    ...line.children.map((child) => describeChildren(child).join(' ')),
  ];
}

describe('default chat layout activity', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeElement(tag),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      state: 'Finished',
      input: finishedRun(
        [
          toolStep('Read', 'a.ts'),
          toolStep('Bash', 'ls'),
          toolStep('Read', 'b.ts'),
          toolStep('Edit', 'a.ts'),
          toolStep('Bash', 'npm test', true),
          toolStep('Read', 'c.ts'),
        ],
        42000,
      ),
      lines: [
        'chat-activity',
        'span.chat-activity-steps:6 steps · Read 3 · Bash 2 · Edit span.chat-activity-failed:· 1 failed span.chat-activity-time:· 42s',
      ],
    },
    {
      state: 'FinishedOneStep',
      input: finishedRun([toolStep('Read', 'a.ts')], 8000),
      lines: [
        'chat-activity',
        'span.chat-activity-steps:1 step · Read span.chat-activity-time:· 8s',
      ],
    },
    {
      state: 'FinishedThinkingOnly',
      input: finishedRun([thinkingStep('t1'), thinkingStep('t2')], 8000),
      lines: [
        'chat-activity',
        'span.chat-activity-steps:2 steps span.chat-activity-time:· 8s',
      ],
    },
    {
      state: 'LiveClosed',
      input: liveRun(sevenSteps, false, 12000),
      lines: ['chat-activity is-live', sevenStepSummary],
    },
    {
      state: 'LiveClosedOneStep',
      input: liveRun([toolStep('Read', 'a.ts', null)], false, 3000),
      lines: [
        'chat-activity is-live',
        'span.chat-activity-steps:1 step · Read span.chat-activity-time:· 3s',
      ],
    },
    {
      state: 'LiveOpen',
      input: liveRun(sevenSteps, true, 12000),
      lines: ['chat-activity is-live', sevenStepSummary],
    },
    {
      state: 'UpdatedFromLiveToFinished',
      input: liveRun(sevenSteps, false, 12000),
      next: finishedRun(sevenSteps, 20000),
      lines: [
        'chat-activity',
        'span.chat-activity-steps:7 steps · Read 2 · Grep · Edit · Bash span.chat-activity-failed:· 1 failed span.chat-activity-time:· 20s',
      ],
    },
  ] as {
    state: string;
    input: ActivityInput;
    next?: ActivityInput;
    lines: string[];
  }[])('activity_Default_$state', ({ input, next, lines }) => {
    const view = drawActivity(input);
    const line = view.element;

    if (next !== undefined) {
      view.update?.(next);
    }

    expect(view.element).toBe(line);
    expect(activityLines(view)).toEqual(lines);
  });

  const oneStep = [toolStep('Read', 'a.ts')];

  // The kit's `duration` owns the format; these rows pin
  // the span the line hands it, finished and ticking.
  it.each([
    { ms: 42999, text: '42s' },
    { ms: 'tick 12000 → 13000', text: '13s' },
  ])('activity_Default_Time ($ms → $text)', ({ ms, text }) => {
    const isTick = typeof ms === 'string';
    const view = drawActivity(
      isTick ? liveRun(oneStep, false, 12000) : finishedRun(oneStep, ms),
    );

    if (isTick) {
      view.update?.(liveRun(oneStep, false, 13000));
    }

    const timeLine = asFake(view.element).children[0];
    expect(timeLine.children.at(-1)?.textContent).toBe(`· ${text}`);
  });
});

// A turn of `steps` in `state`, started at `startedAt`, drawn at `now`.
function workingTurn(
  state: WorkingState,
  steps: StepInput[],
  now: number,
  startedAt = 0,
): WorkingInput {
  return { state, steps, startedAt, now };
}

// A finished turn of `steps` from `startedAt` to `endedAt`.
function doneTurn(
  stopReason: string,
  steps: StepInput[],
  startedAt: number,
  endedAt: number,
  costUsd: number | null,
): WorkingInput {
  return { state: 'done', steps, startedAt, endedAt, stopReason, costUsd };
}

function drawWorking(input: WorkingInput): PartView<WorkingInput> {
  const parent = new FakeElement('div');
  const view = layout.working(asHtml(parent), input, fakeKit().kit);
  expect(parent.children).toEqual([asFake(view.element)]);
  return view;
}

// The part's root classes, then the header as its pieces, then each box line
// and the counts as their classes and text.
function workingLines(view: PartView<WorkingInput>): string[] {
  const block = asFake(view.element);
  return [
    block.className,
    ...block.children.flatMap((child) => {
      if (child.className === 'chat-working-head') {
        return [describeChildren(child).join(' ')];
      }
      return child.className === 'chat-working-box'
        ? describeChildren(child)
        : [describeElement(child)];
    }),
  ];
}

// A Read whose summary the adapter cut at 80 characters.
const chatKitRead: StepInput = {
  kind: 'tool',
  id: 'read-chat-kit',
  agentId: MAIN_AGENT_ID,
  toolUseId: 'toolu-read-chat-kit',
  name: 'Read',
  input: { file_path: '/a/b/chat-kit.ts' },
  summary: `/a/b/${'x'.repeat(74)}…`,
  result: { text: '', isError: false },
  raw: [],
};

describe('default chat layout working', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeElement(tag),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'NoStep',
      input: workingTurn('thinking', [], 0),
      lines: [
        'chat-working',
        'span.chat-working-time:0:00 span.chat-working-state:Thinking…',
      ],
    },
    {
      name: 'NineSteps',
      input: workingTurn(
        'working',
        [
          toolStep('Read', 'a.ts'),
          thinkingStep('t1'),
          toolStep('Read', 'b.ts'),
          toolStep('Bash', 'ls'),
          toolStep('Edit', 'a.ts'),
          thinkingStep('t2'),
          toolStep('Read', 'c.ts'),
          toolStep('Grep', 'todo', true),
          toolStep('Bash', 'npm test', null),
        ],
        65000,
      ),
      lines: [
        'chat-working',
        'span.chat-working-time:1:05 span.chat-working-state:Working…',
        'div.chat-working-action:Read c.ts',
        'div.chat-working-action is-failed:Grep todo',
        'div.chat-working-action is-current:Bash npm test',
        'div.chat-working-counts:Read 3 Bash 2 Edit 1 Grep 1',
      ],
    },
    {
      name: 'FilePathOverAnHour',
      input: workingTurn('waiting', [chatKitRead], 3725000),
      lines: [
        'chat-working',
        'span.chat-working-time:1:02:05 span.chat-working-state:Waiting…',
        'div.chat-working-action is-current:Read chat-kit.ts',
        'div.chat-working-counts:Read 1',
      ],
    },
    {
      name: 'SummaryTarget',
      input: workingTurn('writing', [toolStep('Bash', 'npm test')], 59000),
      lines: [
        'chat-working',
        'span.chat-working-time:0:59 span.chat-working-state:Writing…',
        'div.chat-working-action is-current:Bash npm test',
        'div.chat-working-counts:Bash 1',
      ],
    },
    {
      name: 'NowBeforeStart',
      input: workingTurn('thinking', [], 4000, 5000),
      lines: [
        'chat-working',
        'span.chat-working-time:0:00 span.chat-working-state:Thinking…',
      ],
    },
    {
      name: 'DoneWithCost',
      input: doneTurn(
        'end_turn',
        [
          toolStep('Bash', 'ls'),
          toolStep('Bash', 'npm test'),
          toolStep('Read', 'a.ts'),
        ],
        0,
        65000,
        0.574,
      ),
      lines: [
        'chat-working is-done',
        'div.chat-working-done:Done · 65s · $0.57 · Bash 2 · Read 1',
      ],
    },
    {
      name: 'DoneNoCostOtherReason',
      input: doneTurn('max_tokens', [toolStep('Read', 'a.ts')], 0, 4000, null),
      lines: [
        'chat-working is-done',
        'div.chat-working-done:max_tokens · 4s · Read 1',
      ],
    },
    {
      name: 'DoneSuccess',
      input: doneTurn('success', [toolStep('Bash', 'ls')], 0, 1000, null),
      lines: [
        'chat-working is-done',
        'div.chat-working-done:Done · 1s · Bash 1',
      ],
    },
    {
      name: 'DoneNoTools',
      input: doneTurn('end_turn', [thinkingStep('t1')], 0, 2000, 0.1),
      lines: [
        'chat-working is-done',
        'div.chat-working-done:Done · 2s · $0.10',
      ],
    },
  ])('working_draws ($name)', ({ input, lines }) => {
    expect(workingLines(drawWorking(input))).toEqual(lines);
  });

  it('working_update_RedrawsTheTime', () => {
    const view = drawWorking(workingTurn('thinking', [], 0));
    const block = view.element;

    view.update?.(workingTurn('thinking', [], 61000));

    expect(view.element).toBe(block);
    expect(workingLines(view)[1]).toBe(
      'span.chat-working-time:1:01 span.chat-working-state:Thinking…',
    );
  });

  it('working_update_LiveToDone_KeepsTheRootAndDrawsTheLine', () => {
    const view = drawWorking(
      workingTurn('working', [toolStep('Bash', 'ls', null)], 3000),
    );
    const block = view.element;

    view.update?.(
      doneTurn('end_turn', [toolStep('Bash', 'ls')], 0, 5000, null),
    );

    expect(view.element).toBe(block);
    expect(workingLines(view)).toEqual([
      'chat-working is-done',
      'div.chat-working-done:Done · 5s · Bash 1',
    ]);
  });
});

function drawQueued(input: QueuedMessageInput): PartView<QueuedMessageInput> {
  const parent = new FakeElement('div');
  const view = layout.queuedMessage(asHtml(parent), input, fakeKit().kit);
  expect(parent.children).toEqual([asFake(view.element)]);
  return view;
}

describe('default chat layout queuedMessage', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeElement(tag),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { imageCount: 0, sent: false, label: 'pending' },
    { imageCount: 1, sent: false, label: 'pending · 1 image' },
    { imageCount: 3, sent: false, label: 'pending · 3 images' },
    { imageCount: 0, sent: true, label: 'sending' },
    { imageCount: 2, sent: true, label: 'sending · 2 images' },
  ])(
    'queuedMessage_Default_Label ($imageCount, sent $sent → $label)',
    ({ imageCount, sent, label }) => {
      const view = drawQueued({ text: 'fix the tests', imageCount, sent });

      expect(describeChildren(asFake(view.element))).toEqual([
        `div.chat-queued-label:${label}`,
        'div.chat-queued-text:fix the tests',
      ]);
    },
  );

  it('queuedMessage_Default_UpdateRedrawsInPlace', () => {
    const view = drawQueued({
      text: 'fix the tests',
      imageCount: 0,
      sent: false,
    });
    const row = view.element;

    view.update?.({ text: 'and the lint', imageCount: 2, sent: false });

    expect(view.element).toBe(row);
    expect(describeChildren(asFake(row))).toEqual([
      'div.chat-queued-label:pending · 2 images',
      'div.chat-queued-text:and the lint',
    ]);
  });
});

// The kit parts of the surfaces beside the entries, each appending a tagged
// fake element; `row` keeps its options.
function fakeSurfaceKit() {
  const rows: KitRowOptions[] = [];
  const cursorEnd = new FakeElement('span');
  const parts = {
    floatingPanel: (parent: HTMLElement) =>
      part(parent, 'div', 'floatingPanel'),
    box: (parent: HTMLElement) => part(parent, 'div', 'box'),
    working: (parent: HTMLElement) => part(parent, 'div', 'working'),
    attachments: (parent: HTMLElement) => part(parent, 'div', 'attachments'),
    contributedParts: (parent: HTMLElement) =>
      part(parent, 'div', 'contributedParts'),
    statusLine: (parent: HTMLElement) => part(parent, 'div', 'statusLine'),
    typeHint: (parent: HTMLElement) => part(parent, 'span', 'typeHint'),
    modelEffortChip: (parent: HTMLElement) =>
      part(parent, 'button', 'modelEffort'),
    controlChip: (parent: HTMLElement, control: { id: string }) =>
      part(parent, 'button', `chip:${control.id}`),
    statusParts: (parent: HTMLElement) => part(parent, 'span', 'statusParts'),
    running: (parent: HTMLElement) => part(parent, 'span', 'running'),
    sendButton: (parent: HTMLElement) => part(parent, 'button', 'send'),
    row(parent: HTMLElement, options: KitRowOptions) {
      rows.push(options);
      return part(parent, 'li', `row:${options.label}`);
    },
    cursorEnd: () => asHtml(cursorEnd),
    copyButton: (parent: HTMLElement) => part(parent, 'button', 'copy'),
    codeBox: (parent: HTMLElement) => part(parent, 'div', 'codeBox'),
    actions: (parent: HTMLElement) => part(parent, 'div', 'actions'),
  };
  const kit = parts as unknown as ComposerKit &
    StatusLineKit &
    PickerRowKit &
    SignInKit;
  return { kit, rows, cursorEnd: asHtml(cursorEnd) };
}

type SurfacePart = Exclude<
  keyof ChatLayout,
  'entries' | 'activityInTranscript'
>;

// Every part beside the entries; a part left out fails to compile.
const SURFACE_PARTS: Record<SurfacePart, true> = {
  activity: true,
  working: true,
  queuedMessage: true,
  composer: true,
  statusLine: true,
  attachments: true,
  pickerRow: true,
  signIn: true,
  reasonBox: true,
  closeConfirm: true,
  imageViewer: true,
};

// Draws `input` with the default layout's `name` part into a fresh parent,
// and checks the element it returned is the parent's one child.
function drawSurface<I>(
  name: SurfacePart,
  input: I,
  kit: ReturnType<typeof fakeSurfaceKit>['kit'],
): PartView<I> {
  const parent = new FakeElement('div');
  const builder = layout[name] as unknown as (
    parent: HTMLElement,
    input: I,
    kit: unknown,
  ) => PartView<I>;
  const view = builder(asHtml(parent), input, kit);
  expect(parent.children).toEqual([asFake(view.element)]);
  return view;
}

describe('default chat layout surfaces', () => {
  it.each(Object.keys(SURFACE_PARTS) as SurfacePart[])(
    'default_DefinesEveryPart (%s)',
    (name) => {
      expect(typeof (layout as ChatLayout)[name]).toBe('function');
    },
  );

  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeElement(tag),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const model = { id: 'model', label: 'Model', value: 'Small', enabled: true };
  const effort = {
    id: 'effort',
    label: 'Effort',
    value: 'High',
    enabled: true,
  };
  const composerInput: ComposerInput = {
    session: 'repo',
    repo: 'repo',
    branch: 'main',
    isBoxFocused: false,
    running: true,
    working: false,
    modelEffort: { model, effort },
    controls: [{ id: 'mode', label: 'Mode', value: 'Auto', enabled: true }],
  };

  it('composer_Default_PlacesEachSlotOnce', () => {
    const { kit } = fakeSurfaceKit();

    const view = drawSurface('composer', composerInput, kit);

    const panel = asFake(view.element);
    expect(panel.dataset.part).toBe('floatingPanel');
    expect(describeChildren(panel)).toEqual([
      'contributedParts',
      'working',
      'attachments',
      'box',
      'statusLine',
    ]);
  });

  it.each([
    {
      case: 'full input',
      input: composerInput,
      line: [
        'span.chat-status-repo:repo',
        'span.chat-status-branch:main',
        'typeHint',
        'modelEffort',
        'chip:mode',
        'statusParts',
        'running',
        'send',
      ],
    },
    {
      case: 'branch null',
      input: { ...composerInput, branch: null },
      line: [
        'span.chat-status-repo:repo',
        'typeHint',
        'modelEffort',
        'chip:mode',
        'statusParts',
        'running',
        'send',
      ],
    },
    {
      case: 'modelEffort null',
      input: { ...composerInput, modelEffort: null },
      line: [
        'span.chat-status-repo:repo',
        'span.chat-status-branch:main',
        'typeHint',
        'chip:mode',
        'statusParts',
        'running',
        'send',
      ],
    },
  ])(
    'statusLine_Default_RepoBranchChipsPartsRunningSend ($case)',
    ({ input, line }) => {
      const { kit } = fakeSurfaceKit();

      const view = drawSurface('statusLine', input, kit);

      expect(describeChildren(asFake(view.element))).toEqual(line);
    },
  );

  it('pickerRow_Default_PlacesCursorEnd', () => {
    const { kit, rows, cursorEnd } = fakeSurfaceKit();

    drawSurface(
      'pickerRow',
      { item: { list: 'session', kind: 'new' }, label: 'New session' },
      kit,
    );

    expect(rows).toEqual([
      {
        density: 'list',
        tag: 'li',
        label: 'New session',
        trailing: cursorEnd,
      },
    ]);
  });

  it('signIn_Default_PlacesCopyCodeBoxAndActions', () => {
    const { kit } = fakeSurfaceKit();

    const view = drawSurface(
      'signIn',
      { profile: 'work', link: 'https://example.com/a' },
      kit,
    );

    const root = asFake(view.element);
    expect(describeChildren(root).slice(-2)).toEqual(['codeBox', 'actions']);
    const linkRow = root.children.find(
      (child) => child.className === 'chat-sign-in-link-row',
    );
    expect(describeChildren(linkRow!)).toEqual([
      'span.chat-sign-in-link:https://example.com/a',
      'copy',
    ]);
  });

  it('imageViewer_Default_UpdateMovesCounterAndHidesItForOne', () => {
    const { kit } = fakeSurfaceKit();
    const view = drawSurface(
      'imageViewer',
      { src: 'data:a', index: 0, count: 2 },
      kit,
    );
    const [picture, counter] = asFake(view.element).children;
    expect([picture.src, counter.textContent, counter.hidden]).toEqual([
      'data:a',
      '1 of 2',
      false,
    ]);

    view.update?.({ src: 'data:b', index: 1, count: 2 });
    expect([picture.src, counter.textContent, counter.hidden]).toEqual([
      'data:b',
      '2 of 2',
      false,
    ]);

    view.update?.({ src: 'data:c', index: 0, count: 1 });
    expect([picture.src, counter.textContent, counter.hidden]).toEqual([
      'data:c',
      '1 of 1',
      true,
    ]);
  });
});
