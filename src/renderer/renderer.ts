// Composition root for the renderer: the one module that picks adapters and
// starts the page parts of the plugins.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './index.css';
import '../shared/page/ui/materials.css';
import './shell/shell.css';
import type { Clock, Timers } from '../contracts/ambient';
import { CORE_OPEN_LINK, MODES_SHOW } from '../contracts/commands';
import {
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
} from '../contracts/core-state';
import type { DemoStep } from '../contracts/demo';
import {
  PANE_DIRECTIONS,
  PANE_FOCUS_COMMANDS,
  PANE_RESIZE_COMMANDS,
} from '../contracts/panes';
import type {
  CommandHandler,
  KeyHints,
  PageCommandContext,
  PagePart,
} from '../contracts/plugin';
import type { ServedPlugin } from '../contracts/plugin-catalog';
import type { AppConfig } from '../contracts/settings';
import { pageParts } from '../plugins/page';
import { CommandRegistry } from '../shared/command-registry';
import { createDemoStepRegistry } from '../shared/demo-step-registry';
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
import { listenToLinkClicks, registerLinkCommands } from './link-commands';
import { createLiveConfig, onChangedPart } from './live-config';
import { createLogView } from './log-view';
import { createMarkdownItRenderer } from './markdown-it/markdown-it-renderer';
import { createScopeStack } from './key-scope';
import { installPageKeys } from './page-keys';
import {
  deferredPageIds,
  loadPagePart,
  pagePartIds,
  startCheckedPart,
} from './page-part-loader';
import { createPageRestores } from './page-restores';
import {
  createPaneTargets,
  listenToBarFocus,
  listenToScopes,
} from './pane-targets';
import { createPendingKeys } from './pending-keys';
import { registerPickerCommands } from './picker-commands';
import { createPluginPartsAnswers } from './plugin-parts-answer';
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
import { shellCommands } from './shell/shell-commands';
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

// Throws for a page part main served no settings for: main did not admit its
// plugin, so it would get no keys, labels or settings.
function requireServedSettings(config: AppConfig, pluginId: string) {
  if (!Object.hasOwn(config.pluginSettings, pluginId)) {
    throw new Error(
      `Plugin "${pluginId}" has a page part but main served no settings for it`,
    );
  }
}

