import type { MainApi, MainPart } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { scopedFiles } from '../../../shared/scoped-files';
import { chatMainKey } from '../../chat/contract';
import { sessionsRowsSlot } from '../../sessions/contract';
import {
  type BackendState,
  type BuildsEvent,
  foldBuilds,
  type SessionLink,
} from '../builds-model';
import {
  type BackendEntry,
  type BackendServices,
  type BuildFile,
  type BuildRecord,
  type BuildRef,
  BUILDS_PER_GAME,
  type BuildsChannel,
  type BuildsMainExports,
  buildsDownloadsSlot,
  buildsSessionsSlot,
  buildsSnapshotSlot,
  type GameEntry,
  type SessionBuilds,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { buildsManifest } from '../manifest';
import { type ParsedBackend, parseBackends } from './backend-config';
import { createBackendRegistry } from './backend-registry';
import {
  endedMessage,
  failingMessage,
  setEndedMessage,
} from './build-messages';
import { createDownloads, type DownloadTarget } from './downloads';
import { selfTestBackendKind } from './fixture-backend';
import { createLinkStore, LINKS_FILE } from './link-store';
import { createBuildsPoller, SLOW_POLL_MS } from './poller';
import {
  createQueueing,
  type QueueingBackend,
  type QueueingResult,
} from './queueing';
import { buildsSelfTestScript } from './selftest-script';
import { registerSessionDemoStep } from './demo-steps';
import {
  createDrains,
  DRAIN_TIMEOUT_MS,
  type TrackedBackend,
  trackCalls,
} from './tracked-backend';

type BuildsApi = MainApi<typeof buildsManifest, BuildsChannel>;

// One backend entry's instance, made by one apply: null with `problem` set when its kind is missing or its `create`
// gave a problem or rejected, and null with no problem while the replaced instance drains or `create` awaits.
interface LiveBackend {
  instance: TrackedBackend | null;
  problem: string | null;
  hasPolled: boolean;
}

// A game's last listed builds, the commit subjects read for their revisions, its last list failure until a good
// list, and whether a list of it succeeded on the backend's current instance.
interface GameRecords {
  builds: BuildRecord[];
  subjects: Record<string, string>;
  failure: string | null;
  hasListed: boolean;
}

// One game's list in a poll: the listed builds, or on a failure the builds held before it, with the failure's text.
interface GameList {
  game: GameEntry;
  builds: BuildRecord[];
  failure: string | null;
}

// A session's message about one event: `line` leads its log line; `sessionId` is null for a set run no session
// queued.
interface EventMessage {
  sessionId: string | null;
  line: string;
  text: string;
}

// By build id, the files on disk of `builds`, each a build of game `game` of backend `backendId`.
type FilesLookup = (
  backendId: string,
  game: GameEntry,
  builds: readonly BuildRecord[],
) => Record<string, BuildFile[]>;

// Starts with an empty snapshot and loads the session links. `ready` waits for the load and chat's restore of its
// rows, then applies the `backends` setting, and applies it again on each settings change and each kind a backend
// plugin adds or removes: an apply that changes the parsed backends or the kinds disposes every instance and creates
// each entry's anew once the calls into every instance replaced over its data folder have settled, those of a start
// before a restart included, logging once while it still waits after `DRAIN_TIMEOUT_MS`; each publishes as its own
// `create` settles. The stop disposes every instance and leaves the wait for its calls to the next start. Polls each
// backend with an instance and games, starts each poll's file checks through `downloads`, folds after each poll,
// apply, store change and file check that changed the files into `builds.snapshot` (each game `listed` once the
// entry's current instance listed it) and `builds.sessions`, and tells each linked session its build's failing job and
// end, and a set's end, with the files on disk once the ended builds' file checks in flight settle, writing the flag
// before the message. Exports `addBackend`; the commands and the channel queue, offer, cancel and launch a set's agent
// through `queueing`, and the channel's `saveLog` and `download` save into the Downloads folder through `downloads`,
// published in `builds.downloads`; a `download` needs no backend instance. Registers the builds layout contract and
// the main half of the Session builds demo step. Each part made holds its own drains, kept across its starts.
export function createBuildsMainPart(): MainPart<typeof buildsManifest> {
  // By backend data folder, the wait for the calls of the instances replaced over it.
  const drains = createDrains();
  return {
    manifest: buildsManifest,
    start(api: BuildsApi) {
      api.layouts.register({ layoutTypes });
      const { services } = api;
      const { clock, log } = services;
      const chat = api.dependency(chatMainKey);
      const sessionRows = api.state.read(sessionsRowsSlot);
      const snapshot = api.state.publish(buildsSnapshotSlot);
      const sessions = api.state.publish(buildsSessionsSlot);
      snapshot.set({ backends: [], polledAt: null });
      const registry = createBackendRegistry();
      const store = createLinkStore(api.data, log);
      const loaded = store
        .load()
        .catch((error: unknown) =>
          log(`${LINKS_FILE} unreadable: ${errorText(error)}`),
        );

      let isReady = false;
      let isStopped = false;
      let shown = false;
      // Bumped by each apply that changes something and by the stop, so a `create` or a poll begun before it publishes
      // nothing.
      let generation = 0;
      let appliedKey: string | null = null;
      let parsed: ParsedBackend[] = [];
      const live = new Map<string, LiveBackend>();
      // By backend id, then game id; kept across applies while the game stays in its entry.
      const records = new Map<string, Map<string, GameRecords>>();
      let polledAt: number | null = null;
      let activeBackends: string[] = [];
      // By `subjectKey`: a read subject for the part's life, and when a read found none.
      const subjects = new Map<string, string>();
      const missingSubjects = new Map<string, number>();
      const subjectFailures = new Set<string>();
      let endedWaiters: {
        link: SessionLink;
        resolve(link: SessionLink): void;
      }[] = [];

      const poller = createBuildsPoller({
        timers: services.timers,
        poll,
        isFast: (id) => shown || activeBackends.includes(id),
        log,
      });

      const downloads = createDownloads({
        files: services.files,
        paths: services.paths,
        clock,
        timers: services.timers,
        downloadsDir: services.downloadsDir,
        revealPath: (path) => services.revealPath(path),
        slot: api.state.publish(buildsDownloadsSlot),
        log,
        filesChanged: () => fold(),
      });
      const filesOf: FilesLookup = (backendId, game, builds) =>
        downloads.filesOf(backendId, game, builds);

      const queueing = createQueueing({
        backend: (id) => resolvedBackend(id),
        store,
        git: services.git,
        clock,
        randomHex: services.randomHex,
        chat,
        pollNow: (id) => poller.pollNow(id),
        stored: () => fold(),
        log,
      });

      // The parsed backend `id` with its instance, null for none: `problem` is the parsed entry's, else its instance's.
      function resolvedBackend(id: string): QueueingBackend | null {
        const backend = parsed.find((each) => each.id === id);
        if (backend === undefined) {
          return null;
        }
        const instanceProblem = live.get(id)?.problem ?? null;
        return {
          label: backend.label,
          entry: backend.entry,
          instance: live.get(id)?.instance ?? null,
          problem:
            backend.entry === null
              ? backend.problems.join('; ')
              : instanceProblem,
        };
      }

      // The listed build an arg names, with its backend; else the refusal of the first of the backend, its entry, the
      // game and the build in the game's last listed builds that does not resolve. Needs no instance.
      function downloadTargetOf(arg: {
        backend: string;
        game: string;
        build: string;
      }):
        | { target: DownloadTarget; backend: QueueingBackend }
        | { problem: string } {
        const backend = resolvedBackend(arg.backend);
        if (backend === null) {
          return { problem: `no backend ${arg.backend}` };
        }
        if (backend.entry === null) {
          return { problem: startingProblem(backend) };
        }
        const game = backend.entry.games.find((each) => each.id === arg.game);
        if (game === undefined) {
          return { problem: `no game ${arg.game} in ${backend.label}` };
        }
        const build = records
          .get(arg.backend)
          ?.get(arg.game)
          ?.builds.find((each) => each.id === arg.build);
        if (build === undefined) {
          return { problem: `no build ${arg.build} in ${game.label}` };
        }
        return { target: { backendId: arg.backend, game, build }, backend };
      }

      function apply() {
        if (!isReady || isStopped) {
          return;
        }
        const next = parseBackends(api.settings().backends, (text) =>
          services.paths.expandTilde(text, services.homeDir),
        );
        const key = JSON.stringify({ backends: next, kinds: registry.kinds() });
        if (key === appliedKey) {
          return;
        }
        appliedKey = key;
        generation += 1;
        const startedIn = generation;
        try {
          releaseInstances();
        } catch (error) {
          log(`backend dispose failed: ${errorText(error)}`);
        }
        live.clear();
        parsed = next;
        keepRecordsOf(next);
        log(appliedLine(next));
        for (const backend of next) {
          live.set(backend.id, {
            instance: null,
            problem: null,
            hasPolled: false,
          });
        }
        poller.setBackends(polledIds(), []);
        for (const backend of next) {
          if (backend.entry !== null) {
            void create(backend.entry, startedIn);
          }
        }
        fold();
      }

      // Disposes every live instance and holds the wait for its calls in `drains` under its data folder; throws the
      // first dispose's error once every instance is released.
      function releaseInstances() {
        const released = [...live].flatMap(([backendId, backend]) =>
          backend.instance === null
            ? []
            : [{ backendId, instance: backend.instance }],
        );
        callEach(released, ({ backendId, instance }) => {
          try {
            instance.dispose();
          } finally {
            drains.hold(dataFolderOf(backendId), instance);
          }
        });
      }

      // Waits for the calls of every instance replaced over the entry's data folder; logs once after
      // `DRAIN_TIMEOUT_MS` while it still waits, the part runs and no later apply has begun.
      async function awaitDrain(backendId: string, startedIn: number) {
        const handle = services.timers.set(() => {
          if (startedIn === generation && !isStopped) {
            log(
              `${backendId}: replaced instance still busy after ${DRAIN_TIMEOUT_MS} ms; waiting for its calls to settle`,
            );
          }
        }, DRAIN_TIMEOUT_MS);
        await drains.settled(dataFolderOf(backendId));
        services.timers.clear(handle);
      }

      // Drops the records and the file checks of every game no longer in its backend's entry, and marks every kept game
      // not yet listed by the instance to come.
      function keepRecordsOf(next: ParsedBackend[]) {
        for (const [backendId, games] of records) {
          const entry = next.find((backend) => backend.id === backendId)?.entry;
          for (const [gameId, gameRecords] of games) {
            if (entry?.games.some((game) => game.id === gameId)) {
              gameRecords.hasListed = false;
            } else {
              games.delete(gameId);
              downloads.forgetGame(backendId, gameId);
            }
          }
          if (games.size === 0) {
            records.delete(backendId);
          }
        }
      }

      async function create(entry: BackendEntry, startedIn: number) {
        await awaitDrain(entry.id, startedIn);
        if (startedIn !== generation || isStopped) {
          return;
        }
        const made = await createInstance(entry);
        if (startedIn !== generation || isStopped) {
          try {
            made.instance?.dispose();
          } catch (error) {
            log(`backend dispose failed: ${errorText(error)}`);
          }
          return;
        }
        live.set(entry.id, { ...made, hasPolled: false });
        poller.setBackends(polledIds(), [entry.id]);
        fold();
      }

      async function createInstance(
        entry: BackendEntry,
      ): Promise<{ instance: TrackedBackend | null; problem: string | null }> {
        const kind = registry.get(entry.kind);
        if (kind === null) {
          return {
            instance: null,
            problem: `no backend kind "${entry.kind}": its plugin is off or missing`,
          };
        }
        try {
          const made = await kind.create(entry, backendServices(entry));
          return 'problem' in made
            ? { instance: null, problem: made.problem }
            : { instance: trackCalls(made), problem: null };
        } catch (error) {
          return {
            instance: null,
            problem: `create failed: ${errorText(error)}`,
          };
        }
      }

      function dataFolderOf(backendId: string): string {
        return services.paths.join(api.dataFolder, 'backends', backendId);
      }

      function backendServices(entry: BackendEntry): BackendServices {
        const dataFolder = dataFolderOf(entry.id);
        return {
          processes: services.processes,
          git: services.git,
          files: services.files,
          dataFiles: scopedFiles(services.files, dataFolder, services.paths),
          dataFolder,
          paths: services.paths,
          clock,
          timers: services.timers,
          homeDir: services.homeDir,
          platform: services.platform,
          log: (message) => log(`${entry.id}: ${message}`),
        };
      }

      // The backends with an instance and at least one game.
      function polledIds(): string[] {
        return parsed
          .filter(
            (backend) =>
              live.get(backend.id)?.instance &&
              (backend.entry?.games.length ?? 0) > 0,
          )
          .map((backend) => backend.id);
      }

      async function poll(backendId: string): Promise<void> {
        const startedIn = generation;
        const backend = live.get(backendId);
        const entry = parsed.find((each) => each.id === backendId)?.entry;
        if (!backend?.instance || !entry) {
          return;
        }
        const { instance } = backend;
        const isCurrent = () => startedIn === generation && !isStopped;
        const lists: GameList[] = [];
        for (const game of entry.games) {
          try {
            const builds = await instance.list(game, BUILDS_PER_GAME);
            lists.push({ game, builds, failure: null });
          } catch (error) {
            const builds = records.get(backendId)?.get(game.id)?.builds ?? [];
            lists.push({ game, builds, failure: errorText(error) });
          }
          if (!isCurrent()) {
            return;
          }
        }
        await readSubjects(lists);
        if (!isCurrent()) {
          return;
        }
        for (const { game, builds } of lists) {
          downloads.checkFiles(backendId, game, builds);
        }
        let listedCount = 0;
        for (const { game, builds, failure } of lists) {
          const gameRecords = recordsOf(backendId, game.id);
          if (failure !== null && failure !== gameRecords.failure) {
            log(`poll ${backendId} failed: ${game.label}: ${failure}`);
          }
          if (failure === null) {
            listedCount += builds.length;
            gameRecords.hasListed = true;
          }
          gameRecords.builds = builds;
          gameRecords.failure = failure;
          gameRecords.subjects = knownSubjects(game, builds);
        }
        polledAt = clock.now();
        if (!backend.hasPolled) {
          backend.hasPolled = true;
          log(`first poll ${backendId}: ${listedCount} builds`);
        }
        fold();
      }

      function recordsOf(backendId: string, gameId: string): GameRecords {
        let games = records.get(backendId);
        if (games === undefined) {
          games = new Map();
          records.set(backendId, games);
        }
        let gameRecords = games.get(gameId);
        if (gameRecords === undefined) {
          gameRecords = {
            builds: [],
            subjects: {},
            failure: null,
            hasListed: false,
          };
          games.set(gameId, gameRecords);
        }
        return gameRecords;
      }

      // Reads the subject of each listed revision in a game with a clone that the cache does not hold: a null read is
      // asked again only `SLOW_POLL_MS` after it.
      async function readSubjects(lists: readonly GameList[]) {
        const now = clock.now();
        const asks = new Map<string, Promise<void>>();
        for (const { game, builds } of lists) {
          const { clone } = game;
          if (clone === null) {
            continue;
          }
          for (const build of builds) {
            if (build.revision === null) {
              continue;
            }
            const key = subjectKey(clone, build.revision);
            const missingAt = missingSubjects.get(key);
            const isCached =
              subjects.has(key) ||
              (missingAt !== undefined && now - missingAt < SLOW_POLL_MS);
            if (!isCached && !asks.has(key)) {
              asks.set(key, readSubject(clone, build.revision, key));
            }
          }
        }
        await Promise.all(asks.values());
      }

      async function readSubject(clone: string, sha: string, key: string) {
        try {
          const subject = await services.git.commitSubject(clone, sha);
          if (subject === null) {
            missingSubjects.set(key, clock.now());
          } else {
            subjects.set(key, subject);
            missingSubjects.delete(key);
          }
        } catch (error) {
          const text = errorText(error);
          if (!subjectFailures.has(text)) {
            subjectFailures.add(text);
            log(`commit subject failed: ${text}`);
          }
        }
      }

      // The cached subject of each of `builds`' revisions, by sha.
      function knownSubjects(
        game: GameEntry,
        builds: readonly BuildRecord[],
      ): Record<string, string> {
        const known: Record<string, string> = {};
        for (const build of builds) {
          const subject =
            game.clone === null || build.revision === null
              ? undefined
              : subjects.get(subjectKey(game.clone, build.revision));
          if (subject !== undefined && build.revision !== null) {
            known[build.revision] = subject;
          }
        }
        return known;
      }

      // The parsed problems, then the instance's, then each game's last list failure; null when there are none.
      function headingProblem(backend: ParsedBackend): string | null {
        const texts = [...backend.problems];
        const instanceProblem = live.get(backend.id)?.problem ?? null;
        if (instanceProblem !== null) {
          texts.push(instanceProblem);
        }
        for (const game of backend.entry?.games ?? []) {
          const failure =
            records.get(backend.id)?.get(game.id)?.failure ?? null;
          if (failure !== null) {
            texts.push(`${game.label}: ${failure}`);
          }
        }
        return texts.length === 0 ? null : texts.join('; ');
      }

      function backendStates(): BackendState[] {
        return parsed.map((backend) => ({
          id: backend.id,
          kind: backend.kind,
          label: backend.label,
          problem: headingProblem(backend),
          capabilities: live.get(backend.id)?.instance?.capabilities ?? null,
          games: (backend.entry?.games ?? []).map((game) => {
            const gameRecords = records.get(backend.id)?.get(game.id);
            return {
              game,
              builds: gameRecords?.builds ?? [],
              subjects: gameRecords?.subjects ?? {},
              files: filesOf(backend.id, game, gameRecords?.builds ?? []),
              listed: gameRecords?.hasListed ?? false,
            };
          }),
        }));
      }

      function fold() {
        if (!isReady || isStopped) {
          return;
        }
        const now = clock.now();
        const result = foldBuilds({
          backends: backendStates(),
          links: store.links(),
          setRuns: store.setRuns(),
          offers: store.offers(),
          polledAt,
          now,
        });
        activeBackends = result.activeBackends;
        snapshot.set(result.snapshot);
        writeSessions(result.sessions);
        poller.reschedule();
        const isPruned = store.prune(now, result.isUnlisted);
        handleEvents(result.events);
        if (isPruned) {
          fold();
        }
      }

      function writeSessions(next: Record<string, SessionBuilds>) {
        for (const [sessionId, value] of Object.entries(next)) {
          const isSame =
            JSON.stringify(sessions.get(sessionId)) === JSON.stringify(value);
          if (!isSame) {
            sessions.set(sessionId, value);
          }
        }
        for (const sessionId of sessions.all().keys()) {
          if (!Object.hasOwn(next, sessionId)) {
            sessions.delete(sessionId);
          }
        }
      }

      // Sets every event's flags at once, before any write settles, so a fold meanwhile reports none of them again;
      // then tells each in fold order.
      function handleEvents(events: BuildsEvent[]) {
        if (events.length === 0) {
          return;
        }
        const now = clock.now();
        for (const event of events) {
          markTold(event, now);
        }
        void tellInOrder(events);
      }

      function markTold(event: BuildsEvent, now: number) {
        if (event.kind === 'failing') {
          store.updateLinks(isLinkOf(event.sessionId, event.ref), {
            failingNotified: true,
          });
        } else if (event.kind === 'ended') {
          store.updateLinks(isLinkOf(event.sessionId, event.ref), {
            notified: true,
            endedAt: event.build.finishedAt ?? now,
          });
        } else {
          const finishes = event.builds.flatMap((build) =>
            build.finishedAt === null ? [] : [build.finishedAt],
          );
          const endedAt = finishes.length === 0 ? now : Math.max(...finishes);
          const setRunId = event.setRun.id;
          store.updateSetRun(setRunId, { notified: true, endedAt });
          store.updateLinks((link) => link.setRunId === setRunId, {
            notified: true,
            endedAt,
          });
        }
      }

      async function tellInOrder(events: BuildsEvent[]) {
        for (const event of events) {
          await tell(event);
          if (event.kind === 'ended') {
            settleEndedWaiters(event.sessionId, event.ref);
          }
        }
      }

      async function tell(event: BuildsEvent) {
        const isWritten = await store.written();
        await endedFilesChecked(event);
        if (isStopped) {
          return;
        }
        const { sessionId, line, text } = messageOf(event, filesOf);
        if (sessionId === null) {
          return;
        }
        if (!isWritten) {
          log(`${line}: not written, not sent`);
          return;
        }
        if (sessionRows.get(sessionId) === undefined) {
          log(`${line}: no session row, not sent`);
          return;
        }
        try {
          await chat.send(sessionId, { text, images: [] });
          log(`${line}: sent`);
        } catch (error) {
          log(`${line}: send failed: ${errorText(error)}`);
        }
      }

      // Waits for the file checks in flight of an ended build or set, each giving up after `FILE_CHECK_TIMEOUT_MS`, so
      // its message names a file that landed since the last poll.
      async function endedFilesChecked(event: BuildsEvent) {
        if (event.kind === 'ended') {
          await downloads.checksSettled(event.ref.backendId, event.game, [
            event.build,
          ]);
        } else if (event.kind === 'setEnded') {
          await downloads.checksSettled(
            event.setRun.backendId,
            event.game,
            event.builds,
          );
        }
      }

      function settleEndedWaiters(sessionId: string, ref: BuildRef) {
        const isLink = isLinkOf(sessionId, ref);
        const settling = endedWaiters.filter((waiter) => isLink(waiter.link));
        endedWaiters = endedWaiters.filter((waiter) => !isLink(waiter.link));
        for (const waiter of settling) {
          waiter.resolve(store.links().find(isLink) ?? waiter.link);
        }
      }

      const addLinkUntilEnded = (link: SessionLink) =>
        new Promise<SessionLink>((resolve) => {
          endedWaiters.push({ link, resolve });
          store.addLinks([link]);
          fold();
        });

      api.channel.handle('setShown', (next) => {
        shown = next;
        poller.reschedule();
      });
      api.channel.handle('branches', (arg) => queueing.branches(arg));
      api.channel.handle('queue', (arg) => queueing.queue(arg));
      api.channel.handle('queueOffer', (sessionId) =>
        queueing.queueOffer(sessionId),
      );
      api.channel.handle('dismissOffer', (sessionId) => {
        queueing.dismissOffer(sessionId);
      });
      api.channel.handle('cancel', (arg) => queueing.cancel(arg));
      api.channel.handle('launchSetAgent', (arg) =>
        queueing.launchSetAgent(arg),
      );
      api.channel.handle('saveLog', async (arg) => {
        const found = downloadTargetOf(arg);
        if ('problem' in found) {
          return found;
        }
        const { instance } = found.backend;
        if (instance === null) {
          return { problem: startingProblem(found.backend) };
        }
        const job =
          arg.job === null
            ? null
            : found.target.build.jobs.find((each) => each.id === arg.job);
        if (job === undefined) {
          return { problem: `no job ${arg.job} in build ${arg.build}` };
        }
        return downloads.saveLog(found.target, job, instance);
      });
      api.channel.handle('download', async (arg) => {
        const found = downloadTargetOf(arg);
        if ('problem' in found) {
          return found;
        }
        const { backendId, game, build } = found.target;
        const file = filesOf(backendId, game, [build])[build.id]?.find(
          (each) => each.entry === arg.file,
        );
        if (file === undefined) {
          return { problem: `no file ${arg.file} for build ${arg.build}` };
        }
        return downloads.download(found.target, file);
      });
      api.onSettingsChanged(() => apply());
      const registryChanged = registry.onChanged(() => apply());
      const sessionDemoStep = registerSessionDemoStep(services);

      if (services.selfTest !== null || services.runMode === 'drive') {
        registry.add(selfTestBackendKind(clock));
      }
      if (services.selfTest !== null) {
        services.selfTest.run(
          buildsSelfTestScript({
            addLinkUntilEnded,
            writeHomeFile: (path, text) =>
              services.files.write(
                services.paths.join(services.homeDir, path),
                text,
              ),
            now: () => clock.now(),
            log,
          }),
        );
      }

      return {
        commands: {
          queue: async ({ arg, callerSessionId }) => {
            refuseOnProblem(
              'queue',
              await queueing.queue({
                ...arg,
                sessionId: callerSessionId ?? null,
              }),
            );
          },
          offer: async ({ arg, callerSessionId }) => {
            if (callerSessionId === undefined) {
              throw new Error('builds.offer: no calling session');
            }
            refuseOnProblem(
              'offer',
              await queueing.offer(arg, callerSessionId),
            );
          },
          launchSetAgent: async ({ arg }) => {
            refuseOnProblem(
              'launchSetAgent',
              await queueing.launchSetAgent(arg),
            );
          },
        },
        exports: (consumer): BuildsMainExports => ({
          addBackend: (kind) => consumer.track(registry.add(kind)),
        }),
        ready() {
          void Promise.all([loaded, chat.restored()]).then(() => {
            if (isStopped) {
              return;
            }
            isReady = true;
            apply();
          });
        },
        dispose: () => {
          isStopped = true;
          generation += 1;
          callEach<() => void>(
            [
              () => poller.dispose(),
              () => downloads.dispose(),
              () => releaseInstances(),
              () => registryChanged.dispose(),
              () => sessionDemoStep.dispose(),
            ],
            (dispose) => dispose(),
          );
        },
      };
    },
  };
}

export const buildsMainPart = createBuildsMainPart();

// The refusal of a backend with no entry or no instance: its problem, else that it is still starting.
function startingProblem(backend: QueueingBackend): string {
  return `${backend.label}: ${backend.problem ?? 'still starting'}`;
}

// Throws a command's refusal, so an agent's `run_command` reports it.
function refuseOnProblem(command: string, result: QueueingResult) {
  if ('problem' in result) {
    throw new Error(`builds.${command}: ${result.problem}`);
  }
}

function appliedLine(backends: ParsedBackend[]): string {
  if (backends.length === 0) {
    return 'backends applied: none';
  }
  const parts = backends.map((backend) => {
    const games = `${backend.id} ${backend.entry?.games.length ?? 0} games`;
    return backend.problems.length === 0
      ? games
      : `${games} (problem: ${backend.problems.join('; ')})`;
  });
  return `backends applied: ${parts.join('; ')}`;
}

function isLinkOf(
  sessionId: string,
  ref: BuildRef,
): (link: SessionLink) => boolean {
  return (link) =>
    link.sessionId === sessionId &&
    link.backendId === ref.backendId &&
    link.buildId === ref.buildId;
}

// The message an event tells, a build's end naming the files `filesOf` finds on disk now.
function messageOf(event: BuildsEvent, filesOf: FilesLookup): EventMessage {
  if (event.kind === 'failing') {
    return {
      sessionId: event.sessionId,
      line: `failing ${event.ref.backendId}/${event.ref.buildId} for ${event.sessionId}`,
      text: failingMessage(event.game, event.build, event.failedJobs),
    };
  }
  if (event.kind === 'ended') {
    return {
      sessionId: event.sessionId,
      line: `ended ${event.ref.backendId}/${event.ref.buildId} for ${event.sessionId}`,
      text: endedMessage(
        event.game,
        event.build,
        filesOf(event.ref.backendId, event.game, [event.build])[
          event.build.id
        ] ?? [],
      ),
    };
  }
  return {
    sessionId: event.setRun.sessionId,
    line: `set ended ${event.setRun.id} for ${event.setRun.sessionId}`,
    text: setEndedMessage(
      event.game,
      event.setRun,
      event.builds,
      filesOf(event.setRun.backendId, event.game, event.builds),
    ),
  };
}

function subjectKey(clone: string, sha: string): string {
  return `${clone}\n${sha}`;
}
