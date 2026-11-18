import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Clock } from '../contracts/ambient';
import type {
  HostedExit,
  HostedRun,
  HostedSpawn,
  PendingSpawn,
} from '../contracts/session-host';
import {
  pendingFile,
  runsFile,
  SESSION_HOST_PROTOCOL,
} from '../contracts/session-host-protocol';
import { createPendingQueue, PENDING_TICK_MS } from './pending-queue';
import type { ProcessSubscriber } from './process-table';
import { manualTime, spawnRequest } from './session-host-test-doubles';

// A host death is no spawn failure, so the exit holds no error.
const HOST_EXITED: HostedExit = { code: null, signal: null, error: null };
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function entry(
  id: string,
  at: number,
  skipWhileBusy: string | null = null,
): PendingSpawn {
  return { at, spawn: spawnRequest(id), record: { task: id }, skipWhileBusy };
}

function run(id: string, overrides: Partial<HostedRun> = {}): HostedRun {
  return {
    id,
    record: { task: id },
    startedAt: 1000,
    skipped: false,
    exit: { code: 0, signal: null, error: null },
    ...overrides,
  };
}

function setUp(
  options: {
    start?: number;
    clock?: (time: ReturnType<typeof manualTime>) => Clock;
    spawn?: (request: HostedSpawn, subscriber: ProcessSubscriber) => void;
  } = {},
) {
  const folder = mkdtempSync(path.join(tmpdir(), 'pending-queue-'));
  folders.push(folder);
  const time = manualTime(options.start ?? 1000);
  const spawnedIds: string[] = [];
  const busyIds = new Set<string>();
  const started: HostedRun[] = [];
  const diagnosticLines: string[] = [];
  const queue = createPendingQueue({
    folder,
    clock: options.clock?.(time) ?? time.clock,
    timers: time.timers,
    diagnostics: {
      append: (message) => diagnosticLines.push(message),
      setAsidePrevious: () => {},
    },
    spawn(request, subscriber) {
      options.spawn?.(request, subscriber);
      spawnedIds.push(request.id);
    },
    isBusy: (id) => busyIds.has(id),
    // A copy, so a later change to the run does not rewrite what was pushed.
    runStarted: (startedRun) => started.push(structuredClone(startedRun)),
  });
  const filePath = (name: string) => path.join(folder, name);
  const pendingPath = filePath(pendingFile(SESSION_HOST_PROTOCOL));
  const runsPath = filePath(runsFile(SESSION_HOST_PROTOCOL));
  // Null when absent; the parsed JSON, or the raw text when it is not JSON.
  const readFile = (file: string): unknown => {
    if (!existsSync(file)) {
      return null;
    }
    const text = readFileSync(file, 'utf8');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };
  return {
    folder,
    queue,
    time,
    spawnedIds,
    busyIds,
    started,
    diagnosticLines,
    filePath,
    pendingPath,
    runsPath,
    savedPending: () => readFile(pendingPath),
    savedRuns: () => readFile(runsPath),
    readFile,
  };
}

// Started at 1000, with run `done` already recorded.
function startedWithARun() {
  const setup = setUp();
  setup.queue.load();
  setup.queue.start();
  setup.queue.setPending([entry('done', 1000)]);
  return setup;
}

