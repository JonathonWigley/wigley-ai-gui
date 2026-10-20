import type { CommandId } from '../../../contracts/commands';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { PluginAreas } from '../../../contracts/plugin';
import { appendKeys, button, element } from '../../../shared/page/dom';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageExports,
  SessionTabHandle,
} from '../../sessions/contract';
import { type FormsCommandName, formsCommand, formsScope } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { isBoxShown } from './boxes';
import type { EditorBoxes } from './editor-boxes';
import {
  activeRound,
  type FormsAction,
  type FormsState,
  type RoundState,
  roundOfSession,
  saveState,
} from './form-state';
import type { FormsStore } from './forms-store';
import { createRoundView, type RoundView } from './round-view';
import { modeLabel, saveLabel, sessionTitle } from './view-model';

// `beforeClose` answers whether a session may close now; `formShown` runs
// each time a session's Form tab becomes the visible tab.
export interface FormsViewDeps {
  areas: Pick<PluginAreas, 'statusBar' | 'overlay'>;
  sessions: Pick<SessionsPageExports, 'addTab'>;
  beforeClose(sessionId: string): boolean;
  formShown(): void;
  store: FormsStore;
  boxes: EditorBoxes;
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'keysFor'>;
  run(command: CommandId): void;
  log: Log;
}

// The layout every round view builds its cards with, and its name.
interface ActiveLayout {
  layout: Layout;
  name: string;
}

// `forgetSession` drops a session's Form tab entry and destroys its round
// views once sessions dropped the tab, so the next render rebuilds a round
// still open for the session in a new Form tab. `showForm` selects the
// session's Form tab, a no-op when it has none. `isFormShown` reads whether a
// Form tab is the visible tab. `setLayout` rebuilds every open round view with
// `layout`, and rounds that open later are built with it.
export interface FormsView {
  forgetSession(sessionId: string): void;
  showForm(sessionId: string): void;
  isFormShown(): boolean;
  setLayout(layout: Layout, layoutName: string): void;
}

// A session's Form tab: it holds the session's round views and the idle
// section, with the status last sent to the session's row.
interface FormTab {
  handle: SessionTabHandle;
  element: HTMLElement;
  idle: HTMLElement;
  status: string;
}

// The whole forms UI: each round in its session's Form tab, the status line in
// the status bar, the cancel prompt in the overlay layer, all serving the
// active round. Every store change re-renders it; editors live in the round
// views and survive every render. Round views start on the default layout.
export function mountFormsView(deps: FormsViewDeps): FormsView {
  const { areas, store, boxes } = deps;
  const status = buildStatusLine(deps);
  const confirm = buildConfirm(deps);
  areas.statusBar.contribute(status.element);
  areas.overlay.contribute(confirm);
  const roundViews = new Map<string, RoundView>();
  const formTabs = new Map<string, FormTab>();
  const dispatch = (action: FormsAction) => store.dispatch(action);
  const active: ActiveLayout = { layout: defaultLayout, name: 'default' };

  const render = () => {
    const state = store.get();
    syncRoundViews(state, roundViews, formTabs, active, deps, dispatch);
    syncFormTabs(state, formTabs);
    const view = state.view;
    const shown = view === 'idle' ? null : activeRound(state);
    for (const [roundId, roundView] of roundViews) {
      roundView.element.hidden = roundId !== shown?.roundId;
    }
    if (shown !== null) {
      roundViews.get(shown.roundId)?.update(shown, view);
    }
    confirm.hidden = view !== 'confirm';
    status.update(state);
    const box = boxes.active();
    if (box !== null && !isBoxShown(state, box)) {
      boxes.leave();
    }
  };
  store.subscribe(render);
  boxes.onChange(() => status.update(store.get()));
  render();
  return {
    forgetSession(sessionId) {
      formTabs.delete(sessionId);
      destroySessionRoundViews(sessionId, store.get(), roundViews, deps);
    },
    showForm: (sessionId) => formTabs.get(sessionId)?.handle.select(),
    isFormShown: () =>
      [...formTabs.values()].some((tab) => tab.handle.isVisible()),
    setLayout(layout, layoutName) {
      active.layout = layout;
      active.name = layoutName;
      for (const round of store.get().rounds) {
        roundViews.get(round.roundId)?.setLayout(layout, layoutName, round);
      }
    },
  };
}

