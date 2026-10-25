import type { CommandId } from '../../../contracts/commands';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Platform } from '../../../contracts/platform';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { element } from '../../../shared/page/dom';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import { createDialog, type Dialog } from '../../../shared/page/ui/dialog';
import type { ShownLayouts } from '../../../shared/page/layout-loader';
import { emptyState } from '../../../shared/page/ui/empty-state';
import { modeLabel } from '../../../shared/vim-mode-label';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageExports,
  SessionTabHandle,
} from '../../sessions/contract';
import { type FormsCommandName, formsCommand, formsScope } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { isBoxShown } from './boxes';
import type { FormsContributions } from './contributions';
import type { EditorBoxes } from './editor-boxes';
import { appendKeyHint } from './kinds/card-parts';
import {
  activeRound,
  type FormsAction,
  type FormsState,
  type RoundState,
  roundOfSession,
} from './form-state';
import type { FormsStore } from './forms-store';
import type { KitCommands } from './layout/kit-commands';
import { createRoundView, type RoundView } from './round-view';
import { roundSaveLabel, roundSaveState, sessionTitle } from './view-model';

// `beforeClose` answers whether a session may close now. `setScope` sets the
// key scope to the forms view while a Form tab is the visible tab;
// `pushConfirmScope` lays the cancel prompt's scope over it. `platform` is the
// OS key hints are drawn for; `uiState` keeps the rail's dragged width, which
// every round's rail opens at. `onViewChanged` hears each change that can move
// the visible view off or onto a Form tab: a key scope or mode change. The
// status line shows only over a Form tab, and is rechecked on each store
// render, box change, scope or mode change, and base change under the
// cancel prompt. `commands` and `contributions` reach every round view's kits
// and cards.
export interface FormsViewDeps {
  areas: Pick<PluginAreas, 'statusBar' | 'overlay'>;
  sessions: Pick<SessionsPageExports, 'addTab'>;
  beforeClose(sessionId: string): boolean;
  setScope(view: FormsState['view']): void;
  onViewChanged(listener: () => void): void;
  pushConfirmScope(): PushedScope;
  store: FormsStore;
  boxes: EditorBoxes;
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  run(command: CommandId): void;
  commands: KitCommands;
  contributions: Pick<FormsContributions, 'cardParts' | 'reviewColumns'>;
  platform: Platform;
  uiState: UiState;
  log: Log;
}

// The layouts every round view picks its cards and panes from.
interface ActiveLayouts {
  shown: ShownLayouts<Layout>;
}

// `forgetSession` drops a session's Form tab entry and destroys its round
// views once sessions dropped the tab, so the next render rebuilds a round
// still open for the session in a new Form tab. `showForm` selects the
// session's Form tab, a no-op when it has none. `setLayouts` hands `shown` to
// every open round view, which rebuilds when a layout it draws with changed,
// and rounds that open later are built with it. `rebuild` rebuilds every open
// round view with the layouts it holds, keeping its answers, as after a card
// part or review column is added or removed.
// `scrollBy` scrolls the active round's main column by `step`, down for 1 and
// up for -1; null when no round is active or it has no view yet.
export interface FormsView {
  forgetSession(sessionId: string): void;
  showForm(sessionId: string): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  rebuild(): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
}

// A session's Form tab: it holds the session's round views and the idle
// state, with the status last sent to the session's row.
interface FormTab {
  handle: SessionTabHandle;
  element: HTMLElement;
  idle: HTMLElement;
  status: string;
}

