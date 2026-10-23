import { describe, expect, it } from 'vitest';
import type { RunMode } from '../../../contracts/plugin';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { FakeProcesses } from '../../../shared/fake-processes';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { ConnectedSession, SessionInfo } from '../../sessions/contract';
import { MACHINE_INDEX_FILE } from './index-sources';
import { addDriveActions, startDocs } from './start';

const HOME = '/home';
const CLAUDE_MD = `${HOME}/.claude/CLAUDE.md`;

function setUpFiles() {
  const files = createMemoryFiles();
  return files.makeFolder(HOME).then(() => files);
}

function start(files: ReturnType<typeof createMemoryFiles>, runMode: RunMode) {
  return startDocs(
    {
      files,
      processes: new FakeProcesses(),
      log: () => undefined,
      homeDir: HOME,
      runMode,
      paths: posixPaths,
    },
    () => '/script.py',
  );
}

describe('startDocs', () => {
  it('writes the fixture into a drive home that has none', async () => {
    const files = await setUpFiles();

    await start(files, 'drive');

    expect(await files.stat(`${HOME}/${MACHINE_INDEX_FILE}`)).not.toBeNull();
  });

  it('keeps a drive home whose fixture an earlier start wrote', async () => {
    const files = await setUpFiles();
    await start(files, 'drive');
    await files.write(CLAUDE_MD, '# Edited by the agent\n');

    await start(files, 'drive');

    expect(await files.read(CLAUDE_MD)).toBe('# Edited by the agent\n');
  });

  it('writes no fixture into a live home', async () => {
    const files = await setUpFiles();

    await start(files, 'live');

    expect(await files.stat(`${HOME}/${MACHINE_INDEX_FILE}`)).toBeNull();
  });
});

describe('docs drive actions', () => {
  it('dispose removes the actions and ends each session connectSession connected', async () => {
    const files = await setUpFiles();
    const ended: string[] = [];
    const drive = fakeDriveHost();
    const actions = addDriveActions(drive.host, {
      files,
      homeDir: HOME,
      started: Promise.resolve(),
      paths: posixPaths,
      sessions: {
        activate: () => undefined,
        connect(info: SessionInfo): ConnectedSession {
          const id = `row-${String(info.sessionId)}`;
          return {
            session: { id, info },
            call: () => Promise.reject(new Error('no tools')),
            end: () => ended.push(id),
          };
        },
      },
    });
    await drive.run('connectSession');
    await drive.run('connectSession', { sessionId: 'named' });

    actions.dispose();

    expect(ended).toEqual(['row-drive-docs-1', 'row-named']);
    expect([...drive.actions.keys()]).toEqual([]);
  });

  it('connectSession rejects a sessionId that is not a string', async () => {
    const files = await setUpFiles();
    const drive = fakeDriveHost();
    addDriveActions(drive.host, {
      files,
      homeDir: HOME,
      started: Promise.resolve(),
      paths: posixPaths,
      sessions: {
        activate: () => undefined,
        connect: () => {
          throw new Error('not reached');
        },
      },
    });

    await expect(drive.run('connectSession', { sessionId: 3 })).rejects.toThrow(
      'sessionId must be a string',
    );
  });
});
