import type { Timers } from '../../../contracts/ambient';
import {
  CORE_OPEN_LINK,
  type CommandId,
  type CommandKey,
} from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { EditorHost, ScrollStep } from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type { FocusTarget, ResizeTarget } from '../../../contracts/panes';
import type {
  CommandsRunIn,
  PluginCommands,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { callEach } from '../../../shared/call-each';
import { scrollContent, scrollText } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import {
  createEditorBoxes,
  keepFocusedBox,
} from '../../../shared/page/editor-boxes';
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
import { createSplit } from '../../../shared/page/ui/split';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { qualify } from '../../../shared/plugin-manifests';
import {
  statusLine,
  type WorkCard,
  type WorkDetail,
  type WorkMoveArg,
  type WorkState,
  workCommentCommand,
  workMoveCardCommand,
  workSendCommand,
  workStartSessionCommand,
} from '../../work/contract';
import type { WorkBoardPlace } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  BoardLayout,
  CardInput,
  ColumnInput,
  CompleteBoardLayout,
  DetailInput,
} from '../layouts/layout';
import type { workBoardManifest } from '../manifest';
import {
  type BoardAction,
  type BoardCardAction,
  type BoardColumn,
  type BoardFocus,
  type BoardViewState,
  boardReducer,
  cardActions,
  cardNamed,
  cursorCard,
  draftText,
  initialBoardState,
  neighbourColumns,
  paneInputOf,
  shownColumns,
  suggestionOf,
  threadCount,
} from './board-state';
import { createBoardKit } from './layout/board-kit';

const PLUGIN_ID = 'work-board';
const STATUS_REDRAW_MS = 60_000;
const FLASH_MS = 1500;
const BOX_FORM = 'work-board-box';
const PLACEHOLDERS = {
  comment: 'Write a comment…',
  reply: 'Write a reply…',
} as const;

// The detail pane's split: the end pane holds the width.
const PANE_SPLIT = { initial: 420, min: 320, endMin: 480 } as const;

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
  lastSweepAt: null,
  problem: null,
};

type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

// Whether `reason` is the command router's refusal of command `id` that no started plugin declares or handles.
function isCommandMissing(id: CommandId, reason: string): boolean {
  return (
    reason === `Unknown command ${id}` || reason === `${id} has no handler`
  );
}

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
  // What a layout's kit draws with; its `keys` also anchors the box's hints and the split's prompt.
  kitServices: OwnerKitServices;
  // The detail pane's comment or reply box.
  editor: EditorHost;
  // Where the split keeps the detail pane's width.
  uiState: UiState;
  timers: Pick<Timers, 'set' | 'clear'>;
  // Epoch milliseconds, for the status line's and the detail pane's ages.
  now(): number;
  setScope(scope: BoardFocus): void;
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

// Board mode's view: the head and the columns of cards in the sheet's split, and the cursor card's detail pane beside
// them, logging under `work-board`. What shows lives in `boardReducer`; the view draws its state over the work
// `stateChanged` and the details `detailsChanged` hand it, through the layout picked for each part, with `default`
// until the first `setLayouts`. Every work command runs through one reporting run, which logs and toasts a refusal.
// The view never moves a card itself: it redraws from the slot.
export interface BoardView {
  sheet: HTMLElement;
  shown(): void;
  hidden(): void;
  focusMain(): void;
  stateChanged(value: WorkState | undefined): void;
  // `work.details` changed: every stored record by id.
  detailsChanged(details: ReadonlyMap<string, WorkDetail>): void;
  setLayouts(shown: ShownLayouts<BoardLayout>): void;
  // Draws `state` and `details` in place of `work.state` and `work.details` until the returned dispose, holding the
  // place meanwhile.
  showSample(state: WorkState, details: readonly WorkDetail[]): Disposable;
  // Opens the detail pane.
  openPane(): void;
  dispose(): void;
  commands: Record<BoardCommand, () => void>;
  // Shows the mode with the cursor on card `key`, scrolled into view and flashed, the board focused.
  showTicket(key: string): void;
  // Puts the cursor on card `id`, the board focused, unless that card's own box holds the focus, which keeps it.
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
  // The records `work.details` last held, and the demo sample's drawn in their place.
  let realDetails: ReadonlyMap<string, WorkDetail> = new Map();
  let sampleDetails: ReadonlyMap<string, WorkDetail> | null = null;
  const shownDetails = () => sampleDetails ?? realDetails;
  // Whether the first state has landed, which puts back the saved place; no place is written before it.
  let isPlaceRestored = false;
  let isDisposed = false;
  // Set while the detail pane redraws, when a released box's blur is the redraw's own.
  let isRedrawingPane = false;

