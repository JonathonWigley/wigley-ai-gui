import type { DemoPageContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../../sessions/contract';

export interface VisualDemoPageDeps {
  activate: SessionsPageExports['activate'];
}

// The visuals step: a session whose agent wrote visuals inline, then one
// showing a render on disk by its absolute path.
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
        'HTML an agent writes draws as a live visual, with a full-size view, and an image on disk shows by its path.',
      files: [
        'src/plugins/visual/page/html-fence.ts',
        'src/plugins/visual/page/visual-overlay.ts',
        'src/shared/sample-visuals.ts',
        'src/shared/visual-url.ts',
      ],
      enter: async ({ sessions }: DemoPageContext) => ({
        beats: [
          { name: 'visuals', show: () => activate(sessions.visual) },
          { name: 'image', show: () => activate(sessions.image) },
        ],
        dispose() {},
      }),
    }),
  );
  return registrations;
}
