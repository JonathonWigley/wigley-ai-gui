import { describe, expect, it, vi } from 'vitest';
import type { Git } from '../../../contracts/git';
import { createMemoryFiles } from '../../../shared/memory-files';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type { ChatMainExports } from '../../chat/contract';
import type { BackendCapabilities, GameEntry } from '../contract';
import {
  backendEntry,
  buildOffer,
  createFixtureBackend,
  gameEntry,
} from '../contract.test-support';
import { createLinkStore } from './link-store';
import { createQueueing, type QueueingBackend } from './queueing';

const SHA = '2993a9e4c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6';
const flush = () => new Promise((settle) => setImmediate(settle));

// Backend `b1` with game `g1` (clone `/c`, kinds `dev` and `release`, set `rc` over both on `releases/x/*`), over a
// fixture backend, a memory store, a fake git whose origin holds `main`, and a fake chat.
function setup(
  options: {
    capabilities?: BackendCapabilities;
    game?: Partial<GameEntry>;
  } = {},
) {
  const backend = createFixtureBackend({ capabilities: options.capabilities });
  const game = gameEntry({
    id: 'g1',
    label: 'Game',
    clone: '/c',
    kinds: {
      dev: { label: 'Dev', target: 'dev' },
      release: { label: 'Release', target: 'release' },
    },
    sets: [
      {
        id: 'rc',
        label: 'RC set',
        kinds: ['dev', 'release'],
        branches: 'releases/x/*',
        agentPrompt: 'Make an RC set.',
      },
    ],
    ...options.game,
  });
  const found: { backend: QueueingBackend | null } = {
    backend: {
      label: 'Backend',
      entry: backendEntry({ id: 'b1', label: 'Backend', games: [game] }),
      instance: backend,
      problem: null,
    },
  };
  const store = createLinkStore(createMemoryFiles(), () => undefined);
  const git = {
    remoteHeads: vi.fn<Git['remoteHeads']>(async () => [
      { name: 'main', sha: SHA },
    ]),
    commitSubject: vi.fn<Git['commitSubject']>(async () => null),
  };
  const chat = {
    launch: vi.fn<ChatMainExports['launch']>(async () => 'agent-session'),
    defaultProfile: vi.fn<ChatMainExports['defaultProfile']>(() => 'work'),
  };
  const pollNow = vi.fn<(backendId: string) => void>();
  const queueing = createQueueing({
    backend: (id) => (id === 'b1' ? found.backend : null),
    store,
    git,
    clock: { now: () => 1000 },
    randomHex: () => 'run1',
    chat,
    pollNow,
    stored: () => undefined,
    log: () => undefined,
  });
  return { backend, found, store, git, chat, pollNow, queueing };
}

type Run = ReturnType<typeof setup>;

const devOnMain = {
  backend: 'b1',
  game: 'g1',
  kind: 'dev',
  branch: 'main',
  sessionId: 's1',
};
const rcOnRelease = { ...devOnMain, kind: 'rc', branch: 'releases/x/1' };

