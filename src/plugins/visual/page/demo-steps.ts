import type { DemoPageContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../../sessions/contract';

export interface VisualDemoPageDeps {
  activate: SessionsPageExports['activate'];
}

// The visuals step: a session whose agent wrote visuals inline.
export function registerDemoSteps(
  services: PageServices,
  deps: VisualDemoPageDeps,
): Disposable {
  const { activate } = deps;
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'visual.visuals',
      section: 'sessions',
      order: 110,
      title: 'Visuals',
      caption:
        'HTML an agent writes draws as a live visual, with a full-size view.',
      files: [
        'src/plugins/visual/page/html-fence.ts',
        'src/plugins/visual/page/visual-overlay.ts',
        'src/shared/sample-visuals.ts',
      ],
      enter: async ({ sessions }: DemoPageContext) => ({
        beats: [{ name: 'visuals', show: () => activate(sessions.visual) }],
        dispose() {},
      }),
    }),
  );
  return registrations;
}
