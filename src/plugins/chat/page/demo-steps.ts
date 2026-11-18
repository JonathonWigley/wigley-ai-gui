import type {
  DemoPageContext,
  DemoStage,
  DemoStep,
} from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import {
  type DemoStartPromptDeps,
  demoStartPrompt,
} from '../../../shared/page/demo-start-prompt';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../../sessions/contract';
import type { ChatPageExports } from '../contract';

export interface ChatDemoPageDeps {
  activate: SessionsPageExports['activate'];
  setHeadless: ChatPageExports['setHeadless'];
  startPrompt: DemoStartPromptDeps;
}

// The page halves of chat's steps. Each beat shows a session the main half
// launched; the start-prompt step closes the prompt it opened, one that opens
// after its beat was left included.
export function registerDemoSteps(
  services: PageServices,
  deps: ChatDemoPageDeps,
): Disposable {
  const { activate } = deps;
  const registrations = createRegistrations();
  const register = (step: Omit<DemoStep, 'section'>) =>
    registrations.track(
      services.demoSteps.register({ ...step, section: 'sessions' }),
    );
  const stageOf = (beats: DemoStage['beats']): DemoStage => ({
    beats,
    dispose() {},
  });

  register({
    id: 'chat.transcript',
    order: 30,
    title: 'Transcript',
    caption: 'The transcript draws every kind of entry an agent writes.',
    files: [
      'src/plugins/chat/page/entry-list.ts',
      'src/plugins/chat/layouts/default/layout.js',
    ],
    enter: async ({ sessions }: DemoPageContext) =>
      stageOf([{ name: 'transcript', show: () => activate(sessions.steps) }]),
  });

  register({
    id: 'chat.composer',
    order: 40,
    title: 'Message box',
    caption:
      'The message box queues messages while the agent works, and takes slash commands.',
    files: [
      'src/plugins/chat/page/composer-kit.ts',
      'src/plugins/chat/page/chat-commands.ts',
    ],
    enter: async ({ sessions }: DemoPageContext) =>
      stageOf([{ name: 'queued', show: () => activate(sessions.queued) }]),
  });

  register({
    id: 'chat.controls',
    order: 50,
    title: 'Session controls',
    caption:
      "Control chips set the session's permission mode, effort, model and verbosity.",
    files: [
      'src/plugins/chat/page/chat-view.ts',
      'src/plugins/chat/page/picker.ts',
    ],
    enter: async ({ sessions }: DemoPageContext) =>
      stageOf([{ name: 'chips', show: () => activate(sessions.session) }]),
  });

  register({
    id: 'chat.startPrompt',
    order: 60,
    title: 'Start prompt',
    caption:
      'The start prompt starts a session in a project or folder, or resumes a saved one.',
    files: [
      'src/plugins/chat/page/start-prompt.ts',
      'src/plugins/chat/page/start-prompt-items.ts',
    ],
    async enter(): Promise<DemoStage> {
      const prompt = demoStartPrompt(deps.startPrompt);
      return {
        beats: [
          {
            name: 'start prompt',
            show: async () => {
              await prompt.open();
            },
          },
        ],
        dispose: () => prompt.dispose(),
      };
    },
  });

  register({
    id: 'chat.headless',
    order: 70,
    title: 'Headless sessions',
    caption:
      'A headless session works without asking the user, and its chip says so.',
    files: [
      'src/plugins/chat/page/row-clock.ts',
      'src/plugins/chat/page/chat-view.ts',
    ],
    enter: async ({ sessions }: DemoPageContext) =>
      stageOf([
        {
          name: 'headless',
          async show() {
            activate(sessions.session);
            await deps.setHeadless(sessions.session, true);
          },
        },
      ]),
  });

  return registrations;
}
