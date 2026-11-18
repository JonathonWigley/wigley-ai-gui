import '../../../shared/page/markdown.css';
import './docs.css';
import type { CommandId } from '../../../contracts/commands';
import {
  coreAgentHarnessesSlot,
  coreModeSlot,
} from '../../../contracts/core-state';
import type { ResizeTarget } from '../../../contracts/panes';
import type {
  PageApi,
  PagePart,
  ShownLayouts,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { listedHarnesses } from '../../../shared/harness-profiles';
import {
  createBaseKit,
  keyRunner,
  kitCommandsOf,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import {
  type PlaceWrites,
  placeWrites,
  pruneKeys,
} from '../../../shared/page/place-slot';
import { sheet } from '../../../shared/page/ui/sheet';
import type { RollbackDeps } from '../../../shared/page/layout-host/draw-part';
import { createSplit, type Split } from '../../../shared/page/ui/split';
import { qualify } from '../../../shared/plugin-manifests';
import { followRows, sessionsRowsSlot } from '../../sessions/contract';
import {
  type DocsChannel,
  type DocsPageEvents,
  type DocsPageExports,
  type DocsPlace,
  docsPlaceSlot,
  type DocsViewHandle,
  MACHINE_SOURCE_ID,
  sessionIdOfSource,
  sessionSourceId,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { docsManifest } from '../manifest';
import { type DocsSampleView, registerDemoSteps } from './demo-steps';
import type { DocChangeRecord } from './docs-state';
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

type DocsApi = PageApi<typeof docsManifest, DocsChannel, DocsPageEvents>;

// A view `addView` handed out.
interface AddedView {
  view: DocsView;
  // The source the view shows, as `addView` was handed it.
  sourceId: string;
  split: Split;
  // Per view and never stored: each view starts with the tree shown.
  isTreeHidden: boolean;
  isVisible(): boolean;
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

// The machine view's id; each view `addView` hands out is `view:<n>`.
const machineViewId = 'machine';

// The id of the view `showSample` builds.
const SAMPLE_VIEW_ID = 'sample';

// Docs mode over the machine's index, its tree in the side bar and its doc in
// the sheet, and the views `addView` hands out, each its tree and doc side by
// side in a split: the `docs-session-tab` plugin's Docs tab in each session
// among them. A demo step's sample view (`showSample`) takes the machine
// view's place in Docs mode while it is held. Each command acts on the active
// view: the view Docs mode shows while it shows, else the added view that is
// visible. A change made in one
// view reaches every other and the star set every view shares, and a view
// showing closes the others' overlays, since two views' pane scopes may be
// equal. `toggleTree` hides or shows the active view's tree. `openDoc` opens a
// doc in Docs mode, and `openMain` the Main page there, from any docs view.
// Each view's place goes to `docs.place` under its source id on each change,
// and a page load puts the last page's back as the view is made; a session
// source's place leaves with its session's row.
// A view's unsaved edits refuse a switch-off, naming the file and the view.
export const docsPagePart: PagePart<typeof docsManifest> = {
  manifest: docsManifest,
  start(api: DocsApi) {
    const { services } = api;
    const { log } = services;
    const rows = api.state.read(sessionsRowsSlot);
    const harnesses = api.state.read(coreAgentHarnessesSlot);
    const placeWriter = api.state.publish(docsPlaceSlot);
    // A session source whose row ended while no page ran leaves a place no
    // view takes; the prune waits for the restore window to settle, so the
    // rows chat's restore reopens are in the page mirror first.
    api.restores.onSettled(() =>
      pruneKeys(placeWriter, (sourceId) => {
        const sessionId = sessionIdOfSource(sourceId);
        return sessionId === null || rows.all().has(sessionId);
      }),
    );
    // A page reload leaves main's watches for the old page's views.
    api.channel
      .invoke('unwatchAll')
      .catch((error) => log(`watches not cleared: ${errorText(error)}`));

    let isDocsModeShown = false;
    // The sample view a demo step shows in Docs mode in place of the machine
    // view, else null; `didHideSideBar` is whether its show hid the side bar.
    let heldSample: { added: AddedView; didHideSideBar: boolean } | null = null;
    // View id → the added view.
    const addedViews = new Map<string, AddedView>();
    let addedCount = 0;
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
      commands: kitCommandsOf(api),
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
    // The view's place goes through `place` under `sourceId`, and the last
    // page's place there is put back.
    const createView = (
      viewId: string,
      sourceId: string,
      place: PlaceWrites<DocsPlace>,
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
        harnesses: () => listedHarnesses(harnesses.all()),
        projectConfigFolders: () => [
          ...new Set(
            [...harnesses.all().values()].map(
              (info) => info.projectConfigFolder,
            ),
          ),
        ],
        toast: services.toast,
        openExternal: services.openExternal,
        runKey: keyRunner(api.commands, log),
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
        trackRestore: (restore) => api.restores.track(restore),
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
        placeChanged: (value) => place.write(value),
      });
      const savedPlace = placeWriter.get(sourceId);
      if (savedPlace !== undefined) {
        view.restorePlace(savedPlace);
      }
      return view;
    };

    // The writes of the place of the view over `sourceId`.
    const placeOf = (sourceId: string): PlaceWrites<DocsPlace> =>
      placeWrites((value) => placeWriter.set(sourceId, value));

    // The title bar shows the machine view's open doc while Docs mode shows.
    // `openChanged`, `revealTree` and `leafOpened` read `mode` once a doc
    // opens or a key runs, after `add`. A doc opened from the tree closes the
    // side bar's overlay.
    const machineView = createView(
      machineViewId,
      MACHINE_SOURCE_ID,
      placeOf(MACHINE_SOURCE_ID),
      () => isDocsModeShown && heldSample === null,
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

    // The view Docs mode shows: a held sample view, else the machine view.
    const modeView = (): DocsView => heldSample?.added.view ?? machineView;

    // What `shown` gives the machine view.
    const showMachineView = () => {
      closeOverlaysBesides(machineView);
      api.keys.setScope(machineView.focusScope());
      api.panes.setResizeTarget(null);
      api.panes.setFocusTarget(machineView.focusTarget);
      machineView.focusHeldAside();
      machineView.showFirstTime();
      showTreeEdge(machineView);
    };

    // What `shown` gives a held sample view: the side bar hidden first, so
    // the sample alone shows, then its keys and first index read.
    const showSampleView = (held: NonNullable<typeof heldSample>) => {
      if (mode.sideBarShown()) {
        mode.toggleSideBar();
        held.didHideSideBar = true;
      }
      const { view, split } = held.added;
      split.reloadWidth();
      closeOverlaysBesides(view);
      api.keys.setScope(view.focusScope());
      api.panes.setResizeTarget(split);
      api.panes.setFocusTarget(view.focusTarget);
      view.focusHeldAside();
      view.showFirstTime();
    };

    // `add` calls `shown` before it returns only for the first mode added;
    // Sessions mode starts before Docs mode. Focus leaves the tree for the
    // doc as the side bar hides, and moves to the tree as it opens over the
    // doc, by `treeHiddenIn` and `treeOpenedOverIn`. The core's Alt+h past the
    // doc enters the tree as the side bar, and its way back closes a narrow
    // window's side bar overlay, as a pick does, and returns to main's last
    // pane. A shown view's scope coming back as the right column's focuses the
    // column (`focusHeldAside`). While a sample view is held, `shown`,
    // `focusSideBar` and `focusMain` act on it instead of the machine view.
    const mode = api.modes.add({
      id: 'docs',
      title: 'Docs',
      icon: 'book',
      element: docsSheet,
      sideBar: machineView.tree,
      shown() {
        isDocsModeShown = true;
        if (heldSample === null) {
          showMachineView();
        } else {
          showSampleView(heldSample);
        }
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
      focusSideBar: () => modeView().focusTree(),
      focusMain: () => {
        mode.picked();
        modeView().focusMain();
      },
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

    // A docs view `viewId` over the source `sourceId`, its tree and doc in a
    // split whose width every added view shares, its place written through
    // `place`, filed in `addedViews`; its keys act while `isVisible`.
    const createAddedView = (
      viewId: string,
      sourceId: string,
      place: PlaceWrites<DocsPlace>,
      isVisible: () => boolean,
    ): AddedView => {
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
          place,
          isVisible,
          () => undefined,
          () => {
            if (added.isTreeHidden) {
              setTreeHidden(added, false);
            }
          },
          () => undefined,
          split,
        ),
        sourceId,
        split,
        isTreeHidden: false,
        isVisible,
      };
      split.element.classList.add('docs-split');
      split.start.append(added.view.tree);
      split.end.append(added.view.doc);
      addedViews.set(viewId, added);
      return added;
    };

    const disposeAddedView = (viewId: string, added: AddedView) => {
      addedViews.delete(viewId);
      callEach([added.view, added.split], (part) => part.dispose());
    };

    // A docs view over the source `sourceId`, as `createAddedView` builds
    // it, and its handle.
    const addView = (
      sourceId: string,
      options: { isVisible(): boolean },
    ): DocsViewHandle => {
      addedCount += 1;
      const viewId = `view:${String(addedCount)}`;
      const added = createAddedView(viewId, sourceId, placeOf(sourceId), () =>
        options.isVisible(),
      );
      const { split } = added;
      return {
        element: split.element,
        shown() {
          // Another view's drag may have stored a new width since this one
          // last showed.
          split.reloadWidth();
          closeOverlaysBesides(added.view);
          api.keys.setScope(added.view.focusScope());
          api.panes.setResizeTarget(split);
          api.panes.setFocusTarget(added.view.focusTarget);
          added.view.focusHeldAside();
          log('Docs tab shown');
          added.view.showFirstTime();
        },
        hasUnsavedEdits: () => added.view.hasUnsavedEdits(),
        sourceReplaced: () => added.view.sourceReplaced(),
        dispose: () => disposeAddedView(viewId, added),
      };
    };

    // A demo step's view over the source `sourceId`, built as `addView`
    // builds one but with its place written nowhere, shown in Docs mode's
    // sheet in place of the machine view's doc until the dispose. Docs mode
    // reads no machine index while it is held, and its side bar comes back at
    // the dispose when the sample's show hid it.
    const showSample = (sourceId: string): DocsSampleView => {
      if (heldSample !== null) {
        throw new Error('Docs mode already shows a sample');
      }
      const added = createAddedView(
        SAMPLE_VIEW_ID,
        sourceId,
        { write: () => undefined, reset: () => undefined },
        () => isDocsModeShown,
      );
      const held = { added, didHideSideBar: false };
      heldSample = held;
      machineView.doc.replaceWith(added.split.element);
      if (mode.isShown()) {
        showSampleView(held);
      }
      return {
        openDoc: (path, line) => added.view.openDoc(path, line),
        dispose() {
          if (heldSample !== held) {
            return;
          }
          heldSample = null;
          added.split.element.replaceWith(machineView.doc);
          disposeAddedView(SAMPLE_VIEW_ID, added);
          if (held.didHideSideBar && !mode.sideBarShown()) {
            mode.toggleSideBar();
          }
          if (mode.isShown()) {
            showMachineView();
          }
        },
      };
    };

    const addedViewOf = (view: DocsView): AddedView | undefined =>
      [...addedViews.values()].find((added) => added.view === view);

    // Where the user finds `view`, as a refusal names it: Docs mode, a
    // session's Docs tab by the row's label, or any other added view.
    const placeNameOf = (view: DocsView): string => {
      if (view === machineView) {
        return 'Docs mode';
      }
      const sourceId = addedViewOf(view)?.sourceId;
      const sessionId =
        sourceId === undefined ? null : sessionIdOfSource(sourceId);
      return sessionId === null
        ? 'a Docs view'
        : `${rows.get(sessionId)?.label ?? sessionId}'s Docs tab`;
    };

    // The refusal for the first view, in `allViews` order, holding unsaved
    // edits, or null when none does.
    const mayStop = (): string | null => {
      for (const view of allViews()) {
        const path = view.unsavedPath();
        if (path !== null) {
          return `Save or discard the edits to ${services.paths.base(path)} in ${placeNameOf(view)} first`;
        }
      }
      return null;
    };

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
        return modeView();
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

    registerDemoSteps(services, {
      showSample,
      commands: api.commands,
      paths: services.paths,
    });

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

    // The view a click's command names, which acts whether or not it is the
    // active one; null, logged, for a view that is gone.
    const viewNamed = (viewId: string, short: string): DocsView | null => {
      const view =
        viewId === machineViewId ? machineView : addedViews.get(viewId)?.view;
      if (view === undefined) {
        log(`${short} for unknown view ${viewId} ignored`);
        return null;
      }
      return view;
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
        scrollTop: onActiveView('scrollTop'),
        scrollEnd: onActiveView('scrollEnd'),
        edit: onActiveView('edit'),
        editSection: onActiveView('editSection'),
        editSectionAt: ({ arg }) =>
          viewNamed(arg.viewId, 'editSectionAt')?.editSectionAt(arg.anchor),
        switchTreeView: ({ arg }) =>
          viewNamed(arg.viewId, 'switchTreeView')?.switchTreeView(),
        openNode: ({ arg }) =>
          viewNamed(arg.viewId, 'openNode')?.openNode(arg.nodeId),
        followLink: ({ arg: { viewId, ...link } }) =>
          viewNamed(viewId, 'followLink')?.followLink(link),
        openDocAt: ({ arg: { viewId, ...at } }) =>
          viewNamed(viewId, 'openDocAt')?.openDocAt(at),
        openRecentPage: ({ arg }) =>
          viewNamed(arg.viewId, 'openRecentPage')?.openRecentPage(arg.path),
        openListRow: ({ arg }) =>
          viewNamed(arg.viewId, 'openListRow')?.openListRow(arg.entryId),
        createMain: ({ arg }) =>
          viewNamed(arg.viewId, 'createMain')?.createMain(),
        answerConfirm: ({ arg }) =>
          viewNamed(arg.viewId, 'answerConfirm')?.answerConfirm(arg.answer),
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
          consumer.track(addView(sourceId, options)),
        openDoc: (path, line) => openDoc(path, line ?? null),
      }),
      mayStop,
      ready() {
        // A session source's place leaves with its row.
        followRows(rows, {
          removed: (sessionId) =>
            placeWriter.delete(sessionSourceId(sessionId)),
        });
      },
      dispose() {
        callEach<() => void>(
          [
            () => window.removeEventListener('resize', onWindowResize),
            () => {
              if (pendingResizeFrame !== null) {
                cancelAnimationFrame(pendingResizeFrame);
              }
            },
            () => machineView.dispose(),
          ],
          (step) => step(),
        );
      },
    };
  },
};
