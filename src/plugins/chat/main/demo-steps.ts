import type { DemoMainContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import {
  FAKE_BLOCKS_TEXT,
  FAKE_HOLD_TEXT,
  FAKE_PERMISSION_TEXT,
  FAKE_STEPS_TEXT,
} from '../../../shared/fake-agent-harness';
import { createRegistrations } from '../../../shared/registrations';
import type { ChatSessions } from './chat-sessions';

export interface ChatDemoMainDeps {
  chat: Pick<ChatSessions, 'send' | 'interrupt'>;
}

const PLAN_TEXT = 'Plan the next change.';

// The main halves of chat's steps: each launches the demo sessions its page
// half shows. The composer step's queued send and interrupt run here, at
// enter, each on a session of its own.
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
    blocks: await context.launchSession(FAKE_BLOCKS_TEXT),
    steps: await context.launchSession(FAKE_STEPS_TEXT),
    permission: await context.launchSession(FAKE_PERMISSION_TEXT),
  }));
  register('chat.composer', async (context) => {
    const queued = await context.launchSession(FAKE_HOLD_TEXT);
    await chat.send(queued, { text: 'Then run the tests.', images: [] });
    const interrupted = await context.launchSession(FAKE_HOLD_TEXT);
    chat.interrupt(interrupted);
    const slash = await context.launchSession(PLAN_TEXT);
    return { queued, interrupted, slash };
  });
  register('chat.controls', async (context) => ({
    session: await context.launchSession(PLAN_TEXT),
  }));
  register('chat.headless', async (context) => ({
    session: await context.launchSession(PLAN_TEXT),
  }));
  return registrations;
}
