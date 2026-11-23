import type { Timers } from '../../../contracts/ambient';
import {
  CORE_OPEN_LINK,
  type CommandId,
  type CommandKey,
} from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { FocusTarget, ResizeTarget } from '../../../contracts/panes';
import type {
  CommandsRunIn,
  PluginCommands,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import type { OwnerKitServices } from '../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  disposeDraws,
  type RollbackDeps,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import type { PromptActionInput } from '../../../shared/page/layout-host/kit';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { createDragReorder } from '../../../shared/page/ui/drag-reorder';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import { qualify } from '../../../shared/plugin-manifests';
import {
  statusLine,
  type WorkCard,
  type WorkMoveArg,
  type WorkState,
  workMoveCardCommand,
  workStartSessionCommand,
} from '../../work/contract';
import type { WorkBoardPlace } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  BoardLayout,
  CardInput,
  ColumnInput,
  CompleteBoardLayout,
} from '../layouts/layout';
import type { workBoardManifest } from '../manifest';
import {
  type BoardAction,
  type BoardCardAction,
  type BoardColumn,
  type BoardViewState,
  boardReducer,
  cardActions,
  cardNamed,
  cursorCard,
  initialBoardState,
  neighbourColumns,
  shownColumns,
  suggestionOf,
  threadCount,
} from './board-state';
import { BOARD_SCOPE, createBoardKit } from './layout/board-kit';

const PLUGIN_ID = 'work-board';
const STATUS_REDRAW_MS = 60_000;
const FLASH_MS = 1500;

// Run across plugins by id: work-inbox's page part declares it, and it may be switched off.
const INBOX_FILTER_TICKET: CommandId = 'work-inbox.filterTicket';
const INBOX_OFF = 'Inbox is off: switch on work-inbox in Settings';

// The click on a card.
const selectCardCommand: CommandKey<string, 'work-board.selectCard'> = {
  id: 'work-board.selectCard',
};

// The work command each card action but a move runs, with the card id (Session with a `WorkStartArg`).
const WORK_COMMANDS: Record<
  Exclude<BoardCardAction, 'moveLeft' | 'moveRight'>,
  CommandId
> = {
  accept: 'work.acceptSuggestion',
  notYet: 'work.notYet',
  startSession: workStartSessionCommand.id,
  deleteTask: 'work.deleteTask',
};

// The cursor card's key prompts, each the control hint of its button or chip.
const PROMPTS: readonly {
  action: BoardCardAction | 'threads';
  label: string;
}[] = [
  { action: 'moveLeft', label: 'move left' },
  { action: 'moveRight', label: 'move right' },
  { action: 'accept', label: 'accept' },
  { action: 'notYet', label: 'not yet' },
  { action: 'threads', label: 'threads' },
  { action: 'startSession', label: 'session' },
  { action: 'deleteTask', label: 'delete' },
];

const EMPTY_WORK: WorkState = {
  items: [],
  cards: [],
  suggestions: [],
  columns: [],
  job: { running: null, last: null },
  problem: null,
};

type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

// Every no-arg page command but `showMode`, which the page part runs itself.
export type BoardCommand = Exclude<
  CommandsRunIn<typeof workBoardManifest, 'page'>,
  | 'showMode'
  | 'showTicket'
  | 'selectCard'
  | 'openThreads'
  | 'moveCardTo'
  | 'acceptCard'
  | 'notYetCard'
  | 'deleteCard'
  | 'startCardSession'
>;

export interface BoardViewDeps {
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  // What a layout's kit draws with.
  kitServices: OwnerKitServices;
  timers: Pick<Timers, 'set' | 'clear'>;
  // Epoch milliseconds, for the status line's age.
  now(): number;
  setScope(scope: typeof BOARD_SCOPE): void;
  setFocusTarget(target: FocusTarget | null): void;
  setResizeTarget(target: ResizeTarget | null): void;
  isShown(): boolean;
  // Shows Board mode when it is hidden.
  showMode(): void;
  // Runs the command `key` with `arg`, as a click does.
  runKey<A>(key: CommandKey<A>, arg: A): void;
  // A reporting run (`api.commands.runFor`): rejects with the handler's failure.
  runFor: PluginCommands['runFor'];
  // The last page's place, put back once the first state lands; null for none.
  savedPlace: WorkBoardPlace | null;
  placeChanged(place: WorkBoardPlace): void;
  // Stops place writes until its dispose.
  holdPlace(): Disposable;
}

