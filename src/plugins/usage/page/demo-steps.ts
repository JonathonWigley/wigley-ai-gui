import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { SessionsPageExports } from '../../sessions/contract';

// `setDetailsShown` opens or closes the usage details without writing
// `uiState`; `detailsShown` is whether they are open now.
export interface UsageDemoPageDeps {
  activate: SessionsPageExports['activate'];
  setDetailsShown(shown: boolean): void;
  detailsShown(): boolean;
}

// The Usage step: the status-bar line and the session's lines over the
// sample snapshot main shows, then the details. Leaving puts the details back
// as they were at enter, unless the user toggled them during the step.
export function registerDemoSteps(
  services: PageServices,
  deps: UsageDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'usage.meters',
    section: 'sessions',
    order: 170,
    title: 'Usage',
    caption:
      'Plan usage sits in the status bar, and each session shows its context and spend.',
    files: [
      'src/plugins/usage/page/usage-view-model.ts',
      'src/plugins/usage/main/usage-fixture.ts',
      'src/plugins/usage/layouts/default/layout.js',
    ],
    async enter(context): Promise<DemoStage> {
      const session = context.sessions.session;
      const before = deps.detailsShown();
      return {
        beats: [
          {
            name: 'meters and details',
            show() {
              deps.activate(session);
              deps.setDetailsShown(true);
            },
          },
        ],
        dispose() {
          if (deps.detailsShown()) {
            deps.setDetailsShown(before);
          }
        },
      };
    },
  });
}
