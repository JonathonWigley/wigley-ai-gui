import '../../../shared/page/dialog.css';
import '../../../shared/page/markdown.css';
import './docs.css';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
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

// Docs mode over the machine's index, and a Docs tab in every session over
// that session's index. Each command acts on the active view: the machine
// view while Docs mode shows, else the session view whose tab is visible. A
// change made in one view reaches every other, and a view showing closes the
// others' overlays, since two views' pane scopes may be equal.
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
    const homeDir = api.channel.invoke('homeDir');
    homeDir.catch((error) =>
      log('docs', `home folder not read: ${errorText(error)}`),
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
    ): DocsView => {
      const view: DocsView = createDocsView({
        viewId,
        source,
        channel: api.channel,
        homeDir,
        editor: services.editor,
        markdown: services.markdown,
        toast: services.toast,
        log,
        keysFor: (command, scope) =>
          keys.keysFor(
            qualify(docsManifest.id, command),
            qualify(docsManifest.id, scope),
          ),
        setScope: (scope) => api.keys.setScope(scope),
        pushScope: (scope) => api.keys.pushScope(scope),
        isActive,
        changed: (change) => changedIn(view, change),
        unsavedPaths: () =>
          allViews()
            .map((each) => each.unsavedPath())
            .filter((path) => path !== null),
      });
      return view;
    };

    const machineView = createView(
      'machine',
      { type: 'machine' },
      () => isDocsModeShown,
    );

    // `add` may call `shown` before it returns, so `shown` reads no handle.
    const mode = api.modes.add({
      id: 'docs',
      title: 'Docs',
      element: machineView.element,
      shown() {
        isDocsModeShown = true;
        closeOverlaysBesides(machineView);
        api.keys.setScope(machineView.focusScope());
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
          ),
          handle: null,
        };
        sessionDocs.set(sessionId, held);
        log(
          'docs',
          `Docs tab added for ${projectDir ?? 'a session with no folder'}`,
        );
        held.handle = sessions.addTab(sessionId, {
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
          shown() {
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

    const onActiveView = (command: keyof DocsViewCommands) => () =>
      activeView()?.commands[command]();

    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
        return;
      }
      log('docs', machineView.toggleTree() ? 'tree shown' : 'tree hidden');
    };

    return {
      commands: {
        showMode,
        treeDown: onActiveView('treeDown'),
        treeUp: onActiveView('treeUp'),
        treeOpen: onActiveView('treeOpen'),
        treeClose: onActiveView('treeClose'),
        filter: onActiveView('filter'),
        rescan: onActiveView('rescan'),
        pickContext: onActiveView('pickContext'),
        focusDoc: onActiveView('focusDoc'),
        focusTree: onActiveView('focusTree'),
        scrollDown: onActiveView('scrollDown'),
        scrollUp: onActiveView('scrollUp'),
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
