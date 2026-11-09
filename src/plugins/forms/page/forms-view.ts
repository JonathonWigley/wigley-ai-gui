import type { Timers } from '../../../contracts/ambient';
import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { PageDrops } from '../../../contracts/drops';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { ResizeTarget } from '../../../contracts/panes';
import type { OsName } from '../../../contracts/platform';
import type {
  KeyHints,
  PluginAreas,
  PushedScope,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import type { LayoutState } from '../../../contracts/state';
import type { UiState } from '../../../contracts/ui-state';
import { callEach } from '../../../shared/call-each';
import { createConfirmPrompt } from '../../../shared/page/confirm-prompt';
import {
  boxDropTake,
  type EditorBoxes,
} from '../../../shared/page/editor-boxes';
import {
  createSessionFormPopups,
  type SessionFormPopups,
} from '../../../shared/page/session-form-popups';
import {
  activeForm,
  formOfSession,
  sessionPaneView,
} from '../../../shared/page/session-forms';
import {
  NEEDS_YOU_ACTIVITY,
  type SessionsPageExports,
} from '../../sessions/contract';
import type { RoundPlace } from '../contract';
import { formsCommand, formsScope } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { type BoxRef, isBoxInRoundView, isBoxShown } from './boxes';
import type { FormsContributions } from './contributions';
import {
  type FormsAction,
  type FormsState,
  type FormsStore,
  type RoundState,
} from './form-state';
import type { KitCommands } from '../../../shared/page/layout-host/base-kit';
import { createRoundView, type RoundView } from './round-view';
import { sessionTitle } from './view-model';

// `closesAtOnce` says whether the close key ends the session's round with it;
// `beforeClose` answers whether the session may close. `setScope` sets the
// key scope to the forms view while a form popup is the visible surface, and
// `setResizeTarget` then sets the divider the resize keys move: the shown
// round's split, or null while idle. `pushConfirmScope` lays the cancel
// prompt's scope over it. `platform` is the OS key hints are drawn for;
// `uiState` keeps the rail's dragged width, which every round's rail opens at;
// `timers` runs each round's split resize prompt linger. `commands`,
// `contributions` and `state` reach every round view's kits and cards. Each
// round view is a drop target through `drops`, typing files into the round's
// box used last. `savedPlaces` holds the places the last page saved, read once
// at start: a round it holds was shown before the reload, and its popup comes
// back hidden or shown as that page left it.
export interface FormsViewDeps {
  areas: Pick<PluginAreas, 'overlay'>;
  sessions: Pick<
    SessionsPageExports,
    'addPopup' | 'addRowPart' | 'setActivity'
  >;
  closesAtOnce(sessionId: string): boolean;
  beforeClose(sessionId: string): boolean;
  setScope(view: FormsState['view']): void;
  setResizeTarget(target: ResizeTarget | null): void;
  pushConfirmScope(): PushedScope;
  store: FormsStore;
  boxes: EditorBoxes<BoxRef>;
  markdown: MarkdownRenderer;
  keys: Pick<KeyHints, 'keysFor' | 'onKeymapChanged' | 'anchor'>;
  run(command: CommandId): void;
  commands: KitCommands;
  contributions: Pick<FormsContributions, 'cardParts' | 'reviewColumns'>;
  platform: OsName;
  state: LayoutState;
  uiState: UiState;
  timers: Timers;
  drops: Pick<PageDrops, 'addTarget' | 'savePasted'>;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
  savedPlaces: ReadonlyMap<string, RoundPlace>;
}

// The layouts every round view picks its cards and panes from.
interface ActiveLayouts {
  shown: ShownLayouts<Layout>;
}

// `forgetSession` drops a session's form popup entry and destroys its round
// views once sessions dropped the popup, so the next render rebuilds a round
// still open for the session in a new form popup. `setLayouts` hands `shown` to every open round
// view, which rebuilds when a layout it draws with changed, and rounds that
// open later are built with it. A round view's throw does not skip the rest;
// the first is rethrown once all have run. `rebuild` rebuilds every open round
// view with the layouts it holds, keeping its answers, as after a card part or
// review column is added or removed.
// `scrollBy` scrolls the active round's main column by `step`, down for 1 and
// up for -1; null when no round is active or it has no view yet. `dispose`
// destroys every open round view.
export interface FormsView {
  forgetSession(sessionId: string): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  rebuild(): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
  dispose(): void;
}

// The whole forms UI: each round drawn in its session's form popup, focused or
// not, and the cancel prompt in the overlay layer, serving the active round,
// which alone takes keys. Every store change re-renders it; editors live in
// the round views and survive every render. While a form popup is the
// visible surface the key scope follows the view; the cancel prompt pushes its
// own scope over it and is dismissed when another view sets the scope. While
// the round sends, that dismiss waits: a failed send dismisses the prompt, and
// a sent round closes it with the round. Round views start on the default
// layout alone.
export function mountFormsView(deps: FormsViewDeps): FormsView {
  const { areas, store, boxes } = deps;
  const popups = createSessionFormPopups({
    addPopup: (sessionId, popup, options) =>
      deps.sessions.addPopup(sessionId, popup, options),
    popupId: 'form',
    title: 'Form',
    icon: 'checklist',
    className: 'form-tab',
    statusPartId: 'forms.status',
    closesAtOnce: (sessionId) => deps.closesAtOnce(sessionId),
    beforeClose: (sessionId) => deps.beforeClose(sessionId),
    shown: () => setBaseScope(deps.store.get()),
    formShown: (sessionId, shown) =>
      deps.sessions.setActivity(
        sessionId,
        'forms',
        shown ? NEEDS_YOU_ACTIVITY : null,
      ),
  });
  const statusPart = deps.sessions.addRowPart(popups.statusPart);
  const dispatch = (action: FormsAction) => store.dispatch(action);
  const confirm = createConfirmPrompt({
    title: 'Cancel this round?',
    body: 'The agent is told the round was cancelled. Your answers stay saved.',
    keep: { label: 'Keep answering', command: formsCommand('dismissConfirm') },
    confirm: { label: 'Cancel round', command: formsCommand('confirmCancel') },
    scope: formsScope('confirm'),
    keys: deps.keys,
    run: (command) => deps.run(command),
    pushScope: () => deps.pushConfirmScope(),
    isAsked: () => store.get().view === 'confirm',
    isSending: () => (activeForm(store.get())?.sending ?? null) !== null,
    dismiss: () => dispatch({ type: 'dismissConfirm' }),
    log: deps.log,
  });
  areas.overlay.contribute(confirm.element);
  const roundViews = new Map<string, RoundView>();
  const shownRounds: RoundViews = { views: roundViews, dropTargets: new Map() };
  // Sets the key scope to the state's view, then the resize target to the
  // shown round's split; the core drops the target on each change of the base
  // scope.
  const setBaseScope = (state: FormsState) => {
    deps.setScope(state.view);
    const round = state.view === 'idle' ? null : activeForm(state);
    const roundView = round === null ? undefined : roundViews.get(round.formId);
    deps.setResizeTarget(roundView?.resizeTarget ?? null);
  };
  const active: ActiveLayouts = {
    shown: {
      layouts: new Map<string, Layout>([['default', defaultLayout]]),
      user: 'default',
    },
  };

  const render = () => {
    if (!confirm.settleOwedDismiss()) {
      return;
    }
    const state = store.get();
    syncRoundViews(state, shownRounds, popups, active, deps);
    popups.sync((sessionId) => {
      const round = formOfSession(state, sessionId);
      return round === undefined ? null : sessionTitle(round);
    });
    for (const round of state.forms) {
      roundViews
        .get(round.formId)
        ?.update(round, sessionPaneView(state, round.sessionId, 'forms'));
    }
    confirm.setBaseScope(() => {
      if (popups.isShown()) {
        setBaseScope(state);
      }
    });
    const box = boxes.active();
    if (box !== null && !isBoxShown(state, box)) {
      boxes.leave();
    }
  };
  const storeSubscription = store.subscribe(render);
  render();
  return {
    forgetSession(sessionId) {
      popups.forget(sessionId);
      destroySessionRoundViews(sessionId, store.get(), shownRounds, deps);
    },
    setLayouts(shown) {
      active.shown = shown;
      callEach(store.get().forms, (round) =>
        roundViews.get(round.formId)?.setLayouts(shown, round),
      );
    },
    rebuild() {
      for (const round of store.get().forms) {
        roundViews.get(round.formId)?.rebuild(round);
      }
    },
    scrollBy(step, direction) {
      const round = activeForm(store.get());
      const roundView =
        round === null ? undefined : roundViews.get(round.formId);
      return roundView?.scrollBy(step, direction) ?? null;
    },
    dispose() {
      statusPart.dispose();
      storeSubscription.dispose();
      for (const roundId of roundViews.keys()) {
        destroyRoundView(roundId, shownRounds, deps);
      }
    },
  };
}

// The open rounds' views, and the drop target each view's element is, by
// round.
interface RoundViews {
  views: Map<string, RoundView>;
  dropTargets: Map<string, Disposable>;
}

// A round view per open round, in its session's form popup: built when the
// round appears, opening the popup, which is added when the session has none,
// restored hidden or shown as the last page left it for a round that page
// showed, and registered as a drop target; destroyed with its editors when the
// round leaves.
function syncRoundViews(
  state: FormsState,
  roundViews: RoundViews,
  popups: SessionFormPopups,
  active: ActiveLayouts,
  deps: FormsViewDeps,
) {
  for (const roundId of roundViews.views.keys()) {
    if (!state.forms.some((round) => round.formId === roundId)) {
      destroyRoundView(roundId, roundViews, deps);
    }
  }
  for (const round of state.forms) {
    if (!roundViews.views.has(round.formId)) {
      const roundView = showRound(round, popups, active, deps);
      roundViews.views.set(round.formId, roundView);
      roundViews.dropTargets.set(
        round.formId,
        addRoundDropTarget(round.formId, roundView, deps),
      );
    }
  }
}

// Files dropped or pasted on the round view go into the round's box used
// last, else its first box mounted, whether or not its pane has focus.
function addRoundDropTarget(
  roundId: string,
  roundView: RoundView,
  deps: FormsViewDeps,
): Disposable {
  const isShown = (box: BoxRef) => isBoxInRoundView(deps.store.get(), box);
  return deps.drops.addTarget({
    element: roundView.element,
    take: boxDropTake(() => deps.boxes.fileEditor(roundId, isShown), {
      savePasted: (file) => deps.drops.savePasted(file),
      toast: (text, tone) => deps.toast(text, tone),
      log: deps.log,
    }),
  });
}

function destroySessionRoundViews(
  sessionId: string,
  state: FormsState,
  roundViews: RoundViews,
  deps: Pick<FormsViewDeps, 'boxes'>,
) {
  for (const round of state.forms) {
    if (round.sessionId === sessionId && roundViews.views.has(round.formId)) {
      destroyRoundView(round.formId, roundViews, deps);
    }
  }
}

// Destroys the round's editors and forgets its boxes, disposes its drop
// target, removes its view, and disposes its anchors and stops it following
// keymap changes.
function destroyRoundView(
  roundId: string,
  roundViews: RoundViews,
  deps: Pick<FormsViewDeps, 'boxes'>,
) {
  deps.boxes.destroyForm(roundId);
  deps.boxes.forgetForm(roundId);
  roundViews.dropTargets.get(roundId)?.dispose();
  roundViews.dropTargets.delete(roundId);
  const roundView = roundViews.views.get(roundId);
  roundView?.dispose();
  roundView?.element.remove();
  roundViews.views.delete(roundId);
}

function showRound(
  round: RoundState,
  popups: SessionFormPopups,
  active: ActiveLayouts,
  deps: FormsViewDeps,
): RoundView {
  return createRoundView(
    (root) =>
      popups.mount(round.sessionId, root, deps.savedPlaces.has(round.formId)),
    round,
    active.shown,
    {
      markdown: deps.markdown,
      boxes: deps.boxes,
      keys: deps.keys,
      run: deps.run,
      commands: deps.commands,
      contributions: deps.contributions,
      platform: deps.platform,
      state: deps.state,
      uiState: deps.uiState,
      timers: deps.timers,
      log: deps.log,
    },
  );
}