describe('pending queue', () => {
  it('start_DueAndLaterEntries_SpawnEachAtItsTime', () => {
    const { queue, time, spawnedIds, started, savedPending, savedRuns } =
      setUp();
    queue.load();
    queue.setPending([entry('a', 5000), entry('now', 1000), entry('b', 9000)]);

    queue.start();
    expect(spawnedIds).toEqual(['now']);

    time.advanceTo(4999);
    expect(spawnedIds).toEqual(['now']);

    time.advanceTo(5000);
    expect(spawnedIds).toEqual(['now', 'a']);
    expect(savedPending()).toEqual([entry('b', 9000)]);
    expect(savedRuns()).toEqual([
      run('now', { startedAt: 1000, exit: null }),
      run('a', { startedAt: 5000, exit: null }),
    ]);
    expect(started.map(({ id }) => id)).toEqual(['now', 'a']);

    time.advanceTo(9000);
    expect(spawnedIds).toEqual(['now', 'a', 'b']);
    expect(savedPending()).toEqual([]);
    expect(started.map(({ id }) => id)).toEqual(['now', 'a', 'b']);
  });

  it('start_BeforeStart_SpawnsNothing', () => {
    const { queue, time, spawnedIds } = setUp();
    queue.load();
    queue.setPending([entry('a', 0)]);

    time.advanceTo(10 * PENDING_TICK_MS);
    expect(spawnedIds).toEqual([]);

    queue.start();
    expect(spawnedIds).toEqual(['a']);
  });

  it.each([
    { label: 'no skip id', skipWhileBusy: null, busy: false, spawns: true },
    { label: 'a busy process', skipWhileBusy: 'p', busy: true, spawns: false },
    { label: 'an idle process', skipWhileBusy: 'p', busy: false, spawns: true },
    { label: 'an unknown id', skipWhileBusy: 'x', busy: false, spawns: true },
  ])('fire_SkipWhileBusy_Cases: $label', ({ skipWhileBusy, busy, spawns }) => {
    const { queue, time, spawnedIds, busyIds, started, savedRuns } = setUp();
    if (busy) {
      busyIds.add('p');
    }
    queue.load();
    queue.start();
    queue.setPending([entry('a', 3000, skipWhileBusy)]);

    time.advanceTo(3000);

    const expected = run('a', {
      startedAt: 3000,
      skipped: !spawns,
      exit: null,
    });
    expect(spawnedIds).toEqual(spawns ? ['a'] : []);
    expect(started).toEqual([expected]);
    expect(savedRuns()).toEqual([expected]);
  });

  it('fire_SpawnRefused_RunHoldsTheError', () => {
    const refused: HostedExit = { code: null, signal: null, error: 'refused' };
    const { queue, started, savedRuns } = setUp({
      spawn: (request, subscriber) => subscriber.closed(request.id, refused),
    });
    queue.load();
    queue.start();

    queue.setPending([entry('a', 1000)]);

    expect(started).toEqual([run('a', { exit: refused })]);
    expect(savedRuns()).toEqual([run('a', { exit: refused })]);
  });

  it('fire_SpawnThrows_RecordsTheErrorAndFiresTheNext', () => {
    const { queue, spawnedIds, started } = setUp({
      spawn: (request) => {
        if (request.id === 'a') {
          throw new Error('boom');
        }
      },
    });
    queue.load();
    queue.start();

    queue.setPending([entry('b', 1000), entry('a', 999)]);

    expect(started).toEqual([
      run('a', { exit: { code: null, signal: null, error: 'boom' } }),
      run('b', { exit: null }),
    ]);
    expect(spawnedIds).toEqual(['b']);
  });

  it.each([
    {
      label: 'an at that is not a number',
      entries: [{ ...entry('bad', 0), at: 'soon' }],
      kept: [],
      lines: 1,
    },
    {
      label: 'no spawn',
      entries: [{ at: 5000, record: null, skipWhileBusy: null }],
      kept: [],
      lines: 1,
    },
    {
      label: 'a null spawn',
      entries: [{ ...entry('bad', 5000), spawn: null }],
      kept: [],
      lines: 1,
    },
    {
      label: 'a spawn id that is not a string',
      entries: [
        { ...entry('bad', 5000), spawn: { ...spawnRequest('x'), id: 7 } },
      ],
      kept: [],
      lines: 1,
    },
    {
      label: 'an id the runs record holds',
      entries: [entry('done', 5000)],
      kept: [],
      lines: 0,
    },
    {
      label: 'two entries with one id',
      entries: [entry('twice', 5000), entry('twice', 6000)],
      kept: [entry('twice', 5000)],
      lines: 0,
    },
  ])(
    'setPending_EntryCases_KeepsOnlyGoodEntries: $label',
    ({ entries, kept, lines }) => {
      const { queue, diagnosticLines, savedPending } = startedWithARun();
      const good = entry('good', 7000);

      queue.setPending([...(entries as unknown as PendingSpawn[]), good]);

      expect(savedPending()).toEqual([...kept, good]);
      expect(diagnosticLines).toHaveLength(lines);
    },
  );

  it('setPending_Replace_DropsEntriesLeftOut', () => {
    const { queue, time, spawnedIds } = setUp();
    queue.load();
    queue.start();
    queue.setPending([entry('a', 5000), entry('b', 6000)]);

    queue.setPending([entry('b', 6000)]);
    time.advanceTo(10_000);

    expect(spawnedIds).toEqual(['b']);
  });

  it('timer_PastTheTick_ArmsAgainUntilAt', () => {
    const at = PENDING_TICK_MS * 3 + 1000;
    const { queue, time, spawnedIds } = setUp({ start: 0 });
    queue.load();
    queue.start();
    queue.setPending([entry('a', at)]);

    for (const tick of [1, 2, 3]) {
      time.advanceTo(PENDING_TICK_MS * tick);
      expect(spawnedIds).toEqual([]);
    }
    time.advanceTo(at - 1);
    expect(spawnedIds).toEqual([]);

    time.advanceTo(at);
    expect(spawnedIds).toEqual(['a']);
  });

  it('timer_WallClockPassedAtDuringSleep_StartsAtTheNextTick', () => {
    let slept = 0;
    const at = PENDING_TICK_MS * 2;
    const { queue, time, spawnedIds, started } = setUp({
      start: 0,
      clock: (manual) => ({ now: () => manual.clock.now() + slept }),
    });
    queue.load();
    queue.start();
    queue.setPending([entry('a', at)]);

    slept = at;
    time.advanceTo(PENDING_TICK_MS - 1);
    expect(spawnedIds).toEqual([]);

    time.advanceTo(PENDING_TICK_MS);
    expect(spawnedIds).toEqual(['a']);
    expect(started[0].startedAt).toBe(PENDING_TICK_MS + at);
  });

  it.each([
    {
      label: 'no files',
      pending: null,
      runs: null,
      loaded: [],
      runsFileAfter: null,
      spawned: [],
      lines: 0,
    },
    {
      label: 'files that are not JSON',
      pending: 'nope',
      runs: 'nope',
      loaded: [],
      runsFileAfter: 'nope',
      spawned: [],
      lines: 2,
    },
    {
      label:
        'an entry with no spawn and one with a null spawn beside a good one',
      pending: JSON.stringify([
        { at: 0, record: null, skipWhileBusy: null },
        { ...entry('bad', 0), spawn: null },
        entry('good', 0),
      ]),
      runs: null,
      loaded: [],
      runsFileAfter: [run('good', { exit: null })],
      spawned: ['good'],
      lines: 2,
    },
    {
      label: 'a run with a null exit',
      pending: null,
      runs: JSON.stringify([run('a', { exit: null })]),
      loaded: [run('a', { exit: HOST_EXITED })],
      runsFileAfter: [run('a', { exit: HOST_EXITED })],
      spawned: [],
      lines: 0,
    },
    {
      label: 'a skipped run',
      pending: null,
      runs: JSON.stringify([run('a', { skipped: true, exit: null })]),
      loaded: [run('a', { skipped: true, exit: null })],
      runsFileAfter: [run('a', { skipped: true, exit: null })],
      spawned: [],
      lines: 0,
    },
  ])(
    'load_FileCases: $label',
    ({ pending, runs, loaded, runsFileAfter, spawned, lines }) => {
      const setup = setUp();
      if (pending !== null) {
        writeFileSync(setup.pendingPath, pending);
      }
      if (runs !== null) {
        writeFileSync(setup.runsPath, runs);
      }

      setup.queue.load();
      expect(setup.queue.runs()).toEqual(loaded);
      expect(setup.diagnosticLines).toHaveLength(lines);

      setup.queue.start();
      expect(setup.spawnedIds).toEqual(spawned);
      expect(setup.savedRuns()).toEqual(runsFileAfter);
    },
  );

  it('processClosed_FillsANullExitOnce', () => {
    const first: HostedExit = { code: 0, signal: null, error: null };
    const second: HostedExit = { code: 1, signal: null, error: null };
    const { queue, savedRuns } = startedWithARun();

    queue.processClosed('done', first);
    queue.processClosed('done', second);

    expect(queue.runs()).toEqual([run('done', { exit: first })]);
    expect(savedRuns()).toEqual([run('done', { exit: first })]);
  });

  it('forgetRuns_DropsOnlyThoseIds', () => {
    const { queue, savedRuns } = startedWithARun();
    queue.setPending([entry('a', 1000), entry('b', 1000)]);

    queue.forgetRuns(['a', 'unknown']);

    const kept = [run('done', { exit: null }), run('b', { exit: null })];
    expect(queue.runs()).toEqual(kept);
    expect(savedRuns()).toEqual(kept);
  });

  it('drop_DeletesThePendingFileKeepsTheRunsFileAndRefusesSetPending', () => {
    const { queue, time, spawnedIds, diagnosticLines, pendingPath, runsPath } =
      startedWithARun();
    queue.setPending([entry('later', 9000)]);
    const runsText = readFileSync(runsPath, 'utf8');

    queue.drop();
    queue.processClosed('done', { code: 0, signal: null, error: null });
    queue.setPending([entry('c', 1000)]);
    time.advanceTo(10_000);

    expect(existsSync(pendingPath)).toBe(false);
    expect(readFileSync(runsPath, 'utf8')).toBe(runsText);
    expect(spawnedIds).toEqual(['done']);
    expect(diagnosticLines).toHaveLength(1);
    expect(queue.isEmpty()).toBe(true);
  });

  it.each([
    {
      label: 'an older file with two records, one already held',
      older: JSON.stringify([
        run('held', { record: { task: 'older copy' } }),
        run('fired', { startedAt: 500, exit: null }),
      ]),
      loaded: [
        run('fired', { startedAt: 500, exit: HOST_EXITED }),
        run('held'),
      ],
      olderStays: false,
      lines: 0,
    },
    {
      label: 'an older file that is not JSON',
      older: 'nope',
      loaded: [run('held')],
      olderStays: true,
      lines: 1,
    },
  ])(
    'load_OlderRunsFile_ImportsItsRecordsAndDeletesIt: $label',
    ({ older, loaded, olderStays, lines }) => {
      const setup = setUp();
      const olderPath = setup.filePath(runsFile(SESSION_HOST_PROTOCOL - 1));
      writeFileSync(setup.runsPath, JSON.stringify([run('held')]));
      writeFileSync(olderPath, older);

      setup.queue.load();

      expect(setup.queue.runs()).toEqual(loaded);
      expect(setup.savedRuns()).toEqual(loaded);
      expect(existsSync(olderPath)).toBe(olderStays);
      expect(setup.diagnosticLines).toHaveLength(lines);
    },
  );

  it.each([
    { label: 'empty', pending: [], fired: false, drops: false, empty: true },
    {
      label: 'pending only',
      pending: [entry('a', 9000)],
      fired: false,
      drops: false,
      empty: false,
    },
    {
      label: 'runs only',
      pending: [],
      fired: true,
      drops: false,
      empty: false,
    },
    {
      label: 'runs after a drop',
      pending: [entry('a', 9000)],
      fired: true,
      drops: true,
      empty: true,
    },
  ])('isEmpty_Cases: $label', ({ pending, fired, drops, empty }) => {
    const { queue } = setUp();
    queue.load();
    queue.start();
    if (fired) {
      queue.setPending([entry('fired', 1000)]);
    }
    queue.setPending(pending);
    if (drops) {
      queue.drop();
    }

    expect(queue.isEmpty()).toBe(empty);
  });
});
