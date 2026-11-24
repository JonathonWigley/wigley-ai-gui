import { describe, expect, it, vi } from 'vitest';
import type { FileStat } from '../../../contracts/files';
import type { Git } from '../../../contracts/git';
import {
  deferred,
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import { sessionsRowsSlot } from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import type { SessionLink, SetRun } from '../builds-model';
import {
  type BackendKind,
  type BuildBackend,
  type BuildRecord,
  type BuildsMainExports,
  buildsDownloadsSlot,
  buildsSessionsSlot,
  buildsSnapshotSlot,
} from '../contract';
import {
  buildJob,
  buildRecord,
  createFixtureBackend,
  type FixtureBackend,
  fixtureBackendKind,
} from '../contract.test-support';
import { buildsManifest } from '../manifest';
import { FILE_CHECK_TIMEOUT_MS } from './downloads';
import { LINKS_FILE, PRUNE_AFTER_MS } from './link-store';
import { FAST_POLL_MS, SLOW_POLL_MS } from './poller';
import { createBuildsMainPart } from './start';
import { DRAIN_TIMEOUT_MS } from './tracked-backend';

const SHA = '2993a9e4c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6';
const LINKS_PATH = `/data/builds/${LINKS_FILE}`;
const STILL_WAITING = `b1: replaced instance still busy after ${DRAIN_TIMEOUT_MS} ms; waiting for its calls to settle`;

const settle = async () => {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

function gameSetting(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    label: 'Game',
    defaultBranch: 'main',
    kinds: { dev: { label: 'Dev', target: 'dev' } },
    ...overrides,
  };
}

function backendSetting(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    kind: 'fixture',
    label: 'Backend',
    config: {},
    games: [gameSetting()],
    ...overrides,
  };
}

function settingsWith(backends: unknown[]) {
  return { ...buildsManifest.settings, backends };
}

function sessionLink(overrides: Partial<SessionLink> = {}): SessionLink {
  return {
    sessionId: 's1',
    backendId: 'b1',
    buildId: 'x',
    setRunId: null,
    linkedAt: 0,
    failingNotified: false,
    notified: false,
    endedAt: null,
    ...overrides,
  };
}

function setRun(overrides: Partial<SetRun> = {}): SetRun {
  return {
    id: 'r1',
    setId: 'rc',
    label: 'RC set',
    backendId: 'b1',
    gameId: 'g1',
    sessionId: 's1',
    builds: [
      { backendId: 'b1', buildId: 'x' },
      { backendId: 'b1', buildId: 'z' },
    ],
    revision: null,
    createdAt: 0,
    notified: false,
    endedAt: null,
    ...overrides,
  };
}

// A `fixture` kind that makes a fixture backend per create, held in `instances`; the first one's lists wait on `listed`.
function hangingFirstListKind() {
  const listed = deferred<BuildRecord[]>();
  const instances: FixtureBackend[] = [];
  const kind: BackendKind = {
    kind: 'fixture',
    label: 'Fixture',
    async create() {
      const made = createFixtureBackend();
      if (instances.length === 0) {
        vi.spyOn(made, 'list').mockReturnValue(listed.promise);
      }
      instances.push(made);
      return made;
    },
  };
  return { kind, instances, listed };
}

interface StartOptions {
  backends?: unknown[];
  // The kinds added through the exports before `ready`; the fixture kind `fixture` over the run's fixture when left out.
  kinds?: (fixture: FixtureBackend) => BackendKind[];
  linksFile?: object;
  // Every file write rejects from just before the restart that reads `linksFile`, so every write after the load rejects.
  failWrites?: boolean;
  restored?: Promise<void>;
  rows?: string[];
  git?: Partial<Git>;
  revealPath?: (path: string) => void;
}

