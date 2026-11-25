import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import type { ThreadDetail, WorkState } from '../../work/contract';
import { sampleInboxDetails, sampleInboxState } from './sample-state';

// `showSample` draws a sample and its thread details in place of `work.state` and `work.details`, holding the place,
// until its dispose; `openPane` opens the detail pane, doing nothing while it is open; `selectSection` opens a section
// with the list focused; `now` is epoch milliseconds.
export interface InboxDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
  showSample(state: WorkState, details: readonly ThreadDetail[]): Disposable;
  openPane(): void;
  selectSection(id: string): void;
  now(): number;
}

// The Inbox step: Inbox mode over its own sample, through Needs you, then its detail pane, then Waiting on others and
// All with the pane following the cursor, so every card action's anchor draws. It presses nothing and launches no
// worker.
export function registerDemoSteps(
  services: PageServices,
  deps: InboxDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'work-inbox.mode',
    section: 'modes',
    order: 35,
    title: 'Inbox',
    caption:
      'Inbox: Slack threads sorted by what needs you, apart from the digest, unseen rows marked, each with its thread and a reply box in the detail pane.',
    files: [
      'src/plugins/work-inbox/page/inbox-view.ts',
      'src/plugins/work-inbox/page/inbox-state.ts',
      'src/plugins/work-inbox/layouts/default/layout.js',
      'src/plugins/work-inbox/layouts/default/layout.css',
    ],
    enter: async () => inboxStage(deps),
  });
}

function inboxStage(deps: InboxDemoPageDeps): DemoStage {
  const now = deps.now();
  const sample = deps.showSample(
    sampleInboxState(now),
    sampleInboxDetails(now),
  );
  return {
    beats: [
      {
        name: 'needs you',
        async show() {
          await deps.commands.run(MODES_SHOW, 'work-inbox.main');
          deps.selectSection('needs_you');
        },
      },
      { name: 'detail', show: () => deps.openPane() },
      { name: 'waiting', show: () => deps.selectSection('waiting') },
      { name: 'all', show: () => deps.selectSection('all') },
    ],
    dispose: () => sample.dispose(),
  };
}
