import { describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import type { Files, FileStat } from '../../../contracts/files';
import type { KeyedSlotWriter } from '../../../contracts/state';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type BackendCapabilities,
  type BuildBackend,
  type BuildDownload,
  type BuildDownloadEntry,
  type BuildFile,
  buildsDownloadsSlot,
  type GameEntry,
} from '../contract';
import {
  buildJob,
  buildRecord,
  createFixtureBackend,
  gameEntry,
} from '../contract.test-support';
import {
  createDownloads,
  DOWNLOAD_KEEP_MS,
  type DownloadTarget,
  FILE_CHECK_TIMEOUT_MS,
  filledFiles,
  savedLogName,
} from './downloads';

const DOWNLOADS = '/home/Downloads';
const FILE_PATH = '/d/332.zip';
const SAVES_LOGS: BackendCapabilities = {
  cancel: false,
  choosesBranch: true,
  saveLog: true,
};
const FOUND: FileStat = { isFolder: false, isLink: false };

function gameWith(downloads: BuildDownloadEntry[]): GameEntry {
  return gameEntry({
    id: 'g1',
    label: 'Tiki Smash',
    kinds: { dev: { label: 'Dev', target: 'dev', downloads } },
  });
}

const game = gameWith([{ label: 'Android zip', path: '/d/{number}.zip' }]);
const build = buildRecord({
  id: '821436',
  gameId: 'g1',
  number: '332',
  version: '0.11.0',
});
const target: DownloadTarget = { backendId: 'work', game, build };

function fileAt(path: string, entry = 0): BuildFile {
  return { label: 'Android zip', path, entry };
}

const settle = async () => {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// A clock and timers that `advance` moves together, running each due timer in due order.
function advancingTime() {
  let now = 0;
  let nextHandle = 1;
  const armed = new Map<number, { run: () => void; due: number }>();
  const timers: Timers = {
    set: (run, ms) => {
      const handle = nextHandle++;
      armed.set(handle, { run, due: now + ms });
      return handle;
    },
    clear: (handle) => {
      armed.delete(handle);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...armed]
        .filter(([, timer]) => timer.due <= end)
        .sort(([a, first], [b, second]) => first.due - second.due || a - b);
      if (due.length === 0) {
        break;
      }
      const [handle, timer] = due[0];
      armed.delete(handle);
      now = timer.due;
      timer.run();
    }
    now = end;
  };
  return { clock: { now: () => now }, timers, advance };
}

// Downloads over memory files whose `stat` is a spy, advancing time, and a `builds.downloads` writer the test reads
// back; `slot` is a writer a test seeded, as a restart leaves it.
function setup(options: { slot?: KeyedSlotWriter<BuildDownload> } = {}) {
  const memory = createMemoryFiles();
  const files: Files = { ...memory };
  const stat = vi.spyOn(files, 'stat');
  const time = advancingTime();
  const slot =
    options.slot ??
    createSlotStore(() => undefined).publish(buildsDownloadsSlot);
  const logs: string[] = [];
  const revealed: string[] = [];
  const reveal = { error: null as Error | null };
  let changes = 0;
  const downloads = createDownloads({
    files,
    paths: posixPaths,
    clock: time.clock,
    timers: time.timers,
    downloadsDir: DOWNLOADS,
    revealPath(path) {
      if (reveal.error !== null) {
        throw reveal.error;
      }
      revealed.push(path);
    },
    slot,
    log: (message) => logs.push(message),
    filesChanged: () => {
      changes += 1;
    },
  });
  return {
    downloads,
    memory,
    files,
    slot,
    logs,
    revealed,
    reveal,
    advance: time.advance,
    changes: () => changes,
    statsOf: (path: string) =>
      stat.mock.calls.filter(([called]) => called === path).length,
    stat,
    check: async (checked: GameEntry = game, builds = [build]) => {
      downloads.checkFiles('work', checked, builds);
      await settle();
    },
    shown: (shownGame: GameEntry = game) =>
      downloads.filesOf('work', shownGame, [build]),
    entries: () => [...slot.all().values()],
    savedPaths: () =>
      [...slot.all().values()]
        .filter((entry) => entry.state === 'saved')
        .map((entry) => entry.path),
  };
}

// A backend that saves logs, each save waiting until `release`; `calls` holds each save's path.
function heldLogBackend() {
  const held = deferred<void>();
  const calls: string[] = [];
  const backend: BuildBackend = {
    ...createFixtureBackend({ capabilities: SAVES_LOGS }),
    async saveLog(_game, _buildId, _jobId, path) {
      calls.push(path);
      await held.promise;
    },
  };
  return { backend, calls, release: () => held.resolve() };
}

