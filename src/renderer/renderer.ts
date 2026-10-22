// Composition root for the renderer: the one module that picks adapters and
// starts the page parts of the plugins.
import './index.css';
import './shell/shell.css';
import type { Timers } from '../contracts/ambient';
import type { CommandId } from '../contracts/commands';
import type { EditorHost } from '../contracts/editor';
import type { Log } from '../contracts/log';
import type {
  Area,
  PageCommandContext,
  PageServices,
} from '../contracts/plugin';
import type { AppConfig, ConfigProblem } from '../contracts/settings';
import { manifests } from '../plugins/manifests';
import { pageParts } from '../plugins/page';
import { CommandRegistry } from '../shared/command-registry';
import { errorText } from '../shared/error-text';
import { createEventBus } from '../shared/event-bus';
import { editorBindMode } from '../shared/key-hints';
import { requireUnambiguousEditorBinds } from '../shared/keymap-checks';
import { startPlugins } from '../shared/plugin-host';
import { qualify } from '../shared/plugin-manifests';
import { mountCodeColours } from './codemirror-vim/code-colours';
import { createCodeMirrorHighlighter } from './codemirror-vim/codemirror-highlighter';
import { createCodeMirrorVimHost } from './codemirror-vim/codemirror-vim-host';
import { editorBindInForce } from './editor-binds';
import { createLiveConfig, type LiveConfig } from './live-config';
import { createLogView } from './log-view';
import { createMarkdownItRenderer } from './markdown-it/markdown-it-renderer';
import { createScopeStack } from './key-scope';
import { installPageKeys } from './page-keys';
import { createPendingKeys } from './pending-keys';
import { createPageApi } from './plugins/page-api';
import { createActivityBar } from './shell/activity-bar';
import { createModes } from './shell/modes';
import { mountShell } from './shell/shell';
import { defaultShellLayout, SIDE_BAR_OVER_QUERY } from './shell/shell-layout';
import { mountTitleBarContext } from './shell/title-bar';
import { createThemeApplier, type ThemeApplier } from './theme';
import { createToasts } from './toasts';
import { createPageUiState } from './ui-state';

// The scope page keys fire in until a plugin sets one: only `any` binds match.
const INITIAL_SCOPE = 'any';

const timers: Timers = {
  set: (run, ms) => window.setTimeout(run, ms),
  clear: (handle) => window.clearTimeout(handle),
};

function problemText(problem: ConfigProblem): string {
  return `${problem.file}: ${problem.message}`;
}

// A status-bar item over the config problems, hidden while there is none: one
// problem reads as itself, more as their count, each listed on its own line in
// the tooltip. `show` redraws it for a new list.
function contributeConfigProblems(statusBar: Area): {
  show(problems: readonly ConfigProblem[]): void;
} {
  const item = document.createElement('span');
  item.className = 'status-error';
  item.hidden = true;
  statusBar.contribute(item);
  return {
    show(problems) {
      item.hidden = problems.length === 0;
      item.textContent =
        problems.length === 1
          ? problemText(problems[0])
          : `${problems.length} config problems`;
      item.title = problems.map(problemText).join('\n');
    },
  };
}

// Toasts and logs each problem in `problems` that `shown` does not hold, by
// file and message.
function announceNewProblems(
  problems: readonly ConfigProblem[],
  shown: readonly ConfigProblem[],
  toasts: { show(text: string, tone: 'error'): void },
  log: Log,
) {
  const shownTexts = new Set(shown.map(problemText));
  for (const problem of problems) {
    const text = problemText(problem);
    if (!shownTexts.has(text)) {
      toasts.show(text, 'error');
      log('config', text);
    }
  }
}

function isSameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// What applying a pushed config changes outside the plugins.
interface ConfigTargets {
  live: LiveConfig & { replace(next: AppConfig): void };
  applier: ThemeApplier;
  editor: EditorHost;
  commands: CommandRegistry<PageCommandContext>;
  pageKeys: {
    setBinds(binds: AppConfig['keymap']['page'], timeoutMs: number): void;
  };
  problems: { show(problems: readonly ConfigProblem[]): void };
  toasts: { show(text: string, tone: 'error'): void };
  log: Log;
}

// Applies a config main pushed: its keys, after the checks main also ran, so
// a refused keymap changes nothing; then the theme; then the plugins'
// listeners; then the problems, toasting each one not shown before.
function applyPushedConfig(next: AppConfig, targets: ConfigTargets) {
  const { live, log } = targets;
  const previous = live.current();
  applyKeys(next, previous, targets);
  targets.applier.apply(next.theme, next.settings);
  live.replace(next);
  targets.problems.show(next.problems);
  announceNewProblems(next.problems, previous.problems, targets.toasts, log);
  log('config', 'applied a new config');
}

// Re-installs the page keys and, when its keymap changed, the editor keymap,
// when the keymap or the sequence timeout changed. A throw leaves the keys as
// they were and is logged.
function applyKeys(
  next: AppConfig,
  previous: AppConfig,
  targets: ConfigTargets,
) {
  const isKeymapSame = isSameJson(next.keymap, previous.keymap);
  const isTimeoutSame =
    next.settings.keySequenceTimeoutMs ===
    previous.settings.keySequenceTimeoutMs;
  if (isKeymapSame && isTimeoutSame) {
    return;
  }
  const { keymap } = next;
  try {
    requireUnambiguousEditorBinds(keymap.editor.binds, keymap.editor.leader);
    targets.commands.requireRegistered(
      [...keymap.editor.binds, ...keymap.page].map((bind) => bind.command),
    );
    targets.pageKeys.setBinds(keymap.page, next.settings.keySequenceTimeoutMs);
    if (!isSameJson(keymap.editor, previous.keymap.editor)) {
      targets.editor.setKeymap(keymap.editor);
    }
  } catch (error) {
    targets.log('config', `keys not applied: ${errorText(error)}`);
  }
}

