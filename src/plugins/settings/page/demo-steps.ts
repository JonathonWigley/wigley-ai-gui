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
  openSectionById(id: string): void;
  returnToPlace(place: SettingsPlace | undefined): void;
}

// The Settings step: Settings mode over the user's own config, read only,
// through its first section, Plugins, Keybindings and the Leader menu. Leaving
// it puts back the place the user had.
export function registerDemoSteps(
  services: PageServices,
  deps: SettingsDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'settings.mode',
    section: 'shell',
    order: 3,
    title: 'Settings',
    caption:
      'Settings mode edits every setting, plugin and key bind in place.',
    files: [
      'src/plugins/settings/page/start.ts',
      'src/plugins/settings/page/settings-view.ts',
      'src/plugins/settings/page/plugin-rows-view.ts',
      'src/plugins/settings/page/keymap-view.ts',
      'src/plugins/settings/page/leader-menu-view.ts',
    ],
    enter: async () => settingsStage(deps),
  });
}

function settingsStage(deps: SettingsDemoDeps): DemoStage {
  const found = deps.place();
  const sectionBeat = (name: string, open: () => void) => ({
    name,
    show() {
      deps.showMode();
      open();
    },
  });
  return {
    beats: [
      sectionBeat('Every setting', () => deps.openSectionAt(0)),
      sectionBeat('Plugins', () => deps.openSectionById('plugins')),
      sectionBeat('Keybindings', () => deps.openSectionById('keymap')),
      sectionBeat('Leader menu', () => deps.openSectionById('leader')),
    ],
    dispose() {
      deps.returnToPlace(found);
    },
  };
}
