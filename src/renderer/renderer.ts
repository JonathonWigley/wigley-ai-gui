// Composition root for the renderer: the one module that picks adapters and
// starts the page parts of the plugins.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './index.css';
import '../shared/page/ui/materials.css';
import './shell/shell.css';
import type { Clock, Timers } from '../contracts/ambient';
import type { CommandId } from '../contracts/commands';
import {
  PANE_DIRECTIONS,
  PANE_FOCUS_COMMANDS,
  PANE_RESIZE_COMMANDS,
} from '../contracts/panes';
import type { PageCommandContext, PageServices } from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import { manifests } from '../plugins/manifests';
import { pageParts } from '../plugins/page';
import { CommandRegistry } from '../shared/command-registry';
import { errorText } from '../shared/error-text';
import { createEventBus } from '../shared/event-bus';
import { editorBindMode } from '../shared/key-hints';
import { requireUnambiguousEditorBinds } from '../shared/keymap-checks';
import { focusOutOfFrame } from '../shared/page/dom';
import type { BaseKitDeps } from '../shared/page/layout-host/base-kit';
import { createPageLayouts } from '../shared/page/layout-host/show-layouts';
import { icon } from '../shared/page/ui/icon';
import { startPlugins } from '../shared/plugin-host';
import { posixPaths } from '../shared/paths/posix-paths';
import { windowsPaths } from '../shared/paths/windows-paths';
import { qualify } from '../shared/plugin-manifests';
import { mountCodeColours } from './codemirror-vim/code-colours';
import { announceNewProblems, createConfigPush } from './config-push';
import { createCodeMirrorHighlighter } from './codemirror-vim/codemirror-highlighter';
import { createCodeMirrorVimHost } from './codemirror-vim/codemirror-vim-host';
import { createDropTargets } from './drop-targets';
import { editorBindInForce } from './editor-binds';
import { createFabricMarkupEditor } from './fabric/fabric-markup-editor';
import { createLiveConfig } from './live-config';
import { createLogView } from './log-view';
import { createMarkdownItRenderer } from './markdown-it/markdown-it-renderer';
import { createScopeStack } from './key-scope';
import { installPageKeys } from './page-keys';
import { createPaneTargets } from './pane-targets';
import { createPendingKeys } from './pending-keys';
import { createPageApi } from './plugins/page-api';
import defaultChromeLayout from './shell/layouts/default/layout.js';
import type { Layout as ChromeLayout } from './shell/layouts/layout';
import { createModes, SIDE_BAR_OVER_QUERY } from './shell/modes';
import { readShellLayout } from './shell/read-shell-layout';
import { mountShell } from './shell/shell';
import { mountShellChrome } from './shell/shell-chrome';
import { defaultShellLayout } from './shell/shell-layout';
import { startedPluginsConfig } from './started-config';
import { createThemeApplier } from './theme';
import { createToasts } from './toasts';
import { overrideTransparency } from './transparency-override';
import { createPageUiState } from './ui-state';
import { createVisualFrames } from './visual-frames/visual-frames';

// The scope page keys fire in until a plugin sets one: only `any` binds match.
const INITIAL_SCOPE = 'any';

// The plugin whose exports anchor the shell chrome's key hints.
const KEYS_PLUGIN_ID = 'keys';

const timers: Timers = {
  set: (run, ms) => window.setTimeout(run, ms),
  clear: (handle) => window.clearTimeout(handle),
};

