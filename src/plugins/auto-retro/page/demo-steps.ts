import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';

export interface AutoRetroPageDemoDeps {
  // sessions.showOnly
  showOnly(sectionId: string): Disposable;
  // sessions.activate
  activate(sessionId: string): void;
}

// Step `auto-retro.section`: shows the Retro section alone for the step's
// length, holding main's demo retro row and queued count.
export function registerDemoSteps(
  services: PageServices,
  deps: AutoRetroPageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'auto-retro.section',
    section: 'bars',
    order: 4,
    title: 'Auto retro',
    caption:
      'Each conversation the user ends gets a background retro in the Retro section.',
    files: [
      'src/plugins/auto-retro/main/start.ts',
      'src/plugins/auto-retro/main/retro-queue.ts',
      'src/plugins/auto-retro/page/start.ts',
      'src/plugins/auto-retro/layouts/default/layout.js',
    ],
    async enter(context) {
      const sessionId = context.sessions.retro;
      if (sessionId === undefined) {
        throw new Error('auto-retro.section: no demo session');
      }
      const hold = deps.showOnly('auto-retro');
      return {
        beats: [
          {
            name: 'Retro running, 2 queued',
            show: () => deps.activate(sessionId),
          },
        ],
        dispose: () => hold.dispose(),
      };
    },
  });
}
