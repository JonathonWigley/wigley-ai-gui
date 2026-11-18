import type { MainApi, MainPart } from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import type { VisualChannel } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { visualManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { SESSION_NOTE } from './session-note';

type VisualApi = MainApi<typeof visualManifest, VisualChannel>;

// Registers visual's layouts and its demo step's main half, and hands chat the
// session note every agent session starts with.
export const visualMainPart: MainPart<typeof visualManifest> = {
  manifest: visualManifest,
  start(api: VisualApi) {
    api.layouts.register({ layoutTypes });
    registerDemoSteps(api.services);
    api.dependency(chatMainKey).addInstructions(SESSION_NOTE);
    return { commands: {} };
  },
};