// The whole forms UI: each round in its session's Form tab, the status line in
// the status bar, the cancel prompt in the overlay layer, all serving the
// active round. Every store change re-renders it; editors live in the round
// views and survive every render. While a Form tab is the visible tab the
// status line shows and the key scope follows the view; the cancel prompt
// pushes its own scope over it and is dismissed when another view sets the
// scope. While the round sends, that dismiss waits: a failed send dismisses
// the prompt, and a sent round closes it with the round. Round views start on
// the default layout alone.
export function mountFormsView(deps: FormsViewDeps): FormsView {
  const { areas, store, boxes } = deps;
  const status = buildStatusLine(deps);
  const confirm = buildConfirm(deps);
  areas.statusBar.contribute(status.element);
  areas.overlay.contribute(confirm.element);
  const roundViews = new Map<string, RoundView>();
  const formTabs = new Map<string, FormTab>();
  const takeOvers: TakeOvers = new Map();
  const dispatch = (action: FormsAction) => store.dispatch(action);
  const active: ActiveLayouts = {
    shown: {
      layouts: new Map<string, Layout>([['default', defaultLayout]]),
      user: 'default',
    },
  };
  // The cancel prompt's pushed scope while the prompt shows, else null.
  let confirmScope: PushedScope | null = null;
  // Whether the base scope changed while the prompt's round was sending, so
  // the prompt is dismissed once the send fails.
  let isDismissOwed = false;
  const isFormShown = () =>
    [...formTabs.values()].some((tab) => tab.handle.isVisible());
  const pushConfirmScope = () => {
    const pushed = deps.pushConfirmScope();
    pushed.onBaseChanged(() => {
      // Under the pushed scope a base change reaches no onViewChanged.
      updateStatus();
      if (confirmScope !== pushed) {
        return;
      }
      dispatch({ type: 'dismissConfirm' });
      if (store.get().view !== 'confirm') {
        deps.log('forms', 'cancel prompt dismissed: the view moved on');
      } else if ((activeRound(store.get())?.sending ?? null) !== null) {
        isDismissOwed = true;
      }
    });
    confirmScope = pushed;
  };

  const render = () => {
    const state = store.get();
    if (state.view !== 'confirm') {
      isDismissOwed = false;
    } else if (isDismissOwed && activeRound(state)?.sending === null) {
      isDismissOwed = false;
      dispatch({ type: 'dismissConfirm' });
      deps.log('forms', 'cancel prompt dismissed: the view moved on');
      return;
    }
    syncRoundViews(
      state,
      roundViews,
      formTabs,
      takeOvers,
      active,
      deps,
      dispatch,
    );
    syncFormTabs(state, formTabs);
    const view = state.view;
    const shown = view === 'idle' ? null : activeRound(state);
    for (const [roundId, roundView] of roundViews) {
      roundView.element.hidden = roundId !== shown?.roundId;
    }
    if (shown !== null) {
      roundViews.get(shown.roundId)?.update(shown, view);
    }
    // The prompt's scope comes off before the base changes, so forms' own view
    // change never reaches its listener, and goes on after, over `confirm`.
    if (view !== 'confirm' && confirmScope !== null) {
      confirm.hide();
      confirmScope.pop();
      confirmScope = null;
    }
    if (isFormShown()) {
      deps.setScope(view);
    }
    if (view === 'confirm' && confirmScope === null) {
      confirm.show();
      pushConfirmScope();
    }
    status.update(state, isFormShown());
    const box = boxes.active();
    if (box !== null && !isBoxShown(state, box)) {
      boxes.leave();
    }
  };
  const updateStatus = () => status.update(store.get(), isFormShown());
  store.subscribe(render);
  boxes.onChange(updateStatus);
  deps.onViewChanged(updateStatus);
  render();
  return {
    forgetSession(sessionId) {
      formTabs.delete(sessionId);
      destroySessionRoundViews(
        sessionId,
        store.get(),
        roundViews,
        takeOvers,
        deps,
      );
    },
    showForm: (sessionId) => formTabs.get(sessionId)?.handle.select(),
    setLayouts(shown) {
      active.shown = shown;
      for (const round of store.get().rounds) {
        roundViews.get(round.roundId)?.setLayouts(shown, round);
      }
    },
    rebuild() {
      for (const round of store.get().rounds) {
        roundViews.get(round.roundId)?.rebuild(round);
      }
    },
    scrollBy(step, direction) {
      const round = activeRound(store.get());
      const roundView =
        round === null ? undefined : roundViews.get(round.roundId);
      return roundView?.scrollBy(step, direction) ?? null;
    },
  };
}

// Each open round's take over of its session's tabs, by round id.
type TakeOvers = Map<string, { release(): void }>;

// A round view per open round, in its session's Form tab: built when the
// round appears, adding the Form tab when the session has none and taking
// over the session with it; destroyed with its editors when the round leaves.
function syncRoundViews(
  state: FormsState,
  roundViews: Map<string, RoundView>,
  formTabs: Map<string, FormTab>,
  takeOvers: TakeOvers,
  active: ActiveLayouts,
  deps: FormsViewDeps,
  dispatch: (action: FormsAction) => void,
) {
  for (const roundId of roundViews.keys()) {
    if (!state.rounds.some((round) => round.roundId === roundId)) {
      destroyRoundView(roundId, roundViews, takeOvers, deps);
    }
  }
  for (const round of state.rounds) {
    if (!roundViews.has(round.roundId)) {
      const formTab = formTabOf(round.sessionId, formTabs, deps);
      roundViews.set(
        round.roundId,
        showRound(round, formTab, active, deps, dispatch),
      );
      takeOvers.set(round.roundId, formTab.handle.takeOver());
    }
  }
}

