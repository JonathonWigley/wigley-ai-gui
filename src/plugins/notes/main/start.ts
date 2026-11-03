import type { MainApi, MainPart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { BacklogMainExports } from '../../backlog/contract';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import type { NotesChannel } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { notesManifest } from '../manifest';
import { addDriveActions } from './drive-actions';
import { createDraftStore } from './draft-store';
import { noteHomes } from './note-homes';
import { createNoteSender } from './note-sender';
import { notesSelfTestScript } from './selftest-script';

type NotesApi = MainApi<typeof notesManifest, NotesChannel>;

// Registers notes' layouts, keeps the note draft in notes' data folder and
// serves it to the page, with the window capture, Backlog's homes and tags,
// and the two sends, each image shrunk under the API's cap: a follow-up
// through Backlog and a new session through chat. It hands the self-test its
// script, and in a drive run it adds the drive actions.
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
      images: services.images,
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
    // Resolved, then emptied, at each send to a new session that is sent.
    const sessionSendWaiters: (() => void)[] = [];
    channel.handle('sendToSession', async (projectDir, flattened) => {
      const result = await sender.toSession(projectDir, flattened);
      if (result.type === 'sent') {
        for (const resolve of sessionSendWaiters.splice(0)) {
          resolve();
        }
      }
      return result;
    });
    services.selfTest?.run(
      notesSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        sessions: api.dependency<SessionsMainExports>('sessions'),
        harnesses: services.agentHarnesses,
        store,
        nextSessionSend: () =>
          new Promise<void>((resolve) => {
            sessionSendWaiters.push(resolve);
          }),
      }),
    );
    const driveActions =
      api.drive !== null
        ? addDriveActions(api.drive, { store, data: api.data })
        : null;
    const layouts = api.layouts.register({ layoutTypes });
    return {
      commands: {},
      dispose: () => {
        layouts.dispose();
        driveActions?.dispose();
      },
    };
  },
};
