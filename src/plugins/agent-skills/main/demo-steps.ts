import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import type { ChatMainExports } from '../../chat/contract';

export interface AgentSkillsDemoMainDeps {
  chat: Pick<ChatMainExports, 'send'>;
}

// The Skills step's main half: a session that types two skills, the second
// queued behind the first turn; the fake starts a skill for each.
export function registerDemoSteps(
  services: MainServices,
  deps: AgentSkillsDemoMainDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'agent-skills.skills',
    async enter(context) {
      const session = await context.launchSession(
        '/wigley:explore Map the session list.',
      );
      await deps.chat.send(session, {
        text: '/wigley:writing-code',
        images: [],
      });
      return { sessions: { session }, dispose() {} };
    },
  });
}
