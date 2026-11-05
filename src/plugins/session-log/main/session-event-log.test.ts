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

const lineOf = (entry: SessionLogEntry) => JSON.stringify(entry) + '\n';

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
        '{"at":4,"eve',
    );

    expect(await log.entries()).toEqual([archived(1), archived(3)]);
    expect(logged).toEqual([
      expect.stringContaining('line 2'),
      expect.stringContaining('line 3'),
      expect.stringContaining('line 5'),
    ]);
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
      lineOf(archived(1)) + lineOf(archived(2)),
    );
  });

  it('append_Fails_NextStillWrites', async () => {
    const files = createMemoryFiles();
    const logged: string[] = [];
    let calls = 0;
    const log = createSessionEventLog({
      files: {
        read: files.read,
        async append(path, text) {
          calls += 1;
          if (calls === 1) {
            throw new Error('disk full');
          }
          await files.append(path, text);
        },
      },
      log: (message) => logged.push(message),
    });

    await expect(log.append(archived(1))).resolves.toBeUndefined();
    await log.append(archived(2));

    expect(await files.read(SESSION_EVENTS_FILE)).toBe(lineOf(archived(2)));
    expect(logged).toEqual([expect.stringContaining('disk full')]);
  });

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
