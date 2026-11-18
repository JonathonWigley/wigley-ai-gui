import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTimers } from '../../../shared/fake-timers.test-support';
import {
  type ChatEntry,
  type HarnessEntryKind,
  MAIN_AGENT_ID,
} from '../../../contracts/agent';
import type { ShownLayouts } from '../../../contracts/plugin';
import type { CommandId } from '../../../contracts/commands';
import { element } from '../../../shared/page/dom';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  FakeElement,
  fakeWindow,
  FocusFakeElement,
  installFakeDom,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type { ChatEntryRenderer, QueuedMessage } from '../contract';
import { frameAgentMessage } from '../agent-frame';
import { chatCommand } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type {
  ActivityInput,
  AnyEntryKind,
  ChatKit,
  ChatLayout,
  EntryInput,
  EntryKind,
  EntryView,
  UserDelivery,
} from '../layouts/layout';
import { createChatLayouts } from './chat-layouts';
import { blockIndexOfStop, entryIdOfStop } from './entry-focus';
import { createEntryRenderers } from './entry-renderers';
import {
  createEntryList,
  type EntryList,
  type EntryListPlace,
  type EntryListStop,
  sourceOfLines,
} from './entry-list';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

type AnyBuilder = (
  parent: HTMLElement,
  input: EntryInput<AnyEntryKind>,
  kit: ChatKit,
) => EntryView<AnyEntryKind>;

const KINDS: EntryKind[] = [
  'user',
  'assistant',
  'thinking',
  'tool',
  'permission',
  'result',
  'notice',
  'raw',
  'compaction',
];

// Draws `div.fancy` for every known kind, with the builders in `overrides` in
// place of it; a kind `overrides` sets to undefined is left out. A harness
// kind in `overrides` is copied over.
function fancyLayout(
  overrides: Partial<Record<AnyEntryKind, AnyBuilder | undefined>>,
): ChatLayout {
  const drawsFancy: AnyBuilder = (parent, _input, kit) => ({
    element: kit.el(parent, 'div', 'fancy'),
  });
  const harnessKinds = Object.keys(overrides).filter((kind) =>
    kind.includes(':'),
  ) as HarnessEntryKind[];
  const known = KINDS.filter(
    (kind) => !Object.hasOwn(overrides, kind) || overrides[kind] !== undefined,
  ).map((kind): [string, AnyBuilder | undefined] => [
    kind,
    overrides[kind] ?? drawsFancy,
  ]);
  const entries = Object.fromEntries([
    ...known,
    ...harnessKinds.map((kind): [string, AnyBuilder | undefined] => [
      kind,
      overrides[kind],
    ]),
  ]);
  return { entries };
}

// Draws `div.plugin`.
const drawsPlugin: AnyBuilder = (parent, _input, kit) => ({
  element: kit.el(parent, 'div', 'plugin'),
});

// Names a key hint and draws a card through the kit, then throws.
const anchorsThenThrows: AnyBuilder = (parent, _input, kit) => {
  kit.keyHint(parent, 'allowOrCopy');
  kit.card(parent);
  throw new Error('boom');
};

// Draws `div.fancy` whose update throws.
const updateThrows: AnyBuilder = (parent, _input, kit) => ({
  element: kit.el(parent, 'div', 'fancy'),
  update() {
    throw new Error('broken update');
  },
});

const tool = (id: string): Extract<ChatEntry, { kind: 'tool' }> => ({
  kind: 'tool',
  id,
  at: 1000,
  agentId: MAIN_AGENT_ID,
  toolUseId: `use-${id}`,
  name: 'Bash',
  input: {},
  summary: 'ls',
  result: null,
  raw: [],
});
const notice = (id: string, tone: 'info' | 'error' = 'info'): ChatEntry => ({
  kind: 'notice',
  id,
  at: 1000,
  text: 'hi',
  tone,
  raw: [],
});
const harness = (kind: HarnessEntryKind, id: string): ChatEntry => ({
  kind,
  id,
  at: 1000,
  raw: [],
});
const assistant = (text: string, agentId = MAIN_AGENT_ID): ChatEntry => ({
  kind: 'assistant',
  id: 'a1',
  at: 1000,
  agentId,
  text,
  streaming: false,
  raw: [],
});

interface Row {
  name: string;
  // `live default`: the fancy builders over the bundled default, shown as
  // `default`.
  shown: 'fancy' | 'default' | 'live default';
  fancy?: Partial<Record<AnyEntryKind, AnyBuilder | undefined>>;
  // Added to the list's entry renderers, in order, before the puts.
  renderers?: ChatEntryRenderer[];
  // The kind whose default builder throws.
  breakDefault?: EntryKind;
  // The kind whose default builder draws a view whose update throws.
  defaultUpdateThrows?: EntryKind;
  // Put in order; an entry whose id was put before redraws its slot.
  puts: ChatEntry[];
  // Each slot's children, as `<classes>@<data-layout>`.
  slots: string[][];
  logs: string[];
  toasts: string[];
  disposedAnchors: CommandId[];
}

const rows: Row[] = [
  {
    name: 'shown layout draws',
    shown: 'fancy',
    puts: [tool('t1')],
    slots: [['chat-activity@default'], ['fancy@fancy']],
    logs: [],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'shown layout leaves the kind out',
    shown: 'fancy',
    fancy: { tool: undefined },
    puts: [tool('t1'), notice('n1')],
    slots: [
      ['chat-activity@default'],
      ['chat-entry chat-tool@default'],
      ['fancy@fancy'],
    ],
    logs: [],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'shown layout throws',
    shown: 'fancy',
    fancy: { tool: anchorsThenThrows },
    puts: [tool('t1'), tool('t2')],
    slots: [
      ['chat-activity@default'],
      ['chat-entry chat-tool@default'],
      ['chat-entry chat-tool@default'],
    ],
    logs: ['layout fancy tool entry failed: boom'],
    toasts: ['Chat layout fancy: tool entries drawn with default'],
    disposedAnchors: [chatCommand('allowOrCopy'), chatCommand('allowOrCopy')],
  },
  {
    name: 'default throws while default is shown',
    shown: 'default',
    breakDefault: 'notice',
    puts: [notice('n1'), notice('n2')],
    slots: [['chat-entry chat-raw@'], ['chat-entry chat-raw@']],
    logs: [
      'default layout notice entry failed: broken default',
      'default layout notice entry failed: broken default',
    ],
    toasts: ['Chat layout default: notice entries drawn as bare lines'],
    disposedAnchors: [],
  },
  {
    name: 'default throws after the shown layout threw',
    shown: 'fancy',
    fancy: { notice: anchorsThenThrows },
    breakDefault: 'notice',
    puts: [notice('n1')],
    slots: [['chat-entry chat-raw@']],
    logs: [
      'layout fancy notice entry failed: boom',
      'default layout notice entry failed: broken default',
    ],
    toasts: ['Chat layout fancy: notice entries drawn as bare lines'],
    disposedAnchors: [chatCommand('allowOrCopy')],
  },
  {
    name: 'update throws under the shown layout',
    shown: 'fancy',
    fancy: { assistant: updateThrows },
    puts: [assistant('one'), assistant('two'), assistant('three')],
    slots: [['chat-entry chat-assistant@default']],
    logs: ['layout fancy assistant entry update failed: broken update'],
    toasts: ['Chat layout fancy: assistant entries drawn with default'],
    disposedAnchors: [],
  },
  {
    name: 'update throws, default breaks',
    shown: 'fancy',
    fancy: { assistant: updateThrows },
    breakDefault: 'assistant',
    puts: [assistant('one'), assistant('two'), assistant('three')],
    slots: [['chat-entry chat-raw@']],
    logs: [
      'layout fancy assistant entry update failed: broken update',
      'default layout assistant entry failed: broken default',
      'default layout assistant entry failed: broken default',
    ],
    toasts: ['Chat layout fancy: assistant entries drawn as bare lines'],
    disposedAnchors: [],
  },
  {
    name: 'update throws under a live default',
    shown: 'live default',
    fancy: { assistant: updateThrows },
    puts: [assistant('one'), assistant('two'), assistant('three')],
    slots: [['chat-entry chat-assistant@default']],
    logs: ['layout default assistant entry update failed: broken update'],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'update throws in the bundled default drawn for a kind the shown layout leaves out',
    shown: 'fancy',
    fancy: { assistant: undefined },
    defaultUpdateThrows: 'assistant',
    puts: [assistant('one'), assistant('two'), assistant('three')],
    slots: [['chat-entry chat-assistant@default']],
    logs: [
      'default layout assistant entry update failed: broken update',
      'default layout assistant entry update failed: broken update',
    ],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'harness kind under default draws with raw',
    shown: 'default',
    puts: [harness('fake:card', 'h1')],
    slots: [['chat-entry chat-raw@default']],
    logs: [],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'renderer draws a harness kind',
    shown: 'default',
    renderers: [{ kind: 'fake:card', build: drawsPlugin }],
    puts: [harness('fake:card', 'h1')],
    slots: [['plugin@entry renderer']],
    logs: [],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'user layout names the kind over a renderer',
    shown: 'fancy',
    fancy: {
      'fake:card': (parent, _input, kit) => ({
        element: kit.el(parent, 'div', 'fancy'),
      }),
    },
    renderers: [{ kind: 'fake:card', build: drawsPlugin }],
    puts: [harness('fake:card', 'h1')],
    slots: [['fancy@fancy']],
    logs: [],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'renderer matches one notice',
    shown: 'default',
    renderers: [
      {
        kind: 'notice',
        match: (input) => input.kind === 'notice' && input.tone === 'error',
        build: drawsPlugin,
      },
    ],
    puts: [notice('n1'), notice('n2', 'error')],
    slots: [
      ['chat-entry chat-notice chat-notice-info@default'],
      ['plugin@entry renderer'],
    ],
    logs: [],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'renderer match turns true on an update',
    shown: 'default',
    renderers: [
      {
        kind: 'notice',
        match: (input) => input.kind === 'notice' && input.tone === 'error',
        build: drawsPlugin,
      },
    ],
    puts: [notice('n1'), notice('n1', 'error')],
    slots: [['plugin@entry renderer']],
    logs: [],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'renderer match turns false on an update',
    shown: 'default',
    renderers: [
      {
        kind: 'notice',
        match: (input) => input.kind === 'notice' && input.tone === 'error',
        build: (parent, _input, kit) => ({
          element: kit.el(parent, 'div', 'plugin'),
          update: () => undefined,
        }),
      },
    ],
    puts: [notice('n1', 'error'), notice('n1')],
    slots: [['chat-entry chat-notice chat-notice-info@default']],
    logs: [],
    toasts: [],
    disposedAnchors: [],
  },
  {
    // The third put finds the slot drawing with default after the second's
    // update threw; a `match` run then would log its throw.
    name: 'slot drawing with default runs no renderer match',
    shown: 'default',
    renderers: [
      {
        kind: 'fake:card',
        match: (input) => {
          if (input.raw.length === 2) {
            throw new Error('match ran');
          }
          return true;
        },
        build: updateThrows,
      },
    ],
    puts: [
      harness('fake:card', 'h1'),
      { ...harness('fake:card', 'h1'), raw: ['second'] },
      { ...harness('fake:card', 'h1'), raw: ['second', 'third'] },
    ],
    slots: [['chat-entry chat-raw@default']],
    logs: [
      'layout entry renderer fake:card entry update failed: broken update',
    ],
    toasts: ['Chat entry renderer: fake:card entries drawn with default'],
    disposedAnchors: [],
  },
  {
    name: 'renderer throws',
    shown: 'default',
    renderers: [
      {
        kind: 'fake:card',
        build: () => {
          throw new Error('boom');
        },
      },
    ],
    puts: [harness('fake:card', 'h1'), harness('fake:card', 'h2')],
    slots: [['chat-entry chat-raw@default'], ['chat-entry chat-raw@default']],
    logs: ['layout entry renderer fake:card entry failed: boom'],
    toasts: ['Chat entry renderer: fake:card entries drawn with default'],
    disposedAnchors: [],
  },
];

const timed = (entry: ChatEntry, time: number): ChatEntry => ({
  ...entry,
  at: time,
});
const user = (id: string): Extract<ChatEntry, { kind: 'user' }> => ({
  kind: 'user',
  id,
  at: 1000,
  text: 'ask',
  images: [],
  delivery: null,
  raw: [],
});
const thinking = (id: string, agentId = MAIN_AGENT_ID): ChatEntry => ({
  kind: 'thinking',
  id,
  at: 1000,
  agentId,
  text: 'hmm',
  streaming: false,
  raw: [],
});
const permission = (id: string): ChatEntry => ({
  kind: 'permission',
  id,
  at: 1000,
  toolName: 'Bash',
  input: {},
  answer: null,
  raw: [],
});
const result = (id: string): ChatEntry => ({
  kind: 'result',
  id,
  at: 2000,
  stopReason: 'end_turn',
  costUsd: null,
  durationMs: null,
  raw: [],
});
const compaction = (id: string): ChatEntry => ({
  kind: 'compaction',
  id,
  at: 2000,
  trigger: 'manual',
  beforeTokens: 180_000,
  afterTokens: 24_000,
  durationMs: 9000,
  raw: [],
});

