import type { CommandId } from '../../../contracts/commands';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Area, AreaName } from '../../../contracts/plugin';
import { appendKeys, button, element } from '../../../shared/page/dom';
import type { KeysPageExports } from '../../keys/contract';
import type { SessionsPageExports } from '../../sessions/contract';
import { type FormsCommandName, formsCommand, formsScope } from '../ids';
import { isBoxShown } from './boxes';
import type { EditorBoxes } from './editor-boxes';
import {
  activeRound,
  type FormsAction,
  type FormsState,
  type RoundState,
  saveState,
} from './form-state';
import type { FormsStore } from './forms-store';
import { createRoundView, type RoundView } from './round-view';
import { modeLabel, saveLabel, sessionTitle } from './view-model';

// `beforeClose` answers whether a session's tab may close now.
export interface FormsViewDeps {
  areas: Record<AreaName, Area>;
  sessions: Pick<SessionsPageExports, 'fill'>;
  beforeClose(sessionId: string): boolean;
  store: FormsStore;
  boxes: EditorBoxes;
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'keysFor'>;
  run(command: CommandId): void;
}

// A round's view and the session view it fills, with the title last sent to
// the session's tab.
interface ShownRound {
  view: RoundView;
  fill: ReturnType<SessionsPageExports['fill']>;
  title: string;
}

// The whole forms UI: each round in its session's view, the status line in
// the status bar, the cancel prompt in the overlay layer, all serving the
// active round. Every store change re-renders it; editors live in the round
// views and survive every render.
export function mountFormsView(deps: FormsViewDeps) {
  const { areas, store, boxes } = deps;
  const status = buildStatusLine(deps);
  const confirm = buildConfirm(deps);
  areas.statusBar.contribute(status.element);
  areas.overlay.contribute(confirm);
  const roundViews = new Map<string, ShownRound>();
  const dispatch = (action: FormsAction) => store.dispatch(action);

  const render = () => {
    const state = store.get();
    syncRoundViews(state, roundViews, deps, dispatch);
    sendTitles(state, roundViews);
    const view = state.view;
    const shown = view === 'idle' ? null : activeRound(state);
    for (const [roundId, roundView] of roundViews) {
      roundView.view.element.hidden = roundId !== shown?.roundId;
    }
    if (shown !== null) {
      roundViews.get(shown.roundId)?.view.update(shown, view);
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
}

// A round view per open round, filling its session's view: built when the
// round appears, destroyed with its editors when it leaves.
function syncRoundViews(
  state: FormsState,
  roundViews: Map<string, ShownRound>,
  deps: FormsViewDeps,
  dispatch: (action: FormsAction) => void,
) {
  for (const [roundId, shown] of roundViews) {
    if (!state.rounds.some((round) => round.roundId === roundId)) {
      deps.boxes.destroyRound(roundId);
      shown.fill.remove();
      roundViews.delete(roundId);
    }
  }
  for (const round of state.rounds) {
    if (!roundViews.has(round.roundId)) {
      roundViews.set(round.roundId, showRound(round, deps, dispatch));
    }
  }
}

function showRound(
  round: RoundState,
  deps: FormsViewDeps,
  dispatch: (action: FormsAction) => void,
): ShownRound {
  const title = sessionTitle(round);
  let fill = null as ShownRound['fill'] | null;
  const view = createRoundView(
    (root) => {
      fill = deps.sessions.fill(round.sessionId, {
        element: root,
        title,
        beforeClose: () => deps.beforeClose(round.sessionId),
      });
    },
    round,
    {
      markdown: deps.markdown,
      boxes: deps.boxes,
      keys: deps.keys,
      dispatch,
      run: deps.run,
    },
  );
  if (fill === null) {
    throw new Error(`Round ${round.roundId}'s view was never attached`);
  }
  return { view, fill, title };
}

// Sends each round's title to its session's tab when it changed.
function sendTitles(state: FormsState, roundViews: Map<string, ShownRound>) {
  for (const round of state.rounds) {
    const shown = roundViews.get(round.roundId);
    const title = sessionTitle(round);
    if (shown !== undefined && shown.title !== title) {
      shown.title = title;
      shown.fill.setTitle(title);
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
