import { definePlugin } from '../../shared/define-plugin';
import type { ChatProfile } from './contract';

// Each profile names a Claude config folder; a leading `~/` means the home
// folder.
export const DEFAULT_PROFILES: ChatProfile[] = [
  { name: 'work', configDir: '~/.claude' },
  { name: 'personal', configDir: '~/.claude-personal' },
];

export const chatManifest = definePlugin({
  id: 'chat',
  dependsOn: ['sessions', 'keys'],
  commands: {},
  scopes: {},
  keys: { page: [], editor: [], app: [], global: [], intercept: [] },
  settings: { profiles: DEFAULT_PROFILES },
});
