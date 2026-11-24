import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import type { WorkDetail, WorkState } from '../../work/contract';
import {
  SAMPLE_LOCAL_TASK,
  SAMPLE_SUGGESTION_CARD,
  sampleBoardDetails,
  sampleBoardState,
} from './sample-state';

// `showSample` draws a sample in place of `work.state` and `work.details`, holding the place, until its dispose;
// `selectCard` puts the cursor on a card with the board focused; `openPane` opens the detail pane; `now` is epoch
// milliseconds.
export interface BoardDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
  showSample(state: WorkState, details: readonly WorkDetail[]): Disposable;
  selectCard(id: string): void;
  openPane(): void;
  now(): number;
}

// The Board step: Board mode over its own sample, the cursor on the suggestion card with the detail pane open, and
// then on the local task, so every card anchor and both pane kinds draw. It presses nothing and launches no worker.
export function registerDemoSteps(
  services: PageServices,
  deps: BoardDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'work-board.mode',
    section: 'modes',
    order: 36,
    title: 'Board',
    caption:
      'Board: your Jira tickets and local tasks in columns, with the moves your branches and PRs suggest.',
    files: [
      'src/plugins/work-board/page/board-view.ts',
      'src/plugins/work-board/page/board-state.ts',
      'src/plugins/work-board/page/sample-state.ts',
      'src/plugins/work-board/layouts/default/layout.js',
    ],
    enter: async () => boardStage(deps),
  });
}

function boardStage(deps: BoardDemoPageDeps): DemoStage {
  const now = deps.now();
  const sample = deps.showSample(
    sampleBoardState(now),
    sampleBoardDetails(now),
  );
  return {
    beats: [
      {
        name: 'columns',
        async show() {
          await deps.commands.run(MODES_SHOW, 'work-board.main');
          deps.selectCard(SAMPLE_SUGGESTION_CARD);
          deps.openPane();
        },
      },
      { name: 'local task', show: () => deps.selectCard(SAMPLE_LOCAL_TASK) },
    ],
    dispose: () => sample.dispose(),
  };
}