const queued = (id: string): QueuedMessage => ({
  id,
  text: `text of ${id}`,
  images: [],
  sentEntryId: null,
  holdReason: null,
});
const pendingStop = (id: string) => ({ kind: 'queued', message: queued(id) });

function defaultShown(): ShownLayouts<ChatLayout> {
  return {
    layouts: new Map<string, ChatLayout>([['default', defaultLayout]]),
    user: 'default',
  };
}

// The user layout `user`, named `name`, with activity in the transcript.
function activityShown(
  user: ChatLayout = {},
  name = 'activity',
): ShownLayouts<ChatLayout> {
  return withUser<ChatLayout>(
    defaultLayout,
    { ...user, activityInTranscript: true },
    name,
  );
}

// A list over `shown`, its layouts, entry renderers, logs, toasts, disposed
// anchors, timers, a clock whose `time` the test sets, the ids each pending
// row click pulled back, and the counts of `placeChanged` and `focusChanged`
// calls.
// `put` puts an entry into the session's list, replacing the one holding its
// id.
const TURN_LINE_CLASS = 'chat-turn-line-slot';

function setUpList(shown: ShownLayouts<ChatLayout>) {
  const logs: string[] = [];
  const pulled: string[] = [];
  const toasts: string[] = [];
  const disposed: CommandId[] = [];
  const log = (message: string) => logs.push(message);
  const layouts = createChatLayouts(log);
  layouts.set(shown);
  const renderers = createEntryRenderers(log);
  const { timers, armed, fireAll } = fakeTimers();
  const clock = { time: 1000, now: () => clock.time };
  const placeChanges = { count: 0 };
  const focusChanges = { count: 0 };
  const list = createEntryList({
    layouts,
    renderers,
    toastedKinds: new Set(),
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: (text) => Promise.resolve(text),
        ...NO_FENCES,
      },
      keys: {
        anchor: (_node, command) => ({
          dispose: () => disposed.push(command),
        }),
        keysFor: (command) =>
          command === chatCommand('interrupt') ? '⌃C' : null,
      },
      commands: {
        exists: () => true,
        argShape: () => undefined,
        run: () => undefined,
      },
      platform: 'macos',
      state: noLayoutState,
      allow: () => undefined,
      deny: () => undefined,
      openImages: () => undefined,
      expanderClicked: (entryId, place) => list.toggleExpander(entryId, place),
    },
    log,
    toast: (text) => toasts.push(text),
    timers,
    clock,
    pullBack: (queuedId) => pulled.push(queuedId),
    // As the click's commands do in the app.
    runClicked: (runId) => list.toggleRun(runId),
    stopClicked: (stopId) => list.moveFocusTo(stopId),
    turnLine: element('li', TURN_LINE_CLASS),
    placeChanged: () => {
      placeChanges.count++;
    },
    focusChanged: () => {
      focusChanges.count++;
    },
  });
  const held = new Map<string, ChatEntry>();
  const put = (entry: ChatEntry) => {
    held.set(entry.id, entry);
    list.put(entry, [...held.values()]);
  };
  const entries = () => [...held.values()];
  return {
    list,
    logs,
    toasts,
    disposed,
    pulled,
    armed,
    fireAll,
    clock,
    layouts,
    renderers,
    placeChanges,
    focusChanges,
    put,
    entries,
  };
}

const delivered = (id: string, delivery: UserDelivery | null): ChatEntry => ({
  ...user(id),
  delivery,
});

// A user layout whose user part draws one marked block, drawn anew on update,
// and records each draw's delivery and latest flag by entry id, and each
// update's with its id.
function recordingDelivery() {
  const draws = new Map<string, [UserDelivery | null, boolean]>();
  const updates: [string, UserDelivery | null, boolean][] = [];
  const shown = withUser<ChatLayout>(
    defaultLayout,
    {
      entries: {
        user(parent, input, kit) {
          draws.set(input.id, [input.delivery, input.isLatestDelivery]);
          const root = kit.el(parent, 'div', 'recorded');
          const drawBlock = () => {
            root.replaceChildren();
            kit.el(root, 'div').dataset.mdLines = '0,1';
          };
          drawBlock();
          return {
            element: root,
            update(next) {
              updates.push([next.id, next.delivery, next.isLatestDelivery]);
              drawBlock();
            },
          };
        },
      },
    },
    'recording',
  );
  return { draws, updates, shown };
}

// The list's slots but the turn line.
function drawnSlots(list: HTMLElement): FakeElement[] {
  return asFake(list).children.filter(
    (slot) => !slot.classList.contains(TURN_LINE_CLASS),
  );
}

// Each of the list's slots but the turn line as `<classes>`, ` hidden` added while
// hidden.
function slotClasses(list: HTMLElement): string[] {
  return drawnSlots(list).map(
    (slot) => `${slot.className}${slot.hidden ? ' hidden' : ''}`,
  );
}

// The list's slot whose classes include `className`, `index` among them.
function slotOf(list: HTMLElement, className: string, index = 0): FakeElement {
  return asFake(list).children.filter((slot) =>
    slot.classList.contains(className),
  )[index];
}

// One draw or update of a recording activity part: the run's first step id
// and the input.
interface ActivityCall {
  how: 'draw' | 'update';
  run: string;
  input: ActivityInput;
}

// A user layout `fancy` whose activity part draws `div.fancy-activity` and
// records each draw and update in `calls`.
function recordingActivity(calls: ActivityCall[]): ShownLayouts<ChatLayout> {
  const record = (how: ActivityCall['how'], input: ActivityInput) =>
    calls.push({ how, run: input.steps[0].id, input });
  return activityShown(
    {
      activity(parent, input, kit) {
        record('draw', input);
        return {
          element: kit.el(parent, 'div', 'fancy-activity'),
          update: (next) => record('update', next),
        };
      },
    },
    'fancy',
  );
}

// A user layout with activity in the transcript whose tool and thinking parts
// record the duration of each input they draw or update with, by entry id.
function recordingStepDurations() {
  const durations = new Map<string, (number | null)[]>();
  const record = (input: { id: string; durationMs: number | null }) =>
    durations.set(input.id, [
      ...(durations.get(input.id) ?? []),
      input.durationMs,
    ]);
  const drawStep = (
    parent: HTMLElement,
    input: { id: string; durationMs: number | null },
    kit: ChatKit,
  ) => {
    record(input);
    return { element: kit.el(parent, 'div', 'recorded'), update: record };
  };
  const shown = activityShown(
    {
      entries: {
        tool: (parent, input, kit) => drawStep(parent, input, kit),
        thinking: (parent, input, kit) => drawStep(parent, input, kit),
      },
    },
    'recording',
  );
  return { durations, shown };
}

describe('entry list', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(rows)('buildEntry: $name', (row) => {
    if (row.breakDefault !== undefined) {
      vi.spyOn(defaultLayout.entries, row.breakDefault).mockImplementation(
        () => {
          throw new Error('broken default');
        },
      );
    }
    if (row.defaultUpdateThrows !== undefined) {
      vi.spyOn(
        defaultLayout.entries,
        row.defaultUpdateThrows,
      ).mockImplementation(updateThrows);
    }
    const shown = {
      default: defaultShown(),
      fancy: activityShown(fancyLayout(row.fancy ?? {}), 'fancy'),
      'live default': {
        layouts: new Map<string, ChatLayout>([
          ['default', { ...defaultLayout, ...fancyLayout(row.fancy ?? {}) }],
        ]),
        user: 'default',
      },
    }[row.shown];
    const { list, logs, toasts, disposed, put, renderers } = setUpList(shown);
    for (const renderer of row.renderers ?? []) {
      renderers.add(renderer);
    }

    for (const entry of row.puts) {
      put(entry);
    }

    const slots = drawnSlots(list.element).map((slot) =>
      slot.children.map(
        (child: FakeElement) =>
          `${child.className}@${child.dataset.layout ?? ''}`,
      ),
    );
    expect(slots).toEqual(row.slots);
    expect(logs).toEqual(row.logs);
    expect(toasts).toEqual(row.toasts);
    expect(disposed).toEqual(row.disposedAnchors);
  });

  it('moveFocusTo_StopNotInOrder_LeavesTheFocus', () => {
    const { list, put, focusChanges } = setUpList(defaultShown());
    [user('u1'), notice('n1')].forEach(put);
    list.move(-1);
    const before = list.focused();
    focusChanges.count = 0;

    const moved = list.moveFocusTo('no-such-stop');

    expect(moved).toBe(false);
    expect(list.focused()).toEqual(before);
    expect(focusChanges.count).toBe(0);
    expect(list.moveFocusTo('n1')).toBe(true);
    expect(list.focused()).toEqual({ kind: 'entry', entry: notice('n1') });
    expect(focusChanges.count).toBe(1);
    list.moveFocusTo('n1');
    expect(focusChanges.count).toBe(1);
  });

  const notices = [notice('n1'), notice('n2'), notice('n3')];
  const withRun = [user('u1'), tool('t1'), tool('t2'), assistant('done')];

  // Draws one marked block per top, each a 10px box there, which a scroll into
  // view moves to 80px, inside the list's 100px band.
  const blocksAt =
    (...tops: number[]): AnyBuilder =>
    (parent, _input, kit) => {
      const root = kit.el(parent, 'div', 'marked');
      tops.forEach((top, index) => {
        const block = asFake(kit.el(root, 'div')) as FocusFakeElement;
        block.dataset.mdLines = `${index},${index + 1}`;
        block.rectTop = top;
        block.rectHeight = 10;
        block.scrollIntoView = () => {
          block.rectTop = 80;
        };
      });
      return { element: root };
    };

  // `thenActivity`: the restore lands on the default layout, and a layout with
  // activity in the transcript shows after it; `assistantDraws`: the assistant
  // builders of the two layouts, `default`'s when left out; `movesFirst`: what
  // the user does before that layout shows; `isScrolledAfter`: a scroll event
  // after it, as the restore's own scroll event fires a frame late. `block` is
  // the cursor's block, none when left out.
  it.each<{
    name: string;
    held: ChatEntry[];
    stopId: string;
    openRuns?: string[];
    isRestoredFirst?: boolean;
    thenActivity?: boolean;
    assistantDraws?: [first: AnyBuilder, withActivity: AnyBuilder];
    movesFirst?: (list: EntryList, scroller: FakeElement) => void;
    isScrolledAfter?: boolean;
    focused: EntryListStop;
    block?: number;
  }>([
    {
      name: 'a held stop',
      held: notices,
      stopId: 'n2',
      focused: { kind: 'entry', entry: notice('n2') },
    },
    {
      name: 'a held stop restored before the entries arrive',
      held: notices,
      stopId: 'n2',
      isRestoredFirst: true,
      focused: { kind: 'entry', entry: notice('n2') },
    },
    {
      name: 'a stop no entry holds',
      held: notices,
      stopId: 'gone',
      focused: { kind: 'entry', entry: notice('n3') },
    },
    {
      name: 'a run stop the first layout does not draw',
      held: withRun,
      stopId: 'activity:t1',
      thenActivity: true,
      focused: {
        kind: 'activity',
        runId: 'activity:t1',
        steps: [tool('t1'), tool('t2')],
      },
    },
    {
      name: 'a step stop the first layout does not draw',
      held: withRun,
      stopId: 't2',
      openRuns: ['activity:t1'],
      thenActivity: true,
      focused: { kind: 'entry', entry: tool('t2') },
    },
    {
      name: 'a run stop the first layout does not draw, the user moving first',
      held: withRun,
      stopId: 'activity:t1',
      thenActivity: true,
      movesFirst: (list) => list.move(-1),
      focused: { kind: 'entry', entry: user('u1') },
    },
    {
      name: 'a run stop the first layout does not draw, a scroll leaving the cursor in view',
      held: withRun,
      stopId: 'activity:t1',
      thenActivity: true,
      movesFirst: (_list, scroller) => {
        scroller.scrollTop = 250;
        scroller.fire('scroll');
      },
      focused: { kind: 'entry', entry: assistant('done') },
    },
    {
      name: 'a run stop the first layout does not draw, a toggle of no expander first',
      held: withRun,
      stopId: 'activity:t1',
      thenActivity: true,
      movesFirst: (list) => list.toggleExpander('gone', 0),
      focused: {
        kind: 'activity',
        runId: 'activity:t1',
        steps: [tool('t1'), tool('t2')],
      },
    },
    {
      name: 'a run stop the first layout does not draw, a cancel of no range first',
      held: withRun,
      stopId: 'activity:t1',
      thenActivity: true,
      movesFirst: (list) => list.cancelRange(),
      focused: {
        kind: 'activity',
        runId: 'activity:t1',
        steps: [tool('t1'), tool('t2')],
      },
    },
    {
      name: 'a block stop the layout with activity draws lower, past the band',
      held: withRun,
      stopId: 'a1#1',
      thenActivity: true,
      assistantDraws: [blocksAt(10, 30), blocksAt(50, 150)],
      isScrolledAfter: true,
      focused: { kind: 'entry', entry: assistant('done') },
      block: 1,
    },
  ])(
    'restored_stop_that_no_entry_holds_falls_back ($name)',
    ({
      held,
      stopId,
      openRuns = [],
      isRestoredFirst = false,
      thenActivity = false,
      assistantDraws,
      movesFirst,
      isScrolledAfter = false,
      focused,
      block = null,
    }) => {
      installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
      vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingBottom: '0px' }));
      const [firstAssistant, activityAssistant] = assistantDraws ?? [];
      const { list, layouts } = setUpList(
        firstAssistant === undefined
          ? defaultShown()
          : withUser<ChatLayout>(
              defaultLayout,
              { entries: { assistant: firstAssistant } },
              'blocks',
            ),
      );
      const scroller = asFake(list.element) as FocusFakeElement & {
        scrollHeight: number;
        clientHeight: number;
      };
      scroller.rectHeight = 100;
      scroller.scrollHeight = 400;
      scroller.clientHeight = 100;
      const place = {
        focus: { stopId, following: false, anchorId: null },
        openRuns,
        openExpanders: {},
      };
      if (isRestoredFirst) {
        list.restorePlace(place);
        list.rebuild(held);
      } else {
        list.rebuild(held);
        list.restorePlace(place);
      }
      movesFirst?.(list, scroller);
      if (thenActivity) {
        layouts.set(
          activityShown(
            activityAssistant === undefined
              ? {}
              : { entries: { assistant: activityAssistant } },
          ),
        );
        list.rebuild(held);
      }
      if (isScrolledAfter) {
        scroller.scrollTop = 250;
        scroller.fire('scroll');
      }

      const blockAtCursor = cursorBlock(list);
      expect(list.focused()).toEqual(focused);
      expect(
        blockAtCursor === null
          ? null
          : blockAtCursor.parentNode!.children.indexOf(blockAtCursor),
      ).toBe(block);
    },
  );

  it('toggleExpander_EntryWithNoSlot_GivesNothing', () => {
    const { list, put } = setUpList(defaultShown());
    put(user('u1'));

    expect(list.toggleExpander('gone', 0)).toBe('nothing');
  });
});