async function start() {
  const bridge = window.wigley.claim();
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
  const served = await bridge.config();
  // Read by the start callback, the live `known` and the answer below, so it
  // is set before the first part starts.
  let lastPush = served;
  const loadPart = (plugin: ServedPlugin) =>
    loadPagePart(plugin, {
      builtIns: pageParts,
      importModule: (url) => import(/* @vite-ignore */ url),
    });
  // The host starts with the built-in parts. A user part, and each part
  // depending on one in the page, is loaded, added and started after load,
  // one start request at a time (`createPluginPartsAnswers`), so a throw in
  // one fails only that part and a plugin that is off has its `page.js`
  // imported only at its switch-on. Held as `disabled` ids instead, a
  // built-in naming one in `dependsOn.main` would fail the host's disabled
  // check.
  const deferred = deferredPageIds(served.plugins);
  const startsAtLoad = pagePartIds(served.plugins, pageParts).filter(
    (id) => !deferred.includes(id),
  );
  const registry = new CommandRegistry<PageCommandContext<any>>(log);
  const hasHandler = (id: string) => registry.has(id);
  // Without the binds of the page parts the host does not start with, so
  // `requireRegistered` below meets no bind of a deferred part.
  const config = startedPluginsConfig(
    served,
    pagePartIds(served.plugins, pageParts).filter(
      (id) => !startsAtLoad.includes(id),
    ),
    hasHandler,
  );
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
    async remote(id, arg, hop) {
      try {
        return await bridge.runCommand(id, arg, hop);
      } catch (error) {
        if (hop.reportErrors === true) {
          throw error;
        }
        log('commands', `command ${id} failed: ${errorText(error)}`);
        return 'skipped';
      }
    },
  });
  // A run that reports rejects, and the preload sends main its error text.
  bridge.onRunCommand(async (id, arg, hop) => {
    const { reportErrors, ...sessions } = hop;
    try {
      return await commands.router.run(id, arg, sessions, { reportErrors });
    } catch (error) {
      if (reportErrors === true) {
        throw error;
      }
      log('commands', `command ${id} failed: ${errorText(error)}`);
      return 'skipped';
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
      commands: shellCommands(commands, log),
      state: layoutState(state, 'shell', (handle) => handle),
    },
    instance: config.appInstance,
    log,
  });
  const narrow = window.matchMedia(SIDE_BAR_OVER_QUERY);
  // A side bar crowded by the left bar lays out as in a narrow window, so it
  // never lies beside under the left bar.
  const hasNoSideBarRoom = () => narrow.matches || shell.isSideBarCrowded();
  let wasNoSideBarRoom = hasNoSideBarRoom();
  const sideBarRoomChanged = () => {
    const isNoRoom = hasNoSideBarRoom();
    if (isNoRoom !== wasNoSideBarRoom) {
      wasNoSideBarRoom = isNoRoom;
      modes.narrowChanged(isNoRoom);
    }
  };
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
    isNarrow: wasNoSideBarRoom,
    log,
  });
  narrow.addEventListener('change', sideBarRoomChanged);
  shell.onSideBarCrowdedChanged(sideBarRoomChanged);
  const toastLayer = document.createElement('div');
  toastLayer.className = 'toasts';
  areas.overlay.contribute(toastLayer);
  const toasts = createToasts(
    toastLayer,
    timers,
    (parent, input) => chrome.drawToast(parent, input),
    (message) => log('toasts', message),
  );
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
      barStops: (bar) => shell.barStops(bar),
    },
    queueMicrotask,
  );
  listenToScopes(scopeStack, paneTargets);
  shell.onBarStopRemoved((stop) => paneTargets.stopRemoved(stop));
  // A click on no focusable spot sends the focus to the body with no
  // `focusin`, so a `focusout` from a bar tells that drop.
  listenToBarFocus(
    document,
    (target) => (target instanceof Node ? shell.barHolding(target) : null),
    queueMicrotask,
    paneTargets,
  );
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
  registry.register(
    MODES_SHOW.id,
    ({ arg }: PageCommandContext<string>) => chrome.showMode(arg),
    'core',
  );
  const pickerCommands = registerPickerCommands(registry);
  registerLinkCommands(registry, {
    openExternal: (url) => bridge.openExternal(url),
    toast: (text, tone) => toasts.show(text, tone),
    log: (message) => log('page', message),
  });
  listenToLinkClicks(document, (url) => {
    commands.router.run(CORE_OPEN_LINK.id, url).catch((error: unknown) => {
      log(
        'commands',
        `command ${CORE_OPEN_LINK.id} failed: ${errorText(error)}`,
      );
    });
  });
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
    demoSteps: createDemoStepRegistry<DemoStep>(),
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
    config.platform.keys,
  );
  const pendingKeys = createPendingKeys({
    page: pageKeys,
    editor,
    scope: () => scopeStack.current(),
  });
  const bus = createEventBus();
  const restores = createPageRestores({
    timers,
    log: (message) => log('page', message),
  });
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
  const pageHost = startPlugins(
    startsAtLoad.map(
      (id) => pageParts.find((part) => part.manifest.id === id) as PagePart,
    ),
    'page',
    (part, context) => {
      const { id } = part.manifest;
      requireServedSettings(lastPush, id);
      const origin =
        lastPush.plugins.find((plugin) => plugin.id === id)?.origin ?? 'user';
      const started = startCheckedPart(
        part,
        origin,
        (checked) =>
          checked.start(
            createPageApi(checked.manifest, {
              areas,
              modes,
              setLayout: (layout) => shell.setLayout(layout),
              transparency,
              bridge,
              scopeStack,
              pendingKeys,
              keyCapture: pageKeys,
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
              restores,
              state,
              anchors,
              boxFocus,
              pickerCommands,
            }),
          ),
        log,
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
    // Read at each check, so a plugin added live finds a dependency added in
    // the same change.
    () => lastPush.plugins.map((plugin) => plugin.manifest),
    // Main serves the applied list in `plugins.disabled`, and no command, bind
    // or scope of those plugins.
    served.settings.plugins.disabled,
    log,
  );
  anchors.reveal();
  registry.requireRegistered(
    [...keymap.editor.binds, ...keymap.page].map((bind) => bind.command),
  );
  // Main sends plugin parts requests once `started` is set, so the page
  // listens first: a later throw in this start still answers them. Main's
  // requests and the load's own below share one queue.
  const answers = createPluginPartsAnswers(pageHost, {
    restores,
    reapplyPush: () => applyLivePush(lastPush),
    log,
    served: () => lastPush,
    loadPart,
  });
  bridge.onPluginParts((request) => answers.answer(request));
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
      // The side, left and right bars' open widths are the theme's
      // `sidebar-width`, `leftbar-width` and `rightbar-width` tokens.
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
  // The page binds rule: main has stripped the plugins that are off, and the
  // page strips the page parts its host has not started yet, so
  // `requireRegistered` meets no bind of a part still to start. Only plugins
  // with a page part are stripped: a main-only plugin keeps its page binds,
  // and a page.js that failed to load keeps its binds stripped.
  const notStarted = () =>
    pagePartIds(lastPush.plugins, pageParts).filter(
      (id) => !pageHost.started.has(id),
    );
  const applyLivePush = (next: AppConfig) => {
    lastPush = next;
    applyStartedPush(startedPluginsConfig(next, notStarted(), hasHandler));
  };
  applyPush = applyLivePush;
  if (heldPush !== null) {
    applyPush(heldPush);
    heldPush = null;
  }
  pageHost.ready();
  restores.partsReady();
  // A reload that raced a switch still ends running what the last push's list
  // says.
  const loadDisabled = lastPush.settings.plugins.disabled;
  await answers.answer({
    kind: 'stop',
    ids: [...pageHost.started.keys()].filter((id) => loadDisabled.includes(id)),
  });
  // One request per id, in dependency order, so a throw in one part does not
  // stop the next; a failure is logged, and main's own `start` for the id
  // carries it to the Settings row. A plugin a push switched off before its
  // turn is skipped.
  for (const id of notStarted()) {
    await answers.startAtLoad(id);
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
