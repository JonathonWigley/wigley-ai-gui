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
  ModeContext,
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
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import { createSplit } from '../../../shared/page/ui/split';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { qualify } from '../../../shared/plugin-manifests';
import {
  statusLine,
  type ThreadDetail,
  type WorkItem,
  type WorkState,
  workSendCommand,
  workStartSessionCommand,
} from '../../work/contract';
import type { WorkInboxPlace } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  CardInput,
  CompleteInboxLayout,
  DetailInput,
  InboxLayout,
} from '../layouts/layout';
import type { workInboxManifest } from '../manifest';
import {
  cardActions,
  cardInput,
  cursorItem,
  detailInput,
  draftText,
  emptyReason,
  type InboxAction,
  type InboxCardAction,
  type InboxFocus,
  type InboxSectionId,
  type InboxViewState,
  INBOX_SECTIONS,
  inboxReducer,
  initialInboxState,
  listTitle,
  type Move,
  SECTION_TITLES,
  sectionCounts,
  shownItems,
} from './inbox-state';
import { createInboxKit } from './layout/inbox-kit';

const PLUGIN_ID = 'work-inbox';
const TITLE = 'Inbox';
const DRAFT_FORM = 'work-inbox-draft';
const STATUS_REDRAW_MS = 60_000;
const PLACEHOLDER = 'Write a reply…';
// Where the split keeps the detail pane's width, in this plugin's own uiState.
const PANE_WIDTH_KEY = 'pane-width';
// The detail pane's split, as the Board's: the end pane holds the width.
const PANE_SPLIT = { initial: 420, min: 320, endMin: 480 } as const;

// Run across plugins by id: work-board's page part declares it, and it may be switched off.
const BOARD_SHOW_TICKET: CommandId = 'work-board.showTicket';
const BOARD_OFF = 'Board is off: switch on work-board in Settings';

// The clicks on a section row and on a card.
const selectSectionCommand: CommandKey<string, 'work-inbox.selectSection'> = {
  id: 'work-inbox.selectSection',
};
const selectItemCommand: CommandKey<string, 'work-inbox.selectItem'> = {
  id: 'work-inbox.selectItem',
};

// The work command each card action but Send runs, with the item id (Start session with a `WorkStartArg`).
const WORK_COMMANDS: Record<Exclude<InboxCardAction, 'send'>, CommandId> = {
  dismiss: 'work.dismiss',
  restore: 'work.restore',
  snooze: 'work.snooze',
  addToBoard: 'work.addToBoard',
  startSession: workStartSessionCommand.id,
};

