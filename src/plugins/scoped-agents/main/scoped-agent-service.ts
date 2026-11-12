import type { Timers } from '../../../contracts/ambient';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { ChatMainExports } from '../../chat/contract';
import type { AgentSession } from '../../sessions/contract';
import type {
  ScopedAgent,
  ScopedAgentRecord,
  ScopedAgentSpec,
} from '../contract';

// How long a launch waits for chat's `sessionOpened` to name its host id.
export const HOST_ID_WAIT_MS = 2_000;

export interface ScopedAgentServiceDeps {
  chat: Pick<
    ChatMainExports,
    'launch' | 'resume' | 'defaultProfile' | 'profileOf' | 'send' | 'close'
  >;
  paths: Pick<Paths, 'samePath'>;
  timers: Timers;
  log(line: string): void;
}

// Every registration's owned sessions, run in the spec's folder under chat's
// default profile; every launch and resume rejects with `Chat has no
// profiles.` when chat has none. `add` throws for a second live registration
// of one (owner, agent id); `ask` and `sessionOf` reject `No scoped agent
// <owner>/<agentId>.` for a pair with no live registration, as a disposed
// handle's `ask` and `sessionOf` do, and its `scopeOf` resolves null. Asks for
// one scope of one registration, and `cleared`'s host-id move on it, run one at
// a time, and concurrent `sessionOf` calls for it share one resume. Disposing a
// registration launches and closes nothing, and an ask in flight runs to its
// end. `opened`, `closed` and `cleared` hear chat's `sessionOpened`,
// `sessionClosed` and `sessionCleared` for every registration.
export interface ScopedAgentService {
  add(spec: ScopedAgentSpec): ScopedAgent;
  ask(
    owner: string,
    agentId: string,
    scope: string,
    text: string,
  ): Promise<string>;
  sessionOf(
    owner: string,
    agentId: string,
    scope: string,
  ): Promise<string | null>;
  opened(event: {
    sessionId: string;
    hostSessionId: string;
    projectDir: string;
  }): void;
  closed(event: { sessionId: string }): void;
  cleared(event: { sessionId: string; newHostSessionId: string }): void;
}

// One `add`; the registry holds it while the registration is live, compared
// by identity so a late dispose of an old handle leaves a re-added pair alone.
interface Registration {
  spec: ScopedAgentSpec;
}

// A launch between its `chat.launch` call and its host-id read.
interface InFlightLaunch {
  folder: string;
}

