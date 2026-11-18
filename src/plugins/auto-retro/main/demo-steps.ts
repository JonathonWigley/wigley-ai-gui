import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';

// The queued count the demo step shows.
export const DEMO_QUEUED = 2;

export interface AutoRetroDemoDeps {
  // A demo row and count show over the real state; null shows the real one again.
  setDemo(demo: { rowId: string; queued: number } | null): void;
}

// The main half of step `auto-retro.section`: launches a demo session that
// stands for a running retro, and shows it in the Retro section with
// `DEMO_QUEUED` retros waiting, until the stage is disposed.
export function registerDemoSteps(
  services: MainServices,
  deps: AutoRetroDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'auto-retro.section',
    async enter(context) {
      const rowId = await context.launchSession(
        'Retro of the "Fix login" conversation',
      );
      deps.setDemo({ rowId, queued: DEMO_QUEUED });
      return {
        sessions: { retro: rowId },
        dispose: () => deps.setDemo(null),
      };
    },
  });
}
