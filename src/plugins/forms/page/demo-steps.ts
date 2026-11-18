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

// Rail positions in DEMO_ROUND_ARGS: findings 0–2, questions 3–4, notices 5.
const FIRST_FINDING = 0;
const FIRST_QUESTION = 3;
const NOTICES = 5;

// The page half of `forms.round`: each beat shows the demo session's sample
// round and puts it in the beat's whole state. Leaving dismisses a cancel
// prompt and closes the review while the sample round is active.
export function registerDemoSteps(
  services: PageServices,
  deps: FormsPageDemoDeps,
): Disposable {
  const { commands } = deps;
  const onForm = async (position: number) => {
    await commands.run('forms.dismissConfirm');
    await commands.run('forms.closeReview');
    await commands.run(formsFocusItemCommand, position);
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
      const beat = (name: string, run: () => Promise<void>) =>
        demoFormBeat(deps, sessionId, name, run);
      return Promise.resolve({
        beats: [
          beat('Question', () => onForm(FIRST_QUESTION)),
          beat('Finding', () => onForm(FIRST_FINDING)),
          beat('Notice', () => onForm(NOTICES)),
          beat('Review', async () => {
            await commands.run('forms.dismissConfirm');
            await commands.run('forms.openReview');
          }),
          beat('Cancel', async () => {
            await commands.run('forms.dismissConfirm');
            await commands.run('forms.openReview');
            await commands.run('forms.askCancel');
          }),
        ],
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