// Throws for a page part main served nothing for: its manifest is missing from
// the built-in manifests list, so it would get no keys, labels or settings.
function requireServedSettings(config: AppConfig, pluginId: string) {
  if (!Object.hasOwn(config.pluginSettings, pluginId)) {
    throw new Error(
      `Plugin "${pluginId}" has a page part but its manifest is not in the built-in manifests list`,
    );
  }
}

async function start() {
  const bridge = window.wigley;
  const log = createLogView(document.getElementById('log') as HTMLOListElement);
  bridge.onLog(log);
  // A push before start finishes is held, the newest replacing any older, and
  // applied once start has run.
  let applyPush: ((next: AppConfig) => void) | null = null;
  let heldPush: AppConfig | null = null;
  bridge.onConfig((next) => {
    if (applyPush === null) {
      heldPush = next;
    } else {
      applyPush(next);
    }
  });
  const config = await bridge.config();
  // Read before the plugins start, so each reads its state as it starts.
  const uiState = createPageUiState(await bridge.uiState(), (key, value) =>
    bridge.setUiState(key, value),
  );
  const live = createLiveConfig(config, log);
  const { settings, keymap } = config;
  const themeApplier = createThemeApplier(
    document.documentElement,
    window.matchMedia('(prefers-reduced-transparency: reduce)'),
  );
  themeApplier.apply(config.theme, settings);

  document.documentElement.dataset.platform = config.platform;
  const shell = mountShell(
    document.getElementById('app') as HTMLElement,
    defaultShellLayout,
  );
  const { areas } = shell;
  const activityBar = createActivityBar(areas.activityBar, log);
  const titleContext = mountTitleBarContext(areas.titleBar);
  const narrow = window.matchMedia(SIDE_BAR_OVER_QUERY);
  const modes = createModes({
    place(mode, handle) {
      areas.main.contribute(mode.element);
      if (mode.sideBar !== undefined) {
        areas.sideBar.contribute(mode.sideBar);
      }
      activityBar.add(mode, handle);
    },
    marked: (modeId) => activityBar.mark(modeId),
    layOutSideBar: (layout) => shell.layOutSideBar(layout),
    showContext: (context) => titleContext.show(context),
    isNarrow: narrow.matches,
    log,
  });
  narrow.addEventListener('change', (event) =>
    modes.narrowChanged(event.matches),
  );
  const toastLayer = document.createElement('div');
  toastLayer.className = 'toasts';
  areas.overlay.contribute(toastLayer);
  const toasts = createToasts(toastLayer, timers);
  const problems = contributeConfigProblems(areas.statusBar);
  problems.show(config.problems);

  const commands = new CommandRegistry<PageCommandContext>();
  const scopeStack = createScopeStack(INITIAL_SCOPE);
  // Rejects editor binds vim could not tell apart, before any is mapped.
  requireUnambiguousEditorBinds(keymap.editor.binds, keymap.editor.leader);
  // An insert-mode key with no bind in force types as it would unbound, so
  // only a normal-mode miss is logged.
  const editor = createCodeMirrorVimHost(keymap.editor, (binds, fired) => {
    const choice = editorBindInForce(binds, scopeStack.current());
    if (choice.kind === 'run') {
      commands.run(choice.bind.command, { editor: fired });
      return true;
    }
    if (editorBindMode(binds[0]) === 'normal') {
      log('page', choice.message);
    }
    return false;
  });
  // Highlighted markdown has no editor to mount the code colours.
  mountCodeColours(document);
  const services: Omit<PageServices, 'uiState'> = {
    editor,
    markdown: createMarkdownItRenderer(createCodeMirrorHighlighter()),
    toast: (text, tone) => toasts.show(text, tone),
    log,
    timers,
  };
  // Filled once the page keys are installed; no key reaches the engine before.
  let pageKeys: ReturnType<typeof installPageKeys> | null = null;
  const pendingKeys = createPendingKeys({
    page: { hold: () => pageKeys?.hold(), cancel: () => pageKeys?.cancel() },
    editor,
    scope: () => scopeStack.current(),
  });
  const run = (id: CommandId, context: PageCommandContext = {}) =>
    commands.run(id, context);
  const bus = createEventBus();
  startPlugins(
    pageParts,
    (part, dependency) => {
      const { id } = part.manifest;
      requireServedSettings(config, id);
      const started = part.start(
        createPageApi(part.manifest, {
          areas,
          modes,
          setLayout: (layout) => shell.setLayout(layout),
          bridge,
          scopeStack,
          pendingKeys,
          config: live,
          services,
          uiState,
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
    },
    manifests,
  );
  commands.requireRegistered(
    [...keymap.editor.binds, ...keymap.page].map((bind) => bind.command),
  );
  // Building the matcher rejects a page key bound twice in one scope.
  const installed = installPageKeys(
    keymap.page,
    settings.keySequenceTimeoutMs,
    () => scopeStack.current(),
    editor,
    commands,
    log,
    timers,
    (keys, scope) => pendingKeys.reportPage(keys, scope),
  );
  pageKeys = installed;

  announceNewProblems(config.problems, [], toasts, log);
  const targets: ConfigTargets = {
    live,
    applier: themeApplier,
    editor,
    commands,
    pageKeys: installed,
    problems,
    toasts,
    log,
  };
  applyPush = (next) => applyPushedConfig(next, targets);
  if (heldPush !== null) {
    applyPush(heldPush);
    heldPush = null;
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
