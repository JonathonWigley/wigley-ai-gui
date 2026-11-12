import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { ChatMainExports, LaunchRequest } from '../../chat/contract';
import { IMPORT_INSTRUCTIONS } from './instructions';
import { PRACTICE_FOLDER } from './practice-fixtures.test-support';
import { createPracticeSessions } from './practice-sessions';
import { createProblemStore } from './problem-store';

// The import session over a chat whose `launch` resolves `row-1` and records
// each request.
function setUp() {
  const files = createMemoryFiles();
  const store = createProblemStore({
    files,
    paths: posixPaths,
    log: () => undefined,
    folder: () => PRACTICE_FOLDER,
  });
  const launches: LaunchRequest[] = [];
  const chat: Pick<ChatMainExports, 'launch' | 'defaultProfile'> = {
    async launch(request) {
      launches.push(request);
      return 'row-1';
    },
    defaultProfile: () => 'default',
  };
  const sessions = createPracticeSessions({ chat, store, files });
  return { sessions, launches };
}

describe('practice sessions', () => {
  it('startImport launches a visible session with the import instructions', async () => {
    const { sessions, launches } = setUp();

    const id = await sessions.startImport('Add the Blind 75 graph problems');

    expect(id).toBe('row-1');
    expect(launches).toStrictEqual([
      {
        projectDir: PRACTICE_FOLDER,
        profile: 'default',
        message: { text: 'Add the Blind 75 graph problems', images: [] },
        instructions: [IMPORT_INSTRUCTIONS],
      },
    ]);
  });
});