describe('createQueueing', () => {
  it.each([
    {
      case: 'no parsed backend with the id',
      call: (run: Run) => run.queueing.queue({ ...devOnMain, backend: 'nope' }),
      problem: 'no backend "nope"',
    },
    {
      case: 'the backend has no instance',
      prepare: (run: Run) => {
        run.found.backend = {
          label: 'Backend',
          entry: null,
          instance: null,
          problem: 'no cli',
        };
      },
      call: (run: Run) => run.queueing.queue(devOnMain),
      problem: 'Backend: no cli',
    },
    {
      case: 'the backend is still starting',
      prepare: (run: Run) => {
        run.found.backend = {
          label: 'Backend',
          entry: backendEntry({ id: 'b1', label: 'Backend' }),
          instance: null,
          problem: null,
        };
      },
      call: (run: Run) => run.queueing.queue(devOnMain),
      problem: 'Backend: still starting',
    },
    {
      case: 'no game with the id',
      call: (run: Run) => run.queueing.queue({ ...devOnMain, game: 'nope' }),
      problem: 'no game "nope" in Backend',
    },
    {
      case: 'neither a kind nor a set',
      call: (run: Run) => run.queueing.queue({ ...devOnMain, kind: 'qa' }),
      problem: 'no kind or set "qa" in Game',
    },
    {
      case: 'branches on a game with no clone',
      game: { clone: null },
      call: (run: Run) =>
        run.queueing.branches({ backend: 'b1', game: 'g1', set: null }),
      problem: 'Game names no clone',
    },
    {
      case: 'launchSetAgent on a game with no clone',
      game: { clone: null },
      call: (run: Run) =>
        run.queueing.launchSetAgent({ backend: 'b1', game: 'g1', set: 'rc' }),
      problem: 'Game names no clone',
    },
    {
      case: 'remoteHeads returned null',
      prepare: (run: Run) => run.git.remoteHeads.mockResolvedValue(null),
      call: (run: Run) => run.queueing.queue(devOnMain),
      problem: 'could not read the branches on origin of /c',
    },
    {
      case: 'the branch is not on origin',
      call: (run: Run) => run.queueing.queue({ ...devOnMain, branch: 'gone' }),
      problem: 'no branch "gone" on origin',
    },
    {
      case: "a set's branch outside its pattern",
      prepare: (run: Run) =>
        run.git.remoteHeads.mockResolvedValue([
          { name: 'releases/x/1', sha: SHA },
        ]),
      call: (run: Run) =>
        run.queueing.queue({ ...rcOnRelease, branch: 'main' }),
      problem: '"main" does not match the set\'s branches releases/x/*',
    },
    {
      case: 'cancel on a backend that cannot cancel',
      capabilities: { cancel: false, choosesBranch: true },
      call: (run: Run) =>
        run.queueing.cancel({ backend: 'b1', game: 'g1', build: 'x' }),
      problem: 'Backend cannot cancel builds',
    },
    {
      case: 'a set with no agentPrompt',
      game: {
        sets: [
          {
            id: 'rc',
            label: 'RC set',
            kinds: ['dev'],
            branches: 'releases/x/*',
            agentPrompt: null,
          },
        ],
      },
      call: (run: Run) =>
        run.queueing.launchSetAgent({ backend: 'b1', game: 'g1', set: 'rc' }),
      problem: 'set "rc" has no agentPrompt',
    },
    {
      case: 'no profile to launch with',
      prepare: (run: Run) => run.chat.defaultProfile.mockReturnValue(null),
      call: (run: Run) =>
        run.queueing.launchSetAgent({ backend: 'b1', game: 'g1', set: 'rc' }),
      problem: 'no profile to launch with',
    },
    {
      case: 'queueOffer with no offer stored',
      call: (run: Run) => run.queueing.queueOffer('s1'),
      problem: 'no offer for this session',
    },
    {
      case: 'backend.queue rejects',
      prepare: (run: Run) =>
        vi.spyOn(run.backend, 'queue').mockRejectedValue(new Error('offline')),
      call: (run: Run) => run.queueing.queue(devOnMain),
      problem: 'offline',
    },
    {
      case: 'cancel rejects',
      prepare: (run: Run) => {
        run.backend.cancel = () => Promise.reject(new Error('gone'));
      },
      call: (run: Run) =>
        run.queueing.cancel({ backend: 'b1', game: 'g1', build: 'x' }),
      problem: 'gone',
    },
    {
      case: 'launch rejects',
      prepare: (run: Run) =>
        run.chat.launch.mockRejectedValue(new Error('no harness')),
      call: (run: Run) =>
        run.queueing.launchSetAgent({ backend: 'b1', game: 'g1', set: 'rc' }),
      problem: 'no harness',
    },
  ])(
    '$case → $problem',
    async ({ capabilities, game, prepare, call, problem }) => {
      const run = setup({ capabilities, game });
      prepare?.(run);

      const result = await call(run);

      expect(result).toEqual({ problem });
      expect(run.backend.queued).toEqual([]);
    },
  );

  it('pins one revision across a set and links each build to the session', async () => {
    const run = setup();
    run.git.remoteHeads.mockResolvedValue([{ name: 'releases/x/1', sha: SHA }]);

    const result = await run.queueing.queue(rcOnRelease);

    expect(result).toEqual({ ok: true });
    expect(run.backend.queued).toEqual([
      {
        gameId: 'g1',
        request: { kind: 'dev', branch: 'releases/x/1', revision: SHA },
      },
      {
        gameId: 'g1',
        request: { kind: 'release', branch: 'releases/x/1', revision: SHA },
      },
    ]);
    expect(run.git.remoteHeads.mock.calls).toEqual([['/c', 'releases/x/*']]);
    const refs = [
      { backendId: 'b1', buildId: 'queued-1' },
      { backendId: 'b1', buildId: 'queued-2' },
    ];
    expect(run.store.setRuns()).toEqual([
      {
        id: 'run1',
        setId: 'rc',
        label: 'RC set',
        backendId: 'b1',
        gameId: 'g1',
        sessionId: 's1',
        builds: refs,
        revision: SHA,
        createdAt: 1000,
        notified: false,
        endedAt: null,
      },
    ]);
    expect(run.store.links()).toEqual(
      refs.map((ref) => ({
        sessionId: 's1',
        ...ref,
        setRunId: 'run1',
        linkedAt: 1000,
        failingNotified: false,
        notified: false,
        endedAt: null,
      })),
    );
    expect(run.pollNow.mock.calls).toEqual([['b1']]);
  });

  it('queues with no revision when the backend does not choose the branch', async () => {
    const run = setup({ capabilities: { cancel: true, choosesBranch: false } });

    await run.queueing.queue(devOnMain);

    expect(run.backend.queued.map(({ request }) => request.revision)).toEqual([
      null,
    ]);
    expect(run.git.remoteHeads).not.toHaveBeenCalled();
  });

  it('keeps the queued builds of a set whose second queue fails', async () => {
    const run = setup();
    run.git.remoteHeads.mockResolvedValue([{ name: 'releases/x/1', sha: SHA }]);
    const queueOnce = run.backend.queue;
    vi.spyOn(run.backend, 'queue')
      .mockImplementationOnce(queueOnce)
      .mockRejectedValueOnce(new Error('offline'));

    const result = await run.queueing.queue(rcOnRelease);

    expect(result).toEqual({ problem: 'queued 1 of 2: offline' });
    expect(run.store.setRuns().map((setRun) => setRun.builds)).toEqual([
      [{ backendId: 'b1', buildId: 'queued-1' }],
    ]);
  });

  it('stores nothing when the first queue of a set rejects', async () => {
    const run = setup();
    run.git.remoteHeads.mockResolvedValue([{ name: 'releases/x/1', sha: SHA }]);
    vi.spyOn(run.backend, 'queue').mockRejectedValueOnce(new Error('offline'));

    const result = await run.queueing.queue(rcOnRelease);

    expect(result).toEqual({ problem: 'offline' });
    expect(run.store.setRuns()).toEqual([]);
    expect(run.store.links()).toEqual([]);
  });

  it('adds the set run and its links together after the last queue', async () => {
    const run = setup();
    run.git.remoteHeads.mockResolvedValue([{ name: 'releases/x/1', sha: SHA }]);
    const calls: ReturnType<typeof deferred<{ id: string }>>[] = [];
    vi.spyOn(run.backend, 'queue').mockImplementation(() => {
      const call = deferred<{ id: string }>();
      calls.push(call);
      return call.promise;
    });

    const result = run.queueing.queue(rcOnRelease);
    await flush();
    calls[0].resolve({ id: 'a' });
    await flush();
    expect([run.store.setRuns(), run.store.links()]).toEqual([[], []]);
    calls[1].resolve({ id: 'b' });
    await result;

    expect(run.store.setRuns().map((setRun) => setRun.builds)).toEqual([
      [
        { backendId: 'b1', buildId: 'a' },
        { backendId: 'b1', buildId: 'b' },
      ],
    ]);
    expect(run.store.links().map((link) => link.buildId)).toEqual(['a', 'b']);
  });

  it('stores an offer with its revision and subject and replaces the last', async () => {
    const run = setup();
    run.git.commitSubject.mockResolvedValue('Fix the menu');
    const offerArg = { backend: 'b1', game: 'g1', kind: 'dev', branch: 'main' };

    await run.queueing.offer(offerArg, 's1');
    expect(run.store.offers().s1).toMatchObject({
      revision: SHA,
      subject: 'Fix the menu',
    });
    await run.queueing.offer({ ...offerArg, kind: 'release' }, 's1');

    expect(Object.keys(run.store.offers())).toEqual(['s1']);
    expect(run.store.offers().s1.kind).toBe('release');
  });

  it('stores an offer with no subject when the subject read rejects', async () => {
    const run = setup();
    run.git.commitSubject.mockRejectedValue(new Error('bad object'));

    const result = await run.queueing.offer(
      { backend: 'b1', game: 'g1', kind: 'dev', branch: 'main' },
      's1',
    );

    expect(result).toEqual({ ok: true });
    expect(run.store.offers().s1).toMatchObject({
      revision: SHA,
      subject: null,
    });
  });

  it('refuses a second queueOffer while the first is in flight', async () => {
    const run = setup();
    run.store.setOffer(
      's1',
      buildOffer({ backendId: 'b1', gameId: 'g1', revision: SHA }),
    );
    const queued = deferred<{ id: string }>();
    vi.spyOn(run.backend, 'queue').mockReturnValueOnce(queued.promise);

    const first = run.queueing.queueOffer('s1');
    const second = await run.queueing.queueOffer('s1');
    queued.resolve({ id: 'a' });

    expect(second).toEqual({ problem: 'the offer is already queueing' });
    expect(await first).toEqual({ ok: true });
    expect(run.store.links().map((link) => link.buildId)).toEqual(['a']);
  });

  it('dismisses an offer, and a missing offer is no problem', () => {
    const run = setup();
    run.store.setOffer('s1', buildOffer());

    run.queueing.dismissOffer('s1');
    expect(run.store.offers()).toEqual({});

    expect(run.queueing.dismissOffer('s1')).toEqual({ ok: true });
  });

  it('cancels through the backend, then polls now', async () => {
    const run = setup();
    const cancelledAtPoll: number[] = [];
    run.pollNow.mockImplementation(() => {
      cancelledAtPoll.push(run.backend.cancelled.length);
    });

    const result = await run.queueing.cancel({
      backend: 'b1',
      game: 'g1',
      build: 'x',
    });

    expect(result).toEqual({ ok: true });
    expect(run.backend.cancelled).toEqual([{ gameId: 'g1', buildId: 'x' }]);
    expect(run.pollNow.mock.calls).toEqual([['b1']]);
    expect(cancelledAtPoll).toEqual([1]);
  });

  it('queues an offer on its own revision and then drops it', async () => {
    const run = setup();
    run.store.setOffer(
      's1',
      buildOffer({ backendId: 'b1', gameId: 'g1', revision: SHA }),
    );

    const result = await run.queueing.queueOffer('s1');

    expect(result).toEqual({ ok: true });
    expect(run.backend.queued.map(({ request }) => request.revision)).toEqual([
      SHA,
    ]);
    expect(run.git.remoteHeads).not.toHaveBeenCalled();
    expect(run.store.offers()).toEqual({});
  });

  it('lists branches with the default branch first', async () => {
    const run = setup();
    run.git.remoteHeads.mockResolvedValue([
      { name: 'b', sha: '1' },
      { name: 'main', sha: '2' },
      { name: 'a', sha: '3' },
    ]);

    const heads = await run.queueing.branches({
      backend: 'b1',
      game: 'g1',
      set: null,
    });

    expect(Array.isArray(heads) && heads.map(({ name }) => name)).toEqual([
      'main',
      'a',
      'b',
    ]);
  });

  it('launches the set agent in the clone with its prompt', async () => {
    const run = setup();

    await run.queueing.launchSetAgent({ backend: 'b1', game: 'g1', set: 'rc' });

    expect(run.chat.launch).toHaveBeenCalledWith({
      projectDir: '/c',
      profile: 'work',
      message: { text: 'Make an RC set.', images: [] },
    });
  });
});
