import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { ChatPageExports } from '../../chat/contract';
import type { SessionsPageExports } from '../../sessions/contract';

export interface AgentSkillsDemoPageDeps {
  activate: SessionsPageExports['activate'];
  showHubForNow: ChatPageExports['showHubForNow'];
}

// The Skills step: the session hub, held shown with the Skills section
// expanded, over a session whose agent started two skills.
export function registerDemoSteps(
  services: PageServices,
  deps: AgentSkillsDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'agent-skills.skills',
    section: 'sessions',
    order: 150,
    title: 'Skills',
    caption:
      'The session hub lists the skills the agent loaded in the session.',
    files: [
      'src/plugins/agent-skills/page/skill-list.ts',
      'src/plugins/agent-skills/layouts/default/layout.js',
    ],
    async enter(context) {
      const session = context.sessions.session;
      const hub = deps.showHubForNow('agent-skills.list');
      return {
        beats: [{ name: 'skills', show: () => deps.activate(session) }],
        dispose: () => hub.dispose(),
      };
    },
  });
}
