import { noLayoutState } from '../../../../shared/page/layout-host/fake-layout-state.test-support';
import {
  recordingAnchors,
  withUser,
} from '../../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../../shared/page/markdown-mount.test-support';
import defaultLayout from '../../layouts/default/layout.js';
import type { Layout } from '../../layouts/layout';
import { createSessionStashParts } from './session-stash-parts';

// The session-stash parts over fake page services, showing `mine` as the
// user's layout when one is handed in, with a log that records each line in
// `logged`. Runs under a fake DOM.
export function stashPartsSetup(mine?: Layout) {
  const logged: string[] = [];
  const parts = createSessionStashParts({
    keys: recordingAnchors().keys,
    markdown: {
      block: (text: string) => text,
      inline: (text: string) => text,
      document: async (text: string) => text,
      ...NO_FENCES,
    },
    platform: 'macos',
    state: noLayoutState,
    commands: {
      exists: () => true,
      argShape: () => undefined,
      run: () => undefined,
    },
    log: (message: string) => {
      logged.push(message);
    },
  });
  if (mine !== undefined) {
    parts.setLayouts(withUser<Layout>(defaultLayout, mine));
  }
  return { parts, logged };
}
