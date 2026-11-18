import './sessions.css';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type { PaneDirection } from '../../../contracts/panes';
import type {
  PageApi,
  PageCommandContext,
  PagePart,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  createPartStore,
  type PartStore,
} from '../../../shared/page/contributed-parts';
import { blurFocusedElement, holdsTextEntry } from '../../../shared/page/dom';
import { listPickerCommands } from '../../../shared/page/list-picker';
import { pruneKeys } from '../../../shared/page/place-slot';
import {
  leafIds,
  type SplitAxis,
} from '../../../shared/page/pane-tree/pane-tree';
import { qualify } from '../../../shared/plugin-manifests';
import {
  followRows,
  type SessionPart,
  type SessionRow,
  type SessionsChannel,
  sessionsActiveSlot,
  sessionsActivitySlot,
  sessionsClaimedSlot,
  sessionsPlaceSlot,
  sessionsFavoriteProjectAtCommand,
  type SessionsPageEvents,
  type SessionsPageExports,
  sessionsRowsSlot,
  sessionsSelectionSlot,
  sessionsSelectRowCommand,
  sessionsSelectTabCommand,
  type SidebarSection,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout, SectionInput } from '../layouts/layout';
import { sessionsManifest } from '../manifest';
import { cutTitle, titleLimit } from '../session-title';
import { sessionsPageView } from './consumer-view';
import { readSessionsLayout } from './layout/read-sessions-layout';
import {
  isPressSelection,
  pickerRows,
  pressedFocusAction,
  type SelectionEnds,
  shownElsewhere,
} from './pane-sessions';
import { previewToggle } from './preview';
import { createProjectFavorites } from './project-favorites';
import { createRenameDialog } from './rename-dialog';
import { createSessionRecency } from './session-recency';
import { createSessionsPageModel } from './sessions-page-model';
import { mountSessionsView, type SessionsView } from './sessions-view';
import type { CursorMove } from './sidebar-order';
import {
  closesAtOnce,
  markToastText,
  mayClose,
  stepSession,
  stepTab,
} from './tabs';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';

type SessionsApi = PageApi<
  typeof sessionsManifest,
  SessionsChannel,
  SessionsPageEvents
>;

// The line a popup opened or hidden logs, by `togglePopup` or its bar entry.
function popupToggledLine(
  title: string,
  isOpen: boolean,
  sessionLabel: string,
): string {
  return `${isOpen ? 'opened' : 'hid'} ${title} popup in ${sessionLabel}`;
}

// The ends of `selection` while it is not collapsed, else null.
function selectionEnds(selection: Selection | null): SelectionEnds | null {
  if (selection?.isCollapsed !== false) {
    return null;
  }
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  return { anchorNode, anchorOffset, focusNode, focusOffset };
}

// The ids of the side bar's own sections, which no registered section may take.
const RESERVED_SECTION_IDS: readonly string[] = [
  'favorites',
  'recent',
] satisfies Exclude<SectionInput['kind'], 'plugin'>[];

// A choice in the split picker: a session no pane shows, or a new session.
type PickerChoice = { kind: 'row'; row: SessionRow } | { kind: 'new' };

// How a close asks: `viewsAtOnce` asks the session's tabs and popups for a
// close at once, so none confirms; `cancelsHolds` has main cancel what its
// close guards hold before they answer.
interface CloseAsk {
  viewsAtOnce: boolean;
  cancelsHolds: boolean;
}

const PLAIN_CLOSE: CloseAsk = { viewsAtOnce: false, cancelsHolds: false };

// Asks the session's tabs in order, then its popups, then main, to close it,
// as `ask` says, resolving to whether the row closed. Main's refusal is logged
// and toasted, and a failed ask logged; once `isStopped`, a settled ask asks
// main nothing and logs nothing.
async function closeSession(
  api: SessionsApi,
  view: SessionsView,
  labelOf: (sessionId: string) => string,
  sessionId: string,
  ask: CloseAsk,
  isStopped: () => boolean,
): Promise<boolean> {
  const { log } = api.services;
  const viewsNow = () => [
    ...view.tabs.tabsOf(sessionId),
    ...view.tabs.popupsOf(sessionId),
  ];
  if (!(await mayClose(viewsNow, ask.viewsAtOnce)) || isStopped()) {
    return false;
  }
  try {
    const refusal = await api.channel.invoke(
      'closeSession',
      sessionId,
      ask.cancelsHolds,
    );
    if (refusal !== null && !isStopped()) {
      log(`session close kept by main: ${labelOf(sessionId)}`);
      api.services.toast(refusal, 'info');
    }
    return refusal === null;
  } catch (error) {
    if (!isStopped()) {
      log(`session not closed: ${errorText(error)}`);
    }
    return false;
  }
}

