import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import {
  type DemoFormWaitDeps,
  demoFormBeat,
  isDemoFormActive,
} from '../../../shared/page/demo-form-wait';
import { formsFocusItemCommand } from '../contract';

// Forms' page store and commands, the sessions plugin's `activate`, and the
// timers the wait for the sample round runs on.
export interface FormsPageDemoDeps extends DemoFormWaitDeps {
  commands: Pick<PluginCommands, 'run'>;
  log: PluginLog;
}

// The rail position of the first question in DEMO_ROUND_ARGS, after its three
// findings.
const FIRST_QUESTION = 3;

// The page half of `forms.round`: the demo session's sample round on its first
// question, every card kind on its rail. Leaving dismisses a cancel prompt and
// closes the review while the sample round is active.
export function registerDemoSteps(
  services: PageServices,
  deps: FormsPageDemoDeps,
): Disposable {
  const { commands } = deps;
  const onFirstQuestion = async () => {
    await commands.run('forms.dismissConfirm');
    await commands.run('forms.closeReview');
    await commands.run(formsFocusItemCommand, FIRST_QUESTION);
  };
  return services.demoSteps.register({
    id: 'forms.round',
    section: 'forms',
    order: 10,
    title: 'Review rounds',
    caption:
      'Review rounds: an agent asks its questions, findings and notices in one form',
    files: [
      'src/plugins/forms/main/start.ts',
      'src/plugins/forms/main/round-type.ts',
      'src/plugins/forms/page/start.ts',
      'src/plugins/forms/page/round-view.ts',
      'src/plugins/forms/page/round-model.ts',
      'src/plugins/forms/page/forms-commands.ts',
      'src/shared/page/session-forms.ts',
    ],
    enter: (context) => {
      const sessionId = context.sessions.session;
      return Promise.resolve({
        beats: [demoFormBeat(deps, sessionId, 'Round', onFirstQuestion)],
        dispose() {
          if (isDemoFormActive(deps.store, sessionId)) {
            void commands.run('forms.dismissConfirm');
            void commands.run('forms.closeReview');
          }
        },
      });
    },
  });
}