describe('activity lines', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
    vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingBottom: '0px' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const userToolToolAssistant = [
    user('u1'),
    tool('t1'),
    tool('t2'),
    assistant('done'),
  ];
  const runStop = (steps: ChatEntry[]) => ({
    kind: 'activity',
    runId: 'activity:t1',
    steps,
  });

  it('runs_UserToolToolAssistant_OneActivitySlotBeforeHiddenSteps', () => {
    const { list, put } = setUpList(activityShown());
    userToolToolAssistant.forEach(put);

    expect(slotClasses(list.element)).toEqual([
      'chat-entry-slot',
      'chat-entry-slot chat-activity-slot',
      'chat-entry-slot chat-step-slot hidden',
      'chat-entry-slot chat-step-slot hidden',
      'chat-entry-slot is-cursor',
    ]);
    expect(list.move(-1)).toEqual(runStop([tool('t1'), tool('t2')]));
  });

  it('runs_ToggleTwice_OpensIntoStepsThenCloses', () => {
    const { list, put } = setUpList(activityShown());
    userToolToolAssistant.forEach(put);
    list.move(-1);

    expect(list.toggleFocused()).toEqual({
      stop: runStop([tool('t1'), tool('t2')]),
      result: 'expanded',
    });
    expect(slotOf(list.element, 'chat-step-slot', 0).hidden).toBe(false);
    expect(slotOf(list.element, 'chat-step-slot', 1).hidden).toBe(false);
    expect(list.move(1)).toEqual({ kind: 'entry', entry: tool('t1') });
    list.move(-1);
    expect(list.toggleFocused()?.result).toBe('collapsed');
    expect(slotOf(list.element, 'chat-step-slot', 0).hidden).toBe(true);
    expect(slotOf(list.element, 'chat-step-slot', 1).hidden).toBe(true);
  });

  it('runs_LastRunFollowedToggleTwiceWithAStepBetween_StaysOnTheLine', () => {
    const { list, put } = setUpList(activityShown());
    [user('u1'), tool('t1'), tool('t2')].forEach(put);

    expect(list.toggleFocused()?.result).toBe('expanded');
    put(tool('t3'));
    expect(list.focused()).toEqual(
      runStop([tool('t1'), tool('t2'), tool('t3')]),
    );
    list.latest();
    expect(list.toggleFocused()?.result).toBe('collapsed');
    put(assistant('done'));
    expect(list.focused()).toEqual({ kind: 'entry', entry: assistant('done') });
  });

  it('runs_ClickClosesWithFocusOnStep_FocusMovesToTheRun', () => {
    const { list, put } = setUpList(activityShown());
    userToolToolAssistant.forEach(put);
    list.move(-1);
    list.toggleFocused();
    list.move(1);
    list.move(1);

    slotOf(list.element, 'chat-activity-slot').click();

    expect(list.focused()).toEqual(runStop([tool('t1'), tool('t2')]));
    expect(slotOf(list.element, 'chat-step-slot', 1).hidden).toBe(true);
  });

  it('runs_LastRunSetWorkingThenAnswered_LiveThenEndsAtTheAnswer', () => {
    const calls: ActivityCall[] = [];
    const { list, put } = setUpList(recordingActivity(calls));
    put(timed(user('u1'), 1000));
    put(timed(tool('t1'), 2000));

    list.setWorking(true);
    expect(calls.at(-1)?.input).toMatchObject({ live: true, endedAt: null });

    put(timed(assistant('done'), 5000));
    expect(calls.at(-1)?.input).toMatchObject({
      live: false,
      startedAt: 1000,
      endedAt: 5000,
    });
  });

  it('runs_LiveTick_UpdatesOnlyTheLiveRun', () => {
    const calls: ActivityCall[] = [];
    const { list, put, armed, fireAll, clock } = setUpList(
      recordingActivity(calls),
    );
    [user('u1'), tool('t1'), assistant('mid'), tool('t2')].forEach(put);
    list.setWorking(true);
    calls.length = 0;
    clock.time = 7000;

    fireAll();

    expect(calls).toEqual([
      {
        how: 'update',
        run: 't2',
        input: expect.objectContaining({ live: true, now: 7000 }),
      },
    ]);
    expect(armed.size).toBe(1);
    list.setWorking(false);
    expect(armed.size).toBe(0);
    list.setWorking(true);
    expect(armed.size).toBe(1);
    list.dispose();
    expect(armed.size).toBe(0);
  });

  it('runs_PutInAnotherRowThenOnItsStep_UpdatesOnlyOnItsStep', () => {
    const calls: ActivityCall[] = [];
    const { put } = setUpList(recordingActivity(calls));
    [user('u1'), assistant('first'), tool('t1')].forEach(put);
    calls.length = 0;

    put(assistant('first, edited'));
    expect(calls).toEqual([]);

    put({ ...tool('t1'), result: { text: 'ok', isError: false } });
    expect(calls.map((call) => call.how)).toEqual(['update']);
  });

  it('runs_UserToolBuilder_StepSlotsDrawWithIt', () => {
    const { list, put } = setUpList(activityShown(fancyLayout({}), 'fancy'));
    userToolToolAssistant.forEach(put);
    list.move(-1);
    list.toggleFocused();

    const step = slotOf(list.element, 'chat-step-slot');
    expect(step.hidden).toBe(false);
    expect(step.children.map((child) => child.className)).toEqual(['fancy']);
  });

  it('runs_UserActivityUpdateThrows_RedrawsWithDefault', () => {
    const { list, logs, put } = setUpList(
      activityShown(
        {
          activity: (parent, _input, kit) => ({
            element: kit.el(parent, 'div', 'fancy-activity'),
            update() {
              throw new Error('broken update');
            },
          }),
        },
        'fancy',
      ),
    );
    [user('u1'), tool('t1')].forEach(put);

    put(tool('t2'));

    const run = slotOf(list.element, 'chat-activity-slot');
    expect(
      run.children.map((child) => `${child.className}@${child.dataset.layout}`),
    ).toEqual(['chat-activity@default']);
    expect(logs).toContain(
      'layout fancy activity update failed: broken update',
    );
  });

  it('runs_DefaultActivityThrows_LeavesBareLine', () => {
    vi.spyOn(defaultLayout, 'activity').mockImplementation(() => {
      throw new Error('broken default');
    });
    const { list, logs, put } = setUpList(activityShown());

    put(tool('t1'));

    const run = slotOf(list.element, 'chat-activity-slot');
    expect(run.children.map((child) => child.className)).toEqual([
      'chat-entry chat-raw',
    ]);
    expect(run.textContent).toBe('activity');
    expect(logs).toEqual(['default layout activity failed: broken default']);
  });

  it('runs_RebuildSameEntries_RunStaysOpen', () => {
    const { list, put, entries } = setUpList(activityShown());
    userToolToolAssistant.forEach(put);
    list.move(-1);
    list.toggleFocused();

    list.rebuild(entries());

    expect(slotClasses(list.element)).toEqual([
      'chat-entry-slot',
      'chat-entry-slot chat-activity-slot is-cursor',
      'chat-entry-slot chat-step-slot',
      'chat-entry-slot chat-step-slot',
      'chat-entry-slot',
    ]);
  });

  it('put of an entry ending a step redraws the step with its duration', () => {
    const { durations, shown } = recordingStepDurations();
    const { put } = setUpList(shown);
    put(timed(user('u1'), 1000));
    put(timed(tool('t1'), 2000));
    expect(durations.get('t1')?.at(-1)).toBeNull();

    put(timed(assistant('done'), 6200));

    expect(durations.get('t1')?.at(-1)).toBe(4200);
  });

  it('rebuild draws each step between entries with its duration', () => {
    const { durations, shown } = recordingStepDurations();
    const { list } = setUpList(shown);

    list.rebuild([
      timed(user('u1'), 1000),
      timed(tool('t1'), 2000),
      timed(thinking('k1'), 2500),
      timed(assistant('done'), 6200),
    ]);

    expect([durations.get('t1'), durations.get('k1')]).toEqual([[500], [3700]]);
  });
});

