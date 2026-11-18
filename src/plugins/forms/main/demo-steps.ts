import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import {
  openSampleForm,
  sampleFormOwner,
} from '../../../shared/agent-forms/demo-form';
import type { FormsService } from '../contract';
import { PREVIEW_ROUND_ARGS } from './preview/preview-round';

// `samples` is forms' sample service (memory store, quiet presenter, no wake),
// `activate` the sessions plugin's main `activate`.
export interface FormsMainDemoDeps {
  samples: FormsService;
  activate(sessionId: string): void;
  log: (line: string) => void;
}

// The forms step's round: the preview's sample, every card kind, under the
// demo's own heading.
export const DEMO_ROUND_ARGS: Record<string, unknown> = {
  ...PREVIEW_ROUND_ARGS,
  heading: 'Daily quests: first pass',
  overview:
    'A sample round for the demo; nothing answered here reaches an agent.',
};

// The main half of `forms.round`: a demo session holding the sample round.
// Leaving the step ends the round; the demo closes the session.
export function registerDemoSteps(
  services: MainServices,
  deps: FormsMainDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'forms.round',
    async enter(context) {
      const sessionId = await context.launchSession(
        'A sample session for the forms step.',
      );
      const form = openSampleForm(
        {
          forms: deps.samples,
          activate: deps.activate,
          log: deps.log,
          noun: 'round',
        },
        sampleFormOwner(sessionId),
        DEMO_ROUND_ARGS,
      );
      return {
        sessions: { session: sessionId },
        dispose: () => form.dispose(),
      };
    },
  });
}
