import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';

// Step `app-update.button`: main shows the sample update at enter, which the
// title bar button draws, and the real status again at leave.
export function registerDemoSteps(services: PageServices): Disposable {
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
      return {
        beats: [{ name: 'Update available', show() {} }],
        dispose() {},
      };
    },
  });
}
