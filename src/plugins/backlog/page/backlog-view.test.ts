import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import type {
  OuterPanes,
  PaneDirection,
  FocusTarget,
  ResizeTarget,
} from '../../../contracts/panes';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import type { FollowupItem } from '../../../shared/followups/followup-file';
import {
  recordingAnchors,
  USER_LAYOUT,
  withUser as withLayouts,
} from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  type FocusFakeDocument,
  type FocusFakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type { AgentPane, AgentPaneSpec } from '../../scoped-agents/contract';
import type {
  BacklogChannel,
  BacklogChunk,
  BacklogPlace,
  BacklogRead,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { BacklogLayout, CommitsInput } from '../layouts/layout';
import { rowKey } from '../row-key';
import { type BacklogView, createBacklogView } from './backlog-view';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

// Each call the view made on the strip's scroller, and each item it revealed.
const scroller = vi.hoisted(() => ({
  calls: [] as string[],
  revealed: [] as unknown[],
}));
vi.mock('../../../shared/page/ui/h-scroller', () => ({
  createHScroller() {
    const element = document.createElement('div');
    element.classList.add('ui-h-scroller');
    const track = document.createElement('div');
    element.append(track);
    return {
      element,
      track,
      refresh: () => scroller.calls.push('refresh'),
      reveal(item: HTMLElement) {
        scroller.calls.push('reveal');
        scroller.revealed.push(item);
      },
      dispose: () => scroller.calls.push('dispose'),
    };
  },
}));

// Each split's nudges and dispose, as `<stateKey> <call>`.
const splitCalls = vi.hoisted(() => [] as string[]);
vi.mock('../../../shared/page/ui/split', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../shared/page/ui/split')>();
  return {
    ...actual,
    createSplit(...args: Parameters<typeof actual.createSplit>) {
      const [{ stateKey }] = args;
      const split = actual.createSplit(...args);
      return {
        ...split,
        nudge(direction: PaneDirection) {
          splitCalls.push(`${stateKey} nudge`);
          return split.nudge(direction);
        },
        dispose() {
          splitCalls.push(`${stateKey} dispose`);
          split.dispose();
        },
      };
    },
  };
});

const APP_ROOT = '/home/app/docs/features';
const LIB_ROOT = '/home/lib/docs/features';

function item(title: string): FollowupItem {
  return {
    title,
    oneLine: `${title} gist`,
    tags: [],
    body: '',
    line: 3,
    endLine: 3,
    done: false,
  };
}

// Two repos: `app` holds First and Second, `lib` holds Third.
const READ: BacklogRead = {
  homes: [
    {
      repo: 'app',
      root: APP_ROOT,
      isCreateTarget: true,
      gitRoot: null,
      repoFolder: null,
      followupFiles: [
        {
          path: `${APP_ROOT}/followups.md`,
          items: [item('First'), item('Second')],
        },
      ],
    },
    {
      repo: 'lib',
      root: LIB_ROOT,
      isCreateTarget: true,
      gitRoot: null,
      repoFolder: null,
      followupFiles: [
        { path: `${LIB_ROOT}/followups.md`, items: [item('Third')] },
      ],
    },
  ],
  message: null,
};

const FIRST = rowKey('app', 'First');
const SECOND = rowKey('app', 'Second');

function chunk(
  id: string,
  repo: string,
  name: string,
  titles: string[],
  sessionId: string | null = null,
): BacklogChunk {
  return { id, repo, name, titles, headless: false, sessionId };
}

// `Fixes` holds Second; `Lib work` holds Third and started; `Lib docs` holds
// nothing yet.
const CHUNKS: BacklogChunk[] = [
  chunk('c1', 'app', 'Fixes', ['Second']),
  chunk('c2', 'lib', 'Lib work', ['Third'], 's2'),
  chunk('c3', 'lib', 'Lib docs', []),
];

// An unstarted `lib` chunk with a title, beside the started and empty ones.
const LIB_TESTS = chunk('c4', 'lib', 'Lib tests', ['Fourth']);

