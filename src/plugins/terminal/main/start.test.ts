import { describe, expect, it } from 'vitest';
import type { ProgramCandidate } from '../../../contracts/platform';
import type { PartStop } from '../../../contracts/plugin';
import type { TerminalExit, TerminalHost } from '../../../contracts/terminals';
import {
  createFakeTerminalHost,
  type FakeTerminalHost,
  type FakeTerminalRecord,
} from '../../../shared/fake-terminal-host';
import {
  deferred,
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type SessionRow,
  type SessionsMainExports,
  sessionsMainKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import { type TerminalOpened, terminalOutputSlot } from '../contract';
import { TERMINAL_SESSION_NOTE } from './session-note';
import { terminalMainPart } from './start';

// The harness's `randomUuid` gives these in order: shell id 1, then 2.
function shellId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

const EXITED: TerminalExit = { code: 0, signal: null, error: null };
const ZSH: ProgramCandidate = { command: '/bin/zsh', args: ['-l'] };
const ALPHA = sessionRow('s1', { label: 'alpha', projectDir: '/work/alpha' });

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface StartOptions {
  rows?: readonly SessionRow[];
  // The shells the host runs before the part starts.
  running?: readonly { id: string; output: string }[];
  // The terminals the part gets, over the fake host; the host itself when left out.
  terminals?(host: FakeTerminalHost): TerminalHost;
}

// The part on the harness over a fake shell host, with row `s1` (`alpha` in
// `/work/alpha`) unless `rows` says otherwise. `notes` holds chat's live
// instructions.
function startOnHarness(options: StartOptions = {}) {
  const host = createFakeTerminalHost({ now: () => 0 });
  for (const { id, output } of options.running ?? []) {
    host.addRunning({ id, startedAt: 0, output });
  }
  const notes = new Set<string>();
  const harness = startMainPart(terminalMainPart, {
    services: { terminals: options.terminals?.(host) ?? host },
    dependencies: [
      fakeDependency(
        chatMainKey,
        (consumer) =>
          ({
            addInstructions(text: string) {
              notes.add(text);
              return consumer.track({
                dispose() {
                  notes.delete(text);
                },
              });
            },
            restored: () => Promise.resolve(),
          }) as unknown as ChatMainExports,
      ),
      fakeDependency(sessionsMainKey, () => ({}) as SessionsMainExports),
    ],
  });
  const rows = harness.state.publish(sessionsRowsSlot);
  for (const row of options.rows ?? [ALPHA]) {
    rows.set(row.sessionId, row);
  }
  const part = {
    harness,
    host,
    notes,
    open: (sessionId: string, cols: number, rowCount: number) =>
      harness.invoke(
        'open',
        sessionId,
        cols,
        rowCount,
      ) as Promise<TerminalOpened>,
    restart: (sessionId: string, cols: number, rowCount: number) =>
      harness.invoke(
        'restart',
        sessionId,
        cols,
        rowCount,
      ) as Promise<TerminalOpened>,
    type: (arg: string, callerSessionId: string | undefined = 's1') =>
      harness.started().commands.type({ arg, callerSessionId }),
    record: (index: number): FakeTerminalRecord => {
      const record = host.terminals[index];
      if (record === undefined) {
        throw new Error(`no record ${index}`);
      }
      return record;
    },
    sentOf: (message: string) =>
      harness.sent
        .filter((sent) => sent.message === message)
        .map(({ data }) => data),
    output: (sessionId: string) =>
      harness.state.read(terminalOutputSlot, 'test').get(sessionId),
    // Runs every part's `ready` and lets the adoption settle.
    async ready() {
      harness.ready();
      await flush();
    },
    // Ready, then a shell open for `s1` at 100×30 with its prompt arrived.
    async openShell() {
      await part.ready();
      await part.open('s1', 100, 30);
      await flush();
    },
  };
  return part;
}

describe('terminalMainPart', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness } = startOnHarness();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startOnHarness();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it('start_HandsChatTheSessionNote', () => {
    const { notes } = startOnHarness();

    expect([...notes]).toEqual([TERMINAL_SESSION_NOTE]);
  });

  it.each([
    {
      case: 'NoCaller',
      arg: 'gcloud auth login',
      caller: undefined,
      error: 'terminal.type needs a calling session',
    },
    {
      case: 'LineFeed',
      arg: 'a\nb',
      caller: 's1',
      error: 'terminal.type takes one line: the text holds a line break',
    },
    {
      case: 'CarriageReturn',
      arg: 'a\rb',
      caller: 's1',
      error: 'terminal.type takes one line: the text holds a line break',
    },
  ])('type_Refused_$case', async ({ arg, caller, error }) => {
    const part = startOnHarness();
    await part.ready();

    await expect(
      part.harness.started().commands.type({ arg, callerSessionId: caller }),
    ).rejects.toThrow(error);

    expect(part.host.terminals).toEqual([]);
  });

  it('type_NoShell_SpawnsWritesAndSendsTyped', async () => {
    const part = startOnHarness();
    await part.ready();

    await part.type('gcloud auth login');

    expect(part.host.terminals).toHaveLength(1);
    expect(part.record(0).request).toEqual({
      id: 's1',
      command: '/bin/zsh',
      args: ['-l'],
      cwd: '/work/alpha',
      cols: 80,
      rows: 24,
    });
    expect(part.record(0).writes).toEqual(['gcloud auth login']);
    expect(part.harness.sent).toContainEqual({
      message: 'typed',
      data: { sessionId: 's1', shell: shellId(1), text: 'gcloud auth login' },
    });
  });

  it.each([
    { case: 'RowWithProjectDir', rows: [ALPHA], cwd: '/work/alpha' },
    {
      case: 'RowWithNoProjectDir',
      rows: [sessionRow('s1', { projectDir: null })],
      cwd: '/home',
    },
    { case: 'NoRow', rows: [], cwd: '/home' },
  ])('spawn_Folder_$case', async ({ rows, cwd }) => {
    const part = startOnHarness({ rows });
    await part.ready();

    const opened = await part.open('s1', 100, 30);

    expect(part.record(0).request?.cwd).toBe(cwd);
    expect(opened.folder).toBe(cwd);
  });

  it.each([
    { case: 'NoColumns', cols: 0, rows: 30 },
    { case: 'NoRows', cols: 100, rows: 0 },
  ])('open_SizeBelowOne_SpawnsAt80x24_$case', async ({ cols, rows }) => {
    const part = startOnHarness();
    await part.ready();

    await part.open('s1', cols, rows);

    expect(part.record(0).request).toMatchObject({ cols: 80, rows: 24 });
  });

  it('type_NoShellProgram_Throws', async () => {
    const part = startOnHarness();
    part.harness.processes.scriptProgram('shell', null);
    await part.ready();

    await expect(part.type('ls')).rejects.toThrow(
      'terminal found no shell program to start',
    );

    expect(part.host.terminals).toEqual([]);
  });

  it('open_Twice_SpawnsOnceAndResizes', async () => {
    const part = startOnHarness();
    await part.ready();

    await part.open('s1', 100, 30);
    await part.open('s1', 100, 30);

    expect(part.host.terminals).toHaveLength(1);
    expect(part.record(0).resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it.each([
    {
      case: 'ResizeBelowOneOfARunningShell',
      act: async (part: ReturnType<typeof startOnHarness>) => {
        await part.open('s1', 0, 24);
      },
    },
    {
      case: 'WriteToAnExitedShell',
      act: async (part: ReturnType<typeof startOnHarness>) => {
        part.host.close('s1', EXITED);
        part.harness.invoke('write', 's1', 'x');
      },
    },
  ])('ignored_$case', async ({ act }) => {
    const part = startOnHarness();
    await part.openShell();

    await act(part);

    expect(part.record(0).resizes).toEqual([]);
    expect(part.record(0).writes).toEqual([]);
  });

  // `resolveProgram` answers only when the test resolves it, after the open
  // reached it.
  async function resolvingShell(part: ReturnType<typeof startOnHarness>) {
    await part.ready();
    const program = deferred<ProgramCandidate | null>();
    let resolves = 0;
    part.harness.processes.resolveProgram = () => {
      resolves += 1;
      return program.promise;
    };
    const opening = part.open('s1', 100, 30);
    while (resolves === 0) {
      await Promise.resolve();
    }
    return { program, opening };
  }

  it('openAndType_WhileResolving_SpawnOnce', async () => {
    const part = startOnHarness();
    const { program, opening } = await resolvingShell(part);

    const typing = part.type('ls');
    await Promise.resolve();
    program.resolve(ZSH);
    await Promise.all([opening, typing]);

    expect(part.host.terminals).toHaveLength(1);
    expect(part.record(0).request).toMatchObject({ cols: 100, rows: 30 });
    expect(part.record(0).writes).toEqual(['ls']);
  });

  it('closed_WhileResolving_SpawnsNothing', async () => {
    const part = startOnHarness();
    const { program, opening } = await resolvingShell(part);

    part.harness.emit('sessions.closed', { sessionId: 's1' });
    program.resolve(ZSH);

    await expect(opening).rejects.toThrow(
      'terminal: the shell start for s1 was cancelled',
    );
    expect(part.host.terminals).toEqual([]);
  });

  it('data_SendsSeqAndOpenReturnsTheBuffer', async () => {
    const part = startOnHarness();
    await part.openShell();

    part.host.output('s1', 'x');
    const opened = await part.open('s1', 100, 30);

    expect(part.sentOf('data')).toEqual([
      { sessionId: 's1', shell: shellId(1), chunk: '$ ', seq: 1 },
      { sessionId: 's1', shell: shellId(1), chunk: 'x', seq: 2 },
    ]);
    expect(opened).toEqual({
      shell: shellId(1),
      buffer: '$ x',
      seq: 2,
      folder: '/work/alpha',
      exit: null,
    });
  });

  it('closed_SendsExitedAndOpenReportsIt', async () => {
    const part = startOnHarness();
    await part.openShell();

    part.host.close('s1', EXITED);
    const opened = await part.open('s1', 100, 30);

    expect(part.sentOf('exited')).toEqual([
      { sessionId: 's1', shell: shellId(1), exit: EXITED },
    ]);
    expect(opened.exit).toEqual(EXITED);
    expect(part.host.terminals).toHaveLength(1);
  });

  it('replaceExited_Restart', async () => {
    const part = startOnHarness();
    await part.openShell();
    part.host.close('s1', EXITED);

    const opened = await part.restart('s1', 90, 20);
    await flush();

    expect(part.host.terminals).toHaveLength(2);
    expect(part.record(1).request).toMatchObject({ cols: 90, rows: 20 });
    expect(opened).toMatchObject({ shell: shellId(2), seq: 0, exit: null });
    expect(part.record(0).kills).toBe(0);
    expect(part.sentOf('exited')).toHaveLength(1);
  });

  it('replaceExited_Type', async () => {
    const part = startOnHarness();
    await part.openShell();
    part.host.close('s1', EXITED);

    await part.type('ls');
    await flush();

    expect(part.host.terminals).toHaveLength(2);
    expect(part.record(1).request).toMatchObject({ cols: 80, rows: 24 });
    expect(part.record(1).writes).toEqual(['ls']);
    expect(part.sentOf('typed')).toEqual([
      { sessionId: 's1', shell: shellId(2), text: 'ls' },
    ]);
    expect(part.record(0).kills).toBe(0);
    expect(part.sentOf('exited')).toHaveLength(1);
  });

  it('restart_Running_ResizesAndSpawnsNothing', async () => {
    const part = startOnHarness();
    await part.openShell();

    const opened = await part.restart('s1', 90, 20);

    expect(part.host.terminals).toHaveLength(1);
    expect(part.record(0).resizes).toEqual([{ cols: 90, rows: 20 }]);
    expect(part.record(0).kills).toBe(0);
    expect(opened.shell).toBe(shellId(1));
  });

  it.each([
    { event: 'sessions.closed', kills: 1, keepsOutput: false },
    { event: 'sessions.ended', kills: 0, keepsOutput: true },
  ])('sessionsEvent_$event', async ({ event, kills, keepsOutput }) => {
    const part = startOnHarness();
    await part.openShell();
    part.harness.advance(250);
    expect(part.output('s1')).toBe('$');

    part.harness.emit(event, { sessionId: 's1' });
    await flush();

    expect(part.record(0).kills).toBe(kills);
    expect(part.output('s1') !== undefined).toBe(keepsOutput);
    expect(part.sentOf('exited')).toEqual([]);
  });

  it('ready_Adopts_RunningWithARow', async () => {
    const part = startOnHarness({ running: [{ id: 's1', output: 'hello' }] });
    await part.ready();

    const opened = await part.open('s1', 100, 30);

    expect(part.record(0).events).not.toBeNull();
    expect(opened).toEqual({
      shell: shellId(1),
      buffer: 'hello',
      seq: 1,
      folder: '/work/alpha',
      exit: null,
    });
    expect(part.host.terminals).toHaveLength(1);
  });

  it('ready_Adopts_RunningWithNoRow', async () => {
    const part = startOnHarness({ running: [{ id: 's9', output: 'hello' }] });

    await part.ready();

    expect(part.record(0).kills).toBe(1);
  });

  it('ready_OpenBeforeAdoption_WaitsAndSpawnsNothing', async () => {
    const part = startOnHarness({ running: [{ id: 's1', output: 'hello' }] });

    const opening = part.open('s1', 100, 30);
    await part.ready();

    await expect(opening).resolves.toMatchObject({
      shell: shellId(1),
      buffer: 'hello',
      seq: 1,
    });
    expect(part.host.terminals).toHaveLength(1);
  });

  it('ready_ListRejects_LogsAndOpenSpawns', async () => {
    const part = startOnHarness({
      terminals: (host) => ({
        spawn: (request, events) => host.spawn(request, events),
        attach: (id, events) => host.attach(id, events),
        list: () => Promise.reject(new Error('host gone')),
      }),
    });

    const opening = part.open('s1', 100, 30);
    await part.ready();
    await opening;

    expect(part.harness.logs).toContainEqual({
      source: 'terminal',
      message: 'adoption failed: host gone',
    });
    expect(part.host.terminals).toHaveLength(1);
    expect(part.record(0).request).toMatchObject({ cols: 100, rows: 30 });
  });

  it('outputSlot_CoalescesWithin250Ms', async () => {
    const part = startOnHarness();
    await part.openShell();
    const writes: (string | undefined)[] = [];
    part.harness.state
      .read(terminalOutputSlot, 'test')
      .on((_key, value) => writes.push(value));

    part.host.output('s1', 'a\r\n');
    part.harness.advance(100);
    part.host.output('s1', 'b');
    part.harness.advance(149);
    expect(part.output('s1')).toBeUndefined();
    part.harness.advance(1);

    expect(part.output('s1')).toBe('$ a\nb');
    expect(writes).toEqual(['$ a\nb']);
  });

  it.each([
    { stop: 'restart', detaches: 1, kills: 0, keepsOutput: true },
    { stop: 'quit', detaches: 1, kills: 0, keepsOutput: true },
    { stop: 'end', detaches: 0, kills: 1, keepsOutput: false },
  ] satisfies {
    stop: PartStop;
    detaches: number;
    kills: number;
    keepsOutput: boolean;
  }[])('dispose_$stop', async ({ stop, detaches, kills, keepsOutput }) => {
    const part = startOnHarness();
    await part.openShell();
    part.harness.advance(250);

    await part.harness.stop(stop);

    expect(part.record(0).detaches).toBe(detaches);
    expect(part.record(0).kills).toBe(kills);
    expect(part.output('s1') !== undefined).toBe(keepsOutput);
  });
});