function createExports(
  api: SessionsApi,
  view: SessionsView,
  rowParts: PartStore<SessionPart>,
  barParts: PartStore<SessionPart>,
  sections: PartStore<SidebarSection>,
  activate: (sessionId: string) => void,
  labelOf: (sessionId: string) => string,
  shownSessionId: () => string | null,
  isStopped: () => boolean,
): SessionsPageExports {
  return {
    addTab(sessionId, tab) {
      const handle = view.tabs.add(sessionId, tab);
      api.events.emit('tabAdded', { sessionId, tabId: tab.id });
      return handle;
    },
    addPopup: (sessionId, popup, options) =>
      view.tabs.addPopup(sessionId, popup, options),
    cutToTitleLimit: (text) =>
      cutTitle(text, titleLimit(api.settings().titleMaxLength)),
    addRowPart: (part) => rowParts.add(part),
    addBarPart: (part) => barParts.add(part),
    addSection(section) {
      if (RESERVED_SECTION_IDS.includes(section.id)) {
        throw new Error(`section id ${section.id} is reserved`);
      }
      return sections.add(section);
    },
    activate,
    closeSession: (sessionId) =>
      closeSession(api, view, labelOf, sessionId, PLAIN_CLOSE, isStopped),
    shownSessionId,
    setActivity: (sessionId, sourceId, activity) =>
      view.setActivity(sessionId, sourceId, activity),
  };
}

