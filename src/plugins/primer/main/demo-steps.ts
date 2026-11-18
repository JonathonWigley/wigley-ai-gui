import type { AgentFormService } from '../../../contracts/agent-forms';
import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import {
  openSampleForm,
  sampleFormOwner,
} from '../../../shared/agent-forms/demo-form';
import type { PrimerPayload } from '../contract';
import { PREVIEW_PRIMER_ARGS } from './preview/preview-primer';

// `samples` is primer's sample service (memory store, quiet presenter, no
// wake), `activate` the sessions plugin's main `activate`.
export interface PrimerMainDemoDeps {
  samples: AgentFormService<PrimerPayload>;
  activate(sessionId: string): void;
  log: (line: string) => void;
}

// The primer step's primer: the preview's entries, unchanged so the page's
// task and item positions hold, under the demo's own feature.
export const DEMO_PRIMER_ARGS: typeof PREVIEW_PRIMER_ARGS = {
  ...PREVIEW_PRIMER_ARGS,
  feature: {
    name: 'Daily quests',
    slug: 'daily-quests',
    spec: 'A sample primer for the demo; nothing confirmed here reaches an agent.',
    summary:
      'Three tasks and the standing tests, each with the need the agent sees.',
  },
};

// The main half of `primer.primer`: a demo session holding the sample
// primer. Leaving the step ends the primer; the demo closes the session.
export function registerDemoSteps(
  services: MainServices,
  deps: PrimerMainDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'primer.primer',
    async enter(context) {
      const sessionId = await context.launchSession(
        'A sample session for the primer step.',
      );
      const form = openSampleForm(
        {
          forms: deps.samples,
          activate: deps.activate,
          log: deps.log,
          noun: 'primer',
        },
        sampleFormOwner(sessionId),
        DEMO_PRIMER_ARGS,
      );
      return {
        sessions: { session: sessionId },
        dispose: () => form.dispose(),
      };
    },
  });
}
