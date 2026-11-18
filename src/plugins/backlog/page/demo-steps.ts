import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';

// `holdPlace` stops `backlog.place` writes until its dispose.
export interface BacklogDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
  holdPlace(): Disposable;
}

// The Backlog step: Backlog mode over the sample repo main serves while the
// step holds it. It never runs the assistant, and holds the place so the
// user's saved one outlasts the sample.
export function registerDemoSteps(
  services: PageServices,
  deps: BacklogDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'backlog.mode',
    section: 'modes',
    order: 30,
    title: 'Backlog',
    caption:
      "Backlog: every repo's follow-ups in one table, with staleness read from git.",
    files: [
      'src/plugins/backlog/page/backlog-view.ts',
      'src/plugins/backlog/main/start.ts',
      'src/plugins/backlog/main/staleness.ts',
    ],
    enter: async () => backlogStage(deps),
  });
}

function backlogStage(deps: BacklogDemoPageDeps): DemoStage {
  const { commands } = deps;
  const placeHold = deps.holdPlace();
  return {
    beats: [
      { name: 'table', show: () => commands.run(MODES_SHOW, 'backlog.main') },
    ],
    dispose: () => placeHold.dispose(),
  };
}
