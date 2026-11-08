import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import {
  docsPageKey,
  type DocsViewHandle,
  sessionSourceId,
  UNSAVED_TEXT,
} from '../../docs/contract';
import {
  followRows,
  type SessionRow,
  type SessionTabHandle,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { docsSessionTabManifest } from '../manifest';

type DocsSessionTabApi = PageApi<
  typeof docsSessionTabManifest,
  ChannelShape,
  Record<never, never>
>;

interface SessionDocs {
  view: DocsViewHandle;
  // Null until `addTab` returns.
  tab: SessionTabHandle | null;
}

// The tab goes first, so it never holds a disposed view.
function disposeSessionDocs(held: SessionDocs): void {
  callEach([held.tab, held.view], (part) => part?.dispose());
}

// A Docs tab in every session over that session's index, a docs view `addView`
// builds, rebuilt once shown when the session's host id changes; a close is
// refused while the view holds unsaved edits.
export const docsSessionTabPagePart: PagePart<typeof docsSessionTabManifest> = {
  manifest: docsSessionTabManifest,
  start(api: DocsSessionTabApi) {
    const { services } = api;
    const docs = api.dependency(docsPageKey);
    const sessions = api.dependency(sessionsPageKey);
    const sessionDocs = new Map<string, SessionDocs>();

    const addSessionDocs = ({ sessionId, projectDir }: SessionRow) => {
      const held: SessionDocs = {
        view: docs.addView(sessionSourceId(sessionId), {
          isVisible: () => held.tab?.isVisible() === true,
        }),
        tab: null,
      };
      sessionDocs.set(sessionId, held);
      services.log(
        `Docs tab added for ${projectDir ?? 'a session with no folder'}`,
      );
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

    const removeSessionDocs = (sessionId: string) => {
      const held = sessionDocs.get(sessionId);
      if (held === undefined) {
        return;
      }
      sessionDocs.delete(sessionId);
      disposeSessionDocs(held);
    };

    return {
      commands: {},
      ready() {
        followRows(api.state.read(sessionsRowsSlot), {
          added: addSessionDocs,
          removed: removeSessionDocs,
          // Main replaces a session's index source when its host id changes.
          hostChanged: ({ sessionId }) =>
            sessionDocs.get(sessionId)?.view.sourceReplaced(),
        });
      },
      dispose() {
        const held = [...sessionDocs.values()];
        sessionDocs.clear();
        callEach(held, disposeSessionDocs);
      },
    };
  },
};
