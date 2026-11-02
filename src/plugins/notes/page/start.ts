import './notes.css';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import type { NoteSession, NotesChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { notesManifest } from '../manifest';
import { readNotesLayout } from './layout/read-notes-layout';
import { createNotePopup } from './popup';

type NotesApi = PageApi<
  typeof notesManifest,
  NotesChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// The note popup over any mode, on `Space n n`, drawn with the layout the
// `layout` setting names. It keeps the open session rows that carry a host
// session id, so the popup can attach one; a row with none can be neither
// attached nor named.
export const notesPagePart: PagePart<typeof notesManifest> = {
  manifest: notesManifest,
  start(api: NotesApi) {
    const { services } = api;
    const sessions = api.dependency<SessionsPageExports>('sessions');
    const keys = api.dependency<KeysPageExports>('keys');
    const rows = new Map<string, NoteSession>();

    api.events.on('sessions.sessionAdded', (row) => {
      const { sessionId, harness, hostSessionId, projectDir } = row;
      if (hostSessionId !== null) {
        rows.set(sessionId, { sessionId, harness, hostSessionId, projectDir });
      }
      services.log('notes', `session ${hostSessionId ?? 'none'} listed`);
    });
    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      rows.delete(sessionId);
    });
    api.events.on(
      'sessions.sessionHostChanged',
      ({ sessionId, hostSessionId }) => {
        const row = rows.get(sessionId);
        if (row === undefined) {
          return;
        }
        if (hostSessionId === null) {
          rows.delete(sessionId);
          return;
        }
        rows.set(sessionId, { ...row, hostSessionId });
        services.log(
          'notes',
          `session ${row.hostSessionId} moved to ${hostSessionId}`,
        );
      },
    );

    const popup = createNotePopup({
      channel: api.channel,
      services,
      keys,
      overlay: api.areas.overlay,
      commands: {
        exists: (id) => api.keys.command(id) !== undefined,
        run: (id) => api.commands.run(id),
      },
      platform: api.platform,
      pushScope: (scope) => api.keys.pushScope(scope),
      autosaveDelayMs: () => api.settings().autosaveDelayMs,
      selectedSession: () => {
        const selected = sessions.selectedSessionId();
        return selected === null ? null : (rows.get(selected) ?? null);
      },
      sessionRows: () => [...rows.values()],
    });
    api.layouts.show<Layout>({
      defaultLayout,
      read: readNotesLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => popup.setLayouts(shown),
    });
    return { commands: popup.commands };
  },
};