// A new part under test, so no drain outlives its test, with one fixture backend `b1` of game `g1`, a fake chat, and
// a row for `s1`. A `linksFile` is written and read by a restart. `ready` lets the part's `ready` finish: chat's
// `restored` waits for it, and for `restored` when given.
async function startOnHarness(options: StartOptions = {}) {
  const fixture = createFixtureBackend();
  const gate = deferred<void>();
  const chat = {
    send: vi.fn<ChatMainExports['send']>(async () => undefined),
    launch: vi.fn<ChatMainExports['launch']>(async () => 'launched'),
    defaultProfile: vi.fn<ChatMainExports['defaultProfile']>(() => 'work'),
    restored: async () => {
      await gate.promise;
      await options.restored;
    },
  };
  const harness = startMainPart(createBuildsMainPart(), {
    dependencies: [
      fakeDependency(chatMainKey, () => chat as unknown as ChatMainExports),
    ],
    settings: settingsWith(options.backends ?? [backendSetting()]),
    services: {
      ...(options.git && { git: options.git as Git }),
      ...(options.revealPath && { revealPath: options.revealPath }),
    },
  });
  const rows = harness.state.publish(sessionsRowsSlot);
  for (const sessionId of options.rows ?? ['s1']) {
    rows.set(sessionId, sessionRow(sessionId));
  }
  if (options.linksFile === undefined) {
    harness.ready();
  } else {
    await harness.files.write(LINKS_PATH, JSON.stringify(options.linksFile));
    if (options.failWrites) {
      vi.spyOn(harness.files, 'write').mockRejectedValue(
        new Error('disk full'),
      );
    }
    await harness.restart();
  }
  const exportsOf = () =>
    harness.started().exports?.(createRegistrations()) as BuildsMainExports;
  const addKind = (kind: BackendKind) => exportsOf().addBackend(kind);
  const kinds = options.kinds?.(fixture) ?? [
    fixtureBackendKind('fixture', fixture),
  ];
  for (const kind of kinds) {
    addKind(kind);
  }
  const snapshot = () => harness.state.read(buildsSnapshotSlot, 'test').get();
  return {
    harness,
    fixture,
    chat,
    rows,
    addKind,
    snapshot,
    backendView: () => snapshot()?.backends[0],
    gameBuilds: () =>
      snapshot()?.backends[0]?.games[0]?.builds.map((build) => build.id),
    ready: async () => {
      gate.resolve();
      await settle();
    },
    advance: async (ms: number) => {
      harness.advance(ms);
      await settle();
    },
    pushBackends: async (backends: unknown[]) => {
      harness.pushSettings(settingsWith(backends));
      await settle();
    },
    logged: (message: string) =>
      harness.logs.filter((line) => line.message === message).length,
    file: async () =>
      JSON.parse(await harness.files.read(LINKS_PATH)) as {
        links: SessionLink[];
        setRuns: SetRun[];
      },
  };
}

const finishedX = buildRecord({
  id: 'x',
  gameId: 'g1',
  state: 'finished',
  result: 'success',
  finishedAt: 50,
});

// Game `g1` whose `dev` kind has one download, `Android zip` at `path`.
function gameWithDownload(path = '/d/{number}.zip') {
  return gameSetting({
    kinds: {
      dev: {
        label: 'Dev',
        target: 'dev',
        downloads: [{ label: 'Android zip', path }],
      },
    },
  });
}

const numberedX = buildRecord({ ...finishedX, number: '332' });
const listedX = { backend: 'b1', game: 'g1', build: 'x' };

// A kind `slow` whose `create` never settles, so its entry never gets an instance.
const SLOW_KIND: BackendKind = {
  kind: 'slow',
  label: 'Slow',
  create: () => new Promise<BuildBackend>(() => undefined),
};