// Sessions mode: a side bar row for each of main's sessions, in the mode's
// side bar, beside chat panes, each showing one session's tabs, which other
// plugins add. The side bar's selected row, the title bar and `sessions.active`
// follow the focused pane's session; main owns the rows and keeps a
// selection of its own, which the page keeps in step through `activate`, its
// own echoes changing nothing when they come back. Rows with an owner are left
// out of the page's state, so no page rule sees them. The first state is read at
// `ready`, and each notice of the rows or the selection applies after
// it. A selection naming no row is mid-operation: main deleted that row and its
// selection write follows, so the state that settles it places the panes, and
// the focus and the visible tab follow in a microtask, after every reader heard
// the notice. Each session's place (`sessionsPlaceSlot`) outlives a reload:
// a row leaving deletes it, and once the restore window settles the part
// deletes the places of rows that ended while no page ran. Activating a session
// focuses the pane showing it, or loads it into the focused pane; closing one
// asks main, and a pane whose session leaves closes, the last pane staying.
// The visible surface, the focused pane's session's top open popup, else its
// selected tab, while the mode shows, sets the base key scope through its
// `shown`; with none visible the scope is `idle`; the tab that stops being
// visible hears `hidden`, and `tabShown` fires for each tab told it shows.
// `togglePopup` hides and shows the focused pane's session's popup. A row a
// mark selected while the mode is hidden toasts the mark instead of showing
// it. The pane keys split, close and swap panes, a split asking which session
// the new pane shows; a split or pane close does nothing while that picker is
// open. The pane tree and each pane's session persist in uiState `panes`; a
// restored pane whose session main does not hold yet waits for it until the
// first pane key that changes the panes. The side bar, panes, tab bars, popups
// and the popup bar draw with the layout the `layout` setting names.
// `openPreview` swaps the side bar's rows for a sample of every row state and
// back, page-only: it sends nothing to main. `renameSession` opens the rename
// dialog over the focused pane's session; the rows draw titles cut to the
// `titleMaxLength` setting, drawn again when it changes. The rows group by
// project under Favorites and Recent, from the favorites and recency stamps in
// uiState, less the rows a section another plugin registers (`addSection`)
// claims, which draw in that section after Recent and which each draw writes to
// `sessions.claimed`, [] at each start, for main's post-close selection to
// skip; the session step keys follow
// that drawn order, and the project keys change the focused pane's session's
// project's favorite. The side bar's rows are the Sessions list, reached by
// Alt+h past the leftmost pane (`focusSideBar`) or by opening the side bar over
// a narrow window: it holds the `sidebar` scope while its cursor walks the rows,
// and while it does no visible tab takes the scope. Its row keys act on the
// cursor's row; Enter, Esc and Alt+l (`focusMain`) end its turn, as do the side
// bar hiding, the mode hiding and a press or a focus in the chat panes, each
// setting main's scope again. A pane key move, like a key leaving the list,
// hands the keys to the focused pane's transcript in normal mode; a release
// into a pane focuses its Chat box.
export const sessionsPagePart: PagePart<typeof sessionsManifest> = {
  manifest: sessionsManifest,
  start(api: SessionsApi) {
    const { log } = api.services;
    let isStopped = false;
    const { uiState } = api.services;
    const rows = api.state.read(sessionsRowsSlot);
    const selection = api.state.read(sessionsSelectionSlot);
    const harnesses = api.state.read(coreAgentHarnessesSlot);
    const active = api.state.publish(sessionsActiveSlot);
    active.set(null);
    const activities = api.state.publish(sessionsActivitySlot);
    // The old page's sources are gone with it, and the new page's set theirs
    // again.
    for (const sessionId of activities.all().keys()) {
      activities.delete(sessionId);
    }
    // Each session's place outlives a reload, not its row. The places of rows
    // main does not hold leave once the restore window settles, so the rows
    // chat's restore reopens are in the mirror first.
    const places = api.state.publish(sessionsPlaceSlot);
    // The old page's claims went with its sections, which register again.
    const claimed = api.state.publish(sessionsClaimedSlot);
    claimed.set([]);
    api.restores.onSettled(() =>
      pruneKeys(places, (sessionId) => rows.all().has(sessionId)),
    );

    // Hands the keys to the focused pane as a key move does: the focused
    // element blurs and the visible tab is told it shows again, so the keys
    // land on its transcript in normal mode, or the pane's `idle`.
    const keysToFocusedPane = () => {
      log(`keys to pane ${model.paneLabel(view.panes.focusedPaneId())}`);
      blurFocusedElement();
      model.setMainScope();
    };

    const logListCursor = (row: SessionRow | null) =>
      log(row === null ? 'no session rows' : `list cursor on ${row.label}`);

    const rowParts = createPartStore<SessionPart>();
    const barParts = createPartStore<SessionPart>();
    const sections = createPartStore<SidebarSection>();
    // A row click, a star's click and a tab's click each run their command.
    const view = mountSessionsView({
      activate: (sessionId) =>
        void api.commands.run(sessionsSelectRowCommand, sessionId),
      runFavorite: (project) =>
        void api.commands.run(sessionsFavoriteProjectAtCommand, project),
      selectTab: (sessionId, tab) =>
        void api.commands.run(sessionsSelectTabCommand, { sessionId, tab }),
      isModeShown: () => model.isModeShown(),
      tabsChanged: () => model.tabsChanged(),
      popupOpenedFromBar(sessionId, popup) {
        log(popupToggledLine(popup.title, true, model.labelOf(sessionId)));
      },
      keys: api.keys,
      timers: api.services.timers,
      harnesses: () => harnesses.all(),
      panesChanged: () => model.panesChanged(),
      paneFocused: (paneId) => model.paneFocused(paneId),
      paneKeyFocused: () => keysToFocusedPane(),
      cursorMoved: (row) => logListCursor(row),
      // The keys follow a release into its pane, as `pressedFocusAction` says.
      panePressed(pane) {
        const textSelection = window.getSelection();
        const atRelease = selectionEnds(textSelection);
        const focused = document.activeElement;
        const sessionId = view.panes.focusedSessionId();
        const action = pressedFocusAction({
          hasSelectionInPane:
            isPressSelection(selectionAtPress, atRelease) &&
            pane.contains(textSelection?.anchorNode ?? null),
          isFocusInPane: pane.contains(focused),
          doesFocusTakeText: holdsTextEntry(focused),
          isChatTabShown:
            sessionId !== null &&
            view.tabs.selectedTabOf(sessionId)?.id === 'chat',
          isPopupOpen:
            sessionId !== null && view.tabs.openPopupOf(sessionId) !== null,
        });
        if (action === 'keep') {
          return;
        }
        blurFocusedElement();
        const canFocusBox =
          action === 'toBox' &&
          sessionId !== null &&
          api.keys.command('chat.focusBox') !== undefined;
        if (canFocusBox) {
          api.commands.run('chat.focusBox');
        }
      },
      markdown: api.services.markdown,
      platform: api.platform.os,
      state: api.state.forLayouts,
      commands: kitCommandsOf(api),
      log,
      rowParts,
      barParts,
      sections,
      titleMaxLength: () => api.settings().titleMaxLength,
      recency: createSessionRecency(api.services.clock, uiState),
      favorites: createProjectFavorites(uiState),
      activities,
      places,
      claimed,
    });
    const model = createSessionsPageModel({
      view,
      uiState,
      readRows: () => rows.all().values(),
      readSelection: () => selection.get() ?? null,
      active,
      activateInMain: (sessionId) => api.channel.invoke('activate', sessionId),
      isStopped: () => isStopped,
      restores: api.restores,
      setContext: (focused) =>
        mode.setContext(
          focused === undefined
            ? null
            : {
                title: focused.label,
                detail:
                  focused.projectDir === null
                    ? null
                    : api.services.paths.tilde(
                        focused.projectDir,
                        api.services.homeDir,
                      ),
              },
        ),
      markToast: (mark) =>
        api.services.toast(
          markToastText(
            mark,
            api.keys.keysFor(qualify(sessionsManifest.id, 'showMode')),
          ),
          'info',
        ),
      setIdleScope: () => api.keys.setScope('idle'),
      tabShown: (sessionId, tabId) =>
        api.events.emit('tabShown', { sessionId, tabId }),
      log,
    });
    rows.on(model.applyNotice);
    selection.on(model.applyNotice);
    // After `applyNotice`, so the row's frame is dropped before its place goes.
    followRows(rows, { removed: (sessionId) => places.delete(sessionId) });
    let titleMaxLength = api.settings().titleMaxLength;
    api.onSettingsChanged((settings) => {
      if (settings.titleMaxLength !== titleMaxLength) {
        titleMaxLength = settings.titleMaxLength;
        view.redrawRows();
      }
    });
    const exports = createExports(
      api,
      view,
      rowParts,
      barParts,
      sections,
      model.activate,
      model.labelOf,
      () => (model.isModeShown() ? view.panes.focusedSessionId() : null),
      () => isStopped,
    );

    // Gives the Sessions list the keys, the cursor on the selected row.
    const focusList = () => {
      api.keys.setScope('sidebar');
      const row = view.list.enter();
      log(
        row === null ? 'list focused, no rows' : `list focused on ${row.label}`,
      );
    };

    // Ends the list's turn and gives main's scope and keys back; `picked`
    // closes a narrow window's side bar overlay, so the keys never sit in a
    // pane under it. `leave` runs first, so the `sideBarHidden` it may cause
    // finds the list already left. A DOM focus already inside a pane stays,
    // as `endListByMain` leaves it: only main's scope is set again. A press
    // in another pane moves pane focus on its release, after this runs.
    const focusMain = () => {
      if (view.list.leave()) {
        log('list left');
        mode.picked();
      }
      if (view.panes.paneHolding(document.activeElement) !== null) {
        model.setMainScope();
      } else {
        keysToFocusedPane();
      }
    };

    // The first mode's `shown` runs inside `add`, before `mode` is assigned.
    const mode = api.modes.add({
      id: 'sessions',
      title: 'Sessions',
      icon: 'comment-discussion',
      element: view.element,
      sideBar: view.sideBar,
      shown() {
        model.setModeShown(true);
        api.panes.setOuterPanes(view.panes.outer);
        view.tabs.rescroll();
        model.checkVisible();
      },
      hidden() {
        model.setModeShown(false);
        view.list.leave();
        api.panes.setOuterPanes(null);
        model.checkVisible();
      },
      focusSideBar: focusList,
      focusMain,
      sideBarOpenedOver: focusList,
      sideBarHidden() {
        if (view.list.leave()) {
          log('list left');
          keysToFocusedPane();
        }
      },
    });

    // A press or a focus inside the chat panes ends the list's turn; the press
    // or the focus places the DOM focus itself.
    const endListByMain = () => {
      if (view.list.leave()) {
        log('list left');
        model.setMainScope();
      }
    };
    view.element.addEventListener('pointerdown', endListByMain, true);
    view.element.addEventListener('focusin', endListByMain);

    // The selection each press found as it began, so `panePressed` tells a
    // selection the press made from an older one. On `window`, as the pane
    // tree hears a press wherever it begins.
    let selectionAtPress: SelectionEnds | null = null;
    const noteSelectionAtPress = () => {
      selectionAtPress = selectionEnds(window.getSelection());
    };
    window.addEventListener('pointerdown', noteSelectionAtPress, true);

    // Main sends `activated` before the writes it causes, so the mode shows
    // before they arrive and the round never toasts.
    api.channel.on('activated', () => mode.show());

    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
        return;
      }
      mode.toggleSideBar();
    };

    // Steps the focused pane, in drawn order, over the sessions no other pane
    // shows; a key pressed in another mode belongs to that mode, so it does
    // nothing there.
    const stepToSession = (by: 1 | -1) => {
      if (!mode.isShown()) {
        log('session keys ignored: Sessions mode is hidden');
        return;
      }
      if (view.isPreviewShown()) {
        view.stepPreview(by);
        return;
      }
      const { panes } = view;
      const sessionId = stepSession(
        {
          ...model.state(),
          rows: view.orderedRows(),
          selectedSessionId: panes.focusedSessionId(),
        },
        by,
        shownElsewhere(panes.sessions(), panes.focusedPaneId()),
      );
      if (sessionId !== null) {
        exports.activate(sessionId);
      }
    };

    // The shown mode steps its own tabs first; in any other mode but Sessions
    // the keys do nothing.
    const stepToTab = (by: 1 | -1) => {
      if (api.modes.stepTab(by)) {
        return;
      }
      if (!mode.isShown()) {
        log('tab keys ignored: the shown mode has no tabs');
        return;
      }
      const sessionId = view.panes.focusedSessionId();
      if (sessionId === null) {
        return;
      }
      const tabs = view.tabs.tabsOf(sessionId);
      const selected = view.tabs.selectedTabOf(sessionId);
      const tabId = stepTab(
        tabs.map((tab) => tab.id),
        selected?.id ?? null,
        by,
      );
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (tab === undefined) {
        log(`no other tab in ${model.labelOf(sessionId)}`);
        return;
      }
      view.tabs.select(sessionId, tab.id);
      log(`showed ${tab.title} tab in ${model.labelOf(sessionId)}`);
    };

    // Hides the focused pane's session's open popup, else opens the one it hid
    // last; nothing while Sessions mode is hidden.
    const togglePopup = () => {
      if (!mode.isShown()) {
        log('popup key ignored: Sessions mode is hidden');
        return;
      }
      const sessionId = view.panes.focusedSessionId();
      if (sessionId === null) {
        log('no popup: no session shown');
        return;
      }
      const toggled = view.tabs.togglePopup(sessionId);
      if (toggled === null) {
        log(`no popup in ${model.labelOf(sessionId)}`);
        return;
      }
      log(
        popupToggledLine(
          toggled.popup.title,
          toggled.isOpen,
          model.labelOf(sessionId),
        ),
      );
    };

    const renameDialog = createRenameDialog({
      pushScope: () => api.keys.pushScope('rename'),
      setUserTitle: (sessionId, title) =>
        api.channel.invoke('setUserTitle', sessionId, title),
      titleMaxLength: () => api.settings().titleMaxLength,
      parts: view.parts,
      log,
    });
    api.areas.overlay.contribute(renameDialog.element);

    const picker = api.services.picker.create({ filter: true });

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readSessionsLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => {
        view.setLayouts(shown);
        renameDialog.redraw();
        picker.redraw();
        model.checkVisible(true);
      },
    });

    const openPreview = previewToggle(mode, view, log);

    // Acts on the run's target when it names one, showing Sessions mode first
    // since the dialog waits on the user's typing; else on the focused pane's
    // session, as `closeSession` does.
    const renameSession = ({ targetSessionId }: PageCommandContext) => {
      if (targetSessionId === undefined && !mode.isShown()) {
        log('rename ignored: Sessions mode is hidden');
        return;
      }
      const sessionId = targetSessionId ?? view.panes.focusedSessionId();
      const row = sessionId === null ? undefined : model.rowOf(sessionId);
      if (row === undefined) {
        log('no session to rename');
        return;
      }
      if (!mode.isShown()) {
        mode.show();
      }
      renameDialog.open(row);
    };

    // Runs a project key on the focused pane's session's project, as
    // `renameSession` with no target acts on its session.
    const projectKey = (run: (project: string) => void) => () => {
      if (!mode.isShown()) {
        log('projects ignored: Sessions mode is hidden');
        return;
      }
      const sessionId = view.panes.focusedSessionId();
      const row = sessionId === null ? undefined : model.rowOf(sessionId);
      if (row === undefined) {
        log('no session for projects');
        return;
      }
      run(row.project);
    };

    // Asks which session the new pane `paneId` shows: the sessions no pane
    // shows, in drawn order, then a new one when chat can start one. A cancel
    // while the pane still shows nothing closes it.
    const openSplitPicker = (paneId: string) => {
      const choices: PickerChoice[] = pickerRows(
        view.orderedRows(),
        view.panes.sessions(),
      ).map((row) => ({ kind: 'row', row }));
      if (api.keys.command('chat.newSession') !== undefined) {
        choices.push({ kind: 'new' });
      }
      const isPaneLive = () => leafIds(view.panes.tree()).includes(paneId);
      blurFocusedElement();
      picker.open<PickerChoice>({
        title: 'Show session',
        items: choices,
        label: (choice) =>
          choice.kind === 'row' ? choice.row.label : 'New session',
        drawRow(list, choice, input) {
          const drawn = view.parts.pickerRow(
            list,
            {
              item:
                choice.kind === 'row'
                  ? view.pickerItem(choice.row)
                  : { kind: 'new' },
              label: input.label,
            },
            input.trailing,
          );
          return { element: drawn.built.element, dispose: drawn.dispose };
        },
        chosen(choice) {
          if (!isPaneLive()) {
            return;
          }
          if (choice.kind === 'new') {
            api.commands.run('chat.newSession');
            return;
          }
          view.panes.load(paneId, choice.row.sessionId);
          log(`pane loaded ${choice.row.label}`);
          exports.activate(choice.row.sessionId);
        },
        cancelled() {
          const isStillEmpty =
            isPaneLive() && view.panes.sessions().get(paneId) === null;
          if (isStillEmpty) {
            view.panes.close(paneId);
            log('split cancelled');
            model.checkVisible(true);
          }
        },
      });
    };

    // Runs a pane key while Sessions mode shows; logs and does nothing while
    // it is hidden.
    const paneKey = (run: () => void) => () => {
      if (!mode.isShown()) {
        log('pane keys ignored: Sessions mode is hidden');
        return;
      }
      run();
    };

    // Runs a split or pane close unless the split picker is open: a split
    // would replace the picker's request and leave its empty pane open, and a
    // close could leave the picker over a closed pane.
    const unlessPicking = (run: () => void) => () => {
      if (picker.isOpen()) {
        log('pane keys ignored: the split picker is open');
        return;
      }
      run();
    };

    // Each pane key that changes the panes ends the restore (`closeWaiting`).
    const split = (axis: SplitAxis) => {
      const paneId = view.panes.split(axis);
      if (paneId === null) {
        log('pane too small to split');
        return;
      }
      log(`pane split ${axis === 'column' ? 'down' : 'right'}`);
      model.closeWaiting();
      openSplitPicker(paneId);
    };

    const closePane = () => {
      if (!view.panes.close(view.panes.focusedPaneId())) {
        log('last pane stays');
        return;
      }
      log('pane closed');
      model.closeWaiting();
      model.checkVisible(true);
    };

    const swapPane = (direction: PaneDirection) => {
      if (!view.panes.swap(direction)) {
        log(`no pane ${direction}`);
        return;
      }
      log('panes swapped');
      model.closeWaiting();
      model.checkVisible(true);
    };

    // Runs a list key while the side bar shows; a narrowing hides it without
    // telling, so a key then logs and does nothing.
    const listKey = (run: () => void) => () => {
      if (!mode.sideBarShown()) {
        log('list keys ignored: the side bar is hidden');
        return;
      }
      run();
    };

    const moveListCursor = (move: CursorMove) =>
      listKey(() => logListCursor(view.list.move(move)));

    // Runs a list key on main's row under the cursor; a layout preview row is
    // not main's.
    const cursorRowKey = (run: (row: SessionRow) => void) =>
      listKey(() => {
        const sessionId = view.list.cursorSessionId();
        const row = sessionId === null ? undefined : model.rowOf(sessionId);
        if (row === undefined) {
          log('no session under the cursor');
          return;
        }
        run(row);
      });

    return {
      commands: {
        showMode,
        openPreview,
        nextSession: () => stepToSession(1),
        prevSession: () => stepToSession(-1),
        nextTab: () => stepToTab(1),
        prevTab: () => stepToTab(-1),
        togglePopup,
        // Acts on the run's target when it names one, shown or not; else on the
        // focused pane's session, whichever box the key fired in, and never on
        // a row the user cannot see. The close key closes at once when a tab
        // or popup says so. A targeted run asks the tabs and popups at once,
        // since only an agent's run names a target and the user's Allow
        // confirmed it, but has main cancel no hold: the Allow did not cover
        // an open form's answers, so main's guards refuse that close.
        closeSession: ({ targetSessionId }: PageCommandContext) => {
          const isTargeted = targetSessionId !== undefined;
          if (!isTargeted && !mode.isShown()) {
            log('close ignored: Sessions mode is hidden');
            return;
          }
          const sessionId = targetSessionId ?? view.panes.focusedSessionId();
          if (sessionId !== null) {
            const isKeyAtOnce =
              !isTargeted &&
              closesAtOnce([
                ...view.tabs.tabsOf(sessionId),
                ...view.tabs.popupsOf(sessionId),
              ]);
            void closeSession(
              api,
              view,
              model.labelOf,
              sessionId,
              {
                viewsAtOnce: isTargeted || isKeyAtOnce,
                cancelsHolds: isKeyAtOnce,
              },
              () => isStopped,
            );
          }
        },
        splitDown: paneKey(unlessPicking(() => split('column'))),
        splitRight: paneKey(unlessPicking(() => split('row'))),
        closePane: paneKey(unlessPicking(closePane)),
        swapPaneLeft: paneKey(() => swapPane('left')),
        swapPaneRight: paneKey(() => swapPane('right')),
        swapPaneUp: paneKey(() => swapPane('up')),
        swapPaneDown: paneKey(() => swapPane('down')),
        ...listPickerCommands(picker),
        // Closes the side bar's overlay, as a row click picks in it.
        selectRow: ({ arg }: PageCommandContext<string>) => {
          exports.activate(arg);
          mode.picked();
        },
        // Logs no `showed` line: the tab keys log that.
        selectTab: ({
          arg,
        }: PageCommandContext<{ sessionId: string; tab: string }>) =>
          view.tabs.select(arg.sessionId, arg.tab),
        renameSession,
        renameAccept: () => renameDialog.accept(),
        renameCancel: () => renameDialog.cancel(),
        favoriteProject: projectKey((project) => view.toggleFavorite(project)),
        favoriteProjectAt: ({ arg }: PageCommandContext<string>) =>
          view.toggleFavorite(arg),
        moveProjectUp: projectKey((project) => view.moveFavorite(project, -1)),
        moveProjectDown: projectKey((project) => view.moveFavorite(project, 1)),
        listDown: moveListCursor(1),
        listUp: moveListCursor(-1),
        listTop: moveListCursor('first'),
        listBottom: moveListCursor('last'),
        listOpen: cursorRowKey((row) => {
          exports.activate(row.sessionId);
          focusMain();
        }),
        listShow: cursorRowKey((row) => exports.activate(row.sessionId)),
        listBack: focusMain,
        listFavorite: cursorRowKey((row) => view.toggleFavorite(row.project)),
        listMoveUp: cursorRowKey((row) => view.moveFavorite(row.project, -1)),
        listMoveDown: cursorRowKey((row) => view.moveFavorite(row.project, 1)),
        listRename: cursorRowKey((row) => renameDialog.open(row)),
        listClose: cursorRowKey((row) => {
          void exports.closeSession(row.sessionId).then(() => {
            if (!isStopped) {
              view.list.refocus();
            }
          });
        }),
      },
      exports: (consumer) =>
        sessionsPageView(exports, consumer, (listener) =>
          followRows(rows, { removed: listener }),
        ),
      ready() {
        model.ready();
      },
      dispose() {
        isStopped = true;
        window.removeEventListener('pointerdown', noteSelectionAtPress, true);
        view.dispose();
      },
    };
  },
};
