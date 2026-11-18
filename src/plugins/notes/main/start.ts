import type { MainApi, MainPart } from '../../../contracts/plugin';
import { registeredInfos } from '../../../shared/agent-harness-label';
import { errorText } from '../../../shared/error-text';
import { backlogMainKey } from '../../backlog/contract';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import type { NotesChannel, NotesMainEvents } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { notesManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { addDriveActions } from './drive-actions';
import { createDraftStore } from './draft-store';
import { noteHomes } from './note-homes';
import { createNoteSender } from './note-sender';
import { notesSelfTestScript } from './selftest-script';

type NotesApi = MainApi<typeof notesManifest, NotesChannel, NotesMainEvents>;

// Registers notes' layouts, keeps the note draft in notes' data folder and
// serves it to the page, with the window capture, Backlog's homes and tags,
// and the two sends: a follow-up through Backlog, its images at full size, and
// a new session through chat, each image shrunk under the API's cap. It hands
// the self-test its script, and in a drive run it adds the drive actions. It
// registers the main half of the `notes.note` demo step.
export const notesMainPart: MainPart<typeof notesManifest> = {
  manifest: notesManifest,
  start(api: NotesApi) {
    const { services, channel } = api;
    const backlog = api.dependency(backlogMainKey);
    const homeDir = services.files
      .realPath(services.homeDir)
      .catch((error: unknown) => {
        services.log(
          `home folder not resolved; using ${services.homeDir}: ${errorText(error)}`,
        );
        return services.homeDir;
      });
    const store = createDraftStore(api.data, services.log);
    const sender = createNoteSender({
      store,
      images: services.images,
      backlog,
      chat: api.dependency(chatMainKey),
      launchBrief: () => api.settings().launchBrief,
      paths: services.paths,
      homeDir,
      log: services.log,
      emit: (event, data) => api.events.emit(event, data),
      harnesses: () => registeredInfos(services.agentHarnesses),
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
        sessions: api.dependency(sessionsMainKey),
        harnesses: services.agentHarnesses,
        store,
        nextSessionSend: () =>
          new Promise<void>((resolve) => {
            sessionSendWaiters.push(resolve);
          }),
      }),
    );
    if (api.drive !== null) {
      addDriveActions(api.drive, { store, data: api.data });
    }
    api.layouts.register({ layoutTypes });
    registerDemoSteps(services);
    return { commands: {} };
  },
};
