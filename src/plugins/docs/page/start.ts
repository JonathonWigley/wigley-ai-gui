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
import { createSplit } from '../../../shared/page/ui/split';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionTabHandle,
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import type { DocsChannel } from '../contract';
import { docsManifest } from '../manifest';
import { type DocChangeRecord, UNSAVED_TEXT } from './docs-state';
import {
  createDocsView,
  type DocsSource,
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

interface SessionDocs {
  view: DocsView;
  // Null until `addTab` returns.
  handle: SessionTabHandle | null;
}

// The tree commands that need the tree in sight. While Docs mode's side bar
// is hidden, each moves focus to the doc pane and runs what its key runs
// there, by the keymap in force.
const TREE_COMMANDS_IN_SIGHT: ReadonlySet<keyof DocsViewCommands> = new Set<
  keyof DocsViewCommands
>([
  'treeDown',
  'treeUp',
  'treeOpen',
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

// A session Docs tab's tree width limits in CSS pixels; every session's tab
// reads and writes the one stored width.
const SESSION_TREE_SPLIT = { initial: 288, min: 160, max: 480 };

// Docs mode over the machine's index, its tree in the side bar and its doc in
// the sheet, and a Docs tab in every session over that session's index, its
// tree and doc side by side in a split. Each command acts on the active view:
// the machine view while Docs mode shows, else the session view whose tab is
// visible. A change made in one view reaches every other, and a view showing
// closes the others' overlays, since two views' pane scopes may be equal.
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
    const sessionDocs = new Map<string, SessionDocs>();

    const allViews = (): DocsView[] => [
      machineView,
      ...[...sessionDocs.values()].map((held) => held.view),
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
      source: DocsSource,
      isActive: () => boolean,
      openChanged: (path: string | null) => void,
      revealTree: () => void,
      leafOpened: () => void,
    ): DocsView => {
      const view: DocsView = createDocsView({
        viewId,
        source,
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
    // side bar's overlay, and focus leaves the hidden tree for the doc.
    const machineView = createView(
      'machine',
      { type: 'machine' },
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
      () => {
        mode.picked();
        if (!mode.sideBarShown()) {
          machineView.treeHidden();
        }
      },
    );

    const docsSheet = sheet();
    docsSheet.classList.add('docs-sheet');
    docsSheet.append(machineView.doc);
    // `add` calls `shown` before it returns only for the first mode added;
    // Sessions mode starts before Docs mode, so `shown` may read `mode`. A
    // mode shown in a narrow window reveals with its side bar hidden.
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
        if (!mode.sideBarShown()) {
          machineView.treeHidden();
        }
        machineView.showFirstTime();
      },
      hidden: () => undefined,
    });
    api.modes.onChanged((modeId) => {
      isDocsModeShown = modeId === 'docs.docs';
    });

    api.events.on(
      'sessions.sessionAdded',
      ({ sessionId, projectDir, harness, hostSessionId }) => {
        const held: SessionDocs = {
          view: createView(
            `session:${sessionId}`,
            { type: 'session', spec: { hostSessionId, projectDir, harness } },
            () => held.handle?.isVisible() === true,
            () => undefined,
            // The split never hides the tree.
            () => undefined,
            () => undefined,
          ),
          handle: null,
        };
        const split = createSplit({
          ...SESSION_TREE_SPLIT,
          uiState: services.uiState,
          stateKey: 'sessionTree',
        });
        split.element.classList.add('docs-split');
        split.start.append(held.view.tree);
        split.end.append(held.view.doc);
        sessionDocs.set(sessionId, held);
        log(
          'docs',
          `Docs tab added for ${projectDir ?? 'a session with no folder'}`,
        );
        held.handle = sessions.addTab(sessionId, {
          id: 'docs',
          title: 'Docs',
          element: split.element,
          beforeClose() {
            if (held.view.hasUnsavedEdits()) {
              services.toast(UNSAVED_TEXT, 'error');
              return false;
            }
            return true;
          },
          shown() {
            // Another tab's drag may have stored a new width since this one
            // last showed.
            split.reloadWidth();
            closeOverlaysBesides(held.view);
            api.keys.setScope(held.view.focusScope());
            log('docs', 'Docs tab shown');
            held.view.showFirstTime();
          },
        });
      },
    );
    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      const held = sessionDocs.get(sessionId);
      if (held === undefined) {
        return;
      }
      sessionDocs.delete(sessionId);
      held.handle?.remove();
      held.view.dispose();
    });

    const activeView = (): DocsView | null => {
      if (isDocsModeShown) {
        return machineView;
      }
      for (const held of sessionDocs.values()) {
        if (held.handle?.isVisible() === true) {
          return held.view;
        }
      }
      return null;
    };

    // On Docs mode with its side bar hidden, by `Space k d` or a narrow
    // window, a tree command moves focus to the doc pane and runs the command
    // its key runs there, so no key moves a selection out of sight and `j`
    // scrolls the doc on its first press. The handler is not told which key
    // fired, so it runs one only when every key of the tree command runs the
    // same command in the doc pane, and never a tree command, which would
    // land here again. The narrowing itself gives the mode no callback, so
    // the check runs on each key.
    const runInDocPane = (command: keyof DocsViewCommands) => {
      const treeScope = api.keys.scope();
      machineView.treeHidden();
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
      const isTreeOutOfSight =
        view === machineView &&
        TREE_COMMANDS_IN_SIGHT.has(command) &&
        !mode.sideBarShown();
      if (isTreeOutOfSight) {
        runInDocPane(command);
        return;
      }
      view?.commands[command]();
    };

    // The core logs the side bar's hiding and showing.
    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
        return;
      }
      mode.toggleSideBar();
      if (!mode.sideBarShown()) {
        machineView.treeHidden();
      }
    };

    return {
      commands: {
        showMode,
        treeDown: onActiveView('treeDown'),
        treeUp: onActiveView('treeUp'),
        treeTop: onActiveView('treeTop'),
        treeBottom: onActiveView('treeBottom'),
        treeOpen: onActiveView('treeOpen'),
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
    };
  },
};
