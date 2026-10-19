import type { CommandId } from '../../../contracts/commands';
import type { Keymap } from '../../../contracts/keymap';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Area, AreaName } from '../../../contracts/plugin';
import { qualify } from '../../../shared/plugin-manifests';
import { formsManifest } from '../manifest';
import { isBoxShown } from './boxes';
import { button, element } from './dom';
import type { EditorBoxes } from './editor-boxes';
import {
  activeRound,
  type FormsAction,
  type FormsState,
  progress,
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
import { baseView, modeLabel, saveLabel } from './view-model';

// `keymap` is the merged keymap and `label` names a command in hints and help.
export interface FormsViewDeps {
  areas: Record<AreaName, Area>;
  store: FormsStore;
  boxes: EditorBoxes;
  markdown: MarkdownRenderer;
  keymap: Keymap;
  label: CommandLabel;
  run(command: CommandId): void;
}

// The whole forms UI: the switcher and rounds in the main area, the status
// line in the status bar, the dialogs in the overlay layer. Every store change
// re-renders it; editors live in the round views and survive every render.
export function mountFormsView(deps: FormsViewDeps) {
  const { areas, store, boxes } = deps;
  const root = element('div', 'forms-view');
  const switcher = element('nav', 'switcher');
  switcher.setAttribute('aria-label', 'Open rounds');
  const workspace = element('main', 'workspace');
  const idle = buildIdle();
  workspace.append(idle);
  root.append(switcher, workspace);
  const status = buildStatusLine(deps);
  const help = buildHelp(deps);
  const confirm = buildConfirm(deps.run);
  areas.main.contribute(root);
  areas.statusBar.contribute(status.element);
  areas.overlay.contribute(confirm);
  areas.overlay.contribute(help);
  const roundViews = new Map<string, RoundView>();
  const dispatch = (action: FormsAction) => store.dispatch(action);

  const render = () => {
    const state = store.get();
    syncRoundViews(state, roundViews, workspace, deps, dispatch);
    renderSwitcher(switcher, state, dispatch);
    const view = baseView(state);
    const shown = view === 'idle' ? null : activeRound(state);
    for (const [roundId, roundView] of roundViews) {
      roundView.element.hidden = roundId !== shown?.roundId;
    }
    if (shown !== null) {
      roundViews.get(shown.roundId)?.update(shown, view, state.view === 'help');
    }
    idle.hidden = view !== 'idle';
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

// A round view per open round: built when the round appears, destroyed with
// its editors when it leaves.
function syncRoundViews(
  state: FormsState,
  roundViews: Map<string, RoundView>,
  workspace: HTMLElement,
  deps: FormsViewDeps,
  dispatch: (action: FormsAction) => void,
) {
  for (const [roundId, roundView] of roundViews) {
    if (!state.rounds.some((round) => round.roundId === roundId)) {
      deps.boxes.destroyRound(roundId);
      roundView.element.remove();
      roundViews.delete(roundId);
    }
  }
  for (const round of state.rounds) {
    if (!roundViews.has(round.roundId)) {
      const roundView = createRoundView(workspace, round, {
        markdown: deps.markdown,
        boxes: deps.boxes,
        dispatch,
        run: deps.run,
      });
      roundViews.set(round.roundId, roundView);
    }
  }
}

function renderSwitcher(
  switcher: HTMLElement,
  state: FormsState,
  dispatch: (action: FormsAction) => void,
) {
  switcher.hidden = state.rounds.length === 0;
  switcher.replaceChildren(
    ...state.rounds.map((round) => {
      const isActive = round.roundId === state.activeRoundId;
      const counts = progress(round);
      const entry = button('switcher-entry', '', () =>
        dispatch({ type: 'focusRound', roundId: round.roundId }),
      );
      entry.title = round.label;
      entry.classList.toggle('is-active', isActive);
      entry.setAttribute('aria-current', String(isActive));
      entry.append(
        element('span', 'switcher-label', round.label),
        element(
          'span',
          'switcher-count',
          `${counts.answered + counts.notApplicable}/${counts.total}`,
        ),
      );
      return entry;
    }),
  );
}

function buildIdle(): HTMLElement {
  const idle = element('section', 'idle');
  idle.append(
    element('h1', 'idle-title', 'No round open'),
    element(
      'p',
      'idle-text',
      'When an agent asks you a round, it opens here and the app icon counts it.',
    ),
  );
  return idle;
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
    deps.run('forms.toggleHelp'),
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
        : pageHints(
            deps.keymap.page,
            qualify(formsManifest.id, state.view),
            deps.label,
          );
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
    button('button', 'Close', () => deps.run('forms.closeHelp')),
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
      run('forms.confirmCancel'),
    ),
    button('button', 'Keep answering', () => run('forms.dismissConfirm')),
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
