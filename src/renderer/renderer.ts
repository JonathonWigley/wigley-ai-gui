// Composition root for the renderer: the one module that picks adapters and
// starts the page parts of the plugins.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './index.css';
import '../shared/page/ui/materials.css';
import './shell/shell.css';
import type { Clock, Timers } from '../contracts/ambient';
import {
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
} from '../contracts/core-state';
import {
  PANE_DIRECTIONS,
  PANE_FOCUS_COMMANDS,
  PANE_RESIZE_COMMANDS,
} from '../contracts/panes';
import type {
  CommandHandler,
  KeyHints,
  PageCommandContext,
} from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import { manifests } from '../plugins/manifests';
import { pageParts } from '../plugins/page';
import { CommandRegistry } from '../shared/command-registry';
import { errorText } from '../shared/error-text';
import { createEventBus } from '../shared/event-bus';
import { requireUnambiguousEditorBinds } from '../shared/keymap-checks';
import { promptKeysFor } from '../shared/keys-for';
import { focusOutOfFrame } from '../shared/page/dom';
import { createPageLayouts } from '../shared/page/layout-host/show-layouts';
import { icon } from '../shared/page/ui/icon';
import { startPlugins } from '../shared/plugin-host';
import { posixPaths } from '../shared/paths/posix-paths';
import { windowsPaths } from '../shared/paths/windows-paths';
import { runBound } from '../shared/command-router';
import { commandLabel, qualify } from '../shared/plugin-manifests';
import { createRegistrations } from '../shared/registrations';
import {
  createRuntimeCommands,
  EMPTY_RUNTIME_CATALOG,
} from '../shared/runtime-commands';
import { layoutState } from '../shared/state/slot-store';
import { wireAnchors } from './anchor-wiring';
import { createBoxFocus } from './box-focus';
import { mountCodeColours } from './codemirror-vim/code-colours';
import { announceNewProblems, createConfigPush } from './config-push';
import { createCodeMirrorHighlighter } from './codemirror-vim/codemirror-highlighter';
import { createCodeMirrorVimHost } from './codemirror-vim/codemirror-vim-host';
import { createDropTargets } from './drop-targets';
import { runEditorBind } from './editor-binds';
import { createFabricMarkupEditor } from './fabric/fabric-markup-editor';
import { createFzfMatcher } from './fzf/fzf-matcher';
import { createAnchors } from './key-anchors';
import { createLiveConfig, onChangedPart } from './live-config';
import { createLogView } from './log-view';
import { createMarkdownItRenderer } from './markdown-it/markdown-it-renderer';
import { createScopeStack } from './key-scope';
import { installPageKeys } from './page-keys';
import { createPaneTargets } from './pane-targets';
import { createPendingKeys } from './pending-keys';
import {
  createPageApi,
  liveKeysFor,
  type PageApiServices,
} from './plugins/page-api';
import defaultChromeLayout from './shell/layouts/default/layout.js';
import defaultChromeStylesheet from './shell/layouts/default/layout.css?url';
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
import { startPageCoreSlots } from './state/core-slots';
import { createPageState } from './state/page-state';
import { createPageUiState } from './ui-state';
import { createVisualFrames } from './visual-frames/visual-frames';

