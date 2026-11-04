import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import { type ChatEntry, MAIN_AGENT_ID } from '../../../contracts/agent';
import type { ShownLayouts } from '../../../contracts/plugin';
import type { CommandId } from '../../../contracts/commands';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { QueuedMessage } from '../contract';
import { chatCommand } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type {
  ActivityInput,
  ChatKit,
  ChatLayout,
  EntryInput,
  EntryKind,
  EntryView,
} from '../layouts/layout';
import { createChatLayouts } from './chat-layouts';
import { createEntryList, type EntryListStop } from './entry-list';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

type AnyBuilder = (
  parent: HTMLElement,
  input: EntryInput<EntryKind>,
  kit: ChatKit,
) => EntryView;

const KINDS: EntryKind[] = [
  'user',
  'assistant',
  'thinking',
  'tool',
  'permission',
  'result',
  'notice',
  'raw',
];

// Draws `div.fancy` for every kind, with the builders in `overrides` in
// place of it; a kind `overrides` sets to undefined is left out.
function fancyLayout(
  overrides: Partial<Record<EntryKind, AnyBuilder | undefined>>,
): ChatLayout {
  const drawsFancy: AnyBuilder = (parent, _input, kit) => ({
    element: kit.el(parent, 'div', 'fancy'),
  });
  const entries = Object.fromEntries(
    KINDS.filter(
      (kind) =>
        !Object.hasOwn(overrides, kind) || overrides[kind] !== undefined,
    ).map((kind) => [kind, overrides[kind] ?? drawsFancy]),
  );
  return { entries };
}

// Names a key hint and draws a card through the kit, then throws.
const anchorsThenThrows: AnyBuilder = (parent, _input, kit) => {
  kit.keyHint(parent, 'allowPermission');
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
const notice = (id: string): ChatEntry => ({
  kind: 'notice',
  id,
  at: 1000,
  text: 'hi',
  tone: 'info',
  raw: [],
});
const assistant = (text: string): ChatEntry => ({
  kind: 'assistant',
  id: 'a1',
  at: 1000,
  text,
  streaming: false,
  raw: [],
});

interface Row {
  name: string;
  // `live default`: the fancy builders over the bundled default, shown as
  // `default`.
  shown: 'fancy' | 'default' | 'live default';
  fancy?: Partial<Record<EntryKind, AnyBuilder | undefined>>;
  // The kind whose default builder throws.
  breakDefault?: EntryKind;
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
    logs: ['[chat] layout fancy tool entry failed: boom'],
    toasts: ['Chat layout fancy: tool entries drawn with default'],
    disposedAnchors: [
      chatCommand('allowPermission'),
      chatCommand('allowPermission'),
    ],
  },
  {
    name: 'default throws while default is shown',
    shown: 'default',
    breakDefault: 'notice',
    puts: [notice('n1'), notice('n2')],
    slots: [['chat-entry chat-raw@'], ['chat-entry chat-raw@']],
    logs: [
      '[chat] default layout notice entry failed: broken default',
      '[chat] default layout notice entry failed: broken default',
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
      '[chat] layout fancy notice entry failed: boom',
      '[chat] default layout notice entry failed: broken default',
    ],
    toasts: ['Chat layout fancy: notice entries drawn as bare lines'],
    disposedAnchors: [chatCommand('allowPermission')],
  },
  {
    name: 'update throws under the shown layout',
    shown: 'fancy',
    fancy: { assistant: updateThrows },
    puts: [assistant('one'), assistant('two'), assistant('three')],
    slots: [['chat-entry chat-assistant@default']],
    logs: ['[chat] layout fancy assistant entry update failed: broken update'],
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
      '[chat] layout fancy assistant entry update failed: broken update',
      '[chat] default layout assistant entry failed: broken default',
      '[chat] default layout assistant entry failed: broken default',
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
    logs: [
      '[chat] layout default assistant entry update failed: broken update',
    ],
    toasts: [],
    disposedAnchors: [],
  },
];