const clock: Clock = { now: () => Date.now() };

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
  // Read once at page load: a changed list reaches the page parts on the next
  // load.
  const served = await bridge.config();
  const pageLoadList = served.settings.plugins.disabled;
  const config = startedPluginsConfig(served, pageLoadList);
  // Read before the plugins start, so each reads its state as it starts.
  const uiState = createPageUiState(await bridge.uiState(), (key, value) =>
    bridge.setUiState(key, value),
  );
  const live = createLiveConfig(config, log);
  const { settings, keymap } = config;
  const visualFrames = createVisualFrames({
    serveVisual: (source) => bridge.serveVisual(source),
    messages: window,
    focusPage: focusOutOfFrame,
    log,
  });
  const { applier: themeApplier, transparency } = overrideTransparency(
    createThemeApplier(
      document.documentElement,
      window.matchMedia('(prefers-reduced-transparency: reduce)'),
      (applied) => visualFrames.themeApplied(applied),
    ),
  );
  themeApplier.apply(config.theme, settings);

  document.documentElement.dataset.platform = config.platform;
  const shell = mountShell(
    document.getElementById('app') as HTMLElement,
    defaultShellLayout,
    uiState.scoped('shell'),
    timers,
  );
  const { areas } = shell;
  const commands = new CommandRegistry<PageCommandContext>();
  const markdown = createMarkdownItRenderer(createCodeMirrorHighlighter());
  const chrome = mountShellChrome({
    areas,
    defaultLayout: defaultChromeLayout,
    services: {
      markdown,
      platform: config.platform,
      commands: {
        exists: (id) => commands.has(id),
        run: (id) => commands.run(id, {}),
      },
    },
    instance: config.appInstance,
    log,
  });
  const narrow = window.matchMedia(SIDE_BAR_OVER_QUERY);
  const modes = createModes({
    place(mode, handle) {
      areas.main.contribute(mode.element);
      if (mode.sideBar !== undefined) {
        areas.sideBar.contribute(mode.sideBar);
      }
      chrome.addMode(mode, handle);
    },
    marked: (modeId) => chrome.markMode(modeId),
    layOutSideBar: (layout) => shell.layOutSideBar(layout),
    showContext: (context) => chrome.showContext(context),
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
  chrome.showProblems(config.problems);

  const scopeStack = createScopeStack(INITIAL_SCOPE);
  const paneTargets = createPaneTargets(
    shell.sideBarDivider,
    () => scopeStack.anyPushed(),
    (message) => log('page', message),
  );
  // Targets a view set under the previous base belong to a view no longer in
  // force.
  scopeStack.onBaseChange(() => paneTargets.dropViewTargets());
  const drops = createDropTargets({
    document,
    bridge,
    toast: (text, tone) => toasts.show(text, tone),
    isShown: (element) => element.checkVisibility(),
  });
  for (const direction of PANE_DIRECTIONS) {
    commands.register(PANE_RESIZE_COMMANDS[direction], () =>
      paneTargets.resize(direction),
    );
    commands.register(PANE_FOCUS_COMMANDS[direction], () =>
      paneTargets.focus(direction),
    );
  }
  // Rejects editor binds vim could not tell apart, before any is mapped.
  requireUnambiguousEditorBinds(keymap.editor.binds, keymap.editor.leader);
  // An insert-mode key with no bind in force types as it would unbound, so
  // only a normal-mode miss is logged.
  const paths = config.platform === 'windows' ? windowsPaths : posixPaths;
  const editor = createCodeMirrorVimHost(
    keymap.editor,
    (binds, fired) => {
      const choice = editorBindInForce(binds, scopeStack.current());
      if (choice.kind === 'run') {
        commands.run(choice.bind.command, { editor: fired });
        return true;
      }
      if (editorBindMode(binds[0]) === 'normal') {
        log('page', choice.message);
      }
      return false;
    },
    log,
    { paths, fileIcon: () => icon('file') },
  );
  // Highlighted markdown has no editor to mount the code colours.
  mountCodeColours(document);
  const services: Omit<PageServices, 'uiState'> = {
    editor,
    markdown,
    markup: createFabricMarkupEditor(),
    visualFrames,
    toast: (text, tone) => toasts.show(text, tone),
    log,
    timers,
    clock,
    paths,
    homeDir: config.homeDir,
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
  const layouts = createPageLayouts({
    bridge,
    importModule: (url) => import(/* @vite-ignore */ url),
    head: document.head,
    log,
    toast: (text, tone) => toasts.show(text, tone),
    onConfigChanged: (listener) => live.onChanged(() => listener()),
  });
  layouts.show<ChromeLayout>('shell', {
    defaultLayout: defaultChromeLayout,
    defaultStylesheet: null,
    read: readShellLayout,
    userLayout: () => live.current().settings.shell.layout,
    setLayouts(shown) {
      chrome.setLayouts(shown);
      shell.setChromeLayout(shown.user);
    },
  });
  const started = startPlugins(
    pageParts,
    (part, dependency) => {
      const { id } = part.manifest;
      requireServedSettings(config, id);
      const started = part.start(
        createPageApi(part.manifest, {
          areas,
          modes,
          setLayout: (layout) => shell.setLayout(layout),
          transparency,
          bridge,
          scopeStack,
          pendingKeys,
          config: live,
          services,
          uiState,
          run,
          dependency,
          bus,
          layouts,
          paneTargets,
          drops,
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
    pageLoadList,
  );
  const keysExports = started.get(KEYS_PLUGIN_ID)?.exports;
  if (keysExports !== undefined) {
    chrome.setKeys(keysExports as BaseKitDeps['keys']);
    shell.setKeys(keysExports as BaseKitDeps['keys']);
  }
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
  const applyStartedPush = createConfigPush(
    {
      editor: keymap.editor,
      page: keymap.page,
      timeoutMs: settings.keySequenceTimeoutMs,
    },
    {
      live,
      // The side bar's and right bar's open widths are the theme's
      // `sidebar-width` and `rightbar-width` tokens.
      applier: {
        apply(theme, applied) {
          themeApplier.apply(theme, applied);
          shell.reloadBarOpenWidths();
        },
      },
      editor,
      commands,
      pageKeys: installed,
      problems: { show: (next) => chrome.showProblems(next) },
      toasts,
      log,
    },
  );
  applyPush = (next) =>
    applyStartedPush(startedPluginsConfig(next, pageLoadList));
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
