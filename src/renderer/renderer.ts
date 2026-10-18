// Composition root for the renderer: the one module that picks adapters and
// wires features to them.
import './index.css';
import './forms/forms.css';
import { CommandRegistry } from '../shared/command-registry';
import { createCodeMirrorVimHost } from './codemirror-vim/codemirror-vim-host';
import { startAutosave } from './forms/autosave';
import { focusActionFor } from './forms/boxes';
import { createEditorBoxes } from './forms/editor-boxes';
import { initialState } from './forms/form-state';
import { registerFormsCommands } from './forms/forms-commands';
import { createFormsStore } from './forms/forms-store';
import { mountFormsView } from './forms/forms-view';
import type { Timers } from './forms/timers';
import { createLogView } from './log-view';
import { createMarkdownItRenderer } from './markdown-it/markdown-it-renderer';
import { installPageKeys } from './page-keys';
import type {
  RendererCommandContext,
  RendererCommands,
} from './renderer-commands';
import { applyTheme } from './theme';

// How long edits pause before the answers are saved as a draft.
const AUTOSAVE_DELAY_MS = 400;

const timers: Timers = {
  set: (run, ms) => window.setTimeout(run, ms),
  clear: (handle) => window.clearTimeout(handle),
};

async function start() {
  const bridge = window.wigley;
  const log = createLogView(document.getElementById('log') as HTMLOListElement);
  bridge.onLog(log);
  const { settings, keymap, theme } = await bridge.config();
  applyTheme(theme.theme, settings.fonts, document.documentElement);

  const markdown = createMarkdownItRenderer();
  const store = createFormsStore(initialState([]));
  const commands: RendererCommands =
    new CommandRegistry<RendererCommandContext>();
  const editors = createCodeMirrorVimHost(keymap.editor, (command, editor) =>
    commands.run(command, { editor, box: boxes.boxOf(editor) }),
  );
  const boxes = createEditorBoxes(
    editors,
    {
      changed: (box, value) =>
        store.dispatch({
          type: 'setText',
          roundId: box.roundId,
          target: box.target,
          value,
        }),
      activated: (box) => {
        const action = focusActionFor(store.get(), box);
        if (action !== null) {
          store.dispatch(action);
        }
      },
    },
    log,
  );
  const view = mountFormsView({
    root: document.getElementById('app') as HTMLElement,
    store,
    boxes,
    markdown,
    keymap,
    themeError: theme.error,
    run: (command) => commands.run(command, {}),
    timers,
  });
  registerFormsCommands(commands, {
    store,
    boxes,
    finish: (roundId, end) => bridge.finishRound(roundId, end),
    toast: (text, tone) => view.toast(text, tone),
    log,
  });
  commands.requireRegistered(
    [...keymap.editor.binds, ...keymap.page].map((bind) => bind.command),
  );
  // Building the matcher rejects a page key bound twice in one scope.
  installPageKeys(
    keymap.page,
    settings.keySequenceTimeoutMs,
    () => store.get().view,
    editors,
    commands,
    log,
  );
  startAutosave({
    store,
    save: (roundId, body) => bridge.saveDraft(roundId, body),
    delayMs: AUTOSAVE_DELAY_MS,
    timers,
    log,
  });

  // Listeners first: a round shown while openRounds is in flight arrives in
  // both, and showing an open round again changes nothing.
  bridge.onRoundShown((round) => store.dispatch({ type: 'roundShown', round }));
  bridge.onRoundClosed((roundId) =>
    store.dispatch({ type: 'roundClosed', roundId }),
  );
  bridge.onFocusRound((roundId) =>
    store.dispatch({ type: 'focusRound', roundId }),
  );
  for (const round of await bridge.openRounds()) {
    store.dispatch({ type: 'roundShown', round });
  }
  if (theme.error !== null) {
    view.toast(`Theme error: ${theme.error}`, 'error');
  }
  // The self-test opens its round only once the page listens.
  document.body.dataset.ready = 'true';
}

void start();
