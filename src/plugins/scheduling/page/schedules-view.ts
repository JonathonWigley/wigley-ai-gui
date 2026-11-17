import type { CommandId, CommandKey } from '../../../contracts/commands';
import type { EditorHost, ScrollStep } from '../../../contracts/editor';
import type {
  DrawnPickerRow,
  DrawRowInput,
  ListPicker,
} from '../../../contracts/list-picker';
import type { PluginLog } from '../../../contracts/log';
import type { FocusTarget, ResizeTarget } from '../../../contracts/panes';
import type {
  CommandsRunIn,
  KeyHints,
  ModeContext,
  PageChannel,
  PushedScope,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import { scrollContent, scrollText } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { createConfirmPrompt } from '../../../shared/page/confirm-prompt';
import { element } from '../../../shared/page/dom';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  disposeDraws,
  type RollbackDeps,
  requireDialogFrame,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { listPickerCommands } from '../../../shared/page/list-picker';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import { qualify } from '../../../shared/plugin-manifests';
import type {
  EditorChoices,
  ScheduledTaskView,
  SchedulingChannel,
  SchedulingState,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  CompleteSchedulingLayout,
  SchedulingKit,
  SchedulingLayout,
} from '../layouts/layout';
import { schedulingManifest } from '../manifest';
import {
  confirmBody,
  cursorRunRow,
  DISCARD_TITLE,
  draftOf,
  type EditorRow,
  editorRows,
  emptyReason,
  emptySchedulingState,
  historyRowInput,
  initialSchedulesState,
  isEditorChanged,
  listRows,
  type Move,
  NEW_TASK_ROW_ARG,
  newTaskEditor,
  notices,
  REMOVE_TITLE,
  type SchedulesAction,
  type SchedulesFocus,
  type SchedulesState,
  schedulesReducer,
  selectedView,
  taskDetailInput,
  taskEditor,
  taskRowInput,
  UNSAVED_REASON,
} from './schedules-state';
import { createTaskEditor } from './task-editor';

const PLUGIN_ID = 'scheduling';
const TITLE = 'Schedules';

// The clicks: a list row's names its task id (`new` for the "+ New task" row), a linked history row's its run row.
const selectTaskCommand: CommandKey<string, 'scheduling.selectTask'> = {
  id: 'scheduling.selectTask',
};
const openRunRowCommand: CommandKey<string, 'scheduling.openRunRow'> = {
  id: 'scheduling.openRunRow',
};

type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

// Every page command but `showMode`, which the page part runs itself, and the clicks, which take an arg.
export type SchedulesCommand = Exclude<
  CommandsRunIn<typeof schedulingManifest, 'page'>,
  'showMode' | 'selectTask' | 'openRunRow'
>;

// The base scopes the view sets; the picker's and the confirm's are pushed over them.
type SchedulesBaseScope = SchedulesFocus;
type SchedulesKitScope = SchedulesBaseScope | 'picker' | 'confirm';

// One action a row's cursor prompt shows: the command's short name and its label.
type RowPromptAction = readonly [command: SchedulesCommand, label: string];

export interface SchedulesViewDeps {
  channel: PageChannel<SchedulingChannel>;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  keys: KeyHints;
  // What a layout's kit draws with.
  kitServices: OwnerKitServices;
  // The editor's vim boxes.
  editor: EditorHost;
  // The list of a choice row's choices, in `scheduling.picker`.
  picker: ListPicker;
  setScope(scope: SchedulesBaseScope): void;
  setFocusTarget(target: FocusTarget | null): void;
  setResizeTarget(target: ResizeTarget | null): void;
  pushScope(scope: 'confirm'): PushedScope;
  isShown(): boolean;
  setContext(context: ModeContext | null): void;
  // Runs the command `key` with `arg`, as a click does.
  runKey<A>(key: CommandKey<A>, arg: A): void;
  // Runs a command by its qualified id, as a button does.
  run(command: CommandId): void;
  // Adds the confirms to the page's overlay area.
  addOverlay(element: HTMLElement): void;
  // A full path with the home folder as `~`.
  tilde(path: string): string;
  // Selects the run row `rowId` in the side bar (sessions' `activate`).
  activateRow(rowId: string): void;
  // Whether Sessions mode shows.
  isSessionsShown(): boolean;
}

// Schedules mode's view: the task list for the side bar and the selected task's details and history, or the task
// editor in their place, in the sheet, logging under `scheduling`. Every decision about what shows lives in
// `schedulesReducer`; the view draws its state after each change through the layout picked for each part, with
// `default` until the first `setLayouts`. `stateChanged` takes each value of the scheduling slot.
export interface SchedulesView {
  sideBar: HTMLElement;
  sheet: HTMLElement;
  stateChanged(scheduling: SchedulingState | undefined): void;
  shown(): void;
  // The side bar was hidden: focus leaves it for main.
  sideBarHidden(): void;
  // The side bar opened over main: focus moves to it.
  sideBarOpenedOver(): void;
  focusSideBar(): void;
  focusMain(): void;
  setLayouts(shown: ShownLayouts<SchedulingLayout>): void;
  dispose(): void;
  commands: Record<SchedulesCommand, () => void>;
  // A list row's click: selects the task `arg` names (`new` for the "+ New task" row) and gives the list the keys.
  selectTask(arg: string): void;
  // A linked history row's click, and `openRun`: selects the run row in the side bar and shows Sessions mode.
  openRunRow(rowId: string): void;
  // Why the page may not stop now: the editor's draft changed; else null.
  mayStop(): string | null;
}

export function createSchedulesView(deps: SchedulesViewDeps): SchedulesView {
  const { channel, log } = deps;
  const store = createReducerStore(initialSchedulesState(), schedulesReducer);
  const dispatch = (action: SchedulesAction) => store.dispatch(action);

  // ── Layouts ────────────────────────────────────────────────────────────
  const parts = createLayoutParts<SchedulingLayout, CompleteSchedulingLayout>(
    { owner: PLUGIN_ID, defaultLayout, log },
  );
  const kitFor = (
    scope: SchedulesKitScope,
    rollback: RollbackDeps,
  ): SchedulingKit =>
    createBaseKit(
      ownerBaseKitDeps(schedulingManifest, deps.kitServices, scope, rollback),
    );

  // The choices the last editor open read, which label the details' controls; null before the first open.
  let loadedChoices: EditorChoices | null = null;

  // ── Elements ───────────────────────────────────────────────────────────
  // The containers stay app-owned; the panes draw inside them and place the slots below.
  const listPane = element('div', 'scheduling-list');
  listPane.tabIndex = -1;
  const rowsList = element('ol', 'scheduling-rows');
  const mainPane = element('div', 'scheduling-main');
  mainPane.tabIndex = -1;
  const contentSheet = sheet();
  contentSheet.classList.add('scheduling-sheet');
  contentSheet.append(mainPane);
  const noticesSlot = element('div', 'scheduling-notices');
  const bodySlot = element('div', 'scheduling-body');
  const historySlot = element('div', 'scheduling-history');
  const editorSlot = element('div', 'scheduling-editor');
  const historyRows = element('ol', 'scheduling-history-rows');
  const noRuns = element('p', 'scheduling-no-runs', 'No runs yet.');
  historySlot.append(
    element('h3', 'ui-section-header', 'History'),
    historyRows,
    noRuns,
  );

  // No panes of its own: every focus move goes on to the core, so Alt+h from main reaches the side bar.
  const focusTarget: FocusTarget = { move: () => false };

  // ── Slots of a kit ───────────────────────────────────────────────────────
  // A row kit's `cursorActions`: a fresh span holding a key prompt per action, its anchors disposed with the draw.
  const actionsSlot = (
    actions: readonly RowPromptAction[],
    scope: SchedulesBaseScope,
    rollback: RollbackDeps,
  ) => {
    const span = element('span', 'scheduling-row-actions');
    for (const [command, label] of actions) {
      const hint = element('span', 'scheduling-row-action');
      span.append(hint);
      rollback.recordAnchor(
        deps.keys.anchor(hint, qualify(PLUGIN_ID, command), {
          scope: qualify(PLUGIN_ID, scope),
          label,
        }),
      );
    }
    return appSlot(span, 'cursorActions', rollback);
  };

  // A task detail kit's button: the app's button for `command`, its key hint in `scheduling.detail`, placed once per
  // draw as `slot`.
  const detailButton = (
    slot: string,
    label: string,
    command: SchedulesCommand,
    variant: ButtonVariant,
    rollback: RollbackDeps,
  ) => {
    const qualified = qualify(PLUGIN_ID, command);
    const hint = element('span', 'scheduling-button-hint');
    const control = textButton(label, () => deps.run(qualified), {
      variant,
      hint,
    });
    rollback.recordAnchor(
      deps.keys.anchor(hint, qualified, {
        scope: qualify(PLUGIN_ID, 'detail'),
      }),
    );
    const placed = appSlot(control, slot, rollback);
    return (parent: HTMLElement): HTMLButtonElement => {
      placed.place(parent);
      return control;
    };
  };

  // ── Drawing ────────────────────────────────────────────────────────────
  let rowDraws: DrawnRoot[] = [];
  let noticeDraws: DrawnRoot[] = [];
  let bodyDraw: DrawnRoot | null = null;
  let historyDraws: DrawnRoot[] = [];
  // What each part was drawn from; null to draw again.
  let drawnRowsKey: string | null = null;
  let drawnNoticesKey: string | null = null;
  let drawnBodyKey: string | null = null;
  let drawnHistoryKey: string | null = null;
  let shownFocus: SchedulesFocus | null = null;
  let shownScope: SchedulesBaseScope | null = null;
  // The selection last logged while shown, and last given to the title bar; undefined before the first.
  let loggedSelection: string | undefined;
  let shownContext: string | null | undefined;

  const taskEditorView = createTaskEditor({
    editor: deps.editor,
    log,
    parts,
    kit: (rollback) => kitFor('editor', rollback),
    changed: (field, text) =>
      dispatch({ type: 'fieldChanged', field, value: text }),
    activated(field) {
      dispatch({ type: 'fieldCursor', field });
      if (store.get().focus !== 'editor') {
        changeFocus('editor', false);
      }
    },
  });

  const drawListPane = () => {
    const rowsScroll = rowsList.scrollTop;
    parts.redraw('list', listPane, (list, into, rollback) => {
      const rows = appSlot(rowsList, 'rows', rollback);
      const pane = list(into, { ...kitFor('list', rollback), rows: rows.place });
      rows.placeIfLeftOut(requireElementIn(into, pane.element, 'list'));
      return pane;
    });
    rowsList.scrollTop = rowsScroll;
  };

  const drawDetailPane = () => {
    const scroll = mainPane.scrollTop;
    parts.redraw('detail', mainPane, (detail, into, rollback) => {
      const slots = [
        appSlot(noticesSlot, 'notices', rollback),
        appSlot(bodySlot, 'body', rollback),
        appSlot(historySlot, 'history', rollback),
        appSlot(editorSlot, 'editor', rollback),
      ] as const;
      const [noticesPlace, body, history, editor] = slots;
      const pane = detail(into, {
        ...kitFor('detail', rollback),
        notices: noticesPlace.place,
        body: body.place,
        history: history.place,
        editor: editor.place,
      });
      const root = requireElementIn(into, pane.element, 'detail');
      for (const slot of slots) {
        slot.placeIfLeftOut(root);
      }
      return pane;
    });
    mainPane.scrollTop = scroll;
  };

  const taskActions = (view: ScheduledTaskView): RowPromptAction[] => [
    ['edit', 'edit'],
    ['togglePaused', view.task.paused ? 'resume' : 'pause'],
    ['runNow', 'run now'],
    ['remove', 'remove'],
  ];

  const drawRows = (state: SchedulesState, always: boolean) => {
    const { scheduling } = state;
    const rows = listRows(scheduling);
    const key = JSON.stringify(
      rows.map((row) =>
        row.kind === 'new'
          ? null
          : [row.view.task.id, taskRowInput(row.view, scheduling.fires)],
      ),
    );
    if (always || key !== drawnRowsKey) {
      drawnRowsKey = key;
      rowDraws = disposeDraws(rowDraws);
      rowsList.replaceChildren();
      for (const row of rows) {
        const drawn =
          row.kind === 'new'
            ? parts.draw('newTaskRow', rowsList, (newTaskRow, into, rollback) => {
                const actions = actionsSlot(
                  [['open', 'new task']],
                  'list',
                  rollback,
                );
                const root = newTaskRow(into, {
                  ...kitFor('list', rollback),
                  cursorActions: actions.place,
                });
                actions.placeIfLeftOut(
                  requireElementIn(into, root, 'newTaskRow'),
                );
                return { element: root };
              })
            : parts.draw('taskRow', rowsList, (taskRow, into, rollback) => {
                const actions = actionsSlot(
                  taskActions(row.view),
                  'list',
                  rollback,
                );
                const root = taskRow(
                  into,
                  taskRowInput(row.view, scheduling.fires),
                  { ...kitFor('list', rollback), cursorActions: actions.place },
                );
                actions.placeIfLeftOut(requireElementIn(into, root, 'taskRow'));
                return { element: root };
              });
        const arg = row.kind === 'new' ? NEW_TASK_ROW_ARG : row.view.task.id;
        rowAction(drawn.built.element, () =>
          deps.runKey(selectTaskCommand, arg),
        );
        rowDraws.push(drawn);
      }
    }
    rows.forEach((row, index) => {
      const root = rowDraws[index]?.built.element;
      const isSelected =
        (row.kind === 'new' ? null : row.view.task.id) === state.selectedId;
      root?.classList.toggle('is-selected', isSelected);
      root?.classList.toggle('is-cursor', isSelected && state.focus === 'list');
    });
    listPane.classList.toggle('is-pane-inactive', state.focus !== 'list');
  };

  const drawNotices = (state: SchedulesState) => {
    const lines = notices(state.scheduling);
    const key = JSON.stringify(lines);
    if (key === drawnNoticesKey) {
      return;
    }
    drawnNoticesKey = key;
    noticeDraws = disposeDraws(noticeDraws);
    noticesSlot.replaceChildren();
    noticeDraws = lines.map((line) =>
      parts.draw('notice', noticesSlot, (notice, into, rollback) => ({
        element: notice(into, line, kitFor('detail', rollback)),
      })),
    );
  };

  const drawBody = (state: SchedulesState) => {
    const view = selectedView(state);
    const reason = emptyReason(state);
    const input =
      view === null
        ? null
        : taskDetailInput(
            view,
            state.scheduling.fires,
            loadedChoices,
            deps.tilde,
          );
    const key = JSON.stringify([reason, input]);
    if (key === drawnBodyKey) {
      return;
    }
    drawnBodyKey = key;
    bodyDraw?.dispose();
    bodyDraw = null;
    bodySlot.replaceChildren();
    if (reason !== null) {
      bodyDraw = parts.draw('empty', bodySlot, (empty, into, rollback) => ({
        element: empty(into, { reason }, kitFor('detail', rollback)),
      }));
      return;
    }
    if (input === null) {
      return;
    }
    bodyDraw = parts.draw('taskDetail', bodySlot, (taskDetail, into, rollback) => {
      const root = taskDetail(into, input, {
        ...kitFor('detail', rollback),
        editButton: detailButton(
          'editButton',
          'Edit',
          'edit',
          'secondary',
          rollback,
        ),
        pauseButton: detailButton(
          'pauseButton',
          input.paused ? 'Resume' : 'Pause',
          'togglePaused',
          'secondary',
          rollback,
        ),
        runNowButton: detailButton(
          'runNowButton',
          'Run now',
          'runNow',
          'secondary',
          rollback,
        ),
        removeButton: detailButton(
          'removeButton',
          'Remove',
          'remove',
          'danger',
          rollback,
        ),
      });
      return { element: requireElementIn(into, root, 'taskDetail') };
    });
  };

  const drawHistory = (state: SchedulesState) => {
    const view = selectedView(state);
    const history = view?.history ?? [];
    const inputs = history.map((entry) =>
      historyRowInput(entry, state.scheduling.runRows),
    );
    const key = JSON.stringify([view?.task.id ?? null, inputs]);
    if (key !== drawnHistoryKey) {
      drawnHistoryKey = key;
      historyDraws = disposeDraws(historyDraws);
      historyRows.replaceChildren();
      history.forEach((entry, index) => {
        const input = inputs[index];
        const drawn = parts.draw(
          'historyRow',
          historyRows,
          (historyRow, into, rollback) => {
            const actions = actionsSlot(
              input.linked ? [['openRun', 'open']] : [],
              'detail',
              rollback,
            );
            const root = historyRow(into, input, {
              ...kitFor('detail', rollback),
              cursorActions: actions.place,
            });
            actions.placeIfLeftOut(
              requireElementIn(into, root, 'historyRow'),
            );
            return { element: root };
          },
        );
        const { rowId } = entry;
        if (input.linked && rowId !== null) {
          rowAction(drawn.built.element, () =>
            deps.runKey(openRunRowCommand, rowId),
          );
        }
        historyDraws.push(drawn);
      });
      noRuns.hidden = history.length > 0;
    }
    historyDraws.forEach((drawn, index) => {
      const isCursor = index === state.historyCursor;
      drawn.built.element.classList.toggle('is-selected', isCursor);
      drawn.built.element.classList.toggle(
        'is-cursor',
        isCursor && state.focus === 'detail',
      );
    });
  };

  // Moves the DOM focus to the pane the keys act on, when that changed; a focused box keeps it.
  const syncFocus = (state: SchedulesState, always: boolean) => {
    const isChanged = state.focus !== shownFocus;
    if (!deps.isShown() || (!always && !isChanged)) {
      return;
    }
    shownFocus = state.focus;
    if (state.focus === 'list') {
      listPane.focus();
      return;
    }
    if (taskEditorView.active() === null) {
      mainPane.focus();
    }
  };

  // Sets the scope, the focus target and the resize target from the focus, when the scope changed or `always`.
  const syncTargets = (state: SchedulesState, always: boolean) => {
    if (!deps.isShown() || (!always && state.focus === shownScope)) {
      return;
    }
    shownScope = state.focus;
    deps.setScope(state.focus);
    deps.setResizeTarget(null);
    deps.setFocusTarget(focusTarget);
  };

  // Logs each change of the selection while the mode shows, and gives the title bar the selected task's name.
  const noteSelection = (state: SchedulesState) => {
    const name = selectedView(state)?.task.name ?? null;
    if (name !== shownContext) {
      shownContext = name;
      deps.setContext(name === null ? null : { title: TITLE, detail: name });
    }
    const selection = name ?? 'new';
    if (deps.isShown() && selection !== loggedSelection) {
      loggedSelection = selection;
      log(`task selected: ${selection}`);
    }
  };

  // ── The confirms ─────────────────────────────────────────────────────────
  const confirmPrompt = (kind: 'remove' | 'discard') =>
    createConfirmPrompt({
      title: kind === 'remove' ? REMOVE_TITLE : DISCARD_TITLE,
      body: '',
      keep: {
        label: kind === 'remove' ? 'Keep it' : 'Keep editing',
        command: qualify(PLUGIN_ID, 'confirmNo'),
      },
      confirm: {
        label: kind === 'remove' ? 'Remove' : 'Discard',
        command: qualify(PLUGIN_ID, 'confirmYes'),
      },
      scope: qualify(PLUGIN_ID, 'confirm'),
      keys: deps.keys,
      run: deps.run,
      pushScope: () => deps.pushScope('confirm'),
      isAsked: () => store.get().confirm?.kind === kind,
      isSending: () => false,
      dismiss: () => dispatch({ type: 'confirmClosed' }),
      log,
      drawFrame: (parent, input) =>
        parts.redraw(
          'dialogFrame',
          parent,
          (dialogFrame, into, rollback) =>
            requireDialogFrame(
              dialogFrame(into, input, kitFor('confirm', rollback)),
              input,
              'dialogFrame',
            ),
          `dialogFrame:${kind}`,
        ).built,
      drawBody(body, promptParts) {
        const asked = store.get().confirm;
        parts.redraw(
          'confirmBody',
          body,
          (confirmBodyPart, into, rollback) => ({
            element: confirmBodyPart(
              into,
              { body: asked === null ? '' : confirmBody(asked) },
              {
                ...kitFor('confirm', rollback),
                keepButton: promptParts.keepButton,
                confirmButton: promptParts.confirmButton,
              },
            ),
          }),
          `confirmBody:${kind}`,
        );
      },
    });
  const prompts = {
    remove: confirmPrompt('remove'),
    discard: confirmPrompt('discard'),
  };
  const promptShown = { remove: false, discard: false };
  for (const prompt of Object.values(prompts)) {
    deps.addOverlay(prompt.element);
  }

  // Shows a confirm the state asks for and hides one it no longer asks for, laying the base scope under it.
  const syncPrompts = (state: SchedulesState) => {
    for (const kind of ['remove', 'discard'] as const) {
      const isAsked = state.confirm?.kind === kind;
      if (isAsked === promptShown[kind]) {
        continue;
      }
      promptShown[kind] = isAsked;
      if (isAsked) {
        prompts[kind].redraw();
      }
      prompts[kind].setBaseScope(() => syncTargets(state, true));
    }
  };

  const render = (always = false) => {
    const state = store.get();
    drawRows(state, false);
    drawNotices(state);
    drawBody(state);
    drawHistory(state);
    const isEditorOpen = state.editor !== null;
    taskEditorView.render(state.editor, editorSlot, false);
    bodySlot.hidden = isEditorOpen;
    historySlot.hidden = isEditorOpen || selectedView(state) === null;
    noteSelection(state);
    syncPrompts(state);
    syncTargets(state, always);
    syncFocus(state, always);
    rowsList
      .querySelector('.is-selected')
      ?.scrollIntoView({ block: 'nearest' });
  };

  drawListPane();
  drawDetailPane();
  store.subscribe(() => render());

  // Sets the focus; `movesFocus` moves the DOM focus to it too, else the DOM focus is already there.
  const changeFocus = (focus: SchedulesFocus, movesFocus: boolean) => {
    if (!movesFocus) {
      shownFocus = focus;
    }
    dispatch({ type: 'focus', focus });
    render(movesFocus);
  };
  const setFocus = (focus: SchedulesFocus) => changeFocus(focus, true);
  // Main's pane: the editor while it is open, else the details.
  const mainFocus = (): SchedulesFocus =>
    store.get().editor === null ? 'detail' : 'editor';

  // A click or a box's focus into a pane hands it the keys.
  listPane.addEventListener('focusin', () => {
    if (store.get().focus !== 'list') {
      changeFocus('list', false);
    }
  });
  mainPane.addEventListener('focusin', () => {
    if (store.get().focus === 'list') {
      changeFocus(mainFocus(), false);
    }
  });

  // ── Actions ──────────────────────────────────────────────────────────────
  // Runs `action` on the selected task; nothing on the "+ New task" row.
  const onSelected =
    (action: (view: ScheduledTaskView) => Promise<void> | void) => () => {
      const view = selectedView(store.get());
      if (view !== null) {
        void action(view);
      }
    };

  // Sends `send`; a rejection toasts its reason in the error tone and logs `<what> failed: <reason>`.
  const sendFor = async (
    what: string,
    send: () => Promise<unknown>,
  ): Promise<boolean> => {
    try {
      await send();
      return true;
    } catch (error) {
      log(`${what} failed: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
      return false;
    }
  };

  const togglePaused = onSelected(async (view) => {
    const paused = !view.task.paused;
    const isSent = await sendFor(paused ? 'pause' : 'resume', () =>
      channel.invoke('setPaused', view.task.id, paused),
    );
    if (isSent) {
      log(`${paused ? 'paused' : 'resumed'}: ${view.task.name}`);
      deps.toast(paused ? 'Task paused' : 'Task resumed', 'success');
    }
  });

  const runNow = onSelected(async (view) => {
    const isSent = await sendFor('run now', () =>
      channel.invoke('runNow', view.task.id),
    );
    if (isSent) {
      log(`run now: ${view.task.name}`);
      deps.toast('Run queued', 'success');
    }
  });

  const remove = onSelected((view) => {
    dispatch({
      type: 'confirmAsked',
      confirm: { kind: 'remove', taskId: view.task.id, name: view.task.name },
    });
  });

  const removeConfirmed = async (taskId: string, name: string) => {
    const isSent = await sendFor('remove', () =>
      channel.invoke('removeTask', taskId),
    );
    if (isSent) {
      log(`removed: ${name}`);
      deps.toast('Task removed', 'success');
    }
  };

  // ── The editor ───────────────────────────────────────────────────────────
  let isOpening = false;

  // Reads the editor's choices and opens the editor on `view`, or on a new task for null; a rejection toasts and
  // opens nothing. While the editor is open, focuses it instead.
  const openEditor = async (view: ScheduledTaskView | null) => {
    if (store.get().editor !== null) {
      setFocus('editor');
      return;
    }
    if (isOpening) {
      return;
    }
    isOpening = true;
    let choices: EditorChoices;
    try {
      choices = await channel.invoke('editorChoices');
    } catch (error) {
      log(`editor not opened: ${errorText(error)}`);
      deps.toast(`Could not open the editor: ${errorText(error)}`, 'error');
      return;
    } finally {
      isOpening = false;
    }
    loadedChoices = choices;
    const opener = store.get().focus === 'detail' ? 'detail' : 'list';
    dispatch({
      type: 'editorOpened',
      editor:
        view === null
          ? newTaskEditor(choices, opener)
          : taskEditor(view, choices, opener),
    });
    log(`editor opened: ${view === null ? 'new' : view.task.name}`);
    render(true);
  };

  const closeEditor = () => {
    taskEditorView.leave();
    dispatch({ type: 'editorClosed' });
    log('editor closed');
    render(true);
  };

  const save = async () => {
    const { editor } = store.get();
    if (editor === null) {
      return;
    }
    const draft = draftOf(editor);
    if (typeof draft === 'string') {
      dispatch({ type: 'problem', problem: draft });
      log(`save refused: ${draft}`);
      return;
    }
    let id: string;
    try {
      id = await channel.invoke('saveTask', draft);
    } catch (error) {
      const reason = errorText(error);
      dispatch({ type: 'problem', problem: reason });
      log(`save refused: ${reason}`);
      return;
    }
    if (store.get().editor === null) {
      return;
    }
    taskEditorView.leave();
    dispatch({ type: 'saved', id });
    log(`task saved: ${draft.name}`);
    log('editor closed');
    deps.toast('Task saved', 'success');
    render(true);
  };

  const cancelEdit = () => {
    const { editor } = store.get();
    if (editor === null) {
      return;
    }
    if (isEditorChanged(editor)) {
      dispatch({ type: 'cancel' });
      return;
    }
    closeEditor();
  };

  const cursorRow = (): EditorRow | null => {
    const { editor } = store.get();
    return editor === null ? null : (editorRows(editor)[editor.cursor] ?? null);
  };

  // Gives the focus back to the editor once the picker closed.
  const pickerClosed = () => render(true);

  const pickChoice = (row: EditorRow) => {
    const choices = row.choices ?? [];
    deps.picker.open({
      title: row.label,
      items: choices,
      label: (choice) => choice.label,
      selected: Math.max(
        choices.findIndex((choice) => choice.label === row.value),
        0,
      ),
      drawRow: (
        list: HTMLElement,
        _choice: unknown,
        input: DrawRowInput,
      ): DrawnPickerRow => {
        const drawn = parts.draw(
          'pickerRow',
          list,
          (pickerRow, into, rollback) => ({
            element: pickerRow(
              into,
              { picker: row.label, label: input.label },
              { ...kitFor('picker', rollback), trailing: () => input.trailing },
            ),
          }),
        );
        return { element: drawn.built.element, dispose: drawn.dispose };
      },
      chosen(choice) {
        dispatch({ type: 'fieldChanged', field: row.field, value: choice.value });
        pickerClosed();
      },
      cancelled: pickerClosed,
    });
  };

  const editField = () => {
    const row = cursorRow();
    if (row === null) {
      return;
    }
    if (row.kind === 'choice') {
      pickChoice(row);
      return;
    }
    taskEditorView.focusBox(row.field);
  };

  const stepField = (step: 1 | -1) => () => {
    const { editor } = store.get();
    if (editor === null) {
      return;
    }
    const field = taskEditorView.stepBox(
      editor,
      cursorRow()?.field ?? null,
      step,
    );
    if (field !== null && taskEditorView.focusBox(field)) {
      dispatch({ type: 'fieldCursor', field });
    }
  };

  // ── Commands ─────────────────────────────────────────────────────────────
  const listMove = (to: Move) => () => dispatch({ type: 'move', to });
  const historyMove = (to: Move) => () => dispatch({ type: 'historyMove', to });

  const scrollDetails = (step: ScrollStep, direction: 1 | -1) => () => {
    const scroll = scrollContent(
      mainPane,
      step,
      direction,
      textLineHeightPx(mainPane),
    );
    log(scrollText('the details', step, direction, scroll));
  };

  const open = (isFocusMoved: boolean) => () => {
    const state = store.get();
    if (state.editor !== null) {
      if (isFocusMoved) {
        setFocus('editor');
      }
      return;
    }
    const view = selectedView(state);
    if (view === null) {
      if (isFocusMoved) {
        void openEditor(null);
      }
      return;
    }
    if (isFocusMoved) {
      setFocus('detail');
      log(`details focused: ${view.task.name}`);
    }
  };

  const openRunRow = (rowId: string) => {
    deps.activateRow(rowId);
    log(`run row opened: ${rowId}`);
    if (!deps.isSessionsShown()) {
      deps.run('sessions.showMode');
    }
  };

  const commands: Record<SchedulesCommand, () => void> = {
    listDown: listMove('down'),
    listUp: listMove('up'),
    listTop: listMove('top'),
    listBottom: listMove('bottom'),
    open: open(true),
    openKeepingFocus: open(false),
    newTask: () => void openEditor(null),
    edit: onSelected((view) => openEditor(view)),
    togglePaused,
    runNow,
    remove,
    historyDown: historyMove('down'),
    historyUp: historyMove('up'),
    historyTop: historyMove('top'),
    historyBottom: historyMove('bottom'),
    openRun() {
      const rowId = cursorRunRow(store.get());
      if (rowId !== null) {
        openRunRow(rowId);
      }
    },
    lineDown: scrollDetails('line', 1),
    lineUp: scrollDetails('line', -1),
    halfPageDown: scrollDetails('halfPage', 1),
    halfPageUp: scrollDetails('halfPage', -1),
    fieldDown: () => dispatch({ type: 'fieldMove', by: 1 }),
    fieldUp: () => dispatch({ type: 'fieldMove', by: -1 }),
    editField,
    nextField: stepField(1),
    previousField: stepField(-1),
    save: () => void save(),
    cancelEdit,
    leaveBox() {
      if (taskEditorView.leave() !== null && deps.isShown()) {
        mainPane.focus();
      }
    },
    confirmYes() {
      const { confirm } = store.get();
      if (confirm === null) {
        return;
      }
      dispatch({ type: 'confirmClosed' });
      if (confirm.kind === 'remove') {
        void removeConfirmed(confirm.taskId, confirm.name);
        return;
      }
      closeEditor();
    },
    confirmNo: () => dispatch({ type: 'confirmClosed' }),
    ...listPickerCommands(deps.picker),
  };

  return {
    sideBar: listPane,
    sheet: contentSheet,
    stateChanged(scheduling) {
      dispatch({
        type: 'stateChanged',
        scheduling: scheduling ?? emptySchedulingState(),
      });
      log(`state drawn: ${String(store.get().scheduling.tasks.length)} tasks`);
    },
    shown() {
      render(true);
      log(`mode shown: ${String(store.get().scheduling.tasks.length)} tasks`);
    },
    sideBarHidden() {
      if (store.get().focus === 'list') {
        setFocus(mainFocus());
      }
    },
    sideBarOpenedOver: () => setFocus('list'),
    focusSideBar: () => setFocus('list'),
    focusMain: () => setFocus(mainFocus()),
    setLayouts(next) {
      parts.setLayouts(next);
      drawListPane();
      drawDetailPane();
      drawRows(store.get(), true);
      drawnNoticesKey = null;
      drawnBodyKey = null;
      drawnHistoryKey = null;
      taskEditorView.render(store.get().editor, editorSlot, true);
      prompts.remove.redraw();
      prompts.discard.redraw();
      deps.picker.redraw();
      // A focused box keeps its focus; focus the redraw dropped goes back to the pane holding the keys.
      const isFocusLost =
        document.activeElement === null ||
        document.activeElement === document.body;
      render(isFocusLost);
    },
    dispose() {
      rowDraws = disposeDraws(rowDraws);
      noticeDraws = disposeDraws(noticeDraws);
      historyDraws = disposeDraws(historyDraws);
      bodyDraw?.dispose();
      bodyDraw = null;
      taskEditorView.dispose();
      parts.dispose();
    },
    commands,
    selectTask(arg) {
      const id = arg === NEW_TASK_ROW_ARG ? null : arg;
      const isListed =
        id === null ||
        store.get().scheduling.tasks.some((view) => view.task.id === id);
      if (!isListed) {
        log(`no task ${arg}`);
        return;
      }
      dispatch({ type: 'select', id });
      setFocus('list');
    },
    openRunRow,
    mayStop() {
      const { editor } = store.get();
      return editor !== null && isEditorChanged(editor) ? UNSAVED_REASON : null;
    },
  };
}