describe('pending rows', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
    vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingBottom: '0px' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('turnLine_EntriesPendingRowsAndRebuild_StaysBetweenEntriesAndPendingRows', () => {
    const { list, put, entries } = setUpList(defaultShown());
    const placed = () =>
      asFake(list.element).children.map((slot) =>
        slot.classList.contains(TURN_LINE_CLASS)
          ? 'line'
          : slot.classList.contains('chat-queued-slot')
            ? 'pending'
            : 'entry',
      );

    put(user('u1'));
    list.setQueued([queued('q1')]);
    put(notice('n1'));
    expect(placed()).toEqual(['entry', 'entry', 'line', 'pending']);

    list.rebuild(entries());
    expect(placed()).toEqual(['entry', 'entry', 'line', 'pending']);
  });

  it('pending_FocusOnLastEntryThenRowLeaves_StopsAfterEntriesAndFollowsLatest', () => {
    const { list, put } = setUpList(defaultShown());
    [user('u1'), notice('n1')].forEach(put);
    list.setQueued([queued('q1'), queued('q2')]);
    list.move(-1);
    list.move(-1);

    expect(list.move(1)).toEqual(pendingStop('q1'));
    expect(list.move(1)).toEqual(pendingStop('q2'));
    list.move(-1);
    list.setQueued([queued('q2')]);

    expect(slotClasses(list.element)).toEqual([
      'chat-entry-slot',
      'chat-entry-slot',
      'chat-entry-slot chat-queued-slot is-cursor',
    ]);
    expect(list.focused()).toEqual(pendingStop('q2'));
    list.setQueued([queued('q2'), queued('q3')]);
    expect(list.focused()).toEqual(pendingStop('q3'));
  });

  it('pending_EntryPutAfterRows_SlotsSitBeforeRows', () => {
    const { list, put } = setUpList(defaultShown());
    put(user('u1'));
    list.setQueued([queued('q1'), queued('q2')]);

    put(assistant('a1'));

    expect(slotClasses(list.element)).toEqual([
      'chat-entry-slot',
      'chat-entry-slot',
      'chat-entry-slot chat-queued-slot',
      'chat-entry-slot chat-queued-slot is-cursor',
    ]);
  });

  it('pending_RunPutAfterRows_SlotsSitBeforeRows', () => {
    const { list, put } = setUpList(activityShown());
    put(user('u1'));
    list.setQueued([queued('q1'), queued('q2')]);

    put(tool('t1'));

    expect(slotClasses(list.element)).toEqual([
      'chat-entry-slot',
      'chat-entry-slot chat-activity-slot',
      'chat-entry-slot chat-step-slot hidden',
      'chat-entry-slot chat-queued-slot',
      'chat-entry-slot chat-queued-slot is-cursor',
    ]);
  });

  it('pending_ClickRow_PullsBackWithoutMovingTheCursor', () => {
    const { list, put, pulled } = setUpList(defaultShown());
    put(user('u1'));
    list.setQueued([queued('q1'), queued('q2')]);
    list.move(-1);

    const row = slotOf(list.element, 'chat-queued-slot', 1);
    row.click();
    asFake(list.element).fire('click', { target: row });

    expect(pulled).toEqual(['q2']);
    expect(list.focused()).toEqual(pendingStop('q1'));
  });

  it('pending_RebuildWithFocusOnRow_RowsStayAfterEntriesAndKeepTheFocus', () => {
    const { list, put, entries } = setUpList(defaultShown());
    [user('u1'), notice('n1')].forEach(put);
    list.setQueued([queued('q1'), queued('q2')]);
    list.move(-1);

    list.rebuild(entries());

    expect(slotClasses(list.element)).toEqual([
      'chat-entry-slot',
      'chat-entry-slot',
      'chat-entry-slot chat-queued-slot is-cursor',
      'chat-entry-slot chat-queued-slot',
    ]);
    expect(list.focused()).toEqual(pendingStop('q1'));
  });

  it('pending_RowAfterFollowedOpenLastRun_FollowingFocusLandsOnTheRow', () => {
    const { list, put } = setUpList(activityShown());
    [user('u1'), tool('t1'), tool('t2')].forEach(put);
    list.toggleFocused();

    list.setQueued([queued('q1')]);

    expect(list.focused()).toEqual(pendingStop('q1'));
    list.latest();
    expect(list.focused()).toEqual(pendingStop('q1'));
  });

  it('pending_OnlyRowLeavesDuringFollowedOpenLastRun_FocusReturnsToTheLineAndFollows', () => {
    const { list, put } = setUpList(activityShown());
    [user('u1'), tool('t1'), tool('t2')].forEach(put);
    list.toggleFocused();
    const line = expect.objectContaining({
      kind: 'activity',
      runId: 'activity:t1',
    });
    list.setQueued([queued('q1')]);
    expect(list.focused()).toEqual(pendingStop('q1'));

    list.setQueued([]);
    expect(list.focused()).toEqual(line);
    put(tool('t3'));

    expect(list.focused()).toEqual(line);
  });

  it('pending_RowTurnsSent_UpdatesThePartWithSent', () => {
    const calls: { how: 'draw' | 'update'; sent: boolean }[] = [];
    const shown = withUser<ChatLayout>(
      defaultLayout,
      {
        queuedMessage(parent, input, kit) {
          calls.push({ how: 'draw', sent: input.sent });
          return {
            element: kit.el(parent, 'div', 'fancy-queued'),
            update: (next) => calls.push({ how: 'update', sent: next.sent }),
          };
        },
      },
      'fancy',
    );
    const { list, put } = setUpList(shown);
    put(user('u1'));
    list.setQueued([queued('q1')]);

    list.setQueued([{ ...queued('q1'), sentEntryId: 'user-2' }]);

    expect(calls).toEqual([
      { how: 'draw', sent: false },
      { how: 'update', sent: true },
    ]);
  });

  it('pending_HeldRow_PartGetsHoldReasonAndSkipKey', () => {
    const calls: {
      how: 'draw' | 'update';
      holdReason: string | null;
      skipKey: string;
    }[] = [];
    const shown = withUser<ChatLayout>(
      defaultLayout,
      {
        queuedMessage(parent, input, kit) {
          calls.push({
            how: 'draw',
            holdReason: input.holdReason,
            skipKey: input.skipKey,
          });
          return {
            element: kit.el(parent, 'div', 'fancy-queued'),
            update: (next) =>
              calls.push({
                how: 'update',
                holdReason: next.holdReason,
                skipKey: next.skipKey,
              }),
          };
        },
      },
      'fancy',
    );
    const { list, put } = setUpList(shown);
    put(user('u1'));

    list.setQueued([
      { ...queued('q1'), holdReason: 'auto · cache cold · 182k' },
    ]);
    list.setQueued([{ ...queued('q1'), holdReason: null }]);

    expect(calls).toEqual([
      {
        how: 'draw',
        holdReason: 'auto · cache cold · 182k',
        skipKey: '⌃C',
      },
      { how: 'update', holdReason: null, skipKey: '⌃C' },
    ]);
  });
});

describe('activity hidden', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
    vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingBottom: '0px' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type ListSetUp = ReturnType<typeof setUpList>;
  const everyKind = [
    user('u1'),
    tool('t1'),
    thinking('k1'),
    assistant('done'),
    permission('p1'),
    result('r1'),
    compaction('c1'),
    notice('n1'),
  ];
  const putAllThenRebuild = ({ list, put, entries }: ListSetUp) => {
    everyKind.forEach(put);
    list.rebuild(entries());
  };
  const subagentText = [
    { ...assistant('found it', 'b1'), id: 'sa1' },
    thinking('sk1', 'b1'),
  ];
  const putAllAndSubagentTextThenRebuild = ({
    list,
    put,
    entries,
  }: ListSetUp) => {
    [...everyKind, ...subagentText].forEach(put);
    list.rebuild(entries());
  };

  // The focused stop's id: an entry's, a run's, or a pending row's message's.
  const stopId = (stop: EntryListStop) => {
    if (stop.kind === 'entry') {
      return stop.entry.id;
    }
    return stop.kind === 'activity' ? stop.runId : stop.message.id;
  };

  it.each<{
    case: string;
    shown: () => ShownLayouts<ChatLayout>;
    act: (setUp: ListSetUp) => void;
    slots: string[];
    kinds: string[];
    stops: string[];
    focused: string | null;
  }>([
    {
      case: 'default layout, rebuilt',
      shown: defaultShown,
      act: putAllThenRebuild,
      slots: [
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot is-cursor',
      ],
      kinds: [
        'chat-user',
        'chat-assistant',
        'chat-permission',
        'chat-result',
        'chat-compaction',
        'chat-notice',
      ],
      stops: ['u1', 'a1', 'p1', 'n1'],
      focused: 'n1',
    },
    {
      case: 'activity in the transcript, rebuilt',
      shown: () => activityShown(),
      act: putAllThenRebuild,
      slots: [
        'chat-entry-slot',
        'chat-entry-slot chat-activity-slot',
        'chat-entry-slot chat-step-slot hidden',
        'chat-entry-slot chat-step-slot hidden',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot is-cursor',
      ],
      kinds: [
        'chat-user',
        'chat-activity',
        'chat-tool',
        'chat-thinking',
        'chat-assistant',
        'chat-permission',
        'chat-result',
        'chat-compaction',
        'chat-notice',
      ],
      stops: ['u1', 'activity:t1', 'a1', 'p1', 'n1'],
      focused: 'n1',
    },
    {
      case: 'subagent text and thinking, default layout, rebuilt',
      shown: defaultShown,
      act: putAllAndSubagentTextThenRebuild,
      slots: [
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot is-cursor',
      ],
      kinds: [
        'chat-user',
        'chat-assistant',
        'chat-permission',
        'chat-result',
        'chat-compaction',
        'chat-notice',
      ],
      stops: ['u1', 'a1', 'p1', 'n1'],
      focused: 'n1',
    },
    {
      case: 'subagent text and thinking, activity in the transcript, rebuilt',
      shown: () => activityShown(),
      act: putAllAndSubagentTextThenRebuild,
      slots: [
        'chat-entry-slot',
        'chat-entry-slot chat-activity-slot',
        'chat-entry-slot chat-step-slot hidden',
        'chat-entry-slot chat-step-slot hidden',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot is-cursor',
      ],
      kinds: [
        'chat-user',
        'chat-activity',
        'chat-tool',
        'chat-thinking',
        'chat-assistant',
        'chat-permission',
        'chat-result',
        'chat-compaction',
        'chat-notice',
      ],
      stops: ['u1', 'activity:t1', 'a1', 'p1', 'n1'],
      focused: 'n1',
    },
    {
      case: 'activity in the transcript, focus on the activity line, then the default layout, rebuilt',
      shown: () => activityShown(),
      act: ({ list, put, entries, layouts }) => {
        everyKind.forEach(put);
        list.first();
        list.move(1);
        layouts.set(defaultShown());
        list.rebuild(entries());
      },
      slots: [
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot is-cursor',
      ],
      kinds: [
        'chat-user',
        'chat-assistant',
        'chat-permission',
        'chat-result',
        'chat-compaction',
        'chat-notice',
      ],
      stops: ['u1', 'a1', 'p1', 'n1'],
      focused: 'n1',
    },
    {
      case: 'default layout, then activity in the transcript, rebuilt',
      shown: defaultShown,
      act: ({ list, put, entries, layouts }) => {
        everyKind.forEach(put);
        layouts.set(activityShown());
        list.rebuild(entries());
      },
      slots: [
        'chat-entry-slot',
        'chat-entry-slot chat-activity-slot',
        'chat-entry-slot chat-step-slot hidden',
        'chat-entry-slot chat-step-slot hidden',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot',
        'chat-entry-slot is-cursor',
      ],
      kinds: [
        'chat-user',
        'chat-activity',
        'chat-tool',
        'chat-thinking',
        'chat-assistant',
        'chat-permission',
        'chat-result',
        'chat-compaction',
        'chat-notice',
      ],
      stops: ['u1', 'activity:t1', 'a1', 'p1', 'n1'],
      focused: 'n1',
    },
    {
      case: 'default layout, a tool put then given its result',
      shown: defaultShown,
      act: ({ put }) => {
        put(tool('t1'));
        put({ ...tool('t1'), result: { text: 'ok', isError: false } });
      },
      slots: [],
      kinds: [],
      stops: [],
      focused: null,
    },
  ])('hidden_ActivityNotInTranscript ($case)', (row) => {
    const setUp = setUpList(row.shown());
    const { list } = setUp;

    row.act(setUp);
    const focused = list.focused();

    expect(focused === null ? null : stopId(focused)).toBe(row.focused);
    expect(slotClasses(list.element)).toEqual(row.slots);
    expect(
      drawnSlots(list.element).map((slot) =>
        slot.children[0].className
          .split(' ')
          .find((name) => name !== 'chat-entry'),
      ),
    ).toEqual(row.kinds);
    list.first();
    const stops: string[] = [];
    for (let stop = list.focused(); stop !== null; stop = list.move(1)) {
      stops.push(stopId(stop));
      if (list.isAtLastStop()) {
        break;
      }
    }
    expect(stops).toEqual(row.stops);
  });
});

// Each ResizeObserver the code builds: its callback and the elements it
// observes now.
interface StubObserver {
  callback: () => void;
  observed: Set<unknown>;
}

