import { describe, expect, it } from 'vitest';
import type {
  HostedExit,
  HostedProcessEvents,
  HostedProcessInfo,
  HostedSpawn,
  PipeLine,
} from '../contracts/session-host';
import { createFakeSessionHost } from './fake-session-host';

const clock = { now: () => 1000 };

function spawnRequest(id: string): HostedSpawn {
  return {
    id,
    command: 'agent',
    args: [],
    cwd: '/p',
    env: {},
    inheritEnv: false,
    unsetEnv: [],
    stdin: [],
    idleRule: {
      key: 'type',
      value: 'result',
      busyStdoutValues: [],
      busyStdinValues: [],
    },
    droppedOutKeys: [],
  };
}

function recordingEvents() {
  const lines: PipeLine[] = [];
  const closed: HostedExit[] = [];
  const pids: number[] = [];
  const events: HostedProcessEvents = {
    line: (line) => lines.push(line),
    closed: (exit) => closed.push(exit),
    spawned: (pid) => pids.push(pid),
  };
  return { lines, closed, pids, events };
}

const SIGNALLED: HostedExit = { code: null, signal: 'SIGTERM', error: null };
const EXITED: HostedExit = { code: 0, signal: null, error: null };

describe('createFakeSessionHost', () => {
  it('spawn_WriteThenOutput_LogsBothDirectionsAndEchoesOnlyOut', () => {
    const host = createFakeSessionHost(clock);
    const heard = recordingEvents();

    const process = host.spawn(
      { ...spawnRequest('a'), stdin: ['opening'] },
      heard.events,
    );
    process.write('hi');
    host.output('a', 'out', 'ok');

    expect(host.processes[0].log).toEqual([
      { seq: 1, dir: 'in', at: 1000, text: 'opening' },
      { seq: 2, dir: 'in', at: 1000, text: 'hi' },
      { seq: 3, dir: 'out', at: 1000, text: 'ok' },
    ]);
    expect(heard.lines.map((line) => line.seq)).toEqual([3]);
    expect(host.processes[0].writes).toEqual(['opening', 'hi']);
  });

  it('output_AfterAddedLog_ContinuesPastItsLastSeq', () => {
    const host = createFakeSessionHost(clock);
    host.addRunning({
      id: 'a',
      startedAt: 1,
      current: true,
      log: [{ seq: 7, dir: 'out', at: 5, text: 'before' }],
    });

    expect(host.output('a', 'err', 'after').seq).toBe(8);
  });

  it.each(['unknown', 'closed'])('output_%sId_Throws', (id) => {
    const host = createFakeSessionHost(clock);
    host.spawn(spawnRequest('closed'), recordingEvents().events);
    host.close('closed', EXITED);

    expect(() => host.output(id, 'out', 'x')).toThrow(id);
  });

  it.each([
    { when: 'before an attach', spawnPids: [4321] },
    { when: 'after an attach', spawnPids: [] },
  ])(
    'spawned_ReachesTheEventsAndThePidUntilClose: $when',
    async ({ when, spawnPids }) => {
      const host = createFakeSessionHost(clock);
      const heard = recordingEvents();
      const attachHeard = recordingEvents();
      const spawned = host.spawn(spawnRequest('a'), heard.events);

      if (when === 'before an attach') {
        host.spawned('a', 4321);
      }
      const attached = await host.attach('a', attachHeard.events);
      if (when === 'after an attach') {
        host.spawned('a', 4321);
      }

      expect(heard.pids).toEqual(spawnPids);
      expect(attachHeard.pids).toEqual([]);
      expect(spawned.pid).toBe(4321);
      expect(attached?.process.pid).toBe(4321);
      host.close('a', EXITED);
      expect(spawned.pid).toBeNull();
      expect(attached?.process.pid).toBeNull();
    },
  );

  it('write_AfterClose_ChangesNothing', () => {
    const host = createFakeSessionHost(clock);
    const process = host.spawn(spawnRequest('a'), recordingEvents().events);
    host.close('a', EXITED);

    process.write('late');
    process.endInput();
    process.kill('SIGKILL');

    const [record] = host.processes;
    expect(record.writes).toEqual([]);
    expect(record.log).toEqual([]);
    expect(record.inputEnded).toBe(false);
    expect(record.kills).toEqual([]);
  });

  it.each([
    { name: 'running current', id: 'running', isAttached: true },
    { name: 'running not current', id: 'older', isAttached: false },
    { name: 'closed', id: 'closed', isAttached: false },
    { name: 'unknown id', id: 'nope', isAttached: false },
  ])(
    'attach_Cases_ResolvesByRecordState: $name',
    async ({ id, isAttached }) => {
      const host = createFakeSessionHost(clock);
      const added: PipeLine[] = [{ seq: 1, dir: 'out', at: 5, text: 'kept' }];
      host.addRunning({
        id: 'running',
        startedAt: 1,
        current: true,
        log: added,
      });
      host.addRunning({
        id: 'older',
        startedAt: 2,
        current: false,
        log: added,
      });
      host.addRunning({
        id: 'closed',
        startedAt: 3,
        current: true,
        log: added,
      });
      host.close('closed', EXITED);

      const attached = await host.attach(id, recordingEvents().events);

      expect(attached?.log ?? null).toEqual(isAttached ? added : null);
    },
  );

  it('list_OpenRecords_ListsEachWithCurrentFlag', async () => {
    const host = createFakeSessionHost(clock);
    host.addRunning({ id: 'a', startedAt: 1, current: true, log: [] });
    host.addRunning({ id: 'b', startedAt: 2, current: false, log: [] });
    host.addRunning({ id: 'c', startedAt: 3, current: true, log: [] });
    host.close('c', EXITED);

    expect(await host.list()).toEqual([
      { id: 'a', startedAt: 1, running: true, current: true },
      { id: 'b', startedAt: 2, running: true, current: false },
    ]);
  });

  it('failNextSpawn_ClosesInALaterMicrotask', async () => {
    const host = createFakeSessionHost(clock);
    const heard = recordingEvents();
    host.failNextSpawn('boom');

    host.spawn(spawnRequest('a'), heard.events);
    expect(heard.closed).toEqual([]);
    expect(host.processes).toHaveLength(1);

    await Promise.resolve();
    expect(heard.closed).toEqual([{ code: null, signal: null, error: 'boom' }]);

    host.spawn(spawnRequest('b'), recordingEvents().events);
    await Promise.resolve();
    expect(host.processes[1].closed).toBeNull();
  });

  it('spawn_DuplicateOpenId_ClosesInALaterMicrotaskAndAddsNoRecord', async () => {
    const host = createFakeSessionHost(clock);
    const first = recordingEvents();
    const second = recordingEvents();
    host.spawn(spawnRequest('a'), first.events);

    const duplicate = host.spawn(spawnRequest('a'), second.events);
    expect(second.closed).toEqual([]);

    await Promise.resolve();
    expect(second.closed).toEqual([
      {
        code: null,
        signal: null,
        error: 'a process with id a already exists',
      },
    ]);
    expect(host.processes).toHaveLength(1);
    expect(first.closed).toEqual([]);

    duplicate.write('ignored');
    duplicate.kill('SIGTERM');
    duplicate.detach();
    expect(host.processes[0].writes).toEqual([]);
    expect(host.processes[0].kills).toEqual([]);
    expect(host.processes[0].detaches).toBe(0);

    host.close('a', EXITED);
    host.spawn(spawnRequest('a'), recordingEvents().events);
    expect(host.processes).toHaveLength(2);
  });

  it('stopAll_ClosesEveryRunningCurrentProcessWithSigterm', async () => {
    const host = createFakeSessionHost(clock);
    const heard = recordingEvents();
    host.spawn(spawnRequest('a'), heard.events);
    const older = host.addRunning({
      id: 'b',
      startedAt: 1,
      current: false,
      log: [],
    });

    await host.stopAll();

    const [stopped] = host.processes;
    expect(stopped.kills).toEqual(['SIGTERM']);
    expect(stopped.closed).toEqual(SIGNALLED);
    expect(heard.closed).toEqual([SIGNALLED]);
    expect(host.stopAllCalls).toBe(1);
    expect(older.closed).toBeNull();
    expect(older.kills).toEqual([]);
  });

  it('close_Twice_FiresClosedOnce', () => {
    const host = createFakeSessionHost(clock);
    const heard = recordingEvents();
    host.spawn(spawnRequest('a'), heard.events);

    host.close('a', EXITED);
    host.close('a', SIGNALLED);

    expect(heard.closed).toEqual([EXITED]);
    expect(host.processes[0].closed).toEqual(EXITED);
  });

  it('detach_ThenOutput_DeliversNothingAndCountsTheDetach', async () => {
    const host = createFakeSessionHost(clock);
    const heard = recordingEvents();
    const process = host.spawn(spawnRequest('a'), heard.events);

    process.detach();
    const line = host.output('a', 'out', 'unheard');

    const [record] = host.processes;
    expect(record.detaches).toBe(1);
    expect(heard.lines).toEqual([]);
    expect(record.log).toEqual([line]);
    expect((await host.list()).map((info) => info.id)).toEqual(['a']);
  });

  it('attach_Twice_OnlyTheLatestEventsGetLines', async () => {
    const host = createFakeSessionHost(clock);
    const first = recordingEvents();
    const second = recordingEvents();
    host.addRunning({ id: 'a', startedAt: 1, current: true, log: [] });
    const firstAttach = await host.attach('a', first.events);
    await host.attach('a', second.events);

    firstAttach?.process.detach();
    host.output('a', 'out', 'ok');

    expect(first.lines).toEqual([]);
    expect(second.lines.map((line) => line.text)).toEqual(['ok']);
  });

  it('setList_Infos_ListResolvesThem', async () => {
    const host = createFakeSessionHost(clock);
    host.addRunning({ id: 'a', startedAt: 1, current: true, log: [] });
    const infos: HostedProcessInfo[] = [
      { id: 'set', startedAt: 9, running: false, current: false },
    ];

    host.setList(infos);
    expect(await host.list()).toEqual(infos);

    host.setList(null);
    expect((await host.list()).map((info) => info.id)).toEqual(['a']);
  });

  it('failList_Error_ListRejectsUntilCleared', async () => {
    const host = createFakeSessionHost(clock);
    host.addRunning({ id: 'a', startedAt: 1, current: true, log: [] });
    host.setList([]);

    host.failList('no host');
    await expect(host.list()).rejects.toThrow('no host');

    host.failList(null);
    host.setList(null);
    expect((await host.list()).map((info) => info.id)).toEqual(['a']);
  });
});
