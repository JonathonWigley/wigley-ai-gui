// Composition root for the renderer: the one module that picks adapters and
// starts the page parts of the plugins.
import './index.css';
import './shell/shell.css';
import type { Timers } from '../contracts/ambient';
import type { CommandId } from '../contracts/commands';
import type {
  Area,
  PageCommandContext,
  PageServices,
} from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import { pageParts } from '../plugins/page';
import { CommandRegistry } from '../shared/command-registry';
import { errorText } from '../shared/error-text';
import { createEventBus } from '../shared/event-bus';
import { startPlugins } from '../shared/plugin-host';
import { qualify } from '../shared/plugin-manifests';
import { createCodeMirrorVimHost } from './codemirror-vim/codemirror-vim-host';
import { createLogView } from './log-view';
import { createMarkdownItRenderer } from './markdown-it/markdown-it-renderer';
import { createScopeStack } from './key-scope';
import { installPageKeys } from './page-keys';
import { createPendingKeys } from './pending-keys';
import { createPageApi } from './plugins/page-api';
import { mountShell } from './shell/shell';
import { applyTheme } from './theme';
import { createToasts } from './toasts';

// The scope page keys fire in until a plugin sets one: only `any` binds match.
const INITIAL_SCOPE = 'any';

const timers: Timers = {
  set: (run, ms) => window.setTimeout(run, ms),
  clear: (handle) => window.clearTimeout(handle),
};

// A status-bar item naming the theme problem, hidden while there is none.
function contributeThemeError(statusBar: Area, error: string | null) {
  const item = document.createElement('span');
  item.className = 'status-error';
  item.hidden = error === null;
  item.textContent = `Theme: ${error ?? ''}`;
  item.title = error ?? '';
  statusBar.contribute(item);
}

// Throws for a page part main served nothing for: its manifest is missing from
// the built-in manifests list, so it would get no keys, labels or settings.
function servedSettings(config: AppConfig, pluginId: string): object {
  if (!Object.hasOwn(config.pluginSettings, pluginId)) {
    throw new Error(
      `Plugin "${pluginId}" has a page part but its manifest is not in the built-in manifests list`,
    );
  }
  return config.pluginSettings[pluginId];
}

function commandLabel(config: AppConfig, id: CommandId): string {
  return config.commands[id]?.label ?? id;
}

async function start() {
  const bridge = window.wigley;
  const log = createLogView(document.getElementById('log') as HTMLOListElement);
  bridge.onLog(log);
  const config = await bridge.config();
  const { settings, keymap, theme } = config;
  applyTheme(theme.theme, settings.fonts, document.documentElement);

  const areas = mountShell(document.getElementById('app') as HTMLElement);
  const toastLayer = document.createElement('div');
  toastLayer.className = 'toasts';
  areas.overlay.contribute(toastLayer);
  const toasts = createToasts(toastLayer, timers);
  contributeThemeError(areas.statusBar, theme.error);

  const commands = new CommandRegistry<PageCommandContext>();
  const editor = createCodeMirrorVimHost(keymap.editor, (command, fired) =>
    commands.run(command, { editor: fired }),
  );
  const services: PageServices = {
    editor,
    markdown: createMarkdownItRenderer(),
    toast: (text, tone) => toasts.show(text, tone),
    log,
    timers,
  };
  const scopeStack = createScopeStack(INITIAL_SCOPE);
  // Filled once the page keys are installed; no key reaches the engine before.
  let pageKeys: { hold(): void; cancel(): void } | null = null;
  const pendingKeys = createPendingKeys({
    page: { hold: () => pageKeys?.hold(), cancel: () => pageKeys?.cancel() },
    editor,
  });
  const run = (id: CommandId, context: PageCommandContext = {}) =>
    commands.run(id, context);
  const bus = createEventBus();
  startPlugins(pageParts, (part, dependency) => {
    const { id } = part.manifest;
    const started = part.start(
      createPageApi(part.manifest, {
        areas,
        bridge,
        scopeStack,
        pendingKeys,
        keymap,
        label: (command) => commandLabel(config, command),
        commandInfo: config.commands,
        scopes: config.scopes,
        settings: servedSettings(config, id),
        services,
        run,
        dependency,
        bus,
      }),
    );
    const handlers: Record<string, (context: PageCommandContext) => void> =
      started.commands;
    for (const [short, handler] of Object.entries(handlers)) {
      commands.register(qualify(id, short), handler);
    }
    return started;
  });
  commands.requireRegistered(
    [...keymap.editor.binds, ...keymap.page].map((bind) => bind.command),
  );
  // Building the matcher rejects a page key bound twice in one scope.
  pageKeys = installPageKeys(
    keymap.page,
    settings.keySequenceTimeoutMs,
    () => scopeStack.current(),
    editor,
    commands,
    log,
    timers,
    (keys, scope) => pendingKeys.reportPage(keys, scope),
  );

  if (theme.error !== null) {
    toasts.show(`Theme error: ${theme.error}`, 'error');
  }
  // The self-test opens its round only once the page listens; each part adds
  // its channel listeners while it starts.
  document.body.dataset.ready = 'true';
}

// Logs why the page failed to start, puts the error in place of the shell, and
// marks the body so the self-test fails instead of waiting for ready. It uses
// only the page's static elements, since start can fail before anything else
// is built.
function showStartFailure(error: unknown) {
  const message = errorText(error);
  createLogView(document.getElementById('log') as HTMLOListElement)(
    'renderer',
    `start failed: ${message}`,
  );
  const shown = document.createElement('pre');
  shown.className = 'start-error';
  shown.textContent = `The page failed to start: ${message}`;
  const root = document.getElementById('app') as HTMLElement;
  // A shell mounted before the failure leaves its grid class on the root.
  root.classList.remove('shell');
  root.replaceChildren(shown);
  document.body.dataset.startFailed = message;
}

start().catch(showStartFailure);
