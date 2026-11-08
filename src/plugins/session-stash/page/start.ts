import './session-stash.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  editableTitle,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import type { SessionStashChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { sessionStashManifest } from '../manifest';
import { readSessionStashLayout } from './layout/read-session-stash-layout';
import { createSessionStashParts } from './layout/session-stash-parts';
import { createNoteDialog } from './note-dialog';

type SessionStashApi = PageApi<
  typeof sessionStashManifest,
  SessionStashChannel
>;

// `stash` opens the note dialog over the focused pane's session while
// Sessions mode shows, as sessions' close key acts. Its accept hands main the
// session and its note, then closes the session through sessions'
// `closeSession`, so the close asks what any close asks (chat's end-session
// confirm mid-turn) and main writes the stash once the close lands.
export const sessionStashPagePart: PagePart<typeof sessionStashManifest> = {
  manifest: sessionStashManifest,
  start(api: SessionStashApi) {
    const { services } = api;
    const log = services.log;
    const sessions = api.dependency(sessionsPageKey);
    const rows = api.state.read(sessionsRowsSlot);
    const parts = createSessionStashParts({
      markdown: services.markdown,
      keys: api.keys,
      commands: {
        exists: (id) => api.keys.command(id) !== undefined,
        argShape: (id) => api.keys.command(id)?.arg,
        run: (id) => api.commands.run(id),
      },
      platform: api.platform.os,
      state: api.state.forLayouts,
      log,
    });

    // The session's name as its side-bar row shows it.
    const nameOf = (sessionId: string) => {
      const row = rows.get(sessionId);
      if (row === undefined) {
        return sessionId;
      }
      return editableTitle(row.titles) || row.label;
    };

    const noteDialog = createNoteDialog({
      pushScope: () => api.keys.pushScope('note'),
      stash(sessionId, note) {
        log(`stashing ${nameOf(sessionId)}`);
        api.channel
          .invoke('stash', { sessionId, note })
          .then(() => sessions.closeSession(sessionId))
          .catch((error: unknown) =>
            log(`stash not asked: ${errorText(error)}`),
          );
      },
      parts,
    });
    api.areas.overlay.contribute(noteDialog.element);

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readSessionStashLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        parts.setLayouts(shown);
        noteDialog.redraw();
      },
    });

    const stash = () => {
      const sessionId = sessions.shownSessionId();
      if (sessionId === null) {
        log('stash ignored: no session shows');
        return;
      }
      noteDialog.open({ sessionId, name: nameOf(sessionId) });
      log(`stash dialog opened for ${nameOf(sessionId)}`);
    };

    return {
      commands: {
        stash,
        noteAccept: () => noteDialog.accept(),
        noteCancel: () => {
          if (noteDialog.isOpen()) {
            noteDialog.cancel();
            log('stash cancelled');
          }
        },
      },
    };
  },
};
