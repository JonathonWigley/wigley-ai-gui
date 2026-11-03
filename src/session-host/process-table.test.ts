import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProcessTable, type HostSpawn } from './process-table';
import {
  type FakeChild,
  fakeChild,
  manualTime,
  recordingSubscriber,
  spawnRequest,
  streamsDelivered,
} from './session-host-test-doubles';

const HOUR_MS = 3_600_000;
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function setUp(start = 0, spawnOverride?: HostSpawn) {
  const folder = mkdtempSync(path.join(tmpdir(), 'process-table-'));
  folders.push(folder);
  const logsFolder = path.join(folder, 'logs');
  mkdirSync(logsFolder);
  const time = manualTime(start);
  const children: FakeChild[] = [];
  const spawn: HostSpawn = () => {
    const fake = fakeChild();
    children.push(fake);
    return fake.child;
  };
  const diagnosticLines: string[] = [];
  const table = createProcessTable({
    spawn: spawnOverride ?? spawn,
    clock: time.clock,
    timers: time.timers,
    logsFolder,
    diagnostics: {
      append: (message) => diagnosticLines.push(message),
      empty: () => {},
    },
    processClosed: () => {},
  });
  const logFile = (name: string) => path.join(logsFolder, name);
  const logRecords = (name: string) => readFileSync(logFile(name), 'utf8');
  return { table, time, children, logFile, logRecords, diagnosticLines };
}

