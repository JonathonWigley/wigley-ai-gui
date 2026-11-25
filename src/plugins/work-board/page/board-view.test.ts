import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import type { EditorHost } from '../../../contracts/editor';
import type { ResizeTarget } from '../../../contracts/panes';
import type { ToastTone } from '../../../contracts/plugin';
import { uiStateOver } from '../../../shared/fake-ui-state.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import type { DragReorderEvents } from '../../../shared/page/ui/drag-reorder';
import {
  asFake,
  type FakeElement,
  fakeWindow,
  findAll,
  installFocusFakeDom,
  ShrinkingScrollerFakeElement,
} from '../../../shared/page/test-dom';
import { countingEditors } from '../../../shared/plugin-part-harness.test-support';
import {
  OTHER_COLUMN,
  type WorkCard,
  type WorkDetail,
  type WorkItem,
  type WorkMoveArg,
  type WorkState,
  type WorkSuggestion,
} from '../../work/contract';
import {
  jiraCard,
  localCard,
  threadDetail,
  ticketDetail,
  workItem,
} from '../../work/contract.test-support';
import type { WorkBoardPlace } from '../contract';
import { workBoardManifest } from '../manifest';
import type { BoardCardAction } from './board-state';
import { type BoardView, createBoardView } from './board-view';

// What the view registered on its DragReorder since its last `clear`, and the events it handed it.
const drags = vi.hoisted(() => ({
  zones: [] as string[],
  items: [] as { key: string; zone: string }[],
  events: null as DragReorderEvents | null,
}));
vi.mock('../../../shared/page/ui/drag-reorder', () => ({
  createDragReorder(events: DragReorderEvents) {
    drags.events = events;
    const clear = () => {
      drags.zones.length = 0;
      drags.items.length = 0;
    };
    return {
      zone: (_element: HTMLElement, zoneId: string) => drags.zones.push(zoneId),
      item: (
        _element: HTMLElement,
        _source: HTMLElement,
        key: string,
        zone: string,
      ) => drags.items.push({ key, zone }),
      isDragging: () => false,
      clear,
      dispose: clear,
    };
  },
}));

const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const COLUMNS = ['Backlog', 'Todo', 'In Progress', 'In QA', 'Done'];

function board(
  cards: WorkCard[],
  overrides: Partial<WorkState> = {},
): WorkState {
  return {
    items: [],
    cards,
    suggestions: [],
    columns: [...COLUMNS, OTHER_COLUMN],
    job: { running: null, last: null },
    lastSweepAt: null,
    sweepFailedAt: null,
    problem: null,
    ...overrides,
  };
}

const inColumn = (
  key: string,
  column: string,
  overrides: Partial<Extract<WorkCard, { kind: 'jira' }>> = {},
) => jiraCard(key, column, { column, ...overrides });

function suggestion(
  cardId: string,
  state: WorkSuggestion['state'],
): WorkSuggestion {
  return {
    cardId,
    signal: 'branch',
    column: 'In Progress',
    reason: `Branch ${cardId}-fix in repo`,
    at: '2026-11-23T11:00:00.000Z',
    state,
  };
}

// One vim box the fake editor host made: its text, and whether it holds the focus or was destroyed. `blurFromOutside`
// is a click elsewhere taking its focus.
interface FakeBox {
  text: string;
  isFocused: boolean;
  isDestroyed: boolean;
  type(text: string): void;
  blurFromOutside(): void;
}

function fakeEditors(): { host: EditorHost; boxes: FakeBox[] } {
  const boxes: FakeBox[] = [];
  const host: EditorHost = {
    ...countingEditors().host,
    create(_parent, doc, events) {
      const blur = () => {
        if (box.isFocused) {
          box.isFocused = false;
          events.blurred();
        }
      };
      const box: FakeBox = {
        text: doc,
        isFocused: false,
        isDestroyed: false,
        type(text) {
          box.text = text;
          events.changed(text);
        },
        blurFromOutside: blur,
      };
      boxes.push(box);
      return {
        text: () => box.text,
        setText(text) {
          box.text = text;
        },
        insert() {},
        charBeforeCursor: () => '',
        focus() {
          box.isFocused = true;
          events.focused();
        },
        blur,
        destroy() {
          box.isDestroyed = true;
        },
      };
    },
  };
  return { host, boxes };
}

// The card commands a button runs, as the page part routes them.
const CARD_PRESSES: Record<string, BoardCardAction> = {
  'work-board.acceptCard': 'accept',
  'work-board.notYetCard': 'notYet',
  'work-board.deleteCard': 'deleteTask',
  'work-board.startCardSession': 'startSession',
};

interface SetupOptions {
  // The rejection text of each command id whose run fails.
  rejects?: Record<string, string>;
  savedPlace?: WorkBoardPlace;
  // The records `work.details` holds at start.
  details?: WorkDetail[];
}

