import type {
  MainApi,
  MainPart,
  MainServices,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type {
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import type { DocsChannel, SessionSourceSpec } from '../contract';
import { EXTERNAL_SCHEME } from '../links';
import { docsManifest } from '../manifest';
import { createDocFiles, type DocFiles } from './doc-files';
import { createIndexSources, type IndexSources } from './index-sources';
import { writeDocsFixture } from './selftest-fixture';
import { docsSelfTestScript } from './selftest-script';
import { createViewWatches } from './view-watches';

type DocsApi = MainApi<
  typeof docsManifest,
  DocsChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// What every handler serves from, once the home folder is read and, under
// the self-test, the fixture written.
interface DocsMain {
  homeDir: string;
  sources: IndexSources;
  docFiles: DocFiles;
}

// The index uses real paths, so the home folder every `~` expands to is the
// real one. `scriptPath` is read at each index run.
async function startDocs(
  services: MainServices,
  scriptPath: () => string,
): Promise<DocsMain> {
  const { files, processes, log } = services;
  const homeDir = await files.realPath(services.homeDir);
  if (services.selfTest !== null) {
    await writeDocsFixture(files, homeDir);
  }
  const sources = createIndexSources({
    files,
    processes,
    homeDir,
    scriptPath,
    log,
  });
  const docFiles = createDocFiles({
    files,
    homeDir,
    log,
    entries: () => sources.loadedEntries(),
  });
  return { homeDir, sources, docFiles };
}

// Serves the page the machine and session indexes, the guarded doc changes,
// one watched file per view, and external links. A session's index entries
// stay writable until the session ends.
export const docsMainPart: MainPart<typeof docsManifest> = {
  manifest: docsManifest,
  start(api: DocsApi) {
    const { services, channel } = api;
    const docs = startDocs(services, () => api.settings().scriptPath);
    docs.catch((error: unknown) =>
      services.log('docs', `docs not started: ${errorText(error)}`),
    );
    const liveSessions = new Map<string, SessionSourceSpec>();
    api.events.on('sessions.connected', ({ id, info }) => {
      liveSessions.set(id, {
        hostSessionId: info.sessionId,
        projectDir: info.projectDir,
        harness: info.harness,
      });
    });
    // A failed start is logged above.
    api.events.on('sessions.ended', ({ sessionId }) => {
      liveSessions.delete(sessionId);
      docs.then(
        ({ sources }) => sources.retainSessions([...liveSessions.values()]),
        () => undefined,
      );
    });
    const watches = createViewWatches(
      async (path, changed) => (await docs).docFiles.watch(path, changed),
      (change) => channel.send('docChanged', change),
    );
    channel.handle('homeDir', async () => (await docs).homeDir);
    channel.handle('machineIndex', async () =>
      (await docs).sources.machineIndex(),
    );
    channel.handle('rebuild', async () => (await docs).sources.rebuild());
    channel.handle('sessionIndex', async (spec) =>
      (await docs).sources.sessionIndex(spec),
    );
    channel.handle('readDoc', async (path) => (await docs).docFiles.read(path));
    channel.handle('writeDoc', async (path, text, expectedText) =>
      (await docs).docFiles.write(path, text, expectedText),
    );
    channel.handle('createDoc', async (request) =>
      (await docs).docFiles.create(request),
    );
    channel.handle('renameDoc', async (from, to) =>
      (await docs).docFiles.rename(from, to),
    );
    channel.handle('trashTargets', async (path) =>
      (await docs).docFiles.trashTargets(path),
    );
    channel.handle('trashDoc', async (path) =>
      (await docs).docFiles.trash(path),
    );
    channel.handle('listFolder', async (folder) =>
      (await docs).docFiles.list(folder),
    );
    channel.handle('watchDoc', async (viewId, path) => {
      await docs;
      await watches.watch(viewId, path);
    });
    channel.handle('unwatchAll', async () => {
      await docs;
      watches.closeAll();
    });
    channel.handle('openExternal', async (url) => {
      await docs;
      if (!EXTERNAL_SCHEME.test(url)) {
        throw new Error('Only http and https links open outside the app');
      }
      await services.openExternal(url);
    });
    channel.handle('pluginConfigFile', async (key, harness) =>
      (await docs).docFiles.pluginConfigFile(key, harness),
    );
    services.selfTest?.run(
      docsSelfTestScript({
        files: services.files,
        homeDir: services.homeDir,
        sessions: api.dependency<SessionsMainExports>('sessions'),
      }),
    );
    return { commands: {}, dispose: () => watches.closeAll() };
  },
};