// Board mode's view: the head and the columns of cards in the sheet, logging under `work-board`. What shows lives in
// `boardReducer`; the view draws its state over the work `stateChanged` hands it, through the layout picked for each
// part, with `default` until the first `setLayouts`. Every work command runs through one reporting run, which logs and
// toasts a refusal. The view never moves a card itself: it redraws from the slot.
export interface BoardView {
  sheet: HTMLElement;
  shown(): void;
  hidden(): void;
  focusMain(): void;
  stateChanged(value: WorkState | undefined): void;
  setLayouts(shown: ShownLayouts<BoardLayout>): void;
  // Draws `state` in place of `work.state` until the returned dispose, holding the place meanwhile.
  showSample(state: WorkState): Disposable;
  dispose(): void;
  commands: Record<BoardCommand, () => void>;
  // Shows the mode with the cursor on card `key`, scrolled into view and flashed, the board focused.
  showTicket(key: string): void;
  // Puts the cursor on card `id`, the board focused.
  selectCard(id: string): void;
  // Shows the open threads holding `key` in the Inbox.
  openThreads(key: string): void;
  // Moves card `arg.cardId` to `arg.column` through `work.moveCard`.
  moveCardTo(arg: WorkMoveArg): void;
  // Runs card action `action` on card `id`, when its card offers it.
  pressCard(action: BoardCardAction, id: string): void;
}