  // ── Layouts ────────────────────────────────────────────────────────────
  const parts = createLayoutParts<BoardLayout, CompleteBoardLayout>({
    owner: PLUGIN_ID,
    defaultLayout,
    log,
  });
  const kitFor = (rollback: RollbackDeps) =>
    createBoardKit(deps.kitServices, rollback);

  // One box per card, holding its comment or reply.
  const boxes = createEditorBoxes<string>(
    deps.editor,
    {
      changed: (cardId, text) =>
        dispatch({ type: 'draftEdited', cardId, text }),
      activated() {
        if (store.get().focus !== 'box') {
          changeFocus('box', false);
        }
      },
    },
    log,
    {
      formIdOf: () => BOX_FORM,
      keyOf: (cardId) => cardId,
      describe: (cardId) => `box of ${cardId}`,
    },
  );
  // A box left by a click elsewhere gives the keys back to the board.
  boxes.onChange(() => {
    const isBoxLeft =
      !isRedrawingPane &&
      boxes.active() === null &&
      store.get().focus === 'box';
    if (isBoxLeft) {
      returnToBoard();
    }
  });

  // ── Elements ───────────────────────────────────────────────────────────
  // The containers stay app-owned; the board pane draws inside them and places the slots below, and the detail part
  // draws into the split's end pane.
  const boardPane = element('div', 'work-board');
  boardPane.tabIndex = -1;
  const detailPane = element('div', 'work-board-detail');
  const split = createSplit({
    ...PANE_SPLIT,
    sizedPane: 'end',
    stateKey: 'pane-width',
    uiState: deps.uiState,
    anchor: deps.kitServices.keys.anchor,
    timers: deps.timers,
  });
  split.element.classList.add('work-board-split');
  split.start.append(boardPane);
  split.end.append(detailPane);
  split.setEndHidden(true);
  const contentSheet = sheet();
  contentSheet.classList.add('work-board-sheet');
  contentSheet.append(split.element);
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
  // Scrolls the columns until the cursor card shows whole.
  const revealCursorCard = () => {
    columnsSlot
      .querySelector('.is-cursor')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  // The board pane's width at the last observation, null before the first.
  let boardPaneWidth: number | null = null;
  // The board pane narrows as the detail pane opens, its divider moves or the window narrows, which can leave the
  // cursor card behind the detail pane; a widen or a height change leaves the columns where the user scrolled them.
  const boardPaneSize = new ResizeObserver((entries) => {
    const entry = entries.at(-1);
    if (entry === undefined) {
      return;
    }
    const { width } = entry.contentRect;
    const isNarrowed = boardPaneWidth !== null && width < boardPaneWidth;
    boardPaneWidth = width;
    if (isNarrowed) {
      revealCursorCard();
    }
  });
  boardPaneSize.observe(boardPane);
  let statusDraws: DrawnRoot[] = [];
  let columnDraws: DrawnRoot[] = [];
  let cardDraws: DrawnRoot[] = [];
  let detailDraw: DrawnRoot | null = null;
  // What each part was drawn from; null to draw again.
  let drawnStatusKey: string | null = null;
  let drawnColumnsKey: string | null = null;
  let drawnDetailKey: string | null = null;
  // The card the detail pane last drew, null for none.
  let drawnDetailCard: string | null = null;
  // The scope and pane the targets were last set for, null to set them again.
  let shownScope: BoardFocus | null = null;
  let shownPaneOpen: boolean | null = null;
  // Where the DOM focus was last moved to.
  let shownFocus: BoardFocus = 'board';
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
    const line = statusLine(work, deps.now());
    const key = JSON.stringify([line, work.problem]);
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
    const { problem } = work;
    if (problem !== null) {
      statusDraws.push(
        parts.draw('problem', statusSlot, (problemPart, into, rollback) => ({
          element: requireElementIn(
            into,
            problemPart(into, { text: problem }, kitFor(rollback)),
            'problem',
          ),
        })),
      );
    }
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
      isPosting: isJira && card.commenting.length > 0,
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
    revealCursorCard();
  };

