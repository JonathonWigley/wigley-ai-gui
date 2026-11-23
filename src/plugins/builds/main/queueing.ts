import type { Clock } from '../../../contracts/ambient';
import type { Git, GitRemoteHead } from '../../../contracts/git';
import { errorText } from '../../../shared/error-text';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionLink, SetRun } from '../builds-model';
import type {
  BackendEntry,
  BuildBackend,
  BuildRef,
  BuildSetEntry,
  GameEntry,
} from '../contract';
import type { LinkStore } from './link-store';

// A backend entry as queueing finds it: `entry` is null when the entry failed its parse, and `instance` null while it
// has none; `problem` is the heading's problem.
export interface QueueingBackend {
  label: string;
  entry: BackendEntry | null;
  instance: BuildBackend | null;
  problem: string | null;
}

// `backend` finds a parsed backend by id, null for none. `stored` hears each change queueing makes to the store.
export interface QueueingDeps {
  backend(id: string): QueueingBackend | null;
  store: LinkStore;
  git: Pick<Git, 'remoteHeads' | 'commitSubject'>;
  clock: Clock;
  randomHex(): string;
  chat: Pick<ChatMainExports, 'launch' | 'defaultProfile'>;
  pollNow(backendId: string): void;
  stored(): void;
  log(message: string): void;
}

export type QueueingResult = { ok: true } | { problem: string };

// `kind` names a kind of the game first, then a set. An absent `revision` is read from the clone's origin when the
// backend chooses the branch.
export interface QueueArg {
  backend: string;
  game: string;
  kind: string;
  branch: string;
  sessionId: string | null;
  revision?: string;
}

// The page's and the commands' queueing, offers, branch lists, cancels and set agents. Each resolves to `{ ok: true }`
// or a `{ problem }` (`branches` to the heads), never rejects, and changes nothing on a problem; a set whose later
// queue fails keeps the builds it queued.
export interface Queueing {
  queue(arg: QueueArg): Promise<QueueingResult>;
  offer(
    arg: { backend: string; game: string; kind: string; branch: string },
    sessionId: string,
  ): Promise<QueueingResult>;
  queueOffer(sessionId: string): Promise<QueueingResult>;
  dismissOffer(sessionId: string): QueueingResult;
  branches(arg: {
    backend: string;
    game: string;
    set: string | null;
  }): Promise<GitRemoteHead[] | { problem: string }>;
  cancel(arg: {
    backend: string;
    game: string;
    build: string;
  }): Promise<QueueingResult>;
  launchSetAgent(arg: {
    backend: string;
    game: string;
    set: string;
  }): Promise<QueueingResult>;
}

interface Found {
  backend: QueueingBackend;
  instance: BuildBackend;
  game: GameEntry;
}

// A kind of the game, or one of its sets.
type Target = { kinds: string[]; set: BuildSetEntry | null };

