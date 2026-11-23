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
  type BuildBackend,
  type BuildRecord,
  type BuildRef,
  BUILDS_PER_GAME,
  type BuildsChannel,
  type BuildsMainExports,
  buildsSessionsSlot,
  buildsSnapshotSlot,
  type GameEntry,
  type SessionBuilds,
} from '../contract';
import { buildsManifest } from '../manifest';
import { type ParsedBackend, parseBackends } from './backend-config';
import { createBackendRegistry } from './backend-registry';
import {
  endedMessage,
  failingMessage,
  setEndedMessage,
} from './build-messages';
import { selfTestBackendKind } from './fixture-backend';
import { createLinkStore, LINKS_FILE } from './link-store';
import { createBuildsPoller, SLOW_POLL_MS } from './poller';
import { createQueueing, type QueueingResult } from './queueing';
import { buildsSelfTestScript } from './selftest-script';

type BuildsApi = MainApi<typeof buildsManifest, BuildsChannel>;

// One backend entry's instance, made by one apply: null with `problem` set when its kind is missing or its `create`
// gave a problem or rejected, and null with no problem while `create` awaits.
interface LiveBackend {
  instance: BuildBackend | null;
  problem: string | null;
  hasPolled: boolean;
}

// A game's last listed builds, the commit subjects read for their revisions, and its last list failure until a good
// list.
interface GameRecords {
  builds: BuildRecord[];
  subjects: Record<string, string>;
  failure: string | null;
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

// Starts with an empty snapshot and loads the session links. `ready` waits for the load and chat's restore of its
// rows, then applies the `backends` setting, and applies it again on each settings change and each kind a backend
// plugin adds or removes: an apply that changes the parsed backends or the kinds disposes every instance and creates
// each entry's anew, each publishing as its own `create` settles. Polls each backend with an instance and games, folds
// after each poll, apply and store change into `builds.snapshot` and `builds.sessions`, and tells each linked session
// its build's failing job and end, and a set's end, writing the flag before the message. Exports `addBackend`; the
// commands and the channel queue, offer, cancel and launch a set's agent through `queueing`.
export const buildsMainPart: MainPart<typeof buildsManifest> = {
  manifest: buildsManifest,
  start(api: BuildsApi) {
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
    const endedWaiters: {
      link: SessionLink;
      resolve(link: SessionLink): void;
    }[] = [];

    const poller = createBuildsPoller({
      timers: services.timers,
      poll,
      isFast: (id) => shown || activeBackends.includes(id),
      log,
    });

    const queueing = createQueueing({
      backend(id) {
        const backend = parsed.find((each) => each.id === id);
        if (backend === undefined) {
          return null;
        }
        return {
          label: backend.label,
          entry: backend.entry,
          instance: live.get(id)?.instance ?? null,
          problem: headingProblem(backend),
        };
      },
      store,
      git: services.git,
      clock,
      randomHex: services.randomHex,
      chat,
      pollNow: (id) => poller.pollNow(id),
      stored: () => fold(),
      log,
    });

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
      disposeInstances();
      live.clear();
      parsed = next;
      keepRecordsOf(next);
      log(appliedLine(next));
      for (const backend of next) {
        live.set(backend.id, { instance: null, problem: null, hasPolled: false });
      }
      poller.setBackends(polledIds(), []);
      for (const backend of next) {
        if (backend.entry !== null) {
          void create(backend.entry, startedIn);
        }
      }
      fold();
    }

    function disposeInstances() {
      const instances = [...live.values()].flatMap((backend) =>
        backend.instance === null ? [] : [backend.instance],
      );
      try {
        callEach(instances, (instance) => instance.dispose());
      } catch (error) {
        log(`backend dispose failed: ${errorText(error)}`);
      }
    }

    // Drops the records of every game no longer in its backend's entry.
    function keepRecordsOf(next: ParsedBackend[]) {
      for (const [backendId, games] of [...records]) {
        const entry = next.find((backend) => backend.id === backendId)?.entry;
        for (const gameId of [...games.keys()]) {
          if (!entry?.games.some((game) => game.id === gameId)) {
            games.delete(gameId);
          }
        }
        if (games.size === 0) {
          records.delete(backendId);
        }
      }
    }

    async function create(entry: BackendEntry, startedIn: number) {
      const made = await createInstance(entry);
      if (startedIn !== generation || isStopped) {
        made.instance?.dispose();
        return;
      }
      live.set(entry.id, { ...made, hasPolled: false });
      poller.setBackends(polledIds(), [entry.id]);
      fold();
    }

    async function createInstance(
      entry: BackendEntry,
    ): Promise<{ instance: BuildBackend | null; problem: string | null }> {
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
          : { instance: made, problem: null };
      } catch (error) {
        return {
          instance: null,
          problem: `create failed: ${errorText(error)}`,
        };
      }
    }