function place(overrides: Partial<BacklogPlace> = {}): BacklogPlace {
  return {
    selectedKey: null,
    repo: null,
    filter: '',
    marked: [],
    isReadyOnly: false,
    isChunkedHidden: false,
    isStaleFirst: false,
    isDoneShown: false,
    isAssistantShown: false,
    ...overrides,
  };
}

// Main's default answer to each invoke.
function answerOf(method: string): unknown {
  switch (method) {
    case 'load':
    case 'rescan':
      return READ;
    case 'staleness':
      return {};
    case 'chunks':
    case 'editChunks':
      return CHUNKS;
    case 'commitsSince':
    case 'startChunks':
      return [];
    case 'sweep':
      return 'assistant-session';
    default:
      return undefined;
  }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// One call to the view's `setScope`, `setResizeTarget` or `setFocusTarget`; a
// target is `'target'` when one was set, else null.
type ScopeCall =
  | ['setScope', string]
  | ['setResizeTarget' | 'setFocusTarget', 'target' | null];

// The assistant's pane as scoped-agents runs it: `toggle` shows it and takes
// the keys, or hides it, giving them back through `leave` while it holds them;
// `modeHidden` gives them back the same way and leaves it shown.
interface FakePane {
  spec: AgentPaneSpec | null;
  calls: string[];
  outerPanes: OuterPanes;
}

function fakeAgentPane(record: FakePane, spec: AgentPaneSpec): AgentPane {
  record.spec = spec;
  let isPaneShown = false;
  let holdsKeys = false;
  const giveBack = () => {
    if (holdsKeys) {
      spec.leave();
      holdsKeys = false;
    }
  };
  return {
    element: document.createElement('div'),
    isShown: () => isPaneShown,
    toggle() {
      record.calls.push('toggle');
      if (isPaneShown) {
        giveBack();
        isPaneShown = false;
        spec.setShown(false);
        return;
      }
      isPaneShown = true;
      spec.setShown(true);
      holdsKeys = true;
      spec.tookKeys();
    },
    scopeOpened(scope) {
      record.calls.push(`scopeOpened ${String(scope)}`);
    },
    refresh() {
      record.calls.push('refresh');
    },
    hostTookKeys() {
      record.calls.push('hostTookKeys');
      holdsKeys = false;
    },
    modeHidden() {
      record.calls.push('modeHidden');
      giveBack();
    },
    outerPanes: record.outerPanes,
    redraw() {
      record.calls.push('redraw');
    },
    dispose() {
      record.calls.push('dispose');
    },
  };
}

interface SetupOptions {
  // Whether Backlog mode shows as the view loads; true unless given.
  isShown?: boolean;
  savedPlace?: BacklogPlace;
  // Answers that replace main's default for a method.
  answers?: Partial<Record<string, (...args: unknown[]) => Promise<unknown>>>;
}

// A Backlog view over a channel that loads `READ` and the chunks `CHUNKS`,
// loaded, and shown unless `isShown` is false. `calls` logs every
// `setScope`, `setResizeTarget` and `setFocusTarget` call in order; `move`
// presses the core's focus key on the last focus target set, and
// `resizeTarget` is the last resize target set. `invokes` holds each invoke
// with its args, `runs` each command a click ran with its arg, `events` the
// mode shows and each scope pushed or popped, `places` each place written,
// `outer` each `setOuterPanes`, `contexts` each title bar detail.
async function backlogSetup(options: SetupOptions = {}) {
  const calls: ScopeCall[] = [];
  const invokes: unknown[][] = [];
  const runs: [string, unknown][] = [];
  const logs: string[] = [];
  const toasts: [string, ToastTone][] = [];
  const events: string[] = [];
  const places: BacklogPlace[] = [];
  const outer: (OuterPanes | null)[] = [];
  const contexts: string[] = [];
  const pane: FakePane = {
    spec: null,
    calls: [],
    outerPanes: {
      focus: { move: () => false },
      resize: { nudge: () => false },
    },
  };
  const mode = { isShown: options.isShown ?? true };
  let focusTarget: FocusTarget | null = null;
  let resizeTarget: ResizeTarget | null = null;
  const { keys } = recordingAnchors();
  const channel = {
    invoke: async (method: string, ...args: unknown[]) => {
      invokes.push([method, ...args]);
      const answer = options.answers?.[method];
      return answer === undefined ? answerOf(method) : answer(...args);
    },
  } as unknown as PageChannel<BacklogChannel>;
  const view: BacklogView = createBacklogView({
    channel,
    matcher: fakeFuzzyMatcher,
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    paths: { tilde: (path: string) => path } as unknown as Paths,
    homeDir: '/home',
    uiState: { get: () => undefined, set: () => undefined },
    timers: { set: () => 0, clear: () => undefined },
    log: (line) => logs.push(line),
    toast: (text, tone) => toasts.push([text, tone]),
    keys,
    platform: 'macos',
    state: noLayoutState,
    commands: {
      exists: () => true,
      argShape: () => undefined,
      run: () => undefined,
    },
    openDoc: () => undefined,
    setScope: (scope) => calls.push(['setScope', scope]),
    setResizeTarget: (target) => {
      resizeTarget = target;
      calls.push(['setResizeTarget', target === null ? null : 'target']);
    },
    setFocusTarget: (target) => {
      focusTarget = target;
      calls.push(['setFocusTarget', target === null ? null : 'target']);
    },
    setOuterPanes: (panes) => outer.push(panes),
    pushScope: (scope) => {
      events.push(`push ${scope}`);
      return {
        pop: () => events.push(`pop ${scope}`),
        dispose: () => undefined,
        onBaseChanged: () => ({ dispose: () => undefined }),
      };
    },
    picker: fakeListPickerService({
      pushScope(scope) {
        events.push(`push ${scope}`);
        return {
          pop: () => undefined,
          dispose: () => undefined,
          onBaseChanged: () => ({ dispose: () => undefined }),
        };
      },
    }),
    run: () => undefined,
    runKey: (key, arg) => runs.push([key.id, arg]),
    isShown: () => mode.isShown,
    showMode: () => {
      events.push('showMode');
      show();
    },
    addAgentPane: (spec) => fakeAgentPane(pane, spec),
    setContext: (detail) => contexts.push(detail),
    savedPlace: options.savedPlace ?? null,
    placeChanged: (value) => places.push(value),
  });
  const show = () => {
    mode.isShown = true;
    view.shown();
  };
  const sheet = asFake(view.sheet);
  sheet.isPageRoot = true;
  view.load();
  await settle();
  if (mode.isShown) {
    view.shown();
    await settle();
  }
  return {
    view,
    sheet,
    calls,
    invokes,
    runs,
    logs,
    toasts,
    events,
    places,
    outer,
    contexts,
    pane,
    show,
    move: (direction: PaneDirection) => focusTarget?.move(direction) ?? false,
    resizeTarget: () => resizeTarget,
  };
}

type Setup = Awaited<ReturnType<typeof backlogSetup>>;

// The table's rows, as drawn now.
function tableRows(setup: Setup) {
  const [list] = findAll(setup.sheet, 'backlog-rows');
  return list.children.filter((row) => row.classList.contains('ui-row'));
}

// Whether each table row holds `className`, in order.
function rowFlags(setup: Setup, className: string) {
  return tableRows(setup).map((row) => row.classList.contains(className));
}

// The strip's cards, the chunks' then New chunk, as drawn now.
function chunkCards(setup: Setup) {
  return findAll(setup.sheet, 'backlog-chunk');
}

function cursorCards(setup: Setup) {
  return chunkCards(setup).map((card) => card.classList.contains('is-cursor'));
}

// The key the second table row's click runs `backlog.selectRow` with.
function secondRowKey(setup: Setup) {
  tableRows(setup)[1].click();
  const [, key] = setup.runs.splice(0).at(-1) ?? [];
  return key as string;
}

// The scope the view set last.
function lastScope(setup: Setup) {
  return setup.calls.filter((call) => call[0] === 'setScope').at(-1)?.[1];
}

// Each invoke of `method` since `from`, with its args.
function invokesOf(setup: Setup, method: string, from = 0) {
  return setup.invokes
    .slice(from)
    .filter(([name]) => name === method)
    .map(([, ...args]) => args);
}

function withUser(layout: BacklogLayout) {
  return withLayouts<BacklogLayout>(defaultLayout, layout);
}

// A layout whose `commits` part records each input it draws.
function recordingCommits(drawn: CommitsInput[]): BacklogLayout {
  return {
    commits(parent, input, kit) {
      drawn.push(input);
      return kit.el(parent, 'div', 'mine-commits');
    },
  };
}

let fakeDocument: FocusFakeDocument;

beforeEach(() => {
  fakeDocument = installFocusFakeDom((name, value) =>
    vi.stubGlobal(name, value),
  );
  scroller.calls.length = 0;
  scroller.revealed.length = 0;
  splitCalls.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('backlog view layouts', () => {
  it('a partial layout draws its own rows and default for the rest', async () => {
    const setup = await backlogSetup();

    setup.view.setLayouts(
      withUser({
        tableRow(parent, input, kit) {
          const row = kit.el(parent, 'li', 'mine-row', input.title);
          kit.cursorActions(row);
          return row;
        },
      }),
    );

    const [rows] = findAll(setup.sheet, 'backlog-rows');
    const mine = findAll(rows, 'mine-row');
    expect(mine.map((row) => row.dataset.layout)).toEqual([
      USER_LAYOUT,
      USER_LAYOUT,
      USER_LAYOUT,
    ]);
    const [review] = findAll(setup.sheet, 'backlog-review-item');
    expect(review.dataset.layout).toBe('default');
    const [prompt] = findAll(rows, 'backlog-row-actions');
    const slot = prompt.parentNode!;
    expect(slot.classList.contains('backlog-row-actions-slot')).toBe(true);
    expect(slot.parentNode).toBe(mine[0]);
    expect(mine[0].classList.contains('is-selected')).toBe(true);
  });

  it('a reload keeps the open filter text and focus', async () => {
    const { view, sheet } = await backlogSetup();
    view.commands.filter();
    const [input] = findAll(sheet, 'backlog-filter-input');
    (input as FocusFakeElement).value = 'fir';

    view.setLayouts(
      withUser({
        table(parent, kit) {
          const root = kit.el(parent, 'div', 'mine-table');
          kit.filterBox(root);
          kit.rows(root);
          return { element: root };
        },
      }),
    );

    const [pane] = findAll(sheet, 'mine-table');
    const [moved] = findAll(pane, 'backlog-filter-input');
    expect(moved).toBe(input);
    expect((moved as FocusFakeElement).value).toBe('fir');
    expect(fakeDocument.activeElement).toBe(input);
  });

  it('scrollEnd_ReviewShown_ScrollsItToTheEndAndLogs', async () => {
    const { view, sheet, logs } = await backlogSetup();
    const [review] = findAll(sheet, 'backlog-review');
    Object.assign(review, { scrollHeight: 900 });
    review.scrollTop = 40;
    logs.length = 0;

    view.commands.scrollEnd();

    expect({ scrollTop: review.scrollTop, logs }).toEqual({
      scrollTop: 900,
      logs: ['scrolled the review to the end'],
    });
  });
});

describe('backlog pane targets', () => {
  // `to` is the scope the move sets; false for a move the view turns down.
  it.each<{
    from: 'table' | 'review' | 'strip';
    direction: PaneDirection;
    to: string | false;
  }>([
    { from: 'table', direction: 'right', to: 'review' },
    { from: 'review', direction: 'left', to: 'table' },
    { from: 'table', direction: 'down', to: 'strip' },
    { from: 'strip', direction: 'up', to: 'table' },
    { from: 'review', direction: 'down', to: 'strip' },
    { from: 'table', direction: 'left', to: false },
    { from: 'table', direction: 'up', to: false },
    { from: 'review', direction: 'right', to: false },
    { from: 'review', direction: 'up', to: false },
    { from: 'strip', direction: 'right', to: false },
    { from: 'strip', direction: 'left', to: false },
    { from: 'strip', direction: 'down', to: false },
  ])('focusTarget_Moves: $from $direction', async ({ from, direction, to }) => {
    const setup = await backlogSetup();
    if (from === 'review') {
      setup.move('right');
    } else if (from === 'strip') {
      setup.move('down');
    }

    const result = setup.move(direction);

    expect({ result, scope: lastScope(setup) }).toEqual(
      to === false
        ? { result: false, scope: from }
        : { result: true, scope: to },
    );
  });

  // `first` is the split the pane's resize keys try first.
  it.each<{
    focus: 'table' | 'review' | 'strip';
    direction: PaneDirection;
    first: string;
  }>([
    { focus: 'table', direction: 'left', first: 'tableWidth nudge' },
    { focus: 'review', direction: 'left', first: 'assistantWidth nudge' },
    { focus: 'strip', direction: 'up', first: 'stripHeight nudge' },
  ])('resizeTarget_ByFocus: $focus', async ({ focus, direction, first }) => {
    const setup = await backlogSetup();
    if (focus === 'review') {
      setup.move('right');
    } else if (focus === 'strip') {
      setup.move('down');
    }
    splitCalls.length = 0;

    setup.resizeTarget()?.nudge(direction);

    expect(splitCalls[0]).toBe(first);
  });

  it('assistantPane_TookKeys_FocusAssistantNoScopeSet', async () => {
    const setup = await backlogSetup();
    const callsBefore = setup.calls.length;
    const logsBefore = setup.logs.length;

    setup.view.commands.toggleAssistant();

    expect(setup.calls.slice(callsBefore)).toEqual([]);
    expect(setup.logs.slice(logsBefore)).toEqual([
      'assistant focused',
      'assistant shown',
    ]);
  });

  it('assistantPane_ShownHidden_SetsAndClearsOuterPanes', async () => {
    const setup = await backlogSetup();

    setup.view.hidden();

    expect(setup.outer).toEqual([setup.pane.outerPanes, null]);
    expect(setup.pane.calls).toContain('modeHidden');
  });

  it('assistantPane_SetShown_WritesPlace', async () => {
    const setup = await backlogSetup();
    setup.view.commands.toggleAssistant();
    const opened = setup.places.at(-1);
    const before = setup.places.length;

    setup.view.hidden();

    expect(opened?.isAssistantShown).toBe(true);
    expect(
      setup.places.slice(before).filter((each) => !each.isAssistantShown),
    ).toEqual([]);
  });

  it('focusMain_FromAssistant_GivesKeysToLastHostPane', async () => {
    const setup = await backlogSetup();
    setup.move('right');
    setup.view.commands.toggleAssistant();
    setup.pane.calls.length = 0;

    setup.view.focusMain();

    expect(setup.calls.slice(-3)).toEqual([
      ['setScope', 'review'],
      ['setResizeTarget', 'target'],
      ['setFocusTarget', 'target'],
    ]);
    expect(setup.pane.calls).toEqual(['hostTookKeys']);
  });
});

describe('backlog row commands', () => {
  it('rowClick_RunsItsCommandWithItsKey: item row', async () => {
    const setup = await backlogSetup();

    tableRows(setup)[1].click();

    const [[id, key]] = setup.runs;
    expect(id).toBe('backlog.selectRow');
    setup.view.selectRow(key as string);
    expect(rowFlags(setup, 'is-selected')).toEqual([false, true, false]);
  });

  it('selectRow_SelectsTheRowAndFocusesTheTable', async () => {
    const setup = await backlogSetup();
    const key = secondRowKey(setup);
    setup.move('right');

    setup.view.selectRow(key);

    expect(rowFlags(setup, 'is-cursor')).toEqual([false, true, false]);
    expect(lastScope(setup)).toBe('table');
  });

  it('activate_StartedRow_RunsSessionsSelectRow', async () => {
    const setup = await backlogSetup();
    setup.view.commands.listBottom();

    setup.view.commands.activate();

    expect(setup.runs).toEqual([['sessions.selectRow', 's2']]);
    expect(setup.logs).toContain('opened session Lib work');
  });

  it('selectChunk_Unknown_LogsNoChunk', async () => {
    const setup = await backlogSetup();
    const logsBefore = setup.logs.length;

    setup.view.selectChunk('gone');

    expect(setup.logs.slice(logsBefore)).toEqual(['no chunk gone']);
    expect(lastScope(setup)).toBe('table');
  });

  it('selectChunk_Known_SetsStripCursorAndFocusesStrip', async () => {
    const setup = await backlogSetup();

    setup.view.selectChunk('c1');

    expect(cursorCards(setup)).toEqual([true, false, false, false]);
    expect(lastScope(setup)).toBe('strip');
  });
});

describe('backlog chunk commands', () => {
  it('addToChunk_Applied_ClearsMarksAndSelectsChunk', async () => {
    const added = chunk('c4', 'app', 'New chunk 1', ['First']);
    const setup = await backlogSetup({
      answers: { editChunks: async () => [...CHUNKS, added] },
    });
    setup.view.commands.mark();

    setup.view.commands.addToChunk();
    await settle();

    expect(invokesOf(setup, 'editChunks')).toEqual([
      [{ type: 'add', keys: [FIRST], chunkId: null }],
    ]);
    expect(rowFlags(setup, 'is-marked')).toEqual([false, false, false]);
    expect(cursorCards(setup)).toEqual([false, false, false, true, false]);
    expect(setup.logs).toContain('added 1 to New chunk 1');
  });

  it.each([
    {
      test: 'addToChunk_Rejected_ToastsTextKeepsMarks',
      name: 'addToChunk',
      select: (_setup: Setup) => undefined,
      edit: { type: 'add', keys: [FIRST], chunkId: null },
      marked: [true, false, false],
    },
    {
      test: 'removeFromChunk_Rejected_ToastsTextKeepsMarks',
      name: 'removeFromChunk',
      select: (setup: Setup) => setup.view.commands.listDown(),
      edit: { type: 'remove', keys: [SECOND] },
      marked: [false, true, false],
    },
  ] as const)('$test', async ({ name, select, edit, marked }) => {
    const setup = await backlogSetup({
      answers: {
        editChunks: () => Promise.reject(new Error('No chunk c9')),
      },
    });
    select(setup);
    setup.view.commands.mark();

    setup.view.commands[name]();
    await settle();

    expect(invokesOf(setup, 'editChunks')).toEqual([[edit]]);
    expect(setup.toasts).toEqual([['No chunk c9', 'error']]);
    expect(setup.logs).toContain('editChunks failed: No chunk c9');
    expect(rowFlags(setup, 'is-marked')).toEqual(marked);
  });

  it.each(['renameChunk', 'startChunk', 'toggleHeadless'] as const)(
    'chunkCommands_NoActedChunk_DoNothing: %s',
    async (command) => {
      const setup = await backlogSetup();
      const invokesBefore = setup.invokes.length;
      const logsBefore = setup.logs.length;

      setup.view.commands[command]();
      await settle();

      expect(setup.invokes.slice(invokesBefore)).toEqual([]);
      expect(setup.logs.slice(logsBefore)).toEqual([]);
    },
  );

  // Opens the rename box on Second's chunk, `Fixes`, and types `text`.
  async function renameSetup(text: string) {
    const setup = await backlogSetup();
    setup.view.commands.listDown();
    setup.view.commands.renameChunk();
    const [input] = findAll(setup.sheet, 'backlog-rename-input');
    (input as FocusFakeElement).value = text;
    return setup;
  }

  it('rename_BoxAccept_SendsTrimmedName', async () => {
    const setup = await renameSetup('  Better fixes  ');

    setup.view.commands.boxAccept();
    await settle();

    expect(invokesOf(setup, 'editChunks')).toEqual([
      [{ type: 'rename', chunkId: 'c1', name: 'Better fixes' }],
    ]);
    expect(setup.logs).toContain('renaming Fixes');
    expect(setup.logs).toContain('renamed Better fixes');
  });

  it('rename_EmptyText_SendsNothing', async () => {
    const setup = await renameSetup('   ');

    setup.view.commands.boxAccept();
    await settle();

    expect(invokesOf(setup, 'editChunks')).toEqual([]);
  });

  it('rename_BoxCancel_ClosesTheBox', async () => {
    const setup = await renameSetup('Other');

    setup.view.commands.boxCancel();
    await settle();

    const [frame] = findAll(setup.sheet, 'backlog-rename');
    expect(frame.hidden).toBe(true);
    expect(setup.events.slice(-2)).toEqual(['push box', 'pop box']);
    expect(invokesOf(setup, 'editChunks')).toEqual([]);
  });

  it('startChunks_MixedResults_ToastEach', async () => {
    const setup = await backlogSetup({
      answers: {
        chunks: async () => [...CHUNKS, LIB_TESTS],
        startChunks: async () => [
          { chunkId: 'c1', sessionId: 's9' },
          { chunkId: 'c4', refusal: 'Lib tests is starting' },
        ],
      },
    });

    setup.view.commands.startAllChunks();
    await settle();

    expect(invokesOf(setup, 'startChunks')).toEqual([[['c1', 'c4']]]);
    expect(setup.toasts).toEqual([
      ['Started Fixes', 'success'],
      ['Lib tests is starting', 'error'],
    ]);
    expect(setup.logs).toEqual(
      expect.arrayContaining(['started Fixes', 'start refused Lib tests']),
    );
  });

  it('startAllChunks_RepoFilter_StartsShownUnstartedChunksWithTitles', async () => {
    const setup = await backlogSetup({
      savedPlace: place({ repo: 'lib' }),
      answers: { chunks: async () => [...CHUNKS, LIB_TESTS] },
    });

    setup.view.commands.startAllChunks();
    await settle();

    expect(invokesOf(setup, 'startChunks')).toEqual([[['c4']]]);
  });

  it('sweep_NoRepo_ToastsAndSendsNothing', async () => {
    const setup = await backlogSetup();

    setup.view.commands.sweep();
    await settle();

    expect(setup.toasts).toEqual([['Filter to one repo first', 'error']]);
    expect(invokesOf(setup, 'sweep')).toEqual([]);
  });

  it('sweep_Repo_SendsOpensPaneAndRefreshes', async () => {
    const setup = await backlogSetup({ savedPlace: place({ repo: 'app' }) });

    setup.view.commands.sweep();
    await settle();

    expect(invokesOf(setup, 'sweep')).toEqual([['app']]);
    expect(setup.pane.calls.slice(-2)).toEqual(['toggle', 'refresh']);
    expect(setup.logs).toContain('sweep sent app');
  });

  it('sweep_Rejected_LogsAndToasts', async () => {
    const setup = await backlogSetup({
      savedPlace: place({ repo: 'app' }),
      answers: {
        sweep: () => Promise.reject(new Error('No Backlog repo app')),
      },
    });

    setup.view.commands.sweep();
    await settle();

    expect(setup.toasts).toEqual([['No Backlog repo app', 'error']]);
    expect(setup.logs).toContain('sweep failed: No Backlog repo app');
    expect(setup.pane.calls).not.toContain('toggle');
  });
});

describe('backlog commits', () => {
  it('commits_Reply_SlicesShaTo7AndDateTo10', async () => {
    const setup = await backlogSetup({
      answers: {
        commitsSince: async () => [
          {
            sha: '0123456789abcdef',
            subject: 'Fix the parser',
            at: '2026-10-21T09:30:00+01:00',
            paths: [],
          },
        ],
      },
    });
    const drawn: CommitsInput[] = [];
    setup.view.setLayouts(withUser(recordingCommits(drawn)));

    setup.view.commands.toggleCommits();
    await settle();

    expect(invokesOf(setup, 'commitsSince')).toEqual([[FIRST]]);
    expect(drawn.at(-1)).toEqual({
      commits: [
        { shortSha: '0123456', subject: 'Fix the parser', date: '2026-10-21' },
      ],
      problem: null,
    });
  });

  it('commits_Rejected_DrawsProblem', async () => {
    const setup = await backlogSetup({
      answers: {
        commitsSince: () => Promise.reject(new Error('No Backlog row x')),
      },
    });
    const drawn: CommitsInput[] = [];
    setup.view.setLayouts(withUser(recordingCommits(drawn)));

    setup.view.commands.toggleCommits();
    await settle();

    expect(drawn.at(-1)?.problem).toBe('No Backlog row x');
    expect(setup.logs).toContain('commitsSince failed: No Backlog row x');
  });

  it('commits_OvertakenReply_DrawsOnlyTheLatest', async () => {
    const replies = new Map<unknown, ReturnType<typeof deferred<unknown>>>();
    const setup = await backlogSetup({
      answers: {
        commitsSince(key) {
          const reply = deferred<unknown>();
          replies.set(key, reply);
          return reply.promise;
        },
      },
    });
    const drawn: CommitsInput[] = [];
    setup.view.setLayouts(withUser(recordingCommits(drawn)));
    const commit = (subject: string) => ({
      sha: 'abcdef0123',
      subject,
      at: '2026-10-21T09:30:00Z',
      paths: [],
    });
    setup.view.commands.toggleCommits();
    setup.view.commands.listDown();

    replies.get(SECOND)?.resolve([commit('Second commit')]);
    replies.get(FIRST)?.resolve([commit('First commit')]);
    await settle();

    const subjects = drawn.flatMap((input) =>
      (input.commits ?? []).map((each) => each.subject),
    );
    expect(subjects).not.toContain('First commit');
    expect(drawn.at(-1)?.commits?.map((each) => each.subject)).toEqual([
      'Second commit',
    ]);
  });

  it('commits_ReplyAfterHidden_DrawsNothing', async () => {
    const reply = deferred<unknown>();
    const setup = await backlogSetup({
      answers: { commitsSince: () => reply.promise },
    });
    const drawn: CommitsInput[] = [];
    setup.view.setLayouts(withUser(recordingCommits(drawn)));
    setup.view.commands.toggleCommits();
    setup.view.commands.toggleCommits();
    const drawnBefore = drawn.length;

    reply.resolve([
      { sha: 'abcdef0123', subject: 'Late', at: '2026-10-21', paths: [] },
    ]);
    await settle();

    expect(drawn.length).toBe(drawnBefore);
    expect(findAll(setup.sheet, 'mine-commits')).toEqual([]);
  });
});

describe('backlog strip', () => {
  it('strip_CursorChanged_RefreshesThenReveals', async () => {
    const setup = await backlogSetup();
    scroller.calls.length = 0;
    scroller.revealed.length = 0;

    setup.view.selectChunk('c2');

    const reveal = scroller.calls.indexOf('reveal');
    expect(scroller.calls.filter((call) => call === 'reveal')).toHaveLength(1);
    expect(scroller.calls[reveal - 1]).toBe('refresh');
    const [revealed] = scroller.revealed as HTMLElement[];
    expect(revealed.classList.contains('is-cursor')).toBe(true);
    expect(asFake(revealed).textContent).toContain('Lib work');
  });

  it('dispose_DisposesTheScroller', async () => {
    const setup = await backlogSetup();

    setup.view.dispose();

    expect(scroller.calls).toContain('dispose');
    expect(splitCalls).toEqual(
      expect.arrayContaining([
        'tableWidth dispose',
        'stripHeight dispose',
        'assistantWidth dispose',
      ]),
    );
    expect(setup.pane.calls).toContain('dispose');
  });
});

describe('backlog restore, mode and reads', () => {
  it('restore_BacklogHidden_KeepsPlaceAndTogglesOnceOnNextShown', async () => {
    const setup = await backlogSetup({
      isShown: false,
      savedPlace: place({ isAssistantShown: true }),
    });
    const togglesWhileHidden = setup.pane.calls.filter(
      (call) => call === 'toggle',
    ).length;
    const shownWrittenWhileHidden = new Set<boolean>(
      setup.places.map((each) => each.isAssistantShown),
    );

    setup.show();
    setup.view.hidden();
    setup.show();

    expect(togglesWhileHidden).toBe(0);
    expect(shownWrittenWhileHidden).toEqual(new Set([true]));
    expect(setup.pane.calls.filter((call) => call === 'toggle')).toHaveLength(
      1,
    );
  });

  it('pickRepo_BacklogHidden_ShowsModeFirst', async () => {
    const setup = await backlogSetup({ isShown: false });

    setup.view.commands.pickRepo();

    expect(setup.events).toEqual(['showMode', 'push picker']);
  });

  it('setContext_AtStart_AllRepos', async () => {
    const setup = await backlogSetup();

    expect(setup.contexts).toEqual(['All repos']);
  });

  it('shown_InvokesStalenessAgain', async () => {
    const setup = await backlogSetup();
    const before = invokesOf(setup, 'staleness').length;

    setup.view.hidden();
    setup.view.shown();
    await settle();

    expect(invokesOf(setup, 'staleness')).toHaveLength(before + 1);
  });
});
