import type { DemoMainContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import {
  FAKE_HOLD_TEXT,
  FAKE_PERMISSION_TEXT,
} from '../../../shared/fake-agent-harness';
import { createRegistrations } from '../../../shared/registrations';

// The main halves of the session card and pane steps: each launches the demo
// sessions its page half shows. The card step's `error` session's process ends
// with a failure mid-turn, so its card reads `error`.
export function registerDemoSteps(services: MainServices): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'sessions.cards',
      async enter(context: DemoMainContext) {
        const done = await context.launchSession('Summarise the last commit.');
        const working = await context.launchSession(FAKE_HOLD_TEXT);
        const waiting = await context.launchSession(FAKE_PERMISSION_TEXT);
        const error = await context.launchSession(FAKE_HOLD_TEXT);
        context.processEvents(error).ended({
          code: 1,
          error: 'The agent process exited with code 1.',
        });
        return {
          sessions: { done, working, waiting, error },
          dispose() {},
        };
      },
    }),
  );
  registrations.track(
    services.demoSteps.register({
      id: 'sessions.panes',
      async enter(context: DemoMainContext) {
        const first = await context.launchSession('Map the session list.');
        const second = await context.launchSession('Review the open diff.');
        const third = await context.launchSession('Draft the release notes.');
        return {
          sessions: { first, second, third },
          dispose() {},
        };
      },
    }),
  );
  return registrations;
}