  // A detail kit's `box`: the card's comment or reply box with its key hints, or the reply being sent read-only;
  // released with the draw.
  const boxSlot = (
    input: DetailInput,
    text: string,
    rollback: RollbackDeps,
  ) => {
    let isPlaced = false;
    const place = (parent: HTMLElement): HTMLElement => {
      const { box } = input;
      if (box === null) {
        throw new Error('no box');
      }
      if (isPlaced) {
        throw new Error('box placed twice');
      }
      isPlaced = true;
      const area = element('div', 'work-board-box');
      parent.append(area);
      rollback.recordBox(() => area.remove());
      const isSending = box.sending !== null;
      if (box.sending !== null) {
        area.append(
          element(
            'div',
            'ui-input work-board-box-text is-read-only',
            box.sending,
          ),
          element('p', 'work-board-box-sending', 'Sending…'),
        );
      } else {
        boxes.place(area, input.id, text);
        rollback.recordBox(() => boxes.release(input.id));
        // The editor host has no placeholder: this line shows while the box is empty.
        area.append(
          element('span', 'work-board-box-placeholder', PLACEHOLDERS[box.kind]),
        );
      }
      const hints = element('span', 'work-board-box-hints');
      area.append(hints);
      const anchor = (
        command: BoardCommand,
        scope: BoardFocus,
        label: string,
      ) => {
        const hint = element('span', 'work-board-box-hint');
        hints.append(hint);
        rollback.recordAnchor(
          deps.kitServices.keys.anchor(hint, qualify(PLUGIN_ID, command), {
            scope: qualify(PLUGIN_ID, scope),
            label,
          }),
        );
      };
      if (!isSending) {
        anchor('enterBox', 'board', box.kind);
      }
      anchor('send', 'box', 'send');
      return area;
    };
    return { place, isPlaced: () => isPlaced };
  };

  const drawDetailPart = (input: DetailInput, text: string): DrawnRoot =>
    parts.draw('detail', detailPane, (detail, into, rollback) => {
      const box = boxSlot(input, text, rollback);
      const root = requireElementIn(
        into,
        detail(into, input, { ...kitFor(rollback), box: box.place }),
        'detail',
      );
      if (input.box !== null && !box.isPlaced()) {
        box.place(root);
      }
      return { element: root };
    });

  const drawDetailEmpty = (): DrawnRoot =>
    parts.draw('detailEmpty', detailPane, (empty, into, rollback) => ({
      element: requireElementIn(
        into,
        empty(into, kitFor(rollback)),
        'detailEmpty',
      ),
    }));

  // Whether the user is in the detail pane: its box holds the focus, or a text selection lies in it.
  const isUserInPane = (): boolean => {
    if (boxes.active() !== null) {
      return true;
    }
    const selection = window.getSelection();
    return (
      selection !== null &&
      !selection.isCollapsed &&
      (detailPane.contains(selection.anchorNode) ||
        detailPane.contains(selection.focusNode))
    );
  };

  // The time the detail pane's ages read. It holds while the user is in the pane, so only a change of what the pane
  // shows redraws it, never an age moving: a redraw re-places the box and drops the selection.
  let paneNow = deps.now();