export function createScopedAgentService(
  deps: ScopedAgentServiceDeps,
): ScopedAgentService {
  const { chat, paths, timers, log } = deps;
  // `<owner>/<agentId>` → its live registration.
  const registrations = new Map<string, Registration>();
  const launches: InFlightLaunch[] = [];
  // Row id → host id, from `sessionOpened` in an in-flight launch's folder,
  // until read or closed.
  const hostIds = new Map<string, string>();
  // Row id → the `hostIdOf` read waiting for its `sessionOpened`.
  const waitingReads = new Map<string, (hostSessionId: string) => void>();
  // Turn key → the shared resume, and → the last turn's settling.
  const resumes = new Map<string, Promise<string | null>>();
  const asks = new Map<string, Promise<unknown>>();

  const isLive = (registration: Registration): boolean =>
    registrations.get(pairOf(registration.spec)) === registration;

  const liveRegistration = (owner: string, agentId: string): Registration => {
    const registration = registrations.get(`${owner}/${agentId}`);
    if (registration === undefined) {
      throw new Error(noAgentText(owner, agentId));
    }
    return registration;
  };

  const requireProfile = (): string => {
    const profile = chat.defaultProfile(null);
    if (profile === null) {
      throw new Error('Chat has no profiles.');
    }
    return profile;
  };

  // The host id `sessionOpened` named for row `id`, waiting up to
  // HOST_ID_WAIT_MS for it; null when none came.
  const hostIdOf = (id: string): Promise<string | null> => {
    const hostSessionId = hostIds.get(id);
    if (hostSessionId !== undefined) {
      hostIds.delete(id);
      return Promise.resolve(hostSessionId);
    }
    return new Promise((resolve) => {
      const timer = timers.set(() => {
        waitingReads.delete(id);
        resolve(null);
      }, HOST_ID_WAIT_MS);
      waitingReads.set(id, (heard) => {
        timers.clear(timer);
        waitingReads.delete(id);
        resolve(heard);
      });
    });
  };

  const closeLogged = async (id: string, label: string): Promise<void> => {
    try {
      await chat.close(id, 'finished');
    } catch (error) {
      log(`${label} ${id} not closed: ${errorText(error)}`);
    }
  };

  // Runs `work` after every earlier turn under `key` has settled.
  const inTurn = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const turn = (asks.get(key) ?? Promise.resolve()).then(work);
    const settled = turn.catch(() => undefined);
    asks.set(key, settled);
    void settled.then(() => {
      if (asks.get(key) === settled) {
        asks.delete(key);
      }
    });
    return turn;
  };

  // Runs `launch` as an in-flight launch in `folder`, so `opened` hears the
  // `sessionOpened` it fires, and reads the new row's host id.
  const launchHeard = async (
    folder: string,
    launch: () => Promise<string>,
  ): Promise<{ id: string; hostSessionId: string | null }> => {
    const inFlight: InFlightLaunch = { folder };
    launches.push(inFlight);
    try {
      const id = await launch();
      return { id, hostSessionId: await hostIdOf(id) };
    } finally {
      launches.splice(launches.indexOf(inFlight), 1);
    }
  };

  const launchSession = async (
    spec: ScopedAgentSpec,
    scope: string,
    text: string,
  ): Promise<string> => {
    const { agentId, store } = spec;
    const profile = requireProfile();
    const old = await store.superseded(scope);
    const folder = spec.folder(scope);
    const instructions = await spec.instructions(scope);
    const { id, hostSessionId } = await launchHeard(folder, () =>
      chat.launch({
        projectDir: folder,
        profile,
        message: { text, images: [] },
        instructions: [instructions],
        owner: spec.owner,
      }),
    );
    if (hostSessionId === null) {
      log(
        `${agentId} ${id} sent no sessionOpened in ${String(HOST_ID_WAIT_MS)} ms`,
      );
      await closeLogged(id, agentId);
      throw new Error(`Chat sent no sessionOpened for ${agentId} ${id}.`);
    }
    try {
      await store.write(scope, { sessionId: id, hostSessionId });
    } catch (error) {
      await closeLogged(id, `unstored ${agentId}`);
      throw error;
    }
    if (old !== null && chat.profileOf(old.sessionId) !== null) {
      await closeLogged(old.sessionId, `old ${agentId}`);
    }
    return id;
  };

  const bringBack = async (
    spec: ScopedAgentSpec,
    scope: string,
  ): Promise<string | null> => {
    const { agentId, store } = spec;
    const record = await store.read(scope);
    if (record === null) {
      return null;
    }
    if (chat.profileOf(record.sessionId) !== null) {
      return record.sessionId;
    }
    const profile = requireProfile();
    const [title, instructions] = await Promise.all([
      spec.title(scope),
      spec.instructions(scope),
    ]);
    let id: string;
    try {
      id = await chat.resume({
        projectDir: spec.folder(scope),
        profile,
        hostSessionId: record.hostSessionId,
        title,
        instructions: [instructions],
        owner: spec.owner,
      });
    } catch (error) {
      await store.write(scope, null);
      log(
        `${agentId} ${record.sessionId} not resumed, so cleared: ${errorText(error)}`,
      );
      return null;
    }
    if (id !== record.sessionId) {
      await store.write(scope, {
        sessionId: id,
        hostSessionId: record.hostSessionId,
      });
    }
    return id;
  };

  const sessionFor = (
    spec: ScopedAgentSpec,
    scope: string,
  ): Promise<string | null> => {
    const key = turnKey(spec, scope);
    const pending = resumes.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const resume = bringBack(spec, scope).finally(() => resumes.delete(key));
    resumes.set(key, resume);
    return resume;
  };

  const askFor = (
    spec: ScopedAgentSpec,
    scope: string,
    text: string,
  ): Promise<string> =>
    inTurn(turnKey(spec, scope), async () => {
      await spec.store.checkAsk(scope);
      if ((await spec.store.read(scope)) === null) {
        return launchSession(spec, scope, text);
      }
      const id = await sessionFor(spec, scope);
      if (id !== null) {
        await chat.send(id, { text, images: [] });
        return id;
      }
      // The resume failed and cleared the record, or the record went away
      // under the ask.
      await spec.store.checkAsk(scope);
      return launchSession(spec, scope, text);
    });

  const scopeFor = async (
    spec: ScopedAgentSpec,
    session: AgentSession,
  ): Promise<string | null> => {
    let entries: { scope: string; record: ScopedAgentRecord }[];
    try {
      entries = await spec.store.entries();
    } catch (error) {
      log(`${spec.agentId} records not read: ${errorText(error)}`);
      return null;
    }
    const found = entries.find(
      ({ record }) =>
        record.sessionId === session.id ||
        record.hostSessionId === session.info.sessionId,
    );
    return found?.scope ?? null;
  };

  // Stores `newHostSessionId` on the scope whose record is row `sessionId`,
  // so a later resume brings back the cleared conversation. The write runs in
  // the scope's turn, and only while its record still holds the row.
  const moveHostId = async (
    spec: ScopedAgentSpec,
    sessionId: string,
    newHostSessionId: string,
  ): Promise<void> => {
    const found = (await spec.store.entries()).find(
      ({ record }) => record.sessionId === sessionId,
    );
    if (found === undefined) {
      return;
    }
    const { scope } = found;
    await inTurn(turnKey(spec, scope), async () => {
      const record = await spec.store.read(scope);
      if (record?.sessionId === sessionId) {
        await spec.store.write(scope, {
          sessionId,
          hostSessionId: newHostSessionId,
        });
      }
    });
  };

  return {
    add(spec) {
      const pair = pairOf(spec);
      if (registrations.has(pair)) {
        throw new Error(`Scoped agent ${pair} is already registered.`);
      }
      const registration: Registration = { spec };
      registrations.set(pair, registration);
      const refusal = () =>
        Promise.reject(new Error(noAgentText(spec.owner, spec.agentId)));
      return {
        ask: (scope, text) =>
          isLive(registration) ? askFor(spec, scope, text) : refusal(),
        sessionOf: (scope) =>
          isLive(registration) ? sessionFor(spec, scope) : refusal(),
        scopeOf: (session) =>
          isLive(registration)
            ? scopeFor(spec, session)
            : Promise.resolve(null),
        dispose() {
          if (isLive(registration)) {
            registrations.delete(pair);
          }
        },
      };
    },
    async ask(owner, agentId, scope, text) {
      return askFor(liveRegistration(owner, agentId).spec, scope, text);
    },
    async sessionOf(owner, agentId, scope) {
      return sessionFor(liveRegistration(owner, agentId).spec, scope);
    },
    opened(event) {
      const isLaunchFolder = launches.some((launch) =>
        paths.samePath(event.projectDir, launch.folder),
      );
      if (!isLaunchFolder) {
        return;
      }
      const waitingRead = waitingReads.get(event.sessionId);
      if (waitingRead !== undefined) {
        waitingRead(event.hostSessionId);
        return;
      }
      hostIds.set(event.sessionId, event.hostSessionId);
    },
    closed(event) {
      hostIds.delete(event.sessionId);
    },
    cleared(event) {
      const { sessionId, newHostSessionId } = event;
      for (const { spec } of registrations.values()) {
        void moveHostId(spec, sessionId, newHostSessionId).catch((error) =>
          log(
            `${spec.agentId} ${sessionId} host id not moved: ${errorText(error)}`,
          ),
        );
      }
    },
  };
}

function pairOf(spec: ScopedAgentSpec): string {
  return `${spec.owner}/${spec.agentId}`;
}

function noAgentText(owner: string, agentId: string): string {
  return `No scoped agent ${owner}/${agentId}.`;
}

// Asks and resumes are keyed per registration and scope, so two registrations
// using one scope string stay apart.
function turnKey(spec: ScopedAgentSpec, scope: string): string {
  return `${pairOf(spec)}\n${scope}`;
}
