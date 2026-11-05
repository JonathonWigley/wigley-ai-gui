import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import {
  createSessionEventLog,
  SESSION_EVENTS_FILE,
  type SessionLogEntry,
} from './session-event-log';

const archived = (at: number): SessionLogEntry => ({
  at,
  event: 'archived',
  hostSessionId: `h${at}`,
  archived: true,
});

const closed = (at: number): SessionLogEntry => ({
  at,
  event: 'closed',
  sessionId: `row-${at}`,
  hostSessionId: `h${at}`,
  projectDir: `/projects/${at}`,
  profile: `profile-${at}`,
  titles: { user: `title ${at}`, agent: null, firstMessage: null },
  sent: true,
  reason: 'user',
});

const terminalEnded = (at: number): SessionLogEntry => ({
  at,
  event: 'terminalEnded',
  sessionId: `row-${at}`,
  hostSessionId: null,
  projectDir: null,
});

const lineOf = (entry: SessionLogEntry) => JSON.stringify(entry) + '\n';

// `JSON.stringify` leaves out a field set to undefined, as a line without it.
const lineWithout = (entry: SessionLogEntry, field: string) =>
  lineOf({ ...entry, [field]: undefined });

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createSessionEventLog', () => {
  it('entries_BadLines_SkipsAndLogs', async () => {
    const files = createMemoryFiles();
    const logged: string[] = [];
    const log = createSessionEventLog({
      files,
      log: (message) => logged.push(message),
    });
    await files.write(
      SESSION_EVENTS_FILE,
      lineOf(archived(1)) +
        'null\n' +
        '{"at":2,"event":"constructor"}\n' +
        lineOf(archived(3)) +
        lineWithout(closed(4), 'titles') +
        lineWithout(closed(5), 'projectDir') +
        lineWithout(archived(6), 'at') +
        lineOf(closed(7)) +
        lineOf(terminalEnded(8)) +
        '{"at":9,"eve',
    );

    expect(await log.entries()).toEqual([
      archived(1),
      archived(3),
      closed(7),
      terminalEnded(8),
    ]);
    expect(logged).toEqual([
      expect.stringContaining('line 2'),
      expect.stringContaining('line 3'),
      expect.stringContaining('line 5'),
      expect.stringContaining('line 6'),
      expect.stringContaining('line 7'),
      expect.stringContaining('line 10'),
    ]);
  });

  it('append_AfterCutLastLine_KeepsTheEntry', async () => {
    const files = createMemoryFiles();
    const logged: string[] = [];
    const log = createSessionEventLog({
      files,
      log: (message) => logged.push(message),
    });
    await files.write(SESSION_EVENTS_FILE, '{"at":1,"eve');

    await log.append(archived(2));
    await log.append(archived(3));

    expect(await log.entries()).toEqual([archived(2), archived(3)]);
    expect(logged).toEqual([expect.stringContaining('line 1')]);
    expect(await files.read(SESSION_EVENTS_FILE)).toBe(
      '{"at":1,"eve\n' + lineOf(archived(2)) + lineOf(archived(3)),
    );
  });

  it('append_NotAwaited_KeepsOrder', async () => {
    const files = createMemoryFiles();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const log = createSessionEventLog({
      files: {
        read: files.read,
        async append(path, text) {
          calls += 1;
          if (calls === 1) {
            await held;
          }
          await files.append(path, text);
        },
      },
      log: () => {},
    });

    const first = log.append(archived(1));
    const second = log.append(archived(2));
    await flush();
    release();
    await Promise.all([first, second]);

    expect(await files.read(SESSION_EVENTS_FILE)).toBe(
      '\n' + lineOf(archived(1)) + lineOf(archived(2)),
    );
  });

  it.each([
    {
      failingCall: 1,
      expected: '\n' + lineOf(archived(2)) + lineOf(archived(3)),
    },
    {
      failingCall: 2,
      expected: '\n' + lineOf(archived(1)) + '\n' + lineOf(archived(3)),
    },
  ])(
    'append_Fails_NextStillWritesOnItsOwnLine: call $failingCall',
    async ({ failingCall, expected }) => {
      const files = createMemoryFiles();
      const logged: string[] = [];
      let calls = 0;
      const log = createSessionEventLog({
        files: {
          read: files.read,
          async append(path, text) {
            calls += 1;
            if (calls === failingCall) {
              throw new Error('disk full');
            }
            await files.append(path, text);
          },
        },
        log: (message) => logged.push(message),
      });

      await expect(log.append(archived(1))).resolves.toBeUndefined();
      await expect(log.append(archived(2))).resolves.toBeUndefined();
      await log.append(archived(3));

      expect(await files.read(SESSION_EVENTS_FILE)).toBe(expected);
      expect(logged).toEqual([expect.stringContaining('disk full')]);
    },
  );

  it('entries_MissingFile_IsEmpty', async () => {
    const logged: string[] = [];
    const log = createSessionEventLog({
      files: createMemoryFiles(),
      log: (message) => logged.push(message),
    });

    expect(await log.entries()).toEqual([]);
    expect(logged).toEqual([]);
  });
});
