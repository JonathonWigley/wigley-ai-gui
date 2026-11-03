import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPipeLog } from './pipe-log';

const clock = { now: () => 1000 };
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function tempLogsFolder(): { folder: string; logs: string } {
  const folder = mkdtempSync(path.join(tmpdir(), 'pipe-log-'));
  folders.push(folder);
  const logs = path.join(folder, 'logs');
  mkdirSync(logs);
  return { folder, logs };
}

describe('createPipeLog', () => {
  it.each([
    { id: 'a', name: 'a.jsonl' },
    { id: 'x:1', name: 'x%3A1.jsonl' },
    { id: '../y', name: '..%2Fy.jsonl' },
  ])('pipeLog_IdCases_WritesTheSafeFileName: $id → $name', ({ id, name }) => {
    const { folder, logs } = tempLogsFolder();

    const log = createPipeLog(logs, id, clock);
    log.append('out', 'line');

    expect(log.file).toBe(path.join(logs, name));
    expect(readdirSync(logs)).toEqual([name]);
    expect(readdirSync(folder)).toEqual(['logs']);
  });

  it('createPipeLog_LeftoverOfThatName_EmptiesIt', () => {
    const { logs } = tempLogsFolder();
    writeFileSync(path.join(logs, 'a.jsonl'), 'leftover\n');

    const log = createPipeLog(logs, 'a', clock);

    expect(readFileSync(log.file, 'utf8')).toBe('');
  });

  it('remove_LogOnDisk_DeletesIt', () => {
    const { logs } = tempLogsFolder();
    const log = createPipeLog(logs, 'a', clock);

    log.remove();

    expect(existsSync(log.file)).toBe(false);
  });
});
