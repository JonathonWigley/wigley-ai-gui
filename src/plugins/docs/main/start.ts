import type { FileWatch } from '../../../contracts/files';
import type {
  MainApi,
  MainPart,
  MainServices,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { SessionsMainExports } from '../../sessions/contract';
import type { DocChange, DocsChannel } from '../contract';
import { EXTERNAL_SCHEME } from '../links';
import { docsManifest } from '../manifest';
import { createDocFiles, type DocFiles } from './doc-files';
import { createIndexSources, type IndexSources } from './index-sources';
import { writeDocsFixture } from './selftest-fixture';
import { docsSelfTestScript } from './selftest-script';

type DocsApi = MainApi<typeof docsManifest, DocsChannel>;

// What every handler serves from, once the home folder is read and, under
// the self-test, the fixture written.
interface DocsMain {
  homeDir: string;
  sources: IndexSources;
  docFiles: DocFiles;
}

interface ViewWatches {
  // Closes the view's watch, then watches `path` unless it is null; a later
  // call for the view wins over one still starting.
  watch(viewId: string, path: string | null): Promise<void>;
  closeAll(): void;
}

// The index uses real paths, so the home folder every `~` expands to is the
// real one.
async function startDocs(
  services: MainServices,
  scriptPath: string,
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
    entries: () => sources.machineEntries(),
  });
  return { homeDir, sources, docFiles };
}

function createViewWatches(
  watchFile: (path: string, changed: () => void) => Promise<FileWatch>,
  send: (change: DocChange) => void,
): ViewWatches {
  const watches = new Map<string, FileWatch>();
  const latestRequest = new Map<string, number>();
  let requestCount = 0;

  const stop = (viewId: string) => {
    watches.get(viewId)?.close();
    watches.delete(viewId);
  };

  return {
    async watch(viewId, path) {
      const request = ++requestCount;
      latestRequest.set(viewId, request);
      stop(viewId);
      if (path === null) {
        return;
      }
      const watch = await watchFile(path, () => send({ viewId, path }));
      if (latestRequest.get(viewId) !== request) {
        watch.close();
        return;
      }
      watches.set(viewId, watch);
    },
    closeAll() {
      latestRequest.clear();
      for (const watch of watches.values()) {
        watch.close();
      }
      watches.clear();
    },
  };
}

// Serves the page the machine and session indexes, the guarded doc changes,
// one watched file per view, and external links.
export const docsMainPart: MainPart<typeof docsManifest> = {
  manifest: docsManifest,
  start(api: DocsApi) {
    const { services, channel } = api;
    const docs = startDocs(services, api.settings.scriptPath);
    docs.catch((error: unknown) =>
      services.log('docs', `docs not started: ${errorText(error)}`),
    );
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
        throw new Error(
          'Only http, https and mailto links open outside the app',
        );
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