  // Draws the detail pane while it is open: the cursor card's detail, or the empty part with none. A redraw for the card
  // last drawn keeps the pane's scroll; one for another card scrolls it to the top. True when the redraw dropped the
  // focused box without placing it again.
  const drawDetail = (state: BoardViewState, work: WorkState): boolean => {
    split.setEndHidden(!state.paneOpen);
    if (!isUserInPane()) {
      paneNow = deps.now();
    }
    const card = state.paneOpen ? cursorCard(state, work) : null;
    const input =
      card === null ? null : paneInputOf(card, work, shownDetails(), paneNow);
    let isBoxDropped = false;
    // The box's own text is left out, so typing never redraws the pane.
    const key = JSON.stringify([state.paneOpen, input]);
    if (key !== drawnDetailKey) {
      drawnDetailKey = key;
      const wasBoxFocused = boxes.active() !== null;
      const scrollTop = detailPane.scrollTop;
      isRedrawingPane = true;
      try {
        keepFocusedBox(boxes, BOX_FORM, () => {
          const held = detailDraw;
          detailDraw = null;
          held?.dispose();
          detailPane.replaceChildren();
          if (!state.paneOpen) {
            return;
          }
          detailDraw =
            card === null || input === null
              ? drawDetailEmpty()
              : drawDetailPart(input, draftText(card, state));
        });
      } finally {
        isRedrawingPane = false;
      }
      isBoxDropped = wasBoxFocused && boxes.active() === null;
      const shownCard = card?.id ?? null;
      const isSameCard = shownCard === drawnDetailCard;
      drawnDetailCard = shownCard;
      detailPane.scrollTop = isSameCard ? scrollTop : 0;
    }
    const box = input?.box ?? null;
    const hasEditableBox = box !== null && box.sending === null;
    if (card !== null && hasEditableBox) {
      const text = draftText(card, state);
      boxes.setText(card.id, text);
      detailPane
        .querySelector('.work-board-box')
        ?.classList.toggle('is-empty', text === '');
    }
    return isBoxDropped;
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
    deps.placeChanged({
      cursorCardId: state.cursorCardId,
      paneOpen: state.paneOpen,
      drafts: state.drafts,
    });
  };

  // Puts back the saved place once the first state lands, or the first card with none; true when it did.
  const restoreFirstPlace = (): boolean => {
    if (isPlaceRestored || realWork === undefined) {
      return false;
    }
    isPlaceRestored = true;
    dispatch({ type: 'restore', place: deps.savedPlace });
    return true;
  };

  // Sets the scope and the targets when the focus or whether the pane shows changed, or `always`: the split resizes
  // while the pane shows, and the DOM focus stays on the cards.
  const syncTargets = (state: BoardViewState, always: boolean) => {
    const isChanged =
      state.focus !== shownScope || state.paneOpen !== shownPaneOpen;
    if (!deps.isShown() || (!always && !isChanged)) {
      return;
    }
    shownScope = state.focus;
    shownPaneOpen = state.paneOpen;
    deps.setScope(state.focus);
    deps.setResizeTarget(state.paneOpen ? split : null);
    deps.setFocusTarget(null);
  };

  // Moves the DOM focus to where the keys act, when that changed or `always`: the board pane, or the cursor card's box.
  const syncFocus = (state: BoardViewState, always: boolean) => {
    if (!deps.isShown() || (!always && state.focus === shownFocus)) {
      return;
    }
    shownFocus = state.focus;
    if (state.focus === 'board') {
      boardPane.focus();
      return;
    }
    const { cursorCardId } = state;
    if (
      cursorCardId !== null &&
      boxes.isPlaced(cursorCardId) &&
      boxes.active() !== cursorCardId
    ) {
      boxes.focus(cursorCardId, { insertAtEnd: true });
    }
  };

  const render = (always = false) => {
    const state = store.get();
    const work = shownWork();
    drawStatus(work);
    drawColumns(state, work);
    if (drawDetail(state, work) && state.focus === 'box') {
      // The keys go back to the board, which renders again through the store.
      changeFocus('board', true);
      return;
    }
    noteChanges(state);
    writePlace(state);
    syncTargets(state, always);
    syncFocus(state, false);
  };

