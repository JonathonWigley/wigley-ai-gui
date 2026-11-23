import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import type { ToastTone } from '../../../contracts/plugin';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import type { DragReorderEvents } from '../../../shared/page/ui/drag-reorder';
import {
  asFake,
  type FakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import {
  OTHER_COLUMN,
  type WorkCard,
  type WorkMoveArg,
  type WorkState,
  type WorkSuggestion,
} from '../../work/contract';
import {
  jiraCard,
  localCard,
  workItem,
} from '../../work/contract.test-support';
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
}

// A Board view over `state`, shown. `runs` holds each reporting run as `[id, arg]`, `opened` each `core.openLink`
// run, `calls` each `showMode`, and `logs` and `toasts` what the view wrote.
function boardSetup(state: WorkState, options: SetupOptions = {}) {
  const runs: [CommandId, unknown][] = [];
  const opened: unknown[] = [];
  const calls: string[] = [];
  const logs: string[] = [];
  const toasts: [string, ToastTone][] = [];
  const { keys } = recordingAnchors();
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
    timers: {
      set: (run, ms) => setTimeout(run, ms) as unknown as number,
      clear: (handle) => clearTimeout(handle),
    },
    now: () => NOW,
    setScope: () => undefined,
    setFocusTarget: () => undefined,
    setResizeTarget: () => undefined,
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
    savedPlace: null,
    placeChanged: () => undefined,
    holdPlace: () => ({ dispose: () => undefined }),
  });
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
  };
}

type Setup = ReturnType<typeof boardSetup>;

async function settle() {
  for (let turn = 0; turn < 3; turn++) {
    await Promise.resolve();
  }
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
  const started = (state: WorkState, options?: SetupOptions) => {
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

  it('openThreads toasts when the inbox command rejects', async () => {
    const each = started(BOARD, {
      rejects: { 'work-inbox.filterTicket': 'Unknown command' },
    });

    each.view.openThreads('ABC-1');
    await settle();

    expect(each.toasts).toEqual([
      ['Inbox is off: switch on work-inbox in Settings', 'error'],
    ]);
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
});
