import type { MainApi, MainPart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { BacklogMainExports } from '../../backlog/contract';
import type { ChatMainExports } from '../../chat/contract';
import type { NotesChannel } from '../contract';
import { notesManifest } from '../manifest';
import { createDraftStore } from './draft-store';
import { noteHomes } from './note-homes';
import { createNoteSender } from './note-sender';

type NotesApi = MainApi<typeof notesManifest, NotesChannel>;

// Keeps the note draft in notes' data folder and serves it to the page, with
// the window capture, Backlog's homes and tags, and the two sends: a
// follow-up through Backlog and a new session through chat.
export const notesMainPart: MainPart<typeof notesManifest> = {
  manifest: notesManifest,
  start(api: NotesApi) {
    const { services, channel } = api;
    const backlog = api.dependency<BacklogMainExports>('backlog');
    const homeDir = services.files
      .realPath(services.homeDir)
      .catch((error: unknown) => {
        services.log(
          'notes',
          `home folder not resolved; using ${services.homeDir}: ${errorText(error)}`,
        );
        return services.homeDir;
      });
    const store = createDraftStore(api.data, services.log);
    const sender = createNoteSender({
      store,
      backlog,
      chat: api.dependency<ChatMainExports>('chat'),
      launchBrief: () => api.settings().launchBrief,
      paths: services.paths,
      homeDir,
      log: services.log,
    });
    channel.handle('loadDraft', () => store.draft());
    channel.handle('saveDraft', (fields) => store.saveFields(fields));
    channel.handle('image', (id) => store.image(id));
    channel.handle('addImage', (png) => store.addImage(png));
    channel.handle('removeImage', (id) => store.removeImage(id));
    channel.handle('markup', (id) => store.markup(id));
    channel.handle('saveMarkup', (id, json) => store.saveMarkup(id, json));
    channel.handle('discard', () => store.clear());
    channel.handle('capture', async () =>
      store.addImage(await services.window.capture()),
    );
    channel.handle('homes', async () =>
      noteHomes(await backlog.load(), services.paths),
    );
    channel.handle('tags', () => backlog.tags());
    channel.handle('sendToFollowup', (request, flattened) =>
      sender.toFollowup(request, flattened),
    );
    channel.handle('sendToSession', (projectDir, flattened) =>
      sender.toSession(projectDir, flattened),
    );
    return { commands: {} };
  },
};
