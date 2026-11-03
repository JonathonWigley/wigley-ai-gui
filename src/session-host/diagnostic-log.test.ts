import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDiagnosticLog } from './diagnostic-log';

const clock = { now: () => 0 };
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('createDiagnosticLog', () => {
  it('setAsidePrevious_TwoHosts_KeepsOnlyTheLastHostsLog', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'diagnostic-log-'));
    folders.push(folder);
    const previous = path.join(folder, 'host-v1.previous.log');
    writeFileSync(previous, 'older\n');
    writeFileSync(path.join(folder, 'host-v1.log'), 'crash\n');

    createDiagnosticLog(folder, clock).setAsidePrevious();

    expect(readFileSync(previous, 'utf8')).toBe('crash\n');
  });

  it('methods_FolderMissing_NeverThrow', () => {
    const log = createDiagnosticLog('/no/such/folder', clock);

    expect(() => log.append('x')).not.toThrow();
    expect(() => log.setAsidePrevious()).not.toThrow();
  });
});
