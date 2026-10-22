import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type {
  DriveHost,
  MainApi,
  MainPart,
  MainServices,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { argsObject, optionalString } from '../../../shared/drive-args';
import { errorText } from '../../../shared/error-text';
import type {
  ConnectedSession,
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import type { DocsChannel, SessionSourceSpec } from '../contract';
import { EXTERNAL_SCHEME } from '../links';
import { docsManifest } from '../manifest';
import { createDocFiles, type DocFiles } from './doc-files';
import { joinPath } from '../doc-paths';
import {
  createIndexSources,
  type IndexSources,
  MACHINE_INDEX_FILE,
} from './index-sources';
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
// the self-test or a drive run, the fixture written into a home that had
// none.
interface DocsMain {
  homeDir: string;
  sources: IndexSources;
  docFiles: DocFiles;
}

// Whether `homeDir` holds the docs fixture: the machine index is the last
// file the fixture writes.
async function hasDocsFixture(files: Files, homeDir: string): Promise<boolean> {
  return (await files.stat(joinPath(homeDir, MACHINE_INDEX_FILE))) !== null;
}

// The index uses real paths, so the home folder every `~` expands to is the
// real one. `scriptPath` is read at each index run. A drive run's restart
// keeps the home, so the fixture is written only into a home without one.
export async function startDocs(
  services: Pick<
    MainServices,
    'files' | 'processes' | 'log' | 'homeDir' | 'runMode'
  >,
  scriptPath: () => string,
): Promise<DocsMain> {
  const { files, processes, log } = services;
  const homeDir = await files.realPath(services.homeDir);
  if (services.runMode !== 'live' && !(await hasDocsFixture(files, homeDir))) {
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
// connects a session in its repo, whose row shows its Docs tab. Disposing
// removes the actions and ends every session `docs.connectSession` connected.
export function addDriveActions(
  drive: DriveHost,
  deps: DocsDriveDeps,
): Disposable {
  const { files, homeDir, sessions, started } = deps;
  const connected: ConnectedSession[] = [];
  let connects = 0;
  const actions = [
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
      async run(rawArgs) {
        await started;
        connects += 1;
        const sessionId =
          optionalString(argsObject(rawArgs), 'sessionId') ??
          `drive-docs-${String(connects)}`;
        const session = await connectDocsFixtureSession(
          files,
          homeDir,
          sessions,
          sessionId,
        );
        connected.push(session);
        return { sessionId, rowId: session.session.id };
      },
    }),
  ];
  return {
    dispose() {
      for (const action of actions) {
        action.dispose();
      }
      for (const session of connected.splice(0)) {
        session.end();
      }
    },
  };
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
    const driveActions =
      api.drive !== null
        ? addDriveActions(api.drive, {
            files: services.files,
            homeDir: services.homeDir,
            sessions,
            started: docs,
          })
        : null;
    return {
      commands: {},
      dispose: () => {
        watches.closeAll();
        driveActions?.dispose();
      },
    };
  },
};