// The scope page keys fire in until a plugin sets one: only `any` binds match.
const INITIAL_SCOPE = 'any';

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
  const registry = new CommandRegistry<PageCommandContext<any>>(log);
  const hasHandler = (id: string) => registry.has(id);
  const config = startedPluginsConfig(served, pageLoadList, hasHandler);
  // Read before the plugins start, so each reads its state as it starts.
  const uiState = createPageUiState(await bridge.uiState(), (key, value) =>
    bridge.setUiState(key, value),
  );
  const state = await createPageState(bridge, log);
  const live = createLiveConfig(config, log);
  // Written before any plugin starts: it tells main the old page's commands are gone.
  const runtimeCatalog = state.publish(coreRuntimePageSlot);
  runtimeCatalog.set(EMPTY_RUNTIME_CATALOG);
  const commands = createRuntimeCommands<PageCommandContext<any>>({
    process: 'page',
    registry,
    writer: runtimeCatalog,
    other: state.read(coreRuntimeMainSlot, 'core'),
    served: () => live.current().commands,
    leader: () => live.current().keymap.editor.leader,
    async remote(id, arg) {
      try {
        await bridge.runCommand(id, arg);
      } catch (error) {
        log('commands', `command ${id} failed: ${errorText(error)}`);
      }
    },
  });
  bridge.onRunCommand(async (id, arg) => {
    try {
      await commands.router.run(id, arg);
    } catch (error) {
      log('commands', `command ${id} failed: ${errorText(error)}`);
    }
  });
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

  document.documentElement.dataset.platform = config.platform.os;
  const scopeStack = createScopeStack(INITIAL_SCOPE);
  // Anchors use `promptKeysFor`: a prompt skips vim's own keys.
  const anchors = createAnchors({
    keysFor: (command, scope, where, arg) => {
      const { keymap, platform } = live.current();
      return promptKeysFor(keymap, command, scope, platform.os, where, arg);
    },
    label: (id) => commandLabel(live.current().commands, id),
    scope: () => scopeStack.current(),
    platform: live.current().platform.os,
  });
  wireAnchors({ live, scopeStack, anchors });
  const keyHints: KeyHints = {
    keysFor: liveKeysFor(live),
    anchor: anchors.anchor,
    onKeymapChanged: (listener) =>
      onChangedPart(live, (served) => served.keymap, listener),
  };
  const shell = mountShell(
    document.getElementById('app') as HTMLElement,
    defaultShellLayout,
    uiState.scoped('shell'),
    timers,
    keyHints,
  );
  const { areas } = shell;
  const markdown = createMarkdownItRenderer(createCodeMirrorHighlighter());
  const chrome = mountShellChrome({
    areas,
    defaultLayout: defaultChromeLayout,
    services: {
      markdown,
      keys: keyHints,
      platform: config.platform.os,
      commands: {
        exists: (id) => live.current().commands[id] !== undefined,
        argShape: (id) => live.current().commands[id]?.arg,
        run: (id) => commands.router.run(id, undefined),
      },
      state: layoutState(state, 'shell', (handle) => handle),
    },
    instance: config.appInstance,
    log,
  });
  const narrow = window.matchMedia(SIDE_BAR_OVER_QUERY);
  const modes = createModes({
    place(mode, handle) {
      const placement = createRegistrations();
      placement.track(areas.main.contribute(mode.element));
      if (mode.sideBar !== undefined) {
        placement.track(areas.sideBar.contribute(mode.sideBar));
      }
      placement.track(chrome.addMode(mode, handle));
      return placement;
    },
    marked: (modeId) => chrome.markMode(modeId),
    layOutSideBar: (layout) => shell.layOutSideBar(layout),
    showContext: (context) => chrome.showContext(context),
    // `paneTargets` is made below; no mode is added before it.
    sideBarOpened: () => paneTargets.sideBarOpened(),
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

  const coreSlots = startPageCoreSlots(state, {
    scope: scopeStack,
    modes,
    theme: config.theme.name,
  });
  const paneTargets = createPaneTargets(
    shell.sideBarDivider,
    () => scopeStack.anyPushed(),
    (message) => log('page', message),
    {
      focusSideBar: () => modes.focusSideBar(),
      focusMain: () => modes.focusMain(),
      rightBarStops: () => shell.rightBarStops(),
    },
  );
  // Targets a view set under the previous base belong to a view no longer in
  // force, and the base change ends an area's turn.
  scopeStack.onBaseChange(() => paneTargets.baseChanged());
  shell.onRightBarStopRemoved((stop) => paneTargets.stopRemoved(stop));
  document.addEventListener('focusin', (event) => {
    const isInRightBar =
      event.target instanceof Node && shell.rightBarHolds(event.target);
    if (!isInRightBar) {
      paneTargets.focusLeftRightBar();
    }
  });
  const drops = createDropTargets({
    document,
    bridge,
    toast: (text, tone) => toasts.show(text, tone),
    isShown: (element) => element.checkVisibility(),
  });
  for (const direction of PANE_DIRECTIONS) {
    registry.register(
      PANE_RESIZE_COMMANDS[direction],
      () => paneTargets.resize(direction),
      'core',
    );
    registry.register(
      PANE_FOCUS_COMMANDS[direction],
      () => paneTargets.focus(direction),
      'core',
    );
  }
  // Rejects editor binds vim could not tell apart, before any is mapped.
  requireUnambiguousEditorBinds(keymap.editor.binds, keymap.editor.leader);
  const paths = config.platform.os === 'windows' ? windowsPaths : posixPaths;
  const fuzzy = createFzfMatcher();
  const editor = createCodeMirrorVimHost(
    keymap.editor,
    (binds, fired) =>
      runEditorBind(binds, fired, {
        scope: () => scopeStack.current(),
        run: (bind, editorFired) =>
          runBound(
            commands.keyCommands,
            bind,
            { keys: bind.keys, source: 'page', log },
            { editor: editorFired },
          ),
        log,
      }),
    log,
    { paths, fileIcon: () => icon('file') },
    fuzzy,
  );
  const boxFocus = createBoxFocus(document, editor);
  // Highlighted markdown has no editor to mount the code colours.
  mountCodeColours(document);
  const services: PageApiServices = {
    editor,
    markdown,
    fuzzy,
    markup: createFabricMarkupEditor(),
    visualFrames,
    toast: (text, tone) => toasts.show(text, tone),
    log,
    timers,
    clock,
    paths,
    homeDir: config.homeDir,
    runMode: config.runMode,
    chooseFolder: () => bridge.chooseFolder(),
    openExternal: (url) => bridge.openExternal(url),
  };
  // Starts with no binds, since `createPendingKeys` needs it first and binds wait
  // for the parts: a key pressed while they start matches nothing.
  const pageKeys = installPageKeys(
    settings.keySequenceTimeoutMs,
    () => scopeStack.current(),
    editor,
    commands.keyCommands,
    log,
    timers,
    boxFocus,
  );
  const pendingKeys = createPendingKeys({
    page: pageKeys,
    editor,
    scope: () => scopeStack.current(),
  });
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
    defaultStylesheet: defaultChromeStylesheet,
    read: readShellLayout,
    userLayout: () => live.current().settings.shell.layout,
    setLayouts(shown) {
      chrome.setLayouts(shown);
      shell.setChromeLayout(shown.user);
    },
  });
  startPlugins(
    pageParts,
    'page',
    (part, context) => {
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
          commands,
          dependency: context.dependency,
          registrations: context.registrations,
          bus,
          layouts,
          paneTargets,
          drops,
          state,
          anchors,
          boxFocus,
        }),
      );
      const handlers: Record<
        string,
        CommandHandler<PageCommandContext<any>>
      > = started.commands;
      for (const [short, handler] of Object.entries(handlers)) {
        context.registrations.track(
          registry.register(qualify(id, short), handler, id),
        );
      }
      return started;
    },
    manifests,
    pageLoadList,
    log,
  );
  anchors.reveal();
  registry.requireRegistered(
    [...keymap.editor.binds, ...keymap.page].map((bind) => bind.command),
  );
  runtimeCatalog.set({
    ...(runtimeCatalog.get() ?? EMPTY_RUNTIME_CATALOG),
    started: true,
  });
  // Building the matcher rejects a page key bound twice in one scope.
  pageKeys.setBinds(keymap.page, settings.keySequenceTimeoutMs);

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
          coreSlots.themeApplied(theme.name);
        },
      },
      editor,
      commands: registry,
      pageKeys,
      problems: { show: (next) => chrome.showProblems(next) },
      toasts,
      log,
    },
  );
  applyPush = (next) =>
    applyStartedPush(startedPluginsConfig(next, pageLoadList, hasHandler));
  if (heldPush !== null) {
    applyPush(heldPush);
    heldPush = null;
  }
  bus.emit(qualify('core', 'pageReady'), null);
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
