import type { MainApi, MainPart } from '../../../contracts/plugin';
import type { ChatMainExports } from '../../chat/contract';
import type { VisualChannel } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { visualManifest } from '../manifest';
import { SESSION_NOTE } from './session-note';

type VisualApi = MainApi<typeof visualManifest, VisualChannel>;

// Registers visual's layouts, and hands chat the session note every agent
// session starts with.
export const visualMainPart: MainPart<typeof visualManifest> = {
  manifest: visualManifest,
  start(api: VisualApi) {
    const layouts = api.layouts.register({ layoutTypes });
    const note = api
      .dependency<ChatMainExports>('chat')
      .addInstructions(SESSION_NOTE);
    return {
      commands: {},
      dispose() {
        layouts.dispose();
        note.dispose();
      },
    };
  },
};