// A round view per open round, in its session's Form tab: built when the
// round appears, adding the Form tab when the session has none and selecting
// it; destroyed with its editors when the round leaves.
function syncRoundViews(
  state: FormsState,
  roundViews: Map<string, RoundView>,
  formTabs: Map<string, FormTab>,
  active: ActiveLayout,
  deps: FormsViewDeps,
  dispatch: (action: FormsAction) => void,
) {
  for (const roundId of roundViews.keys()) {
    if (!state.rounds.some((round) => round.roundId === roundId)) {
      destroyRoundView(roundId, roundViews, deps);
    }
  }
  for (const round of state.rounds) {
    if (!roundViews.has(round.roundId)) {
      const formTab = formTabOf(round.sessionId, formTabs, deps);
      roundViews.set(
        round.roundId,
        showRound(round, formTab, active, deps, dispatch),
      );
      formTab.handle.select();
    }
  }
}

function destroySessionRoundViews(
  sessionId: string,
  state: FormsState,
  roundViews: Map<string, RoundView>,
  deps: Pick<FormsViewDeps, 'boxes'>,
) {
  for (const round of state.rounds) {
    if (round.sessionId === sessionId && roundViews.has(round.roundId)) {
      destroyRoundView(round.roundId, roundViews, deps);
    }
  }
}

// Destroys the round's editors and removes its view.
function destroyRoundView(
  roundId: string,
  roundViews: Map<string, RoundView>,
  deps: Pick<FormsViewDeps, 'boxes'>,
) {
  deps.boxes.destroyRound(roundId);
  roundViews.get(roundId)?.element.remove();
  roundViews.delete(roundId);
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
  const idle = element('section', 'form-idle');
  idle.append(
    element('h1', 'form-idle-title', 'No round open'),
    element(
      'p',
      'form-idle-text',
      "This session has no round for you now. Its agent's next round opens here.",
    ),
  );
  tab.append(idle);
  const handle = deps.sessions.addTab(sessionId, {
    id: 'form',
    title: 'Form',
    element: tab,
    beforeClose: () => deps.beforeClose(sessionId),
    shown: () => deps.formShown(),
  });
  const created: FormTab = { handle, element: tab, idle, status: '' };
  formTabs.set(sessionId, created);
  return created;
}

function showRound(
  round: RoundState,
  formTab: FormTab,
  active: ActiveLayout,
  deps: FormsViewDeps,
  dispatch: (action: FormsAction) => void,
): RoundView {
  return createRoundView(
    (root) => formTab.element.insertBefore(root, formTab.idle),
    round,
    active.layout,
    active.name,
    {
      markdown: deps.markdown,
      boxes: deps.boxes,
      keys: deps.keys,
      dispatch,
      run: deps.run,
      log: deps.log,
    },
  );
}

// Shows each Form tab's idle section while its session has no round, and
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

function buildStatusLine(deps: FormsViewDeps): {
  element: HTMLElement;
  update(state: FormsState): void;
} {
  const bar = element('footer', 'status-line');
  const mode = element('span', 'status-mode');
  const save = element('span', 'status-save');
  bar.append(mode, save);
  return {
    element: bar,
    update(state) {
      mode.textContent = modeLabel(deps.boxes.activeMode());
      const round = activeRound(state);
      const roundSave = round === null ? null : saveState(round);
      save.textContent =
        round === null ? '' : saveLabel(saveState(round), round.saveError);
      save.dataset.state = roundSave ?? '';
    },
  };
}

// The cancel prompt; each button shows the confirm scope's keys for it.
function buildConfirm(deps: Pick<FormsViewDeps, 'keys' | 'run'>): HTMLElement {
  const overlay = element('div', 'overlay');
  const dialog = element('div', 'dialog dialog-confirm');
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-label', 'Cancel this round?');
  const actions = element('div', 'dialog-actions');
  const confirmButton = (
    className: string,
    label: string,
    command: FormsCommandName,
  ) => {
    const control = button(className, label, () =>
      deps.run(formsCommand(command)),
    );
    appendKeys(
      control,
      deps.keys.keysFor(formsCommand(command), formsScope('confirm')),
    );
    return control;
  };
  actions.append(
    confirmButton('button button-danger', 'Cancel the round', 'confirmCancel'),
    confirmButton('button', 'Keep answering', 'dismissConfirm'),
  );
  dialog.append(
    element('h2', 'dialog-title', 'Cancel this round?'),
    element(
      'p',
      'dialog-text',
      'The agent is told the round was cancelled. Your answers stay saved.',
    ),
    actions,
  );
  overlay.append(dialog);
  return overlay;
}
