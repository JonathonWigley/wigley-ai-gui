import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';

export interface SystemStatsPageDemoDeps {
  // Shows the panel without writing `uiState`; the handle hides it again only
  // when this call showed it and the user has not toggled it since.
  showForNow(): Disposable;
}

// Step `system-stats.panel`: shows the panel for the step's length over the
// busy sample main holds.
export function registerDemoSteps(
  services: PageServices,
  deps: SystemStatsPageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'system-stats.panel',
    section: 'bars',
    order: 2,
    title: 'System stats',
    caption:
      'The system stats panel shows what the machine is busy with, session by session.',
    files: [
      'src/plugins/system-stats/page/start.ts',
      'src/plugins/system-stats/page/stats-view-model.ts',
      'src/plugins/system-stats/main/start.ts',
      'src/plugins/system-stats/main/grouping.ts',
      'src/plugins/system-stats/layouts/default/layout.js',
    ],
    async enter() {
      const hold = deps.showForNow();
      return {
        beats: [{ name: 'Busy machine', show() {} }],
        dispose: () => hold.dispose(),
      };
    },
  });
}
