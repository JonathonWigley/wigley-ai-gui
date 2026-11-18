import type { DemoMainContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import {
  FAKE_HOLD_TEXT,
  FAKE_STEPS_TEXT,
} from '../../../shared/fake-agent-harness';
import { createRegistrations } from '../../../shared/registrations';
import type { ChatSessions } from './chat-sessions';

export interface ChatDemoMainDeps {
  chat: Pick<ChatSessions, 'send'>;
}

const PLAN_TEXT = 'Plan the next change.';

// The main halves of chat's steps: each launches the demo sessions its page
// half shows. The composer step's queued send runs here, at enter.
export function registerDemoSteps(
  services: MainServices,
  deps: ChatDemoMainDeps,
): Disposable {
  const { chat } = deps;
  const registrations = createRegistrations();
  const register = (
    id: string,
    enter: (
      context: DemoMainContext,
    ) => Promise<Readonly<Record<string, string>>>,
  ) =>
    registrations.track(
      services.demoSteps.register({
        id,
        enter: async (context) => ({
          sessions: await enter(context),
          dispose() {},
        }),
      }),
    );
  register('chat.transcript', async (context) => ({
    steps: await context.launchSession(FAKE_STEPS_TEXT),
  }));
  register('chat.composer', async (context) => {
    const queued = await context.launchSession(FAKE_HOLD_TEXT);
    await chat.send(queued, { text: 'Then run the tests.', images: [] });
    return { queued };
  });
  register('chat.controls', async (context) => ({
    session: await context.launchSession(PLAN_TEXT),
  }));
  register('chat.headless', async (context) => ({
    session: await context.launchSession(PLAN_TEXT),
  }));
  return registrations;
}
