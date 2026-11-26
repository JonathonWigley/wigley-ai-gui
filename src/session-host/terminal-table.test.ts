import { describe, expect, it } from 'vitest';
import type { PtyExit, PtyOptions } from '../contracts/pty';
import { HOST_END_GRACE_MS } from '../contracts/session-host-protocol';
import {
  TERMINAL_REPLAY_LIMIT,
  type TerminalExit,
  type TerminalSpawn,
} from '../contracts/terminals';
import {
  type FakePty,
  fakePty,
  manualTime,
  terminalRequest,
} from './session-host-test-doubles';
import {
  createTerminalTable,
  type TerminalSubscriber,
  type TerminalTable,
} from './terminal-table';

function recordingTerminal() {
  const data: string[] = [];
  const closed: { id: string; exit: TerminalExit }[] = [];
  const subscriber: TerminalSubscriber = {
    data: (_id, chunk) => data.push(chunk),
    closed: (id, exit) => closed.push({ id, exit }),
  };
  return { subscriber, data, closed };
}

function setUp(env: NodeJS.ProcessEnv = {}) {
  const time = manualTime();
  const ptys: FakePty[] = [];
  const spawns: {
    file: string;
    args: readonly string[];
    options: PtyOptions;
  }[] = [];
  const recorded: { pid: number; kills: number; disposals: number }[] = [];
  const closedIds: string[] = [];
  const spawnFailure: { error: Error | null } = { error: null };
  const table = createTerminalTable({
    spawn: (file, args, options) => {
      if (spawnFailure.error !== null) {
        throw spawnFailure.error;
      }
      spawns.push({ file, args, options });
      const fake = fakePty(5151 + ptys.length);
      ptys.push(fake);
      return fake.pty;
    },
    env,
    clock: time.clock,
    timers: time.timers,
    diagnostics: { append: () => {}, setAsidePrevious: () => {} },
    recordPid: (pid) => {
      const handle = { pid, kills: 0, disposals: 0 };
      recorded.push(handle);
      return {
        kill: () => {
          handle.kills += 1;
        },
        dispose: () => {
          handle.disposals += 1;
        },
      };
    },
    terminalClosed: (id) => closedIds.push(id),
  });
  // Spawns shell `id` and returns its pty.
  const spawnShell = (
    id: string,
    subscriber: TerminalSubscriber = recordingTerminal().subscriber,
  ): FakePty => {
    table.spawn(terminalRequest(id), subscriber);
    return ptys[ptys.length - 1];
  };
  return {
    table,
    time,
    ptys,
    spawns,
    recorded,
    closedIds,
    spawnFailure,
    spawnShell,
  };
}

type SetUp = ReturnType<typeof setUp>;