describe('downloads', () => {
  it.each([
    {
      case: 'both placeholders',
      downloads: [
        {
          label: 'Android zip',
          path: '/d/builds/{version}/Dev/android_BashBest_{version}.{number}_android.zip',
        },
      ],
      build: { version: '0.11.0', number: '332' },
      expected: [
        fileAt(
          '/d/builds/0.11.0/Dev/android_BashBest_0.11.0.332_android.zip',
          0,
        ),
      ],
    },
    {
      case: '{number} with a null number',
      downloads: [{ label: 'Android zip', path: '/d/{number}.zip' }],
      build: { version: '0.11.0', number: null },
      expected: [],
    },
    {
      case: 'two templates, the first needing a null {number}',
      downloads: [
        { label: 'iOS ipa', path: '/d/{number}.ipa' },
        { label: 'Android zip', path: '/d/{version}.zip' },
      ],
      build: { version: '0.11.0', number: null },
      expected: [fileAt('/d/0.11.0.zip', 1)],
    },
    {
      case: 'no placeholder',
      downloads: [{ label: 'Android zip', path: '/d/fixed.zip' }],
      build: { version: '0.11.0', number: '332' },
      expected: [fileAt('/d/fixed.zip', 0)],
    },
    {
      case: '{branch}, kept as written',
      downloads: [{ label: 'Android zip', path: '/d/{branch}/{version}.zip' }],
      build: { version: '0.11.0', number: '332' },
      expected: [fileAt('/d/{branch}/0.11.0.zip', 0)],
    },
  ])('filledFiles fills $case', ({ downloads, build: fields, expected }) => {
    const kind = { label: 'Dev', target: 'dev', downloads };

    expect(filledFiles(kind, buildRecord(fields))).toEqual(expected);
  });

  it.each([
    {
      label: 'Tiki Smash',
      build: { id: '821436', number: '332' },
      job: 'Build Android - Dev',
      expected: 'Tiki-Smash-Dev-332-Build-Android-Dev.log',
    },
    {
      label: 'Tiki Smash',
      build: { id: '821436', number: null },
      job: 'Build Android - Dev',
      expected: 'Tiki-Smash-Dev-build-821436-Build-Android-Dev.log',
    },
    {
      label: 'Tiki Smash',
      build: { id: '821436', number: '332' },
      job: null,
      expected: 'Tiki-Smash-Dev-332-build.log',
    },
    {
      label: 'Demo',
      build: { id: 'demo/dev/1000', number: null },
      job: null,
      expected: 'Demo-Dev-build-demo-dev-1000-build.log',
    },
  ])(
    'savedLogName gives $expected',
    ({ label, build: fields, job, expected }) => {
      expect(savedLogName(gameEntry({ label }), buildRecord(fields), job)).toBe(
        expected,
      );
    },
  );

  it('checks every filled path on every poll', async () => {
    const run = setup();
    await run.memory.write(FILE_PATH, 'zip');
    await run.check();
    expect(run.shown()).toEqual({ [build.id]: [fileAt(FILE_PATH)] });

    run.memory.remove(FILE_PATH);
    await run.check();
    expect(run.shown()).toEqual({});
    await run.memory.write(FILE_PATH, 'zip');
    await run.check();

    expect(run.shown()).toEqual({ [build.id]: [fileAt(FILE_PATH)] });
    expect(run.statsOf(FILE_PATH)).toBe(3);
  });

  it('calls filesChanged only when a check changes the files', async () => {
    const run = setup();
    await run.check();
    expect(run.changes()).toBe(0);
    await run.memory.write(FILE_PATH, 'zip');

    await run.check();
    expect(run.changes()).toBe(1);
    await run.check();

    expect(run.changes()).toBe(1);
  });

  it('gives up on a stalled stat and keeps the last result', async () => {
    const run = setup();
    await run.memory.write(FILE_PATH, 'zip');
    await run.check();
    const stalled = deferred<FileStat | null>();
    run.stat.mockImplementationOnce(() => stalled.promise);
    const gaveUp = `file check gave up after ${FILE_CHECK_TIMEOUT_MS} ms: ${FILE_PATH}`;

    await run.check();
    run.advance(FILE_CHECK_TIMEOUT_MS);
    expect(run.shown()).toEqual({ [build.id]: [fileAt(FILE_PATH)] });
    expect(run.logs.filter((line) => line === gaveUp)).toHaveLength(1);
    expect(run.changes()).toBe(1);
    await run.check();
    expect(run.statsOf(FILE_PATH)).toBe(2);
    stalled.resolve(null);
    await settle();
    expect(run.shown()).toEqual({ [build.id]: [fileAt(FILE_PATH)] });
    await run.check();

    expect(run.statsOf(FILE_PATH)).toBe(3);
  });

  it('re-checks a path in checksSettled whose check began before the call', async () => {
    const run = setup();
    const held = deferred<FileStat | null>();
    run.stat.mockImplementationOnce(() => held.promise);
    await run.check();
    await run.memory.write(FILE_PATH, 'zip');

    const settled = run.downloads.checksSettled('work', game, [build]);
    held.resolve(null);
    await settled;

    expect(run.shown()).toEqual({ [build.id]: [fileAt(FILE_PATH)] });
  });

  it('counts a rejecting stat as not found and logs once', async () => {
    const run = setup();
    await run.memory.write(FILE_PATH, 'zip');
    run.stat.mockRejectedValue(new Error('denied'));

    await run.check();
    await run.check();

    expect(run.shown()).toEqual({});
    expect(run.logs).toEqual([`file check failed: ${FILE_PATH}: denied`]);
  });

  it.each([
    {
      case: 'a good check',
      between: async (run: ReturnType<typeof setup>) => {
        run.stat.mockResolvedValueOnce(FOUND);
        await run.check();
      },
    },
    {
      case: 'forgetGame',
      between: async (run: ReturnType<typeof setup>) => {
        run.downloads.forgetGame('work', 'g1');
      },
    },
  ])('logs a failing path again after $case', async ({ between }) => {
    const run = setup();
    const failed = `file check failed: ${FILE_PATH}: denied`;
    run.stat.mockRejectedValueOnce(new Error('denied'));
    await run.check();

    await between(run);
    run.stat.mockRejectedValueOnce(new Error('denied'));
    await run.check();

    expect(run.logs).toEqual([failed, failed]);
  });

  it('gives no files for a kind the game does not declare', async () => {
    const run = setup();
    const qaBuild = buildRecord({ id: 'qa-1', kind: 'qa', number: '332' });
    await run.memory.write(FILE_PATH, 'zip');

    await run.check(game, [qaBuild]);

    expect(run.downloads.filesOf('work', game, [qaBuild])).toEqual({});
    expect(run.stat).not.toHaveBeenCalled();
  });

  it.each([
    {
      case: 'the build leaves the list',
      drop: (run: ReturnType<typeof setup>) => run.check(game, []),
    },
    {
      case: "the kind's template changes",
      drop: async () => undefined,
      changed: gameWith([
        { label: 'Android zip', path: '/d/{number}-new.zip' },
      ]),
    },
    {
      case: 'forgetGame',
      drop: async (run: ReturnType<typeof setup>) =>
        run.downloads.forgetGame('work', 'g1'),
    },
  ])('drops files when $case', async ({ drop, changed }) => {
    const run = setup();
    await run.memory.write(FILE_PATH, 'zip');
    await run.memory.write('/d/332-new.zip', 'zip');
    await run.check();

    await drop(run);
    expect(run.shown(changed)).toEqual({});
    if (changed !== undefined) {
      await run.check(changed);
      expect(run.shown(changed)).toEqual({
        [build.id]: [fileAt('/d/332-new.zip')],
      });
    }
  });

  it('writes nothing after dispose', async () => {
    const run = setup();
    await run.memory.write(FILE_PATH, 'zip');
    const stalled = deferred<FileStat | null>();
    run.stat.mockImplementationOnce(() => stalled.promise);
    const copied = deferred<void>();
    vi.spyOn(run.files, 'copy').mockImplementationOnce(() => copied.promise);
    run.downloads.checkFiles('work', game, [build]);
    run.downloads.download(target, fileAt(FILE_PATH));
    await settle();
    const running = run.entries();

    run.downloads.dispose();
    stalled.resolve(FOUND);
    copied.resolve();
    await settle();
    run.advance(DOWNLOAD_KEEP_MS);

    expect(run.shown()).toEqual({});
    expect(run.entries()).toEqual(running);
    expect(running.map((entry) => entry.state)).toEqual(['running']);
    expect(run.revealed).toEqual([]);
    expect(run.changes()).toBe(0);
  });

  it('copies nothing when disposed during the free-name pick', async () => {
    const run = setup();
    await run.memory.write(FILE_PATH, 'zip');
    const picked = deferred<FileStat | null>();
    run.stat.mockImplementationOnce(() => picked.promise);
    const copy = vi.spyOn(run.files, 'copy');
    run.downloads.download(target, fileAt(FILE_PATH));
    await settle();

    run.downloads.dispose();
    picked.resolve(null);
    await settle();

    expect(copy).not.toHaveBeenCalled();
  });

  it.each([
    {
      expected: 'work/821436/log',
      start: (run: ReturnType<typeof setup>) =>
        run.downloads.saveLog(
          target,
          null,
          createFixtureBackend({ capabilities: SAVES_LOGS }),
        ),
    },
    {
      expected: 'work/821436/log/821432',
      start: (run: ReturnType<typeof setup>) =>
        run.downloads.saveLog(
          target,
          buildJob({ id: '821432' }),
          createFixtureBackend({ capabilities: SAVES_LOGS }),
        ),
    },
    {
      expected: 'work/821436/file/1',
      start: (run: ReturnType<typeof setup>) =>
        run.downloads.download(target, fileAt(FILE_PATH, 1)),
    },
  ])('gives the id $expected', ({ expected, start }) => {
    const run = setup();

    start(run);

    expect([...run.slot.all().keys()]).toEqual([expected]);
  });

  it.each([
    {
      case: 'free',
      taken: [],
      saves: async (run: ReturnType<typeof setup>) => {
        run.downloads.download(target, fileAt('/d/a/x.zip'));
      },
      expected: [`${DOWNLOADS}/x.zip`],
    },
    {
      case: 'x.zip and x (2).zip taken',
      taken: ['x.zip', 'x (2).zip'],
      saves: async (run: ReturnType<typeof setup>) => {
        run.downloads.download(target, fileAt('/d/a/x.zip'));
      },
      expected: [`${DOWNLOADS}/x (3).zip`],
    },
    {
      case: 'two downloads of one name started together',
      taken: [],
      saves: async (run: ReturnType<typeof setup>) => {
        run.downloads.download(target, fileAt('/d/a/x.zip', 0));
        run.downloads.download(target, fileAt('/d/b/x.zip', 1));
      },
      expected: [`${DOWNLOADS}/x.zip`, `${DOWNLOADS}/x (2).zip`],
    },
    {
      case: 'a name freed once its save ended',
      taken: [],
      saves: async (run: ReturnType<typeof setup>) => {
        run.downloads.download(target, fileAt('/d/missing/x.zip', 0));
        await settle();
        run.downloads.download(target, fileAt('/d/a/x.zip', 1));
      },
      expected: [`${DOWNLOADS}/x.zip`],
    },
    {
      case: 'a log name with no clash',
      taken: [],
      saves: async (run: ReturnType<typeof setup>) => {
        run.downloads.saveLog(
          target,
          buildJob({ label: 'Build Android - Dev' }),
          createFixtureBackend({ capabilities: SAVES_LOGS }),
        );
      },
      expected: [`${DOWNLOADS}/Tiki-Smash-Dev-332-Build-Android-Dev.log`],
    },
  ])('saves under a free name: $case', async ({ taken, saves, expected }) => {
    const run = setup();
    await run.memory.write('/d/a/x.zip', 'a');
    await run.memory.write('/d/b/x.zip', 'b');
    for (const name of taken) {
      await run.memory.write(`${DOWNLOADS}/${name}`, 'taken');
    }

    await saves(run);
    await settle();

    expect(run.savedPaths()).toEqual(expected);
  });

  it.each([
    {
      case: 'copy succeeds',
      start: (run: ReturnType<typeof setup>) =>
        run.downloads.download(target, fileAt(FILE_PATH)),
      state: 'saved',
      path: `${DOWNLOADS}/332.zip`,
      problem: null,
      revealed: [`${DOWNLOADS}/332.zip`],
      logs: [],
    },
    {
      case: 'source missing',
      start: (run: ReturnType<typeof setup>) =>
        run.downloads.download(target, fileAt('/d/missing.zip')),
      state: 'failed',
      path: null,
      problem: expect.stringContaining('/d/missing.zip'),
      revealed: [],
      logs: [],
    },
    {
      case: 'the backend fails the save',
      start: (run: ReturnType<typeof setup>) => {
        const backend = createFixtureBackend({ capabilities: SAVES_LOGS });
        backend.failSaveLogs(new Error('no access'));
        return run.downloads.saveLog(target, null, backend);
      },
      state: 'failed',
      path: null,
      problem: 'no access',
      revealed: [],
      logs: [],
    },
    {
      case: "the pick's stat rejects",
      start: (run: ReturnType<typeof setup>) => {
        run.stat.mockRejectedValueOnce(new Error('denied'));
        return run.downloads.download(target, fileAt(FILE_PATH));
      },
      state: 'failed',
      path: null,
      problem: 'denied',
      revealed: [],
      logs: [],
    },
    {
      case: 'the backend throws synchronously',
      start: (run: ReturnType<typeof setup>) =>
        run.downloads.saveLog(target, null, {
          ...createFixtureBackend({ capabilities: SAVES_LOGS }),
          saveLog: () => {
            throw new Error('sync');
          },
        }),
      state: 'failed',
      path: null,
      problem: 'sync',
      revealed: [],
      logs: [],
    },
    {
      case: 'revealPath throws',
      start: (run: ReturnType<typeof setup>) => {
        run.reveal.error = new Error('no finder');
        return run.downloads.download(target, fileAt(FILE_PATH));
      },
      state: 'saved',
      path: `${DOWNLOADS}/332.zip`,
      problem: null,
      revealed: [],
      logs: [`reveal failed: ${DOWNLOADS}/332.zip: no finder`],
    },
  ])(
    'moves the entry from running to $state: $case',
    async ({ start, state, path, problem, revealed, logs }) => {
      const run = setup();
      await run.memory.write(FILE_PATH, 'zip');

      expect(start(run)).toEqual({ ok: true });
      expect(run.entries().map((entry) => entry.state)).toEqual(['running']);
      await settle();

      expect(run.entries()).toEqual([
        expect.objectContaining({ state, path, problem }),
      ]);
      expect(run.revealed).toEqual(revealed);
      expect(run.logs).toEqual(logs);
    },
  );

  it('refuses a second start while one runs', async () => {
    const run = setup();
    const held = heldLogBackend();

    expect(run.downloads.saveLog(target, null, held.backend)).toEqual({
      ok: true,
    });
    expect(run.downloads.saveLog(target, null, held.backend)).toEqual({
      problem: 'that download is already running',
    });
    expect(held.calls).toHaveLength(1);
    held.release();
    await settle();

    expect(run.downloads.saveLog(target, null, held.backend)).toEqual({
      ok: true,
    });
  });

  it('refuses a log save on a backend that cannot save logs', () => {
    const run = setup();

    expect(run.downloads.saveLog(target, null, createFixtureBackend())).toEqual(
      { problem: 'this backend cannot save logs' },
    );
    expect(run.entries()).toEqual([]);
  });

  it('deletes an ended entry after DOWNLOAD_KEEP_MS', async () => {
    const run = setup();
    await run.memory.write(FILE_PATH, 'zip');
    run.downloads.download(target, fileAt(FILE_PATH));
    await settle();

    run.advance(DOWNLOAD_KEEP_MS - 1);
    expect(run.entries()).toHaveLength(1);
    run.advance(1);
    expect(run.entries()).toEqual([]);

    run.downloads.download(target, fileAt(FILE_PATH));
    await settle();
    run.advance(1000);
    run.downloads.download(target, fileAt(FILE_PATH));
    await settle();
    run.advance(DOWNLOAD_KEEP_MS - 1000);

    expect(run.entries()).toEqual([
      expect.objectContaining({
        state: 'saved',
        startedAt: DOWNLOAD_KEEP_MS + 1000,
      }),
    ]);
  });

  it('fails a running entry left by a restart', () => {
    const store = createSlotStore(() => undefined);
    const before = store.publish(buildsDownloadsSlot);
    const left: BuildDownload = {
      id: 'work/821436/log',
      backendId: 'work',
      buildId: '821436',
      label: 'build',
      state: 'running',
      path: null,
      problem: null,
      startedAt: 0,
    };
    before.set(left.id, left);
    before.set('work/821436/file/0', {
      ...left,
      id: 'work/821436/file/0',
      label: 'Android zip',
      state: 'saved',
      path: `${DOWNLOADS}/332.zip`,
    });
    before.dispose();

    const run = setup({ slot: store.publish(buildsDownloadsSlot) });

    expect(run.slot.get(left.id)).toEqual({
      ...left,
      state: 'failed',
      problem:
        'the builds plugin restarted during the save; the file may still arrive',
    });
    run.advance(DOWNLOAD_KEEP_MS - 1);
    expect(run.slot.get('work/821436/file/0')?.state).toBe('saved');
    run.advance(1);
    expect(run.entries()).toEqual([]);
  });
});