const timed = (entry: ChatEntry, time: number): ChatEntry => ({
  ...entry,
  at: time,
});
const user = (id: string): ChatEntry => ({
  kind: 'user',
  id,
  at: 1000,
  text: 'ask',
  images: [],
  raw: [],
});
const thinking = (id: string): ChatEntry => ({
  kind: 'thinking',
  id,
  at: 1000,
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

// Timers that run only when the test fires them.
function fakeTimers() {
  let nextHandle = 1;
  const armed = new Map<number, () => void>();
  const timers: Timers = {
    set: (run) => {
      armed.set(nextHandle, run);
      return nextHandle++;
    },
    clear: (handle) => {
      armed.delete(handle);
    },
  };
  const fireAll = () => {
    const runs = [...armed.values()];
    armed.clear();
    for (const run of runs) {
      run();
    }
  };
  return { timers, armed, fireAll };
}

// A list over `shown`, its layouts, logs, toasts, disposed anchors, timers, a
// clock whose `time` the test sets, and the ids each pending row click pulled
// back.
// `put` puts an entry into the session's list, replacing the one holding its
// id.
function setUpList(shown: ShownLayouts<ChatLayout>) {
  const logs: string[] = [];
  const pulled: string[] = [];
  const toasts: string[] = [];
  const disposed: CommandId[] = [];
  const log = (source: string, message: string) =>
    logs.push(`[${source}] ${message}`);
  const layouts = createChatLayouts(log);
  layouts.set(shown);
  const { timers, armed, fireAll } = fakeTimers();
  const clock = { time: 1000, now: () => clock.time };
  const list = createEntryList({
    layouts,
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
        keysFor: () => null,
      },
      commands: { exists: () => true, run: () => undefined },
      platform: 'macos',
      allow: () => undefined,
      deny: () => undefined,
      openImages: () => undefined,
    },
    log,
    toast: (text) => toasts.push(text),
    timers,
    clock,
    pullBack: (queuedId) => pulled.push(queuedId),
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
    put,
    entries,
  };
}

// Each of the list's slots as `<classes>`, ` hidden` added while hidden.
function slotClasses(list: HTMLElement): string[] {
  return asFake(list).children.map(
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
    const { list, logs, toasts, disposed, put } = setUpList(shown);

    for (const entry of row.puts) {
      put(entry);
    }

    const slots = asFake(list.element).children.map((slot) =>
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
});

describe('activity lines', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
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
      '[chat] layout fancy activity update failed: broken update',
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
    expect(logs).toEqual([
      '[chat] default layout activity failed: broken default',
    ]);
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
});

describe('pending rows', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

    slotOf(list.element, 'chat-queued-slot', 1).click();

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
});

describe('activity hidden', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
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
    notice('n1'),
  ];
  const putAllThenRebuild = ({ list, put, entries }: ListSetUp) => {
    everyKind.forEach(put);
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
        'chat-entry-slot is-cursor',
      ],
      kinds: ['chat-user', 'chat-assistant', 'chat-permission', 'chat-notice'],
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
        'chat-notice',
      ],
      stops: ['u1', 'activity:t1', 'a1', 'p1', 'r1', 'n1'],
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
        'chat-entry-slot is-cursor',
      ],
      kinds: ['chat-user', 'chat-assistant', 'chat-permission', 'chat-notice'],
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
        'chat-notice',
      ],
      stops: ['u1', 'activity:t1', 'a1', 'p1', 'r1', 'n1'],
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
      asFake(list.element).children.map((slot) =>
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

  it('focusedElement_Stops_ReturnsTheFocusedSlot', () => {
    const empty = setUpList(defaultShown());
    expect(empty.list.focusedElement()).toBeNull();

    const { list, put } = setUpList(defaultShown());
    put(user('u1'));
    put(assistant('hi'));
    const [userSlot, assistantSlot] = asFake(list.element).children;

    expect(list.focusedElement()).toBe(assistantSlot);
    list.move(-1);
    expect(list.focusedElement()).toBe(userSlot);
  });
});
