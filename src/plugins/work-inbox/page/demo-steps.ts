import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import type { WorkState } from '../../work/contract';
import { sampleInboxState } from './sample-state';

// `showSample` draws a sample in place of `work.state`, holding the place, until its dispose; `selectSection` opens a
// section with the list focused; `now` is epoch milliseconds.
export interface InboxDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
  showSample(state: WorkState): Disposable;
  selectSection(id: string): void;
  now(): number;
}

// The Inbox step: Inbox mode over its own sample, through Needs you, Waiting on others and All, so every card action's
// anchor draws. It presses nothing and launches no worker.
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
      'Inbox: Slack threads sorted by what needs you, with drafts ready to send.',
    files: [
      'src/plugins/work-inbox/page/inbox-view.ts',
      'src/plugins/work-inbox/page/inbox-state.ts',
      'src/plugins/work-inbox/layouts/default/layout.js',
    ],
    enter: async () => inboxStage(deps),
  });
}

function inboxStage(deps: InboxDemoPageDeps): DemoStage {
  const sample = deps.showSample(sampleInboxState(deps.now()));
  return {
    beats: [
      {
        name: 'needs you',
        async show() {
          await deps.commands.run(MODES_SHOW, 'work-inbox.main');
          deps.selectSection('needs_you');
        },
      },
      { name: 'waiting', show: () => deps.selectSection('waiting') },
      { name: 'all', show: () => deps.selectSection('all') },
    ],
    dispose: () => sample.dispose(),
  };
}