describe('process table', () => {
  it('spawn_LinesBothWays_AppendsRecordsInSeqOrder', async () => {
    const { table, children, logRecords } = setUp(1000);
    const { subscriber, lines } = recordingSubscriber();
    table.spawn(spawnRequest('a'), subscriber);

    table.write('a', 'hi');
    children[0].stdout.write('ok\n');
    await streamsDelivered();

    expect(logRecords('a.jsonl')).toBe(
      '{"seq":1,"dir":"in","at":1000,"text":"hi"}\n' +
        '{"seq":2,"dir":"out","at":1000,"text":"ok"}\n',
    );
    expect(lines).toEqual([{ seq: 2, dir: 'out', at: 1000, text: 'ok' }]);
  });

  it('write_ToAProcess_SendsTheTextWithItsNewline', async () => {
    const { table, children } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);
    const written: string[] = [];
    children[0].stdin.on('data', (chunk: Buffer) =>
      written.push(chunk.toString()),
    );

    table.write('a', 'hi');
    await streamsDelivered();

    expect(written).toEqual(['hi\n']);
  });

  it.each([
    { label: 'start', steps: [], idle: true },
    { label: 'in', steps: [['in', 'hi']], idle: false },
    {
      label: 'out matching the rule',
      steps: [
        ['in', 'hi'],
        ['out', '{"type":"result"}'],
      ],
      idle: true,
    },
    {
      label: 'out with another value',
      steps: [
        ['in', 'hi'],
        ['out', '{"type":"result"}'],
        ['out', '{"type":"assistant"}'],
      ],
      idle: false,
    },
    {
      label: 'out not JSON',
      steps: [
        ['in', 'hi'],
        ['out', '{"type":"result"}'],
        ['out', 'not json'],
      ],
      idle: false,
    },
    {
      label: 'out JSON null',
      steps: [
        ['in', 'hi'],
        ['out', '{"type":"result"}'],
        ['out', 'null'],
      ],
      idle: false,
    },
    {
      label: 'err after idle',
      steps: [
        ['in', 'hi'],
        ['out', '{"type":"result"}'],
        ['err', 'warning'],
      ],
      idle: true,
    },
  ])(
    'idleRule_LineCases_SetsTheState: $label → idle $idle',
    async ({ steps, idle }) => {
      const { table, time, children } = setUp();
      table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);
      for (const [dir, text] of steps) {
        if (dir === 'in') {
          table.write('a', text);
        } else {
          (dir === 'out' ? children[0].stdout : children[0].stderr).write(
            `${text}\n`,
          );
        }
      }
      await streamsDelivered();

      time.advanceTo(HOUR_MS);

      expect(children[0].stdin.writableEnded).toBe(idle);
    },
  );

  it('keepWindow_IdleNoClient_EndsAfterTheWindowThenGraces', async () => {
    const { table, time, children } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);
    table.write('a', 'hi');
    children[0].stdout.write('{"type":"result"}\n');
    await streamsDelivered();

    time.advanceTo(HOUR_MS - 1);
    expect(children[0].stdin.writableEnded).toBe(false);
    time.advanceTo(HOUR_MS);
    expect(children[0].stdin.writableEnded).toBe(true);
    expect(children[0].signals).toEqual([]);

    time.advanceTo(HOUR_MS + 2999);
    expect(children[0].signals).toEqual([]);
    time.advanceTo(HOUR_MS + 3000);
    expect(children[0].signals).toEqual(['SIGTERM']);
    time.advanceTo(HOUR_MS + 5999);
    expect(children[0].signals).toEqual(['SIGTERM']);
    time.advanceTo(HOUR_MS + 6000);
    expect(children[0].signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('keepWindow_ClientConnected_EndsNothingUntilItLeaves', async () => {
    const { table, time, children } = setUp();
    table.setClientConnected(true);
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);
    children[0].stdout.write('{"type":"result"}\n');
    await streamsDelivered();

    time.advanceTo(HOUR_MS);
    expect(children[0].stdin.writableEnded).toBe(false);

    time.advanceTo(5_000_000);
    table.setClientConnected(false);
    time.advanceTo(8_599_999);
    expect(children[0].stdin.writableEnded).toBe(false);
    time.advanceTo(8_600_000);
    expect(children[0].stdin.writableEnded).toBe(true);
  });

  it('keepWindow_ClientComesBack_CancelsTheTimer', () => {
    const { table, time, children } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);

    time.advanceTo(1000);
    table.setClientConnected(true);
    time.advanceTo(2 * HOUR_MS);

    expect(children[0].stdin.writableEnded).toBe(false);
  });

  it('keepWindow_ProcessTurnsBusy_CancelsTheTimer', async () => {
    const { table, time, children } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);

    time.advanceTo(1000);
    children[0].stdout.write('{"type":"assistant"}\n');
    await streamsDelivered();
    time.advanceTo(2 * HOUR_MS);

    expect(children[0].stdin.writableEnded).toBe(false);
  });

  it('keepWindow_IdleAfterTheClientLeft_CountsFromTheIdleMoment', async () => {
    const { table, time, children } = setUp();
    table.setClientConnected(true);
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);
    table.write('a', 'hi');
    table.setClientConnected(false);

    time.advanceTo(1000);
    children[0].stdout.write('{"type":"result"}\n');
    await streamsDelivered();

    time.advanceTo(HOUR_MS + 999);
    expect(children[0].stdin.writableEnded).toBe(false);
    time.advanceTo(HOUR_MS + 1000);
    expect(children[0].stdin.writableEnded).toBe(true);
  });

  it('setKeepIdle_LongerWindow_ReArmsTheTimer', () => {
    const { table, time, children } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);

    table.setKeepIdleMinutes(120);
    time.advanceTo(2 * HOUR_MS - 1);
    expect(children[0].stdin.writableEnded).toBe(false);
    time.advanceTo(2 * HOUR_MS);
    expect(children[0].stdin.writableEnded).toBe(true);
  });

  it('setKeepIdle_Zero_EndsAnIdleUnattachedProcessAtOnce', () => {
    const { table, time, children } = setUp(5000);
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);

    table.setKeepIdleMinutes(0);
    time.advanceTo(5000);

    expect(children[0].stdin.writableEnded).toBe(true);
  });

  it('close_EndsPendingSignals_AndDeletesTheLog', () => {
    const { table, time, children, logFile } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);
    time.advanceTo(HOUR_MS);

    time.advanceTo(3_601_000);
    children[0].close();
    time.advanceTo(HOUR_MS + 6000);

    expect(children[0].signals).toEqual([]);
    expect(existsSync(logFile('a.jsonl'))).toBe(false);
    expect(table.list()).toEqual([]);
  });

  it.each([
    {
      label: 'duplicate id',
      draining: false,
      error: 'a process with id a already exists',
    },
    {
      label: 'draining',
      draining: true,
      error: 'the session host is draining',
    },
  ])('spawn_Refusals_CloseWithTheReason: $label', ({ draining, error }) => {
    const { table, children } = setUp();
    const first = recordingSubscriber();
    table.spawn(spawnRequest('a'), first.subscriber);
    if (draining) {
      table.drain();
    }
    const second = recordingSubscriber();

    table.spawn(spawnRequest('a'), second.subscriber);

    expect(second.closed).toEqual([
      { id: 'a', exit: { code: null, signal: null, error } },
    ]);
    expect(first.closed).toEqual([]);
    expect(children).toHaveLength(1);
  });

  it('spawn_ChildError_ClosesWithTheMessage', () => {
    const failing = fakeChild(false);
    const { table } = setUp(0, () => failing.child);
    const { subscriber, closed } = recordingSubscriber();
    table.spawn(spawnRequest('a'), subscriber);

    failing.emitError(new Error('spawn x ENOENT'));
    failing.close(-2);

    expect(closed).toEqual([
      {
        id: 'a',
        exit: { code: null, signal: null, error: 'spawn x ENOENT' },
      },
    ]);
    expect(table.list()).toEqual([]);
  });

  it('spawn_ThrowsOnBadArguments_ClosesWithTheMessageAndNoLog', () => {
    const { table, logFile } = setUp(0, () => {
      throw new Error('bad argument');
    });
    const { subscriber, closed } = recordingSubscriber();

    table.spawn(spawnRequest('a'), subscriber);

    expect(closed).toEqual([
      { id: 'a', exit: { code: null, signal: null, error: 'bad argument' } },
    ]);
    expect(existsSync(logFile('a.jsonl'))).toBe(false);
  });

  it('childError_AfterItRan_LogsAndWaitsForClose', () => {
    const { table, children, diagnosticLines } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);

    children[0].emitError(new Error('kill failed'));

    expect(table.list().map(({ id }) => id)).toEqual(['a']);
    expect(diagnosticLines).toHaveLength(1);
    expect(diagnosticLines[0]).toContain('kill failed');
  });

  it('close_RespawnedId_LateCloseLeavesTheNewProcess', () => {
    const { table, children } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);
    children[0].close();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);

    children[0].close();

    expect(table.list().map(({ id }) => id)).toEqual(['a']);
  });

  it('pipeLog_PartialLastLine_IsLoggedBeforeClose', async () => {
    const { table, children, logRecords } = setUp(1000);
    const { subscriber, lines } = recordingSubscriber();
    let fileAtClose = '';
    table.spawn(spawnRequest('a'), {
      line: subscriber.line,
      closed: () => {
        fileAtClose = logRecords('a.jsonl');
      },
    });

    children[0].stdout.end('{"a":1}\n{"b"');
    await streamsDelivered();
    children[0].close();

    expect(fileAtClose).toBe(
      `${JSON.stringify({ seq: 1, dir: 'out', at: 1000, text: '{"a":1}' })}\n` +
        `${JSON.stringify({ seq: 2, dir: 'out', at: 1000, text: '{"b"' })}\n`,
    );
    expect(lines.map(({ text }) => text)).toEqual(['{"a":1}', '{"b"']);
  });

  it('unknownId_WriteEndInputKill_DoNothing', () => {
    const { table, children } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);

    table.write('b', 'hi');
    table.endInput('b');
    table.kill('b', 'SIGTERM');

    expect(children[0].stdin.writableEnded).toBe(false);
    expect(children[0].signals).toEqual([]);
  });

  it('endInputAndKill_KnownId_ReachTheChild', () => {
    const { table, children } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);

    table.endInput('a');
    table.kill('a', 'SIGKILL');

    expect(children[0].stdin.writableEnded).toBe(true);
    expect(children[0].signals).toEqual(['SIGKILL']);
  });
});
