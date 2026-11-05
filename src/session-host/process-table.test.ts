import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import {
  type ChildProcessWithoutNullStreams,
  spawn as spawnChild,
} from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_END_GRACE_MS } from '../contracts/session-host-protocol';
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
const USER = '{"type":"user"}';
const RESULT = '{"type":"result"}';
const SYSTEM = '{"type":"system"}';
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
      setAsidePrevious: () => {},
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

  it.each([
    {
      label: 'both named keys, keeping their siblings',
      dir: 'out',
      text: '{"type":"reply","reply":{"body":{"secret":{"env":{"TOKEN":"s3cret"}},"copies":[{"TOKEN":"s3cret"}],"kept":{"a":1}}}}',
      delivered: '{"type":"reply","reply":{"body":{"kept":{"a":1}}}}',
    },
    {
      label: 'one named key',
      dir: 'out',
      text: '{"reply":{"body":{"secret":"s3cret","kept":2}}}',
      delivered: '{"reply":{"body":{"kept":2}}}',
    },
    {
      label: 'the key at another path',
      dir: 'out',
      text: '{ "secret" : 1 , "reply" : { "secret" : 2 } }',
      delivered: '{ "secret" : 1 , "reply" : { "secret" : 2 } }',
    },
    {
      label: 'the key named as a value on the path',
      dir: 'out',
      text: '{ "reply" : { "body" : "secret" } }',
      delivered: '{ "reply" : { "body" : "secret" } }',
    },
    {
      label: 'no named key',
      dir: 'out',
      text: '{ "type" : "assistant" }',
      delivered: '{ "type" : "assistant" }',
    },
    {
      label: 'not JSON, naming the key',
      dir: 'out',
      text: 'not json "secret"',
      delivered: 'not json "secret"',
    },
    {
      label: 'a JSON string equal to the key',
      dir: 'out',
      text: '"secret"',
      delivered: '"secret"',
    },
    {
      label: 'an err line',
      dir: 'err',
      text: '{"reply":{"body":{"secret":"s3cret"}}}',
      delivered: '{"reply":{"body":{"secret":"s3cret"}}}',
    },
  ])(
    'droppedOutKeys_LineCases_LogAndSubscriberAgree: $label',
    async ({ dir, text, delivered }) => {
      const { table, children, logRecords } = setUp();
      const { subscriber, lines } = recordingSubscriber();
      table.spawn(
        {
          ...spawnRequest('a'),
          droppedOutKeys: [
            ['reply', 'body', 'secret'],
            ['reply', 'body', 'copies'],
          ],
        },
        subscriber,
      );

      (dir === 'out' ? children[0].stdout : children[0].stderr).write(
        `${text}\n`,
      );
      await streamsDelivered();

      const logged = JSON.parse(logRecords('a.jsonl')) as { text: string };
      expect(logged.text).toBe(delivered);
      expect(lines.map((line) => line.text)).toEqual([delivered]);
    },
  );

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
    {
      label: 'a turn-starting in, then silence',
      steps: [['in', USER]],
      idle: false,
    },
    {
      label: 'out matching the rule',
      steps: [
        ['in', USER],
        ['out', RESULT],
      ],
      idle: true,
    },
    {
      label: 'a turn-starting in after the turn end',
      steps: [
        ['in', USER],
        ['out', RESULT],
        ['in', USER],
      ],
      idle: false,
    },
    {
      label: 'the first turn-starting out after the turn end',
      steps: [
        ['in', USER],
        ['out', RESULT],
        ['out', '{"type":"assistant"}'],
      ],
      idle: false,
    },
    {
      label: 'another turn-starting out after the turn end',
      steps: [
        ['in', USER],
        ['out', RESULT],
        ['out', '{"type":"stream_event"}'],
      ],
      idle: false,
    },
    {
      label: 'a mode-change line after the turn end, no app connected',
      steps: [
        ['in', USER],
        ['out', RESULT],
        ['out', SYSTEM],
      ],
      idle: true,
    },
    {
      label: 'a hook line before any message',
      steps: [['out', SYSTEM]],
      idle: true,
    },
    {
      label: 'the context request and its answer after the turn end',
      steps: [
        ['in', USER],
        ['out', RESULT],
        ['in', '{"type":"control_request"}'],
        ['out', '{"type":"command_lifecycle"}'],
        ['out', '{"type":"control_response"}'],
      ],
      idle: true,
    },
    {
      label: 'another in at start',
      steps: [['in', '{"type":"control_request"}']],
      idle: true,
    },
    {
      label: 'another out while busy',
      steps: [
        ['in', USER],
        ['out', SYSTEM],
      ],
      idle: false,
    },
    {
      label: 'in on only the stdout list',
      steps: [['in', '{"type":"assistant"}']],
      idle: true,
    },
    {
      label: 'out on only the stdin list',
      steps: [['out', USER]],
      idle: true,
    },
    {
      label: 'in not JSON',
      steps: [['in', 'hi']],
      idle: true,
    },
    {
      label: 'out not JSON',
      steps: [['out', 'not json']],
      idle: true,
    },
    {
      label: 'out JSON null',
      steps: [['out', 'null']],
      idle: true,
    },
    {
      label: 'err naming a turn start',
      steps: [['err', '{"type":"assistant"}']],
      idle: true,
    },
    {
      label: 'err matching the rule while busy',
      steps: [
        ['in', USER],
        ['err', RESULT],
      ],
      idle: false,
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
    table.write('a', USER);
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
    children[0].stdout.write(`${RESULT}\n${SYSTEM}\n`);
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
    table.write('a', USER);
    table.setClientConnected(false);

    time.advanceTo(1000);
    children[0].stdout.write('{"type":"result"}\n');
    await streamsDelivered();

    time.advanceTo(HOUR_MS + 999);
    expect(children[0].stdin.writableEnded).toBe(false);
    time.advanceTo(HOUR_MS + 1000);
    expect(children[0].stdin.writableEnded).toBe(true);
  });

  it('keepWindow_OtherLinesAfterTheTurnEnd_CountsFromTheTurnEnd', async () => {
    const { table, time, children } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);
    table.write('a', USER);
    time.advanceTo(1000);
    children[0].stdout.write(`${RESULT}\n`);
    await streamsDelivered();

    time.advanceTo(2000);
    table.write('a', '{"type":"control_request"}');
    children[0].stdout.write(`${SYSTEM}\n`);
    await streamsDelivered();

    time.advanceTo(HOUR_MS + 999);
    expect(children[0].stdin.writableEnded).toBe(false);
    time.advanceTo(HOUR_MS + 1000);
    expect(children[0].stdin.writableEnded).toBe(true);
  });

  it.each([
    { label: 'a mode-change line', afterTurn: SYSTEM, ends: true },
    { label: 'a turn start', afterTurn: '{"type":"assistant"}', ends: false },
  ])(
    'drain_LineAfterTheTurnEnd_EndsOnlyAnIdleProcess: $label → ends $ends',
    async ({ afterTurn, ends }) => {
      const { table, children } = setUp();
      table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);
      table.write('a', USER);
      children[0].stdout.write(`${RESULT}\n${afterTurn}\n`);
      await streamsDelivered();

      table.drain();

      expect(children[0].stdin.writableEnded).toBe(ends);
    },
  );

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

  it('setKeepIdle_WindowPastTheTimerCap_EndsOnlyAtTheDeadline', () => {
    const { table, time, children } = setUp();
    const minutes = 2 * Math.ceil(2 ** 31 / 60_000);
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);

    table.setKeepIdleMinutes(minutes);
    time.advanceTo(minutes * 60_000 - 1);
    expect(children[0].stdin.writableEnded).toBe(false);

    time.advanceTo(minutes * 60_000);
    expect(children[0].stdin.writableEnded).toBe(true);
  });

  it.each([
    { label: 'NaN', minutes: Number.NaN },
    { label: 'Infinity', minutes: Number.POSITIVE_INFINITY },
    { label: 'null off the wire', minutes: null as unknown as number },
  ])('setKeepIdle_NotFinite_KeepsTheWindow: $label', ({ minutes }) => {
    const { table, time, children, diagnosticLines } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);

    table.setKeepIdleMinutes(minutes);
    time.advanceTo(HOUR_MS - 1);
    expect(children[0].stdin.writableEnded).toBe(false);

    time.advanceTo(HOUR_MS);
    expect(children[0].stdin.writableEnded).toBe(true);
    expect(diagnosticLines).toHaveLength(1);
  });

  it('keepWindow_Ending_ListsNotRunningAndRefusesAnAttach', async () => {
    const { table, time, children } = setUp();
    const first = recordingSubscriber();
    table.spawn(spawnRequest('a'), first.subscriber);
    expect(table.list()[0].running).toBe(true);

    time.advanceTo(HOUR_MS);
    const late = recordingSubscriber();

    expect(table.list()[0].running).toBe(false);
    expect(table.subscribe('a', late.subscriber)).toEqual({
      running: false,
      log: null,
    });
    children[0].stdout.write('last\n');
    await streamsDelivered();
    expect(late.lines).toEqual([]);
    expect(first.lines.map(({ text }) => text)).toEqual(['last']);
  });

  it('close_EndsPendingSignals_AndDeletesTheLog', () => {
    const { table, time, children, logFile } = setUp();
    table.spawn(spawnRequest('a'), recordingSubscriber().subscriber);
    time.advanceTo(HOUR_MS);

    time.advanceTo(3_601_000);
    children[0].exit();
    children[0].close();
    time.advanceTo(HOUR_MS + 6000);

    expect(children[0].signals).toEqual([]);
    expect(children[0].stdout.destroyed).toBe(false);
    expect(existsSync(logFile('a.jsonl'))).toBe(false);
    expect(table.list()).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'exit_AGrandchildHoldsThePipes_ClosesAfterTheGrace',
    async () => {
      let child: ChildProcessWithoutNullStreams | null = null;
      const { table, time } = setUp(0, (command, args) => {
        child = spawnChild(command, args);
        return child;
      });
      const { subscriber, closed } = recordingSubscriber();

      table.spawn(
        {
          ...spawnRequest('a'),
          command: '/bin/sh',
          // The grandchild inherits the pipes and ends by itself.
          args: ['-c', 'sleep 5 & exit 3'],
          cwd: tmpdir(),
        },
        subscriber,
      );
      await vi.waitFor(() =>
        expect((child as ChildProcessWithoutNullStreams | null)?.exitCode).toBe(
          3,
        ),
      );
      await streamsDelivered();
      expect(closed).toEqual([]);

      time.advanceTo(HOST_END_GRACE_MS);

      await vi.waitFor(() =>
        expect(closed).toEqual([
          { id: 'a', exit: { code: 3, signal: null, error: null } },
        ]),
      );
      expect(table.list()).toEqual([]);
    },
  );

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

  it.each([
    {
      label: 'the spawn throws',
      spawnFails: (): ChildProcessWithoutNullStreams => {
        throw new Error('bad argument');
      },
      request: spawnRequest('a'),
      error: 'bad argument',
    },
    {
      label: 'a refused child has no pipes',
      spawnFails: () =>
        Object.assign(fakeChild().child, {
          stdout: undefined,
        }) as unknown as ChildProcessWithoutNullStreams,
      request: spawnRequest('a'),
      error: 'undefined',
    },
    {
      label: 'the idle rule is missing',
      spawnFails: () => fakeChild().child,
      request: { ...spawnRequest('a'), idleRule: undefined as never },
      error: 'idle rule',
    },
    {
      label: 'the dropped keys are missing',
      spawnFails: () => fakeChild().child,
      request: { ...spawnRequest('a'), droppedOutKeys: undefined as never },
      error: 'dropped keys',
    },
    {
      label: 'a dropped key has an empty path',
      spawnFails: () => fakeChild().child,
      request: { ...spawnRequest('a'), droppedOutKeys: [[]] },
      error: 'dropped keys',
    },
  ])(
    'spawn_Throws_ClosesWithTheMessageAndKeepsNoEntry: $label',
    ({ spawnFails, request, error }) => {
      const { table, logFile } = setUp(0, spawnFails);
      const { subscriber, closed } = recordingSubscriber();

      table.spawn(request, subscriber);

      expect(closed).toHaveLength(1);
      expect(closed[0].exit.error).toContain(error);
      expect(existsSync(logFile('a.jsonl'))).toBe(false);
      expect(table.list()).toEqual([]);
    },
  );

  it('spawn_LogCannotBeCreated_ClosesOnlyThatProcess', async () => {
    const { table, children, logFile } = setUp();
    const other = recordingSubscriber();
    table.spawn(spawnRequest('other'), other.subscriber);
    mkdirSync(logFile('bad.jsonl'));
    const { subscriber, closed } = recordingSubscriber();

    table.spawn(spawnRequest('bad'), subscriber);

    expect(closed.map(({ id }) => id)).toEqual(['bad']);
    expect(closed[0].exit.error).toContain('bad.jsonl');
    expect(children).toHaveLength(1);
    children[0].stdout.write('later\n');
    await streamsDelivered();
    expect(other.lines.map(({ text }) => text)).toEqual(['later']);
  });

  it('appendFailure_OneProcess_DeliversItsLinesAndRefusesItsAttach', async () => {
    const { table, children, logFile, logRecords, diagnosticLines } = setUp();
    const broken = recordingSubscriber();
    const healthy = recordingSubscriber();
    table.spawn(spawnRequest('broken'), broken.subscriber);
    table.spawn(spawnRequest('healthy'), healthy.subscriber);
    rmSync(logFile('broken.jsonl'));
    mkdirSync(logFile('broken.jsonl'));

    children[0].stdout.write('one\ntwo\n');
    children[1].stdout.write('fine\n');
    await streamsDelivered();

    expect(broken.lines.map(({ text }) => text)).toEqual(['one', 'two']);
    expect(healthy.lines.map(({ text }) => text)).toEqual(['fine']);
    expect(logRecords('healthy.jsonl')).toContain('fine');
    expect(diagnosticLines).toHaveLength(1);
    expect(diagnosticLines[0]).toContain('broken');
    const late = recordingSubscriber();
    expect(table.subscribe('broken', late.subscriber)).toEqual({
      running: true,
      log: null,
    });
    expect(table.subscribe('healthy', late.subscriber)).toEqual({
      running: true,
      log: logFile('healthy.jsonl'),
    });
    expect(table.list().map(({ id, running }) => [id, running])).toEqual([
      ['broken', true],
      ['healthy', true],
    ]);
    children[0].stdout.write('three\n');
    await streamsDelivered();
    expect(broken.lines.map(({ text }) => text)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(late.lines).toEqual([]);
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