const EMPTY_WORK: WorkState = {
  items: [],
  cards: [],
  suggestions: [],
  columns: [],
  job: { running: null, last: null },
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
export type InboxCommand = Exclude<
  CommandsRunIn<typeof workInboxManifest, 'page'>,
  | 'showMode'
  | 'filterTicket'
  | 'selectItem'
  | 'selectSection'
  | 'sendItem'
  | 'openTicket'
  | 'dismissItem'
  | 'restoreItem'
  | 'snoozeItem'
  | 'addItemToBoard'
  | 'startItemSession'
>;

export interface InboxViewDeps {
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  // What a layout's kit draws with; its `keys` also anchors the draft box's hints and the split's prompt.
  kitServices: OwnerKitServices;
  // The draft's vim box.
  editor: EditorHost;
  // Where the split keeps the detail pane's width.
  uiState: UiState;
  timers: Timers;
  // Epoch milliseconds, for the status line's, the cards' and the detail pane's ages.
  now(): number;
  // Item `id`'s stored thread detail; null for none.
  detailOf(id: string): ThreadDetail | null;
  setScope(scope: InboxFocus): void;
  setFocusTarget(target: FocusTarget | null): void;
  setResizeTarget(target: ResizeTarget | null): void;
  isShown(): boolean;
  // Shows Inbox mode when it is hidden.
  showMode(): void;
  // Tells the core the user picked a section in the side bar, which closes its overlay in a narrow window.
  picked(): void;
  setContext(context: ModeContext | null): void;
  // Runs the command `key` with `arg`, as a click does.
  runKey<A>(key: CommandKey<A>, arg: A): void;
  // A reporting run (`api.commands.runFor`): rejects with the handler's failure.
  runFor: PluginCommands['runFor'];
  // The last page's place, put back once the first state lands; null for none.
  savedPlace: WorkInboxPlace | null;
  placeChanged(place: WorkInboxPlace): void;
  // Stops place writes until its dispose.
  holdPlace(): Disposable;
}

// Inbox mode's view: the section nav for the side bar, and the head and cards in the sheet's split with the cursor
// item's detail pane beside them, logging under `work-inbox`. What shows lives in `inboxReducer`; the view draws its
// state over the work `stateChanged` hands it and the details `detailOf` reads, through the layout picked for each
// part, with `default` until the first `setLayouts`. Every work command runs through one reporting run, which logs and
// toasts a refusal.
export interface InboxView {
  sideBar: HTMLElement;
  sheet: HTMLElement;
  shown(): void;
  hidden(): void;
  focusMain(): void;
  focusSideBar(): void;
  // The side bar was hidden: focus leaves it for the list.
  sideBarHidden(): void;
  // The side bar opened over main: focus moves to it.
  sideBarOpenedOver(): void;
  stateChanged(value: WorkState | undefined): void;
  // `work.details` changed for item `id`: the open pane draws again when it shows that item.
  detailChanged(id: string): void;
  setLayouts(shown: ShownLayouts<InboxLayout>): void;
  // Draws `state` and `details` in place of `work.state` and `work.details` until the returned dispose, holding the
  // place meanwhile; the sample starts with the pane closed, and the dispose puts back the pane as it was.
  showSample(state: WorkState, details: readonly ThreadDetail[]): Disposable;
  // Opens the detail pane; does nothing while it is open.
  openPane(): void;
  dispose(): void;
  commands: Record<InboxCommand, () => void>;
  // Shows the mode with the open threads holding `key`, the list focused.
  filterTicket(key: string): void;
  // Shows the mode with the cursor on item `id`, the list focused; switches to All first when the list lacks it.
  selectItem(id: string): void;
  // Shows section `id`, the list focused.
  selectSection(id: string): void;
  // Sends item `id`'s draft: the user's edit, else the worker's.
  sendItem(id: string): void;
  // Shows ticket `key` on the Board.
  openTicket(key: string): void;
  // Runs card action `action` on item `id`, when its card offers it.
  pressItem(action: InboxCardAction, id: string): void;
}

// What a click on a card acts on by itself, so it does not select the card.
const CARD_CONTROLS = 'a, button, input, textarea';

export function createInboxView(deps: InboxViewDeps): InboxView {
  const { log } = deps;
  const store = createReducerStore(initialInboxState(), inboxReducer);
  const dispatch = (action: InboxAction) => store.dispatch(action);

  // The work `work.state` last held, and the demo sample drawn in its place.
  let realWork: WorkState | undefined;
  let sample: WorkState | null = null;
  const shownWork = (): WorkState => sample ?? realWork ?? EMPTY_WORK;
  // The demo sample's thread details by item id, read in place of `detailOf` while the sample shows.
  let sampleDetails: ReadonlyMap<string, ThreadDetail> | null = null;
  const shownDetail = (id: string): ThreadDetail | null =>
    sampleDetails === null
      ? deps.detailOf(id)
      : (sampleDetails.get(id) ?? null);
  // Whether the first state has landed, which puts back the saved place; no place is written before it.
  let isPlaceRestored = false;
  let isDisposed = false;
  // Set while the cards or the detail pane redraw, when a released box's blur is the redraw's own.
  let isRedrawing = false;

  // ── Layouts ────────────────────────────────────────────────────────────
  const parts = createLayoutParts<InboxLayout, CompleteInboxLayout>({
    owner: PLUGIN_ID,
    defaultLayout,
    log,
  });
  const kitFor = (scope: InboxFocus, rollback: RollbackDeps) =>
    createInboxKit(deps.kitServices, scope, rollback);

  const boxes = createEditorBoxes<string>(
    deps.editor,
    {
      changed: (id, text) => dispatch({ type: 'draftEdited', id, text }),
      activated() {
        if (store.get().focus !== 'box') {
          changeFocus('box', false);
        }
      },
    },
    log,
    {
      formIdOf: () => DRAFT_FORM,
      keyOf: (id) => id,
      describe: (id) => `draft of ${id}`,
    },
  );
  // A box left by a click elsewhere gives the keys back to the list.
  boxes.onChange(() => {
    const isBoxLeft =
      !isRedrawing && boxes.active() === null && store.get().focus === 'box';
    if (isBoxLeft) {
      changeFocus('list', false);
    }
  });

  // ── Elements ───────────────────────────────────────────────────────────
  // The containers stay app-owned; the panes draw inside them and place the slots below, and the detail part draws
  // into the split's end pane, which the keys never focus.
  const sidePane = element('div', 'work-inbox-side');
  sidePane.tabIndex = -1;
  const sectionsList = element('ol', 'work-inbox-sections');
  const mainPane = element('div', 'work-inbox-main');
  mainPane.tabIndex = -1;
  const detailPane = element('div', 'work-inbox-detail');
  const split = createSplit({
    ...PANE_SPLIT,
    sizedPane: 'end',
    stateKey: PANE_WIDTH_KEY,
    uiState: deps.uiState,
    anchor: deps.kitServices.keys.anchor,
    timers: deps.timers,
  });
  split.element.classList.add('work-inbox-split');
  split.start.append(mainPane);
  split.end.append(detailPane);
  split.setEndHidden(true);
  const contentSheet = sheet();
  contentSheet.classList.add('work-inbox-sheet');
  contentSheet.append(split.element);
  const statusSlot = element('div', 'work-inbox-status-slot');
  const filterSlot = element('div', 'work-inbox-filter-slot');
  const cardsList = element('ol', 'work-inbox-cards');

  // ── Drawing ────────────────────────────────────────────────────────────
  let sectionDraws: DrawnRoot[] = [];
  let statusDraws: DrawnRoot[] = [];
  let filterDraw: DrawnRoot | null = null;
  let cardDraws: DrawnRoot[] = [];
  let detailDraw: DrawnRoot | null = null;
  // What each part was drawn from; null to draw again.
  let drawnSectionsKey: string | null = null;
  let drawnStatusKey: string | null = null;
  let drawnFilterKey: string | null = null;
  let drawnCardsKey: string | null = null;
  let drawnDetailKey: string | null = null;
  // The item the detail pane last drew, null for none.
  let drawnDetailItem: string | null = null;
  let shownFocus: InboxFocus | null = null;
  let shownScope: InboxFocus | null = null;
  let shownPaneOpen: boolean | null = null;
  let shownContext: string | null = null;
  // What was last logged while shown; undefined before the first.
  let loggedFilter: string | null | undefined;
  let loggedSection: InboxSectionId | undefined;
  let loggedCursor: string | null | undefined;
  let loggedSectionCursor: InboxSectionId | undefined;
  let loggedFocus: InboxFocus | undefined;

  const drawSidePane = () => {
    parts.redraw('sideBar', sidePane, (sideBar, into, rollback) => {
      const sections = appSlot(sectionsList, 'sections', rollback);
      const pane = sideBar(into, {
        ...kitFor('sections', rollback),
        sections: sections.place,
      });
      sections.placeIfLeftOut(requireElementIn(into, pane.element, 'sideBar'));
      return pane;
    });
  };

  const drawMainPane = () => {
    parts.redraw('main', mainPane, (main, into, rollback) => {
      const slots = [
        appSlot(statusSlot, 'status', rollback),
        appSlot(filterSlot, 'filter', rollback),
        appSlot(cardsList, 'cards', rollback),
      ] as const;
      const [status, filter, cards] = slots;
      const pane = main(into, {
        ...kitFor('list', rollback),
        status: status.place,
        filter: filter.place,
        cards: cards.place,
      });
      const root = requireElementIn(into, pane.element, 'main');
      for (const slot of slots) {
        slot.placeIfLeftOut(root);
      }
      return pane;
    });
  };

  const drawSections = (state: InboxViewState, work: WorkState) => {
    const counts = sectionCounts(work);
    const inputs = INBOX_SECTIONS.map((id) => ({
      id,
      title: SECTION_TITLES[id],
      count: counts[id],
      isHot: id === 'needs_you' && counts[id] > 0,
    }));
    const key = JSON.stringify(inputs);
    if (key !== drawnSectionsKey) {
      drawnSectionsKey = key;
      const held = sectionDraws;
      sectionDraws = [];
      disposeDraws(held);
      sectionsList.replaceChildren();
      for (const input of inputs) {
        const drawn = parts.draw(
          'sectionRow',
          sectionsList,
          (sectionRow, into, rollback) => ({
            element: requireElementIn(
              into,
              sectionRow(into, input, kitFor('sections', rollback)),
              'sectionRow',
            ),
          }),
        );
        rowAction(drawn.built.element, () =>
          deps.runKey(selectSectionCommand, input.id),
        );
        sectionDraws.push(drawn);
      }
    }
    INBOX_SECTIONS.forEach((id, index) => {
      const root = sectionDraws[index]?.built.element;
      root?.classList.toggle(
        'is-selected',
        state.ticketFilter === null && id === state.section,
      );
      root?.classList.toggle(
        'is-cursor',
        state.focus === 'sections' && id === state.sectionCursor,
      );
    });
  };

  const drawStatus = (work: WorkState) => {
    const line = statusLine(work.job, deps.now());
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
        element: status(into, line, kitFor('list', rollback)),
      })),
    );
    const { problem } = work;
    if (problem !== null) {
      statusDraws.push(
        parts.draw('problem', statusSlot, (problemPart, into, rollback) => ({
          element: problemPart(
            into,
            { text: problem },
            kitFor('list', rollback),
          ),
        })),
      );
    }
  };

  const drawFilter = (state: InboxViewState) => {
    const { ticketFilter } = state;
    if (ticketFilter === drawnFilterKey) {
      return;
    }
    drawnFilterKey = ticketFilter;
    filterDraw?.dispose();
    filterDraw = null;
    filterSlot.replaceChildren();
    if (ticketFilter !== null) {
      filterDraw = parts.draw(
        'filter',
        filterSlot,
        (filter, into, rollback) => ({
          element: filter(
            into,
            { ticketKey: ticketFilter },
            kitFor('list', rollback),
          ),
        }),
      );
    }
  };

  // The detail kit's `draftBox`: the cursor item's reply box, the vim box with the draft, or the sending text
  // read-only, with the box's key hints; released with the draw.
  const draftBoxSlot = (input: DetailInput, rollback: RollbackDeps) => {
    let isPlaced = false;
    const place = (parent: HTMLElement): HTMLElement => {
      if (input.draft === null) {
        throw new Error('no draft box');
      }
      if (isPlaced) {
        throw new Error('draftBox placed twice');
      }
      isPlaced = true;
      const area = element('div', 'work-inbox-draft');
      parent.append(area);
      rollback.recordBox(() => area.remove());
      if (input.isSending) {
        area.append(
          element(
            'div',
            'ui-input work-inbox-draft-text is-read-only',
            input.draft,
          ),
        );
      } else {
        boxes.place(area, input.id, input.draft);
        rollback.recordBox(() => boxes.release(input.id));
        // The editor host has no placeholder: this line shows while the box is empty.
        area.append(
          element('span', 'work-inbox-draft-placeholder', PLACEHOLDER),
        );
      }
      const hints = element('span', 'work-inbox-draft-hints');
      area.append(hints);
      const anchor = (
        command: InboxCommand,
        scope: InboxFocus,
        label: string,
      ) => {
        const hint = element('span', 'work-inbox-draft-hint');
        hints.append(hint);
        rollback.recordAnchor(
          deps.kitServices.keys.anchor(hint, qualify(PLUGIN_ID, command), {
            scope: qualify(PLUGIN_ID, scope),
            label,
          }),
        );
      };
      if (!input.isSending) {
        anchor('editDraft', 'list', 'edit');
      }
      anchor('send', 'box', 'send');
      return area;
    };
    return { place, isPlaced: () => isPlaced };
  };

  const drawCard = (input: CardInput): DrawnRoot => {
    const drawn = parts.draw('card', cardsList, (card, into, rollback) => ({
      element: requireElementIn(
        into,
        card(into, input, kitFor('list', rollback)),
        'card',
      ),
    }));
    drawn.built.element.addEventListener('click', (event) => {
      const isOnControl =
        (event.target as Element).closest(CARD_CONTROLS) !== null;
      if (!isOnControl) {
        deps.runKey(selectItemCommand, input.id);
      }
    });
    return drawn;
  };

  // Draws the cards; no card holds a box, so the redraw leaves the reply box alone.
  const drawCards = (state: InboxViewState, work: WorkState) => {
    const items = shownItems(work, state);
    const now = deps.now();
    const inputs = items.map((item) => cardInput(item, state, now));
    const key = JSON.stringify([
      inputs,
      items.length === 0 ? emptyReason(work, state) : null,
      listTitle(state),
    ]);
    if (key !== drawnCardsKey) {
      drawnCardsKey = key;
      isRedrawing = true;
      try {
        const held = cardDraws;
        cardDraws = [];
        disposeDraws(held);
        cardsList.replaceChildren();
        if (items.length === 0) {
          cardDraws.push(
            parts.draw('empty', cardsList, (empty, into, rollback) => ({
              element: empty(
                into,
                {
                  reason: emptyReason(work, state),
                  section: SECTION_TITLES[state.section],
                  ticketKey: state.ticketFilter,
                },
                kitFor('list', rollback),
              ),
            })),
          );
        } else {
          cardDraws = inputs.map(drawCard);
        }
      } finally {
        isRedrawing = false;
      }
    }
    inputs.forEach((input, index) => {
      const root = cardDraws[index]?.built.element;
      root?.classList.toggle('is-selected', input.isCursor);
      root?.classList.toggle(
        'is-cursor',
        input.isCursor && state.focus !== 'sections',
      );
      root?.classList.toggle('is-direct', input.isDirect);
    });
  };

  const drawDetailPart = (input: DetailInput): DrawnRoot =>
    parts.draw('detail', detailPane, (detail, into, rollback) => {
      const draftBox = draftBoxSlot(input, rollback);
      const root = requireElementIn(
        into,
        detail(into, input, {
          ...kitFor('list', rollback),
          draftBox: draftBox.place,
        }),
        'detail',
      );
      if (input.draft !== null && !draftBox.isPlaced()) {
        draftBox.place(root);
      }
      return { element: root };
    });

  const drawDetailEmpty = (): DrawnRoot =>
    parts.draw('detailEmpty', detailPane, (empty, into, rollback) => ({
      element: requireElementIn(
        into,
        empty(into, kitFor('list', rollback)),
        'detailEmpty',
      ),
    }));

  // Draws the detail pane while it is open: the cursor item's detail, or the empty part with none; while it is closed,
  // empties it. True when the redraw dropped the focused reply box without placing it again.
  const drawDetail = (state: InboxViewState, work: WorkState): boolean => {
    split.setEndHidden(!state.paneOpen);
    const item = state.paneOpen ? cursorItem(work, state) : null;
    const input =
      item === null
        ? null
        : detailInput(item, state, shownDetail(item.id), deps.now());
    // The box's own text is left out while it is editable, so typing never redraws the pane.
    const isEditable =
      input !== null && input.draft !== null && !input.isSending;
    const key = JSON.stringify([
      state.paneOpen,
      isEditable ? { ...input, draft: '' } : input,
    ]);
    let isBoxDropped = false;
    if (key !== drawnDetailKey) {
      drawnDetailKey = key;
      const wasBoxFocused = boxes.active() !== null;
      isRedrawing = true;
      try {
        keepFocusedBox(boxes, DRAFT_FORM, () => {
          const held = detailDraw;
          detailDraw = null;
          held?.dispose();
          detailPane.replaceChildren();
          if (!state.paneOpen) {
            return;
          }
          detailDraw =
            input === null ? drawDetailEmpty() : drawDetailPart(input);
        });
      } finally {
        isRedrawing = false;
      }
      isBoxDropped = wasBoxFocused && boxes.active() === null;
      const shownItem = item?.id ?? null;
      if (shownItem !== drawnDetailItem) {
        drawnDetailItem = shownItem;
        detailPane.scrollTop = 0;
      }
    }
    if (item !== null && isEditable) {
      const text = draftText(item, state);
      boxes.setText(item.id, text);
      detailPane
        .querySelector('.work-inbox-draft')
        ?.classList.toggle('is-empty', text === '');
    }
    return isBoxDropped;
  };

  // Logs each change of what the list shows, the cursor, the section cursor and the focus while the mode shows, and
  // gives the title bar the list's title.
  const noteChanges = (state: InboxViewState, work: WorkState) => {
    const title = listTitle(state);
    if (title !== shownContext) {
      shownContext = title;
      deps.setContext({ title: TITLE, detail: title });
    }
    if (!deps.isShown()) {
      return;
    }
    const { ticketFilter, section } = state;
    const isListChanged =
      ticketFilter !== loggedFilter ||
      (ticketFilter === null && section !== loggedSection);
    if (isListChanged) {
      if (ticketFilter !== null) {
        log(`filter ${ticketFilter}`);
      } else {
        if (loggedFilter !== undefined && loggedFilter !== null) {
          log('filter cleared');
        }
        log(`section ${SECTION_TITLES[section]}`);
      }
      loggedFilter = ticketFilter;
      loggedSection = section;
    }
    if (state.cursorId !== loggedCursor) {
      loggedCursor = state.cursorId;
      const item = cursorItem(work, state);
      if (item !== null) {
        log(`selected ${item.title}`);
      }
    }
    if (state.sectionCursor !== loggedSectionCursor) {
      if (loggedSectionCursor !== undefined) {
        log(`section cursor ${SECTION_TITLES[state.sectionCursor]}`);
      }
      loggedSectionCursor = state.sectionCursor;
    }
    if (state.focus !== loggedFocus) {
      loggedFocus = state.focus;
      log(`${state.focus} focused`);
    }
  };

  const writePlace = (state: InboxViewState) => {
    if (!isPlaceRestored || sample !== null) {
      return;
    }
    deps.placeChanged({
      section: state.section,
      ticketFilter: state.ticketFilter,
      cursorId: state.cursorId,
      drafts: state.drafts,
      paneOpen: state.paneOpen,
    });
  };

  // Puts back the saved place once the first state lands; true when it did, false too when none was saved.
  const restoreFirstPlace = (): boolean => {
    if (isPlaceRestored || realWork === undefined) {
      return false;
    }
    isPlaceRestored = true;
    if (deps.savedPlace === null) {
      return false;
    }
    dispatch({ type: 'placed', place: deps.savedPlace, work: realWork });
    return true;
  };

  // Sets the scope and the targets when the focus or whether the pane shows changed, or `always`: the split resizes
  // while the pane shows, and the DOM focus stays in the sections, the list or the box.
  const syncTargets = (state: InboxViewState, always: boolean) => {
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

  // Moves the DOM focus to where the keys act, when that changed or `always`; a focused box keeps it.
  const syncFocus = (state: InboxViewState, always: boolean) => {
    if (!deps.isShown() || (!always && state.focus === shownFocus)) {
      return;
    }
    shownFocus = state.focus;
    if (state.focus === 'sections') {
      sidePane.focus();
      return;
    }
    if (state.focus === 'list') {
      mainPane.focus();
      return;
    }
    const { cursorId } = state;
    if (
      cursorId !== null &&
      boxes.isPlaced(cursorId) &&
      boxes.active() !== cursorId
    ) {
      boxes.focus(cursorId, { insertAtEnd: true });
    }
  };

  const render = (always = false) => {
    const state = store.get();
    const work = shownWork();
    drawSections(state, work);
    drawStatus(work);
    drawFilter(state);
    drawCards(state, work);
    if (drawDetail(state, work) && state.focus === 'box') {
      // The keys go back to the list, which renders again through the store.
      changeFocus('list', true);
      return;
    }
    noteChanges(state, work);
    writePlace(state);
    syncTargets(state, always);
    syncFocus(state, always);
    cardsList
      .querySelector('.is-selected')
      ?.scrollIntoView({ block: 'nearest' });
  };

  drawSidePane();
  drawMainPane();
  store.subscribe(() => render());

  // The status line's and the detail pane's ages, again once a minute.
  let statusTimer: number | null = null;
  const redrawStatus = () => {
    const state = store.get();
    const work = shownWork();
    drawStatus(work);
    if (drawDetail(state, work) && state.focus === 'box') {
      changeFocus('list', true);
    }
    statusTimer = deps.timers.set(redrawStatus, STATUS_REDRAW_MS);
  };
  statusTimer = deps.timers.set(redrawStatus, STATUS_REDRAW_MS);

  // Sets the focus; `movesFocus` moves the DOM focus to it too, else the DOM focus is already there.
  const changeFocus = (focus: InboxFocus, movesFocus: boolean) => {
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
  const setFocus = (focus: InboxFocus) => changeFocus(focus, true);

  // A click into a pane hands it the keys.
  sidePane.addEventListener('focusin', () => {
    if (store.get().focus !== 'sections') {
      changeFocus('sections', false);
    }
  });
  mainPane.addEventListener('focusin', () => {
    if (store.get().focus === 'sections') {
      changeFocus('list', false);
    }
  });

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

  const itemNamed = (id: string): WorkItem | null =>
    shownWork().items.find((item) => item.id === id) ?? null;

  const sendItemOf = (item: WorkItem) => {
    const state = store.get();
    const isOffered =
      cardActions(item, state).includes('send') && item.sending === null;
    if (!isOffered) {
      log(`no send for ${item.id}`);
      return;
    }
    const text = draftText(item, state);
    if (text.trim() === '') {
      deps.toast('Nothing to send', 'info');
      return;
    }
    // The edit is kept until main takes the text, so a refused send loses nothing.
    void runWork(workSendCommand.id, { itemId: item.id, text }).then(
      (isSent) => {
        if (isSent && !isDisposed) {
          dispatch({ type: 'draftDropped', id: item.id });
        }
      },
    );
  };

  const pressItem = (action: InboxCardAction, id: string) => {
    const item = itemNamed(id);
    if (item === null || !cardActions(item, store.get()).includes(action)) {
      log(`no ${action} for ${id}`);
      return;
    }
    if (action === 'send') {
      sendItemOf(item);
      return;
    }
    const arg = action === 'startSession' ? { source: 'item', id } : id;
    void runWork(WORK_COMMANDS[action], arg);
  };

  const openTicket = (key: string) => {
    void runWork(BOARD_SHOW_TICKET, key, BOARD_OFF);
  };

  // Runs `act` on the cursor card; logs `no card` with none.
  const onCursor = (act: (item: WorkItem) => void) => () => {
    const item = cursorItem(shownWork(), store.get());
    if (item === null) {
      log('no card');
      return;
    }
    act(item);
  };

  // ── Commands ─────────────────────────────────────────────────────────────
  const listMove = (to: Move) => () =>
    dispatch({ type: 'move', to, work: shownWork() });
  const sectionMove = (to: Move) => () => dispatch({ type: 'sectionMove', to });

  const showSection = (section: InboxSectionId, movesFocus: boolean) => {
    dispatch({ type: 'showSection', section, work: shownWork() });
    deps.picked();
    if (movesFocus) {
      setFocus('list');
    }
  };

  // Opens the pane when it is closed, which places the reply box, then hands the box the keys.
  const editDraft = onCursor((item) => {
    if (item.state !== 'open' || item.sending !== null) {
      log(`no editDraft for ${item.id}`);
      return;
    }
    dispatch({ type: 'pane', open: true });
    setFocus('box');
  });

  const togglePane = () => {
    const open = !store.get().paneOpen;
    dispatch({ type: 'pane', open });
    log(open ? 'pane open' : 'pane closed');
  };

  // Scrolls the detail pane by `step`; logs `no pane` while it is closed. Focus stays where it is.
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

  const ticketOnBoard = onCursor((item) => {
    const [key] = item.ticketKeys;
    if (key === undefined) {
      log(`no ticketOnBoard for ${item.id}`);
      return;
    }
    openTicket(key);
  });

  const cursorPress = (action: InboxCardAction) =>
    onCursor((item) => pressItem(action, item.id));

  const commands: Record<InboxCommand, () => void> = {
    sectionDown: sectionMove('down'),
    sectionUp: sectionMove('up'),
    sectionTop: sectionMove('top'),
    sectionBottom: sectionMove('bottom'),
    openSection: () => showSection(store.get().sectionCursor, true),
    peekSection: () => showSection(store.get().sectionCursor, false),
    listDown: listMove('down'),
    listUp: listMove('up'),
    listTop: listMove('top'),
    listBottom: listMove('bottom'),
    openSlack: onCursor((item) => deps.runKey(CORE_OPEN_LINK, item.url)),
    editDraft,
    send: onCursor(sendItemOf),
    leaveBox() {
      boxes.leave();
      setFocus('list');
    },
    dismiss: cursorPress('dismiss'),
    snooze: cursorPress('snooze'),
    restore: cursorPress('restore'),
    addToBoard: cursorPress('addToBoard'),
    startSession: cursorPress('startSession'),
    ticketOnBoard,
    clearFilter() {
      if (store.get().ticketFilter === null) {
        log('no ticket filter');
        return;
      }
      dispatch({ type: 'clearFilter', work: shownWork() });
    },
    sweep: () => void runWork('work.sweep'),
    showJobRow: () => void runWork('work.openJobRow'),
    togglePane,
    paneLineDown: scrollPane('line', 1),
    paneLineUp: scrollPane('line', -1),
    paneHalfPageDown: scrollPane('halfPage', 1),
    paneHalfPageUp: scrollPane('halfPage', -1),
  };

  return {
    sideBar: sidePane,
    sheet: contentSheet,
    shown() {
      log('shown');
      render(true);
    },
    hidden() {
      boxes.leave();
    },
    focusMain: () => setFocus('list'),
    focusSideBar: () => setFocus('sections'),
    sideBarHidden() {
      if (store.get().focus === 'sections') {
        setFocus('list');
      }
    },
    sideBarOpenedOver: () => setFocus('sections'),
    stateChanged(value) {
      const before = shownWork();
      realWork = value;
      if (sample !== null) {
        return;
      }
      if (!restoreFirstPlace()) {
        dispatch({ type: 'workChanged', before, after: shownWork() });
      }
      render();
    },
    detailChanged(id) {
      if (sampleDetails !== null || id !== store.get().cursorId) {
        return;
      }
      drawnDetailKey = null;
      render();
    },
    setLayouts(next) {
      parts.setLayouts(next);
      drawSidePane();
      drawMainPane();
      drawnSectionsKey = null;
      drawnStatusKey = null;
      drawnFilterKey = null;
      drawnCardsKey = null;
      drawnDetailKey = null;
      // A focused box keeps its focus; focus the redraw dropped goes back to the pane holding the keys.
      const isFocusLost =
        document.activeElement === null ||
        document.activeElement === document.body;
      render(isFocusLost);
    },
    showSample(state, details) {
      const hold = deps.holdPlace();
      const before = shownWork();
      const viewBefore = store.get();
      sample = state;
      sampleDetails = new Map(details.map((detail) => [detail.id, detail]));
      dispatch({ type: 'pane', open: false });
      dispatch({ type: 'workChanged', before, after: state });
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
          dispatch({ type: 'reset', state: viewBefore });
          // The real work may have changed, or first landed, while the sample showed.
          if (!restoreFirstPlace()) {
            dispatch({ type: 'workChanged', before, after: shownWork() });
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
      const draws = [
        ...sectionDraws,
        ...statusDraws,
        ...cardDraws,
        ...(filterDraw === null ? [] : [filterDraw]),
        ...(detailDraw === null ? [] : [detailDraw]),
      ];
      sectionDraws = [];
      statusDraws = [];
      cardDraws = [];
      filterDraw = null;
      detailDraw = null;
      callEach<() => void>(
        [
          () => disposeDraws(draws),
          () => boxes.destroyForm(DRAFT_FORM),
          () => split.dispose(),
          () => parts.dispose(),
        ],
        (step) => step(),
      );
    },
    commands,
    filterTicket(key) {
      deps.showMode();
      dispatch({ type: 'filter', ticketKey: key, work: shownWork() });
      setFocus('list');
    },
    selectItem(id) {
      if (itemNamed(id) === null) {
        log(`no card ${id}`);
        return;
      }
      deps.showMode();
      dispatch({ type: 'select', id, work: shownWork() });
      const isInItsBox = store.get().focus === 'box' && boxes.active() === id;
      if (!isInItsBox) {
        setFocus('list');
      }
    },
    selectSection(id) {
      const section = INBOX_SECTIONS.find((each) => each === id);
      if (section === undefined) {
        log(`no section ${id}`);
        return;
      }
      showSection(section, true);
    },
    sendItem(id) {
      const item = itemNamed(id);
      if (item === null) {
        log(`no send for ${id}`);
        return;
      }
      sendItemOf(item);
    },
    openTicket,
    pressItem,
    openPane: () => dispatch({ type: 'pane', open: true }),
  };
}
