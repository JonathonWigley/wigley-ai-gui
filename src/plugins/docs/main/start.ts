import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type {
  DriveHost,
  MainApi,
  MainChannel,
  MainPart,
  MainServices,
  QualifiedEvents,
} from '../../../contracts/plugin';
import {
  argsObject,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requiredString,
} from '../../../shared/drive-args';
import { errorText } from '../../../shared/error-text';
import type { JsonObject } from '../../../shared/json';
import type {
  ConnectedSession,
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import {
  type DocsChannel,
  type DocsMainEvents,
  type DocsMainExports,
  type IndexEntry,
  type IndexSource,
  MACHINE_SOURCE_ID,
  sessionSourceId,
} from '../contract';
import { EXTERNAL_SCHEME } from '../links';
import { docsManifest } from '../manifest';
import { createDocFiles, type DocFiles } from './doc-files';
import {
  createIndexSourceRegistry,
  createMachineSource,
  createSessionSource,
  type IndexSourceRegistry,
  type IndexSourcesDeps,
  MACHINE_INDEX_FILE,
  MACHINE_SOURCE_TITLE,
  SESSION_SOURCE_TITLE,
} from './index-sources';
import { readPluginStatus } from './plugin-status';
import { writeDocsFixture } from './selftest-fixture';
import {
  connectDocsFixtureSession,
  docsSelfTestScript,
} from './selftest-script';
import { createViewWatches } from './view-watches';

type DocsApi = MainApi<
  typeof docsManifest,
  DocsChannel,
  DocsMainEvents,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// What every handler serves from, once the home folder is read and, under
// the self-test or a drive run, the fixture written into a home that had
// none: the doc files and what an index source runs against.
interface DocsMain {
  indexDeps: IndexSourcesDeps;
  docFiles: DocFiles;
}

// Whether `homeDir` holds the docs fixture: the machine index is the last
// file the fixture writes.
async function hasDocsFixture(
  files: Files,
  homeDir: string,
  paths: Paths,
): Promise<boolean> {
  return (await files.stat(paths.join(homeDir, MACHINE_INDEX_FILE))) !== null;
}

// The index uses real paths, so the home folder every `~` expands to is the
// real one. `scriptPath` is read at each index run, `entries` at each doc
// change. A drive run's restart keeps the home, so the fixture is written
// only into a home without one.
export async function startDocs(
  services: Pick<
    MainServices,
    'files' | 'processes' | 'log' | 'homeDir' | 'runMode' | 'paths'
  >,
  scriptPath: () => string,
  entries: () => readonly IndexEntry[],
): Promise<DocsMain> {
  const { files, processes, log, paths } = services;
  const homeDir = await files.realPath(services.homeDir);
  const needsFixture =
    services.runMode !== 'live' &&
    !(await hasDocsFixture(files, homeDir, paths));
  if (needsFixture) {
    await writeDocsFixture(files, homeDir, paths);
  }
  const indexDeps = { files, processes, homeDir, scriptPath, log, paths };
  const docFiles = createDocFiles({ files, homeDir, log, paths, entries });
  return { indexDeps, docFiles };
}

// Registers, under `id` and `title` now, a source that runs `inner` once it
// is built. `canRebuild` says whether `inner` has a `rebuild`.
function addStartedSource(
  registry: IndexSourceRegistry,
  id: string,
  title: string,
  inner: Promise<IndexSource>,
  canRebuild: boolean,
): Disposable {
  // A failed start is logged where docs starts.
  inner.catch(() => undefined);
  const load = async () => (await inner).load();
  if (!canRebuild) {
    return registry.add({ id, title, load });
  }
  const rebuild = async () => {
    const source = await inner;
    return source.rebuild !== undefined ? source.rebuild() : source.load();
  };
  return registry.add({ id, title, load, rebuild });
}

interface DocsDriveDeps {
  files: Files;
  // `services.homeDir`, the drive run's temp home.
  homeDir: string;
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>;
  // Settles once docs has started, so a seed never races the start's fixture.
  started: Promise<unknown>;
  paths: Paths;
  channel: Pick<MainChannel<DocsChannel>, 'send'>;
}

function indexDelayMsArg(args: JsonObject): number {
  const indexDelayMs = optionalNumber(args, 'indexDelayMs') ?? 0;
  if (indexDelayMs < 0) {
    throw new Error('indexDelayMs must not be negative');
  }
  return indexDelayMs;
}

function lineArg(args: JsonObject): number | null {
  const line = optionalNumber(args, 'line');
  if (line === undefined) {
    return null;
  }
  const isPositiveWhole = Number.isInteger(line) && line >= 1;
  if (!isPositiveWhole) {
    throw new Error('line must be a positive whole number');
  }
  return line;
}

// `docs.seed` rewrites the fixture; `docs.connectSession` rewrites it and
// connects a session in its repo, whose row shows its Docs tab. Each takes
// `loadStates` to add a doc per non-launch index load state and
// `indexDelayMs` to make the stand-in index script wait before answering.
// `docs.openDoc` asks the page to open a doc in Docs mode. Disposing removes
// the actions and ends every session `docs.connectSession` connected.
export function addDriveActions(
  drive: DriveHost,
  deps: DocsDriveDeps,
): Disposable {
  const { files, homeDir, sessions, started, paths, channel } = deps;
  const connected: ConnectedSession[] = [];
  let connects = 0;
  const actions = [
    drive.add('seed', {
      description:
        'Rewrites the docs fixture under the temp home, removing what earlier steps added; loadStates adds one doc per index load state other than launch (on-demand, listed, shadowed, not-loaded) under .claude/load-states; indexDelayMs makes the stand-in docs_index.py wait that many milliseconds before answering, so a docs index run outlasts the Docs tree\'s "Claude pending" chip (default 0). Returns the home\'s real path.',
      args: '{ loadStates?: boolean, indexDelayMs?: number }',
      async run(rawArgs) {
        await started;
        const args = argsObject(rawArgs);
        const loadStates = optionalBoolean(args, 'loadStates') ?? false;
        const indexDelayMs = indexDelayMsArg(args);
        await writeDocsFixture(files, homeDir, paths, {
          loadStates,
          indexDelayMs,
        });
        return { home: await files.realPath(homeDir) };
      },
    }),
    drive.add('connectSession', {
      description:
        'Rewrites the docs fixture and connects a session in its repo, activating the row on its Docs tab; sessionId defaults to drive-docs-<n>; loadStates and indexDelayMs as docs.seed takes them.',
      args: '{ sessionId?: string, loadStates?: boolean, indexDelayMs?: number }',
      async run(rawArgs) {
        await started;
        connects += 1;
        const args = argsObject(rawArgs);
        const sessionId =
          optionalString(args, 'sessionId') ?? `drive-docs-${String(connects)}`;
        const loadStates = optionalBoolean(args, 'loadStates') ?? false;
        const indexDelayMs = indexDelayMsArg(args);
        const session = await connectDocsFixtureSession(
          files,
          homeDir,
          sessions,
          sessionId,
          paths,
          { loadStates, indexDelayMs },
        );
        connected.push(session);
        return { sessionId, rowId: session.session.id };
      },
    }),
    drive.add('openDoc', {
      description:
        'Shows Docs mode and opens the doc at path (line 1-based, a positive whole number), or toasts that the machine index does not list it, waiting first for a rebuild coming or running when its first read does not.',
      args: '{ path: string, line?: number }',
      async run(rawArgs) {
        await started;
        const args = argsObject(rawArgs);
        const path = requiredString(args, 'path');
        const line = lineArg(args);
        channel.send('openDoc', { path, line });
        return {};
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

// Serves the page every registered index source (the machine index and one
// per live session, plus any a plugin adds through `addSource`), the guarded
// doc changes, one watched file per view, external links, and the git
// statuses of the marketplace clones among a source's entries. A source's
// index entries stay writable while it is registered. The page's own index
// reads emit `indexLoaded`; the exports' reads do not.
export const docsMainPart: MainPart<typeof docsManifest> = {
  manifest: docsManifest,
  start(api: DocsApi) {
    const { services, channel } = api;
    const registry = createIndexSourceRegistry();
    const docs = startDocs(
      services,
      () => api.settings().scriptPath,
      () => registry.loadedEntries(),
    );
    docs.catch((error: unknown) =>
      services.log('docs', `docs not started: ${errorText(error)}`),
    );
    addStartedSource(
      registry,
      MACHINE_SOURCE_ID,
      MACHINE_SOURCE_TITLE,
      docs.then(({ indexDeps }) => createMachineSource(indexDeps)),
      true,
    );
    // Keyed by the session row's id.
    const sessionSources = new Map<string, Disposable>();
    api.events.on('sessions.connected', ({ id, info }) => {
      const spec = {
        hostSessionId: info.sessionId,
        projectDir: info.projectDir,
        harness: info.harness,
      };
      const added = addStartedSource(
        registry,
        sessionSourceId(id),
        SESSION_SOURCE_TITLE,
        docs.then(({ indexDeps }) => createSessionSource(indexDeps, id, spec)),
        false,
      );
      sessionSources.set(id, added);
    });
    api.events.on('sessions.ended', ({ sessionId }) => {
      sessionSources.get(sessionId)?.dispose();
      sessionSources.delete(sessionId);
    });
    const watches = createViewWatches(
      async (path, changed) => (await docs).docFiles.watch(path, changed),
      (change) => channel.send('docChanged', change),
    );
    const readDoc = async (path: string) => (await docs).docFiles.read(path);
    const writeDoc = async (
      path: string,
      text: string,
      expectedText: string | null,
    ) => (await docs).docFiles.write(path, text, expectedText);
    channel.handle('loadIndex', async (sourceId) => {
      const read = await registry.load(sourceId);
      api.events.emit('indexLoaded', { sourceId });
      return read;
    });
    channel.handle('rebuildIndex', async (sourceId) => {
      const read = await registry.rebuild(sourceId);
      api.events.emit('indexLoaded', { sourceId });
      return read;
    });
    channel.handle('readDoc', readDoc);
    channel.handle('writeDoc', writeDoc);
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
    channel.handle('pluginStatus', async (sourceId, fetch) =>
      readPluginStatus(
        registry.sourceEntries(sourceId),
        {
          processes: services.processes,
          files: services.files,
          paths: services.paths,
          log: services.log,
        },
        { fetch },
      ),
    );
    const sessions = api.dependency<SessionsMainExports>('sessions');
    services.selfTest?.run(
      docsSelfTestScript({
        files: services.files,
        homeDir: services.homeDir,
        sessions,
        paths: services.paths,
      }),
    );
    const driveActions =
      api.drive !== null
        ? addDriveActions(api.drive, {
            files: services.files,
            homeDir: services.homeDir,
            sessions,
            started: docs,
            paths: services.paths,
            channel,
          })
        : null;
    const exports: DocsMainExports = {
      addSource: (source) => registry.add(source),
      machineIndex: () => registry.load(MACHINE_SOURCE_ID),
      rebuildMachineIndex: () => registry.rebuild(MACHINE_SOURCE_ID),
      readDoc,
      writeDoc,
      watchDoc: async (path, changed) => {
        const watch = await (await docs).docFiles.watch(path, changed);
        return { dispose: () => watch.close() };
      },
    };
    return {
      commands: {},
      exports,
      dispose: () => {
        watches.closeAll();
        driveActions?.dispose();
        for (const source of sessionSources.values()) {
          source.dispose();
        }
        sessionSources.clear();
      },
    };
  },
};
