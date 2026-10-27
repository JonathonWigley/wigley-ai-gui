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
import { notesManifest } from '../manifest';
import { createNotePopup } from './popup';

type NotesApi = PageApi<
  typeof notesManifest,
  NotesChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// The note popup over any mode, on `Space n n`. It keeps the open session
// rows that carry a host session id, so the popup can attach one; a row with
// none can be neither attached nor named.
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

    const commands = createNotePopup({
      channel: api.channel,
      services,
      keys,
      overlay: api.areas.overlay,
      run: (command) => api.commands.run(command),
      pushScope: (scope) => api.keys.pushScope(scope),
      autosaveDelayMs: () => api.settings().autosaveDelayMs,
      selectedSession: () => {
        const selected = sessions.selectedSessionId();
        return selected === null ? null : (rows.get(selected) ?? null);
      },
      sessionRows: () => [...rows.values()],
    });
    return { commands };
  },
};
