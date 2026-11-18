import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import {
  type DemoFormWaitDeps,
  demoFormBeat,
  isDemoFormActive,
} from '../../../shared/page/demo-form-wait';
import { primerSelectTaskCommand } from '../contract';

// Primer's page store and commands, the sessions plugin's `activate`, and the
// timers the wait for the sample primer runs on.
export interface PrimerPageDemoDeps extends DemoFormWaitDeps {
  commands: Pick<PluginCommands, 'run'>;
  log: PluginLog;
}

// The first task's position in DEMO_PRIMER_ARGS: `taskRows` puts the feature
// row at 0 and task `1` at 1.
const FIRST_TASK = 1;

// The page half of `primer.primer`: the demo session's sample primer on its
// first task. Leaving dismisses a cancel prompt and closes the review while
// the sample primer is active.
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
      return Promise.resolve({
        beats: [demoFormBeat(deps, sessionId, 'Tasks', onFirstTask)],
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
