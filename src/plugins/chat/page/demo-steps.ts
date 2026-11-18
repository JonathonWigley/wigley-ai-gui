import type {
  DemoPageContext,
  DemoStage,
  DemoStep,
} from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { EditorHost } from '../../../contracts/editor';
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
  fillComposer: ChatPageExports['fillComposer'];
  setHeadless: ChatPageExports['setHeadless'];
  typeInto: EditorHost['typeInto'];
  startPrompt: DemoStartPromptDeps;
  // Runs `chat.pickModel` on the shown tab's session.
  pickModel(): Promise<void>;
  cancelPicker(): void;
  isPickerOpen(): boolean;
}

// The page halves of chat's steps. Each beat shows a session the main half
// launched; the composer, controls and start-prompt steps close only what
// their own beats opened: a typed box, the model picker, the start prompt,
// a picker that opens after its beat was left included.
export function registerDemoSteps(
  services: PageServices,
  deps: ChatDemoPageDeps,
): Disposable {
  const { activate } = deps;
  const { log } = services;
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
      stageOf([
        { name: 'markdown', show: () => activate(sessions.blocks) },
        { name: 'tools and thinking', show: () => activate(sessions.steps) },
        { name: 'permission', show: () => activate(sessions.permission) },
      ]),
  });

  register({
    id: 'chat.composer',
    order: 40,
    title: 'Message box',
    caption:
      'The message box queues messages while the agent works, interrupts it, and takes slash commands typed after a /.',
    files: [
      'src/plugins/chat/page/composer-kit.ts',
      'src/plugins/chat/page/chat-commands.ts',
    ],
    async enter({ sessions }: DemoPageContext) {
      let hasTyped = false;
      // Types a `/` into the box. The completion it opens closes as the demo takes the keys back from the box, so
      // the beat shows the typed `/` alone.
      const typeSlash = () => {
        deps.fillComposer(sessions.slash, '');
        const focused = document.activeElement;
        if (focused === null || !services.editor.contains(focused)) {
          log('demo composer: no box to type into');
          return;
        }
        deps.typeInto(focused, ['/']);
        hasTyped = true;
      };
      return {
        beats: [
          { name: 'queued', show: () => activate(sessions.queued) },
          { name: 'interrupted', show: () => activate(sessions.interrupted) },
          { name: 'slash commands', show: typeSlash },
        ],
        dispose() {
          if (hasTyped) {
            deps.fillComposer(sessions.slash, '');
          }
        },
      };
    },
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
    async enter({ sessions }: DemoPageContext) {
      const { session } = sessions;
      let hasOpenedPicker = false;
      // Bumped by each beat and the dispose, so a picker that opens after its
      // beat was left is closed.
      let beatRun = 0;
      const closeOwnPicker = () => {
        beatRun += 1;
        if (hasOpenedPicker && deps.isPickerOpen()) {
          deps.cancelPicker();
        }
        hasOpenedPicker = false;
      };
      return {
        beats: [
          {
            name: 'chips',
            show() {
              closeOwnPicker();
              activate(session);
            },
          },
          {
            name: 'model picker',
            async show() {
              beatRun += 1;
              const run = beatRun;
              activate(session);
              if (deps.isPickerOpen()) {
                return;
              }
              await deps.pickModel();
              if (run !== beatRun) {
                if (deps.isPickerOpen()) {
                  deps.cancelPicker();
                }
                return;
              }
              hasOpenedPicker = deps.isPickerOpen();
              if (!hasOpenedPicker) {
                log('demo controls: no model picker');
              }
            },
          },
        ],
        dispose: closeOwnPicker,
      };
    },
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
    async enter({ sessions }: DemoPageContext) {
      const { session } = sessions;
      const showHeadless = (headless: boolean) => async () => {
        activate(session);
        await deps.setHeadless(session, headless);
      };
      return stageOf([
        { name: 'attended', show: showHeadless(false) },
        { name: 'headless', show: showHeadless(true) },
      ]);
    },
  });

  return registrations;
}