    function backendServices(entry: BackendEntry): BackendServices {
      const dataFolder = services.paths.join(
        api.dataFolder,
        'backends',
        entry.id,
      );
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
      let listedCount = 0;
      for (const { game, builds, failure } of lists) {
        const gameRecords = recordsOf(backendId, game.id);
        if (failure !== null && failure !== gameRecords.failure) {
          log(`poll ${backendId} failed: ${game.label}: ${failure}`);
        }
        if (failure === null) {
          listedCount += builds.length;
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
        gameRecords = { builds: [], subjects: {}, failure: null };
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
        const failure = records.get(backend.id)?.get(game.id)?.failure ?? null;
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
          };
        }),
      }));
    }

    function fold() {
      if (!isReady || isStopped) {
        return;
      }
      const now = clock.now();
      const backends = backendStates();
      const result = foldBuilds({
        backends,
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
      const listed = listedRefs(backends);
      const isPruned = store.prune(now, (ref) => listed.has(refKey(ref)));
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
      for (const sessionId of [...sessions.all().keys()]) {
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
      if (isStopped) {
        return;
      }
      const { sessionId, line, text } = messageOf(event);
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

    function settleEndedWaiters(sessionId: string, ref: BuildRef) {
      const isLink = isLinkOf(sessionId, ref);
      for (const waiter of [...endedWaiters]) {
        if (isLink(waiter.link)) {
          endedWaiters.splice(endedWaiters.indexOf(waiter), 1);
          waiter.resolve(store.links().find(isLink) ?? waiter.link);
        }
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
    api.onSettingsChanged(() => apply());
    const registryChanged = registry.onChanged(() => apply());

    if (services.selfTest !== null) {
      registry.add(selfTestBackendKind(clock));
      services.selfTest.run(
        buildsSelfTestScript({
          addLinkUntilEnded,
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
            await queueing.queue({ ...arg, sessionId: callerSessionId ?? null }),
          );
        },
        offer: async ({ arg, callerSessionId }) => {
          if (callerSessionId === undefined) {
            throw new Error('builds.offer: no calling session');
          }
          refuseOnProblem('offer', await queueing.offer(arg, callerSessionId));
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
        const instances = [...live.values()].flatMap((backend) =>
          backend.instance === null ? [] : [backend.instance],
        );
        callEach<() => void>(
          [
            () => poller.dispose(),
            ...instances.map((instance) => () => instance.dispose()),
            () => registryChanged.dispose(),
          ],
          (dispose) => dispose(),
        );
      },
    };
  },
};

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

function messageOf(event: BuildsEvent): EventMessage {
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
      text: endedMessage(event.game, event.build),
    };
  }
  return {
    sessionId: event.setRun.sessionId,
    line: `set ended ${event.setRun.id} for ${event.setRun.sessionId}`,
    text: setEndedMessage(event.game, event.setRun, event.builds),
  };
}

function subjectKey(clone: string, sha: string): string {
  return `${clone}\n${sha}`;
}

function refKey(ref: BuildRef): string {
  return `${ref.backendId}\n${ref.buildId}`;
}

// Every listed build's ref, by `refKey`.
function listedRefs(backends: BackendState[]): Set<string> {
  const listed = new Set<string>();
  for (const backend of backends) {
    for (const state of backend.games) {
      for (const build of state.builds) {
        listed.add(refKey({ backendId: backend.id, buildId: build.id }));
      }
    }
  }
  return listed;
}