describe('slots and focus', () => {
  let observers: StubObserver[];
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
    observers = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private record: StubObserver;
        constructor(callback: () => void) {
          this.record = { callback, observed: new Set() };
          observers.push(this.record);
        }
        observe(target: unknown) {
          this.record.observed.add(target);
        }
        unobserve(target: unknown) {
          this.record.observed.delete(target);
        }
        disconnect() {
          this.record.observed.clear();
        }
      },
    );
    vi.stubGlobal('getComputedStyle', () => ({
      lineHeight: '20px',
      fontSize: '14px',
      getPropertyValue: () => '',
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { name: 'following', scrolledBy: 'nothing', scrollTop: 500 },
    { name: 'scrolled up by keys', scrolledBy: 'keys', scrollTop: 280 },
    { name: 'scrolled up by the wheel', scrolledBy: 'wheel', scrollTop: 250 },
    {
      name: 'wheeled back to the bottom',
      scrolledBy: 'wheel back',
      scrollTop: 500,
    },
  ] as const)(
    'followsGrowth_SlotResizes_ScrollsOnlyWhileFollowing $name',
    ({ scrolledBy, scrollTop }) => {
      const { list, put } = setUpList(defaultShown());
      const scroller = asFake(list.element) as FakeElement & {
        scrollHeight: number;
        clientHeight: number;
      };
      scroller.scrollHeight = 400;
      scroller.clientHeight = 100;
      put(assistant('a visual'));
      // A browser clamps the bottom scroll to the height less the box's.
      scroller.scrollTop = 300;
      if (scrolledBy === 'keys') {
        list.scrollBy('line', -1);
      }
      if (scrolledBy === 'wheel' || scrolledBy === 'wheel back') {
        scroller.scrollTop = 250;
        scroller.fire('scroll');
      }
      if (scrolledBy === 'wheel back') {
        scroller.scrollTop = 300;
        scroller.fire('scroll');
      }
      const slot = asFake(list.element).children[0];

      scroller.scrollHeight = 500;
      for (const observer of observers) {
        if (observer.observed.has(slot)) {
          observer.callback();
        }
      }

      expect(scroller.scrollTop).toBe(scrollTop);
    },
  );

  // Each move that redraws only the marks, the scroll left as it is.
  it.each<{
    name: string;
    isRangeOpen?: boolean;
    move: (list: EntryList, scroller: FakeElement) => void;
  }>([
    { name: 'a click on a stop', move: (list) => list.moveFocusTo('n1') },
    { name: 'opening a range', move: (list) => list.toggleRange() },
    {
      name: 'cancelling a range',
      isRangeOpen: true,
      move: (list) => list.cancelRange(),
    },
    {
      name: 'a wheel scroll up',
      move: (_list, scroller) => {
        scroller.scrollTop = 250;
        scroller.fire('scroll');
      },
    },
  ])(
    'placeChanged_MarksOnlyMove_TellsTheOwner ($name)',
    ({ isRangeOpen = false, move }) => {
      const { list, put, placeChanges } = setUpList(defaultShown());
      const scroller = asFake(list.element) as FakeElement & {
        scrollHeight: number;
        clientHeight: number;
      };
      scroller.scrollHeight = 400;
      scroller.clientHeight = 100;
      [notice('n1'), notice('n2'), notice('n3')].forEach(put);
      if (isRangeOpen) {
        list.toggleRange();
      }
      placeChanges.count = 0;

      move(list, scroller);

      expect(placeChanges.count).toBeGreaterThan(0);
    },
  );

  // As a streamed entry's redraw does: the cursor, runs and expanders stay.
  it('placeChanged_PutLeavingThePlace_TellsNothingAndBuildsNoPlace', () => {
    const { list, put, placeChanges } = setUpList(defaultShown());
    [notice('n1'), notice('n2'), notice('n3')].forEach(put);
    const place = list.place();
    placeChanges.count = 0;

    put({
      kind: 'notice',
      id: 'n2',
      at: 1000,
      text: 'streamed on',
      tone: 'info',
      raw: [],
    });

    expect(placeChanges.count).toBe(0);
    expect(list.place()).toBe(place);
  });

  // The list holds the user entry, a run of two tools (each drawing one
  // expander) and the answer, unless `isHeldLater`: then `change` brings them.
  // `before` runs before the read that `change` follows.
  it.each<{
    name: string;
    isHeldLater?: boolean;
    before?: (list: EntryList) => void;
    change: (list: EntryList, held: ChatEntry[]) => void;
    place: EntryListPlace;
  }>([
    {
      name: 'a move',
      change: (list) => list.move(-1),
      place: {
        focus: { stopId: 'activity:t1', following: false, anchorId: null },
        openRuns: [],
        openExpanders: {},
      },
    },
    {
      name: 'a run opened',
      change: (list) => list.toggleRun('activity:t1'),
      place: {
        focus: { stopId: 'a1', following: true, anchorId: null },
        openRuns: ['activity:t1'],
        openExpanders: {},
      },
    },
    {
      name: 'a run closed',
      before: (list) => list.toggleRun('activity:t1'),
      change: (list) => list.toggleRun('activity:t1'),
      place: {
        focus: { stopId: 'a1', following: true, anchorId: null },
        openRuns: [],
        openExpanders: {},
      },
    },
    {
      name: 'an expander toggled',
      change: (list) => list.toggleExpander('t2', 0),
      place: {
        focus: { stopId: 'a1', following: true, anchorId: null },
        openRuns: [],
        openExpanders: { t2: [true] },
      },
    },
    {
      name: 'the focused entry toggled',
      before: (list) => {
        list.toggleRun('activity:t1');
        list.moveFocusTo('t1');
      },
      change: (list) => list.toggleFocused(),
      place: {
        focus: { stopId: 't1', following: false, anchorId: null },
        openRuns: ['activity:t1'],
        openExpanders: { t1: [true] },
      },
    },
    {
      name: 'a rebuild restoring the saved expanders',
      isHeldLater: true,
      before: (list) =>
        list.restorePlace({
          focus: { stopId: 't2', following: false, anchorId: null },
          openRuns: ['activity:t1'],
          openExpanders: { t2: [true] },
        }),
      change: (list, held) => list.rebuild(held),
      place: {
        focus: { stopId: 't2', following: false, anchorId: null },
        openRuns: ['activity:t1'],
        openExpanders: { t2: [true] },
      },
    },
  ])(
    'place_AfterChange_ReflectsIt ($name)',
    ({ isHeldLater = false, before, change, place }) => {
      const { list } = setUpList(activityShown());
      const held = [user('u1'), tool('t1'), tool('t2'), assistant('done')];
      if (!isHeldLater) {
        list.rebuild(held);
      }
      before?.(list);
      const read = list.place();

      change(list, held);

      expect(list.place()).not.toBe(read);
      expect(list.place()).toEqual(place);
    },
  );

  it.each<{
    case: string;
    deliveries: (UserDelivery | null)[];
    inputs: [UserDelivery | null, boolean][];
    labels: (string | null)[];
  }>([
    {
      case: 'an earlier received loses its label, sent keeps its own',
      deliveries: ['received', 'sent', 'received'],
      inputs: [
        ['received', false],
        ['sent', false],
        ['received', true],
      ],
      labels: [null, 'Sent', 'Received'],
    },
    {
      case: 'a later entry with no delivery leaves received the latest',
      deliveries: ['received', null],
      inputs: [
        ['received', true],
        [null, false],
      ],
      labels: ['Received', null],
    },
    {
      case: 'not received stays on an earlier entry',
      deliveries: ['notReceived', 'received'],
      inputs: [
        ['notReceived', false],
        ['received', true],
      ],
      labels: ['Not received', 'Received'],
    },
  ])('delivery_ListDraws_DefaultLabelsReceivedOnLatestOnly ($case)', (row) => {
    const { draws, shown } = recordingDelivery();
    const { list: recorded } = setUpList(shown);
    const { list: drawn, put } = setUpList(defaultShown());
    const held = row.deliveries.map((delivery, at) =>
      delivered(`u${at}`, delivery),
    );

    recorded.rebuild(held);
    held.forEach(put);

    expect([...draws.values()]).toEqual(row.inputs);
    expect(
      drawnSlots(drawn.element).map(
        (slot) =>
          slot.querySelector('.chat-user-delivery')?.textContent ?? null,
      ),
    ).toEqual(row.labels);
  });

  it.each([
    {
      case: 'a framed entry',
      entry: userText('u1', frameAgentMessage('Planner', 'go')),
      from: 'Planner',
      text: 'go',
    },
    {
      case: 'a plain entry',
      entry: userText('u1', 'go'),
      from: null,
      text: 'go',
    },
    {
      case: 'a framed queued message',
      queued: { ...queued('q1'), text: frameAgentMessage('Planner', 'go') },
      from: 'Planner',
      text: 'go',
    },
    {
      case: 'a plain queued message',
      queued: { ...queued('q1'), text: 'go' },
      from: null,
      text: 'go',
    },
  ])(
    "a framed message's input carries the sender and the body ($case)",
    (row) => {
      const seen: [string | null, string][] = [];
      const shown = withUser<ChatLayout>(
        defaultLayout,
        {
          entries: {
            user(parent, input, kit) {
              seen.push([input.from, input.text]);
              return { element: kit.el(parent, 'div', 'recorded') };
            },
          },
          queuedMessage(parent, input, kit) {
            seen.push([input.from, input.text]);
            return { element: kit.el(parent, 'div', 'recorded') };
          },
        },
        'recording',
      );
      const { list, put } = setUpList(shown);

      if (row.entry !== undefined) {
        put(row.entry);
      } else {
        list.setQueued([row.queued]);
      }

      expect(seen).toEqual([[row.from, row.text]]);
    },
  );

  it.each([
    { case: 'following', scrollsUp: false, scrollTop: 500 },
    { case: 'scrolled up', scrollsUp: true, scrollTop: 250 },
  ])(
    'delivery_SameIdArrivesReceived_RedrawsItsSlotAndKeepsTheScrollRule ($case)',
    ({ scrollsUp, scrollTop }) => {
      const { updates, shown } = recordingDelivery();
      const { list, put } = setUpList(shown);
      const scroller = asFake(list.element) as FakeElement & {
        scrollHeight: number;
        clientHeight: number;
      };
      scroller.scrollHeight = 400;
      scroller.clientHeight = 100;
      put(delivered('u1', 'sent'));
      scroller.scrollTop = 300;
      if (scrollsUp) {
        scroller.scrollTop = 250;
        scroller.fire('scroll');
      }

      scroller.scrollHeight = 500;
      put(delivered('u1', 'received'));

      expect(updates).toEqual([['u1', 'received', true]]);
      expect(scroller.scrollTop).toBe(scrollTop);
    },
  );

  it('followsGrowth_ContentGrowsBeforeTheFollowsScrollEvent_KeepsFollowing', () => {
    const { list, put } = setUpList(blocksShown());
    const scroller = asFake(list.element) as FocusFakeElement & {
      scrollHeight: number;
      clientHeight: number;
    };
    scroller.rectHeight = 100;
    scroller.clientHeight = 100;
    scroller.scrollHeight = 400;
    put(assistantText('a', 'one\n\ntwo'));
    expect(scroller.scrollTop).toBe(400);

    // A visual's frame takes its height after the scroll, before its event.
    scroller.scrollHeight = 900;
    scroller.fire('scroll');

    expect(scroller.scrollTop).toBe(900);
    scroller.fire('scroll');
    put(notice('n'));
    expect(cursorLabel(list)).toBe('n');
  });

  it.each([
    {
      kind: 'a message entry',
      shown: () => blocksShown(),
      arrange(list: EntryList, put: (entry: ChatEntry) => void) {
        [userText('u1', 'one\n\ntwo'), notice('n1')].forEach(put);
        list.moveFocusTo('u1#1');
      },
      slotClass: 'chat-entry-slot',
      id: 'u1',
    },
    {
      kind: 'an activity slot',
      shown: () => activityShown(),
      arrange(list: EntryList, put: (entry: ChatEntry) => void) {
        [user('u1'), tool('t1'), tool('t2')].forEach(put);
        list.moveFocusTo('activity:t1');
      },
      slotClass: 'chat-activity-slot',
      id: 'activity:t1',
    },
    {
      kind: 'a queued slot',
      shown: () => defaultShown(),
      arrange(list: EntryList, put: (entry: ChatEntry) => void) {
        put(user('u1'));
        list.setQueued([queued('q1')]);
        list.moveFocusTo('queued:q1');
      },
      slotClass: 'chat-queued-slot',
      id: 'queued:q1',
    },
  ])(
    'slot_EachKind_CarriesDataChatEntry $kind',
    ({ shown, arrange, slotClass, id }) => {
      const { list, put } = setUpList(shown());
      arrange(list, put);

      const slot = slotOf(list.element, slotClass);

      expect(slot.dataset.chatEntry).toBe(id);
      expect(entryIdOfStop(list.focusedStopId()!)).toBe(id);
    },
  );
});

// Draws one marked `div` per paragraph of the entry's text, with the paragraph's
// source lines, as `kit.markdown` marks a block.
const marksParagraphs: AnyBuilder = (parent, input, kit) => {
  const root = kit.el(parent, 'div', 'marked');
  const draw = (next: EntryInput<EntryKind>) => {
    root.replaceChildren();
    const lines = (next as { text: string }).text.split('\n');
    let start = -1;
    lines.forEach((line, index) => {
      if (line !== '' && start < 0) {
        start = index;
      }
      const nextIsBlank =
        lines[index + 1] === undefined || lines[index + 1] === '';
      if (line !== '' && nextIsBlank) {
        kit.el(root, 'div').dataset.mdLines = `${start},${index + 1}`;
        start = -1;
      }
    });
  };
  draw(input);
  return { element: root, update: draw };
};

