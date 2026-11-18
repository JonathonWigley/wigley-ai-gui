import type { DemoBeat } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { DemoUpdateKind } from '../contract';

export interface AppUpdatePageDemoDeps {
  // Asks main to show the sample status of `kind`.
  showDemoStatus(kind: DemoUpdateKind): Promise<void>;
}

const BEATS: readonly { name: string; kind: DemoUpdateKind }[] = [
  { name: 'Update available', kind: 'available' },
  { name: 'Installing', kind: 'installing' },
  { name: 'Install failed', kind: 'failed' },
];

// Step `app-update.button`: each beat asks main for its sample status, which
// the title bar button draws. Main shows the real status again at leave.
export function registerDemoSteps(
  services: PageServices,
  deps: AppUpdatePageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'app-update.button',
    section: 'bars',
    order: 3,
    title: 'App update',
    caption:
      'The title bar offers each new build of the app and installs it in one click.',
    files: [
      'src/plugins/app-update/page/start.ts',
      'src/plugins/app-update/main/start.ts',
      'src/plugins/app-update/main/updater.ts',
      'src/plugins/app-update/layouts/default/layout.js',
    ],
    async enter() {
      const beats = BEATS.map(
        ({ name, kind }): DemoBeat => ({
          name,
          show: () => deps.showDemoStatus(kind),
        }),
      );
      return { beats, dispose() {} };
    },
  });
}