  drawBoardPane();
  store.subscribe(() => render());

  // The status line's and the detail pane's ages, again once a minute; the pane's hold while the user is in it
  // (`paneNow`).
  let statusTimer: number | null = null;
  const redrawStatus = () => {
    const state = store.get();
    const work = shownWork();
    drawStatus(work);
    if (drawDetail(state, work) && state.focus === 'box') {
      changeFocus('board', true);
    }
    statusTimer = deps.timers.set(redrawStatus, STATUS_REDRAW_MS);
  };
  statusTimer = deps.timers.set(redrawStatus, STATUS_REDRAW_MS);

  // Sets the focus; `movesFocus` moves the DOM focus to it too, else the DOM focus is already there.
  const changeFocus = (focus: BoardFocus, movesFocus: boolean) => {
    if (!movesFocus) {
      shownFocus = focus;
    }
    const isChanged = store.get().focus !== focus;
    dispatch({ type: 'focus', focus });
    // A change renders through the store; focus already there may still have lost the DOM focus.
    if (!isChanged && movesFocus) {
      syncFocus(store.get(), true);
    }
  };

  // Whether the DOM focus sits outside the sheet, as a click into another pane's box leaves it.
  const isFocusElsewhere = () => {
    const active = document.activeElement;
    return (
      active !== null &&
      active !== document.body &&
      !contentSheet.contains(active)
    );
  };

  // The box was left: the keys and the DOM focus go back to the board pane, unless a click took the focus elsewhere.
  const returnToBoard = () => {
    changeFocus('board', false);
    if (deps.isShown() && !isFocusElsewhere()) {
      boardPane.focus();
    }
    log('board focused');
  };

  // The flash's end, while one shows.
  let flashTimer: number | null = null;
  const clearFlashTimer = () => {
    if (flashTimer !== null) {
      deps.timers.clear(flashTimer);
      flashTimer = null;
    }
  };

  // The keys and the DOM focus on the board pane, leaving any focused box.
  const focusBoard = () => {
    shownFocus = 'board';
    dispatch({ type: 'focus', focus: 'board' });
    boxes.leave();
    render(true);
    if (deps.isShown()) {
      boardPane.focus();
    }
  };

  // ── Work commands ────────────────────────────────────────────────────────
  // Runs another plugin's command as a reporting run; a refusal logs `<id> failed: <reason>` and toasts the reason in
  // the error tone, or `offText` when no started plugin has the command. Never rejects: resolves true once the run
  // succeeds, false on a refusal.
  const runWork = (
    id: CommandId,
    arg?: unknown,
    offText?: string,
  ): Promise<boolean> =>
    deps.runFor(id, arg, {}).then(
      () => true,
      (error: unknown) => {
        if (isDisposed) {
          return false;
        }
        const reason = errorText(error);
        log(`${id} failed: ${reason}`);
        const isOff = offText !== undefined && isCommandMissing(id, reason);
        deps.toast(isOff ? offText : reason, 'error');
        return false;
      },
    );

