import '../../../shared/page/markdown.css';
import './docs.css';
import type { CommandId } from '../../../contracts/commands';
import { type CoreEvents, coreModeSlot } from '../../../contracts/core-state';
import type { ResizeTarget } from '../../../contracts/panes';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
  ShownLayouts,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import { sheet } from '../../../shared/page/ui/sheet';
import type { RollbackDeps } from '../../../shared/page/layout-host/draw-part';
import { createSplit, type Split } from '../../../shared/page/ui/split';
import { qualify } from '../../../shared/plugin-manifests';
import {
  followRows,
  type SessionRow,
  type SessionTabHandle,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  type DocsChannel,
  type DocsPageEvents,
  type DocsPageExports,
  type DocsViewHandle,
  MACHINE_SOURCE_ID,
  sessionSourceId,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { docsManifest } from '../manifest';
import { type DocChangeRecord, UNSAVED_TEXT } from './docs-state';
import {
  createDocsView,
  type DocsView,
  type DocsViewCommands,
} from './docs-view';
import { createDocsPicker } from './docs-dialogs';
import { commandOfKeysIn } from './hidden-tree-keys';
import type { DocsScope } from './layout/docs-parts';
import { readDocsLayout } from './layout/read-layout';
import { createStarredDocs } from './starred-docs';

type DocsApi = PageApi<
  typeof docsManifest,
  DocsChannel,
  DocsPageEvents,
  QualifiedEvents<'core', CoreEvents>
>;

// A view `addView` handed out.
interface AddedView {
  view: DocsView;
  split: Split;
  // Per view and never stored: each view starts with the tree shown.
  isTreeHidden: boolean;
  isVisible(): boolean;
}

interface SessionDocs {
  view: DocsViewHandle;
  // The docs view behind `view`.
  docsView: DocsView;
  // Null until `addTab` returns.
  tab: SessionTabHandle | null;
}

// The tree commands that need the tree in sight. While a docs view's tree is
// hidden, each moves focus to the doc pane and runs what its key runs there,
// by the keymap in force.
const TREE_COMMANDS_IN_SIGHT: ReadonlySet<keyof DocsViewCommands> = new Set<
  keyof DocsViewCommands
>([
  'treeDown',
  'treeUp',
  'treeOpen',
  'treeToggle',
  'treeClose',
  'treeTop',
  'treeBottom',
  'filter',
  'rescan',
  'pickContext',
  'toggleStar',
  'createByKind',
  'createByPath',
  'rename',
  'trash',
]);

const TREE_COMMAND_IDS: ReadonlySet<CommandId> = new Set(
  [...TREE_COMMANDS_IN_SIGHT].map((command) =>
    qualify(docsManifest.id, command),
  ),
);

// An added view's split limits in CSS pixels: the tree's opening and least
// widths, and the doc's least width; every added view reads and writes the one
// stored width.
const SESSION_TREE_SPLIT = { initial: 288, min: 160, endMin: 240 };

// Docs mode over the machine's index, its tree in the side bar and its doc in
// the sheet, and the views `addView` hands out, each its tree and doc side by
// side in a split: a Docs tab in every session over that session's index among
// them, rebuilt once shown when the session's host id changes. Each command
// acts on the active view: the machine view while Docs mode shows, else the
// added view that is visible. A change made in one view reaches every other and
// the star set every view shares, and a view showing closes the others'
// overlays, since two views' pane scopes may be equal. `toggleTree` hides or
// shows the active view's tree. `openDoc` opens a doc in Docs mode, and
// `openMain` the Main page there, from any docs view.
export const docsPagePart: PagePart<typeof docsManifest> = {
  manifest: docsManifest,
  start(api: DocsApi) {
    const { services } = api;
    const { log } = services;
    const sessions = api.dependency(sessionsPageKey);
    // A page reload leaves main's watches for the old page's views.
    api.channel
      .invoke('unwatchAll')
      .catch((error) => log(`watches not cleared: ${errorText(error)}`));

    let isDocsModeShown = false;
    // View id → the added view.
    const addedViews = new Map<string, AddedView>();
    let addedCount = 0;
    const sessionDocs = new Map<string, SessionDocs>();
    // One star set, shared by every view.
    const starred = createStarredDocs(services.uiState, services.paths);
    // The layouts every view draws with, read as a view's parts are made and
    // at each set; `default` until the first set is shown.
    let current: ShownLayouts<Layout> = {
      layouts: new Map([['default', defaultLayout]]),
      user: 'default',
    };
    const kitServices: OwnerKitServices = {
      markdown: services.markdown,
      keys: api.keys,
      commands: {
        exists: (id) => api.keys.command(id) !== undefined,
        argShape: (id) => api.keys.command(id)?.arg,
        run: (id) => api.commands.run(id),
      },
      platform: api.platform.os,
      state: api.state.forLayouts,
    };
    // A base kit whose keys fire in the docs scope `scope`, each anchor it
    // names recorded by `rollback`.
    const baseKit = (scope: DocsScope, rollback: RollbackDeps) =>
      createBaseKit(
        ownerBaseKitDeps(docsManifest, kitServices, scope, rollback),
      );

    const allViews = (): DocsView[] => [
      machineView,
      ...[...addedViews.values()].map((added) => added.view),
    ];

    const otherViews = (view: DocsView) =>
      allViews().filter((each) => each !== view);

    const changedIn = (view: DocsView, change: DocChangeRecord) => {
      for (const other of otherViews(view)) {
        other.outsideChange(change);
      }
    };

    // Runs before the shown view sets its scope.
    const closeOverlaysBesides = (view: DocsView) => {
      for (const other of otherViews(view)) {
        other.closeOverlays();
      }
    };

    // The one list every view opens, contributed under each view's dialogs.
    const docsPicker = createDocsPicker(
      services.picker.create({ filter: true }),
    );

    // `changed` reads the view only once a change is made, after creation.
    // Each scope the view sets is followed by `resizeTarget`, the divider the
    // resize keys move while the view has the keys (null moves the side bar),
    // and by the view's focus target, which moves between its tree and doc.
    const createView = (
      viewId: string,
      sourceId: string,
      isActive: () => boolean,
      openChanged: (path: string | null) => void,
      revealTree: () => void,
      leafOpened: () => void,
      resizeTarget: ResizeTarget | null,
    ): DocsView => {
      const view: DocsView = createDocsView({
        viewId,
        sourceId,
        channel: api.channel,
        homeDir: services.homeDir,
        editor: services.editor,
        markdown: services.markdown,
        matcher: services.fuzzy,
        picker: docsPicker.forView(viewId),
        paths: services.paths,
        toast: services.toast,
        openExternal: services.openExternal,
        drops: api.drops,
        starred,
        now: () => services.clock.now(),
        log,
        anchor: (element, command, options) =>
          api.keys.anchor(element, qualify(docsManifest.id, command), {
            ...options,
            scope: qualify(docsManifest.id, options.scope),
          }),
        setScope: (scope) => {
          api.keys.setScope(scope);
          api.panes.setResizeTarget(resizeTarget);
          api.panes.setFocusTarget(view.focusTarget);
        },
        pushScope: (scope) => api.keys.pushScope(scope),
        isActive,
        openChanged,
        docOpened: (path) => api.events.emit('docOpened', { path }),
        revealTree,
        isTreeOwnPane: () => addedViewOf(view)?.isTreeHidden === false,
        leafOpened,
        addOverlay: (element) => api.areas.overlay.contribute(element),
        layouts: () => current,
        baseKit,
        changed: (change) => changedIn(view, change),
        unsavedPaths: () =>
          allViews()
            .map((each) => each.unsavedPath())
            .filter((path) => path !== null),
      });
      return view;
    };

    // The title bar shows the machine view's open doc while Docs mode shows.
    // `openChanged`, `revealTree` and `leafOpened` read `mode` once a doc
    // opens or a key runs, after `add`. A doc opened from the tree closes the
    // side bar's overlay.
    const machineView = createView(
      'machine',
      MACHINE_SOURCE_ID,
      () => isDocsModeShown,
      (path) =>
        mode.setContext(
          path === null
            ? null
            : {
                title: services.paths.tilde(path, services.homeDir),
                detail: null,
              },
        ),
      () => {
        if (!mode.sideBarShown()) {
          mode.toggleSideBar();
          showTreeEdge(machineView);
        }
      },
      () => {
        mode.picked();
        showTreeEdge(machineView);
      },
      null,
    );

    // Each set redraws every view's parts its pick changed for.
    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readDocsLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        current = shown;
        log(`layouts shown: ${shown.user}`);
        callEach(allViews(), (view) => view.layoutsChanged());
      },
    });

    const docsSheet = sheet();
    docsSheet.classList.add('docs-sheet');
    docsSheet.append(machineView.doc);
    // Any scope pushed over the view's pane scope counts: a docs dialog or
    // picker, the filter box, the changed-on-disk prompt, help, or another
    // plugin's. Each ends when the pane scope changes under it.
    const isScopePushedOver = (view: DocsView): boolean =>
      api.keys.scope() !== qualify(docsManifest.id, view.focusScope());

    // As a view's tree hides, its filter box is dismissed first, since a
    // hidden box must never hold the keys. Every other pushed scope is kept
    // through a hide or an open-over, so focus moves only while none is
    // pushed; a tree key moves it later (`runInDocPane`).
    const treeHiddenIn = (view: DocsView) => {
      view.dismissFilter();
      if (!isScopePushedOver(view)) {
        view.treeHidden();
      }
    };

    const treeOpenedOverIn = (view: DocsView) => {
      if (!isScopePushedOver(view)) {
        view.treeOpenedOver();
      }
    };

    // `add` calls `shown` before it returns only for the first mode added;
    // Sessions mode starts before Docs mode. Focus leaves the tree for the
    // doc as the side bar hides, and moves to the tree as it opens over the
    // doc, by `treeHiddenIn` and `treeOpenedOverIn`. The core's Alt+h past the
    // doc enters the tree as the side bar, and its way back returns to main's
    // last pane.
    const mode = api.modes.add({
      id: 'docs',
      title: 'Docs',
      icon: 'book',
      element: docsSheet,
      sideBar: machineView.tree,
      shown() {
        isDocsModeShown = true;
        closeOverlaysBesides(machineView);
        api.keys.setScope(machineView.focusScope());
        api.panes.setResizeTarget(null);
        api.panes.setFocusTarget(machineView.focusTarget);
        machineView.showFirstTime();
        showTreeEdge(machineView);
      },
      hidden: () => undefined,
      sideBarHidden: () => {
        treeHiddenIn(machineView);
        showTreeEdge(machineView);
      },
      sideBarOpenedOver: () => {
        treeOpenedOverIn(machineView);
        showTreeEdge(machineView);
      },
      focusSideBar: () => machineView.focusTree(),
      focusMain: () => machineView.focusMain(),
    });
    // A narrowing hides the side bar without telling the mode, so the machine
    // view's edge prompt follows the window too, once the core has laid out.
    let pendingResizeFrame: number | null = null;
    const onWindowResize = () => {
      pendingResizeFrame ??= requestAnimationFrame(() => {
        pendingResizeFrame = null;
        showTreeEdge(machineView);
      });
    };
    window.addEventListener('resize', onWindowResize);
    api.state.read(coreModeSlot).on((modeId) => {
      isDocsModeShown = modeId === 'docs.docs';
    });

    // Hiding moves focus by `treeHiddenIn`, as Docs mode's side bar hiding
    // does. Showing leaves focus where it is, as the side bar showing beside
    // the doc does.
    const setTreeHidden = (added: AddedView, isHidden: boolean) => {
      added.split.setStartHidden(isHidden);
      added.isTreeHidden = isHidden;
      showTreeEdge(added.view);
      log(isHidden ? 'tree hidden' : 'tree shown');
      if (isHidden) {
        treeHiddenIn(added.view);
      }
    };

    // A docs view over the source `sourceId`, its tree and doc in a split
    // whose width every added view shares, and its handle; its keys act while
    // `isVisible`.
    const addView = (
      sourceId: string,
      options: { isVisible(): boolean },
    ): { handle: DocsViewHandle; view: DocsView } => {
      addedCount += 1;
      const viewId = `view:${String(addedCount)}`;
      const split = createSplit({
        ...SESSION_TREE_SPLIT,
        uiState: services.uiState,
        stateKey: 'sessionTree',
        anchor: api.keys.anchor,
        timers: services.timers,
      });
      const added: AddedView = {
        view: createView(
          viewId,
          sourceId,
          () => options.isVisible(),
          () => undefined,
          () => {
            if (added.isTreeHidden) {
              setTreeHidden(added, false);
            }
          },
          () => undefined,
          split,
        ),
        split,
        isTreeHidden: false,
        isVisible: () => options.isVisible(),
      };
      split.element.classList.add('docs-split');
      split.start.append(added.view.tree);
      split.end.append(added.view.doc);
      addedViews.set(viewId, added);
      const handle: DocsViewHandle = {
        element: split.element,
        shown() {
          // Another view's drag may have stored a new width since this one
          // last showed.
          split.reloadWidth();
          closeOverlaysBesides(added.view);
          api.keys.setScope(added.view.focusScope());
          api.panes.setResizeTarget(split);
          api.panes.setFocusTarget(added.view.focusTarget);
          log('Docs tab shown');
          added.view.showFirstTime();
        },
        hasUnsavedEdits: () => added.view.hasUnsavedEdits(),
        dispose() {
          addedViews.delete(viewId);
          callEach([added.view, split], (part) => part.dispose());
        },
      };
      return { handle, view: added.view };
    };

    const addSessionDocs = ({ sessionId, projectDir }: SessionRow) => {
      const added = addView(sessionSourceId(sessionId), {
        isVisible: () => held.tab?.isVisible() === true,
      });
      const held: SessionDocs = {
        view: added.handle,
        docsView: added.view,
        tab: null,
      };
      sessionDocs.set(sessionId, held);
      log(`Docs tab added for ${projectDir ?? 'a session with no folder'}`);
      held.tab = sessions.addTab(sessionId, {
        id: 'docs',
        title: 'Docs',
        icon: 'book',
        element: held.view.element,
        order: 1,
        beforeClose() {
          if (held.view.hasUnsavedEdits()) {
            services.toast(UNSAVED_TEXT, 'error');
            return false;
          }
          return true;
        },
        shown: () => held.view.shown(),
      });
    };
    // The tab goes first, so it never holds a disposed view.
    const disposeSessionDocs = (held: SessionDocs) => {
      callEach([held.tab, held.view], (part) => part?.dispose());
    };
    const removeSessionDocs = (sessionId: string) => {
      const held = sessionDocs.get(sessionId);
      if (held === undefined) {
        return;
      }
      sessionDocs.delete(sessionId);
      disposeSessionDocs(held);
    };
    api.events.on('core.pageReady', () => {
      followRows(api.state.read(sessionsRowsSlot), {
        added: addSessionDocs,
        removed: removeSessionDocs,
        // Main replaces a session's index source when its host id changes.
        hostChanged: ({ sessionId }) =>
          sessionDocs.get(sessionId)?.docsView.sourceReplaced(),
      });
    });

    const addedViewOf = (view: DocsView): AddedView | undefined =>
      [...addedViews.values()].find((added) => added.view === view);

    const isTreeHiddenIn = (view: DocsView): boolean =>
      view === machineView
        ? !mode.sideBarShown()
        : addedViewOf(view)?.isTreeHidden === true;

    // Tells a view whether its tree shows, so its doc pane draws the edge
    // prompt to the tree only while a key reaches it.
    const showTreeEdge = (view: DocsView) =>
      view.treeShownChanged(!isTreeHiddenIn(view));

    const activeView = (): DocsView | null => {
      if (isDocsModeShown) {
        return machineView;
      }
      for (const added of addedViews.values()) {
        if (added.isVisible()) {
          return added.view;
        }
      }
      return null;
    };

    const showDocsMode = () => {
      if (!mode.isShown()) {
        mode.show();
      }
    };

    // Shows Docs mode, then opens `path` in the machine view by its
    // `openDoc`, which waits for the view's first index read and, when that
    // does not list `path`, for a rebuild coming or running.
    const openDoc = (path: string, line: number | null) => {
      showDocsMode();
      machineView.openDoc(path, line);
    };
    api.channel.on('openDoc', ({ path, line }) => openDoc(path, line));

    // On a docs view whose tree is hidden — Docs mode's side bar by `Space k
    // d`, `Space v t` or a narrow window, or an added view's tree by `Space v
    // t` — a tree command moves focus to the doc pane and runs the command
    // its key runs there, so no key moves a selection out of sight and `j`
    // scrolls the doc on its first press. The handler is not told which key
    // fired, so it runs one only when every key of the tree command runs the
    // same command in the doc pane, and never a tree command, which would
    // land here again.
    const runInDocPane = (view: DocsView, command: keyof DocsViewCommands) => {
      const treeScope = api.keys.scope();
      view.treeHidden();
      const docCommand = commandOfKeysIn(
        api.keys.keymap(),
        qualify(docsManifest.id, command),
        treeScope,
        api.keys.scope(),
      );
      const isRunnable =
        docCommand !== null && !TREE_COMMAND_IDS.has(docCommand);
      log(
        `tree out of sight: ${command} ran ${isRunnable ? docCommand : 'nothing'} in the doc`,
      );
      if (isRunnable) {
        api.commands.run(docCommand);
      }
    };

    const onActiveView = (command: keyof DocsViewCommands) => () => {
      const view = activeView();
      if (view === null) {
        return;
      }
      const isTreeOutOfSight =
        TREE_COMMANDS_IN_SIGHT.has(command) && isTreeHiddenIn(view);
      if (isTreeOutOfSight) {
        runInDocPane(view, command);
        return;
      }
      view.commands[command]();
    };

    // The core logs the side bar's hiding and showing.
    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
        return;
      }
      mode.toggleSideBar();
      showTreeEdge(machineView);
    };

    const toggleTree = () => {
      const view = activeView();
      if (view === null) {
        return;
      }
      if (view === machineView) {
        mode.toggleSideBar();
        showTreeEdge(view);
        return;
      }
      const added = addedViewOf(view);
      if (added !== undefined) {
        setTreeHidden(added, !added.isTreeHidden);
      }
    };

    return {
      commands: {
        showMode,
        toggleTree,
        treeDown: onActiveView('treeDown'),
        treeUp: onActiveView('treeUp'),
        treeTop: onActiveView('treeTop'),
        treeBottom: onActiveView('treeBottom'),
        treeOpen: onActiveView('treeOpen'),
        treeToggle: onActiveView('treeToggle'),
        treeClose: onActiveView('treeClose'),
        filter: onActiveView('filter'),
        rescan: onActiveView('rescan'),
        pickContext: onActiveView('pickContext'),
        toggleStar: onActiveView('toggleStar'),
        toggleWikiView: onActiveView('toggleWikiView'),
        backToTree: onActiveView('backToTree'),
        scrollDown: onActiveView('scrollDown'),
        scrollUp: onActiveView('scrollUp'),
        lineDown: onActiveView('lineDown'),
        lineUp: onActiveView('lineUp'),
        halfPageDown: onActiveView('halfPageDown'),
        halfPageUp: onActiveView('halfPageUp'),
        edit: onActiveView('edit'),
        editSection: onActiveView('editSection'),
        prevSection: onActiveView('prevSection'),
        nextSection: onActiveView('nextSection'),
        historyBack: onActiveView('historyBack'),
        historyForward: onActiveView('historyForward'),
        openMain: () => {
          showDocsMode();
          machineView.openMain();
        },
        listOpen: onActiveView('listOpen'),
        quitEditor: onActiveView('quitEditor'),
        conflictReload: onActiveView('conflictReload'),
        conflictOverwrite: onActiveView('conflictOverwrite'),
        conflictCancel: onActiveView('conflictCancel'),
        pickerDown: onActiveView('pickerDown'),
        pickerUp: onActiveView('pickerUp'),
        pickerTop: onActiveView('pickerTop'),
        pickerBottom: onActiveView('pickerBottom'),
        pickerChoose: onActiveView('pickerChoose'),
        pickerCancel: onActiveView('pickerCancel'),
        pickerFilter: onActiveView('pickerFilter'),
        pickerList: onActiveView('pickerList'),
        boxComplete: onActiveView('boxComplete'),
        boxAccept: onActiveView('boxAccept'),
        boxCancel: onActiveView('boxCancel'),
        createByKind: onActiveView('createByKind'),
        createByPath: onActiveView('createByPath'),
        rename: onActiveView('rename'),
        trash: onActiveView('trash'),
        confirmYes: onActiveView('confirmYes'),
        confirmNo: onActiveView('confirmNo'),
        asideDown: onActiveView('asideDown'),
        asideUp: onActiveView('asideUp'),
        asideTop: onActiveView('asideTop'),
        asideBottom: onActiveView('asideBottom'),
        asideOpen: onActiveView('asideOpen'),
        backToDoc: onActiveView('backToDoc'),
      },
      exports: (consumer): DocsPageExports => ({
        addView: (sourceId, options) =>
          consumer.track(addView(sourceId, options).handle),
        openDoc: (path, line) => openDoc(path, line ?? null),
      }),
      dispose() {
        const held = [...sessionDocs.values()];
        sessionDocs.clear();
        callEach<() => void>(
          [
            () => window.removeEventListener('resize', onWindowResize),
            () => {
              if (pendingResizeFrame !== null) {
                cancelAnimationFrame(pendingResizeFrame);
              }
            },
            ...held.map((each) => () => disposeSessionDocs(each)),
            () => machineView.dispose(),
          ],
          (step) => step(),
        );
      },
    };
  },
};