describe('buildsMainPart', () => {
  it('applies the setting at ready, after a kind added at start', async () => {
    const run = await startOnHarness();
    expect(run.snapshot()).toEqual({ backends: [], polledAt: null });

    await run.ready();

    expect(run.backendView()).toMatchObject({
      id: 'b1',
      problem: null,
      capabilities: { cancel: true, choosesBranch: true, saveLog: false },
    });
  });

  it('creates a backend when its kind is added later', async () => {
    const run = await startOnHarness({
      backends: [backendSetting({ kind: 'late' })],
    });
    await run.ready();
    expect(run.backendView()?.problem).toBe(
      'no backend kind "late": its plugin is off or missing',
    );
    const late = createFixtureBackend();

    run.addKind(fixtureBackendKind('late', late));
    await settle();

    expect(run.backendView()?.problem).toBeNull();
    expect(late.listCalls).toHaveLength(1);
  });

  it('re-applies when a kind is removed, disposing its instance', async () => {
    const run = await startOnHarness({ kinds: () => [] });
    await run.ready();
    const added = run.addKind(fixtureBackendKind('fixture', run.fixture));
    await settle();
    expect(run.backendView()?.problem).toBeNull();

    added.dispose();
    await settle();

    expect(run.fixture.disposed).toBe(true);
    expect(run.backendView()?.problem).toBe(
      'no backend kind "fixture": its plugin is off or missing',
    );
  });

  it.each([
    { case: 'its create awaits', isReapplied: false },
    { case: 'its replaced instance drains', isReapplied: true },
  ])(
    'refuses a queue while the backend is still starting: $case',
    async ({ isReapplied }) => {
      const created = deferred<BuildBackend>();
      const games = [gameSetting(), gameSetting()];
      const run = await startOnHarness({
        backends: [backendSetting({ games })],
        kinds: () => [
          isReapplied
            ? hangingFirstListKind().kind
            : { kind: 'fixture', label: 'Slow', create: () => created.promise },
        ],
      });
      await run.ready();
      if (isReapplied) {
        await run.pushBackends([
          backendSetting({ games, config: { next: 1 } }),
        ]);
      }

      await expect(
        run.harness.started().commands.queue({
          arg: { backend: 'b1', game: 'g1', kind: 'dev', branch: 'main' },
        }),
      ).rejects.toThrow('builds.queue: Backend: still starting');
    },
  );

  it.each([
    {
      case: 'the old list settles before the bound',
      replace: 'apply',
      waited: DRAIN_TIMEOUT_MS - 1,
      newLists: [1],
      logs: 0,
    },
    {
      case: 'after the bound, it logs and still waits',
      replace: 'apply',
      waited: DRAIN_TIMEOUT_MS,
      newLists: [1],
      logs: 1,
    },
    {
      case: 'the part stopped during the drain creates nothing and logs nothing',
      replace: 'stop',
      waited: DRAIN_TIMEOUT_MS,
      newLists: [],
      logs: 0,
    },
    {
      case: 'a restarted part over the same data waits too',
      replace: 'restart',
      waited: DRAIN_TIMEOUT_MS,
      newLists: [1],
      logs: 1,
    },
  ])(
    'creates a replaced entry only once its old list settles: $case',
    async ({ replace, waited, newLists, logs }) => {
      const hanging = hangingFirstListKind();
      const run = await startOnHarness({ kinds: () => [hanging.kind] });
      await run.ready();

      if (replace === 'restart') {
        await run.harness.restart();
        run.addKind(hanging.kind);
        await settle();
      } else {
        await run.pushBackends([backendSetting({ label: 'Second' })]);
      }
      if (replace === 'stop') {
        await run.harness.stop();
      }
      await run.advance(waited);
      expect(hanging.instances).toHaveLength(1);
      hanging.listed.resolve([]);
      await settle();

      expect(
        hanging.instances.slice(1).map((each) => each.listCalls.length),
      ).toEqual(newLists);
      expect(run.logged(STILL_WAITING)).toBe(logs);
    },
  );

  it("marks a game listed once the entry's current instance lists it", async () => {
    const run = await startOnHarness();
    const listed = () => run.snapshot()?.backends[0]?.games[0]?.listed;
    const firstList = deferred<BuildRecord[]>();
    const list = vi
      .spyOn(run.fixture, 'list')
      .mockImplementationOnce(() => firstList.promise);

    await run.ready();
    expect(listed()).toBe(false);
    firstList.resolve([]);
    await settle();
    expect(listed()).toBe(true);
    list.mockImplementationOnce(() => new Promise(() => undefined));
    await run.pushBackends([backendSetting({ label: 'Second' })]);

    expect(listed()).toBe(false);
  });

  it('ends no set run and prunes nothing before its game first lists', async () => {
    const pastPrune = -PRUNE_AFTER_MS - 1;
    const run = await startOnHarness({
      linksFile: {
        setRuns: [setRun({ createdAt: pastPrune })],
        links: [sessionLink({ buildId: 'y', linkedAt: pastPrune })],
      },
    });
    vi.spyOn(run.fixture, 'list').mockImplementation(
      () => new Promise<ReturnType<typeof buildRecord>[]>(() => undefined),
    );

    await run.ready();

    expect(run.chat.send).not.toHaveBeenCalled();
    const file = await run.file();
    expect(file.setRuns.map(({ notified }) => notified)).toEqual([false]);
    expect(file.links.map(({ buildId }) => buildId)).toEqual(['y']);
  });

  it('tells a missed ending once, writing the flag first', async () => {
    const run = await startOnHarness({
      linksFile: { links: [sessionLink()] },
    });
    run.fixture.setBuilds('g1', [finishedX]);
    const notifiedAtSend: boolean[] = [];
    run.chat.send.mockImplementation(async () => {
      notifiedAtSend.push((await run.file()).links[0].notified);
    });

    await run.ready();
    await run.advance(SLOW_POLL_MS);

    expect(run.chat.send).toHaveBeenCalledTimes(1);
    expect(run.chat.send.mock.calls[0][1].text).toMatch(/^Build ended:/);
    expect(notifiedAtSend).toEqual([true]);
  });

  it.each([
    {
      case: 'a build',
      link: sessionLink(),
      setRuns: [],
      heading: /^Build ended:/,
      isStalled: false,
    },
    {
      case: 'a set',
      link: sessionLink({ setRunId: 'r1' }),
      setRuns: [setRun({ builds: [{ backendId: 'b1', buildId: 'x' }] })],
      heading: /^Set ended:/,
      isStalled: false,
    },
    {
      case: 'a check that never settles, sent past the bound without the file',
      link: sessionLink(),
      setRuns: [],
      heading: /^Build ended:/,
      isStalled: true,
    },
  ])(
    'waits for the file check of the poll an end message comes from: $case',
    async ({ link, setRuns, heading, isStalled }) => {
      const zipPath = '/d/332.zip';
      const run = await startOnHarness({
        backends: [backendSetting({ games: [gameWithDownload()] })],
        linksFile: { links: [link], setRuns },
      });
      run.fixture.setBuilds('g1', [
        { ...numberedX, state: 'running', result: null, finishedAt: null },
      ]);
      await run.ready();
      const { files } = run.harness;
      const realStat = files.stat.bind(files);
      const held = deferred<FileStat | null>();
      let zipStats = 0;
      // The zip's first `stat` from here waits on `held`, or every one never settles when stalled.
      vi.spyOn(files, 'stat').mockImplementation((path) => {
        if (path !== zipPath) {
          return realStat(path);
        }
        zipStats += 1;
        if (isStalled) {
          return new Promise<FileStat | null>(() => undefined);
        }
        return zipStats === 1 ? held.promise : realStat(path);
      });
      run.fixture.setBuilds('g1', [numberedX]);
      await files.write(zipPath, 'zip');

      await run.advance(FAST_POLL_MS);
      if (isStalled) {
        // The poll's check gives up, then the fresh check the wait starts.
        await run.advance(FILE_CHECK_TIMEOUT_MS);
        await run.advance(FILE_CHECK_TIMEOUT_MS);
      } else {
        held.resolve({ isFolder: false, isLink: false });
        await settle();
      }

      expect(run.chat.send).toHaveBeenCalledTimes(1);
      const { text } = run.chat.send.mock.calls[0][1];
      expect(text).toMatch(heading);
      expect(text.includes(`Files: Android zip ${zipPath}`)).toBe(!isStalled);
    },
  );

  it('sends nothing when the flag write fails', async () => {
    const run = await startOnHarness({
      linksFile: { links: [sessionLink()] },
      failWrites: true,
    });
    run.fixture.setBuilds('g1', [finishedX]);

    await run.ready();

    expect(run.chat.send).not.toHaveBeenCalled();
    expect(run.logged('ended b1/x for s1: not written, not sent')).toBe(1);
  });

  it('sends to no session without a row', async () => {
    const run = await startOnHarness({
      linksFile: { links: [sessionLink({ sessionId: 's9' })] },
    });
    run.fixture.setBuilds('g1', [finishedX]);

    await run.ready();

    expect(run.chat.send).not.toHaveBeenCalled();
    expect(run.logged('ended b1/x for s9: no session row, not sent')).toBe(1);
  });

  it('polls fast while shown', async () => {
    const run = await startOnHarness();
    await run.ready();
    expect(run.fixture.listCalls).toHaveLength(1);

    run.harness.invoke('setShown', true);
    await settle();
    expect(run.fixture.listCalls).toHaveLength(2);
    await run.advance(FAST_POLL_MS - 1);
    expect(run.fixture.listCalls).toHaveLength(2);
    await run.advance(1);

    expect(run.fixture.listCalls).toHaveLength(3);
  });

  it('refuses an offer with no calling session', async () => {
    const run = await startOnHarness();
    await run.ready();

    await expect(
      run.harness.started().commands.offer({
        arg: { backend: 'b1', game: 'g1', kind: 'dev', branch: 'main' },
      }),
    ).rejects.toThrow('builds.offer: no calling session');
  });

  it('keeps the last good builds through a rejected list or create', async () => {
    const run = await startOnHarness({
      kinds: (fixture) => [
        fixtureBackendKind('fixture', fixture),
        {
          kind: 'broken',
          label: 'Broken',
          create: () => Promise.reject(new Error('boom')),
        },
      ],
    });
    run.fixture.setBuilds('g1', [buildRecord({ id: 'x', gameId: 'g1' })]);
    await run.ready();

    run.fixture.failLists(new Error('offline'));
    await run.advance(SLOW_POLL_MS);
    expect(run.gameBuilds()).toEqual(['x']);
    expect(run.backendView()?.problem).toBe('Game: offline');
    run.fixture.failLists(null);
    await run.advance(SLOW_POLL_MS);
    await run.pushBackends([backendSetting({ kind: 'broken' })]);

    expect(run.backendView()?.problem).toBe('create failed: boom');
    expect(run.gameBuilds()).toEqual(['x']);
  });

  it('does nothing for a registry or settings change before ready', async () => {
    const create = vi.fn(async () => createFixtureBackend());
    const run = await startOnHarness({
      backends: [backendSetting({ kind: 'late' })],
      kinds: () => [],
    });

    run.addKind({ kind: 'late', label: 'Late', create });
    await run.pushBackends([backendSetting({ kind: 'late', label: 'Other' })]);

    expect(create).not.toHaveBeenCalled();
    expect(run.snapshot()).toEqual({ backends: [], polledAt: null });
  });

  it('waits for chat to restore its rows before the first fold', async () => {
    const restored = deferred<void>();
    const run = await startOnHarness({
      linksFile: { links: [sessionLink()] },
      restored: restored.promise,
      rows: [],
    });
    run.fixture.setBuilds('g1', [finishedX]);

    await run.ready();
    run.rows.set('s1', sessionRow('s1'));
    restored.resolve();
    await settle();

    expect(run.chat.send).toHaveBeenCalledTimes(1);
    expect(run.chat.send.mock.calls[0][1].text).toMatch(/^Build ended:/);
  });

  it('applies nothing for a layout-only settings change', async () => {
    const run = await startOnHarness();
    await run.ready();

    run.harness.pushSettings({
      backends: [backendSetting()],
      layout: 'compact',
    });
    await settle();

    expect(run.fixture.disposed).toBe(false);
    expect(
      run.harness.logs.filter((line) =>
        line.message.startsWith('backends applied:'),
      ),
    ).toHaveLength(1);
  });

  it('disposes a create that settles after stop', async () => {
    const created = deferred<BuildBackend>();
    const run = await startOnHarness({
      kinds: () => [
        { kind: 'fixture', label: 'Slow', create: () => created.promise },
      ],
    });
    await run.ready();

    await run.harness.stop();
    const late = createFixtureBackend();
    late.setBuilds('g1', [buildRecord({ id: 'x', gameId: 'g1' })]);
    created.resolve(late);
    await settle();

    expect(late.disposed).toBe(true);
    expect(late.listCalls).toEqual([]);
  });

  it('drops an apply that a later apply overtook', async () => {
    const creates: ReturnType<typeof deferred<BuildBackend>>[] = [];
    const run = await startOnHarness({
      kinds: () => [
        {
          kind: 'fixture',
          label: 'Deferred',
          create: () => {
            const created = deferred<BuildBackend>();
            creates.push(created);
            return created.promise;
          },
        },
      ],
    });
    await run.ready();

    await run.pushBackends([backendSetting({ label: 'Second' })]);
    creates[1].resolve(createFixtureBackend());
    await settle();
    const first = createFixtureBackend();
    creates[0].resolve(first);
    await settle();

    expect(first.disposed).toBe(true);
    expect(run.backendView()?.label).toBe('Second');
  });

  it('drops a poll that an apply overtook', async () => {
    const run = await startOnHarness();
    const listed = deferred<ReturnType<typeof buildRecord>[]>();
    // The poll after the apply never settles, so only the overtaken one can write the records.
    vi.spyOn(run.fixture, 'list')
      .mockImplementation(
        () => new Promise<ReturnType<typeof buildRecord>[]>(() => undefined),
      )
      .mockImplementationOnce(() => listed.promise);
    await run.ready();

    await run.pushBackends([backendSetting({ label: 'Second' })]);
    listed.resolve([buildRecord({ id: 'x', gameId: 'g1' })]);
    await settle();

    expect(run.gameBuilds()).toEqual([]);
  });

  it.each([
    {
      case: 'cache hit',
      subject: () => Promise.resolve<string | null>('Fix the menu'),
      apart: SLOW_POLL_MS,
      calls: 1,
      logs: 0,
      subjects: { [SHA]: 'Fix the menu' },
    },
    {
      case: 'null inside the window',
      subject: () => Promise.resolve(null),
      apart: FAST_POLL_MS,
      calls: 1,
      logs: 0,
      subjects: {},
    },
    {
      case: 'null after the window',
      subject: () => Promise.resolve(null),
      apart: SLOW_POLL_MS,
      calls: 2,
      logs: 0,
      subjects: {},
    },
    {
      case: 'rejection',
      subject: () => Promise.reject(new Error('bad object')),
      apart: SLOW_POLL_MS,
      calls: 2,
      logs: 1,
      subjects: {},
    },
  ])('subjects: $case', async ({ subject, apart, calls, logs, subjects }) => {
    const commitSubject = vi.fn<Git['commitSubject']>(subject);
    const run = await startOnHarness({
      backends: [backendSetting({ games: [gameSetting({ clone: '/c' })] })],
      git: { commitSubject },
    });
    run.fixture.setBuilds('g1', [
      buildRecord({ id: 'x', gameId: 'g1', revision: SHA }),
    ]);
    if (apart === FAST_POLL_MS) {
      run.harness.invoke('setShown', true);
    }

    await run.ready();
    await run.advance(apart);

    expect(commitSubject).toHaveBeenCalledTimes(calls);
    expect(run.logged('commit subject failed: bad object')).toBe(logs);
    expect(run.snapshot()?.backends[0]?.games[0]?.subjects).toEqual(subjects);
  });

  it.each([
    {
      case: 'parsed, then instance',
      create: () => Promise.resolve({ problem: 'no cli' }),
      failure: null,
      thenLists: false,
      problem: 'duplicate game id "g1"; no cli',
    },
    {
      case: 'parsed, then game failure',
      create: null,
      failure: new Error('offline'),
      thenLists: false,
      problem: 'duplicate game id "g1"; Game: offline',
    },
    {
      case: 'a good list clears the failure',
      create: null,
      failure: new Error('offline'),
      thenLists: true,
      problem: 'duplicate game id "g1"',
    },
    {
      case: 'none',
      create: null,
      failure: null,
      thenLists: false,
      problem: null,
      oneGame: true,
    },
  ])(
    'heading problem: $case',
    async ({ create, failure, thenLists, problem, oneGame }) => {
      const games = oneGame ? [gameSetting()] : [gameSetting(), gameSetting()];
      const run = await startOnHarness({
        backends: [backendSetting({ games })],
        kinds: (fixture) => [
          create === null
            ? fixtureBackendKind('fixture', fixture)
            : { kind: 'fixture', label: 'Fixture', create },
        ],
      });
      run.fixture.failLists(failure);

      await run.ready();
      if (thenLists) {
        run.fixture.failLists(null);
        await run.advance(SLOW_POLL_MS);
      }

      expect(run.backendView()?.problem).toBe(problem);
    },
  );

  it.each([
    {
      case: 'a live instance with a parse problem and a list failure',
      setting: backendSetting({ games: [gameSetting(), gameSetting()] }),
      kind: null,
      neverLists: false,
    },
    {
      case: 'an instance still starting',
      setting: backendSetting({ kind: 'slow' }),
      kind: SLOW_KIND,
      neverLists: false,
    },
    {
      case: 'a create that answers a problem',
      setting: backendSetting(),
      kind: {
        kind: 'fixture',
        label: 'Fixture',
        create: () => Promise.resolve({ problem: 'no cli' }),
      },
      neverLists: true,
    },
    {
      case: 'a kind that is off',
      setting: backendSetting({ kind: 'off' }),
      kind: null,
      neverLists: true,
    },
    {
      case: 'an entry that does not parse',
      setting: backendSetting({ id: 5 }),
      kind: null,
      neverLists: true,
    },
  ])('never lists: $case', async ({ setting, kind, neverLists }) => {
    const run = await startOnHarness({
      backends: [setting],
      kinds: (fixture) => [kind ?? fixtureBackendKind('fixture', fixture)],
    });
    run.fixture.failLists(new Error('offline'));

    await run.ready();

    expect(run.backendView()?.neverLists).toBe(neverLists);
  });

  it('tells a failing build once, writing the flag first', async () => {
    const run = await startOnHarness({
      linksFile: { links: [sessionLink()] },
    });
    run.fixture.setBuilds('g1', [
      buildRecord({
        id: 'x',
        gameId: 'g1',
        state: 'running',
        result: null,
        jobs: [
          buildJob({
            id: 'ios',
            label: 'iOS build',
            result: 'failure',
            stepText: 'Archive failed',
          }),
        ],
      }),
    ]);

    await run.ready();
    expect(run.chat.send).toHaveBeenCalledTimes(1);
    expect(run.chat.send.mock.calls[0][1].text).toMatch(/^Build failing:/);
    expect((await run.file()).links[0].failingNotified).toBe(true);
    await run.advance(SLOW_POLL_MS);

    expect(run.chat.send).toHaveBeenCalledTimes(1);
  });

  it('marks a set run and its links told when the set ends', async () => {
    const run = await startOnHarness({
      linksFile: {
        setRuns: [setRun()],
        links: [
          sessionLink({ buildId: 'x', setRunId: 'r1' }),
          sessionLink({ buildId: 'z', setRunId: 'r1' }),
        ],
      },
    });
    run.fixture.setBuilds('g1', [
      buildRecord({ id: 'z', gameId: 'g1', finishedAt: 300 }),
      buildRecord({ id: 'x', gameId: 'g1', finishedAt: 100 }),
    ]);

    await run.ready();

    expect(run.chat.send).toHaveBeenCalledTimes(1);
    expect(run.chat.send.mock.calls[0][1].text).toMatch(/^Set ended:/);
    const file = await run.file();
    expect(file.setRuns[0]).toMatchObject({ notified: true, endedAt: 300 });
    expect(
      file.links.map(({ notified, endedAt }) => ({ notified, endedAt })),
    ).toEqual([
      { notified: true, endedAt: 300 },
      { notified: true, endedAt: 300 },
    ]);
  });

  it('sends and logs nothing for a set run with no session', async () => {
    const run = await startOnHarness({
      linksFile: { setRuns: [setRun({ sessionId: null })] },
    });
    run.fixture.setBuilds('g1', [
      buildRecord({ id: 'z', gameId: 'g1', finishedAt: 300 }),
      buildRecord({ id: 'x', gameId: 'g1', finishedAt: 100 }),
    ]);

    await run.ready();

    expect(run.chat.send).not.toHaveBeenCalled();
    expect(
      run.harness.logs.filter((line) => line.message.includes('set ended')),
    ).toEqual([]);
    expect((await run.file()).setRuns[0].notified).toBe(true);
  });

  it('passes the caller to the queue command and throws its problem', async () => {
    const run = await startOnHarness();
    await run.ready();
    const { queue } = run.harness.started().commands;
    const arg = { backend: 'b1', game: 'g1', kind: 'dev', branch: 'main' };
    const sessions = () =>
      run.harness.state.read(buildsSessionsSlot, 'test').all();

    await queue({ arg, callerSessionId: 's1' });
    await settle();
    expect(sessions().get('s1')?.builds).toEqual([
      { backendId: 'b1', buildId: 'queued-1' },
    ]);
    await queue({ arg });
    await settle();
    expect((await run.file()).links).toHaveLength(1);

    await expect(queue({ arg: { ...arg, game: 'nope' } })).rejects.toThrow(
      'builds.queue: no game "nope" in Backend',
    );
  });

  it('checks, downloads and reveals a build file through the channel', async () => {
    const revealed: string[] = [];
    const run = await startOnHarness({
      backends: [backendSetting({ games: [gameWithDownload()] })],
      revealPath: (path) => revealed.push(path),
    });
    run.fixture.setBuilds('g1', [numberedX]);
    await run.harness.files.write('/d/332.zip', 'zip');

    await run.ready();
    expect(run.snapshot()?.backends[0]?.games[0]?.files).toEqual({
      x: [{ label: 'Android zip', path: '/d/332.zip', entry: 0 }],
    });
    await expect(
      run.harness.invoke('download', {
        backend: 'b1',
        game: 'g1',
        build: 'x',
        file: 0,
      }),
    ).resolves.toEqual({ ok: true });
    await settle();

    expect(
      run.harness.state.read(buildsDownloadsSlot, 'test').get('b1/x/file/0'),
    ).toMatchObject({ state: 'saved', path: '/home/Downloads/332.zip' });
    expect(revealed).toEqual(['/home/Downloads/332.zip']);
  });

  it('downloads a listed file while its backend has no instance', async () => {
    const backends = [backendSetting({ games: [gameWithDownload()] })];
    const run = await startOnHarness({
      backends,
      kinds: (fixture) => [fixtureBackendKind('fixture', fixture), SLOW_KIND],
    });
    run.fixture.setBuilds('g1', [numberedX]);
    await run.harness.files.write('/d/332.zip', 'zip');
    await run.ready();
    await run.pushBackends([
      backendSetting({ kind: 'slow', games: [gameWithDownload()] }),
    ]);

    await expect(
      run.harness.invoke('download', { ...listedX, file: 0 }),
    ).resolves.toEqual({ ok: true });
    await settle();

    expect(
      run.harness.state.read(buildsDownloadsSlot, 'test').get('b1/x/file/0'),
    ).toMatchObject({ state: 'saved', path: '/home/Downloads/332.zip' });
  });

  it('refreshes the files after a settings change', async () => {
    const run = await startOnHarness({
      backends: [backendSetting({ games: [gameWithDownload()] })],
    });
    run.fixture.setBuilds('g1', [numberedX]);
    await run.harness.files.write('/d/332.zip', 'zip');
    await run.harness.files.write('/d/332-new.zip', 'zip');
    await run.ready();
    const files = () => run.snapshot()?.backends[0]?.games[0]?.files;

    run.harness.pushSettings(
      settingsWith([
        backendSetting({ games: [gameWithDownload('/d/{number}-new.zip')] }),
      ]),
    );
    expect(files()).toEqual({});
    await settle();

    expect(files()).toEqual({
      x: [{ label: 'Android zip', path: '/d/332-new.zip', entry: 0 }],
    });
  });

  it.each([
    {
      case: 'an unknown backend',
      method: 'saveLog',
      arg: { ...listedX, backend: 'nope', job: null },
      expected: 'no backend nope',
    },
    {
      case: 'a backend whose instance is not created yet',
      method: 'saveLog',
      arg: { ...listedX, job: null },
      isStarting: true,
      expected: 'Backend: still starting',
    },
    {
      case: 'an unknown game',
      method: 'download',
      arg: { ...listedX, game: 'nope', file: 0 },
      expected: 'no game nope in Backend',
    },
    {
      case: 'an unknown build',
      method: 'download',
      arg: { ...listedX, build: 'nope', file: 0 },
      expected: 'no build nope in Game',
    },
    {
      case: 'an unknown job',
      method: 'saveLog',
      arg: { ...listedX, job: 'nope' },
      expected: 'no job nope in build x',
    },
    {
      case: 'an entry the last check did not find',
      method: 'download',
      arg: { ...listedX, file: 0 },
      expected: 'no file 0 for build x',
    },
    {
      case: "an entry past the kind's downloads",
      method: 'download',
      arg: { ...listedX, file: 5 },
      expected: 'no file 5 for build x',
    },
    {
      case: 'a log save on a backend that cannot save logs',
      method: 'saveLog',
      arg: { ...listedX, job: null },
      expected: 'this backend cannot save logs',
    },
  ])('refuses $case', async ({ method, arg, isStarting, expected }) => {
    const run = await startOnHarness({
      backends: [backendSetting({ games: [gameWithDownload()] })],
      kinds: (fixture) => [fixtureBackendKind('fixture', fixture), SLOW_KIND],
    });
    run.fixture.setBuilds('g1', [numberedX]);
    await run.ready();
    if (isStarting) {
      await run.pushBackends([
        backendSetting({ kind: 'slow', games: [gameWithDownload()] }),
      ]);
    }

    await expect(run.harness.invoke(method, arg)).resolves.toEqual({
      problem: expected,
    });
  });
});