describe('createTerminalTable', () => {
  it('spawn_HostEnv_SpawnsThePtyWithTheShellEnvironment', () => {
    const { table, spawns, recorded } = setUp({
      PATH: '/bin',
      ELECTRON_RUN_AS_NODE: '1',
      TERM: 'dumb',
      GONE: undefined,
    });

    table.spawn(
      {
        id: 'a',
        command: '/bin/zsh',
        args: ['-l'],
        cwd: '/work',
        cols: 100,
        rows: 30,
      },
      recordingTerminal().subscriber,
    );

    // Strict, so a name left with an undefined value fails.
    expect(spawns).toStrictEqual([
      {
        file: '/bin/zsh',
        args: ['-l'],
        options: {
          cwd: '/work',
          cols: 100,
          rows: 30,
          env: {
            PATH: '/bin',
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
          },
        },
      },
    ]);
    expect(recorded.map(({ pid }) => pid)).toEqual([5151]);
  });

  it('attach_OutputPastTheReplayLimit_ReplaysTheKeptTail', () => {
    const { table, spawnShell } = setUp();
    const shell = spawnShell('a');

    shell.emitData('a\u{1F600}');
    shell.emitData('x'.repeat(TERMINAL_REPLAY_LIMIT - 1));

    expect(table.attach('a', recordingTerminal().subscriber)?.replay).toBe(
      'x'.repeat(TERMINAL_REPLAY_LIMIT - 1),
    );
  });

  it('output_AttachThenDetach_GoesToTheLiveSubscriberOnly', () => {
    const { table, spawnShell } = setUp();
    const first = recordingTerminal();
    const second = recordingTerminal();
    const shell = spawnShell('a', first.subscriber);
    shell.emitData('1');

    expect(table.attach('a', second.subscriber)).toEqual({
      replay: '1',
      running: true,
    });
    shell.emitData('2');
    expect(first.data).toEqual(['1']);
    expect(second.data).toEqual(['2']);

    table.detach('a', first.subscriber);
    shell.emitData('3');
    expect(second.data).toEqual(['2', '3']);

    table.detach('a', second.subscriber);
    shell.emitData('4');
    expect(first.data).toEqual(['1']);
    expect(second.data).toEqual(['2', '3']);
    expect(table.attach('a', recordingTerminal().subscriber)?.replay).toBe(
      '1234',
    );
  });

  it('dropSubscriber_ThenOutput_KeepsItForTheNextAttach', () => {
    const { table, spawnShell } = setUp();
    const dropped = recordingTerminal();
    const shells = [
      spawnShell('a', dropped.subscriber),
      spawnShell('b', dropped.subscriber),
    ];

    table.dropSubscriber(dropped.subscriber);
    for (const shell of shells) {
      shell.emitData('x');
    }

    expect(dropped.data).toEqual([]);
    expect(table.attach('a', recordingTerminal().subscriber)).toEqual({
      replay: 'x',
      running: true,
    });
  });

  it.each([
    {
      name: 'an exit code',
      exit: { exitCode: 2, signal: null } as PtyExit,
      closed: { code: 2, signal: null, error: null },
    },
    {
      name: 'a signal',
      exit: { exitCode: 0, signal: 1 } as PtyExit,
      closed: { code: null, signal: 1, error: null },
    },
  ])(
    'exit_Cases_RemovesTheShellAndTellsItsSubscriberOnce: $name',
    ({ exit, closed }) => {
      const { table, spawnShell, closedIds, recorded } = setUp();
      const subscriber = recordingTerminal();
      const shell = spawnShell('a', subscriber.subscriber);

      shell.exit(exit);

      expect(subscriber.closed).toEqual([{ id: 'a', exit: closed }]);
      expect(table.list()).toEqual([]);
      expect(table.attach('a', recordingTerminal().subscriber)).toBeNull();
      expect(closedIds).toEqual(['a']);
      expect(recorded[0].disposals).toBe(1);
    },
  );

  it.each([
    {
      name: 'after endAll',
      prepare: (s: SetUp) => s.table.endAll(),
      request: terminalRequest('a'),
      error: 'the session host is draining',
    },
    {
      name: 'a held id',
      prepare: (s: SetUp) => s.spawnShell('a'),
      request: terminalRequest('a'),
      error: 'a terminal with id a already exists',
    },
    {
      name: 'cols 0',
      prepare: () => {},
      request: { ...terminalRequest('a'), cols: 0 },
      error: 'terminal a has no well-formed spawn',
    },
    {
      name: 'an id that is not a string',
      prepare: () => {},
      request: { ...terminalRequest('a'), id: 7 } as unknown as TerminalSpawn,
      closedId: 7,
      error: 'terminal 7 has no well-formed spawn',
    },
    {
      name: 'args not an array',
      prepare: () => {},
      request: {
        ...terminalRequest('a'),
        args: 'x',
      } as unknown as TerminalSpawn,
      error: 'terminal a has no well-formed spawn',
    },
    {
      name: 'a PtySpawn that throws',
      prepare: (s: SetUp) => {
        s.spawnFailure.error = new Error('no such file');
      },
      request: terminalRequest('a'),
      error: 'no such file',
    },
  ])(
    'spawn_Refusals_CloseWithTheReason: $name',
    ({ prepare, request, error, closedId }) => {
      const s = setUp();
      s.spawnShell('held');
      prepare(s);
      const killsBefore = s.ptys.map((pty) => pty.kills());
      const ptyCount = s.ptys.length;
      const refused = recordingTerminal();

      s.table.spawn(request, refused.subscriber);

      expect(refused.closed).toEqual([
        { id: closedId ?? 'a', exit: { code: null, signal: null, error } },
      ]);
      expect(s.ptys).toHaveLength(ptyCount);
      expect(s.ptys.map((pty) => pty.kills())).toEqual(killsBefore);
    },
  );

  it('writeResizeKill_HeldAndUnheldIds_ReachTheHeldShellOnly', () => {
    const { table, spawnShell } = setUp();
    const shell = spawnShell('a');

    table.write('a', 'ls');
    table.resize('a', 90, 20);
    table.write('b', 'x');
    table.resize('b', 10, 5);
    table.kill('b');

    expect(shell.written).toEqual(['ls']);
    expect(shell.resizes).toEqual([{ cols: 90, rows: 20 }]);
    expect(shell.kills()).toBe(0);

    table.kill('a');

    expect(shell.kills()).toBe(1);
    expect(table.list()).toEqual([{ id: 'a', startedAt: 0, running: false }]);
    expect(table.attach('a', recordingTerminal().subscriber)).toEqual({
      replay: '',
      running: false,
    });
  });

  it('endAll_TwoShells_KillsEachAtOnce', () => {
    const { table, spawnShell } = setUp();
    const shells = [spawnShell('a'), spawnShell('b')];

    table.endAll();

    expect(shells.map((shell) => shell.kills())).toEqual([1, 1]);
    expect(table.list()).toEqual([
      { id: 'a', startedAt: 0, running: false },
      { id: 'b', startedAt: 0, running: false },
    ]);
  });

  it.each([
    { name: 'an empty table', ids: [] as string[] },
    { name: 'two shells', ids: ['a', 'b'] },
  ])('stopAll_Cases_CallsDoneOnceTheTableIsEmpty: $name', ({ ids }) => {
    const { table, spawnShell } = setUp();
    const shells = ids.map((id) => spawnShell(id));
    let doneCount = 0;

    table.stopAll(() => {
      doneCount += 1;
    });

    expect(shells.map((shell) => shell.kills())).toEqual(ids.map(() => 1));
    expect(table.list().map(({ running }) => running)).toEqual(
      ids.map(() => false),
    );
    for (const shell of shells) {
      expect(doneCount).toBe(0);
      shell.exit();
    }
    expect(doneCount).toBe(1);
  });

  it.each([
    { name: 'kill', end: (table: TerminalTable) => table.kill('a') },
    { name: 'endAll', end: (table: TerminalTable) => table.endAll() },
    {
      name: 'stopAll',
      end: (table: TerminalTable) => table.stopAll(() => {}),
    },
  ])('end_Cases_SendsSigkillAfterTheGrace: $name', ({ end }) => {
    const { table, time, spawnShell, recorded } = setUp();
    const shell = spawnShell('a');

    end(table);
    time.advanceTo(HOST_END_GRACE_MS - 1);
    table.kill('a');

    expect(shell.kills()).toBe(1);
    expect(recorded[0].kills).toBe(0);
    time.advanceTo(HOST_END_GRACE_MS);
    expect(recorded[0].kills).toBe(1);
    // A second timer from the second kill would fire by now.
    time.advanceTo(HOST_END_GRACE_MS * 3);
    expect(recorded[0].kills).toBe(1);
  });

  it('kill_ShellExitsFirst_SendsNoSigkill', () => {
    const { table, time, spawnShell, recorded } = setUp();
    const shell = spawnShell('a');

    table.kill('a');
    shell.exit({ exitCode: 0, signal: 1 });
    time.advanceTo(HOST_END_GRACE_MS);

    expect(recorded[0].kills).toBe(0);
  });
});
