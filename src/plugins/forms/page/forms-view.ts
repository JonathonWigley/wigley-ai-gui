import type { CommandId } from '../../../contracts/commands';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Platform } from '../../../contracts/platform';
import type {
  PluginAreas,
  PushedScope,
  ShownLayouts,
} from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { createConfirmPrompt } from '../../../shared/page/confirm-prompt';
import type { EditorBoxes } from '../../../shared/page/editor-boxes';
import {
  createSessionFormTabs,
  type SessionFormTabs,
} from '../../../shared/page/session-form-tabs';
import {
  activeForm,
  formOfSession,
  paneView,
} from '../../../shared/page/session-forms';
import type { KeysPageExports } from '../../keys/contract';
import type { SessionsPageExports } from '../../sessions/contract';
import { formsCommand, formsScope } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { type BoxRef, isBoxShown } from './boxes';
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

// `beforeClose` answers whether a session may close now. `setScope` sets the
// key scope to the forms view while a Form tab is the visible tab;
// `pushConfirmScope` lays the cancel prompt's scope over it. `platform` is the
// OS key hints are drawn for; `uiState` keeps the rail's dragged width, which
// every round's rail opens at. `commands` and `contributions` reach every
// round view's kits and cards.
export interface FormsViewDeps {
  areas: Pick<PluginAreas, 'overlay'>;
  sessions: Pick<SessionsPageExports, 'addTab'>;
  beforeClose(sessionId: string): boolean;
  setScope(view: FormsState['view']): void;
  pushConfirmScope(): PushedScope;
  store: FormsStore;
  boxes: EditorBoxes<BoxRef>;
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged' | 'anchor'>;
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

// The whole forms UI: each round in its session's Form tab and the cancel
// prompt in the overlay layer, both serving the active round. Every store
// change re-renders it; editors live in the round views and survive every
// render. While a Form tab is the visible tab the key scope follows the view;
// the cancel prompt pushes its own scope over it and is dismissed when another
// view sets the scope. While the round sends, that dismiss waits: a failed
// send dismisses the prompt, and a sent round closes it with the round. Round
// views start on the default layout alone.
export function mountFormsView(deps: FormsViewDeps): FormsView {
  const { areas, store, boxes } = deps;
  const tabs = createSessionFormTabs({
    addTab: (sessionId, tab) => deps.sessions.addTab(sessionId, tab),
    tabId: 'form',
    title: 'Form',
    className: 'form-tab',
    idleText: "No round open. The agent's next round opens here.",
    beforeClose: (sessionId) => deps.beforeClose(sessionId),
    shown: () => deps.setScope(deps.store.get().view),
  });
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
    logSource: 'forms',
  });
  areas.overlay.contribute(confirm.element);
  const roundViews = new Map<string, RoundView>();
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
    syncRoundViews(state, roundViews, tabs, active, deps, dispatch);
    tabs.sync((sessionId) => {
      const round = formOfSession(state, sessionId);
      return round === undefined ? null : sessionTitle(round);
    });
    const view = state.view;
    const shown = view === 'idle' ? null : activeForm(state);
    for (const [roundId, roundView] of roundViews) {
      roundView.element.hidden = roundId !== shown?.formId;
    }
    if (shown !== null) {
      roundViews.get(shown.formId)?.update(shown, paneView(state));
    }
    confirm.setBaseScope(() => {
      if (tabs.isShown()) {
        deps.setScope(view);
      }
    });
    const box = boxes.active();
    if (box !== null && !isBoxShown(state, box)) {
      boxes.leave();
    }
  };
  store.subscribe(render);
  render();
  return {
    forgetSession(sessionId) {
      tabs.forget(sessionId);
      destroySessionRoundViews(sessionId, store.get(), roundViews, tabs, deps);
    },
    showForm: (sessionId) => tabs.select(sessionId),
    setLayouts(shown) {
      active.shown = shown;
      for (const round of store.get().forms) {
        roundViews.get(round.formId)?.setLayouts(shown, round);
      }
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
  };
}

// A round view per open round, in its session's Form tab: built when the
// round appears, adding the Form tab when the session has none and taking
// over the session with it; destroyed with its editors when the round leaves.
function syncRoundViews(
  state: FormsState,
  roundViews: Map<string, RoundView>,
  tabs: SessionFormTabs,
  active: ActiveLayouts,
  deps: FormsViewDeps,
  dispatch: (action: FormsAction) => void,
) {
  for (const roundId of roundViews.keys()) {
    if (!state.forms.some((round) => round.formId === roundId)) {
      destroyRoundView(roundId, roundViews, tabs, deps);
    }
  }
  for (const round of state.forms) {
    if (!roundViews.has(round.formId)) {
      roundViews.set(
        round.formId,
        showRound(round, tabs, active, deps, dispatch),
      );
      tabs.takeOver(round.formId, round.sessionId);
    }
  }
}

function destroySessionRoundViews(
  sessionId: string,
  state: FormsState,
  roundViews: Map<string, RoundView>,
  tabs: SessionFormTabs,
  deps: Pick<FormsViewDeps, 'boxes'>,
) {
  for (const round of state.forms) {
    if (round.sessionId === sessionId && roundViews.has(round.formId)) {
      destroyRoundView(round.formId, roundViews, tabs, deps);
    }
  }
}

// Destroys the round's editors, removes its view, disposes its anchors and
// stops it following keymap changes, and releases its take over, giving its
// session back.
function destroyRoundView(
  roundId: string,
  roundViews: Map<string, RoundView>,
  tabs: SessionFormTabs,
  deps: Pick<FormsViewDeps, 'boxes'>,
) {
  deps.boxes.destroyForm(roundId);
  const roundView = roundViews.get(roundId);
  roundView?.dispose();
  roundView?.element.remove();
  roundViews.delete(roundId);
  tabs.release(roundId);
}

function showRound(
  round: RoundState,
  tabs: SessionFormTabs,
  active: ActiveLayouts,
  deps: FormsViewDeps,
  dispatch: (action: FormsAction) => void,
): RoundView {
  return createRoundView(
    (root) => tabs.mount(round.sessionId, root),
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
