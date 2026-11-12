import type { Files } from '../../../contracts/files';
import type { ChatMainExports } from '../../chat/contract';
import { IMPORT_INSTRUCTIONS } from './instructions';
import type { ProblemStore } from './problem-store';

export interface PracticeSessionsDeps {
  chat: Pick<ChatMainExports, 'launch' | 'defaultProfile'>;
  store: ProblemStore;
  files: Pick<Files, 'makeFolder'>;
}

// The import session, an ordinary chat row run in the practice folder under
// chat's default profile. `startImport` rejects `Write what to add.` for a
// blank request and `Chat has no profiles.` when chat has none.
export interface PracticeSessions {
  startImport(request: string): Promise<string>;
}

export function createPracticeSessions(
  deps: PracticeSessionsDeps,
): PracticeSessions {
  const { chat, store } = deps;
  return {
    async startImport(request) {
      if (request.trim() === '') {
        throw new Error('Write what to add.');
      }
      const profile = chat.defaultProfile(null);
      if (profile === null) {
        throw new Error('Chat has no profiles.');
      }
      await deps.files.makeFolder(store.folder());
      return chat.launch({
        projectDir: store.folder(),
        profile,
        message: { text: request, images: [] },
        instructions: [IMPORT_INSTRUCTIONS],
      });
    },
  };
}