export function createBoardView(deps: BoardViewDeps): BoardView {
  const { log } = deps;

  // The work `work.state` last held, and the demo sample drawn in its place.
  let realWork: WorkState | undefined;
  let sample: WorkState | null = null;
  const shownWork = (): WorkState => sample ?? realWork ?? EMPTY_WORK;
  const store = createReducerStore<BoardViewState, BoardAction>(
    initialBoardState,
    (state, action) => boardReducer(state, action, shownWork()),
  );
  const dispatch = (action: BoardAction) => store.dispatch(action);
  // Whether the first state has landed, which puts back the saved place; no place is written before it.
  let isPlaceRestored = false;
  let isDisposed = false;

  // ── Layouts ────────────────────────────────────────────────────────────
  const parts = createLayoutParts<BoardLayout, CompleteBoardLayout>({
    owner: PLUGIN_ID,
    defaultLayout,
    log,
  });
  const kitFor = (rollback: RollbackDeps) =>
    createBoardKit(deps.kitServices, rollback);

  // ── Elements ───────────────────────────────────────────────────────────
  // The containers stay app-owned; the board pane draws inside them and places the slots below.
  const boardPane = element('div', 'work-board');
  boardPane.tabIndex = -1;
  const contentSheet = sheet();
  contentSheet.classList.add('work-board-sheet');
  contentSheet.append(boardPane);
  const statusSlot = element('div', 'work-board-status-slot');
  const columnsSlot = element('div', 'work-board-columns');

  // ── Drag ───────────────────────────────────────────────────────────────
  // A redraw the slot asked for while a drag ran, drawn when it ends.
  let isRedrawHeld = false;
  const drag = createDragReorder({
    dropped({ key, zone }) {
      const card = cardNamed(shownWork(), key);
      if (card !== null && card.column !== zone) {
        moveCardTo({ cardId: key, column: zone });
      }
    },
    started() {},
    ended() {
      if (isRedrawHeld && !isDisposed) {
        isRedrawHeld = false;
        drawnColumnsKey = null;
        render();
      }
    },
  });

  // ── Drawing ────────────────────────────────────────────────────────────
  let statusDraws: DrawnRoot[] = [];
  let columnDraws: DrawnRoot[] = [];
  let cardDraws: DrawnRoot[] = [];
  // What each part was drawn from; null to draw again.
  let drawnStatusKey: string | null = null;
  let drawnColumnsKey: string | null = null;
  let isScopeShown = false;
  // The cursor last logged while shown; undefined before the first.
  let loggedCursor: string | null | undefined;

  const drawBoardPane = () => {
    parts.redraw('board', boardPane, (board, into, rollback) => {
      const slots = [
        appSlot(statusSlot, 'status', rollback),
        appSlot(columnsSlot, 'columns', rollback),
      ] as const;
      const [status, columns] = slots;
      const pane = board(into, {
        ...kitFor(rollback),
        status: status.place,
        columns: columns.place,
      });
      const root = requireElementIn(into, pane.element, 'board');
      for (const slot of slots) {
        slot.placeIfLeftOut(root);
      }
      return pane;
    });
  };

  const drawStatus = (work: WorkState) => {
    const line = statusLine(work.job, deps.now());
    const key = JSON.stringify(line);
    if (key === drawnStatusKey) {
      return;
    }
    drawnStatusKey = key;
    const held = statusDraws;
    statusDraws = [];
    disposeDraws(held);
    statusSlot.replaceChildren();
    statusDraws.push(
      parts.draw('status', statusSlot, (status, into, rollback) => ({
        element: requireElementIn(
          into,
          status(into, line, kitFor(rollback)),
          'status',
        ),
      })),
    );
  };

  const promptOf = (
    actions: readonly BoardCardAction[],
    threads: number,
  ): PromptActionInput[] =>
    PROMPTS.filter(({ action }) =>
      action === 'threads' ? threads > 0 : actions.includes(action),
    ).map(({ action, label }) => ({
      command: qualify(PLUGIN_ID, action),
      label,
    }));

  const cardInputOf = (
    card: WorkCard,
    state: BoardViewState,
    work: WorkState,
  ): CardInput => {
    const { prev, next } = neighbourColumns(card, work);
    const suggestion = suggestionOf(card, work);
    const actions = [...cardActions(card, work)];
    const threads = threadCount(card, work);
    const isCursor = card.id === state.cursorCardId;
    const isJira = card.kind === 'jira';
    return {
      id: card.id,
      kind: card.kind,
      key: isJira ? card.key : null,
      url: card.url,
      priority: isJira ? card.priority : null,
      title: card.title,
      threads,
      ticketKey: isJira ? card.key : null,
      suggestion:
        suggestion === null
          ? null
          : { reason: suggestion.reason, isDone: suggestion.state === 'done' },
      movingTo: card.movingTo,
      note: card.note,
      prev,
      next,
      isCursor,
      isFlash: card.id === state.flashCardId,
      actions,
      prompt: isCursor ? promptOf(actions, threads) : [],
    };
  };

  const isDraggable = (card: WorkCard, column: BoardColumn) =>
    column.isDropTarget && card.movingTo === null;

  const drawCard = (
    input: CardInput,
    card: WorkCard,
    column: BoardColumn,
    list: HTMLElement,
  ): DrawnRoot => {
    const drawn = parts.draw('card', list, (cardPart, into, rollback) => ({
      element: requireElementIn(
        into,
        cardPart(into, input, kitFor(rollback)),
        'card',
      ),
    }));
    const root = drawn.built.element;
    rowAction(root, () => deps.runKey(selectCardCommand, input.id));
    root.classList.toggle('is-cursor', input.isCursor);
    root.classList.toggle('is-flash', input.isFlash);
    if (isDraggable(card, column)) {
      drag.item(root, root, card.id, column.name);
    }
    return drawn;
  };

  const drawColumn = (
    column: BoardColumn,
    state: BoardViewState,
    work: WorkState,
  ) => {
    const input: ColumnInput = {
      name: column.name,
      count: column.cards.length,
      isDropTarget: column.isDropTarget,
    };
    const list = element('ol', 'work-board-cards');
    const drawn = parts.draw(
      'column',
      columnsSlot,
      (columnPart, into, rollback) => {
        const cards = appSlot(list, 'cards', rollback);
        const root = requireElementIn(
          into,
          columnPart(into, input, { ...kitFor(rollback), cards: cards.place }),
          'column',
        );
        cards.placeIfLeftOut(root);
        return { element: root };
      },
    );
    columnDraws.push(drawn);
    if (column.isDropTarget) {
      drag.zone(drawn.built.element, column.name, { ordered: false });
    }
    for (const card of column.cards) {
      cardDraws.push(
        drawCard(cardInputOf(card, state, work), card, column, list),
      );
    }
  };

  const drawColumns = (state: BoardViewState, work: WorkState) => {
    const columns = shownColumns(work);
    const key = JSON.stringify([
      columns.map((column) => [
        column.name,
        column.isDropTarget,
        column.cards.map((card) => cardInputOf(card, state, work)),
      ]),
    ]);
    if (key === drawnColumnsKey) {
      return;
    }
    if (drag.isDragging()) {
      isRedrawHeld = true;
      return;
    }
    drawnColumnsKey = key;
    drag.clear();
    const held = [...cardDraws, ...columnDraws];
    cardDraws = [];
    columnDraws = [];
    disposeDraws(held);
    columnsSlot.replaceChildren();
    if (work.cards.length === 0) {
      columnDraws.push(
        parts.draw('empty', columnsSlot, (empty, into, rollback) => ({
          element: requireElementIn(
            into,
            empty(into, kitFor(rollback)),
            'empty',
          ),
        })),
      );
      return;
    }
    for (const column of columns) {
      drawColumn(column, state, work);
    }
    columnsSlot
      .querySelector('.is-cursor')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  // Logs each cursor move or placement while the mode shows.
  const noteChanges = (state: BoardViewState) => {
    if (!deps.isShown() || state.cursorCardId === loggedCursor) {
      return;
    }
    loggedCursor = state.cursorCardId;
    if (state.cursorCardId !== null) {
      log(`selected ${state.cursorCardId}`);
    }
  };

  const writePlace = (state: BoardViewState) => {
    if (!isPlaceRestored || sample !== null) {
      return;
    }
    deps.placeChanged({ cursorCardId: state.cursorCardId });
  };

  // Sets the scope and drops the targets once per show: the sheet has no split.
  const syncTargets = (always: boolean) => {
    if (!deps.isShown() || (!always && isScopeShown)) {
      return;
    }
    isScopeShown = true;
    deps.setScope(BOARD_SCOPE);
    deps.setResizeTarget(null);
    deps.setFocusTarget(null);
  };

  const render = (always = false) => {
    const state = store.get();
    const work = shownWork();
    drawStatus(work);
    drawColumns(state, work);
    noteChanges(state);
    writePlace(state);
    syncTargets(always);
  };

  drawBoardPane();
  store.subscribe(() => render());

  // The status line's age, again once a minute.
  let statusTimer: number | null = null;
  const redrawStatus = () => {
    drawStatus(shownWork());
    statusTimer = deps.timers.set(redrawStatus, STATUS_REDRAW_MS);
  };
  statusTimer = deps.timers.set(redrawStatus, STATUS_REDRAW_MS);

  // The flash's end, while one shows.
  let flashTimer: number | null = null;
  const clearFlashTimer = () => {
    if (flashTimer !== null) {
      deps.timers.clear(flashTimer);
      flashTimer = null;
    }
  };

  const focusBoard = () => {
    render(true);
    if (deps.isShown()) {
      boardPane.focus();
    }
  };

  // ── Work commands ────────────────────────────────────────────────────────
  // Runs another plugin's command as a reporting run; a refusal logs `<id> failed: <reason>` and toasts `failText`,
  // else the reason, in the error tone. Never throws, and nothing awaits it.
  const runWork = (id: CommandId, arg?: unknown, failText?: string) => {
    deps.runFor(id, arg, {}).catch((error: unknown) => {
      if (isDisposed) {
        return;
      }
      log(`${id} failed: ${errorText(error)}`);
      deps.toast(failText ?? errorText(error), 'error');
    });
  };

  const moveCardTo = (arg: WorkMoveArg) => runWork(workMoveCardCommand.id, arg);

  const pressCard = (action: BoardCardAction, id: string) => {
    const work = shownWork();
    const card = cardNamed(work, id);
    const isMove = action === 'moveLeft' || action === 'moveRight';
    if (card === null || !cardActions(card, work).includes(action)) {
      log(isMove ? `no move for ${id}` : `no ${action} for ${id}`);
      return;
    }
    if (action === 'moveLeft' || action === 'moveRight') {
      const { prev, next } = neighbourColumns(card, work);
      const column = action === 'moveLeft' ? prev : next;
      if (column !== null) {
        moveCardTo({ cardId: id, column });
      }
      return;
    }
    const arg = action === 'startSession' ? { source: 'card', id } : id;
    runWork(WORK_COMMANDS[action], arg);
  };

  const openThreads = (key: string) =>
    runWork(INBOX_FILTER_TICKET, key, INBOX_OFF);

  // Runs `act` on the cursor card; logs `no card` with none.
  const onCursor = (act: (card: WorkCard) => void) => () => {
    const card = cursorCard(store.get(), shownWork());
    if (card === null) {
      log('no card');
      return;
    }
    act(card);
  };

  const cursorPress = (action: BoardCardAction) =>
    onCursor((card) => pressCard(action, card.id));

  // ── Commands ─────────────────────────────────────────────────────────────
  const commands: Record<BoardCommand, () => void> = {
    cardDown: () => dispatch({ type: 'cardStep', to: 'down' }),
    cardUp: () => dispatch({ type: 'cardStep', to: 'up' }),
    cardTop: () => dispatch({ type: 'cardStep', to: 'top' }),
    cardBottom: () => dispatch({ type: 'cardStep', to: 'bottom' }),
    columnLeft: () => dispatch({ type: 'columnStep', delta: -1 }),
    columnRight: () => dispatch({ type: 'columnStep', delta: 1 }),
    moveLeft: cursorPress('moveLeft'),
    moveRight: cursorPress('moveRight'),
    openCard: onCursor((card) => {
      if (card.url === null) {
        log(`no link for ${card.id}`);
        return;
      }
      deps.runKey(CORE_OPEN_LINK, card.url);
    }),
    accept: cursorPress('accept'),
    notYet: cursorPress('notYet'),
    threads: onCursor((card) => {
      if (card.kind !== 'jira' || threadCount(card, shownWork()) === 0) {
        log(`no threads for ${card.id}`);
        return;
      }
      openThreads(card.key);
    }),
    startSession: cursorPress('startSession'),
    deleteTask: cursorPress('deleteTask'),
    sweep: () => runWork('work.sweep'),
    showJobRow: () => runWork('work.openJobRow'),
  };

  return {
    sheet: contentSheet,
    shown() {
      log('shown');
      isScopeShown = false;
      render(true);
    },
    hidden() {
      isScopeShown = false;
    },
    focusMain: () => focusBoard(),
    stateChanged(value) {
      const previous = shownWork();
      realWork = value;
      if (sample !== null) {
        return;
      }
      if (!isPlaceRestored && value !== undefined) {
        isPlaceRestored = true;
        dispatch({
          type: 'restore',
          cursorCardId: deps.savedPlace?.cursorCardId ?? null,
        });
        render();
        return;
      }
      dispatch({ type: 'stateChanged', previous });
      render();
    },
    setLayouts(next) {
      parts.setLayouts(next);
      drawBoardPane();
      drawnStatusKey = null;
      drawnColumnsKey = null;
      render();
    },
    showSample(state) {
      const hold = deps.holdPlace();
      const viewBefore = store.get();
      const previous = shownWork();
      sample = state;
      dispatch({ type: 'reset', state: initialBoardState });
      dispatch({ type: 'stateChanged', previous });
      render();
      let isEnded = false;
      return {
        dispose() {
          if (isEnded) {
            return;
          }
          isEnded = true;
          sample = null;
          dispatch({ type: 'reset', state: viewBefore });
          render(true);
          hold.dispose();
        },
      };
    },
    dispose() {
      isDisposed = true;
      if (statusTimer !== null) {
        deps.timers.clear(statusTimer);
        statusTimer = null;
      }
      clearFlashTimer();
      const draws = [...statusDraws, ...cardDraws, ...columnDraws];
      statusDraws = [];
      cardDraws = [];
      columnDraws = [];
      callEach<() => void>(
        [
          () => drag.dispose(),
          () => disposeDraws(draws),
          () => parts.dispose(),
        ],
        (step) => step(),
      );
    },
    commands,
    showTicket(key) {
      if (cardNamed(shownWork(), key) === null) {
        log(`no card ${key}`);
        deps.toast(`${key} is not on the Board`, 'info');
        return;
      }
      deps.showMode();
      clearFlashTimer();
      dispatch({ type: 'select', cardId: key });
      dispatch({ type: 'flash', cardId: key });
      log(`flash ${key}`);
      flashTimer = deps.timers.set(() => {
        flashTimer = null;
        dispatch({ type: 'flash', cardId: null });
      }, FLASH_MS);
      focusBoard();
    },
    selectCard(id) {
      if (cardNamed(shownWork(), id) === null) {
        log(`no card ${id}`);
        return;
      }
      dispatch({ type: 'select', cardId: id });
      focusBoard();
    },
    openThreads,
    moveCardTo,
    pressCard,
  };
}