// The records `details` as `work.details` hands them, by id.
const detailMap = (details: readonly WorkDetail[]) =>
  new Map(details.map((detail) => [detail.id, detail]));

// A Board view over `state` (none landed yet when undefined), shown. `runs` holds each reporting run as `[id, arg]`,
// `opened` each `core.openLink` run, `calls` each `showMode`, `scopes` and `resizeTargets` each set, `boxes` each vim
// box made, `anchors` each key hint anchored, and `logs`, `toasts` and `places` what the view wrote.
function boardSetup(state: WorkState | undefined, options: SetupOptions = {}) {
  const runs: [CommandId, unknown][] = [];
  const places: WorkBoardPlace[] = [];
  const opened: unknown[] = [];
  const calls: string[] = [];
  const logs: string[] = [];
  const toasts: [string, ToastTone][] = [];
  const scopes: string[] = [];
  const resizeTargets: (ResizeTarget | null)[] = [];
  const editors = fakeEditors();
  // What `now` reads; a test moves it with the timers.
  const clock = { ms: NOW };
  const { anchors, keys } = recordingAnchors();
  let isShown = false;
  let view: BoardView | null = null;
  // Each kit or key run, routed as the page part routes it.
  const route = (id: CommandId, arg: unknown) => {
    const action = CARD_PRESSES[id];
    if (action !== undefined) {
      view?.pressCard(action, String(arg));
    } else if (id === 'work-board.moveCardTo') {
      view?.moveCardTo(arg as WorkMoveArg);
    } else if (id === 'work-board.openThreads') {
      view?.openThreads(String(arg));
    } else if (id === 'work-board.selectCard') {
      view?.selectCard(String(arg));
    } else if (id === 'core.openLink') {
      opened.push(arg);
    }
  };
  const declared = workBoardManifest.commands as Record<
    string,
    { arg?: unknown }
  >;
  view = createBoardView({
    log: (line) => logs.push(line),
    toast: (text, tone) => toasts.push([text, tone]),
    kitServices: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
      keys,
      commands: {
        exists: () => true,
        argShape(id) {
          const short = id.replace('work-board.', '');
          return (
            id === 'core.openLink' ? 'string' : declared[short]?.arg
          ) as never;
        },
        run: route,
      },
      platform: 'macos',
      state: noLayoutState,
    },
    editor: editors.host,
    uiState: uiStateOver(new Map()),
    timers: {
      set: (run, ms) => setTimeout(run, ms) as unknown as number,
      clear: (handle) => clearTimeout(handle),
    },
    now: () => clock.ms,
    setScope: (scope) => scopes.push(scope),
    setFocusTarget: () => undefined,
    setResizeTarget: (target) => resizeTargets.push(target),
    isShown: () => isShown,
    showMode: () => calls.push('showMode'),
    runKey: (key, arg) => route(key.id, arg),
    async runFor(id, arg) {
      runs.push([id, arg]);
      const rejection = options.rejects?.[id];
      if (rejection !== undefined) {
        throw new Error(rejection);
      }
      return undefined as never;
    },
    savedPlace: options.savedPlace ?? null,
    placeChanged: (place) => places.push(place),
    holdPlace: () => ({ dispose: () => undefined }),
  });
  view.detailsChanged(detailMap(options.details ?? []));
  view.stateChanged(state);
  isShown = true;
  view.shown();
  return {
    view,
    sheet: asFake(view.sheet),
    runs,
    opened,
    calls,
    logs,
    toasts,
    places,
    scopes,
    resizeTargets,
    boxes: editors.boxes,
    anchors,
    clock,
  };
}

type Setup = ReturnType<typeof boardSetup>;

async function settle() {
  for (let turn = 0; turn < 3; turn++) {
    await Promise.resolve();
  }
}

