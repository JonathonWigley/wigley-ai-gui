import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import { backlogSelectRowCommand } from '../contract';
import { rowKey } from '../row-key';

// The sample repo's name in the table.
const SAMPLE_REPO = 'backlog-repo';

export interface BacklogDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
}

// The Backlog step: Backlog mode over the sample repo main serves while the
// step holds it, then two of its follow-ups. It never runs the assistant.
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
  const showMode = () => commands.run(MODES_SHOW, 'backlog.main');
  const selectRow = async (title: string) => {
    await showMode();
    await commands.run(backlogSelectRowCommand, rowKey(SAMPLE_REPO, title));
  };
  return {
    beats: [
      { name: 'table', show: showMode },
      { name: 'ready follow-up', show: () => selectRow('Ready item') },
      { name: 'moved since written', show: () => selectRow('Moved item') },
    ],
    dispose: () => undefined,
  };
}
