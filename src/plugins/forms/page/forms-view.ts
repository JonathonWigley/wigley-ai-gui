import type { CommandId } from '../../../contracts/commands';
import type { Keymap } from '../../../contracts/keymap';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Area, AreaName } from '../../../contracts/plugin';
import { button, element } from '../../../shared/page/dom';
import type { SessionsPageExports } from '../../sessions/contract';
import { formsCommand, formsScope } from '../ids';
import { isBoxShown } from './boxes';
import type { EditorBoxes } from './editor-boxes';
import {
  activeRound,
  baseView,
  type FormsAction,
  type FormsState,
  type RoundState,
  saveState,
} from './form-state';
import type { FormsStore } from './forms-store';
import {
  type CommandLabel,
  editorHints,
  helpSections,
  type KeyHint,
  pageHints,
} from './key-hints';
import { createRoundView, type RoundView } from './round-view';
import { modeLabel, saveLabel, sessionTitle } from './view-model';

// `keymap` is the merged keymap and `label` names a command in hints and help.
// `beforeClose` answers whether a session's tab may close now.
export interface FormsViewDeps {
  areas: Record<AreaName, Area>;
  sessions: Pick<SessionsPageExports, 'fill'>;
  beforeClose(sessionId: string): boolean;
  store: FormsStore;
  boxes: EditorBoxes;
  markdown: MarkdownRenderer;
  keymap: Keymap;
  label: CommandLabel;
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
// the status bar, the dialogs in the overlay layer, all serving the active
// round. Every store change re-renders it; editors live in the round views and
// survive every render.
export function mountFormsView(deps: FormsViewDeps) {
  const { areas, store, boxes } = deps;
  const status = buildStatusLine(deps);
  const help = buildHelp(deps);
  const confirm = buildConfirm(deps.run);
  areas.statusBar.contribute(status.element);
  areas.overlay.contribute(confirm);
  areas.overlay.contribute(help);
  const roundViews = new Map<string, ShownRound>();
  const dispatch = (action: FormsAction) => store.dispatch(action);

  const render = () => {
    const state = store.get();
    syncRoundViews(state, roundViews, deps, dispatch);
    sendTitles(state, roundViews);
    const view = baseView(state);
    const shown = view === 'idle' ? null : activeRound(state);
    for (const [roundId, roundView] of roundViews) {
      roundView.view.element.hidden = roundId !== shown?.roundId;
    }
    if (shown !== null) {
      roundViews
        .get(shown.roundId)
        ?.view.update(shown, view, state.view === 'help');
    }
    help.hidden = state.view !== 'help';
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
    { markdown: deps.markdown, boxes: deps.boxes, dispatch, run: deps.run },
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

function renderHint(hint: KeyHint): HTMLElement {
  const entry = element('span', 'key-hint');
  entry.append(element('kbd', '', hint.keys), ` ${hint.label}`);
  return entry;
}

function buildStatusLine(deps: FormsViewDeps): {
  element: HTMLElement;
  update(state: FormsState): void;
} {
  const bar = element('footer', 'status-line');
  const mode = element('span', 'status-mode');
  const save = element('span', 'status-save');
  const keys = element('span', 'status-keys');
  const helpButton = button('status-help', 'Keys', () =>
    deps.run(formsCommand('toggleHelp')),
  );
  bar.append(mode, save, keys, helpButton);
  return {
    element: bar,
    update(state) {
      mode.textContent = modeLabel(deps.boxes.activeMode());
      const round = activeRound(state);
      const roundSave = round === null ? null : saveState(round);
      save.textContent =
        round === null ? '' : saveLabel(saveState(round), round.saveError);
      save.dataset.state = roundSave ?? '';
      const isInBox = deps.boxes.active() !== null;
      const hints = isInBox
        ? editorHints(deps.keymap.editor, deps.label)
        : pageHints(deps.keymap.page, formsScope(state.view), deps.label);
      keys.replaceChildren(...hints.map(renderHint));
    },
  };
}

function buildHelp(deps: FormsViewDeps): HTMLElement {
  const overlay = element('div', 'overlay');
  const dialog = element('div', 'dialog dialog-help');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Keys');
  const sections = element('div', 'help-sections');
  for (const section of helpSections(deps.keymap, deps.label)) {
    const block = element('section', 'help-section');
    const list = element('dl', 'help-list');
    for (const hint of section.hints) {
      const term = element('dt');
      term.append(element('kbd', '', hint.keys));
      list.append(term, element('dd', '', hint.label));
    }
    block.append(element('h3', 'help-title', section.title), list);
    sections.append(block);
  }
  dialog.append(
    element('h2', 'dialog-title', 'Keys'),
    sections,
    button('button', 'Close', () => deps.run(formsCommand('closeHelp'))),
  );
  overlay.append(dialog);
  return overlay;
}

function buildConfirm(run: (command: CommandId) => void): HTMLElement {
  const overlay = element('div', 'overlay');
  const dialog = element('div', 'dialog dialog-confirm');
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-label', 'Cancel this round?');
  const actions = element('div', 'dialog-actions');
  actions.append(
    button('button button-danger', 'Cancel the round', () =>
      run(formsCommand('confirmCancel')),
    ),
    button('button', 'Keep answering', () =>
      run(formsCommand('dismissConfirm')),
    ),
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