// Stubs ResizeObserver with observers that report only when the returned `resize` runs each observer of its target
// with the target's new content width, as the browser does when that element resizes.
function recordResizeObservers(): (target: unknown, width: number) => void {
  type Callback = (entries: { contentRect: { width: number } }[]) => void;
  const observers: { callback: Callback; observed: Set<unknown> }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private record: { callback: Callback; observed: Set<unknown> };
      constructor(callback: Callback) {
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
  return (target, width) => {
    for (const { callback, observed } of observers) {
      if (observed.has(target)) {
        callback([{ contentRect: { width } }]);
      }
    }
  };
}

function cardTitled(setup: Setup, title: string): FakeElement {
  const found = findAll(setup.sheet, 'work-board-card').find((card) =>
    card.textContent.includes(title),
  );
  if (found === undefined) {
    throw new Error(`no card ${title}`);
  }
  return found;
}

function buttonIn(root: FakeElement, label: string): FakeElement | undefined {
  return findAll(root, 'ui-button').find((button) =>
    button.textContent.includes(label),
  );
}

function isDisabled(root: FakeElement, label: string): boolean | undefined {
  const button = buttonIn(root, label) as unknown as
    | HTMLButtonElement
    | undefined;
  return button?.disabled;
}

function pressButton(root: FakeElement, label: string) {
  const button = buttonIn(root, label);
  if (button === undefined) {
    throw new Error(`no button ${label}`);
  }
  button.click();
}

// A Jira card in Todo with a waiting suggestion and two threads, then a local task in Todo.
const TODO_CARD = inColumn('ABC-1', 'Todo');
const LOCAL_TASK = localCard('local-1', 'Todo');
const BOARD = board([TODO_CARD, LOCAL_TASK], {
  suggestions: [suggestion('ABC-1', 'suggested')],
  items: [
    workItem('t1', { ticketKeys: ['ABC-1'] }),
    workItem('t2', { ticketKeys: ['ABC-1'] }),
  ],
});

describe('createBoardView', () => {
  let setup: Setup | null = null;
  const started = (state: WorkState | undefined, options?: SetupOptions) => {
    setup = boardSetup(state, options);
    return setup;
  };

  beforeEach(() => {
    installFocusFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    setup?.view.dispose();
    setup = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a drop into another column runs work.moveCard, and into its own runs nothing', () => {
    const { runs } = started(BOARD);

    drags.events?.dropped({ key: 'ABC-1', zone: 'In QA', index: 0 });
    drags.events?.dropped({ key: 'ABC-1', zone: 'Todo', index: 0 });

    expect(runs).toEqual([
      ['work.moveCard', { cardId: 'ABC-1', column: 'In QA' }],
    ]);
  });

  it.each<{
    case: string;
    cursor: string;
    press(setup: Setup): void;
    run: [CommandId, unknown];
  }>([
    {
      case: '◀',
      cursor: 'ABC-1',
      press: (each) => pressButton(cardTitled(each, 'Ticket ABC-1'), '◀'),
      run: ['work.moveCard', { cardId: 'ABC-1', column: 'Backlog' }],
    },
    {
      case: '▶',
      cursor: 'ABC-1',
      press: (each) => pressButton(cardTitled(each, 'Ticket ABC-1'), '▶'),
      run: ['work.moveCard', { cardId: 'ABC-1', column: 'In Progress' }],
    },
    {
      case: 'L',
      cursor: 'ABC-1',
      press: (each) => each.view.commands.moveRight(),
      run: ['work.moveCard', { cardId: 'ABC-1', column: 'In Progress' }],
    },
    {
      case: 'y',
      cursor: 'ABC-1',
      press: (each) => each.view.commands.accept(),
      run: ['work.acceptSuggestion', 'ABC-1'],
    },
    {
      case: 'Accept',
      cursor: 'ABC-1',
      press: (each) => pressButton(cardTitled(each, 'Ticket ABC-1'), 'Accept'),
      run: ['work.acceptSuggestion', 'ABC-1'],
    },
    {
      case: 'n',
      cursor: 'ABC-1',
      press: (each) => each.view.commands.notYet(),
      run: ['work.notYet', 'ABC-1'],
    },
    {
      case: 's',
      cursor: 'ABC-1',
      press: (each) => each.view.commands.startSession(),
      run: ['work.startSession', { source: 'card', id: 'ABC-1' }],
    },
    {
      case: 'd',
      cursor: 'local-1',
      press: (each) => each.view.commands.deleteTask(),
      run: ['work.deleteTask', 'local-1'],
    },
    {
      case: 't',
      cursor: 'ABC-1',
      press: (each) => each.view.commands.threads(),
      run: ['work-inbox.filterTicket', 'ABC-1'],
    },
    {
      case: 'the 2 threads chip',
      cursor: 'ABC-1',
      press: (each) =>
        pressButton(cardTitled(each, 'Ticket ABC-1'), '2 threads'),
      run: ['work-inbox.filterTicket', 'ABC-1'],
    },
  ])(
    'each button and key runs its work command: $case',
    ({ cursor, press, run }) => {
      const each = started(BOARD);
      each.view.selectCard(cursor);

      press(each);

      expect(each.runs).toEqual([run]);
    },
  );

  it('a move leaves the card in its column until the slot changes', () => {
    const each = started(BOARD);

    pressButton(cardTitled(each, 'Ticket ABC-1'), '▶');

    const columns = findAll(each.sheet, 'work-board-column');
    const todo = columns.find((column) => column.textContent.includes('Todo'));
    expect(todo?.textContent).toContain('Ticket ABC-1');
  });

  it.each([
    {
      case: 'H on a card in Other',
      card: inColumn('X-1', OTHER_COLUMN),
      command: 'moveLeft' as const,
    },
    {
      case: 'H in the first column',
      card: inColumn('B-1', 'Backlog'),
      command: 'moveLeft' as const,
    },
    {
      case: 'L on a moving card',
      card: inColumn('M-1', 'Todo', { movingTo: 'In QA' }),
      command: 'moveRight' as const,
    },
    {
      case: 'L in the last column',
      card: inColumn('D-1', 'Done'),
      command: 'moveRight' as const,
    },
  ])(
    'a disabled move logs no move and runs nothing: $case',
    ({ card, command }) => {
      const each = started(board([card]));

      each.view.commands[command]();

      expect(each.logs).toContain(`no move for ${card.id}`);
      expect(each.runs).toEqual([]);
    },
  );

  it('a moving card reads its line, its moves disabled, and is no drag item', () => {
    const each = started(
      board([inColumn('M-1', 'Todo', { movingTo: 'In QA' })]),
    );

    const card = cardTitled(each, 'Ticket M-1');
    expect(card.textContent).toContain('Moving to In QA in Jira…');
    expect(isDisabled(card, '◀')).toBe(true);
    expect(isDisabled(card, '▶')).toBe(true);
    expect(drags.items).toEqual([]);
  });

  it('a local task in an unknown column sits in Other with no moves and with Delete', () => {
    const each = started(board([localCard('local-9', 'Parked')]));

    const other = findAll(each.sheet, 'work-board-column').at(-1);
    expect(other?.textContent).toContain(OTHER_COLUMN);
    const card = cardTitled(each, 'Task local-9');
    expect(isDisabled(card, '◀')).toBe(true);
    expect(isDisabled(card, '▶')).toBe(true);
    expect(buttonIn(card, 'Delete')).toBeDefined();
  });

  it('a rejected work command logs and toasts its text', async () => {
    const each = started(BOARD, {
      rejects: { 'work.moveCard': 'Jira refused the move' },
    });

    pressButton(cardTitled(each, 'Ticket ABC-1'), '▶');
    await settle();

    expect(each.logs).toContain('work.moveCard failed: Jira refused the move');
    expect(each.toasts).toEqual([['Jira refused the move', 'error']]);
  });

  it('a done suggestion draws its Tag and no buttons', () => {
    const each = started(
      board([inColumn('A-1', 'Done')], {
        suggestions: [suggestion('A-1', 'done')],
      }),
    );

    const card = cardTitled(each, 'Ticket A-1');
    const tags = findAll(card, 'ui-tag').map((tag) => tag.textContent);
    expect(tags).toContain('done');
    expect(buttonIn(card, 'Accept')).toBeUndefined();
    expect(buttonIn(card, 'Not yet')).toBeUndefined();
    each.view.commands.accept();
    expect(each.logs).toContain('no accept for A-1');
    expect(each.runs).toEqual([]);
  });

  it('a local task draws no thread chip', () => {
    const each = started(BOARD);

    expect(
      buttonIn(cardTitled(each, 'Task local-1'), 'thread'),
    ).toBeUndefined();
  });

  it('showTicket flashes the card for 1500 ms', () => {
    vi.useFakeTimers();
    const each = started(
      board([inColumn('B-1', 'Backlog'), inColumn('Q-1', 'In QA')]),
    );

    each.view.showTicket('Q-1');

    expect(each.calls).toEqual(['showMode']);
    expect(each.logs).toContain('flash Q-1');
    const flashed = () => cardTitled(each, 'Ticket Q-1').classList;
    expect(flashed().contains('is-cursor')).toBe(true);
    expect(flashed().contains('is-flash')).toBe(true);
    vi.advanceTimersByTime(1499);
    expect(flashed().contains('is-flash')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(flashed().contains('is-flash')).toBe(false);
  });

  it('showTicket on an unknown key toasts and shows nothing', () => {
    const each = started(BOARD);

    each.view.showTicket('NOPE-9');

    expect(each.toasts).toEqual([['NOPE-9 is not on the Board', 'info']]);
    expect(each.logs).toContain('no card NOPE-9');
    expect(each.calls).toEqual([]);
  });

  it.each([
    {
      case: 'no plugin declares it',
      reason: 'Unknown command work-inbox.filterTicket',
      toast: 'Inbox is off: switch on work-inbox in Settings',
    },
    {
      case: 'no started page handles it',
      reason: 'work-inbox.filterTicket has no handler',
      toast: 'Inbox is off: switch on work-inbox in Settings',
    },
    {
      case: 'the Inbox failed to filter',
      reason: 'layout failed',
      toast: 'layout failed',
    },
  ])(
    'openThreads toasts when the inbox command rejects: $case',
    async ({ reason, toast }) => {
      const each = started(BOARD, {
        rejects: { 'work-inbox.filterTicket': reason },
      });

      each.view.openThreads('ABC-1');
      await settle();

      expect(each.toasts).toEqual([[toast, 'error']]);
    },
  );

  it.each([
    {
      case: 'the cursor card leaves the real work',
      first: board([inColumn('B-1', 'Backlog'), inColumn('T-1', 'Todo')]),
      savedPlace: undefined,
    },
    {
      case: 'the first state lands, with a saved place',
      first: undefined,
      savedPlace: { cursorCardId: 'T-1', paneOpen: false, drafts: {} },
    },
  ])(
    "a sample's end puts the cursor back over the real work: $case",
    ({ first, savedPlace }) => {
      const each = started(first, { savedPlace });
      const shown = each.view.showSample(board([inColumn('S-1', 'Todo')]), []);

      each.view.stateChanged(
        board([inColumn('T-1', 'Todo'), inColumn('Q-1', 'In QA')]),
      );
      shown.dispose();

      expect(
        cardTitled(each, 'Ticket T-1').classList.contains('is-cursor'),
      ).toBe(true);
      expect(each.places.at(-1)).toEqual({
        cursorCardId: 'T-1',
        paneOpen: false,
        drafts: {},
      });
    },
  );

  it('a load problem draws under the status line', () => {
    const each = started(board([], { problem: 'work.json is not valid JSON' }));

    expect(
      findAll(each.sheet, 'work-board-problem').map((line) => line.textContent),
    ).toEqual(['work.json is not valid JSON']);
  });

  it('a card in Other is no drag item', () => {
    started(board([inColumn('A-1', 'Todo'), inColumn('X-1', OTHER_COLUMN)]));

    expect(drags.items).toEqual([{ key: 'A-1', zone: 'Todo' }]);
    expect(drags.zones).toEqual(COLUMNS);
  });

  it('the first show puts the cursor on the first card and logs it', () => {
    const each = started(
      board([inColumn('T-1', 'Todo'), inColumn('B-1', 'Backlog')]),
    );

    expect(each.logs).toEqual(['shown', 'selected B-1']);
    expect(cardTitled(each, 'Ticket B-1').classList.contains('is-cursor')).toBe(
      true,
    );
  });

  it('an empty board draws the empty part and the card keys log no card', () => {
    const each = started(board([]));

    expect(each.sheet.textContent).toContain(
      'Nothing on the Board yet: sweep Slack and Jira',
    );
    each.view.commands.accept();
    each.view.commands.cardDown();
    expect(each.logs).toEqual(['shown', 'no card']);
  });

  // Backlog: ABC-1, ABC-2; Todo: the local task from thread t1.
  const PANE_BOARD = board(
    [
      inColumn('ABC-1', 'Backlog'),
      inColumn('ABC-2', 'Backlog'),
      localCard('local-1', 'Todo', { sourceItemId: 't1' }),
    ],
    { items: [workItem('t1')] },
  );
  const DETAILS = [
    ticketDetail('ABC-1', { fetchedAt: '2026-11-23T11:57:00.000Z' }),
    ticketDetail('ABC-2'),
    threadDetail('t1'),
  ];
  const paneOf = (each: Setup) => findAll(each.sheet, 'work-board-detail')[0];
  const boardPaneOf = (each: Setup) => findAll(each.sheet, 'work-board')[0];
  const isPaneHidden = (each: Setup) =>
    findAll(each.sheet, 'work-board-split')[0].classList.contains(
      'is-end-hidden',
    );

  it('togglePane shows and hides the pane, with the split as the resize target while it shows', () => {
    const each = started(PANE_BOARD, { details: DETAILS });
    expect(isPaneHidden(each)).toBe(true);

    each.view.commands.togglePane();

    expect(isPaneHidden(each)).toBe(false);
    expect(paneOf(each).textContent).toContain('Fetched 3m ago');
    expect(each.resizeTargets.at(-1)?.nudge).toBeTypeOf('function');
    expect(each.scopes.at(-1)).toBe('board');
    expect(each.places.at(-1)).toEqual({
      cursorCardId: 'ABC-1',
      paneOpen: true,
      drafts: {},
    });

    each.view.commands.togglePane();

    expect(isPaneHidden(each)).toBe(true);
    expect(paneOf(each).textContent).toBe('');
    expect(each.resizeTargets.at(-1)).toBeNull();
    expect(each.logs.filter((line) => line.startsWith('pane '))).toEqual([
      'pane open',
      'pane closed',
    ]);
  });

  it.each([
    { case: 'a narrow, as the pane opens', widths: [1000, 600], reveals: true },
    {
      case: 'a widen, as the divider moves',
      widths: [600, 1000],
      reveals: false,
    },
    { case: 'a height-only change', widths: [800, 800], reveals: false },
  ])(
    'a board pane resize scrolls the cursor card into view only when the pane narrows: $case',
    ({ widths, reveals }) => {
      const resize = recordResizeObservers();
      const each = started(PANE_BOARD, { details: DETAILS });
      const reveal = vi.spyOn(
        cardTitled(each, 'Ticket ABC-1'),
        'scrollIntoView',
      );
      const [before, after] = widths;
      resize(boardPaneOf(each), before);
      each.view.commands.togglePane();
      reveal.mockClear();

      resize(boardPaneOf(each), after);

      expect(reveal.mock.calls).toEqual(
        reveals ? [[{ block: 'nearest', inline: 'nearest' }]] : [],
      );
    },
  );

  it('the pane follows the cursor and scrolls back to the top on a move', () => {
    const each = started(PANE_BOARD, { details: DETAILS });
    each.view.commands.togglePane();
    paneOf(each).scrollTop = 50;

    each.view.commands.cardDown();

    expect(findAll(paneOf(each), 'work-board-card-key')[0].textContent).toBe(
      'ABC-2',
    );
    expect(paneOf(each).scrollTop).toBe(0);
  });

  it("a redraw for the same card keeps the pane's scroll", () => {
    // A browser drops a scroller's scroll as its content goes.
    installFocusFakeDom(vi.stubGlobal, ShrinkingScrollerFakeElement);
    const each = started(PANE_BOARD, { details: DETAILS });
    each.view.commands.togglePane();
    paneOf(each).scrollTop = 50;

    each.view.detailsChanged(
      detailMap([
        ticketDetail('ABC-1', { assignee: 'Cy' }),
        ...DETAILS.slice(1),
      ]),
    );

    expect(paneOf(each).textContent).toContain('AssigneeCy');
    expect(paneOf(each).scrollTop).toBe(50);
  });

  it.each([
    {
      case: 'the card with its link',
      card: inColumn('ABC-1', 'Todo'),
      hasHint: true,
    },
    {
      case: 'a task with no link',
      card: localCard('local-1', 'Todo'),
      hasHint: false,
    },
  ])(
    "the pane's head draws the open hint only with a link: $case",
    ({ card, hasHint }) => {
      const each = started(board([card]));

      each.view.commands.togglePane();

      expect(
        each.anchors.some(
          (anchor) =>
            !anchor.isDisposed && anchor.command === 'work-board.openCard',
        ),
      ).toBe(hasHint);
    },
  );

  it.each([
    {
      case: 'a task with no thread',
      card: localCard('local-1', 'Todo'),
      line: 'This task has no Slack thread.',
    },
    {
      case: 'a task whose thread left the Inbox',
      card: localCard('local-1', 'Todo', { sourceItemId: 't9' }),
      line: 'Its Slack thread is no longer in the Inbox.',
    },
  ])('a task pane with no thread to show says why: $case', ({ card, line }) => {
    const each = started(board([card]));

    each.view.commands.togglePane();

    expect(paneOf(each).textContent).toContain(line);
  });

  it('an open pane with no cursor card draws the empty part', () => {
    const each = started(board([]));

    each.view.commands.togglePane();

    expect(paneOf(each).textContent).toBe('No card selected.');
  });

  it('a Jira card with no stored detail draws the missing line, its open threads and the comment box', () => {
    const each = started(
      board([inColumn('ABC-9', 'Todo')], {
        items: [workItem('t1', { ticketKeys: ['ABC-9'], summary: 'QA asks.' })],
      }),
    );

    each.view.commands.togglePane();

    expect(paneOf(each).textContent).toContain(
      'No detail yet: the next sweep fetches it.',
    );
    expect(
      findAll(paneOf(each), 'work-board-detail-summary').map(
        (line) => line.textContent,
      ),
    ).toEqual(['QA asks.']);
    expect(findAll(paneOf(each), 'work-board-box')).toHaveLength(1);
    expect(each.boxes).toHaveLength(1);
  });

  it.each<{
    case: string;
    rejects: Record<string, string>;
    drafts: Record<string, string>;
    toasts: [string, string][];
  }>([
    {
      case: 'main takes it: the draft leaves the place',
      rejects: {},
      drafts: {},
      toasts: [],
    },
    {
      case: 'main refuses: the draft stays and the reason toasts',
      rejects: { 'work.comment': 'ABC-1 is not commentable' },
      drafts: { 'ABC-1': 'my text' },
      toasts: [['ABC-1 is not commentable', 'error']],
    },
  ])(
    'send on a Jira card runs work.comment and leaves the box at once: $case',
    async ({ rejects, drafts, toasts }) => {
      const each = started(PANE_BOARD, { rejects });
      each.view.commands.enterBox();
      each.boxes[0].type('my text');

      each.view.commands.send();

      expect(each.scopes.at(-1)).toBe('board');
      expect(each.boxes[0].isFocused).toBe(false);
      await settle();
      expect(each.runs).toEqual([
        ['work.comment', { cardId: 'ABC-1', text: 'my text' }],
      ]);
      expect(each.places.at(-1)?.drafts).toEqual(drafts);
      expect(each.toasts).toEqual(toasts);
    },
  );

  it('send with an empty box toasts and runs nothing', () => {
    const each = started(PANE_BOARD);
    each.view.commands.enterBox();

    each.view.commands.send();

    expect(each.toasts).toEqual([['Nothing to send', 'info']]);
    expect(each.runs).toEqual([]);
  });

  it('send on a local task starts from an empty box and runs work.send on its source item with the typed text', async () => {
    const each = started(PANE_BOARD);
    each.view.selectCard('local-1');
    each.view.commands.enterBox();
    expect(each.boxes.at(-1)?.text).toBe('');

    each.boxes.at(-1)?.type('On it');
    each.view.commands.send();
    await settle();

    expect(each.runs).toEqual([['work.send', { itemId: 't1', text: 'On it' }]]);
  });

  it('a reply send keeps the typed text: read-only while sending, typed again after a failure, gone once cleared', async () => {
    const withItem = (overrides: Partial<WorkItem>) =>
      board(PANE_BOARD.cards, { items: [workItem('t1', overrides)] });
    const each = started(PANE_BOARD);
    each.view.selectCard('local-1');
    each.view.commands.enterBox();
    each.boxes.at(-1)?.type('On it');
    each.view.commands.send();
    await settle();
    expect(each.places.at(-1)?.drafts).toEqual({ 'local-1': 'On it' });

    each.view.stateChanged(withItem({ sending: 'On it' }));
    expect(
      findAll(paneOf(each), 'work-board-box-text').map(
        (box) => box.textContent,
      ),
    ).toEqual(['On it']);

    each.view.stateChanged(withItem({ note: 'Send failed: offline' }));
    expect(each.boxes.at(-1)?.text).toBe('On it');

    each.view.stateChanged(withItem({ state: 'cleared' }));
    expect(each.places.at(-1)?.drafts).toEqual({});
  });

  it('enterBox opens the pane, sets the box scope and focuses the box', () => {
    const each = started(PANE_BOARD);

    each.view.commands.enterBox();

    expect(isPaneHidden(each)).toBe(false);
    expect(each.scopes.at(-1)).toBe('box');
    expect(each.boxes[0].isFocused).toBe(true);
    expect(each.logs).toContain('focused box of ABC-1');
  });

  it('enterBox on a task with no thread logs no box', () => {
    const each = started(board([localCard('local-1', 'Todo')]));

    each.view.commands.enterBox();

    expect(each.logs.at(-1)).toBe('no box for local-1');
    expect(each.scopes.at(-1)).toBe('board');
  });

  it('the scroll keys log no pane while it is closed, and scroll the open pane', () => {
    const each = started(PANE_BOARD, { details: DETAILS });

    each.view.commands.lineDown();
    expect(each.logs.at(-1)).toBe('no pane');

    each.view.commands.togglePane();
    const pane = paneOf(each);
    Object.defineProperty(pane, 'scrollHeight', { value: 1000 });
    Object.defineProperty(pane, 'clientHeight', { value: 200 });
    vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '20px' }));
    each.view.commands.lineDown();

    expect(each.logs.at(-1)).toBe('scrolled the detail down a line');
  });

  it('a card with queued comments reads Posting… on the card and in the pane', () => {
    const each = started(
      board([inColumn('ABC-1', 'Todo', { commenting: ['queued text'] })]),
    );

    each.view.commands.togglePane();

    expect(cardTitled(each, 'Ticket ABC-1').textContent).toContain('Posting…');
    const [block] = findAll(paneOf(each), 'work-board-detail-posting');
    expect(block?.textContent).toContain('Posting…');
    const [text] = findAll(block, 'work-board-detail-text');
    expect(text?.innerHTML).toBe('queued text');
  });

  it.each([
    {
      case: 'the card leaves the board',
      act: (each: Setup) =>
        each.view.stateChanged(
          board([inColumn('ABC-2', 'Backlog')], { items: [] }),
        ),
    },
    {
      case: 'a palette togglePane closes the pane',
      act: (each: Setup) => each.view.commands.togglePane(),
    },
  ])(
    'a redraw that drops the focused box hands the keys to the board: $case',
    ({ act }) => {
      const each = started(PANE_BOARD);
      each.view.commands.enterBox();

      act(each);

      expect(each.scopes.at(-1)).toBe('board');
      // A box dropped by a redraw is destroyed; no live one holds the focus.
      expect(each.boxes.some((box) => box.isFocused && !box.isDestroyed)).toBe(
        false,
      );
      expect(document.activeElement).toBe(boardPaneOf(each));
    },
  );

  it.each([
    { case: 'its own card keeps the box', cardId: 'ABC-1', scope: 'box' },
    { case: 'another card leaves the box', cardId: 'ABC-2', scope: 'board' },
  ])('selectCard under a focused box: $case', ({ cardId, scope }) => {
    const each = started(PANE_BOARD);
    each.view.commands.enterBox();

    each.view.selectCard(cardId);

    expect(each.scopes.at(-1)).toBe(scope);
    expect(each.boxes[0]).toMatchObject({
      isFocused: true,
      isDestroyed: scope === 'board',
    });
  });

  it.each([
    { case: 'leaveBox', act: (each: Setup) => each.view.commands.leaveBox() },
    {
      case: 'a click outside',
      act: (each: Setup) => each.boxes[0].blurFromOutside(),
    },
  ])(
    'leaving the box gives the keys and the focus to the board: $case',
    ({ act }) => {
      const each = started(PANE_BOARD);
      each.view.commands.enterBox();

      act(each);

      expect(each.scopes.at(-1)).toBe('board');
      expect(document.activeElement).toBe(boardPaneOf(each));
      expect(each.logs.at(-1)).toBe('board focused');
    },
  );

  it("a sample's details show in place of the slot's until its end", () => {
    const each = started(PANE_BOARD, { details: DETAILS });
    each.view.commands.togglePane();

    const shown = each.view.showSample(board([inColumn('ABC-1', 'Todo')]), [
      ticketDetail('ABC-1', { assignee: 'Sample person' }),
    ]);
    each.view.openPane();
    expect(paneOf(each).textContent).toContain('Sample person');

    shown.dispose();
    expect(paneOf(each).textContent).toContain('AssigneeAnn');
    expect(paneOf(each).textContent).not.toContain('Sample person');
  });

  it('a restored draft fills the box, and the placeholder shows only while the box is empty', () => {
    const each = started(PANE_BOARD, {
      savedPlace: {
        cursorCardId: 'ABC-1',
        paneOpen: true,
        drafts: { 'ABC-1': 'saved text' },
      },
    });
    const isEmpty = () =>
      findAll(paneOf(each), 'work-board-box')[0].classList.contains('is-empty');

    expect(each.boxes.at(-1)?.text).toBe('saved text');
    expect(isEmpty()).toBe(false);

    each.boxes.at(-1)?.type('');

    expect(isEmpty()).toBe(true);
  });

  it('hidden leaves the focused box', () => {
    const each = started(PANE_BOARD);
    each.view.commands.enterBox();

    each.view.hidden();

    expect(each.boxes[0].isFocused).toBe(false);
  });

  // A text selection whose anchor is the first element of `root` with class `className`.
  const selectIn = (root: FakeElement, className: string) => {
    const anchorNode = findAll(root, className)[0];
    Object.assign(fakeWindow(), {
      getSelection: () => ({ isCollapsed: false, anchorNode }),
    });
  };

  it.each([
    {
      case: 'nothing in the pane',
      select: () => {},
      fetched: 'Fetched 4m ago',
    },
    {
      case: 'a selection on the board',
      select: (each: Setup) => selectIn(boardPaneOf(each), 'work-board-card'),
      fetched: 'Fetched 4m ago',
    },
    {
      case: 'a selection inside the pane waits',
      select: (each: Setup) =>
        selectIn(paneOf(each), 'work-board-detail-title'),
      fetched: 'Fetched 3m ago',
    },
  ])("the pane's ages redraw once a minute: $case", ({ select, fetched }) => {
    vi.useFakeTimers();
    const each = started(PANE_BOARD, { details: DETAILS });
    each.view.commands.togglePane();
    expect(paneOf(each).textContent).toContain('Fetched 3m ago');
    select(each);

    each.clock.ms += 60_000;
    vi.advanceTimersByTime(60_000);

    expect(paneOf(each).textContent).toContain(fetched);
  });

  it('a minute tick, and the typing after it, while the box holds the focus leave the box and the pane as they are', () => {
    vi.useFakeTimers();
    const each = started(PANE_BOARD, { details: DETAILS });
    each.view.commands.enterBox();
    const drawn = findAll(paneOf(each), 'work-board-detail-pane')[0];

    each.clock.ms += 60_000;
    vi.advanceTimersByTime(60_000);
    each.boxes[0].type('half a thought');

    expect(findAll(paneOf(each), 'work-board-detail-pane')[0]).toBe(drawn);
    expect(paneOf(each).textContent).toContain('Fetched 3m ago');
    expect(each.boxes).toHaveLength(1);
    expect(each.boxes[0]).toMatchObject({
      text: 'half a thought',
      isFocused: true,
      isDestroyed: false,
    });
    expect(each.scopes.at(-1)).toBe('box');
  });
});
