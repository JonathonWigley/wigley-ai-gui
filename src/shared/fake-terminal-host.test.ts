import { describe, expect, it } from 'vitest';
import {
  TERMINAL_REPLAY_LIMIT,
  type TerminalEvents,
  type TerminalExit,
  type TerminalProcess,
  type TerminalSpawn,
} from '../contracts/terminals';
import {
  createFakeTerminalHost,
  type FakeTerminalHost,
} from './fake-terminal-host';

const EXITED: TerminalExit = { code: 0, signal: null, error: null };
const KILLED: TerminalExit = { code: null, signal: 1, error: null };
const ENDED: TerminalExit = { code: 1, signal: null, error: null };

function request(id: string): TerminalSpawn {
  return { id, command: '/bin/zsh', args: ['-l'], cwd: '/work', cols: 80, rows: 24 };
}

// Events that record what they hear.
function heard() {
  const data: string[] = [];
  const closed: TerminalExit[] = [];
  const events: TerminalEvents = {
    data: (chunk) => data.push(chunk),
    closed: (exit) => closed.push(exit),
  };
  return { data, closed, events };
}

function afterMicrotask(): Promise<void> {
  return Promise.resolve();
}

let now = 0;
const clock = { now: () => now };

function setUp(): FakeTerminalHost {
  now = 0;
  return createFakeTerminalHost(clock);
}

// A host with shell `s1` spawned and its prompt written.
async function prompted() {
  const host = setUp();
  const listener = heard();
  const process = host.spawn(request('s1'), listener.events);
  await afterMicrotask();
  return { host, listener, process, record: host.terminals[0] };
}

