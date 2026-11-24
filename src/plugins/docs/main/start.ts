import type { AgentHarnessInfo } from '../../../contracts/agent';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type { DocsContribution } from '../../../contracts/contributions';
import { DEMO_HARNESS_ID } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import { type Files, isMissingFile } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type {
  DriveHost,
  MainApi,
  MainChannel,
  MainPart,
  MainServices,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { agentPluginDir } from '../../../shared/agent-plugin';
import {
  argsObject,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requiredString,
} from '../../../shared/drive-args';
import { errorText } from '../../../shared/error-text';
import {
  FAKE_PROFILES,
  isFakeAgentHarness,
} from '../../../shared/fake-agent-harness';
import type { JsonObject } from '../../../shared/json';
import {
  contributionsMainKey,
  type ContributionsMainExports,
} from '../../contributions/contract';
import {
  type AgentSession,
  followRows,
  type SessionsMainEvents,
  type SessionsMainExports,
  sessionsMainKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  type DocsBinding,
  docsBindingSlot,
  type DocsChannel,
  type DocsMainEvents,
  type DocsMainExports,
  type FeaturesHomes,
  type IndexEntry,
  type IndexSource,
  MACHINE_SOURCE_ID,
  NO_DOCS_BINDING,
  SAMPLE_HOME_FOLDER,
  SAMPLE_SOURCE_ID,
  type SampleDocs,
  sessionSourceId,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { docsManifest } from '../manifest';
import {
  CONTRIBUTIONS_JSON,
  contributionsFileText,
} from './contributions-file';
import { registerDemoSteps } from './demo-steps';
import { docsReader, mergeDocs } from './docs-reader';
import { createDocFiles, type DocFiles } from './doc-files';
import { createHarnessFolders } from '../../../shared/harness-folders';
import {
  createIndexSourceRegistry,
  createMachineSource,
  createSessionSource,
  type IndexSourceRegistry,
  type IndexSourcesDeps,
  MACHINE_INDEX_FILE,
  MACHINE_SOURCE_TITLE,
  NO_INDEX_MESSAGE,
  SESSION_SOURCE_TITLE,
  type SessionSourceSpec,
} from './index-sources';
import { readPluginStatus } from './plugin-status';
import { readRecentChanges } from './recent-changes';
import {
  DOCS_FIXTURE_BINDING,
  docsFixtureInstalls,
  docsFixturePluginDir,
  writeDocsFixture,
} from './selftest-fixture';
import { docsSelfTestScript, openDocsFixtureSession } from './selftest-script';
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

// What `startDocs` reads beyond the services: `scriptPath` at each index run,
// `entries` at each doc change, `infos` (`core.agentHarnesses`) at each guard
// and lookup, `binding` at each guard, create and wiki page lookup, and
// `contributionsFile` before each index run.
export interface StartDocsDeps {
  scriptPath(): string;
  entries(): readonly IndexEntry[];
  infos(): ReadonlyMap<string, AgentHarnessInfo>;
  binding(): DocsBinding;
  contributionsFile(): Promise<string>;
}

// The index uses real paths, so the home folder every `~` expands to is the
// real one. A live run runs the app's agent plugin's `docs_index.py`; every
// other run runs the fixture's stand-in. A drive run's restart keeps the
// home, so the fixture is written only into a home without one; every run
// other than a live one hands each fake harness the fixture's installs for
// each of its profiles, since a restart builds a new fake.
export async function startDocs(
  services: Pick<
    MainServices,
    | 'files'
    | 'processes'
    | 'log'
    | 'homeDir'
    | 'runMode'
    | 'paths'
    | 'agentHarnesses'
    | 'appDir'
  >,
  deps: StartDocsDeps,
): Promise<DocsMain> {
  const { files, processes, log, paths, agentHarnesses } = services;
  const homeDir = await files.realPath(services.homeDir);
  if (services.runMode !== 'live') {
    if (!(await hasDocsFixture(files, homeDir, paths))) {
      await writeDocsFixture(files, homeDir, paths);
    }
    const installs = docsFixtureInstalls(homeDir, paths);
    for (const harness of agentHarnesses.list().filter(isFakeAgentHarness)) {
      for (const profile of FAKE_PROFILES) {
        harness.setInstalledPlugins(profile.configDir, installs);
      }
    }
  }
  const folders = createHarnessFolders({
    harnesses: agentHarnesses,
    infos: deps.infos,
    log,
  });
  const indexDeps: IndexSourcesDeps = {
    files,
    processes,
    homeDir,
    scriptPath: deps.scriptPath,
    pluginDir:
      services.runMode === 'live'
        ? agentPluginDir(services.appDir, paths)
        : docsFixturePluginDir(homeDir, paths),
    contributionsFile: deps.contributionsFile,
    log,
    paths,
  };
  const docFiles = createDocFiles({
    files,
    homeDir,
    log,
    paths,
    folders,
    entries: deps.entries,
    binding: deps.binding,
  });
  return { indexDeps, docFiles };
}

// The binding docs works with and the contributions file that hands it to the
// index. A live run merges the `docs` strategies after `contributions.ready`
// and on each change of them, with Backlog's latest features homes (none
// until Backlog hands them, and while it hands none); every other run keeps
// `DOCS_FIXTURE_BINDING`. The file on disk at launch is read first, then
// written once the first binding is set, and again on each binding whose file
// text differs. Each such later change rebuilds the machine index when its text
// differs from the text the last build used: the launch file's text, which the
// cached index was built from, until an index run asks for the file, then the
// text that run read. A change that comes back to that text, such as Backlog's
// first homes matching the last launch's, rebuilds nothing. `file()` waits for
// every write queued so far, so no index run starts while one is in flight.
interface DocsBindingHolder extends Disposable {
  binding(): DocsBinding;
  setFeaturesHomes(homes: FeaturesHomes | null): void;
  file(): Promise<string>;
}

interface DocsBindingDeps {
  contributions: Pick<
    ContributionsMainExports,
    'strategies' | 'onChanged' | 'ready'
  >;
  isLive: boolean;
  // Reads `CONTRIBUTIONS_JSON` in the data folder; rejects when it is missing.
  readFile(): Promise<string>;
  // Writes the file's text to `CONTRIBUTIONS_JSON` in the data folder.
  writeFile(text: string): Promise<void>;
  filePath: string;
  publish(binding: DocsBinding): void;
  rebuildMachineIndex(): void;
  log(message: string): void;
}

export function createDocsBinding(deps: DocsBindingDeps): DocsBindingHolder {
  const { contributions, isLive, log } = deps;
  // Backlog's latest homes, null for none; `isFeaturesHanded` tells a first
  // handing of none from no handing yet.
  let features: FeaturesHomes | null = null;
  let isFeaturesHanded = false;
  let binding: DocsBinding = isLive
    ? { ...NO_DOCS_BINDING, features }
    : DOCS_FIXTURE_BINDING;
  let isBound = false;
  // The text last queued, the text on disk, and the text the last build used:
  // the launch file's until an index run asks for the file. Null for none, or
  // for a file that could not be read, which no text equals.
  let writtenText: string | null = null;
  let diskText: string | null = null;
  let builtText: string | null = null;
  let fileWrite: Promise<void> = Promise.resolve();
  const launchRead = deps.readFile().then(
    (text) => {
      diskText = text;
      builtText = text;
    },
    (error: unknown) => {
      if (!isMissingFile(error)) {
        log(`contributions file not read: ${errorText(error)}`);
      }
    },
  );

  // True when `next` queued a write: its file text differs from the last.
  const bind = (next: DocsBinding): boolean => {
    binding = next;
    deps.publish(next);
    const text = contributionsFileText(next);
    if (text === writtenText) {
      return false;
    }
    writtenText = text;
    fileWrite = fileWrite
      .then(() => deps.writeFile(text))
      .then(() => {
        diskText = text;
      })
      .catch((error: unknown) => {
        // A failed write leaves the file stale, so the same text is written
        // again at the next binding.
        if (writtenText === text) {
          writtenText = null;
        }
        log(`contributions file not written: ${errorText(error)}`);
      });
    return true;
  };
  const merged = (): DocsBinding =>
    isLive
      ? {
          ...mergeDocs(contributions.strategies<DocsContribution>('docs'), log),
          features,
        }
      : DOCS_FIXTURE_BINDING;
  const rebind = () => {
    if (isBound && bind(merged()) && writtenText !== builtText) {
      deps.rebuildMachineIndex();
    }
  };
  const firstBinding = Promise.all([contributions.ready, launchRead]).then(
    () => {
      bind(merged());
      isBound = true;
    },
  );
  const changes = isLive ? contributions.onChanged('docs', rebind) : null;
  return {
    binding: () => binding,
    setFeaturesHomes(homes) {
      const isSame =
        isFeaturesHanded && JSON.stringify(homes) === JSON.stringify(features);
      if (!isLive || isSame) {
        return;
      }
      isFeaturesHanded = true;
      features = homes;
      rebind();
    },
    async file() {
      await firstBinding;
      await fileWrite;
      builtText = diskText;
      return deps.filePath;
    },
    dispose() {
      changes?.dispose();
    },
  };
}

const SAMPLE_SOURCE_TITLE = 'Sample docs';

const SAMPLE_ONLY_TEXT =
  'While the demo shows sample docs, only the sample docs change.';

// The machine source's read of the docs home `homeDir`, with no `rebuild`, so
// no script runs; null reads as a home with no index.
function sampleLoad(
  deps: IndexSourcesDeps,
  homeDir: string | null,
): IndexSource['load'] {
  if (homeDir === null) {
    return () => Promise.resolve({ document: null, message: NO_INDEX_MESSAGE });
  }
  return createMachineSource({ ...deps, homeDir }).load;
}

// A demo session's index source: the sample home in its project folder.
function createDemoSessionSource(
  deps: IndexSourcesDeps,
  sessionId: string,
  projectDir: string | null,
): IndexSource {
  const homeDir =
    projectDir === null
      ? null
      : deps.paths.join(projectDir, SAMPLE_HOME_FOLDER);
  return {
    id: sessionSourceId(sessionId),
    title: SESSION_SOURCE_TITLE,
    load: sampleLoad(deps, homeDir),
  };
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
  sessions: Pick<SessionsMainExports, 'open' | 'activate'>;
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
// opens a session in its repo, whose row shows its Docs tab with
// `docs-session-tab` on (disabled by default; the self-test starts it). Each
// takes `loadStates` to add a doc per non-launch index load state and
// `indexDelayMs` to make the stand-in index script wait before answering.
// `docs.openDoc` asks the page to open a doc in Docs mode.
export function addDriveActions(drive: DriveHost, deps: DocsDriveDeps): void {
  const { files, homeDir, sessions, started, paths, channel } = deps;
  let opens = 0;
  drive.add('seed', {
    description:
      "Rewrites the docs fixture under the temp home, removing what earlier steps added; loadStates adds one doc per index load state other than launch (on-demand, listed, shadowed, not-loaded) under .claude/load-states; indexDelayMs makes the stand-in docs_index.py wait that many milliseconds before answering, so a docs index run outlasts the Docs tree's pending chips (default 0). Returns the home's real path.",
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
  });
  drive.add('connectSession', {
    description:
      'Rewrites the docs fixture and opens a session in its repo in the background, activating its row on its Docs tab with docs-session-tab on (disabled by default; the self-test starts it); sessionId defaults to drive-docs-<n>, and one another session already holds is refused; loadStates and indexDelayMs as docs.seed takes them.',
    args: '{ sessionId?: string, loadStates?: boolean, indexDelayMs?: number }',
    async run(rawArgs) {
      await started;
      opens += 1;
      const args = argsObject(rawArgs);
      const sessionId =
        optionalString(args, 'sessionId') ?? `drive-docs-${String(opens)}`;
      const loadStates = optionalBoolean(args, 'loadStates') ?? false;
      const indexDelayMs = indexDelayMsArg(args);
      const session = await openDocsFixtureSession(
        files,
        homeDir,
        sessions,
        sessionId,
        paths,
        { loadStates, indexDelayMs },
      );
      return { sessionId, rowId: session.session.id };
    },
  });
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
  });
}

// Serves the page every registered index source (the machine index and one
// per live session, plus any a plugin adds through `addSource`), the guarded
// doc changes, one watched file per view, external links, the git statuses of
// the marketplace clones among a source's entries, and the recent commits
// touching named docs. A source's index entries stay writable while it is
// registered. The page's own index reads emit `indexLoaded`; the exports' reads
// do not. A change that lands emits its event, from the page or an export alike.
// While a demo step holds the sample docs, only changes inside the sample home
// land.
export const docsMainPart: MainPart<typeof docsManifest> = {
  manifest: docsManifest,
  start(api: DocsApi) {
    const { services, channel } = api;
    api.layouts.register({ layoutTypes });
    const registry = createIndexSourceRegistry();
    const harnessInfos = api.state.read(coreAgentHarnessesSlot);
    const contributions = api.dependency(contributionsMainKey);
    const readerRegistration = contributions.registerFeature(
      'docs',
      docsReader,
    );
    const bindingWriter = api.state.publish(docsBindingSlot);
    const binding = createDocsBinding({
      contributions,
      isLive: services.runMode === 'live',
      readFile: () => api.data.read(CONTRIBUTIONS_JSON),
      writeFile: (text) => api.data.write(CONTRIBUTIONS_JSON, text),
      filePath: services.paths.join(api.dataFolder, CONTRIBUTIONS_JSON),
      publish: (next) => bindingWriter.set(next),
      rebuildMachineIndex: () => {
        registry
          .rebuild(MACHINE_SOURCE_ID)
          .catch((error: unknown) =>
            services.log(`machine index not rebuilt: ${errorText(error)}`),
          );
      },
      log: services.log,
    });
    const docs = startDocs(services, {
      scriptPath: () => api.settings().scriptPath,
      entries: () => registry.loadedEntries(),
      infos: () => harnessInfos.all(),
      binding: () => binding.binding(),
      contributionsFile: () => binding.file(),
    });
    docs.catch((error: unknown) =>
      services.log(`docs not started: ${errorText(error)}`),
    );
    addStartedSource(
      registry,
      MACHINE_SOURCE_ID,
      MACHINE_SOURCE_TITLE,
      docs.then(({ indexDeps }) => createMachineSource(indexDeps)),
      true,
    );
    // Keyed by the session row's id. A demo session's source reads the
    // sample home in its folder and runs no script.
    const sessionSources = new Map<string, Disposable>();
    // A session that already has a source keeps it.
    const addSessionSource = (id: string, spec: SessionSourceSpec) => {
      if (sessionSources.has(id)) {
        return;
      }
      const isDemo = spec.harness === DEMO_HARNESS_ID;
      const added = addStartedSource(
        registry,
        sessionSourceId(id),
        SESSION_SOURCE_TITLE,
        docs.then(({ indexDeps }) =>
          isDemo
            ? createDemoSessionSource(indexDeps, id, spec.projectDir)
            : createSessionSource(indexDeps, id, spec),
        ),
        false,
      );
      sessionSources.set(id, added);
    };
    const addConnectedSource = ({ id, info }: AgentSession) =>
      addSessionSource(id, {
        hostSessionId: info.sessionId,
        projectDir: info.projectDir,
        harness: info.harness,
      });
    api.events.on('sessions.connected', addConnectedSource);
    // A start while sessions run hears no `connected` for them, and a session
    // connected with no row can gain one later, so every row, held or added,
    // gets its session's source too: the Docs tab reads it by the row's id.
    followRows(api.state.read(sessionsRowsSlot), {
      added: ({ sessionId, hostSessionId, projectDir, harness }) =>
        addSessionSource(sessionId, { hostSessionId, projectDir, harness }),
    });
    // The new source holds no entries until the session's Docs tab, with
    // `docs-session-tab` on (disabled by default; the self-test starts it),
    // loads it.
    const replaceSessionSource = (session: AgentSession) => {
      const source = sessionSources.get(session.id);
      if (source === undefined) {
        return;
      }
      source.dispose();
      sessionSources.delete(session.id);
      addConnectedSource(session);
    };
    api.events.on('sessions.hostSessionChanged', replaceSessionSource);
    api.events.on('sessions.ended', ({ sessionId }) => {
      sessionSources.get(sessionId)?.dispose();
      sessionSources.delete(sessionId);
    });
    const watches = createViewWatches(
      async (path, changed) => (await docs).docFiles.watch(path, changed),
      (change) => channel.send('docChanged', change),
    );
    // The sample docs a demo step holds, else null.
    let heldSample: { home: string } | null = null;
    // Throws while a sample is held and a target lies outside its home.
    const requireInsideSample = (...targets: string[]) => {
      const held = heldSample;
      if (held === null) {
        return;
      }
      const isOutside = targets.some(
        (target) => !services.paths.isInside(target, held.home),
      );
      if (isOutside) {
        throw new Error(SAMPLE_ONLY_TEXT);
      }
    };
    const addSampleDocs = async (scratchDir: string): Promise<SampleDocs> => {
      const { indexDeps } = await docs;
      const { files, paths } = services;
      const home = paths.join(
        await files.realPath(scratchDir),
        SAMPLE_HOME_FOLDER,
      );
      await files.makeFolder(home);
      if (!(await hasDocsFixture(files, home, paths))) {
        await writeDocsFixture(files, home, paths);
      }
      const source = registry.add({
        id: SAMPLE_SOURCE_ID,
        title: SAMPLE_SOURCE_TITLE,
        load: sampleLoad(indexDeps, home),
      });
      const held = { home };
      heldSample = held;
      return {
        load: () => registry.load(SAMPLE_SOURCE_ID),
        dispose() {
          source.dispose();
          if (heldSample === held) {
            heldSample = null;
          }
        },
      };
    };
    const readDoc = async (path: string) => (await docs).docFiles.read(path);
    const writeDoc = async (
      path: string,
      text: string,
      expectedText: string | null,
    ) => {
      requireInsideSample(path);
      const result = await (
        await docs
      ).docFiles.write(path, text, expectedText);
      if (result.type === 'written') {
        api.events.emit('docSaved', { path });
      }
      return result;
    };
    const writeBytes = async (path: string, bytes: Uint8Array) => {
      requireInsideSample(path);
      const result = await (await docs).docFiles.writeBytes(path, bytes);
      api.events.emit('docSaved', { path });
      return result;
    };
    const trashDoc = async (path: string) => {
      requireInsideSample(path);
      const result = await (await docs).docFiles.trash(path);
      if (result.trashed.length > 0) {
        api.events.emit('docTrashed', { path, trashed: result.trashed });
      }
      return result;
    };
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
    channel.handle('readDocIfPresent', async (path) =>
      (await docs).docFiles.readIfPresent(path),
    );
    channel.handle('wikiMainPath', async () =>
      (await docs).docFiles.wikiMainPath(),
    );
    channel.handle('writeDoc', writeDoc);
    channel.handle('writeBytes', writeBytes);
    channel.handle('createDoc', async (request) => {
      requireInsideSample(
        request.type === 'path' ? request.path : request.place.folder,
      );
      const created = await (await docs).docFiles.create(request);
      api.events.emit('docCreated', { path: created.path });
      return created;
    });
    channel.handle('renameDoc', async (from, to) => {
      requireInsideSample(from, to);
      const renamed = await (await docs).docFiles.rename(from, to);
      api.events.emit('docRenamed', { from, to: renamed });
      return renamed;
    });
    channel.handle('trashTargets', async (path) =>
      (await docs).docFiles.trashTargets(path),
    );
    channel.handle('trashDoc', trashDoc);
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
    channel.handle('pluginConfigFile', async (key, harness) =>
      (await docs).docFiles.pluginConfigFile(key, harness),
    );
    channel.handle('pluginStatus', async (sourceId, fetch) =>
      readPluginStatus(
        registry.sourceEntries(sourceId),
        {
          git: services.git,
          files: services.files,
          paths: services.paths,
          log: services.log,
        },
        { fetch, harnesses: [...harnessInfos.all().keys()] },
      ),
    );
    channel.handle('recentChanges', async (paths) =>
      readRecentChanges(paths, api.settings().recentChangesLimit, {
        git: services.git,
        files: services.files,
        paths: services.paths,
        log: services.log,
      }),
    );
    registerDemoSteps(services, { addSampleDocs });
    const sessions = api.dependency(sessionsMainKey);
    services.selfTest?.run(
      docsSelfTestScript({
        files: services.files,
        homeDir: services.homeDir,
        sessions,
        paths: services.paths,
      }),
    );
    if (api.drive !== null) {
      addDriveActions(api.drive, {
        files: services.files,
        homeDir: services.homeDir,
        sessions,
        started: docs,
        paths: services.paths,
        channel,
      });
    }
    return {
      commands: {},
      dispose() {
        binding.dispose();
        readerRegistration.dispose();
      },
      exports: (consumer): DocsMainExports => ({
        addSource: (source) => consumer.track(registry.add(source)),
        addSampleDocs: async (scratchDir) =>
          consumer.track(await addSampleDocs(scratchDir)),
        machineIndex: () => registry.load(MACHINE_SOURCE_ID),
        rebuildMachineIndex: () => registry.rebuild(MACHINE_SOURCE_ID),
        readDoc,
        writeDoc,
        writeBytes,
        trashDoc,
        watchDoc: async (path, changed) =>
          consumer.track(await (await docs).docFiles.watch(path, changed)),
        setFeaturesHomes: (homes) => binding.setFeaturesHomes(homes),
      }),
    };
  },
};