// Draws one `div` marked with each of `marks`, whatever the entry holds.
const marksLines =
  (...marks: string[]): AnyBuilder =>
  (parent, _input, kit) => {
    const root = kit.el(parent, 'div', 'marked');
    for (const mark of marks) {
      kit.el(root, 'div').dataset.mdLines = mark;
    }
    return { element: root };
  };

function blocksShown(
  overrides: Partial<Record<EntryKind, AnyBuilder>> = {},
): ShownLayouts<ChatLayout> {
  return withUser<ChatLayout>(
    defaultLayout,
    {
      entries: {
        user: marksParagraphs,
        assistant: marksParagraphs,
        ...overrides,
      },
    },
    'marked',
  );
}

const userText = (id: string, text: string): ChatEntry => ({
  kind: 'user',
  id,
  at: 1000,
  text,
  images: [],
  delivery: null,
  raw: [],
});
const assistantText = (
  id: string,
  text: string,
  agentId = MAIN_AGENT_ID,
): ChatEntry => ({
  ...assistant(text, agentId),
  id,
});

// The slot holding the cursor, found as a reader of `chat.focus` finds it: the
// list's child whose `data-chat-entry` is the cursor's entry; null with no
// cursor.
function cursorSlot(list: EntryList): FakeElement | null {
  const stopId = list.focusedStopId();
  if (stopId === null) {
    return null;
  }
  const entryId = entryIdOfStop(stopId);
  return (
    asFake(list.element).children.find(
      (slot) => slot.dataset.chatEntry === entryId,
    ) ?? null
  );
}

// The cursor's block: the cursor slot's `[data-md-lines]` element at the stop's
// block index; null on a stop with no block.
function cursorBlock(list: EntryList): FakeElement | null {
  const stopId = list.focusedStopId();
  const index = stopId === null ? null : blockIndexOfStop(stopId);
  return index === null
    ? null
    : (cursorSlot(list)?.querySelectorAll('[data-md-lines]')[index] ?? null);
}

// The cursor's stop as `<id>#<block>`, `<id>` on a stop with no blocks.
function cursorLabel(list: EntryList): string | null {
  const stop = list.focused();
  if (stop === null) {
    return null;
  }
  const id =
    stop.kind === 'entry'
      ? stop.entry.id
      : stop.kind === 'activity'
        ? stop.runId
        : stop.message.id;
  const block = cursorBlock(list);
  if (block === null) {
    return id;
  }
  return `${id}#${block.parentNode!.children.indexOf(block)}`;
}

function stopLabels(list: EntryList): string[] {
  const labels: string[] = [];
  list.first();
  while (list.focused() !== null) {
    labels.push(cursorLabel(list)!);
    if (list.isAtLastStop()) {
      break;
    }
    list.move(1);
  }
  return labels;
}

// The `index`th marked block of the list's slot at `slotIndex`.
function blockAt(list: EntryList, slotIndex: number, index: number) {
  return asFake(list.element).children[slotIndex].querySelectorAll(
    '[data-md-lines]',
  )[index] as FocusFakeElement;
}

function marksOf(list: EntryList, mark: string, slotIndex = 0): number[] {
  return asFake(list.element)
    .children[slotIndex].querySelectorAll('[data-md-lines]')
    .flatMap((block, index) => (block.classList.contains(mark) ? [index] : []));
}