  const moveCardTo = (arg: WorkMoveArg) => {
    void runWork(workMoveCardCommand.id, arg);
  };

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
    void runWork(WORK_COMMANDS[action], arg);
  };

  const openThreads = (key: string) => {
    void runWork(INBOX_FILTER_TICKET, key, INBOX_OFF);
  };

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

  // The cursor card's pane input, with its box; null, logging `no box for <id>`, when it has no box to type in.
  const editableBoxOf = (card: WorkCard): DetailInput | null => {
    const input = paneInputOf(card, shownWork(), shownDetails(), deps.now());
    if (input.box === null || input.box.sending !== null) {
      log(`no box for ${card.id}`);
      return null;
    }
    return input;
  };

  const enterBox = onCursor((card) => {
    if (editableBoxOf(card) === null) {
      return;
    }
    dispatch({ type: 'pane', open: true });
    changeFocus('box', true);
  });

  // Sends the cursor card's box text: a Jira card's as a comment, a local task's as a reply in its thread. The box is
  // left at once; the text leaves the place only once main takes it, so a refusal loses nothing.
  const send = onCursor((card) => {
    if (editableBoxOf(card) === null) {
      return;
    }
    const text = draftText(card, store.get());
    if (text.trim() === '') {
      deps.toast('Nothing to send', 'info');
      return;
    }
    boxes.leave();
    if (store.get().focus === 'box') {
      returnToBoard();
    }
    const run =
      card.kind === 'jira'
        ? runWork(workCommentCommand.id, { cardId: card.id, text })
        : runWork(workSendCommand.id, { itemId: card.sourceItemId, text });
    void run.then((isSent) => {
      if (isSent && !isDisposed) {
        dispatch({ type: 'draftDropped', cardId: card.id });
      }
    });
  });

  const leaveBox = () => {
    boxes.leave();
    if (store.get().focus === 'box') {
      returnToBoard();
    }
  };

  const togglePane = () => {
    const open = !store.get().paneOpen;
    dispatch({ type: 'pane', open });
    log(open ? 'pane open' : 'pane closed');
  };

  // Scrolls the detail pane by `step`; logs `no pane` while it is closed.
  const scrollPane = (step: ScrollStep, direction: 1 | -1) => () => {
    if (!store.get().paneOpen) {
      log('no pane');
      return;
    }
    const scroll = scrollContent(
      detailPane,
      step,
      direction,
      textLineHeightPx(detailPane),
    );
    log(scrollText('the detail', step, direction, scroll));
  };

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
    sweep: () => void runWork('work.sweep'),
    showJobRow: () => void runWork('work.openJobRow'),
    togglePane,
    lineDown: scrollPane('line', 1),
    lineUp: scrollPane('line', -1),
    halfPageDown: scrollPane('halfPage', 1),
    halfPageUp: scrollPane('halfPage', -1),
    enterBox,
    send,
    leaveBox,
  };

  return {
    sheet: contentSheet,
    shown() {
      log('shown');
      shownScope = null;
      render(true);
    },
    hidden() {
      shownScope = null;
      boxes.leave();
    },
    focusMain: () => focusBoard(),
    stateChanged(value) {
      const previous = shownWork();
      realWork = value;
      if (sample !== null) {
        return;
      }
      if (!restoreFirstPlace()) {
        dispatch({ type: 'stateChanged', previous });
      }
      render();
    },
    detailsChanged(details) {
      realDetails = details;
      if (sample === null) {
        render();
      }
    },
    setLayouts(next) {
      parts.setLayouts(next);
      drawBoardPane();
      drawnStatusKey = null;
      drawnColumnsKey = null;
      drawnDetailKey = null;
      render();
    },
    showSample(state, details) {
      const hold = deps.holdPlace();
      const viewBefore = store.get();
      const previous = shownWork();
      sample = state;
      sampleDetails = new Map(details.map((detail) => [detail.id, detail]));
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
          sampleDetails = null;
          // A box the sample drew is gone, so the keys come back on the board.
          dispatch({ type: 'reset', state: { ...viewBefore, focus: 'board' } });
          // The real work may have changed, or first landed, while the sample showed.
          if (!restoreFirstPlace()) {
            dispatch({ type: 'stateChanged', previous });
          }
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
      const draws = [
        ...statusDraws,
        ...cardDraws,
        ...columnDraws,
        ...(detailDraw === null ? [] : [detailDraw]),
      ];
      statusDraws = [];
      cardDraws = [];
      columnDraws = [];
      detailDraw = null;
      callEach<() => void>(
        [
          () => boardPaneSize.disconnect(),
          () => drag.dispose(),
          () => disposeDraws(draws),
          () => boxes.destroyForm(BOX_FORM),
          () => split.dispose(),
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
      const isInItsBox = store.get().focus === 'box' && boxes.active() === id;
      if (!isInItsBox) {
        focusBoard();
      }
    },
    openPane: () => dispatch({ type: 'pane', open: true }),
    openThreads,
    moveCardTo,
    pressCard,
  };
}