describe('createFakeTerminalHost', () => {
  it('spawn writes the prompt after the call returns', async () => {
    const host = setUp();
    const listener = heard();

    host.spawn(request('s1'), listener.events);
    expect(listener.data).toEqual([]);

    await afterMicrotask();
    expect(listener.data).toEqual(['$ ']);
  });

  it('writes no prompt to a shell closed before the prompt', async () => {
    const host = setUp();
    const listener = heard();

    host.spawn(request('s1'), listener.events);
    host.close('s1', ENDED);
    await afterMicrotask();

    expect(listener.data).toEqual([]);
  });

  it.each([
    { writes: ['ls\r'], chunks: ['ls\r\nran: ls\r\n$ '] },
    { writes: ['l', 's', '\r'], chunks: ['l', 's', '\r\nran: ls\r\n$ '] },
    { writes: ['lx\x7fs\r'], chunks: ['lx\b \bs\r\nran: ls\r\n$ '] },
    { writes: ['\x7fls\r'], chunks: ['ls\r\nran: ls\r\n$ '] },
    { writes: ['\r'], chunks: ['\r\nran: \r\n$ '] },
  ])('answers each line it is typed: $writes', async ({ writes, chunks }) => {
    const { listener, process } = await prompted();

    for (const data of writes) {
      process.write(data);
    }

    expect(listener.data).toEqual(['$ ', ...chunks]);
  });

  it('closes with code 0 after an exit line', async () => {
    const { host, listener, process } = await prompted();

    process.write('exit\r');
    expect(listener.closed).toEqual([]);
    const listedDuring = host.list();
    await afterMicrotask();

    expect(await listedDuring).toEqual([
      { id: 's1', startedAt: 0, running: true },
    ]);
    expect(listener.closed).toEqual([EXITED]);
    expect(await host.list()).toEqual([]);
  });

  it('kill closes with signal 1 after the call returns', async () => {
    const { host, listener, process, record } = await prompted();

    process.kill();
    expect(record.kills).toBe(1);
    expect(listener.closed).toEqual([]);
    expect(await host.list()).toEqual([
      { id: 's1', startedAt: 0, running: false },
    ]);
    process.kill();
    expect(record.kills).toBe(2);
    await afterMicrotask();

    expect(listener.closed).toEqual([KILLED]);
    expect(await host.list()).toEqual([]);
  });

  it.each([
    { name: 'a running shell', hold: (_process: TerminalProcess) => {} },
    { name: 'an ending shell', hold: (process: TerminalProcess) => process.kill() },
    {
      name: 'a detached shell',
      hold: (process: TerminalProcess) => process.detach(),
    },
  ])('refuses a spawn on an id it holds: $name', async ({ hold }) => {
    const host = setUp();
    hold(host.spawn(request('s1'), heard().events));
    const second = heard();

    const refused = host.spawn(request('s1'), second.events);
    expect(second.closed).toEqual([]);
    refused.write('x');
    await afterMicrotask();

    expect(second.closed).toEqual([
      { code: null, signal: null, error: 'a terminal with id s1 already exists' },
    ]);
    expect(host.terminals).toHaveLength(1);
    expect(host.terminals[0].writes).toEqual([]);
  });

  it('spawns again on the id of a closed shell', async () => {
    const { host, process } = await prompted();
    process.write('exit\r');
    await afterMicrotask();

    host.spawn(request('s1'), heard().events);

    expect(host.terminals).toHaveLength(2);
    expect(host.terminals[1].closed).toBeNull();
    expect((await host.list()).map((info) => info.id)).toEqual(['s1']);
  });

  it.each([
    {
      name: 'the record closed',
      end: (host: FakeTerminalHost, _process: TerminalProcess) =>
        host.close('s1', ENDED),
    },
    {
      name: 'the handle detached',
      end: (_host: FakeTerminalHost, process: TerminalProcess) =>
        process.detach(),
    },
  ])(
    'does nothing through a handle that is not active: $name',
    async ({ end }) => {
      const { host, listener, process, record } = await prompted();
      end(host, process);
      const counts = {
        writes: [...record.writes],
        resizes: [...record.resizes],
        kills: record.kills,
        detaches: record.detaches,
      };
      const closedBefore = [...listener.closed];

      process.write('x');
      process.resize(90, 20);
      process.kill();
      process.detach();
      await afterMicrotask();

      expect({
        writes: record.writes,
        resizes: record.resizes,
        kills: record.kills,
        detaches: record.detaches,
      }).toEqual(counts);
      expect(listener.closed).toEqual(closedBefore);
    },
  );

  it('records each resize', async () => {
    const { process, record } = await prompted();

    process.resize(90, 20);
    process.resize(100, 30);

    expect(record.resizes).toEqual([
      { cols: 90, rows: 20 },
      { cols: 100, rows: 30 },
    ]);
  });

  it('lists open shells in add order with their start time', async () => {
    const host = setUp();
    now = 5;
    host.spawn(request('a'), heard().events);
    host.addRunning({ id: 'b', startedAt: 3, output: '' });
    now = 9;
    host.spawn(request('c'), heard().events);
    host.close('c', ENDED);

    expect(await host.list()).toEqual([
      { id: 'a', startedAt: 5, running: true },
      { id: 'b', startedAt: 3, running: true },
    ]);
  });

  it('attach replays the output and moves the events', async () => {
    const { host, listener, process, record } = await prompted();
    process.write('ls\r');
    const attached = heard();

    const attach = await host.attach('s1', attached.events);
    const spawnHeard = [...listener.data];
    host.output('s1', 'x');
    process.write('pwd\r');

    expect(attach?.replay).toBe('$ ls\r\nran: ls\r\n$ ');
    expect(listener.data).toEqual(spawnHeard);
    expect(attached.data[0]).toBe('x');
    expect(record.writes).toEqual(['ls\r', 'pwd\r']);
  });

  it.each([
    { name: 'an unknown id', id: 'zz' },
    { name: 'a shell closed by exit', id: 's1' },
  ])('attach resolves null for an id with no open shell: $name', async ({ id }) => {
    const { host, process } = await prompted();
    process.write('exit\r');
    await afterMicrotask();

    expect(await host.attach(id, heard().events)).toBeNull();
  });

  it('keeps the last TERMINAL_REPLAY_LIMIT code units as the replay', () => {
    const host = setUp();
    const record = host.addRunning({
      id: 's1',
      startedAt: 0,
      output: 'a'.repeat(TERMINAL_REPLAY_LIMIT),
    });

    host.output('s1', 'bc');

    expect(record.output).toHaveLength(TERMINAL_REPLAY_LIMIT);
    expect(record.output.endsWith('bc')).toBe(true);
    expect(record.output.startsWith('a')).toBe(true);
  });

  it('detach stops the events and keeps the shell', async () => {
    const { host, listener, process, record } = await prompted();

    process.detach();
    host.output('s1', 'x');

    expect(listener.data).toEqual(['$ ']);
    expect(record.detaches).toBe(1);
    expect((await host.list()).map((info) => info.id)).toEqual(['s1']);
  });

  it.each([
    {
      name: 'output to an unknown id',
      act: (host: FakeTerminalHost) => host.output('zz', 'x'),
      error: 'no terminal zz',
    },
    {
      name: 'close of an unknown id',
      act: (host: FakeTerminalHost) => host.close('zz', ENDED),
      error: 'no terminal zz',
    },
    {
      name: 'output to a closed shell',
      act: (host: FakeTerminalHost) => {
        host.close('s1', ENDED);
        host.output('s1', 'x');
      },
      error: 'no terminal s1',
    },
    {
      name: 'a second close',
      act: (host: FakeTerminalHost) => {
        host.close('s1', ENDED);
        host.close('s1', ENDED);
      },
      error: 'no terminal s1',
    },
    {
      name: 'addRunning of a running id',
      act: (host: FakeTerminalHost) =>
        host.addRunning({ id: 's1', startedAt: 0, output: '' }),
      error: 'a terminal with id s1 already exists',
    },
  ])('test controls throw on a wrong id: $name', ({ act, error }) => {
    const host = setUp();
    host.addRunning({ id: 's1', startedAt: 0, output: '' });

    expect(() => act(host)).toThrow(error);
  });
});