function destroySessionRoundViews(
  sessionId: string,
  state: FormsState,
  roundViews: Map<string, RoundView>,
  takeOvers: TakeOvers,
  deps: Pick<FormsViewDeps, 'boxes'>,
) {
  for (const round of state.rounds) {
    if (round.sessionId === sessionId && roundViews.has(round.roundId)) {
      destroyRoundView(round.roundId, roundViews, takeOvers, deps);
    }
  }
}

// Destroys the round's editors, removes its view and stops it following
// keymap changes, and releases its take over, giving its session back.
function destroyRoundView(
  roundId: string,
  roundViews: Map<string, RoundView>,
  takeOvers: TakeOvers,
  deps: Pick<FormsViewDeps, 'boxes'>,
) {
  deps.boxes.destroyRound(roundId);
  const roundView = roundViews.get(roundId);
  roundView?.dispose();
  roundView?.element.remove();
  roundViews.delete(roundId);
  takeOvers.get(roundId)?.release();
  takeOvers.delete(roundId);
}

function formTabOf(
  sessionId: string,
  formTabs: Map<string, FormTab>,
  deps: FormsViewDeps,
): FormTab {
  const existing = formTabs.get(sessionId);
  if (existing !== undefined) {
    return existing;
  }
  const tab = element('div', 'form-tab');
  const idle = emptyState("No round open. The agent's next round opens here.");
  tab.append(idle);
  const handle = deps.sessions.addTab(sessionId, {
    id: 'form',
    title: 'Form',
    element: tab,
    beforeClose: () => deps.beforeClose(sessionId),
    shown: () => deps.setScope(deps.store.get().view),
  });
  const created: FormTab = { handle, element: tab, idle, status: '' };
  formTabs.set(sessionId, created);
  return created;
}

function showRound(
  round: RoundState,
  formTab: FormTab,
  active: ActiveLayouts,
  deps: FormsViewDeps,
  dispatch: (action: FormsAction) => void,
): RoundView {
  return createRoundView(
    (root) => formTab.element.insertBefore(root, formTab.idle),
    round,
    active.shown,
    {
      markdown: deps.markdown,
      boxes: deps.boxes,
      keys: deps.keys,
      dispatch,
      getState: deps.store.get,
      run: deps.run,
      commands: deps.commands,
      contributions: deps.contributions,
      platform: deps.platform,
      uiState: deps.uiState,
      log: deps.log,
    },
  );
}

// Shows each Form tab's idle state while its session has no round, and
// sends the tab's status, the round's title or '' with none, when it changed.
function syncFormTabs(state: FormsState, formTabs: Map<string, FormTab>) {
  for (const [sessionId, formTab] of formTabs) {
    const round = roundOfSession(state, sessionId);
    formTab.idle.hidden = round !== undefined;
    const status = round === undefined ? '' : sessionTitle(round);
    if (formTab.status !== status) {
      formTab.status = status;
      formTab.handle.setStatus(status);
    }
  }
}

// The status line, hidden while no Form tab is the visible tab.
function buildStatusLine(deps: FormsViewDeps): {
  element: HTMLElement;
  update(state: FormsState, isShown: boolean): void;
} {
  const bar = element('footer', 'status-line');
  const mode = element('span', 'status-mode');
  const save = element('span', 'status-save');
  bar.append(mode, save);
  return {
    element: bar,
    update(state, isShown) {
      bar.hidden = !isShown;
      mode.textContent = modeLabel(deps.boxes.activeMode());
      const round = activeRound(state);
      const roundSave = round === null ? null : roundSaveState(round);
      save.textContent = round === null ? '' : roundSaveLabel(round);
      save.dataset.state = roundSave ?? '';
    },
  };
}

// The cancel prompt, the safe action first; each button shows the confirm
// scope's keys for it, and shows them again after each keymap change, for as
// long as the page lives, as the prompt does.
function buildConfirm(
  deps: Pick<FormsViewDeps, 'keys' | 'run' | 'platform'>,
): Dialog {
  const dialog = createDialog('Cancel this round?');
  const confirmButton = (
    label: string,
    command: FormsCommandName,
    variant: ButtonVariant,
  ) => {
    const control = textButton(label, () => deps.run(formsCommand(command)), {
      variant,
    });
    const redrawKeys = appendKeyHint(
      control,
      () => deps.keys.keysFor(formsCommand(command), formsScope('confirm')),
      deps.platform,
    );
    deps.keys.onChanged(redrawKeys);
    return control;
  };
  dialog.body.append(
    element(
      'p',
      '',
      'The agent is told the round was cancelled. Your answers stay saved.',
    ),
  );
  dialog.actions.append(
    confirmButton('Keep answering', 'dismissConfirm', 'secondary'),
    confirmButton('Cancel round', 'confirmCancel', 'danger'),
  );
  return dialog;
}
