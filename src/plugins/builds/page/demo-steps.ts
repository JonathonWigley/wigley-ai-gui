import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import type { BuildsSnapshot } from '../contract';
import { DEMO_FIRST_GAME, demoSample } from './demo-sample';

// `showSample` draws a snapshot in place of the slots', null dropping it; `selectEntry` shows a side-bar entry.
export interface BuildsDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
  showSample(sample: BuildsSnapshot | null): void;
  selectEntry(key: string): void;
}

// The Builds step: Builds mode on the sample's first game. The sample lives in the view until the stage's dispose.
export function registerDemoSteps(
  services: PageServices,
  deps: BuildsDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'builds.mode',
    section: 'modes',
    order: 70,
    title: 'Builds',
    caption:
      'Builds: the CI and local builds of tracked games, queued in one press and followed live.',
    files: [
      'src/plugins/builds/page/builds-view.ts',
      'src/plugins/builds/page/start.ts',
      'src/plugins/builds/main/start.ts',
      'src/plugins/builds/layouts/default/layout.js',
    ],
    enter: async () => buildsStage(deps, services.clock.now()),
  });
}

function buildsStage(deps: BuildsDemoPageDeps, now: number): DemoStage {
  const { commands } = deps;
  deps.showSample(demoSample(now));
  return {
    beats: [
      {
        name: 'game',
        async show() {
          await commands.run(MODES_SHOW, 'builds.main');
          deps.selectEntry(DEMO_FIRST_GAME);
        },
      },
    ],
    dispose: () => deps.showSample(null),
  };
}
