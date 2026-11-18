import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import {
  type DemoStartPromptDeps,
  demoStartPrompt,
} from '../../../shared/page/demo-start-prompt';

export type SessionLogDemoPageDeps = DemoStartPromptDeps;

// The Recently closed step: the start prompt, whose section main answers with
// sample rows while the demo runs.
export function registerDemoSteps(
  services: PageServices,
  deps: SessionLogDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'session-log.recentlyClosed',
    section: 'sessions',
    order: 130,
    title: 'Recently closed',
    caption:
      'The start prompt offers the sessions the user closed lately, to resume.',
    files: [
      'src/plugins/session-log/main/recently-closed.ts',
      'src/plugins/chat/page/start-prompt.ts',
    ],
    async enter(): Promise<DemoStage> {
      const prompt = demoStartPrompt(deps);
      return {
        beats: [
          {
            name: 'recently closed',
            show: async () => {
              await prompt.open();
            },
          },
        ],
        dispose: () => prompt.dispose(),
      };
    },
  });
}
