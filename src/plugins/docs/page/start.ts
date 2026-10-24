import '../../../shared/page/markdown.css';
import './docs.css';
import type { CommandId } from '../../../contracts/commands';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { kbd } from '../../../shared/page/ui/kbd';
import { sheet } from '../../../shared/page/ui/sheet';
import { createSplit, type Split } from '../../../shared/page/ui/split';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionTabHandle,
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import {
  type DocsChannel,
  type DocsPageExports,
  type DocsViewHandle,
  MACHINE_SOURCE_ID,
  sessionSourceId,
} from '../contract';
import { docsManifest } from '../manifest';
import { type DocChangeRecord, UNSAVED_TEXT } from './docs-state';
import {
  createDocsView,
  type DocsView,
  type DocsViewCommands,
} from './docs-view';
import { commandOfKeysIn } from './hidden-tree-keys';

type DocsApi = PageApi<
  typeof docsManifest,
  DocsChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
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

// An added view's tree width limits in CSS pixels; every added view reads and
// writes the one stored width.
const SESSION_TREE_SPLIT = { initial: 288, min: 160, max: 480 };

// Docs mode over the machine's index, its tree in the side bar and its doc in
// the sheet, and the views `addView` hands out, each its tree and doc side by
// side in a split: a Docs tab in every session over that session's index
// among them. Each command acts on the active view: the machine view while
// Docs mode shows, else the added view that is visible. A change made in one
// view reaches every other, and a view showing closes the others' overlays,
// since two views' pane scopes may be equal. `toggleTree` hides or shows the
// active view's tree. `openDoc` opens a doc in Docs mode.
export const docsPagePart: PagePart<typeof docsManifest> = {
  manifest: docsManifest,
  start(api: DocsApi) {
    const { services } = api;
    const { log } = services;
    const sessions = api.dependency<SessionsPageExports>('sessions');
    const keys = api.dependency<KeysPageExports>('keys');
    // A page reload leaves main's watches for the old page's views.
    api.channel
      .invoke('unwatchAll')
      .catch((error) =>
        log('docs', `watches not cleared: ${errorText(error)}`),
      );

    let isDocsModeShown = false;
    // View id → the added view.
    const addedViews = new Map<string, AddedView>();
    let addedCount = 0;
    const sessionDocs = new Map<string, SessionDocs>();

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

    // `changed` reads the view only once a change is made, after creation.
    const createView = (
      viewId: string,
      sourceId: string,
      isActive: () => boolean,
      openChanged: (path: string | null) => void,
      revealTree: () => void,
      leafOpened: () => void,
    ): DocsView => {
      const view: DocsView = createDocsView({
        viewId,
        sourceId,
        channel: api.channel,
        homeDir: services.homeDir,
        editor: services.editor,
        markdown: services.markdown,
        paths: services.paths,
        toast: services.toast,
        log,
        keysFor: (command, scope) =>
          keys.keysFor(
            qualify(docsManifest.id, command),
            qualify(docsManifest.id, scope),
          ),
        onKeysChanged: (listener) => keys.onChanged(listener),
        kbd: (shown) => kbd(shown, api.platform),
        setScope: (scope) => api.keys.setScope(scope),
        pushScope: (scope) => api.keys.pushScope(scope),
        isActive,
        openChanged,
        revealTree,
        leafOpened,
        addOverlay: (element) => api.areas.overlay.contribute(element),
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
        }
      },
      () => mode.picked(),
    );

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
    // doc, by `treeHiddenIn` and `treeOpenedOverIn`.
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
        machineView.showFirstTime();
      },
      hidden: () => undefined,
      sideBarHidden: () => treeHiddenIn(machineView),
      sideBarOpenedOver: () => treeOpenedOverIn(machineView),
    });
    api.modes.onChanged((modeId) => {
      isDocsModeShown = modeId === 'docs.docs';
    });

    // Hiding moves focus by `treeHiddenIn`, as Docs mode's side bar hiding
    // does. Showing leaves focus where it is, as the side bar showing beside
    // the doc does.
    const setTreeHidden = (added: AddedView, isHidden: boolean) => {
      added.split.setStartHidden(isHidden);
      added.isTreeHidden = isHidden;
      log('docs', isHidden ? 'tree hidden' : 'tree shown');
      if (isHidden) {
        treeHiddenIn(added.view);
      }
    };

    // A docs view over the source `sourceId`, its tree and doc in a split
    // whose width every added view shares; its keys act while `isVisible`.
    const addView = (
      sourceId: string,
      options: { isVisible(): boolean },
    ): DocsViewHandle => {
      addedCount += 1;
      const viewId = `view:${String(addedCount)}`;
      const split = createSplit({
        ...SESSION_TREE_SPLIT,
        uiState: services.uiState,
        stateKey: 'sessionTree',
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
        ),
        split,
        isTreeHidden: false,
        isVisible: () => options.isVisible(),
      };
      split.element.classList.add('docs-split');
      split.start.append(added.view.tree);
      split.end.append(added.view.doc);
      addedViews.set(viewId, added);
      return {
        element: split.element,
        shown() {
          // Another view's drag may have stored a new width since this one
          // last showed.
          split.reloadWidth();
          closeOverlaysBesides(added.view);
          api.keys.setScope(added.view.focusScope());
          log('docs', 'Docs tab shown');
          added.view.showFirstTime();
        },
        hasUnsavedEdits: () => added.view.hasUnsavedEdits(),
        dispose() {
          addedViews.delete(viewId);
          added.view.dispose();
        },
      };
    };

    api.events.on('sessions.sessionAdded', ({ sessionId, projectDir }) => {
      const held: SessionDocs = {
        view: addView(sessionSourceId(sessionId), {
          isVisible: () => held.tab?.isVisible() === true,
        }),
        tab: null,
      };
      sessionDocs.set(sessionId, held);
      log(
        'docs',
        `Docs tab added for ${projectDir ?? 'a session with no folder'}`,
      );
      held.tab = sessions.addTab(sessionId, {
        id: 'docs',
        title: 'Docs',
        element: held.view.element,
        beforeClose() {
          if (held.view.hasUnsavedEdits()) {
            services.toast(UNSAVED_TEXT, 'error');
            return false;
          }
          return true;
        },
        shown: () => held.view.shown(),
      });
    });
    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      const held = sessionDocs.get(sessionId);
      if (held === undefined) {
        return;
      }
      sessionDocs.delete(sessionId);
      held.tab?.remove();
      held.view.dispose();
    });

    const addedViewOf = (view: DocsView): AddedView | undefined =>
      [...addedViews.values()].find((added) => added.view === view);

    const isTreeHiddenIn = (view: DocsView): boolean =>
      view === machineView
        ? !mode.sideBarShown()
        : addedViewOf(view)?.isTreeHidden === true;

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

    // Shows Docs mode, then opens `path` in the machine view by its
    // `openDoc`, which waits for the view's first index read and, when that
    // does not list `path`, for a rebuild coming or running.
    const openDoc = (path: string, line: number | null) => {
      if (!mode.isShown()) {
        mode.show();
      }
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
        'docs',
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
    };

    const toggleTree = () => {
      const view = activeView();
      if (view === null) {
        return;
      }
      if (view === machineView) {
        mode.toggleSideBar();
        return;
      }
      const added = addedViewOf(view);
      if (added !== undefined) {
        setTreeHidden(added, !added.isTreeHidden);
      }
    };

    const exports: DocsPageExports = {
      addView,
      openDoc: (path, line) => openDoc(path, line ?? null),
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
        focusDoc: onActiveView('focusDoc'),
        focusTree: onActiveView('focusTree'),
        scrollDown: onActiveView('scrollDown'),
        scrollUp: onActiveView('scrollUp'),
        halfPageDown: onActiveView('halfPageDown'),
        halfPageUp: onActiveView('halfPageUp'),
        edit: onActiveView('edit'),
        conflictReload: onActiveView('conflictReload'),
        conflictOverwrite: onActiveView('conflictOverwrite'),
        conflictCancel: onActiveView('conflictCancel'),
        pickerDown: onActiveView('pickerDown'),
        pickerUp: onActiveView('pickerUp'),
        pickerChoose: onActiveView('pickerChoose'),
        pickerCancel: onActiveView('pickerCancel'),
        boxComplete: onActiveView('boxComplete'),
        boxAccept: onActiveView('boxAccept'),
        boxCancel: onActiveView('boxCancel'),
        createByKind: onActiveView('createByKind'),
        createByPath: onActiveView('createByPath'),
        rename: onActiveView('rename'),
        trash: onActiveView('trash'),
        confirmYes: onActiveView('confirmYes'),
        confirmNo: onActiveView('confirmNo'),
      },
      exports,
    };
  },
};
