import { definePlugin } from '../../shared/define-plugin';

// Agent sessions: the relay each one connects through, and a tab each.
export const sessionsManifest = definePlugin({
  id: 'sessions',
  dependsOn: [],
  commands: {},
  scopes: [],
  keys: { page: [], editor: [], app: [], global: [], intercept: [] },
  settings: {},
});
