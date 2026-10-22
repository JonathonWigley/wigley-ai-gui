import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type {
  DriveHost,
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
import {
  connectDocsFixtureSession,
  docsSelfTestScript,
} from './selftest-script';
import { createViewWatches } from './view-watches';

type DocsApi = MainApi<
  typeof docsManifest,
  DocsChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// What every handler serves from, once the home folder is read and, under
// the self-test or a drive run, the fixture written.
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
  if (services.runMode !== 'live') {
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

interface DocsDriveDeps {
  files: Files;
  // `services.homeDir`, the drive run's temp home.
  homeDir: string;
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>;
  // Settles once docs has started, so a seed never races the start's fixture.
  started: Promise<unknown>;
}

// `docs.seed` rewrites the fixture; `docs.connectSession` rewrites it and
// connects a session in its repo, whose row shows its Docs tab.
function addDriveActions(drive: DriveHost, deps: DocsDriveDeps): Disposable[] {
  const { files, homeDir, sessions, started } = deps;
  let connects = 0;
  return [
    drive.add('seed', {
      description:
        "Rewrites the docs fixture under the temp home, removing what earlier steps added; returns the home's real path.",
      args: '{}',
      async run() {
        await started;
        await writeDocsFixture(files, homeDir);
        return { home: await files.realPath(homeDir) };
      },
    }),
    drive.add('connectSession', {
      description:
        'Rewrites the docs fixture and connects a session in its repo, activating the row on its Docs tab; sessionId defaults to drive-docs-<n>.',
      args: '{ sessionId?: string }',
      async run(args) {
        await started;
        connects += 1;
        const sessionId =
          readSessionId(args) ?? `drive-docs-${String(connects)}`;
        const connected = await connectDocsFixtureSession(
          files,
          homeDir,
          sessions,
          sessionId,
        );
        return { sessionId, rowId: connected.session.id };
      },
    }),
  ];
}

// The `sessionId` a drive caller passed, or null when it passed none.
function readSessionId(args: unknown): string | null {
  if (typeof args !== 'object' || args === null || !('sessionId' in args)) {
    return null;
  }
  const { sessionId } = args;
  if (typeof sessionId !== 'string') {
    throw new Error(`sessionId must be a string, got ${typeof sessionId}`);
  }
  return sessionId;
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
    const sessions = api.dependency<SessionsMainExports>('sessions');
    services.selfTest?.run(
      docsSelfTestScript({
        files: services.files,
        homeDir: services.homeDir,
        sessions,
      }),
    );
    const driveActions: Disposable[] = [];
    if (api.drive !== null) {
      driveActions.push(
        ...addDriveActions(api.drive, {
          files: services.files,
          homeDir: services.homeDir,
          sessions,
          started: docs,
        }),
      );
    }
    return {
      commands: {},
      dispose: () => {
        watches.closeAll();
        for (const action of driveActions) {
          action.dispose();
        }
      },
    };
  },
};