describe('block stops', () => {
  const fourBlocks = 'zero\n\none\n\ntwo\n\nthree';

  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
    vi.stubGlobal('getComputedStyle', () => ({
      scrollPaddingBottom: '20px',
      lineHeight: '20px',
      fontSize: '14px',
      getPropertyValue: () => '',
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('delivery_LaterEntriesChangeTheLatest_RedrawsUserEntriesWhoseInputChangedAndKeepsTheCursor', () => {
    const { updates, shown } = recordingDelivery();
    const { list, put } = setUpList(shown);
    put(delivered('u1', 'received'));
    put(assistantText('a', 'reply'));
    list.first();

    put(delivered('u2', 'sent'));
    const focusedAfterRedraw = cursorBlock(list)!;
    const isFocusedConnected = focusedAfterRedraw.parentNode !== null;
    const isFocusedMarked = focusedAfterRedraw.classList.contains('is-cursor');
    put(delivered('u3', 'sent'));
    put(delivered('u2', null));
    put(delivered('u3', null));

    expect(isFocusedConnected).toBe(true);
    expect(isFocusedMarked).toBe(true);
    expect(updates).toEqual([
      ['u1', 'received', false],
      ['u2', 'sent', false],
      ['u2', null, false],
      ['u3', null, false],
      ['u1', 'received', true],
    ]);
  });

  it.each<{
    case: string;
    overrides?: Partial<Record<EntryKind, AnyBuilder>>;
    puts: ChatEntry[];
    focused: string;
    stops: string[];
  }>([
    {
      case: 'messages split, a result has no stop, a notice has one',
      puts: [
        userText('u', 'ask'),
        assistantText('a', 'one\n\ntwo\n\nthree'),
        result('r'),
        notice('n'),
      ],
      focused: 'n',
      stops: ['u#0', 'a#0', 'a#1', 'a#2', 'n'],
    },
    {
      case: 'a divider after the last block leaves the following focus on it',
      puts: [assistantText('a', 'one\n\ntwo'), result('r')],
      focused: 'a#1',
      stops: ['a#0', 'a#1'],
    },
    {
      case: 'a message with no marked block has one stop',
      puts: [userText('u', 'ask'), assistantText('a', '')],
      focused: 'a',
      stops: ['u#0', 'a'],
    },
    {
      case: 'a permission card with marks keeps one stop',
      overrides: { permission: marksLines('0,1', '1,2') },
      puts: [permission('p'), userText('u', 'ask')],
      focused: 'u#0',
      stops: ['p', 'u#0'],
    },
  ])('stops_ListBuilds ($case)', ({ overrides, puts, focused, stops }) => {
    const { list, put, entries } = setUpList(blocksShown(overrides));
    puts.forEach(put);

    expect(cursorLabel(list)).toBe(focused);
    expect(stopLabels(list)).toEqual(stops);
    list.rebuild(entries());
    expect(stopLabels(list)).toEqual(stops);
  });

  it.each<{
    case: string;
    before?: string;
    act: (list: EntryList) => void;
    redraw: string;
    focused: string;
    following: boolean;
  }>([
    {
      case: 'a following focus takes the new last block',
      act: () => undefined,
      redraw: 'one\n\ntwo\n\nthree',
      focused: 'a#2',
      following: true,
    },
    {
      case: 'a focus off the end stays on its block',
      act: (list) => list.move(-1),
      redraw: 'one\n\ntwo\n\nthree',
      focused: 'a#0',
      following: false,
    },
    {
      case: 'a following focus takes the last block left',
      act: () => undefined,
      redraw: 'one',
      focused: 'a#0',
      following: true,
    },
    {
      case: 'a focus on a block that went moves to the last left',
      before: 'one\n\ntwo\n\nthree',
      act: (list) => list.move(-1),
      redraw: 'one',
      focused: 'a#0',
      following: false,
    },
  ])('stops_RedrawChangesBlocks ($case)', (row) => {
    const { list, put } = setUpList(blocksShown());
    put(assistantText('a', row.before ?? 'one\n\ntwo'));
    row.act(list);

    put(assistantText('a', row.redraw));

    expect(cursorLabel(list)).toBe(row.focused);
    const scroller = asFake(list.element);
    scroller.scrollTop = 7;
    (scroller as unknown as { scrollHeight: number }).scrollHeight = 900;
    list.followBottom();
    expect(scroller.scrollTop === 900).toBe(row.following);
  });

  it.each<{
    case: string;
    start: (list: EntryList) => void;
    step: 1 | -1;
    focused: string;
  }>([
    {
      case: 'next skips the rest of the message and the notice',
      start: (list) => list.first(),
      step: 1,
      focused: 'b#0',
    },
    {
      case: 'previous lands on the first block of the earlier message',
      start: () => undefined,
      step: -1,
      focused: 'a#0',
    },
    {
      case: 'from a notice, next is the following message',
      start: (list) => {
        list.first();
        list.move(1);
        list.move(1);
      },
      step: 1,
      focused: 'b#0',
    },
    {
      case: 'at the first message, previous stays on the stop',
      start: (list) => {
        list.first();
        list.move(1);
      },
      step: -1,
      focused: 'a#1',
    },
    {
      case: 'at the last message, next stays on the stop',
      start: () => undefined,
      step: 1,
      focused: 'b#1',
    },
  ])('moveToMessage ($case)', ({ start, step, focused }) => {
    const { list, put } = setUpList(blocksShown());
    [
      assistantText('a', 'one\n\ntwo'),
      notice('n'),
      userText('b', 'three\n\nfour'),
    ].forEach(put);
    start(list);

    const stop = list.moveToMessage(step);

    expect(cursorLabel(list)).toBe(focused);
    expect(stop).toEqual(list.focused());
  });

  it('moveToMessage_NoStops_Null', () => {
    expect(setUpList(blocksShown()).list.moveToMessage(1)).toBeNull();
  });

  it('focusedStop_OnABlock_NamesTheEntryAndItsSlotAndBlock', () => {
    const { list, put } = setUpList(blocksShown());
    const entry = assistantText('a', 'one\n\ntwo');
    put(entry);
    const scrolled = vi.spyOn(FakeElement.prototype, 'scrollIntoView');
    put(notice('n'));

    const stop = list.move(-1);

    expect(stop).toEqual({ kind: 'entry', entry });
    expect(cursorSlot(list)).toBe(asFake(list.element).children[0]);
    expect(cursorBlock(list)).toBe(blockAt(list, 0, 1));
    expect(scrolled.mock.contexts).toEqual([blockAt(list, 0, 1)]);
    list.move(1);
    expect(cursorBlock(list)).toBeNull();
    expect(cursorSlot(list)).toBe(asFake(list.element).children[1]);
  });

  // A 900px list over a 100px box holding one assistant entry of two blocks,
  // the first in the band and the last at `lastStop`, scrolled to `from` with
  // the cursor on the first block unless `startsOnLastStop`.
  const setUpOnTheLastStop = (row: {
    startsOnLastStop: boolean;
    from: number;
    lastStop: { top: number; height: number };
  }) => {
    const { list, put } = setUpList(blocksShown());
    const scroller = asFake(list.element) as FocusFakeElement & {
      scrollHeight: number;
      clientHeight: number;
    };
    scroller.rectHeight = 100;
    scroller.clientHeight = 100;
    scroller.scrollHeight = 900;
    put(assistantText('a', 'one\n\ntwo'));
    const first = blockAt(list, 0, 0);
    const last = blockAt(list, 0, 1);
    first.rectTop = 30;
    first.rectHeight = 10;
    last.rectTop = row.lastStop.top;
    last.rectHeight = row.lastStop.height;
    if (!row.startsOnLastStop) {
      list.move(-1);
    }
    scroller.scrollTop = row.from;
    scroller.fire('scroll');
    return { list, put, scroller, last };
  };

  it.each([
    {
      case: 'a stop that fits scrolls to the bottom and follows',
      startsOnLastStop: false,
      from: 100,
      lastStop: { top: 30, height: 10 },
      scrollsToStop: false,
      scrollTop: 900,
      afterPut: 'n',
    },
    {
      case: 'a stop too tall shows itself and does not follow',
      startsOnLastStop: false,
      from: 100,
      lastStop: { top: 30, height: 150 },
      scrollsToStop: true,
      scrollTop: 100,
      afterPut: 'a#1',
    },
    {
      case: 'a clamped move while reading a stop too tall stays put',
      startsOnLastStop: true,
      from: 100,
      lastStop: { top: -20, height: 150 },
      scrollsToStop: true,
      scrollTop: 100,
      afterPut: 'a#1',
    },
    {
      case: 'a clamped move on a stop too tall while following at the bottom keeps following',
      startsOnLastStop: true,
      from: 800,
      lastStop: { top: -20, height: 150 },
      scrollsToStop: false,
      scrollTop: 900,
      afterPut: 'n',
    },
  ])('move_OntoTheLastStop ($case)', (row) => {
    const { list, put, scroller, last } = setUpOnTheLastStop(row);
    const scrolled = vi.spyOn(FakeElement.prototype, 'scrollIntoView');

    list.move(1);

    expect(scrolled.mock.contexts).toEqual(row.scrollsToStop ? [last] : []);
    expect(scroller.scrollTop).toBe(row.scrollTop);
    expect(cursorLabel(list)).toBe('a#1');
    scroller.fire('scroll');
    put(notice('n'));
    expect(cursorLabel(list)).toBe(row.afterPut);
  });

  it('a moveToMessage clamped on a stop too tall while following at the bottom keeps following', () => {
    const { list, put, scroller } = setUpOnTheLastStop({
      startsOnLastStop: true,
      from: 800,
      lastStop: { top: -20, height: 150 },
    });
    const scrolled = vi.spyOn(FakeElement.prototype, 'scrollIntoView');

    list.moveToMessage(1);

    expect(scrolled).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(900);
    expect(cursorLabel(list)).toBe('a#1');
    put(notice('n'));
    expect(cursorLabel(list)).toBe('n');
  });

  it('scrollToFocus_FollowingOnAStopTooTall_ScrollsToTheBottom', () => {
    const { list, put } = setUpList(blocksShown());
    const scroller = asFake(list.element) as FocusFakeElement & {
      scrollHeight: number;
    };
    scroller.rectHeight = 100;
    scroller.scrollHeight = 900;
    put(assistantText('a', 'one\n\ntwo'));
    blockAt(list, 0, 1).rectHeight = 150;
    const scrolled = vi.spyOn(FakeElement.prototype, 'scrollIntoView');
    scroller.scrollTop = 0;

    list.scrollToFocus();

    expect(scrolled).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(900);
  });

  it('marks_CursorAndRange_DrawnOnTheStopsAndClearedAfter', () => {
    const { list, put } = setUpList(blocksShown());
    put(assistantText('a', fourBlocks));
    put(notice('n'));
    const noticeSlot = asFake(list.element).children[1];
    expect(noticeSlot.classList.contains('is-cursor')).toBe(true);
    expect(marksOf(list, 'is-cursor')).toEqual([]);

    list.move(-1);
    expect(noticeSlot.classList.contains('is-cursor')).toBe(false);
    expect(marksOf(list, 'is-cursor')).toEqual([3]);
    expect(marksOf(list, 'is-range')).toEqual([]);

    list.toggleRange();
    list.move(-1);
    expect(marksOf(list, 'is-range')).toEqual([2, 3]);
    expect(marksOf(list, 'is-cursor')).toEqual([2]);

    list.first();
    expect(marksOf(list, 'is-range')).toEqual([0, 1, 2, 3]);
    expect(list.selectedSource()?.blockCount).toBe(4);

    list.latest();
    expect(marksOf(list, 'is-range')).toEqual([3]);
    expect(noticeSlot.classList.contains('is-range')).toBe(true);

    expect(list.cancelRange()).toBe(true);
    expect(list.cancelRange()).toBe(false);
    expect(marksOf(list, 'is-range')).toEqual([]);
    expect(noticeSlot.classList.contains('is-range')).toBe(false);
  });

  it('toggleRange_Twice_ClosesTheRange', () => {
    const { list, put } = setUpList(blocksShown());
    put(assistantText('a', fourBlocks));

    expect(list.toggleRange()).toBe(true);
    expect(list.isRangeOpen()).toBe(true);
    list.toggleRange();
    list.move(-1);

    expect(list.isRangeOpen()).toBe(false);
    expect(marksOf(list, 'is-range')).toEqual([]);
    expect(list.cancelRange()).toBe(false);
  });

  it('toggleRange_NoStops_FalseAndNoRange', () => {
    const { list } = setUpList(blocksShown());

    expect(list.toggleRange()).toBe(false);
    expect(list.isRangeOpen()).toBe(false);
  });

  it.each<{
    case: string;
    overrides?: Partial<Record<EntryKind, AnyBuilder>>;
    shown?: () => ShownLayouts<ChatLayout>;
    puts: ChatEntry[];
    queued?: QueuedMessage[];
    act: (list: EntryList) => void;
    source: { text: string; blockCount: number } | null;
  }>([
    {
      case: 'a range of three blocks',
      puts: [assistantText('a', 'one\ntail\n\ntwo\n\nthree')],
      act: (list) => {
        list.first();
        list.toggleRange();
        list.move(1);
        list.move(1);
      },
      source: { text: 'one\ntail\n\ntwo\n\nthree', blockCount: 3 },
    },
    {
      case: 'the cursor alone with no range',
      puts: [assistantText('a', 'one\n\ntwo')],
      act: (list) => list.first(),
      source: { text: 'one', blockCount: 1 },
    },
    {
      case: 'a fence block',
      puts: [assistantText('a', 'intro\n\n```ts\nconst a = 1;\n```')],
      act: () => undefined,
      source: { text: '```ts\nconst a = 1;\n```', blockCount: 1 },
    },
    {
      case: 'a range across messages, a notice and a divider',
      puts: [
        userText('u', 'ask'),
        result('r'),
        notice('n'),
        assistantText('a', 'one\n\ntwo'),
      ],
      act: (list) => {
        list.first();
        list.toggleRange();
        list.latest();
      },
      source: { text: 'ask\n\nhi\n\none\n\ntwo', blockCount: 4 },
    },
    {
      case: 'a message with no blocks gives nothing when empty',
      puts: [assistantText('a', '')],
      act: () => undefined,
      source: null,
    },
    {
      case: 'a framed message gives the second block without its frame line',
      puts: [userText('u', frameAgentMessage('Planner', 'one\n\ntwo'))],
      act: (list) => {
        list.first();
        list.move(1);
      },
      source: { text: 'two', blockCount: 1 },
    },
    {
      case: 'a pending row gives its message',
      puts: [userText('u', 'ask')],
      queued: [queued('q1')],
      act: () => undefined,
      source: { text: 'text of q1', blockCount: 1 },
    },
    {
      case: 'a pending framed row gives its message without its frame line',
      puts: [userText('u', 'ask')],
      queued: [{ ...queued('q1'), text: frameAgentMessage('Planner', 'ask') }],
      act: () => undefined,
      source: { text: 'ask', blockCount: 1 },
    },
    {
      case: 'a permission card gives nothing, and leaves a range its parts',
      puts: [userText('u', 'ask'), permission('p')],
      act: (list) => {
        list.toggleRange();
        list.first();
      },
      source: { text: 'ask', blockCount: 1 },
    },
    {
      case: 'a permission card alone gives nothing',
      puts: [permission('p')],
      act: () => undefined,
      source: null,
    },
    {
      case: 'an activity line gives nothing',
      shown: () =>
        activityShown({
          entries: { assistant: marksParagraphs, user: marksParagraphs },
        }),
      puts: [tool('t1')],
      act: () => undefined,
      source: null,
    },
    {
      case: 'a layout drawing other text gives the whole text once',
      overrides: { assistant: marksLines('0,1', '1,2', '2,9') },
      puts: [assistantText('a', 'only\nlines')],
      act: (list) => {
        list.first();
        list.toggleRange();
        list.latest();
      },
      source: { text: 'only\nlines', blockCount: 1 },
    },
  ])('selectedSource ($case)', (row) => {
    const shown =
      row.shown === undefined ? blocksShown(row.overrides) : row.shown();
    const { list, put } = setUpList(shown);
    row.puts.forEach(put);
    list.setQueued(row.queued ?? []);
    row.act(list);

    expect(list.selectedSource()).toEqual(row.source);
  });

  it.each([
    { case: 'a middle slice', start: 1, end: 3, source: 'b\nc' },
    { case: 'trailing blanks removed', start: 0, end: 4, source: 'a\nb\nc' },
    { case: 'only blank lines', start: 3, end: 5, source: '' },
    { case: 'an empty range', start: 2, end: 2, source: '' },
  ])('sourceOfLines ($case)', ({ start, end, source }) => {
    expect(sourceOfLines('a\nb\nc\n\n  \nd', start, end)).toBe(source);
  });

  // Each block's box after the scroll; every box sits in the band before it. The
  // list's box runs 0 to 100, its band 0 to 80 under the 20px scroll padding.
  const above = { top: -50, height: 10 };
  const inBand = { top: 30, height: 10 };
  const below = { top: 200, height: 10 };

  // A shown list whose box runs 0 to 100.
  const setUpScroller = (shown: ShownLayouts<ChatLayout>) => {
    const { list, put } = setUpList(shown);
    const scroller = asFake(list.element) as FocusFakeElement & {
      scrollHeight: number;
      clientHeight: number;
    };
    scroller.rectHeight = 100;
    scroller.clientHeight = 100;
    return { list, put, scroller };
  };

  // A list following at its bottom over the open last run of steps t1 and t2,
  // whose line and first step sit above the band and last step in it.
  const setUpAtTheBottomOverAnOpenRun = () => {
    const { list, put, scroller } = setUpScroller(activityShown());
    [user('u1'), tool('t1'), tool('t2')].forEach(put);
    list.toggleFocused();
    const [line, firstStep, lastStep] = [
      slotOf(list.element, 'chat-activity-slot'),
      slotOf(list.element, 'chat-step-slot'),
      slotOf(list.element, 'chat-step-slot', 1),
    ] as FocusFakeElement[];
    for (const offScreen of [line, firstStep]) {
      offScreen.rectTop = above.top;
      offScreen.rectHeight = above.height;
    }
    lastStep.rectTop = inBand.top;
    lastStep.rectHeight = inBand.height;
    scroller.scrollHeight = 400;
    scroller.scrollTop = 400;
    scroller.fire('scroll');
    return { list, put, scroller };
  };

  it.each<{
    case: string;
    cursor: number;
    from: number;
    to: number;
    clientHeight?: number;
    boxes: { top: number; height: number }[];
    focused: string;
    following: boolean;
  }>([
    {
      case: 'a cursor above the band, scrolling down',
      cursor: 0,
      from: 100,
      to: 300,
      boxes: [above, above, inBand, inBand],
      focused: 'a#2',
      following: false,
    },
    {
      case: 'a cursor below the band, scrolling up',
      cursor: 3,
      from: 300,
      to: 100,
      boxes: [inBand, inBand, below, below],
      focused: 'a#1',
      following: false,
    },
    {
      case: 'a sliver left at the top edge moves down',
      cursor: 1,
      from: 100,
      to: 300,
      boxes: [above, { top: -8, height: 10 }, inBand, inBand],
      focused: 'a#2',
      following: false,
    },
    {
      case: 'a sliver left at the bottom edge moves up',
      cursor: 2,
      from: 300,
      to: 100,
      boxes: [inBand, inBand, { top: 78, height: 10 }, below],
      focused: 'a#1',
      following: false,
    },
    {
      case: 'a stop clipped by under 1px at the top edge stays',
      cursor: 1,
      from: 100,
      to: 300,
      boxes: [above, { top: -0.5, height: 10 }, inBand, inBand],
      focused: 'a#1',
      following: false,
    },
    {
      case: 'a stop clipped by under 1px at the bottom edge stays',
      cursor: 1,
      from: 300,
      to: 100,
      boxes: [inBand, { top: 70.5, height: 10 }, below, below],
      focused: 'a#1',
      following: false,
    },
    {
      case: 'a stop taller than the band stays while it overlaps',
      cursor: 1,
      from: 100,
      to: 300,
      boxes: [above, { top: -200, height: 201 }, inBand, inBand],
      focused: 'a#1',
      following: false,
    },
    {
      case: 'a stop taller than the band covering it stays',
      cursor: 1,
      from: 100,
      to: 300,
      boxes: [above, { top: -200, height: 900 }, below, below],
      focused: 'a#1',
      following: false,
    },
    {
      case: 'a stop taller than the band past its edge moves',
      cursor: 1,
      from: 100,
      to: 300,
      boxes: [above, { top: -200, height: 190 }, inBand, inBand],
      focused: 'a#2',
      following: false,
    },
    {
      case: 'a cursor under the scroll padding moves back up',
      cursor: 3,
      from: 100,
      to: 300,
      boxes: [above, inBand, inBand, { top: 85, height: 10 }],
      focused: 'a#2',
      following: false,
    },
    {
      case: 'every stop straddling an edge takes the nearest that overlaps',
      cursor: 0,
      from: 100,
      to: 300,
      boxes: [above, { top: -30, height: 90 }, { top: 60, height: 90 }, below],
      focused: 'a#1',
      following: false,
    },
    {
      case: 'nothing in the band leaves the cursor',
      cursor: 0,
      from: 100,
      to: 300,
      boxes: [above, above, below, below],
      focused: 'a#0',
      following: false,
    },
    {
      case: 'an unchanged scrollTop leaves the cursor',
      cursor: 0,
      from: 300,
      to: 300,
      boxes: [above, above, inBand, inBand],
      focused: 'a#0',
      following: false,
    },
    {
      case: 'a hidden list leaves the cursor',
      cursor: 0,
      from: 100,
      to: 300,
      clientHeight: 0,
      boxes: [above, above, inBand, inBand],
      focused: 'a#0',
      following: false,
    },
    {
      case: 'a scroll landing on the bottom still follows from an earlier stop',
      cursor: 0,
      from: 100,
      to: 900,
      boxes: [above, inBand, inBand, inBand],
      focused: 'a#1',
      following: true,
    },
  ])('scroll_MovesTheCursorIntoTheBand ($case)', (row) => {
    const { list, put } = setUpList(blocksShown());
    const scroller = asFake(list.element) as FocusFakeElement & {
      scrollHeight: number;
      clientHeight: number;
    };
    scroller.rectHeight = 100;
    scroller.scrollHeight = 1000;
    scroller.clientHeight = 100;
    put(assistantText('a', fourBlocks));
    list.first();
    for (let moved = 0; moved < row.cursor; moved++) {
      list.move(1);
    }
    row.boxes.forEach((_box, index) => {
      blockAt(list, 0, index).rectTop = inBand.top;
      blockAt(list, 0, index).rectHeight = inBand.height;
    });
    scroller.scrollTop = row.from;
    scroller.fire('scroll');

    row.boxes.forEach((box, index) => {
      blockAt(list, 0, index).rectTop = box.top;
      blockAt(list, 0, index).rectHeight = box.height;
    });
    scroller.clientHeight = row.clientHeight ?? 100;
    scroller.scrollTop = row.to;
    scroller.fire('scroll');

    expect(cursorLabel(list)).toBe(row.focused);
    expect(marksOf(list, 'is-cursor')).toEqual([Number(row.focused.at(-1))]);
    expect(scroller.scrollTop).toBe(row.to);
    scroller.scrollHeight = 2000;
    list.followBottom();
    expect(scroller.scrollTop === 2000).toBe(row.following);
  });

  it('scroll_OverflowingOpenLastRun_MovesAFollowingCursorOffItsLineAndFollows', () => {
    const { list, put } = setUpList(activityShown());
    const scroller = asFake(list.element) as FocusFakeElement & {
      scrollHeight: number;
      clientHeight: number;
    };
    scroller.rectHeight = 100;
    scroller.clientHeight = 100;
    [user('u1'), tool('t1'), tool('t2')].forEach(put);
    list.toggleFocused();
    const line = slotOf(list.element, 'chat-activity-slot') as FocusFakeElement;
    const firstStep = slotOf(
      list.element,
      'chat-step-slot',
    ) as FocusFakeElement;
    const lastStep = slotOf(
      list.element,
      'chat-step-slot',
      1,
    ) as FocusFakeElement;
    for (const offScreen of [line, firstStep]) {
      offScreen.rectTop = above.top;
      offScreen.rectHeight = above.height;
    }
    lastStep.rectTop = inBand.top;
    lastStep.rectHeight = inBand.height;
    scroller.scrollHeight = 400;

    scroller.scrollTop = 300;
    scroller.fire('scroll');

    expect(list.focused()).toEqual({ kind: 'entry', entry: tool('t2') });
    put(tool('t3'));
    expect(list.focused()).toEqual({ kind: 'entry', entry: tool('t3') });
  });

  it.each([
    {
      case: 'moves the cursor into the band and follows',
      clientHeight: 100,
      focused: { kind: 'entry', entry: tool('t2') },
      afterPut: { kind: 'entry', entry: tool('t3') },
    },
    {
      case: 'on a hidden list stays on the line',
      clientHeight: 0,
      focused: {
        kind: 'activity',
        runId: 'activity:t1',
        steps: [tool('t1'), tool('t2')],
      },
      afterPut: {
        kind: 'activity',
        runId: 'activity:t1',
        steps: [tool('t1'), tool('t2'), tool('t3')],
      },
    },
  ])(
    'latest_AtTheBottomOverAnOverflowingOpenRun ($case)',
    ({ clientHeight, focused, afterPut }) => {
      const { list, put, scroller } = setUpAtTheBottomOverAnOpenRun();
      scroller.clientHeight = clientHeight;

      list.latest();

      expect(list.focused()).toEqual(focused);
      expect(scroller.scrollTop).toBe(400);
      scroller.scrollTop = 399;
      scroller.fire('scroll');
      expect(list.focused()).toEqual(focused);
      put(tool('t3'));
      expect(list.focused()).toEqual(afterPut);
    },
  );

  it.each([
    {
      case: 'moves the cursor into the band and follows',
      shownHeight: 100,
      focused: { kind: 'entry', entry: tool('t2') },
      afterPut: { kind: 'entry', entry: tool('t3') },
    },
    {
      case: 'on a list still hidden stays on the line',
      shownHeight: 0,
      focused: {
        kind: 'activity',
        runId: 'activity:t1',
        steps: [tool('t1'), tool('t2')],
      },
      afterPut: {
        kind: 'activity',
        runId: 'activity:t1',
        steps: [tool('t1'), tool('t2'), tool('t3')],
      },
    },
  ])(
    'scrollToFocus on a list shown again at its bottom over an overflowing open run ($case)',
    ({ shownHeight, focused, afterPut }) => {
      const { list, put, scroller } = setUpAtTheBottomOverAnOpenRun();
      scroller.clientHeight = 0;
      list.latest();
      scroller.clientHeight = shownHeight;

      list.scrollToFocus();

      expect(list.focused()).toEqual(focused);
      put(tool('t3'));
      expect(list.focused()).toEqual(afterPut);
    },
  );

  it('a restored place whose stop is not drawn yet survives the settle of a following overflowing list', () => {
    const { list, scroller } = setUpScroller(activityShown());
    scroller.scrollHeight = 400;
    scroller.scrollTop = 400;
    const boxOf = FocusFakeElement.prototype.getBoundingClientRect;
    vi.spyOn(
      FocusFakeElement.prototype,
      'getBoundingClientRect',
    ).mockImplementation(function (this: FocusFakeElement) {
      const box = boxOf.call(this);
      return this.classList.contains('chat-activity-slot')
        ? {
            ...box,
            top: above.top,
            bottom: above.top + above.height,
            height: above.height,
          }
        : box;
    });
    const saved = { stopId: 't3', following: false, anchorId: null };
    list.restorePlace({
      focus: saved,
      openRuns: ['activity:t1'],
      openExpanders: {},
    });
    list.rebuild([user('u1'), tool('t1'), tool('t2')]);

    list.rebuild([user('u1'), tool('t1'), tool('t2'), tool('t3')]);

    expect(cursorLabel(list)).toBe('t3');
    expect(list.place().focus).toEqual(saved);
  });

  it.each<{
    case: string;
    target: (list: EntryList) => FakeElement;
    collapsed?: boolean;
    focused: string;
  }>([
    {
      case: 'a block moves the cursor',
      target: (list) => blockAt(list, 0, 0),
      focused: 'a#0',
    },
    {
      case: 'text inside a block moves the cursor',
      target: (list) => {
        const inner = new FocusFakeElement('em');
        blockAt(list, 0, 1).append(inner);
        return inner;
      },
      focused: 'a#1',
    },
    {
      case: 'a slot with no blocks moves the cursor',
      target: (list) => asFake(list.element).children[2],
      focused: 'n',
    },
    {
      case: 'a non-collapsed selection leaves it',
      target: (list) => blockAt(list, 0, 0),
      collapsed: false,
      focused: 'p',
    },
    {
      case: 'a link inside a block leaves it',
      target: (list) => {
        const link = new FocusFakeElement('a');
        blockAt(list, 0, 0).append(link);
        return link;
      },
      focused: 'p',
    },
    {
      case: 'a fence inside a block leaves it',
      target: (list) => {
        const fence = new FocusFakeElement('div');
        fence.className = 'md-fence';
        blockAt(list, 0, 0).append(fence);
        return fence;
      },
      focused: 'p',
    },
    {
      case: 'a divider leaves it',
      target: (list) => asFake(list.element).children[1],
      focused: 'p',
    },
    {
      case: 'the padding of a slot with blocks leaves it',
      target: (list) => asFake(list.element).children[0],
      focused: 'p',
    },
    {
      case: 'the list itself leaves it',
      target: (list) => asFake(list.element),
      focused: 'p',
    },
  ])('click ($case)', ({ target, collapsed, focused }) => {
    const { list, put } = setUpList(blocksShown());
    [
      assistantText('a', 'one\n\ntwo'),
      result('r'),
      notice('n'),
      permission('p'),
    ].forEach(put);
    const scroller = asFake(list.element);
    const clicked = target(list);
    list.latest();
    scroller.scrollTop = 123;
    fakeWindow().isSelectionCollapsed = collapsed ?? true;

    scroller.fire('click', { target: clicked });

    expect(cursorLabel(list)).toBe(focused);
    expect(scroller.scrollTop).toBe(123);
  });

  type ExpanderPart = 'details' | 'collapsible';
  type BlockShape =
    | 'details block'
    | 'details inside'
    | 'collapsible before details'
    | 'neither';

  // Draws one marked block of `shape`, with a kit collapsible outside it, and
  // records each `details` and kit collapsible it drew, in drawing order.
  function expanderBlock(shape: BlockShape) {
    const drawn: { part: ExpanderPart; isOpen: () => boolean }[] = [];
    const details = (parent: HTMLElement, kit: ChatKit) => {
      const made = kit.el(parent, 'details') as HTMLDetailsElement;
      drawn.push({ part: 'details', isOpen: () => made.open === true });
      return made;
    };
    const collapsible = (parent: HTMLElement, kit: ChatKit) => {
      const made = kit.collapsibleCard(parent, {
        summary: 'more',
        body: () => element('div'),
      });
      drawn.push({ part: 'collapsible', isOpen: () => made.isOpen() });
    };
    const builder: AnyBuilder = (parent, _input, kit) => {
      const root = kit.el(parent, 'div', 'marked');
      collapsible(root, kit);
      const block =
        shape === 'details block' ? details(root, kit) : kit.el(root, 'div');
      block.dataset.mdLines = '0,1';
      if (shape === 'collapsible before details') {
        collapsible(block, kit);
      }
      if (
        shape === 'details inside' ||
        shape === 'collapsible before details'
      ) {
        details(block, kit);
      }
      return { element: root };
    };
    return { builder, drawn };
  }

  it.each<{
    given: string;
    shape: BlockShape;
    onActivity?: boolean;
    result: 'expanded' | null;
    open: [ExpanderPart, boolean][];
  }>([
    {
      given: 'the block is a details',
      shape: 'details block',
      result: 'expanded',
      open: [
        ['collapsible', false],
        ['details', true],
      ],
    },
    {
      given: 'a details inside the block',
      shape: 'details inside',
      result: 'expanded',
      open: [
        ['collapsible', false],
        ['details', true],
      ],
    },
    {
      given: 'a kit collapsible before a details',
      shape: 'collapsible before details',
      result: 'expanded',
      open: [
        ['collapsible', false],
        ['collapsible', true],
        ['details', false],
      ],
    },
    {
      given: 'a block with neither',
      shape: 'neither',
      result: null,
      open: [['collapsible', false]],
    },
    {
      given: 'an activity stop',
      shape: 'details block',
      onActivity: true,
      result: null,
      open: [
        ['collapsible', false],
        ['details', false],
      ],
    },
  ])('toggleFocusedBlock_$given', ({ shape, onActivity, result, open }) => {
    vi.stubGlobal('Node', { DOCUMENT_POSITION_PRECEDING: 2 });
    const { builder, drawn } = expanderBlock(shape);
    const { list, put } = setUpList(
      activityShown({ entries: { assistant: builder } }),
    );
    const reply = assistantText('a', 'reply');
    [user('u1'), tool('t1'), reply].forEach(put);
    if (onActivity === true) {
      list.move(-1);
    }

    const toggled = list.toggleFocusedBlock();

    expect(list.focused()?.kind).toBe(
      onActivity === true ? 'activity' : 'entry',
    );
    expect(toggled).toEqual(result === null ? null : { entry: reply, result });
    expect(drawn.map(({ part, isOpen }) => [part, isOpen()])).toEqual(open);
  });

  it('toggleFocusedBlock_Twice_ClosesWhatTheFirstOpened', () => {
    vi.stubGlobal('Node', { DOCUMENT_POSITION_PRECEDING: 2 });
    const { builder, drawn } = expanderBlock('details inside');
    const { list, put } = setUpList(
      activityShown({ entries: { assistant: builder } }),
    );
    put(assistantText('a', 'reply'));

    list.toggleFocusedBlock();
    const second = list.toggleFocusedBlock();

    expect(second?.result).toBe('collapsed');
    expect(drawn.map(({ isOpen }) => isOpen())).toEqual([false, false]);
  });
});
