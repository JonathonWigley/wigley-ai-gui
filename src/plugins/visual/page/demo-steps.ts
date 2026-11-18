import type { DemoPageContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import {
  SAMPLE_FLOWCHART_VISUAL,
  SAMPLE_MOCKUP_VISUAL,
} from '../../../shared/sample-visuals';
import type { SessionsPageExports } from '../../sessions/contract';
import type { VisualOverlay } from './visual-overlay';

export interface VisualDemoPageDeps {
  activate: SessionsPageExports['activate'];
  overlay: Pick<VisualOverlay, 'open' | 'close'>;
}

const SAMPLES = [SAMPLE_MOCKUP_VISUAL, SAMPLE_FLOWCHART_VISUAL];

// The visuals step: a session whose agent wrote visuals inline, then the
// full-size overlay on each sample visual; the stage closes the overlay.
export function registerDemoSteps(
  services: PageServices,
  deps: VisualDemoPageDeps,
): Disposable {
  const { activate, overlay } = deps;
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
      async enter({ sessions }: DemoPageContext) {
        const showFullSize = (index: number) => () => {
          activate(sessions.visual);
          overlay.open(SAMPLES, index);
        };
        return {
          beats: [
            {
              name: 'inline',
              show() {
                overlay.close();
                activate(sessions.visual);
              },
            },
            { name: 'full size', show: showFullSize(0) },
            { name: 'next visual', show: showFullSize(1) },
          ],
          dispose: () => overlay.close(),
        };
      },
    }),
  );
  return registrations;
}
