import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { SettingsPlace } from '../contract';

// `place` is the place Settings mode last reported on this page, undefined
// before it opened a section.
export interface SettingsDemoDeps {
  showMode(): void;
  place(): SettingsPlace | undefined;
  openSectionAt(index: number): void;
  returnToPlace(place: SettingsPlace | undefined): void;
}

// The Settings step: Settings mode over the user's own config, read only, on
// its first section. Leaving it puts back the place the user had.
export function registerDemoSteps(
  services: PageServices,
  deps: SettingsDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'settings.mode',
    section: 'shell',
    order: 3,
    title: 'Settings',
    caption: 'Settings mode holds every setting, plugin and key bind.',
    files: [
      'src/plugins/settings/page/start.ts',
      'src/plugins/settings/page/settings-view.ts',
    ],
    enter: async () => settingsStage(deps),
  });
}

function settingsStage(deps: SettingsDemoDeps): DemoStage {
  const found = deps.place();
  return {
    beats: [
      {
        name: 'Settings',
        show() {
          deps.showMode();
          deps.openSectionAt(0);
        },
      },
    ],
    dispose() {
      deps.returnToPlace(found);
    },
  };
}
