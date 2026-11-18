import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import {
  type DemoFormWaitDeps,
  demoFormBeat,
  isDemoFormActive,
} from '../../../shared/page/demo-form-wait';
import { primerSelectItemCommand, primerSelectTaskCommand } from '../contract';

// Primer's page store and commands, the sessions plugin's `activate`, and the
// timers the wait for the sample primer runs on.
export interface PrimerPageDemoDeps extends DemoFormWaitDeps {
  commands: Pick<PluginCommands, 'run'>;
  log: PluginLog;
}

// Positions in DEMO_PRIMER_ARGS: `taskRows` puts the feature row at 0 and
// task `1` (need `yes`) at 1; items count from 1, item 3 being the long one.
const FIRST_TASK = 1;
const LONG_ITEM = 3;

// The page half of `primer.primer`: each beat shows the demo session's sample
// primer and puts it in the beat's whole state. Leaving dismisses a cancel
// prompt and closes the review while the sample primer is active.
export function registerDemoSteps(
  services: PageServices,
  deps: PrimerPageDemoDeps,
): Disposable {
  const { commands } = deps;
  const onFirstTask = async () => {
    await commands.run('primer.dismissConfirm');
    await commands.run('primer.closeReview');
    await commands.run(primerSelectTaskCommand, FIRST_TASK);
  };
  return services.demoSteps.register({
    id: 'primer.primer',
    section: 'forms',
    order: 20,
    title: 'Feature primer',
    caption:
      "Feature primer: an agent lays out a feature's tasks for the user to confirm before planning",
    files: [
      'src/plugins/primer/main/start.ts',
      'src/plugins/primer/main/primer-type.ts',
      'src/plugins/primer/page/start.ts',
      'src/plugins/primer/page/primer-view.ts',
      'src/plugins/primer/page/primer-commands.ts',
      'src/plugins/primer/page/primer-state.ts',
    ],
    enter: (context) => {
      const sessionId = context.sessions.session;
      const beat = (name: string, run: () => Promise<void>) =>
        demoFormBeat(deps, sessionId, name, run);
      return Promise.resolve({
        beats: [
          beat('Tasks', onFirstTask),
          beat('Items', async () => {
            await onFirstTask();
            await commands.run(primerSelectItemCommand, LONG_ITEM);
          }),
          beat('A need', async () => {
            await onFirstTask();
            await commands.run('primer.needUnclear');
          }),
          beat('Review', async () => {
            await commands.run('primer.dismissConfirm');
            await commands.run('primer.openReview');
          }),
        ],
        dispose() {
          if (isDemoFormActive(deps.store, sessionId)) {
            void commands.run('primer.dismissConfirm');
            void commands.run('primer.closeReview');
          }
        },
      });
    },
  });
}