export function createQueueing(deps: QueueingDeps): Queueing {
  const { store, git, clock } = deps;

  function find(backendId: string, gameId: string): Found {
    const backend = deps.backend(backendId);
    if (backend === null) {
      throw new Error(`no backend "${backendId}"`);
    }
    if (backend.entry === null || backend.instance === null) {
      throw new Error(
        `${backend.label}: ${backend.problem ?? 'still starting'}`,
      );
    }
    const game = backend.entry.games.find((entry) => entry.id === gameId);
    if (game === undefined) {
      throw new Error(`no game "${gameId}" in ${backend.label}`);
    }
    return { backend, instance: backend.instance, game };
  }

  function targetOf(game: GameEntry, id: string): Target {
    if (Object.hasOwn(game.kinds, id)) {
      return { kinds: [id], set: null };
    }
    const set = setOf(game, id);
    return { kinds: set.kinds, set };
  }

  function setOf(game: GameEntry, id: string): BuildSetEntry {
    const set = game.sets.find((entry) => entry.id === id);
    if (set === undefined) {
      throw new Error(`no kind or set "${id}" in ${game.label}`);
    }
    return set;
  }

  function cloneOf(game: GameEntry): string {
    if (game.clone === null) {
      throw new Error(`${game.label} names no clone`);
    }
    return game.clone;
  }

  async function headsOf(
    clone: string,
    pattern: string,
  ): Promise<GitRemoteHead[]> {
    const heads = await git.remoteHeads(clone, pattern);
    if (heads === null) {
      throw new Error(`could not read the branches on origin of ${clone}`);
    }
    return heads;
  }

  // The revision a queue pins: the branch's origin head when the backend chooses the branch and the game names a
  // clone, else null.
  async function readRevision(
    found: Found,
    target: Target,
    branch: string,
  ): Promise<string | null> {
    const { game, instance } = found;
    if (!instance.capabilities.choosesBranch || game.clone === null) {
      return null;
    }
    if (target.set === null) {
      const heads = await headsOf(game.clone, branch);
      const head = heads.find((entry) => entry.name === branch);
      if (head === undefined) {
        throw new Error(`no branch "${branch}" on origin`);
      }
      return head.sha;
    }
    const pattern = target.set.branches;
    const heads = await headsOf(game.clone, pattern);
    const head = heads.find((entry) => entry.name === branch);
    if (head === undefined) {
      throw new Error(
        `"${branch}" does not match the set's branches ${pattern}`,
      );
    }
    return head.sha;
  }

  async function queue(arg: QueueArg): Promise<QueueingResult> {
    const found = find(arg.backend, arg.game);
    const target = targetOf(found.game, arg.kind);
    const revision =
      arg.revision ?? (await readRevision(found, target, arg.branch));
    const queued: BuildRef[] = [];
    let failure: string | null = null;
    for (const kind of target.kinds) {
      try {
        const { id } = await found.instance.queue(found.game, {
          kind,
          branch: arg.branch,
          revision,
        });
        queued.push({ backendId: arg.backend, buildId: id });
        deps.log(`queued ${arg.backend}/${id} on ${arg.branch}`);
      } catch (error) {
        if (queued.length === 0) {
          return { problem: errorText(error) };
        }
        failure = `queued ${queued.length} of ${target.kinds.length}: ${errorText(error)}`;
        break;
      }
    }
    storeQueued(arg, target.set, revision, queued);
    deps.pollNow(arg.backend);
    return failure === null ? { ok: true } : { problem: failure };
  }

  // Adds the queued builds' links and, for a set, its set run, in one synchronous block.
  function storeQueued(
    arg: QueueArg,
    set: BuildSetEntry | null,
    revision: string | null,
    queued: BuildRef[],
  ) {
    const now = clock.now();
    const setRun: SetRun | null =
      set === null
        ? null
        : {
            id: deps.randomHex(),
            setId: set.id,
            label: set.label,
            backendId: arg.backend,
            gameId: arg.game,
            sessionId: arg.sessionId,
            builds: queued,
            revision,
            createdAt: now,
            notified: false,
            endedAt: null,
          };
    if (setRun !== null) {
      store.addSetRun(setRun);
    }
    const setRunId = setRun?.id ?? null;
    if (arg.sessionId !== null) {
      const sessionId = arg.sessionId;
      store.addLinks(
        queued.map((ref): SessionLink => ({
          sessionId,
          backendId: ref.backendId,
          buildId: ref.buildId,
          setRunId,
          linkedAt: now,
          failingNotified: false,
          notified: false,
          endedAt: null,
        })),
      );
    }
    deps.stored();
  }

  async function offer(
    arg: { backend: string; game: string; kind: string; branch: string },
    sessionId: string,
  ): Promise<QueueingResult> {
    const found = find(arg.backend, arg.game);
    const target = targetOf(found.game, arg.kind);
    const revision = await readRevision(found, target, arg.branch);
    const clone = found.game.clone;
    const subject =
      clone !== null && revision !== null
        ? await git.commitSubject(clone, revision).catch(() => null)
        : null;
    store.setOffer(sessionId, {
      backendId: arg.backend,
      gameId: arg.game,
      kind: arg.kind,
      branch: arg.branch,
      revision,
      subject,
      createdAt: clock.now(),
    });
    deps.stored();
    return { ok: true };
  }

  async function queueOffer(sessionId: string): Promise<QueueingResult> {
    const offers = store.offers();
    if (!Object.hasOwn(offers, sessionId)) {
      throw new Error('no offer for this session');
    }
    const stored = offers[sessionId];
    const result = await queue({
      backend: stored.backendId,
      game: stored.gameId,
      kind: stored.kind,
      branch: stored.branch,
      sessionId,
      ...(stored.revision !== null && { revision: stored.revision }),
    });
    if ('ok' in result) {
      store.setOffer(sessionId, null);
      deps.stored();
    }
    return result;
  }

  async function branches(arg: {
    backend: string;
    game: string;
    set: string | null;
  }): Promise<GitRemoteHead[]> {
    const { game } = find(arg.backend, arg.game);
    const pattern = arg.set === null ? '*' : setOf(game, arg.set).branches;
    const heads = await headsOf(cloneOf(game), pattern);
    return [...heads].sort((a, b) => {
      const aIsDefault = a.name === game.defaultBranch;
      const bIsDefault = b.name === game.defaultBranch;
      if (aIsDefault !== bIsDefault) {
        return aIsDefault ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  async function cancel(arg: {
    backend: string;
    game: string;
    build: string;
  }): Promise<QueueingResult> {
    const { backend, instance, game } = find(arg.backend, arg.game);
    if (!instance.capabilities.cancel || instance.cancel === undefined) {
      throw new Error(`${backend.label} cannot cancel builds`);
    }
    await instance.cancel(game, arg.build);
    deps.pollNow(arg.backend);
    return { ok: true };
  }

  async function launchSetAgent(arg: {
    backend: string;
    game: string;
    set: string;
  }): Promise<QueueingResult> {
    const { game } = find(arg.backend, arg.game);
    const set = setOf(game, arg.set);
    const clone = cloneOf(game);
    if (set.agentPrompt === null) {
      throw new Error(`set "${set.id}" has no agentPrompt`);
    }
    const profile = deps.chat.defaultProfile(null);
    if (profile === null) {
      throw new Error('no profile to launch with');
    }
    const sessionId = await deps.chat.launch({
      projectDir: clone,
      profile,
      message: { text: set.agentPrompt, images: [] },
    });
    deps.log(`launched set agent ${set.id} of ${game.id}: ${sessionId}`);
    return { ok: true };
  }

  return {
    queue: (arg) => settled(() => queue(arg)),
    offer: (arg, sessionId) => settled(() => offer(arg, sessionId)),
    queueOffer: (sessionId) => settled(() => queueOffer(sessionId)),
    dismissOffer(sessionId) {
      if (Object.hasOwn(store.offers(), sessionId)) {
        store.setOffer(sessionId, null);
        deps.stored();
      }
      return { ok: true };
    },
    branches: (arg) => settled(() => branches(arg)),
    cancel: (arg) => settled(() => cancel(arg)),
    launchSetAgent: (arg) => settled(() => launchSetAgent(arg)),
  };
}

// `run`'s result, or a `{ problem }` with the text of what it threw.
async function settled<T>(
  run: () => Promise<T>,
): Promise<T | { problem: string }> {
  try {
    return await run();
  } catch (error) {
    return { problem: errorText(error) };
  }
}
