import type { CommandId } from '../../contracts/commands';
import type { Keymap } from '../../contracts/keymap';
import type { MarkdownRenderer } from '../../contracts/markdown';
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
  editorHints,
  helpSections,
  type KeyHint,
  pageHints,
} from './key-hints';
import { createRoundView, type RoundView } from './round-view';
import type { Timers } from './timers';
import { createToasts, type ToastTone } from './toasts';
import { baseView, modeLabel, saveLabel } from './view-model';

export interface FormsViewDeps {
  root: HTMLElement;
  store: FormsStore;
  boxes: EditorBoxes;
  markdown: MarkdownRenderer;
  keymap: Keymap;
  // The theme problem to show until it is fixed, or null.
  themeError: string | null;
  run(command: CommandId): void;
  timers: Timers;
}

export interface MountedFormsView {
  toast(text: string, tone: ToastTone): void;
}

// The whole forms UI. Every store change re-renders it; editors live in the
// round views and survive every render.
export function mountFormsView(deps: FormsViewDeps): MountedFormsView {
  const { root, store, boxes } = deps;
  const switcher = element('nav', 'switcher');
  switcher.setAttribute('aria-label', 'Open rounds');
  const workspace = element('main', 'workspace');
  const idle = buildIdle();
  workspace.append(idle);
  const status = buildStatusLine(deps);
  const help = buildHelp(deps.keymap, deps.run);
  const confirm = buildConfirm(deps.run);
  const toastLayer = element('div', 'toasts');
  root.append(switcher, workspace, status.element, confirm, help, toastLayer);
  const toasts = createToasts(toastLayer, deps.timers);
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
      roundViews.get(shown.roundId)?.update(shown, view);
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
  return { toast: (text, tone) => toasts.show(text, tone) };
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
  const themeError = element('span', 'status-error');
  const keys = element('span', 'status-keys');
  const helpButton = button('status-help', 'Keys', () =>
    deps.run('help.toggle'),
  );
  themeError.hidden = deps.themeError === null;
  themeError.textContent = `Theme: ${deps.themeError ?? ''}`;
  themeError.title = deps.themeError ?? '';
  bar.append(mode, save, themeError, keys, helpButton);
  return {
    element: bar,
    update(state) {
      mode.textContent = modeLabel(deps.boxes.activeMode());
      const round = activeRound(state);
      const roundSave = round === null ? null : saveState(round);
      save.textContent = roundSave === null ? '' : saveLabel(roundSave);
      save.dataset.state = roundSave ?? '';
      const isInBox = deps.boxes.active() !== null;
      const hints = isInBox
        ? editorHints(deps.keymap.editor)
        : pageHints(deps.keymap.page, state.view);
      keys.replaceChildren(...hints.map(renderHint));
    },
  };
}

function buildHelp(
  keymap: Keymap,
  run: (command: CommandId) => void,
): HTMLElement {
  const overlay = element('div', 'overlay');
  const dialog = element('div', 'dialog dialog-help');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Keys');
  const sections = element('div', 'help-sections');
  for (const section of helpSections(keymap)) {
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
    button('button', 'Close', () => run('help.close')),
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
